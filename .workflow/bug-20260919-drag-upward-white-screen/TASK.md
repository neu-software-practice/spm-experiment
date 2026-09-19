# Bug：下层节点向上拖拽后页面白屏

- ID / 状态：`BUG-DRAG-UP-WHITE-20260919` / `verified`
- 反馈来源与原文：用户于 2026-09-19 反馈：“将下方的模块向上方拖拽会导致整个页面白屏”。随后补充同级新增按钮不应常驻，只在鼠标悬停节点时向右展开；点击中间节点的加号时，新节点应处于当前节点与右侧节点之间。
- 预期行为 / 实际行为：下层节点拖向上方合法落点时应完成同层排序或调整父节点，页面保持可用；实际会触发前端运行时崩溃并白屏。同级新增按钮原本固定占据每组节点行末，未按当前操作节点显示。
- 复现步骤 / 环境：在已合并 `main`、React 19、`@dnd-kit/sortable` 10.0.0、Vite 8.3.0 环境，将二级故事向其用户故事父节点拖动；浏览器报 `Maximum update depth exceeded`，`#root` 被卸载。
- 范围与验收条件：修复所有合法向上拖拽白屏；非法落点安全忽略；轻微拖动不得误排序；不得回退吸附、连接线几何和不缩放修复；同级新增按钮默认隐藏，悬停节点时从右侧展开、沿用节点父级并紧跟当前节点插入；同步页面文档；前端测试/build/lint 与后端测试通过。
- 基线：`neu-software-practice/spm-experiment`，目标分支 `main`，基线 SHA `97d7e7ccce7d7d90f9337cd88f2e76e5795b7bd0`。
- 执行位置：修复分支 `fix/drag-upward-white-screen`；worktree `/Users/yym/Documents/Codex/botmux-workspace/.worktree/spm-bug-drag-up-white`；任务记录为本文件。
- 执行者 / 独立检查者：`/root/fix_drag_up_white`、`/root` / `/root/fix_drag_resize`。
- 根因与修复摘要：自定义碰撞检测保留 active 自身，并用随 transform 移动的实时卡片矩形覆盖其 droppable rect；向上重叠时 over 从 active 切换到父节点，两者 DOM 父级不同，导致 dnd-kit 的 `useScrollableAncestors` 与 `useRects` 反复测量并触发 React 最大更新深度。修复在测量前排除 active 自身，并根据分支位移反推出 active 初始卡片区域；卡片中心尚未离开该区域时返回空碰撞，避免最近节点 fallback 导致轻微拖动误排序；离开起始卡片后仍保留同类型与直接父类型落点。
- UI 补充：移除同级行末固定占位，把同级新增按钮绑定到各节点并以淡入、右移方式展开；鼠标悬停节点或键盘聚焦按钮时显示，触控设备常显。新增请求用 `afterId` 原子插入到当前节点之后。连接线终点改按最后一个真实节点判断。
- 验证：修复前真实浏览器路径 `substory -> story` 使 `#root` 清空、20 个拖拽手柄归零并抛出 `Maximum update depth exceeded`。修复后 Node 测试 18/18、frontend build/lint、backend `go test ./...` 与 diff-check 均通过；真实 Chromium 覆盖下层节点向上拖动、带两层后代的大分支 `epic -> role`、5px 近原地拖动、同级新增悬停及中间插入，结果页面根节点保持非空、节点数不变、近原地顺序不变、同一时刻仅当前悬停按钮显示、插入顺序正确且控制台无异常。
- 独立检查：首轮为 `FAIL`，发现 active 完全排除后 `closestCorners` 会在轻微拖动时误选最近兄弟；二轮为 `FAIL`，发现分支初始矩形包含后代，可能阻止大子树跨层拖拽；最终复审为 `PASS`，确认初始卡片反推、悬停新增、中间插入和连接线规则正确，全量检查通过。
- PR：待创建。
- 合并：待 PR review。
- 阻塞与后续动作：无；提交并创建 PR。
