package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

type NodeKind string

const (
	KindRole     NodeKind = "role"
	KindEpic     NodeKind = "epic"
	KindStory    NodeKind = "story"
	KindSubstory NodeKind = "substory"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrInvalidParent = errors.New("invalid parent")
	ErrInvalidName   = errors.New("name is required")
	ErrInvalidOrder  = errors.New("invalid node order")
)

type Node struct {
	ID       string   `json:"id"`
	Kind     NodeKind `json:"kind"`
	ParentID string   `json:"parentId,omitempty"`
	Name     string   `json:"name"`
}

type Project struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Nodes []Node `json:"nodes"`
}

type database struct {
	Version  int       `json:"version"`
	Projects []Project `json:"projects"`
}

type Store struct {
	mu   sync.RWMutex
	path string
	data database
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		s.data = seedDatabase()
		if err := s.saveLocked(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		return nil, fmt.Errorf("decode data: %w", err)
	}
	if s.data.Projects == nil {
		s.data.Projects = []Project{}
	}
	return s, nil
}

func (s *Store) Projects() []Project {
	s.mu.RLock()
	defer s.mu.RUnlock()

	projects := make([]Project, len(s.data.Projects))
	for i, project := range s.data.Projects {
		projects[i] = Project{ID: project.ID, Name: project.Name, Nodes: []Node{}}
	}
	return projects
}

func (s *Store) Project(id string) (Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	index := s.projectIndex(id)
	if index < 0 {
		return Project{}, ErrNotFound
	}
	return cloneProject(s.data.Projects[index]), nil
}

func (s *Store) CreateProject(name string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Project{}, ErrInvalidName
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	project := Project{ID: newID(), Name: name, Nodes: []Node{}}
	s.data.Projects = append(s.data.Projects, project)
	if err := s.saveLocked(); err != nil {
		s.data.Projects = s.data.Projects[:len(s.data.Projects)-1]
		return Project{}, err
	}
	return project, nil
}

func (s *Store) RenameProject(id, name string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Project{}, ErrInvalidName
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.projectIndex(id)
	if index < 0 {
		return Project{}, ErrNotFound
	}
	previous := s.data.Projects[index].Name
	s.data.Projects[index].Name = name
	if err := s.saveLocked(); err != nil {
		s.data.Projects[index].Name = previous
		return Project{}, err
	}
	return cloneProject(s.data.Projects[index]), nil
}

func (s *Store) DeleteProject(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.projectIndex(id)
	if index < 0 {
		return ErrNotFound
	}
	previous := append([]Project(nil), s.data.Projects...)
	s.data.Projects = append(s.data.Projects[:index], s.data.Projects[index+1:]...)
	if err := s.saveLocked(); err != nil {
		s.data.Projects = previous
		return err
	}
	return nil
}

func (s *Store) CreateNode(projectID string, kind NodeKind, parentID, name string) (Node, error) {
	return s.CreateNodeAfter(projectID, kind, parentID, "", name)
}

func (s *Store) CreateNodeAfter(projectID string, kind NodeKind, parentID, afterID, name string) (Node, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Node{}, ErrInvalidName
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	projectIndex := s.projectIndex(projectID)
	if projectIndex < 0 {
		return Node{}, ErrNotFound
	}
	project := &s.data.Projects[projectIndex]
	if !validParent(*project, kind, parentID) {
		return Node{}, ErrInvalidParent
	}

	node := Node{ID: newID(), Kind: kind, ParentID: parentID, Name: name}
	previous := append([]Node(nil), project.Nodes...)
	if afterID == "" {
		project.Nodes = append(project.Nodes, node)
	} else {
		anchorIndex := nodeIndex(project.Nodes, afterID)
		if anchorIndex < 0 {
			return Node{}, ErrInvalidOrder
		}
		anchor := project.Nodes[anchorIndex]
		if anchor.Kind != kind || anchor.ParentID != parentID {
			return Node{}, ErrInvalidOrder
		}
		project.Nodes = append(project.Nodes, Node{})
		copy(project.Nodes[anchorIndex+2:], project.Nodes[anchorIndex+1:])
		project.Nodes[anchorIndex+1] = node
	}
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return Node{}, err
	}
	return node, nil
}

func (s *Store) RenameNode(projectID, nodeID, name string) (Node, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Node{}, ErrInvalidName
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	projectIndex := s.projectIndex(projectID)
	if projectIndex < 0 {
		return Node{}, ErrNotFound
	}
	project := &s.data.Projects[projectIndex]
	nodeIndex := nodeIndex(project.Nodes, nodeID)
	if nodeIndex < 0 {
		return Node{}, ErrNotFound
	}
	previous := project.Nodes[nodeIndex].Name
	project.Nodes[nodeIndex].Name = name
	if err := s.saveLocked(); err != nil {
		project.Nodes[nodeIndex].Name = previous
		return Node{}, err
	}
	return project.Nodes[nodeIndex], nil
}

