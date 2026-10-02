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
)

var (
	ErrLeafNode           = errors.New("leaf nodes cannot have children")
	ErrGenerationConflict = errors.New("generation context changed")
)

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
	childKind := map[NodeKind]NodeKind{
		KindRole: KindEpic, KindEpic: KindStory, KindStory: KindSubstory,
	}[parent.Kind]
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

func (snapshot generationSnapshot) input(count int, prompt string) GenerationInput {
	input := GenerationInput{
		ProjectName:      snapshot.ProjectName,
		Ancestors:        []GenerationNode{},
		Parent:           GenerationNode{Name: snapshot.Parent.Name, Kind: snapshot.Parent.Kind},
		ChildKind:        snapshot.ChildKind,
		ExistingChildren: []string{},
		Count:            count,
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
func (s *Store) createGeneratedChildren(ctx context.Context, projectID string, snapshot generationSnapshot, names []string, count int) ([]Node, error) {
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
	if count < 1 || count > maxGenerationCount || len(names) != count {
		return nil, ErrAIInvalidResponse
	}
	seen := make(map[string]bool, len(current.Children)+len(names))
	for _, node := range current.Children {
		seen[strings.ToLower(strings.TrimSpace(node.Name))] = true
	}
	created := make([]Node, 0, count)
	for _, name := range names {
		name = strings.TrimSpace(name)
		key := strings.ToLower(name)
		if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxGeneratedName ||
			strings.ContainsFunc(name, unicode.IsControl) || seen[key] {
			return nil, ErrAIInvalidResponse
		}
		seen[key] = true
		created = append(created, Node{ID: newID(), Kind: current.ChildKind, ParentID: current.Parent.ID, Name: name})
	}
	previous := project.Nodes
	project.Nodes = append(append([]Node{}, previous...), created...)
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return nil, err
	}
	return created, nil
}
