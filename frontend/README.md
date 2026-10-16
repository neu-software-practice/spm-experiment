# 前端

使用 React 19 + TypeScript + Vite，界面组件采用 Fluent UI React v9（Windows 11 风格），拖拽基于 dnd-kit。目前只有一个页面：用户故事地图，规格见 [页面文档](../docs/pages/story-map.md)。

## 开发

需要 Node 22.12 及以上（Vite 8 要求 Node 20.19+ 或 22.12+，测试又依赖 Node 22.6 起提供的 TypeScript 类型擦除）和 pnpm 10（版本由 `package.json` 的 `packageManager` 固定，可用 `corepack pnpm` 调用）。在 `frontend` 目录运行：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器默认地址为 `http://localhost:5173`，`/api` 请求代理到 `http://localhost:8080`，需先按 [后端 README](../backend/README.md) 启动后端。后端端口变化时同步修改 `vite.config.ts` 中的代理地址。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/App.tsx` | 页面状态与数据操作：加载、增删改、排序，组合下列组件与 AI 助手。 |
| `src/App.css` | 页面样式；节点类型与 AI 的配色令牌（`[data-kind]`、`--ai-color` 等）集中定义在文件开头。 |
| `src/api.ts` | 后端接口封装，覆盖 [接口文档](../docs/backend-api.md) 中页面用到的全部接口。 |
| `src/model.ts` | 数据类型、层级常量与纯函数（子树收集、排序方案计算等）。 |
| `src/assistant.ts` | AI 助手对话的纯逻辑：SSE 解析、把流式事件折叠成可显示的回合、撤销判定、按项目保存对话。 |
| `src/useAssistant.ts` | AI 助手对话 hook：发起与停止一轮对话、维护发给后端的对话记录、撤销最近一轮。 |
| `src/components/AssistantPanel.tsx` | 右侧 AI 助手侧边栏：消息、思考过程、工具调用卡片与输入框。 |
| `src/components/Markdown.tsx` | 助手回复用的轻量 Markdown 渲染（段落、列表、表格、加粗、行内代码），不注入 HTML。 |
| `src/components/StoryMap.tsx` | 故事地图：拖拽吸附判定、节点卡片与递归分支。 |
| `src/components/ProjectSidebar.tsx` | 项目侧栏与自动保存 / AI 状态。 |
| `src/components/Dialogs.tsx` | 新增、重命名项目、删除确认对话框。 |
| `src/components/NodeSheet.tsx` | 节点编辑抽屉，可把节点带入 AI 助手讨论。 |
| `src/components/KindVisuals.tsx` | 节点类型图标与徽标。 |
| `src/drag-collision.ts` | 拖拽吸附目标判定。 |
| `src/sortable-transform.ts` | 拖拽位移计算：只保留平移、丢弃 dnd-kit 的缩放；跨分组悬停时让卡片继续跟随指针。 |
| `src/connector-visibility.ts` | 拖拽期间连接线的显示判定。 |
| `src/node-order.ts` | 同级节点插入顺序。 |
| `src/*.test.ts`、`src/test-support.ts` | 基于 `node:test` 的单元与样式回归测试；`test-support.ts` 汇总源码与样式供断言使用。 |

## 验证

```sh
pnpm test
pnpm lint
pnpm build
```

`pnpm build` 会把 React、dnd-kit 和其余第三方代码（主要是 Fluent UI）拆成独立文件，分组规则见 `vite.config.ts`。