func (s *Store) MoveNode(projectID, nodeID, parentID string, nodeIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	projectIndex := s.projectIndex(projectID)
	if projectIndex < 0 {
		return ErrNotFound
	}
	project := &s.data.Projects[projectIndex]
	if len(nodeIDs) == 0 || nodeID == "" {
		return ErrInvalidOrder
	}

	nodesByID := make(map[string]Node, len(project.Nodes))
	for _, node := range project.Nodes {
		nodesByID[node.ID] = node
	}
	moving, ok := nodesByID[nodeID]
	if !ok {
		return ErrInvalidOrder
	}
	if !validParent(*project, moving.Kind, parentID) {
		return ErrInvalidParent
	}

	isTargetSibling := func(node Node) bool {
		return node.ID != nodeID && node.Kind == moving.Kind && node.ParentID == parentID
	}
	targetSiblingCount := 0
	for _, node := range project.Nodes {
		if isTargetSibling(node) {
			targetSiblingCount++
		}
	}
	if len(nodeIDs) != targetSiblingCount+1 {
		return ErrInvalidOrder
	}

	ordered := make([]Node, 0, len(nodeIDs))
	seen := make(map[string]bool, len(nodeIDs))
	for _, id := range nodeIDs {
		node, exists := nodesByID[id]
		if !exists || seen[id] || (id != nodeID && !isTargetSibling(node)) {
			return ErrInvalidOrder
		}
		if id == nodeID {
			node.ParentID = parentID
		}
		seen[id] = true
		ordered = append(ordered, node)
	}
	if !seen[nodeID] {
		return ErrInvalidOrder
	}

	previous := append([]Node(nil), project.Nodes...)
	reordered := make([]Node, 0, len(project.Nodes))
	for _, node := range project.Nodes {
		if !seen[node.ID] {
			reordered = append(reordered, node)
		}
	}
	project.Nodes = append(reordered, ordered...)
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return err
	}
	return nil
}

func (s *Store) DeleteNode(projectID, nodeID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	projectIndex := s.projectIndex(projectID)
	if projectIndex < 0 {
		return ErrNotFound
	}
	project := &s.data.Projects[projectIndex]
	if nodeIndex(project.Nodes, nodeID) < 0 {
		return ErrNotFound
	}

	remove := map[string]bool{nodeID: true}
	for changed := true; changed; {
		changed = false
		for _, node := range project.Nodes {
			if remove[node.ParentID] && !remove[node.ID] {
				remove[node.ID] = true
				changed = true
			}
		}
	}
	previous := append([]Node(nil), project.Nodes...)
	kept := make([]Node, 0, len(project.Nodes)-len(remove))
	for _, node := range project.Nodes {
		if !remove[node.ID] {
			kept = append(kept, node)
		}
	}
	project.Nodes = kept
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return err
	}
	return nil
}

func (s *Store) projectIndex(id string) int {
	for i := range s.data.Projects {
		if s.data.Projects[i].ID == id {
			return i
		}
	}
	return -1
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func validParent(project Project, kind NodeKind, parentID string) bool {
	if kind == KindRole {
		return parentID == ""
	}
	expected := map[NodeKind]NodeKind{
		KindEpic:     KindRole,
		KindStory:    KindEpic,
		KindSubstory: KindStory,
	}[kind]
	if expected == "" {
		return false
	}
	for _, node := range project.Nodes {
		if node.ID == parentID {
			return node.Kind == expected
		}
	}
	return false
}

func nodeIndex(nodes []Node, id string) int {
	for i := range nodes {
		if nodes[i].ID == id {
			return i
		}
	}
	return -1
}

func cloneProject(project Project) Project {
	project.Nodes = append([]Node{}, project.Nodes...)
	return project
}

func newID() string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes)
}

func seedDatabase() database {
	roleCustomer := Node{ID: newID(), Kind: KindRole, Name: "产品使用者"}
	roleOperator := Node{ID: newID(), Kind: KindRole, Name: "项目负责人"}
	epicExplore := Node{ID: newID(), Kind: KindEpic, ParentID: roleCustomer.ID, Name: "了解产品"}
	epicUse := Node{ID: newID(), Kind: KindEpic, ParentID: roleCustomer.ID, Name: "使用核心功能"}
	epicManage := Node{ID: newID(), Kind: KindEpic, ParentID: roleOperator.ID, Name: "规划工作"}
	storyBrowse := Node{ID: newID(), Kind: KindStory, ParentID: epicExplore.ID, Name: "浏览项目概览"}
	storyCreate := Node{ID: newID(), Kind: KindStory, ParentID: epicUse.ID, Name: "创建工作内容"}
	storyMap := Node{ID: newID(), Kind: KindStory, ParentID: epicManage.ID, Name: "维护故事地图"}

	return database{Version: 1, Projects: []Project{{
		ID:   newID(),
		Name: "产品规划",
		Nodes: []Node{
			roleCustomer, roleOperator,
			epicExplore, epicUse, epicManage,
			storyBrowse, storyCreate, storyMap,
			{ID: newID(), Kind: KindSubstory, ParentID: storyBrowse.ID, Name: "查看最近项目"},
			{ID: newID(), Kind: KindSubstory, ParentID: storyCreate.ID, Name: "填写内容名称"},
			{ID: newID(), Kind: KindSubstory, ParentID: storyMap.ID, Name: "拆分用户故事"},
		},
	}}}
}

