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

func TestStoreReordersOnlySiblingsAndPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spm.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject("排序项目")
	if err != nil {
		t.Fatal(err)
	}
	role, _ := store.CreateNode(project.ID, KindRole, "", "用户")
	otherRole, _ := store.CreateNode(project.ID, KindRole, "", "管理员")
	first, _ := store.CreateNode(project.ID, KindEpic, role.ID, "第一个")
	second, _ := store.CreateNode(project.ID, KindEpic, role.ID, "第二个")
	other, _ := store.CreateNode(project.ID, KindEpic, otherRole.ID, "其他分组")

	if err := store.MoveNode(project.ID, second.ID, role.ID, []string{second.ID, first.ID}); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.Project(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var siblingIDs []string
	for _, node := range loaded.Nodes {
		if node.Kind == KindEpic && node.ParentID == role.ID {
			siblingIDs = append(siblingIDs, node.ID)
		}
	}
	if len(siblingIDs) != 2 || siblingIDs[0] != second.ID || siblingIDs[1] != first.ID {
		t.Fatalf("unexpected sibling order: %v", siblingIDs)
	}
	if err := reopened.MoveNode(project.ID, first.ID, role.ID, []string{first.ID, other.ID}); !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("got %v, want ErrInvalidOrder", err)
	}
}

func TestStoreCreatesNodeAfterSiblingAndPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spm.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	project, _ := store.CreateProject("中间插入")
	role, _ := store.CreateNode(project.ID, KindRole, "", "用户")
	otherRole, _ := store.CreateNode(project.ID, KindRole, "", "管理员")
	first, _ := store.CreateNode(project.ID, KindEpic, role.ID, "第一个")
	second, _ := store.CreateNode(project.ID, KindEpic, role.ID, "第二个")
	other, _ := store.CreateNode(project.ID, KindEpic, otherRole.ID, "其他分组")

	created, err := store.CreateNodeAfter(project.ID, KindEpic, role.ID, first.ID, "插入项")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateNodeAfter(project.ID, KindEpic, role.ID, other.ID, "错误锚点"); !errors.Is(err, ErrInvalidOrder) {
		t.Fatalf("got %v, want ErrInvalidOrder", err)
	}

	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := reopened.Project(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var siblingIDs []string
	for _, node := range loaded.Nodes {
		if node.Kind == KindEpic && node.ParentID == role.ID {
			siblingIDs = append(siblingIDs, node.ID)
		}
	}
	if len(siblingIDs) != 3 || siblingIDs[0] != first.ID || siblingIDs[1] != created.ID || siblingIDs[2] != second.ID {
		t.Fatalf("unexpected sibling order: %v", siblingIDs)
	}
}

func TestStoreMovesNodeAcrossParents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spm.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	project, err := store.CreateProject("跨父节点移动")
	if err != nil {
		t.Fatal(err)
	}
	firstRole, _ := store.CreateNode(project.ID, KindRole, "", "用户")
	secondRole, _ := store.CreateNode(project.ID, KindRole, "", "管理员")
	moving, _ := store.CreateNode(project.ID, KindEpic, firstRole.ID, "待移动")
	target, _ := store.CreateNode(project.ID, KindEpic, secondRole.ID, "目标节点")

	if err := store.MoveNode(project.ID, moving.ID, secondRole.ID, []string{target.ID, moving.ID}); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Project(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var targetIDs []string
	for _, node := range loaded.Nodes {
		if node.Kind == KindEpic && node.ParentID == secondRole.ID {
			targetIDs = append(targetIDs, node.ID)
		}
	}
	if len(targetIDs) != 2 || targetIDs[0] != target.ID || targetIDs[1] != moving.ID {
		t.Fatalf("unexpected target order: %v", targetIDs)
	}
	if err := store.MoveNode(project.ID, moving.ID, target.ID, []string{moving.ID}); !errors.Is(err, ErrInvalidParent) {
		t.Fatalf("got %v, want ErrInvalidParent", err)
	}
}
