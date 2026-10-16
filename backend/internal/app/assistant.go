package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	// Model calls per turn; each call may run several tools.
	maxAssistantSteps = 12
	maxAssistantInput = 4000
	// History beyond this many messages is dropped from the oldest user turn.
	maxAssistantHistory = 80
)

var kindLabels = map[NodeKind]string{KindRole: "角色", KindEpic: "史诗", KindStory: "用户故事", KindSubstory: "二级故事"}

var ErrInvalidHistory = errors.New("invalid conversation history")

const assistantInstruction = `你是「用户故事地图」规划助手，和用户在多轮对话中一起探讨产品叙事，并通过工具直接生成、修改、打磨项目地图。

地图固定四层：角色 role → 史诗 epic（角色要达成的主要活动）→ 用户故事 story（完成史诗的具体任务）→ 二级故事 substory（用户故事的细化步骤）。同一层从左到右体现叙事顺序。

工作方式：
- 先理解意图。需求模糊时先给出简短思路或提 1–3 个关键问题；用户意图明确时直接动手。
- 要改地图就调用工具，改动会立即保存并实时展示给用户；不要只在文字里描述改动。
- 删除节点或大范围重组前，先说明影响并征得同意，除非用户已明确要求。
- 节点名称简洁具体（1–80 字），同一父节点下不重名，与项目语言一致，默认中文；用户故事用用户视角的动宾短语。
- add_nodes 可一次传入嵌套的多层节点，单次最多 100 个；规模更大时分批调用。
- 工具返回失败时，根据错误信息修正后重试，不要重复同样的错误。
- 改完后用一两句话总结做了什么，必要时给出下一步建议。回复显示在窄侧边栏里：使用简洁的 Markdown，优先短段落和列表，不要用表格，也不要把整张地图复述一遍（用户能直接看到地图）。
- 节点 ID 只用于调用工具，不要展示给用户。用户提到的节点名称不唯一时，结合上下文判断或先确认。

当前项目：%s
本轮开始时的地图（之后的改动以工具结果为准，必要时用 view_map 重新查看）：
%s`

// Assistant runs one conversational turn: it streams model output, executes
// the tools the model calls against the store, and repeats until the model
// answers without tools.
type Assistant struct {
	store *Store
	model ChatModel
}

// AssistantEvent is one server-sent event of a turn.
type AssistantEvent struct {
	Name string
	Data any
}

type toolOutcome struct {
	result     string
	ok         bool
	summary    string
	errMessage string
	changedIDs []string
	changed    bool
}

func renderMap(nodes []Node) string {
	if len(nodes) == 0 {
		return "（地图为空）"
	}
	var builder strings.Builder
	var walk func(parentID string, depth int)
	seen := map[string]bool{}
	walk = func(parentID string, depth int) {
		for _, node := range nodes {
			if node.ParentID != parentID || seen[node.ID] {
				continue
			}
			seen[node.ID] = true
			fmt.Fprintf(&builder, "%s- [%s] %s (id: %s)\n", strings.Repeat("  ", depth), kindLabels[node.Kind], node.Name, node.ID)
			walk(node.ID, depth+1)
		}
	}
	walk("", 0)
	return strings.TrimRight(builder.String(), "\n")
}

func nodeTreeSchema(depth int) map[string]any {
	properties := map[string]any{"name": map[string]any{"type": "string", "description": "节点名称，1–80 字"}}
	if depth > 1 {
		properties["children"] = map[string]any{
			"type":        "array",
			"description": "下一层子节点，可省略",
			"items":       nodeTreeSchema(depth - 1),
		}
	}
	return map[string]any{"type": "object", "properties": properties, "required": []string{"name"}}
}

var assistantTools = []ToolSpec{
	{
		Name:        "view_map",
		Description: "查看当前项目的完整地图（含节点 ID）。多次修改后需要确认最新结构时使用。",
		Parameters:  map[string]any{"type": "object", "properties": map[string]any{}},
	},
	{
		Name:        "add_nodes",
		Description: "在父节点下追加节点，可嵌套多层一次生成。层级由深度决定：父节点为角色时第一层是史诗，依此类推；新增角色时 parentId 传空字符串。新节点排在已有子节点之后。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"parentId": map[string]any{"type": "string", "description": "父节点 ID；新增角色时为空字符串"},
				"nodes":    map[string]any{"type": "array", "items": nodeTreeSchema(4), "description": "要新增的节点"},
			},
			"required": []string{"parentId", "nodes"},
		},
	},
	{
		Name:        "rename_node",
		Description: "修改一个节点的名称。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId": map[string]any{"type": "string"},
				"name":   map[string]any{"type": "string", "description": "新名称，1–80 字"},
			},
			"required": []string{"nodeId", "name"},
		},
	},
	{
		Name:        "delete_nodes",
		Description: "删除节点及其全部下级节点。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			},
			"required": []string{"nodeIds"},
		},
	},
	{
		Name:        "move_node",
		Description: "调整节点顺序，或把节点（连同下级）移到同层级的另一个父节点下。",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"nodeId":   map[string]any{"type": "string"},
				"parentId": map[string]any{"type": "string", "description": "目标父节点 ID；省略则保持原父节点，角色传空字符串"},
				"position": map[string]any{"type": "integer", "description": "在目标父节点子节点中的位置，从 0 开始；省略则放到最后"},
			},
			"required": []string{"nodeId"},
		},
	},
}

