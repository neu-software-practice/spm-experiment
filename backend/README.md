# 后端服务

使用 Go + Gin，项目和节点保存在 `DATA_FILE` 指向的 JSON 文件。首次启动会创建示例项目；没有配置 AI 时，项目与节点的增删改、排序仍可使用。

全部 12 个 HTTP 接口的参数、响应、错误码与调用示例统一维护在 [完整后端接口文档](../docs/backend-api.md)。本页维护服务启动与配置说明。

## 启动与配置

在 `backend` 目录运行：

```sh
go run ./cmd/server
```

默认监听 `8080` 端口，数据文件为 `data/spm.json`。使用 `PORT`、`DATA_FILE` 环境变量覆盖。配置模板见 [.env.example](.env.example)；服务只读取进程环境变量，不会自动加载 `.env` 文件。

若使用本地配置文件：

```sh
cp .env.example .env
# 编辑 .env，填写 AI_API_KEY 和 AI_MODEL，再运行：
set -a
. ./.env
set +a
go run ./cmd/server
```

`.env` 已忽略，不要将真实密钥提交到仓库。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 服务监听端口。前端开发代理默认指向该端口。 |
| `DATA_FILE` | `data/spm.json` | JSON 数据文件；相对路径以服务启动目录为基准。文件不存在时创建示例项目，不应由多个服务进程同时使用。 |
| `AI_API_KEY` | 空 | AI 服务密钥，仅在服务端使用。 |
| `AI_MODEL` | 空 | 服务提供商支持的模型名称，需支持 Chat Completions 文本输出和 JSON 模式。 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | 兼容接口的基础地址；保留提供商要求的版本前缀，服务会拼接 `/chat/completions`。支持 HTTP/HTTPS，不允许内嵌账号密码、查询参数或 fragment。 |
| `AI_TIMEOUT` | `60s` | 单次 AI 请求总超时，含读取响应；须大于 0、不超过 `2m`，例如 `45s`。 |

`AI_API_KEY` 与 `AI_MODEL` 都为空时禁用 AI；只配置其中一项或使用无效配置时启动失败。没有默认模型，以便部署时选择实际可用的模型。

接入采用 [Chat Completions 官方协议](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/)，使用 `messages`、`model`、`response_format: {"type":"json_object"}` 与 Bearer 鉴权。此处选用 Chat Completions 是为了支持兼容该协议的服务商；不能直接连接只提供其他协议的接口。实际输出仍需通过后端校验。

## 接口文档维护

[完整后端接口文档](../docs/backend-api.md) 包含健康检查、项目管理、节点增删改与排序、AI 状态和子节点生成接口。调整后端接口时，在同一次提交中同步该文档的参数、返回值、错误码及示例；配置变化同步本页及 `.env.example`。

## 验证

```sh
go test -race ./...
go vet ./...
go build ./...
```

测试使用本地模拟 AI HTTP 服务，不消耗外部模型额度。覆盖父节点上下文与附加提示词传递、自动层级映射、数量/名称校验、持久化、并发冲突、失败回滚、取消、超时及服务端错误。真实模型联调需要自行配置可用的模型和密钥。
