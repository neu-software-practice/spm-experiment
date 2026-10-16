# 用户故事地图页面

## 页面概览

- 页面名称：用户故事地图
- 页面用途：管理项目，并按角色、史诗、用户故事、二级故事四层结构规划与排序需求。
- 路由：`/`
- 页面入口文件：`frontend/src/App.tsx`（组件位于 `frontend/src/components/`）
- 文档维护范围：项目侧栏、故事地图、节点新增/编辑/删除/拖拽及相关页面状态。

## 页面布局

1. **项目侧栏**：采用 Windows 11 风格的不透明导航面板（窄屏滑出时不透出背后的地图），项目列表紧接品牌区展示全部项目、当前项目、自动保存状态和新建项目入口；窄屏时收起为带遮罩的滑出导航。
2. **页面命令栏**：展示当前项目名称、页面类型、新增角色主操作和项目菜单；窄屏增加项目导航按钮。
3. **故事地图**：左侧固定显示四个层级标签（带类型图标与色条），右侧按树状关系横向展开节点；节点使用 Fluent 卡片，卡片内只显示标题，层级通过顶部分层色带和左侧层级标签区分，不再显示拖拽图标和类型徽标。四个层级各有专属图标与颜色：角色（人物，蓝）、史诗（旗帜，绿）、用户故事（书本，紫）、二级故事（任务清单，橙），色带、层级标签、选中描边、编辑面板中的类型徽标以及创建该层级的加号均使用同一颜色；AI 相关入口统一使用紫红色闪光图标。节点标题过长时最多显示三行并以省略号截断；每个有下一级的节点在卡片底边中央、出线连接处提供新增子节点按钮，悬停节点时在其右侧展开同级新增按钮。
4. **节点编辑面板**：点击节点后打开 Fluent 右侧抽屉，可修改名称、查看归属、AI 生成子节点或删除节点。
5. **对话框与反馈**：使用 Fluent 对话框、表单、菜单、加载骨架和消息条处理新增、重命名、删除、加载与失败反馈；对话框和抽屉打开时，背后的页面在半透明遮罩下仍然可见。由某个节点或同级行发起新增时，父节点由当前上下文确定，不再要求重复选择。

地图区域支持横向和纵向滚动。窄屏保留四层结构和快速新增入口，通过滚动查看超出视口的内容。

## 用户流程与交互

- 进入页面：加载项目列表，优先恢复上次查看的项目，否则打开第一个项目。
- 新建项目：从侧栏、空状态或顶部入口打开新建弹窗，填写名称后创建并自动切换到新项目。
- 新增角色：从头部、空状态或任一角色节点右侧展开的同级加号打开弹窗。
- 新增子节点：点击节点下方加号，直接以该节点为父节点创建下一层内容；弹窗只要求填写名称。悬停加号时页面保持稳定并显示浏览器提示。
- 新增同级节点：悬停任一节点后，点击其右侧展开的加号，沿用该节点所属父节点，并紧跟当前节点插入同层内容；若右侧已有节点，新节点位于两者之间。键盘可直接聚焦该按钮，角色行无需父节点；悬停时页面保持稳定并显示浏览器提示。
- AI 生成子节点：后端已配置 AI 时，悬停有下一级的节点，在新增子节点按钮右侧出现 AI 按钮；也可在新增子节点弹窗中切换到「AI 生成」页签，或在编辑面板的「AI 生成」区域进入。填写生成数量（1–10，默认 3）和可选的附加提示词（最多 2000 字符）后生成，结果直接保存并追加到该父节点已有子节点末尾，新节点短暂高亮，并提示新增数量。生成期间可点「取消生成」或关闭弹窗中止请求，页面随后重新加载项目以反映服务端实际保存的内容。后端未配置 AI 时不显示卡片 AI 按钮，弹窗页签与抽屉入口置灰并说明原因；侧栏底部显示 AI 状态。
- 编辑节点：点击节点打开编辑面板，支持保存新名称和删除当前节点及其后代。
- 拖拽排序：按住节点卡片移动超过 4px 即开始拖拽（触控设备长按 150ms），单击卡片仍打开编辑面板，拖拽结束时不会误触发点击。同级排序只比较节点的水平位置，且只在拖动方向一侧寻找目标，上下移动不会切换同级目标或触发换位；拖动卡片的中心需进入目标同级卡片并越过其宽度的 1/4 才换位（按目标未被挤开时的原始位置判定），仅移出原位或在宽子树之间短距离移动不会换位；拖动经过其他父节点下的同级节点时，卡片仍跟随指针移动；指针直接进入合法的上级节点时，仍可调整所属关系。拖拽期间节点与分支保持原始尺寸，只改变位置。与移动节点或当前吸附目标直接相关、松手后可能改变的连接段显示为虚线，其他分支及移动子树内部的连线保持实线可见；落位后全部连线按最新父子关系恢复实线，且只连接相邻同级节点中心。
- 项目管理：项目菜单支持重命名和删除；删除操作均需二次确认。
- 外部依赖：需要前端能够访问同源 `/api` 服务；当前页面未设置登录与权限分级。