// validateHistory checks the client-kept transcript has the shape providers
// require: tool results answer the assistant tool calls right before them.
func validateHistory(history []ChatMessage) error {
	pending := map[string]bool{}
	for _, message := range history {
		switch message.Role {
		case "user":
			if len(pending) > 0 || message.Content == "" {
				return ErrInvalidHistory
			}
		case "assistant":
			if len(pending) > 0 {
				return ErrInvalidHistory
			}
			for _, call := range message.ToolCalls {
				if call.ID == "" || call.Function.Name == "" || pending[call.ID] {
					return ErrInvalidHistory
				}
				pending[call.ID] = true
			}
		case "tool":
			if !pending[message.ToolCallID] {
				return ErrInvalidHistory
			}
			delete(pending, message.ToolCallID)
		default:
			return ErrInvalidHistory
		}
	}
	if len(pending) > 0 {
		return ErrInvalidHistory
	}
	return nil
}

// trimHistory keeps the most recent messages, starting at a user message so
// no tool result loses its call.
func trimHistory(history []ChatMessage) []ChatMessage {
	if len(history) <= maxAssistantHistory {
		return history
	}
	for start := len(history) - maxAssistantHistory; start < len(history); start++ {
		if history[start].Role == "user" {
			return history[start:]
		}
	}
	return nil
}

// RunTurn answers input and returns the messages this turn added. On error the
// returned messages still end on a complete step, so the client can keep them.
func (a *Assistant) RunTurn(ctx context.Context, projectID string, history []ChatMessage, input string, emit func(AssistantEvent)) ([]ChatMessage, error) {
	project, err := a.store.Project(projectID)
	if err != nil {
		return nil, err
	}
	system := ChatMessage{Role: "system", Content: fmt.Sprintf(assistantInstruction, project.Name, renderMap(project.Nodes))}
	turn := []ChatMessage{{Role: "user", Content: input}}
	conversation := append(append([]ChatMessage{system}, trimHistory(history)...), turn...)

	for step := 0; step < maxAssistantSteps; step++ {
		reply, err := a.model.StreamChat(ctx, conversation, assistantTools, func(delta StreamDelta) {
			switch {
			case delta.Reasoning != "":
				emit(AssistantEvent{"reasoning", map[string]string{"text": delta.Reasoning}})
			case delta.Content != "":
				emit(AssistantEvent{"text", map[string]string{"text": delta.Content}})
			case delta.ToolName != "":
				emit(AssistantEvent{"tool_pending", map[string]any{"key": toolKey(step, delta.ToolIndex), "name": delta.ToolName}})
			case delta.Retry > 0:
				emit(AssistantEvent{"retry", map[string]int{"attempt": delta.Retry}})
			}
		})
		if err != nil {
			return turn, err
		}
		message := ChatMessage{Role: "assistant", Content: reply.Content, ToolCalls: reply.ToolCalls}
		if len(reply.ToolCalls) == 0 {
			if reply.FinishReason == "length" {
				emit(AssistantEvent{"text", map[string]string{"text": "\n\n（回复过长被截断，可以让我继续。）"}})
			}
			turn = append(turn, message)
			return turn, nil
		}
		results := make([]ChatMessage, 0, len(reply.ToolCalls))
		for index, call := range reply.ToolCalls {
			key := toolKey(step, index)
			emit(AssistantEvent{"tool_start", map[string]any{"key": key, "name": call.Function.Name, "args": rawArgs(call.Function.Arguments)}})
			outcome := a.runTool(projectID, call)
			emit(AssistantEvent{"tool_end", map[string]any{
				"key": key, "name": call.Function.Name, "ok": outcome.ok, "summary": outcome.summary,
				"error": outcome.errMessage, "changedIds": outcome.changedIDs,
			}})
			if outcome.changed {
				if current, err := a.store.Project(projectID); err == nil {
					emit(AssistantEvent{"project", current})
				}
			}
			results = append(results, ChatMessage{Role: "tool", ToolCallID: call.ID, Content: outcome.result})
		}
		conversation = append(append(conversation, message), results...)
		turn = append(append(turn, message), results...)
		if err := ctx.Err(); err != nil {
			return turn, err
		}
	}
	note := "本轮工具调用次数已达上限，回复「继续」我会接着完成。"
	emit(AssistantEvent{"text", map[string]string{"text": note}})
	return append(turn, ChatMessage{Role: "assistant", Content: note}), nil
}

