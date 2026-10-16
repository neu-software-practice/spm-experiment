package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type generatorFunc func(context.Context, GenerationInput) ([]string, error)

func (f generatorFunc) GenerateChildren(ctx context.Context, input GenerationInput) ([]GeneratedNode, error) {
	names, err := f(ctx, input)
	nodes := make([]GeneratedNode, len(names))
	for i, name := range names {
		nodes[i] = GeneratedNode{Name: name}
	}
	return nodes, err
}

type treeGeneratorFunc func(context.Context, GenerationInput) ([]GeneratedNode, error)

func (f treeGeneratorFunc) GenerateChildren(ctx context.Context, input GenerationInput) ([]GeneratedNode, error) {
	return f(ctx, input)
}

type generationFixture struct {
	store   *Store
	project Project
	role    Node
	epic    Node
	story   Node
	leaf    Node
}

func newGenerationFixture(t *testing.T) generationFixture {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "spm.json"))
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject("内容平台")
	if err != nil {
		t.Fatal(err)
	}
	create := func(kind NodeKind, parent, name string) Node {
		node, err := store.CreateNode(project.ID, kind, parent, name)
		if err != nil {
			t.Fatal(err)
		}
		return node
	}
	role := create(KindRole, "", "内容创作者")
	epic := create(KindEpic, role.ID, "发布文章")
	story := create(KindStory, epic.ID, "添加封面")
	leaf := create(KindSubstory, story.ID, "选择封面图片")
	return generationFixture{store: store, project: project, role: role, epic: epic, story: story, leaf: leaf}
}

func (f generationFixture) path(parent Node) string {
	return "/api/projects/" + f.project.ID + "/nodes/" + parent.ID + "/generate-children"
}

