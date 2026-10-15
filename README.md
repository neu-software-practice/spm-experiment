# spm-experiment

用户故事地图工具：按 角色 → 史诗 → 用户故事 → 二级故事 四层树状结构管理项目需求，支持节点增删改、拖拽排序与跨父节点移动，后端可接入 AI 根据父节点自动生成子节点。

| 目录 | 技术栈 | 说明 |
| --- | --- | --- |
| [`backend/`](backend/README.md) | Go + Gin | HTTP 接口，数据保存在本地 JSON 文件。 |
| [`frontend/`](frontend/README.md) | React 19 + Vite + Fluent UI v9 + dnd-kit | 故事地图页面。 |
| [`docs/`](#文档索引) | — | 接口、页面与验收文档。 |
| `.workflow/` | — | Bug 排查与修复记录。 |

## 环境要求

- Go 1.26.5（`backend/go.mod` 指定，`GOTOOLCHAIN=auto` 时可自动下载）；`go test -race` 需要启用 cgo 并安装 C 编译器。
- Node 22.12 及以上，pnpm 10（可用 `corepack pnpm`）。

## 快速启动

分别在两个终端运行：

```sh
cd backend && go run ./cmd/server
```

```sh
cd frontend && pnpm install --frozen-lockfile && pnpm dev
```

打开 `http://localhost:5173`。后端默认监听 `8080`，首次启动会创建示例项目；未配置 AI 时其余功能照常可用。端口、数据文件和 AI 配置见 [后端 README](backend/README.md)。

## 验证

```sh
(cd backend && go test -race ./... && go vet ./...)
(cd frontend && pnpm test && pnpm lint && pnpm build)
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [后端 README](backend/README.md) | 后端启动、环境变量与 AI 配置。 |
| [后端接口文档](docs/backend-api.md) | 全部 HTTP 接口的参数、响应、错误码与示例，接口契约以此为准。 |
| [前端 README](frontend/README.md) | 前端开发、目录与验证命令。 |
| [用户故事地图页面](docs/pages/story-map.md) | 页面布局、交互、接口接入、状态与变更记录。 |
| [开发环境验收报告](docs/screenshots/README.md) | 2026-10-02 的部署验证、浏览器走查与界面截图。 |
| [`.workflow/`](.workflow) | 拖拽相关 Bug 的根因、修复与审核记录。 |