func toolKey(step, index int) string { return fmt.Sprintf("%d-%d", step, index) }

// rawArgs passes valid JSON arguments through for display and drops the rest.
func rawArgs(arguments string) json.RawMessage {
	if json.Valid([]byte(arguments)) {
		return json.RawMessage(arguments)
	}
	return json.RawMessage("null")
}

func toolFailure(message string) toolOutcome {
	result, _ := json.Marshal(map[string]any{"ok": false, "error": message})
	return toolOutcome{result: string(result), errMessage: message}
}

func toolSuccess(summary string, payload map[string]any, changedIDs []string, changed bool) toolOutcome {
	payload["ok"] = true
	result, _ := json.Marshal(payload)
	return toolOutcome{result: string(result), ok: true, summary: summary, changedIDs: changedIDs, changed: changed}
}

func (a *Assistant) runTool(projectID string, call ToolCall) toolOutcome {
	arguments := call.Function.Arguments
	if strings.TrimSpace(arguments) == "" {
		arguments = "{}"
	}
	decode := func(target any) error {
		if err := json.Unmarshal([]byte(arguments), target); err != nil {
			return errors.New("参数不是有效的 JSON：" + err.Error())
		}
		return nil
	}
	project, err := a.store.Project(projectID)
	if err != nil {
		return toolFailure("项目不存在")
	}
	names := map[string]Node{}
	for _, node := range project.Nodes {
		names[node.ID] = node
	}

	switch call.Function.Name {
	case "view_map":
		return toolSuccess(fmt.Sprintf("查看了地图（%d 个节点）", len(project.Nodes)), map[string]any{"map": renderMap(project.Nodes)}, nil, false)

	case "add_nodes":
		var args struct {
			ParentID string    `json:"parentId"`
			Nodes    []NewNode `json:"nodes"`
		}
		if err := decode(&args); err != nil {
			return toolFailure(err.Error())
		}
		created, err := a.store.AppendTree(projectID, args.ParentID, args.Nodes)
		if err != nil {
			return toolFailure(storeErrorText(err))
		}
		where := "项目"
		if parent, ok := names[args.ParentID]; ok {
			where = "「" + parent.Name + "」"
		}
		ids := make([]string, len(created))
		for i, node := range created {
			ids[i] = node.ID
		}
		return toolSuccess(
			fmt.Sprintf("在%s下新增 %s", where, countByKind(created)),
			map[string]any{"created": renderMap(rebase(created, args.ParentID))},
			ids, true,
		)

	case "rename_node":
		var args struct {
			NodeID string `json:"nodeId"`
			Name   string `json:"name"`
		}
		if err := decode(&args); err != nil {
			return toolFailure(err.Error())
		}
		before, ok := names[args.NodeID]
		if !ok {
			return toolFailure("节点不存在：" + args.NodeID)
		}
		name, err := cleanNodeName(args.Name)
		if err != nil {
			return toolFailure(storeErrorText(err))
		}
		for _, node := range project.Nodes {
			if node.ID != before.ID && node.ParentID == before.ParentID && node.Kind == before.Kind && strings.EqualFold(node.Name, name) {
				return toolFailure("同一父节点下已有同名节点：" + name)
			}
		}
		renamed, err := a.store.RenameNode(projectID, args.NodeID, name)
		if err != nil {
			return toolFailure(storeErrorText(err))
		}
		return toolSuccess(fmt.Sprintf("「%s」改为「%s」", before.Name, renamed.Name), map[string]any{"node": renamed}, []string{renamed.ID}, true)

	case "delete_nodes":
		var args struct {
			NodeIDs []string `json:"nodeIds"`
		}
		if err := decode(&args); err != nil {
			return toolFailure(err.Error())
		}
		if len(args.NodeIDs) == 0 {
			return toolFailure("nodeIds 不能为空")
		}
		for _, id := range args.NodeIDs {
			if _, ok := names[id]; !ok {
				return toolFailure("节点不存在：" + id)
			}
		}
		before := len(project.Nodes)
		var deleted []string
		for _, id := range args.NodeIDs {
			// An earlier delete may already have removed it as a descendant.
			if err := a.store.DeleteNode(projectID, id); err != nil && !errors.Is(err, ErrNotFound) {
				return toolFailure(storeErrorText(err))
			}
			deleted = append(deleted, "「"+names[id].Name+"」")
		}
		after, _ := a.store.Project(projectID)
		removed := before - len(after.Nodes)
		return toolSuccess(
			fmt.Sprintf("删除%s，共 %d 个节点（含下级）", strings.Join(deleted, "、"), removed),
			map[string]any{"removed": removed}, nil, true,
		)

	case "move_node":
		var args struct {
			NodeID   string  `json:"nodeId"`
			ParentID *string `json:"parentId"`
			Position *int    `json:"position"`
		}
		if err := decode(&args); err != nil {
			return toolFailure(err.Error())
		}
		moving, ok := names[args.NodeID]
		if !ok {
			return toolFailure("节点不存在：" + args.NodeID)
		}
		parentID := moving.ParentID
		if args.ParentID != nil {
			parentID = *args.ParentID
		}
		var order []string
		for _, node := range project.Nodes {
			if node.ParentID == parentID && node.Kind == moving.Kind && node.ID != moving.ID {
				order = append(order, node.ID)
			}
		}
		position := len(order)
		if args.Position != nil {
			position = min(max(*args.Position, 0), len(order))
		}
		order = append(order[:position], append([]string{moving.ID}, order[position:]...)...)
		if err := a.store.MoveNode(projectID, moving.ID, parentID, order); err != nil {
			if errors.Is(err, ErrInvalidParent) {
				return toolFailure(fmt.Sprintf("「%s」是%s，目标父节点必须是%s", moving.Name, kindLabels[moving.Kind], parentLabel(moving.Kind)))
			}
			return toolFailure(storeErrorText(err))
		}
		where := "原父节点"
		if parent, ok := names[parentID]; ok {
			where = "「" + parent.Name + "」"
		} else if parentID == "" {
			where = "项目"
		}
		return toolSuccess(fmt.Sprintf("「%s」移到%s下第 %d 位", moving.Name, where, position+1), map[string]any{"position": position}, []string{moving.ID}, true)
	}
	return toolFailure("未知工具：" + call.Function.Name)
}

