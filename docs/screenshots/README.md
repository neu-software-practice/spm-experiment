# 开发环境部署与前端验收报告（2026-10-02）

## 环境

| 组件 | 版本 / 命令 | 地址 |
| --- | --- | --- |
| 后端 | Go 1.26.5（`go.mod` 要求，由 `GOTOOLCHAIN=auto` 自动下载），`go run ./cmd/server` | `http://localhost:8080` |
| 前端 | Node 22.22 + pnpm 10.33，`corepack pnpm install --frozen-lockfile && corepack pnpm dev` | `http://localhost:5173`（`/api` 代理到 8080） |
| 浏览器 | Playwright 1.56 + Chromium（headless），桌面 1440×900，移动端 390×844 @2x | — |

## 自动化测试

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端单元测试 | `cd backend && go test ./...` | 6/6 通过 |
| 前端单元测试 | `cd frontend && node --test --experimental-strip-types src/*.test.ts` | 21/21 通过 |
| 前端构建 | `corepack pnpm build` | 通过（主 chunk 716 kB，有 >500 kB 体积提示） |
| 前端 Lint | `corepack pnpm lint` | 0 错误，3 条既有警告 |

## 浏览器端到端走查（17/17 通过）

默认项目加载 · 新建项目 · 空角色状态 · 新建角色 · 通过“新增子节点”逐层新增史诗/用户故事/二级故事 · 17 个节点渲染 · 悬停显示同级新增按钮 · 编辑面板重命名节点 · 删除节点（二次确认） · 项目菜单重命名项目 · 同级拖拽排序（结果已由后端持久化） · 侧栏切换项目 · 请求失败错误提示 · 加载骨架屏 · 窄屏布局与滑出导航 · 无项目空状态。

控制台仅有 Fluent UI 在 React StrictMode 开发模式下的 `Keyborg instance ... disposed incorrectly` 警告，以及故意模拟的 500 请求，无页面异常。

## 截图

| 文件 | 界面 |
| --- | --- |
| `00-default-project.png` | 默认项目（种子数据）故事地图 |
| `01-create-project-dialog.png` | 新建项目对话框 |
| `02-empty-project.png` | 空项目（暂无角色） |
| `03-create-role-dialog.png` | 新增角色对话框 |
| `04-story-map.png` | 完整四层故事地图 |
| `05-node-hover-sibling-add.png` | 悬停节点显示同级新增按钮 |
| `06-node-edit-drawer.png` | 节点编辑抽屉 |
| `07-node-delete-confirm.png` | 删除确认 |
| `08-project-menu.png` | 项目操作菜单 |
| `09-rename-project-dialog.png` | 重命名项目 |
| `10-dragging-node.png` | 拖拽中（受影响连线为虚线） |
| `11-error-message.png` | 请求失败提示 |
| `12-loading-skeleton.png` | 加载骨架屏 |
| `13-mobile-story-map.png` | 移动端故事地图 |
| `14-mobile-sidebar.png` | 移动端项目导航 |
| `15-no-projects.png` | 无项目空状态 |
| `bug-drag-reparent.png` | 问题 1 复现：拖拽时节点不跟随指针 |

## 发现的问题（未修改代码）

1. **拖拽向左越过宽分支时节点被错误移到相邻角色下**（`frontend/src/App.tsx` 的 `snapToNodeCollision`）
   - 复现：R1 下有史诗 A（含 3 个用户故事）和 B，R2 下有史诗 C；拖动 B 到 A 的位置。
   - 实际：B 不跟随指针、停在原处，C 被高亮；松手后 B 变成 R2 的第一个史诗，而不是排到 A 前面。A 子树较窄时同样的操作正常。
   - 根因：同类节点按卡片中心的水平距离取最近目标，刚开始拖动时右侧相邻的 C（另一父节点）比 A 更近。`over` 变成其他 SortableContext 中的节点后，`horizontalListSortingStrategy` 不再给拖拽源 transform，卡片 DOM 位置回到原处，碰撞检测读取的 `activeCardRect` 也随之不动，于是会一直命中 C。
2. **打开对话框或抽屉时整个页面变成纯灰色**（`frontend/src/App.css:1`）
   - Fluent UI v9 会把 `FluentProvider` 的 `className` 复制到 Portal 挂载节点上，`.fluent-root { min-height: 100vh }` 让 Portal 变成覆盖整个视口的不透明白色层，遮罩下看不到页面内容（见 03、06、07、09 截图）。失败提示会被同一层挡住，对话框关闭后才能看到。
   - 建议：把该样式改到 `.app-shell` 上，或用 `.fluent-root:not([data-portal-node])` 限定。
3. **侧栏中有大块空白**（`App.tsx` 中侧栏的 Fluent `Divider`）
   - Fluent `Divider` 默认带 `flex-grow: 1`，在纵向 flex 布局的侧栏里被拉伸到约 340px，把项目列表挤到侧栏中部（桌面端和移动端都会出现）。
   - 建议：给该 Divider 加上 `flex: none`。
