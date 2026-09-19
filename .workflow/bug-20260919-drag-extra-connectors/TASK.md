# Bug：拖拽后出现多余分支线条

- ID / 状态：`BUG-DRAG-CONNECTORS-20260919` / `verified`
- 反馈来源与原文：用户于 2026-09-19 反馈：“目前拖拽模块后可能会产生多余的分支线条”。
- 预期行为 / 实际行为：节点完成拖拽后，树形连接线只表达当前父子关系且在稳定页面中可见；初始问题会出现多余线条，首轮修复又导致当前稳定页面完全没有连接线。
- 复现步骤 / 环境：待修复代理固定；重点覆盖同级排序、跨父节点移动，以及原父节点失去最后一个子节点的情况。环境为 React 19、`@dnd-kit/sortable` 10.0.0、Vite 8.3.0。
- 范围与验收条件：定位连接线与拖拽 transform/DOM 重排的根因；增加可重复验证；修复后连接线严格跟随当前树结构，不能在拖拽落位后残留或重复；不得回退快速新增、吸附、跨父节点移动和“不缩放”修复；前端构建与 lint、后端测试通过；同步页面文档。
- 基线：`neu-software-practice/spm-experiment`，父功能分支 `feat/frontend-quick-add-drag-snap`，基线 SHA `5e46818`；关联 PR `#1`。
- 执行位置：修复分支 `fix/drag-extra-connectors`；worktree `/Users/yym/Documents/Codex/botmux-workspace/.worktree/spm-bug-drag-connectors`；任务记录为本文件。
- 执行者 / 独立检查者：`/root/fix_drag_connectors` / `/root/fix_drag_resize`。
- 根因与修复摘要：其一，dnd-kit transform/transition 直接作用于 `.map-branch`，把入线伪元素和后代连接线一起位移，与父级静态横线叠加；其二，父级横线使用固定右边界，最后一个子分支因后代变宽时会越过该子节点中心。修复把拖拽位移放到内层 `.branch-visual`，连接线保留在稳定外壳，并改为分段连接相邻节点中心。用户验收又发现稳定页面无连接线，进一步定位为 transition 在 transform 为空时仍可能存在，旧判断把所有分支永久标为变换中；返修改为仅在真实 transform 非空时隐藏连接线。
- 验证：初始连接线结构测试 3/3 红灯，落位 transition 断言也红灯；稳定可见性返修前测试红灯。最新前端原生 Node 测试 7/7、`corepack pnpm build`、`corepack pnpm lint`、`go test ./...`、`git diff --check` 均退出 0，lint 仅 3 条既有警告；将 helper 变异回 `transform || transition` 时 2/2 可见性用例失败。
- PR：关联现有 PR `https://github.com/neu-software-practice/spm-experiment/pull/1`；连接线结构修复提交 `083572b`，稳定可见性返修提交 `aa69f4e`，待推送 PR 最新 head。
- 审核：首次独立检查由 `/root/fix_drag_resize` 给出 `FAIL`：实现逻辑通过，但 CSS 回归断言过宽。收紧测试后第二轮独立检查 `PASS`。用户随后发现稳定页面连接线全隐藏，PR review 中止；仅按真实 transform 判断的返修经第三轮独立检查 `PASS`。PR 最新 head review 待返修推送后执行。
- 合并：待审核。
- 阻塞与后续动作：无；返修已恢复稳定状态连接线，并补 transition-only 可见性回归。待推送后重新执行 PR 最新 head review。