## 后端接口清单

| 页面功能与触发条件 | 方法与路径 | 关键请求参数 | 页面使用的响应字段 | 调用代码位置 | 后端实现或契约依据 | 接入状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 初始化项目侧栏 | `GET /api/projects` | 无 | `id`、`name` | `frontend/src/App.tsx` 的初始化加载 | `backend/internal/app/router.go` | 已接入 |
| 打开或切换项目 | `GET /api/projects/:projectID` | 路径参数 `projectID` | `id`、`name`、`nodes` 及节点字段 | `frontend/src/App.tsx` 的 `loadProject` | `backend/internal/app/router.go` | 已接入 |
| 新建项目 | `POST /api/projects` | JSON：`name` | 新项目的 `id`、`name`、`nodes` | `frontend/src/App.tsx` 的 `createItem` | `backend/internal/app/router.go` | 已接入 |
| 重命名项目 | `PATCH /api/projects/:projectID` | JSON：`name` | `id`、`name` | `frontend/src/App.tsx` 的 `renameProject` | `backend/internal/app/router.go` | 已接入 |
| 删除项目 | `DELETE /api/projects/:projectID` | 路径参数 `projectID` | 无，成功状态为 204 | `frontend/src/App.tsx` 的 `deleteProject` | `backend/internal/app/router.go` | 已接入 |
| 从节点快速新增节点 | `POST /api/projects/:projectID/nodes` | JSON：`name`、`kind`、`parentId`；同级插入时附 `afterId` | `id`、`kind`、`parentId`、`name` | `frontend/src/App.tsx` 的 `createItem` | `backend/internal/app/router.go` | 已接入 |
| 重命名节点 | `PATCH /api/projects/:projectID/nodes/:nodeID` | JSON：`name` | 更新后的节点字段 | `frontend/src/App.tsx` 的 `renameNode` | `backend/internal/app/router.go` | 已接入 |
| 删除节点及其后代 | `DELETE /api/projects/:projectID/nodes/:nodeID` | 路径参数 `projectID`、`nodeID` | 无，成功状态为 204 | `frontend/src/App.tsx` 的 `deleteNode` | `backend/internal/app/router.go` | 已接入 |
| 拖拽排序或调整父节点 | `PUT /api/projects/:projectID/nodes/order` | JSON：`nodeId`、`parentId`、`nodeIds` | 无，成功状态为 204 | `frontend/src/App.tsx` 的 `reorderNodes` | `backend/internal/app/router.go` | 已接入 |
| 判断是否显示 AI 入口 | `GET /api/ai/status` | 无 | `enabled` | `frontend/src/App.tsx` 的初始化加载 | `backend/internal/app/router.go` | 已接入 |
| AI 生成子节点 | `POST /api/projects/:projectID/nodes/:nodeID/generate-children` | 路径参数 `nodeID` 为父节点；JSON：`count`、`prompt` | `nodes` 及节点字段 | `frontend/src/App.tsx` 的 `generateChildren` | `backend/internal/app/generation.go` | 已接入 |

