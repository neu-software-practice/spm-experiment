# 后端服务

使用 Go + Gin，项目和节点保存在 `DATA_FILE` 指向的 JSON 文件。首次启动会创建示例项目；没有配置 AI 时，项目与节点的增删改、排序仍可使用。

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
| `AI_API_KEY` | 空 | AI 服务密钥，仅在服务端使用。 |
| `AI_MODEL` | 空 | 服务提供商支持的模型名称，需支持 Chat Completions 文本输出和 JSON 模式。 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | 兼容接口的基础地址；保留提供商要求的版本前缀，服务会拼接 `/chat/completions`。支持 HTTP/HTTPS，不允许内嵌账号密码、查询参数或 fragment。 |
| `AI_TIMEOUT` | `60s` | 单次 AI 请求总超时，含读取响应；须大于 0、不超过 `2m`，例如 `45s`。 |

`AI_API_KEY` 与 `AI_MODEL` 都为空时禁用 AI；只配置其中一项或使用无效配置时启动失败。没有默认模型，以便部署时选择实际可用的模型。

接入采用 [Chat Completions 官方协议](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create/)，使用 `messages`、`model`、`response_format: {"type":"json_object"}` 与 Bearer 鉴权。此处选用 Chat Completions 是为了支持兼容该协议的服务商；不能直接连接只提供其他协议的接口。实际输出仍需通过后端校验。

## AI 接口

### 查询是否配置

`GET /api/ai/status`

```json
{"enabled": true}
```

仅表示服务器已加载 AI 配置，不会请求模型，不表示模型健康检查成功；不返回密钥、服务地址等配置。前端尚未接入该接口及 AI 生成入口。

### 根据父节点生成子节点

`POST /api/projects/:projectID/nodes/:nodeID/generate-children`

请求头：`Content-Type: application/json`。请求体必须是 JSON 对象，可传空对象 `{}`。

```json
{
  "count": 3,
  "prompt": "重点考虑手机端操作，拆分为用户可完成的具体步骤"
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `count` | 否 | 生成数量，默认 3，整数 1–10。 |
| `prompt` | 否 | 附加提示词，默认空，最多 2000 个 Unicode 字符；首尾空白会被去除。 |

父节点必须属于指定项目。后端自动读取项目名称、父节点名称与层级、由根到父节点的祖先链，以及已有直接子节点名称，结合附加提示词发给配置的 AI 服务。只发送相关业务名称与层级，不发送内部 ID 或整个项目的其他分支。上下文 JSON 超过 64 KiB 时返回错误；请求体最多 16 KiB。

| 父节点 | 生成的子节点 |
| --- | --- |
| `role`（角色） | `epic`（史诗） |
| `epic`（史诗） | `story`（用户故事） |
| `story`（用户故事） | `substory`（二级故事） |
| `substory`（二级故事） | 已到最末层级，返回 400。 |

成功返回 **201 Created**。返回时节点已整批追加并保存，可以通过原项目查询接口读取，也可以直接将 `nodes` 加入前端地图。

```json
{
  "parentId": "父节点ID",
  "nodes": [
    {"id": "新节点ID1", "kind": "substory", "parentId": "父节点ID", "name": "选择封面图片"},
    {"id": "新节点ID2", "kind": "substory", "parentId": "父节点ID", "name": "裁剪封面图片"},
    {"id": "新节点ID3", "kind": "substory", "parentId": "父节点ID", "name": "预览封面效果"}
  ]
}
```

调用示例（将路径中的 ID 替换为现有项目与非末级节点的 ID）：

```sh
curl --fail-with-body http://localhost:8080/api/projects/PROJECT_ID/nodes/NODE_ID/generate-children \
  -H 'Content-Type: application/json' \
  -d '{"count":3,"prompt":"重点考虑手机端操作"}'
```

生成规则与写入行为：

- AI 只提供名称；节点 ID、父节点 ID 和层级由后端确定，提示词不能更改结构。
- 名称去除首尾空白后须为 1–80 个 Unicode 字符，不含控制字符；不允许批次内或与已有直接子节点重名（忽略英文大小写）。数量必须与请求一致。
- 数量不符、空名称、超长、重复、非 JSON、额外结构字段、截断或拒绝生成等情况均使整批失败，不保存部分结果。
- 请求 AI 时不占用存储锁。保存前重新核对项目名称、父节点、祖先链及原有子节点，相关内容有变化时返回 409；无关分支的编辑会保留。
- 整批通过校验后只保存一次；磁盘写入失败会恢复内存状态。节点 JSON 格式和数据文件版本不变。
- 不自动重试上游调用。该接口会创建节点，重复请求会再次生成；收到成功响应后勿重复提交。若连接中断导致结果不明，先查询项目节点。

### 错误响应

所有接口错误采用 `{"error":"面向用户的提示"}` 格式，不返回密钥、上游响应正文或内部错误堆栈。

| HTTP 状态 | 含义 |
| --- | --- |
| 400 | JSON/字段无效、数量或提示词越界、末级父节点、上下文过长。 |
| 404 | 项目或父节点不存在、父节点不属于该项目，或生成期间被删除。 |
| 408 | 请求被调用方取消。 |
| 409 | 生成期间相关上下文发生变化，请重新生成。 |
| 502 | AI 服务连接/鉴权/限流/服务错误，或返回内容不符合要求。 |
| 503 | AI 尚未配置。 |
| 504 | AI 请求超时。 |
| 500 | 本地存储写入失败等内部错误。 |

## 验证

```sh
go test -race ./...
go vet ./...
go build ./...
```

测试使用本地模拟 AI HTTP 服务，不消耗外部模型额度。覆盖父节点上下文与附加提示词传递、自动层级映射、数量/名称校验、持久化、并发冲突、失败回滚、取消、超时及服务端错误。真实模型联调需要自行配置可用的模型和密钥。