func performGeneration(handler http.Handler, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertStatus(t *testing.T, response *httptest.ResponseRecorder, want int) {
	t.Helper()
	if response.Code != want {
		t.Fatalf("status = %d, want %d: %s", response.Code, want, response.Body.String())
	}
}

func loadTestProject(t *testing.T, f generationFixture) Project {
	t.Helper()
	project, err := f.store.Project(f.project.ID)
	if err != nil {
		t.Fatal(err)
	}
	return project
}

func TestGenerateChildrenUsesCorrectHierarchyAndPersists(t *testing.T) {
	for _, kind := range []NodeKind{KindRole, KindEpic, KindStory} {
		t.Run(string(kind), func(t *testing.T) {
			f := newGenerationFixture(t)
			parent := map[NodeKind]Node{KindRole: f.role, KindEpic: f.epic, KindStory: f.story}[kind]
			before := loadTestProject(t, f)
			var gotInput GenerationInput
			generator := generatorFunc(func(_ context.Context, input GenerationInput) ([]string, error) {
				gotInput = input
				return []string{" 新增内容一 ", "新增内容二", "新增内容三"}, nil
			})
			response := performGeneration(NewRouter(f.store, generator), f.path(parent), `{}`)
			assertStatus(t, response, http.StatusCreated)
			var result struct {
				ParentID string `json:"parentId"`
				Nodes    []Node `json:"nodes"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.ParentID != parent.ID || len(result.Nodes) != 3 || gotInput.Count != 3 || gotInput.Prompt != "" {
				t.Fatalf("unexpected response/input: %#v / %#v", result, gotInput)
			}
			childKind := map[NodeKind]NodeKind{KindRole: KindEpic, KindEpic: KindStory, KindStory: KindSubstory}[kind]
			ids := map[string]bool{}
			for _, node := range result.Nodes {
				if node.ID == "" || ids[node.ID] || node.ParentID != parent.ID || node.Kind != childKind {
					t.Fatalf("invalid generated node: %#v", node)
				}
				ids[node.ID] = true
			}
			if result.Nodes[0].Name != "新增内容一" {
				t.Fatal("generated names were not trimmed")
			}
			reopened, err := OpenStore(f.store.path)
			if err != nil {
				t.Fatal(err)
			}
			persisted, err := reopened.Project(f.project.ID)
			if err != nil {
				t.Fatal(err)
			}
			wantNodes := append(before.Nodes, result.Nodes...)
			if !reflect.DeepEqual(persisted.Nodes, wantNodes) {
				t.Fatalf("existing nodes/order or generated nodes not preserved: %#v", persisted.Nodes)
			}
		})
	}
}

func TestGenerationRejectsInvalidRequestsBeforeCallingAI(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"zero count", `{"count":0}`},
		{"negative count", `{"count":-1}`},
		{"excessive count", `{"count":11}`},
		{"fractional count", `{"count":1.5}`},
		{"wrong count type", `{"count":"2"}`},
		{"wrong prompt type", `{"prompt":123}`},
		{"long prompt", `{"prompt":"` + strings.Repeat("字", 2001) + `"}`},
		{"large body", `{"prompt":"` + strings.Repeat("a", 17<<10) + `"}`},
		{"unknown parent override", `{"parentId":"other"}`},
		{"unknown kind override", `{"kind":"role"}`},
		{"trailing JSON", `{} {}`},
		{"malformed JSON", `{`},
		{"empty body", ``},
		{"null body", `null`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGenerationFixture(t)
			before := loadTestProject(t, f)
			calls := 0
			generator := generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
				calls++
				return nil, nil
			})
			response := performGeneration(NewRouter(f.store, generator), f.path(f.role), tc.body)
			assertStatus(t, response, http.StatusBadRequest)
			if calls != 0 || !reflect.DeepEqual(before, loadTestProject(t, f)) {
				t.Fatal("invalid request called AI or changed the store")
			}
		})
	}
}

func TestGenerationRequiresParentInProjectAndRejectsLeaves(t *testing.T) {
	f := newGenerationFixture(t)
	calls := 0
	router := NewRouter(f.store, generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
		calls++
		return nil, nil
	}))
	for _, tc := range []struct {
		path string
		code int
	}{
		{f.path(f.leaf), http.StatusBadRequest},
		{f.path(Node{ID: "missing"}), http.StatusNotFound},
		{"/api/projects/missing/nodes/" + f.role.ID + "/generate-children", http.StatusNotFound},
		{"/api/projects/" + f.store.Projects()[0].ID + "/nodes/" + f.role.ID + "/generate-children", http.StatusNotFound},
	} {
		assertStatus(t, performGeneration(router, tc.path, `{}`), tc.code)
	}
	if calls != 0 {
		t.Fatal("AI was called for an invalid parent")
	}
}

func TestDisabledAIDoesNotDisableCRUD(t *testing.T) {
	f := newGenerationFixture(t)
	router := NewRouter(f.store, nil)
	status := httptest.NewRecorder()
	router.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/api/ai/status", nil))
	assertStatus(t, status, http.StatusOK)
	if status.Body.String() != `{"enabled":false}` {
		t.Fatalf("unexpected status: %s", status.Body)
	}
	assertStatus(t, performGeneration(router, f.path(f.role), `{}`), http.StatusServiceUnavailable)
	assertStatus(t, performGeneration(router, "/api/projects", `{"name":"普通项目"}`), http.StatusCreated)
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/projects/"+f.project.ID, nil))
	assertStatus(t, get, http.StatusOK)
}

func TestGeneratedNamesAreValidatedBeforeAnyWrite(t *testing.T) {
	for _, tc := range []struct {
		name  string
		names []string
	}{
		{"empty", nil},
		{"too few", []string{"名称一"}},
		{"too many", []string{"名称一", "名称二", "名称三"}},
		{"blank later name", []string{"名称一", "  "}},
		{"long later name", []string{"名称一", strings.Repeat("字", 81)}},
		{"duplicate", []string{"名称一", " 名称一 "}},
		{"duplicate ignoring case", []string{"Story", "story"}},
		{"existing child", []string{"名称一", "选择封面图片"}},
		{"control characters", []string{"名称一", "一行\n另一行"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGenerationFixture(t)
			before := loadTestProject(t, f)
			router := NewRouter(f.store, generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
				return tc.names, nil
			}))
			assertStatus(t, performGeneration(router, f.path(f.story), `{"count":2}`), http.StatusBadGateway)
			if !reflect.DeepEqual(before, loadTestProject(t, f)) {
				t.Fatal("invalid generated content partially changed the store")
			}
			reopened, err := OpenStore(f.store.path)
			if err != nil {
				t.Fatal(err)
			}
			onDisk, err := reopened.Project(f.project.ID)
			if err != nil || !reflect.DeepEqual(before, onDisk) {
				t.Fatalf("invalid content changed persisted data: %v", err)
			}
		})
	}
}

func TestGenerationRejectsChangedContextAndKeepsOtherEdits(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(generationFixture) error
		status int
	}{
		{"parent renamed", func(f generationFixture) error {
			_, err := f.store.RenameNode(f.project.ID, f.story.ID, "改后的父节点")
			return err
		}, http.StatusConflict},
		{"ancestor renamed", func(f generationFixture) error {
			_, err := f.store.RenameNode(f.project.ID, f.role.ID, "管理员")
			return err
		}, http.StatusConflict},
		{"child added", func(f generationFixture) error {
			_, err := f.store.CreateNode(f.project.ID, KindSubstory, f.story.ID, "另一个用户添加")
			return err
		}, http.StatusConflict},
		{"project renamed", func(f generationFixture) error {
			_, err := f.store.RenameProject(f.project.ID, "其他项目名称")
			return err
		}, http.StatusConflict},
		{"parent deleted", func(f generationFixture) error { return f.store.DeleteNode(f.project.ID, f.story.ID) }, http.StatusNotFound},
		{"unrelated edit", func(f generationFixture) error {
			_, err := f.store.CreateNode(f.project.ID, KindRole, "", "新角色")
			return err
		}, http.StatusCreated},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newGenerationFixture(t)
			var edited Project
			router := NewRouter(f.store, generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
				if err := tc.mutate(f); err != nil {
					t.Fatal(err)
				}
				edited = loadTestProject(t, f)
				return []string{"生成一", "生成二", "生成三"}, nil
			}))
			assertStatus(t, performGeneration(router, f.path(f.story), `{}`), tc.status)
			actual := loadTestProject(t, f)
			if tc.status == http.StatusCreated {
				if len(actual.Nodes) != len(edited.Nodes)+3 || !reflect.DeepEqual(actual.Nodes[:len(edited.Nodes)], edited.Nodes) {
					t.Fatal("unrelated edit was lost during generation")
				}
			} else if !reflect.DeepEqual(actual, edited) {
				t.Fatal("stale generation overwrote the user's edit")
			}
		})
	}
}

func TestConcurrentGenerationOnlyCommitsOneBatch(t *testing.T) {
	f := newGenerationFixture(t)
	before := loadTestProject(t, f)
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	finish := sync.OnceFunc(func() { close(release) })
	defer finish()
	router := NewRouter(f.store, generatorFunc(func(ctx context.Context, _ GenerationInput) ([]string, error) {
		started <- struct{}{}
		select {
		case <-release:
			return []string{"生成一", "生成二", "生成三"}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}))
	responses := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() { responses <- performGeneration(router, f.path(f.story), `{}`) }()
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatal("generation blocked another request")
		}
	}
	finish()
	statuses := map[int]int{}
	for range 2 {
		select {
		case response := <-responses:
			statuses[response.Code]++
		case <-time.After(3 * time.Second):
			t.Fatal("concurrent generation did not finish")
		}
	}
	if statuses[http.StatusCreated] != 1 || statuses[http.StatusConflict] != 1 || len(loadTestProject(t, f).Nodes) != len(before.Nodes)+3 {
		t.Fatalf("concurrent requests did not commit exactly one batch: %v", statuses)
	}
}

func TestGenerationRollsBackWhenPersistenceFails(t *testing.T) {
	f := newGenerationFixture(t)
	before := loadTestProject(t, f)
	originalPath := f.store.path
	f.store.path = t.TempDir() // A directory cannot be replaced by the data file.
	router := NewRouter(f.store, generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
		return []string{"生成一", "生成二", "生成三"}, nil
	}))
	assertStatus(t, performGeneration(router, f.path(f.story), `{}`), http.StatusInternalServerError)
	if !reflect.DeepEqual(before, loadTestProject(t, f)) {
		t.Fatal("failed save left generated children in memory")
	}
	reopened, err := OpenStore(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	onDisk, err := reopened.Project(f.project.ID)
	if err != nil || !reflect.DeepEqual(before, onDisk) {
		t.Fatal("failed save changed original persisted data")
	}
}

func TestCanceledGenerationDoesNotWrite(t *testing.T) {
	f := newGenerationFixture(t)
	before := loadTestProject(t, f)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	router := NewRouter(f.store, generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
		cancel()
		return []string{"生成一", "生成二", "生成三"}, nil
	}))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, f.path(f.story), strings.NewReader(`{}`)).WithContext(ctx))
	assertStatus(t, response, http.StatusRequestTimeout)
	if !reflect.DeepEqual(before, loadTestProject(t, f)) {
		t.Fatal("canceled generation wrote children")
	}
}

func generatedTree(prefix string, count, descendantCount, depth int) []GeneratedNode {
	nodes := make([]GeneratedNode, count)
	for i := range nodes {
		name := prefix + string(rune('A'+i))
		nodes[i] = GeneratedNode{Name: name}
		if depth > 0 {
			nodes[i].Children = generatedTree(name+"-", descendantCount, descendantCount, depth-1)
		}
	}
	return nodes
}

func TestGenerateSubtreeFillsEveryLevelBelow(t *testing.T) {
	f := newGenerationFixture(t)
	before := loadTestProject(t, f)
	var gotInput GenerationInput
	generator := treeGeneratorFunc(func(_ context.Context, input GenerationInput) ([]GeneratedNode, error) {
		gotInput = input
		return generatedTree("节点", 2, 2, 2), nil
	})
	response := performGeneration(NewRouter(f.store, generator), f.path(f.role), `{"count":2,"descendantCount":2}`)
	assertStatus(t, response, http.StatusCreated)
	if gotInput.ChildKind != KindEpic || gotInput.Count != 2 || gotInput.DescendantCount != 2 ||
		!reflect.DeepEqual(gotInput.DescendantKinds, []NodeKind{KindStory, KindSubstory}) {
		t.Fatalf("unexpected subtree input: %#v", gotInput)
	}
	var result struct {
		ParentID string `json:"parentId"`
		Nodes    []Node `json:"nodes"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ParentID != f.role.ID || len(result.Nodes) != 2+4+8 {
		t.Fatalf("unexpected subtree result: %d nodes", len(result.Nodes))
	}
	byID := map[string]Node{f.role.ID: f.role}
	counts := map[NodeKind]int{}
	for _, node := range result.Nodes {
		parent, ok := byID[node.ParentID]
		if !ok || childKindOf[parent.Kind] != node.Kind {
			t.Fatalf("node %q appears before its parent or under the wrong level: %#v", node.Name, node)
		}
		byID[node.ID] = node
		counts[node.Kind]++
	}
	if counts[KindEpic] != 2 || counts[KindStory] != 4 || counts[KindSubstory] != 8 {
		t.Fatalf("unexpected level counts: %#v", counts)
	}
	persisted := loadTestProject(t, f)
	if !reflect.DeepEqual(persisted.Nodes, append(before.Nodes, result.Nodes...)) {
		t.Fatal("subtree was not appended in one save")
	}
}

func TestGenerateSubtreeRejectsMalformedTreesWithoutWrites(t *testing.T) {
	wrongDeepCount := generatedTree("节点", 2, 2, 2)
	wrongDeepCount[1].Children[0].Children = wrongDeepCount[1].Children[0].Children[:1]
	leafWithChildren := generatedTree("节点", 2, 2, 2)
	leafWithChildren[0].Children[0].Children[0].Children = []GeneratedNode{{Name: "太深"}}
	duplicateSiblings := generatedTree("节点", 2, 2, 2)
	duplicateSiblings[0].Children[1].Name = duplicateSiblings[0].Children[0].Name
	missingLevel := generatedTree("节点", 2, 2, 1)
	for name, tree := range map[string][]GeneratedNode{
		"wrong deep count":   wrongDeepCount,
		"leaf with children": leafWithChildren,
		"duplicate siblings": duplicateSiblings,
		"missing level":      missingLevel,
	} {
		t.Run(name, func(t *testing.T) {
			f := newGenerationFixture(t)
			before := loadTestProject(t, f)
			generator := treeGeneratorFunc(func(context.Context, GenerationInput) ([]GeneratedNode, error) { return tree, nil })
			response := performGeneration(NewRouter(f.store, generator), f.path(f.role), `{"count":2,"descendantCount":2}`)
			assertStatus(t, response, http.StatusBadGateway)
			if !reflect.DeepEqual(loadTestProject(t, f).Nodes, before.Nodes) {
				t.Fatal("malformed subtree was partially saved")
			}
		})
	}
}

func TestGenerateSubtreeAllowsSameNameUnderDifferentParents(t *testing.T) {
	f := newGenerationFixture(t)
	generator := treeGeneratorFunc(func(context.Context, GenerationInput) ([]GeneratedNode, error) {
		return []GeneratedNode{
			{Name: "撰写正文", Children: []GeneratedNode{{Name: "保存草稿"}}},
			{Name: "编辑旧文", Children: []GeneratedNode{{Name: "保存草稿"}}},
		}, nil
	})
	response := performGeneration(NewRouter(f.store, generator), f.path(f.epic), `{"count":2,"descendantCount":1}`)
	assertStatus(t, response, http.StatusCreated)
}

func TestGenerateSubtreeValidatesPlanBeforeCallingAI(t *testing.T) {
	f := newGenerationFixture(t)
	called := false
	generator := generatorFunc(func(context.Context, GenerationInput) ([]string, error) {
		called = true
		return nil, nil
	})
	router := NewRouter(f.store, generator)
	for _, test := range []struct {
		parent Node
		body   string
	}{
		{f.role, `{"descendantCount":0}`},
		{f.role, `{"descendantCount":6}`},
		{f.story, `{"descendantCount":2}`},
		{f.role, `{"count":10,"descendantCount":5}`},
		{f.role, `{"count":5,"descendantCount":4}`},
	} {
		assertStatus(t, performGeneration(router, f.path(test.parent), test.body), http.StatusBadRequest)
	}
	if called {
		t.Fatal("AI was called for an invalid subtree plan")
	}
	plan, err := generationSnapshot{ChildKind: KindEpic}.plan(4, 4)
	if err != nil || plan.total() != 4+16+64 {
		t.Fatalf("largest allowed plan rejected or miscounted: %#v %v", plan, err)
	}
}