const (
	maxNodeName   = 80
	maxTreeAppend = 100
)

var (
	ErrDuplicateName = errors.New("duplicate sibling name")
	ErrNameTooLong   = errors.New("name is too long")
	ErrTooDeep       = errors.New("tree goes below substory")
	ErrTooManyNodes  = errors.New("too many nodes in one change")
)

var childKindOf = map[NodeKind]NodeKind{KindRole: KindEpic, KindEpic: KindStory, KindStory: KindSubstory}

// NewNode is a node to create together with its descendants.
type NewNode struct {
	Name     string    `json:"name"`
	Children []NewNode `json:"children,omitempty"`
}

func cleanNodeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	switch {
	case name == "" || !utf8.ValidString(name) || strings.ContainsFunc(name, unicode.IsControl):
		return "", ErrInvalidName
	case utf8.RuneCountInString(name) > maxNodeName:
		return "", ErrNameTooLong
	}
	return name, nil
}

// AppendTree adds tree under parentID ("" for roles) in one save. Each level's
// kind follows from its depth; new siblings must not share a name with each
// other or, at the top, with the parent's existing children.
func (s *Store) AppendTree(projectID, parentID string, tree []NewNode) ([]Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	projectIndex := s.projectIndex(projectID)
	if projectIndex < 0 {
		return nil, ErrNotFound
	}
	project := &s.data.Projects[projectIndex]
	kind := KindRole
	if parentID != "" {
		index := nodeIndex(project.Nodes, parentID)
		if index < 0 {
			return nil, ErrNotFound
		}
		kind = childKindOf[project.Nodes[index].Kind]
		if kind == "" {
			return nil, ErrTooDeep
		}
	}
	var existing []string
	for _, node := range project.Nodes {
		if node.ParentID == parentID && node.Kind == kind {
			existing = append(existing, node.Name)
		}
	}
	var created []Node
	if err := appendTreeLevel(&created, parentID, kind, tree, existing); err != nil {
		return nil, err
	}
	if len(created) == 0 {
		return nil, ErrInvalidName
	}
	if len(created) > maxTreeAppend {
		return nil, ErrTooManyNodes
	}
	previous := project.Nodes
	project.Nodes = append(append([]Node{}, previous...), created...)
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return nil, err
	}
	return created, nil
}

// appendTreeLevel validates one sibling group and, depth first, the levels
// under it. Parents land in created before their children.
func appendTreeLevel(created *[]Node, parentID string, kind NodeKind, level []NewNode, existing []string) error {
	seen := make(map[string]bool, len(existing)+len(level))
	for _, name := range existing {
		seen[strings.ToLower(strings.TrimSpace(name))] = true
	}
	for _, item := range level {
		name, err := cleanNodeName(item.Name)
		if err != nil {
			return err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return fmt.Errorf("%w: %s", ErrDuplicateName, name)
		}
		seen[key] = true
		node := Node{ID: newID(), Kind: kind, ParentID: parentID, Name: name}
		*created = append(*created, node)
		if len(item.Children) == 0 {
			continue
		}
		childKind := childKindOf[kind]
		if childKind == "" {
			return ErrTooDeep
		}
		if err := appendTreeLevel(created, node.ID, childKind, item.Children, nil); err != nil {
			return err
		}
	}
	return nil
}

// ReplaceNodes swaps in a whole node list, e.g. to undo an assistant turn.
// The list must be a valid map on its own.
func (s *Store) ReplaceNodes(projectID string, nodes []Node) (Project, error) {
	if err := validateNodes(nodes); err != nil {
		return Project{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	projectIndex := s.projectIndex(projectID)
	if projectIndex < 0 {
		return Project{}, ErrNotFound
	}
	project := &s.data.Projects[projectIndex]
	previous := project.Nodes
	project.Nodes = append([]Node{}, nodes...)
	if err := s.saveLocked(); err != nil {
		project.Nodes = previous
		return Project{}, err
	}
	return cloneProject(*project), nil
}

func validateNodes(nodes []Node) error {
	kinds := make(map[string]NodeKind, len(nodes))
	for _, node := range nodes {
		if node.ID == "" || kinds[node.ID] != "" {
			return ErrInvalidOrder
		}
		if _, err := cleanNodeName(node.Name); err != nil {
			return err
		}
		kinds[node.ID] = node.Kind
	}
	for _, node := range nodes {
		switch node.Kind {
		case KindRole:
			if node.ParentID != "" {
				return ErrInvalidParent
			}
		case KindEpic, KindStory, KindSubstory:
			if childKindOf[kinds[node.ParentID]] != node.Kind {
				return ErrInvalidParent
			}
		default:
			return ErrInvalidParent
		}
	}
	return nil
}
