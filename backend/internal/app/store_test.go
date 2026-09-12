package app

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestStorePersistsAndCascadesNodes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spm.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject("测试项目")
	if err != nil {
		t.Fatal(err)
	}
	role, err := store.CreateNode(project.ID, KindRole, "", "用户")
	if err != nil {
		t.Fatal(err)
	}
	epic, err := store.CreateNode(project.ID, KindEpic, role.ID, "登录")
	if err != nil {
		t.Fatal(err)
	}
	story, err := store.CreateNode(project.ID, KindStory, epic.ID, "填写账号")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateNode(project.ID, KindSubstory, story.ID, "输入邮箱"); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := reopened.Project(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(persisted.Nodes) != 4 {
		t.Fatalf("got %d nodes, want 4", len(persisted.Nodes))
	}
	if err := reopened.DeleteNode(project.ID, epic.ID); err != nil {
		t.Fatal(err)
	}
	persisted, _ = reopened.Project(project.ID)
	if len(persisted.Nodes) != 1 || persisted.Nodes[0].ID != role.ID {
		t.Fatalf("cascade left unexpected nodes: %#v", persisted.Nodes)
	}
}

func TestStoreRejectsInvalidHierarchy(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "spm.json"))
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject("测试项目")
	if err != nil {
		t.Fatal(err)
	}
	role, err := store.CreateNode(project.ID, KindRole, "", "用户")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateNode(project.ID, KindStory, role.ID, "错误层级"); !errors.Is(err, ErrInvalidParent) {
		t.Fatalf("got %v, want ErrInvalidParent", err)
	}
}

func TestEmptyProjectReturnsEmptyNodeList(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "spm.json"))
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject("空项目")
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Project(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Nodes == nil {
		t.Fatal("empty project nodes must be an empty slice, not nil")
	}
}
