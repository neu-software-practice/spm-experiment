# Bug：拖拽后出现多余分支线条

- ID / 状态：`BUG-DRAG-CONNECTORS-20260919` / `verified`
- 反馈来源与原文：用户于 2026-09-19 反馈：“目前拖拽模块后可能会产生多余的分支线条”。
- 预期行为 / 实际行为：节点完成拖拽后，树形连接线只表达当前父子关系；实际可能出现不属于当前树结构的多余线条。
- 复现步骤 / 环境：待修复代理固定；重点覆盖同级排序、跨父节点移动，以及原父节点失去最后一个子节点的情况。环境为 React 19、`@dnd-kit/sortable` 10.0.0、Vite 8.3.0。
- 范围与验收条件：定位连接线与拖拽 transform/DOM 重排的根因；增加可重复验证；修复后连接线严格跟随当前树结构，不能在拖拽落位后残留或重复；不得回退快速新增、吸附、跨父节点移动和“不缩放”修复；前端构建与 lint、后端测试通过；同步页面文档。
- 基线：`neu-software-practice/spm-experiment`，父功能分支 `feat/frontend-quick-add-drag-snap`，基线 SHA `5e46818`；关联 PR `#1`。
- 执行位置：修复分支 `fix/drag-extra-connectors`；worktree `/Users/yym/Documents/Codex/botmux-workspace/.worktree/spm-bug-drag-connectors`；任务记录为本文件。
- 执行者 / 独立检查者：`/root/fix_drag_connectors` / `/root/fix_drag_resize`。
- 根因与修复摘要：其一，dnd-kit transform/transition 直接作用于 `.map-branch`，把入线伪元素和后代连接线一起位移，与父级静态横线叠加；其二，父级横线使用固定右边界，最后一个子分支因后代变宽时会越过该子节点中心。修复把拖拽位移放到内层 `.branch-visual`，连接线保留在稳定外壳，并改为分段连接相邻节点中心；变换期间暂时隐藏受影响连接线，稳定后恢复。
- 验证：修复前连接线结构测试 3/3 失败，补充落位 transition 断言后同样红灯；修复后前端原生 Node 测试 4/4、`corepack pnpm build`、`corepack pnpm lint`、`go test ./...`、`git diff --check` 均退出 0，lint 仅 3 条既有警告。
- PR：关联现有 PR `https://github.com/neu-software-practice/spm-experiment/pull/1`；修复实现提交 `083572b`，待推送 PR 最新 head。
- 审核：首次独立检查由 `/root/fix_drag_resize` 给出 `FAIL`：实现逻辑通过，但 CSS 回归断言过宽。修复者收紧规则块断言，并用移除 class 接线、移除隐藏 selector、改错横线宽度三种变异确认测试均红灯；第二轮独立检查 `PASS`。PR 最新 head review 待推送后执行。
- 合并：待审核。
- 阻塞与后续动作：无；先隔离复现和修复。