所有调用统一封装在 `frontend/src/api.ts`。AI 接口说明见后端接口文档的 [AI 状态](../backend-api.md#get-apiaistatus) 与 [AI 生成](../backend-api.md#ai-生成) 部分。

## 可见文案

| 位置 | 文案 | 出现条件 | 用户下一步 |
| --- | --- | --- | --- |
| 页面标题 | 当前项目名称或“用户故事地图” | 始终显示 | 查看当前上下文 |
| 空项目状态 | “暂无项目”“新建项目以开始规划。” | 没有项目 | 新建项目 |
| 空角色状态 | “暂无角色”“先创建角色，再逐层添加史诗和用户故事。” | 当前项目没有角色 | 新建第一个角色 |
| 节点下方按钮 | “新增子节点”辅助标签 | 节点支持下一层 | 创建下一层内容 |
| 节点右侧同级按钮 | “新增同级角色/史诗/用户故事/二级故事”辅助标签 | 鼠标悬停节点、键盘聚焦按钮或使用触控设备 | 创建同层内容 |
| 节点下方 AI 按钮 | “AI 生成子节点”辅助标签 | 后端已配置 AI 且节点支持下一层 | 打开 AI 生成弹窗 |
| AI 生成弹窗 | “AI 生成{层级}”“生成 N 个”“正在生成…”“取消生成” | 选择 AI 生成 | 生成或取消 |
| AI 未配置提示 | “后端尚未配置 AI 服务，暂时无法生成。” | `enabled` 为 false 时进入 AI 页签 | 配置后端后重试 |
| 生成成功提示 | “AI 生成完成”“已新增 N 个{层级}。” | 生成成功 | 查看或编辑新节点 |
| 删除确认 | “确认删除？”及受影响内容说明 | 用户请求删除 | 取消或确认删除 |
| 错误提示 | 面向用户的失败原因 | 请求失败 | 修正输入或稍后重试 |

## 页面状态

### 加载中

内容区展示节点尺寸的骨架块，侧栏与头部保持可见。

### 空状态

没有项目时引导新建项目；项目没有角色时引导创建第一个角色。

### 正常状态

展示四层故事地图。节点可选择、编辑、删除、拖拽；节点下方可新增子节点，悬停节点后可从右侧新增同级节点。

### 校验失败

名称为空时提交按钮不可用；后端拒绝无效层级、排序或名称时，页面顶部展示可理解的错误提示。

### 权限不足或不可用

当前没有权限模型。服务不可用时保留页面现状并展示错误提示。

### 加载失败

页面展示请求失败提示；当前版本没有独立重试按钮，用户可刷新页面重新加载。

### 成功反馈

新增节点后立即加入地图并自动选中；AI 生成的节点追加到父节点末尾并短暂高亮，右下角显示成功提示；重命名后更新当前名称；删除后移除目标及其后代；排序先即时更新，接口失败时回滚并提示。

## 响应式行为

- 窄屏：项目侧栏改为带遮罩的滑出导航，命令栏压缩主操作文字，故事地图保持固定节点尺寸并双向滚动，触控设备始终显示节点新增按钮。
- 中等屏幕：侧栏可收起，地图按内容宽度横向展开。
- 宽屏：侧栏常驻，地图内容区占据剩余空间；同级快捷按钮默认隐藏，悬停节点或键盘聚焦按钮时从节点右侧展开。

## 可访问性

- 页面主标题：头部使用唯一的 `h1` 展示当前项目。
- 键盘操作：聚焦节点后按 Enter 打开编辑面板；按空格拿起节点，用方向键移动，再按空格放下，Esc 取消；新增、菜单和表单控件均可聚焦。
- 语义与标签：地图区域、节点卡片（名称含层级）、图标按钮和快捷新增按钮均有可识别名称；纯图标按钮使用稳定的直接按钮节点，并通过辅助名称和浏览器原生提示说明用途；输入框关联标签。
- 动态反馈：错误信息使用警示组件；保存和创建过程中按钮显示忙碌状态并禁止重复提交。
- 对比度与状态：选中与拖拽吸附除颜色外还通过边框或轮廓变化呈现；支持系统“减少动态效果”偏好。

## 依赖与假设

- 依赖：React、Microsoft Fluent UI React v9、Fluent System Icons、dnd-kit 及同源后端接口。Fluent UI 是 Web 页面采用 Windows 11 视觉与交互规范的组件实现。
- 假设：同级新增沿用当前节点的父节点，并将新节点插入到当前节点之后。
- 待确认事项：无。

## 变更记录

| 日期 | 变更 | 关联页面文件 |
| --- | --- | --- |
| 2026-10-16 | 收窄同级换位判定：拖动卡片中心须进入目标同级卡片并越过其宽度 1/4 才换位，此前只要移出原位就与方向上最近的同级换位，史诗间有宽子树时过于敏感；目标按原始布局位置判定，换位动画不会造成来回抖动。 | `frontend/src/drag-collision.ts`、`frontend/src/components/StoryMap.tsx`、`frontend/src/drag-collision.test.ts` |
| 2026-10-15 | 移除节点卡片右上角的拖拽图标和左下角的类型徽标；整张卡片作为拖拽激活区，单击或 Enter 打开编辑，空格进行键盘拖拽。 | `frontend/src/components/StoryMap.tsx`、`frontend/src/App.css`、`frontend/src/drag-handle-hover.test.ts`、`frontend/src/layout-styles.test.ts` |
| 2026-10-15 | 重构前端：`App.tsx` 拆分为接口封装、数据模型与侧栏 / 故事地图 / 对话框 / 编辑抽屉组件，四个层级的分支合并为一个递归组件，排序方案计算抽成可测试的纯函数；保留 Fluent 组件风格。为四个层级配置专属图标与颜色，并为新增、编辑、项目文件夹、自动保存、AI 等图标设置语义色。接入 AI 状态与生成子节点接口，提供卡片快捷按钮、新增弹窗页签和编辑抽屉三个入口，支持数量、附加提示词与中途取消。 | `frontend/src/App.tsx`、`frontend/src/App.css`、`frontend/src/api.ts`、`frontend/src/model.ts`、`frontend/src/components/*`、`frontend/src/model.test.ts`、`frontend/src/test-support.ts` |
| 2026-10-02 | 侧栏改为不透明背景，修复窄屏滑出导航透出地图；节点标题为拖拽手柄预留右侧空间，并修复三行截断被 Fluent 样式覆盖而失效的问题；新增子节点按钮移到卡片底边中央，不再遮挡类型徽标。 | `frontend/src/App.tsx`、`frontend/src/App.css`、`frontend/src/layout-styles.test.ts` |
| 2026-10-02 | 同级拖拽只在拖动方向一侧寻找目标，修复向左越过宽子树时误选右侧角色下节点；跨分组悬停时卡片继续跟随指针；对话框和抽屉打开时背后页面在半透明遮罩下可见；修复侧栏分隔线被拉伸。 | `frontend/src/App.tsx`、`frontend/src/App.css`、`frontend/src/drag-collision.ts`、`frontend/src/sortable-transform.ts`、`frontend/src/drag-collision.test.ts`、`frontend/src/sortable-transform.test.ts`、`frontend/src/layout-styles.test.ts` |
| 2026-09-21 | 同级节点拖拽改为只按水平中心距离判定，忽略上下位置，并保留指针直接进入合法上级节点时的跨层调整，避免目标反复切换导致抽动。 | `frontend/src/App.tsx`、`frontend/src/drag-collision.ts`、`frontend/src/drag-collision.test.ts` |
| 2026-09-21 | 修复节点加号悬停时页面闪烁；移除页面内剩余的浮层提示包装，并检查侧栏新建、移动端导航、关闭、项目菜单等纯图标按钮，统一保留直接按钮节点、辅助名称和原生提示。 | `frontend/src/App.tsx`、`frontend/src/drag-handle-hover.test.ts` |
| 2026-09-21 | 修复拖拽手柄悬停时页面闪烁；激活器改为稳定的直接按钮并保留原生提示，避免悬浮门户反复挂载。 | `frontend/src/App.tsx`、`frontend/src/drag-handle-hover.test.ts` |
| 2026-09-21 | 新建 Fluent UI 试验分支；以 Windows 11 风格重构项目导航、命令栏、节点卡片、菜单、表单、对话框、编辑抽屉、加载和错误状态，并补充移动端导航及减少动态效果支持。 | `frontend/src/App.tsx`、`frontend/src/App.css`、`frontend/src/index.css` |
| 2026-09-21 | 收紧拖拽期间的连线影响范围；与移动节点或吸附目标直接相关的线段显示为虚线，其他未受影响连线保持实线。 | `frontend/src/App.css`、`frontend/src/connector-layout.test.ts` |
| 2026-09-19 | 同级加号创建的新节点改为紧跟当前节点插入；右侧已有节点时置于两者之间。 | `frontend/src/App.tsx`、`backend/internal/app/router.go`、`backend/internal/app/store.go` |
| 2026-09-19 | 将常驻的同级行末新增按钮改为节点悬停时从右侧展开，并保留键盘与触控可访问性。 | `frontend/src/App.tsx`、`frontend/src/App.css` |
| 2026-09-19 | 修复宽子树和拖拽过渡产生的多余分支线条，连接线与可拖拽视觉层分离。 | `frontend/src/App.tsx`、`frontend/src/App.css` |
| 2026-09-19 | 修复不同尺寸分支拖拽时被 dnd-kit 缩放的问题，拖拽视觉仅保留平移。 | `frontend/src/App.tsx`、`frontend/src/sortable-transform.ts` |
| 2026-09-19 | 建立页面文档；定义节点直接新增子节点、同级行末快捷新增和拖拽吸附行为。 | `frontend/src/App.tsx`、`frontend/src/App.css` |