func parentLabel(kind NodeKind) string {
	for parent, child := range childKindOf {
		if child == kind {
			return kindLabels[parent]
		}
	}
	return "空（顶层）"
}

// rebase renders created nodes as their own small map under parentID.
func rebase(nodes []Node, parentID string) []Node {
	out := make([]Node, len(nodes))
	for i, node := range nodes {
		if node.ParentID == parentID {
			node.ParentID = ""
		}
		out[i] = node
	}
	return out
}

func countByKind(nodes []Node) string {
	var parts []string
	for _, kind := range []NodeKind{KindRole, KindEpic, KindStory, KindSubstory} {
		count := 0
		for _, node := range nodes {
			if node.Kind == kind {
				count++
			}
		}
		if count > 0 {
			parts = append(parts, fmt.Sprintf("%d 个%s", count, kindLabels[kind]))
		}
	}
	return strings.Join(parts, "、")
}

func storeErrorText(err error) string {
	switch {
	case errors.Is(err, ErrNotFound):
		return "节点不存在，请用 view_map 确认 ID"
	case errors.Is(err, ErrDuplicateName):
		return "同一父节点下名称重复：" + strings.TrimPrefix(err.Error(), ErrDuplicateName.Error()+": ")
	case errors.Is(err, ErrNameTooLong):
		return "名称超过 80 字"
	case errors.Is(err, ErrInvalidName):
		return "名称不能为空，且不能包含控制字符"
	case errors.Is(err, ErrTooDeep):
		return "二级故事是最末层级，不能再有下级"
	case errors.Is(err, ErrTooManyNodes):
		return fmt.Sprintf("单次最多新增 %d 个节点，请分批", maxTreeAppend)
	case errors.Is(err, ErrInvalidParent):
		return "父节点层级不匹配"
	case errors.Is(err, ErrInvalidOrder):
		return "节点顺序无效"
	}
	return "保存失败"
}

func validAssistantInput(input string) bool {
	return input != "" && utf8.ValidString(input) && utf8.RuneCountInString(input) <= maxAssistantInput
}
