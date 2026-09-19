# Bug：拖拽节点时模块偶发变大

- ID / 状态：`BUG-DRAG-RESIZE-20260919` / `verified`
- 反馈来源与原文：用户于 2026-09-19 反馈：“目前版本拖拽模块时有概率出现模块突然变大的bug，查找根因并修复”。
- 预期行为 / 实际行为：拖拽期间节点及其分支只能平移并保持原尺寸；实际在不同尺寸分支之间拖拽时，模块偶发被放大。
- 复现步骤 / 环境：拖动拥有不同后代数量、外框尺寸不同的分支节点；dnd-kit 在索引和测量尺寸变化时会产生非 1 的 `scaleX/scaleY`。环境为 React 19、`@dnd-kit/sortable` 10.0.0、Vite 8.3.0。
- 范围与验收条件：修复 `frontend` 拖拽视觉变形；用回归测试证明 dnd-kit 返回非 1 缩放值时渲染 transform 仍仅含平移；前端构建与 lint、后端回归测试通过；不改变既有排序和跨父节点移动语义；同步页面文档。
- 基线：`neu-software-practice/spm-experiment`，父功能分支 `feat/frontend-quick-add-drag-snap`，基线 SHA `483028c523603d32cce0153e9eae0c854f4cb734`；关联 PR `#1`。
- 执行位置：修复分支 `fix/drag-node-resize`；worktree `/Users/yym/Documents/Codex/botmux-workspace/.worktree/spm-bug-drag-resize`；任务记录为本文件。
- 执行者 / 独立检查者：`/root/fix_drag_resize` / `/root/pr1_review`。
- 根因与修复摘要：`useDerivedTransform` 会按旧/新节点矩形宽高比生成 `scaleX/scaleY`；页面对包含整棵子树、尺寸不一的 `.map-branch` 使用 `CSS.Transform.toString`，从而把缩放应用到整个分支。修复把序列化逻辑抽为 `sortableTransformToString`，仅使用 `CSS.Translate.toString` 保留平移并丢弃缩放。
- 验证：红灯时回归测试实际得到 `translate3d(...) scaleX(1.75) scaleY(0.6)`；修复后 `node --test --experimental-strip-types src/sortable-transform.test.ts` 通过（1/1），`corepack pnpm build`、`corepack pnpm lint`、`go test ./...` 与 `git diff --check` 均退出 0；lint 保留 3 条既有警告。
- PR：关联现有 PR `https://github.com/neu-software-practice/spm-experiment/pull/1`；修复实现提交 `5e46818`，待推送 PR 最新 head。
- 审核：独立 Bug 检查由 `/root/pr1_review` 完成，结论 `PASS`；PR 最新 head review 待推送后重新执行。
- 合并：待审核。
- 阻塞与后续动作：无；先隔离复现和修复。
