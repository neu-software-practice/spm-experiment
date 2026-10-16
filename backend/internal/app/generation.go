package app

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	defaultGenerationCount = 3
	maxGenerationCount     = 10
	maxGenerationPrompt    = 2000
	maxGeneratedName       = 80
	maxDescendantCount     = 5
	maxGeneratedNodes      = 100
)

var (
	ErrLeafNode           = errors.New("leaf nodes cannot have children")
	ErrGenerationConflict = errors.New("generation context changed")
	ErrNoDescendantLevels = errors.New("the child level has no deeper levels")
	ErrTooManyGenerated   = errors.New("too many nodes requested")
)

var childKindOf = map[NodeKind]NodeKind{KindRole: KindEpic, KindEpic: KindStory, KindStory: KindSubstory}

// levelsBelow lists the kinds under kind, nearest first.
func levelsBelow(kind NodeKind) []NodeKind {
	var levels []NodeKind
	for next := childKindOf[kind]; next != ""; next = childKindOf[next] {
		levels = append(levels, next)
	}
	return levels
}

// generationPlan is how many nodes one request creates: count direct children,
// then descendantCount children under every node for each deeper level.
type generationPlan struct {
	Count           int
	DescendantKinds []NodeKind
	DescendantCount int
}

func (snapshot generationSnapshot) plan(count, descendantCount int) (generationPlan, error) {
	plan := generationPlan{Count: count}
	if descendantCount == 0 {
		return plan, nil
	}
	plan.DescendantKinds = levelsBelow(snapshot.ChildKind)
	if len(plan.DescendantKinds) == 0 {
		return generationPlan{}, ErrNoDescendantLevels
	}
	plan.DescendantCount = descendantCount
	if plan.total() > maxGeneratedNodes {
		return generationPlan{}, ErrTooManyGenerated
	}
	return plan, nil
}

func (plan generationPlan) total() int {
	total, level := 0, plan.Count
	for depth := 0; depth <= len(plan.DescendantKinds); depth++ {
		total += level
		level *= plan.DescendantCount
	}
	return total
}

type generationSnapshot struct {
	ProjectName string
	Parent      Node
	Ancestors   []Node
	Children    []Node
	ChildKind   NodeKind
}

func generationContext(project Project, parentID string) (generationSnapshot, error) {
	index := nodeIndex(project.Nodes, parentID)
	if index < 0 {
		return generationSnapshot{}, ErrNotFound
	}
	parent := project.Nodes[index]
	childKind := childKindOf[parent.Kind]
	if childKind == "" {
		return generationSnapshot{}, ErrLeafNode
	}
	snapshot := generationSnapshot{ProjectName: project.Name, Parent: parent, ChildKind: childKind}
	seen := map[string]bool{parent.ID: true}
	for ancestorID := parent.ParentID; ancestorID != ""; {
		index := nodeIndex(project.Nodes, ancestorID)
		if index < 0 || seen[ancestorID] {
			return generationSnapshot{}, ErrInvalidParent
		}
		ancestor := project.Nodes[index]
		snapshot.Ancestors = append(snapshot.Ancestors, ancestor)
		seen[ancestorID] = true
		ancestorID = ancestor.ParentID
	}
	slices.Reverse(snapshot.Ancestors)
	for _, node := range project.Nodes {
		if node.ParentID == parent.ID {
			snapshot.Children = append(snapshot.Children, node)
		}
	}
	return snapshot, nil
}

func (snapshot generationSnapshot) input(plan generationPlan, prompt string) GenerationInput {
	input := GenerationInput{
		ProjectName:      snapshot.ProjectName,
		Ancestors:        []GenerationNode{},
		Parent:           GenerationNode{Name: snapshot.Parent.Name, Kind: snapshot.Parent.Kind},
		ChildKind:        snapshot.ChildKind,
		ExistingChildren: []string{},
		Count:            plan.Count,
		DescendantKinds:  plan.DescendantKinds,
		DescendantCount:  plan.DescendantCount,
		Prompt:           prompt,
	}
	for _, node := range snapshot.Ancestors {
		input.Ancestors = append(input.Ancestors, GenerationNode{Name: node.Name, Kind: node.Kind})
	}
	for _, node := range snapshot.Children {
		input.ExistingChildren = append(input.ExistingChildren, node.Name)
	}
	return input
}

// The model call runs outside the store lock. Revalidate its input before a
// single atomic save so concurrent edits cannot produce stale/partial children.
func (s *Store) createGeneratedChildren(ctx context.Context, projectID string, snapshot generationSnapshot, generated []GeneratedNode, plan generationPlan) ([]Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	index := s.projectIndex(projectID)
	if index < 0 {
		return nil, ErrNotFound
	}
	project := &s.data.Projects[index]
	current, err := generationContext(*project, snapshot.Parent.ID)
	if err != nil {
		return nil, err
	}
	if current.ProjectName != snapshot.ProjectName || current.Parent != snapshot.Parent ||
		!slices.Equal(current.Ancestors, snapshot.Ancestors) || !slices.Equal(current.Children, snapshot.Children) {
		return nil, ErrGenerationConflict
	}
	if plan.Count < 1 || plan.Count > maxGenerationCount {
		return nil, ErrAIInvalidResponse
	}
	existing := make([]string, len(current.Children))
	for i, node := range current.Children {
		existing[i] = node.Name
	}
	created := make([]Node, 0, plan.total())
	kinds := append([]NodeKind{current.ChildKind}, plan.DescendantKinds...)
	if err := appendGeneratedLevel(&created, current.Parent.ID, generated, plan.Count, existing, kinds, plan.DescendantCount); err != nil {
		return nil, err
	}
	previous := project.Nodes
	project.Nodes = append(append([]Node{}, previous...), created...)
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return nil, err
	}
	return created, nil
}

// appendGeneratedLevel validates one sibling group and, depth first, the
// levels under it. Parents land in created before their children.
func appendGeneratedLevel(created *[]Node, parentID string, generated []GeneratedNode, count int, existing []string, kinds []NodeKind, descendantCount int) error {
	if len(generated) != count {
		return ErrAIInvalidResponse
	}
	seen := make(map[string]bool, len(existing)+len(generated))
	for _, name := range existing {
		seen[strings.ToLower(strings.TrimSpace(name))] = true
	}
	for _, item := range generated {
		name := strings.TrimSpace(item.Name)
		key := strings.ToLower(name)
		if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxGeneratedName ||
			strings.ContainsFunc(name, unicode.IsControl) || seen[key] {
			return ErrAIInvalidResponse
		}
		seen[key] = true
		node := Node{ID: newID(), Kind: kinds[0], ParentID: parentID, Name: name}
		*created = append(*created, node)
		if len(kinds) == 1 {
			if len(item.Children) > 0 {
				return ErrAIInvalidResponse
			}
			continue
		}
		if err := appendGeneratedLevel(created, node.ID, item.Children, descendantCount, nil, kinds[1:], descendantCount); err != nil {
			return err
		}
	}
	return nil
}
