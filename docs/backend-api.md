# 后端接口文档

本文件是后端 HTTP 接口的完整参考，覆盖当前全部 **12 个接口**。最近核对日期：2026-10-02。

实现依据：[路由与请求结构](../backend/internal/app/router.go)、[项目与节点存储](../backend/internal/app/store.go)、[AI 子节点生成](../backend/internal/app/generation.go)、[AI 服务客户端](../backend/internal/app/ai.go)。服务启动、环境变量和模型配置见 [后端 README](../backend/README.md)。

## 通用约定

- 默认服务地址为 `http://localhost:8080`，可通过后端环境变量 `PORT` 更改端口。所有业务路径以 `/api` 开头，目前没有版本前缀。
- 有请求体的接口使用 JSON，调用时发送 `Content-Type: application/json`。本文件列出的接口没有查询参数，也没有分页、筛选或搜索参数。
- 成功响应直接返回对象或数组，没有 `data`、`code` 等外层包装。`204 No Content` 没有响应体，客户端不要对它调用 JSON 解码。
- 当前后端没有登录鉴权、用户隔离或业务请求限流；不要求调用方传入 API Token。`AI_API_KEY` 是后端访问模型的凭据，不能作为此项目接口的客户端参数。
- 后端没有配置 CORS 中间件。前端开发服务器通过 [Vite 配置](../frontend/vite.config.ts) 将 `/api` 代理到 `http://localhost:8080`；后端端口变化时需同步调整代理地址。浏览器跨域直连需要由部署层另行配置。
- 项目与节点 ID 由服务器生成，应作为不透明字符串使用。文中的 `p1`、`r1`、`e1` 等均是示例占位值，调用时替换为真实接口返回的 ID。
- 普通新建、重命名操作会去除名称首尾空白，并拒绝空名称；当前没有长度上限或同名限制。AI 生成名称另有更严格的规则，见生成接口。
- 普通增删改、排序请求未启用未知 JSON 字段校验；调用方仍应只提交文档定义的字段。AI 生成请求会拒绝未知字段及 JSON 对象之后的额外内容。
- 项目和节点保存在单个 JSON 数据文件中；写接口在持久化成功后返回成功状态。并发保护限于同一服务进程，不支持多个进程共享同一数据文件，也不应在进程运行时直接编辑该文件。

## 数据结构

### Project

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 项目 ID。 |
| `name` | string | 项目名称。 |
| `nodes` | Node[] | 项目详情中的全部节点，使用扁平数组表示。项目列表接口固定返回空数组，不携带节点详情。 |

### Node

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 节点 ID。 |
| `kind` | string | `role`、`epic`、`story`、`substory` 之一。 |
| `parentId` | string，可省略 | 直接父节点 ID。根级 `role` 的响应中省略此字段；其他节点返回该字段。 |
| `name` | string | 节点名称，也是 AI 生成时使用的节点内容。当前没有独立的描述或正文属性。 |

| 节点类型 | 含义 | 允许的父节点 | 允许的子节点 |
| --- | --- | --- | --- |
| `role` | 角色 | 无，根节点 | `epic` |
| `epic` | 史诗 | `role` | `story` |
| `story` | 用户故事 | `epic` | `substory` |
| `substory` | 二级故事 | `story` | 无 |

父节点必须位于同一项目，不能跳过层级。`nodes` 不是嵌套树；客户端通过 `parentId` 建立关系，按相同 `kind`、`parentId` 过滤后，保留数组中的相对顺序作为同级显示顺序。不要依赖不同分支在整个数组中的绝对位置。

## 接口总览

| 方法 | 路径 | 用途 | 成功状态 |
| --- | --- | --- | --- |
| GET | `/api/health` | 服务存活检查 | 200 |
| GET | `/api/ai/status` | 查询 AI 是否已配置 | 200 |
| GET | `/api/projects` | 项目列表 | 200 |
| POST | `/api/projects` | 创建项目 | 201 |
| GET | `/api/projects/:projectID` | 项目详情与全部节点 | 200 |
| PATCH | `/api/projects/:projectID` | 重命名项目 | 200 |
| DELETE | `/api/projects/:projectID` | 删除项目与全部节点 | 204 |
| POST | `/api/projects/:projectID/nodes` | 新建节点或在同级节点后插入 | 201 |
| PATCH | `/api/projects/:projectID/nodes/:nodeID` | 重命名节点 | 200 |
| PUT | `/api/projects/:projectID/nodes/order` | 同级排序或跨父节点移动 | 204 |
| DELETE | `/api/projects/:projectID/nodes/:nodeID` | 删除节点及所有后代 | 204 |
| PUT | `/api/projects/:projectID/nodes` | 用完整节点列表替换项目地图（撤销助手修改） | 200 |
| POST | `/api/projects/:projectID/assistant/chat` | 与 AI 助手进行一轮对话，SSE 流式返回，助手通过工具直接修改地图 | 200（SSE） |

## 服务状态

### GET /api/health

无需路径参数、查询参数或请求体。返回 `200 OK`：

```json
{"status":"ok"}
```

此接口只表示 HTTP 服务能够响应，不会探测磁盘可写性或 AI 服务健康状态。

### GET /api/ai/status

无需路径参数、查询参数或请求体。返回 `200 OK`：

```json
{"enabled":true}
```

`enabled` 为 boolean，表示服务启动时是否成功加载 AI 客户端配置。未配置时为 `false`。该请求不调用模型，不验证密钥是否有效或模型是否可用，也不返回密钥、模型名称和上游地址。

## 项目管理

### GET /api/projects

无需路径参数、查询参数或请求体。返回 `200 OK` 与项目数组：

```json
[
  {"id":"p1","name":"内容平台","nodes":[]},
  {"id":"p2","name":"订单系统","nodes":[]}
]
```

没有项目时返回 `[]`。即使某个项目已有节点，此接口的 `nodes` 也固定为 `[]`，须通过项目详情接口获取节点。项目按当前存储顺序返回，新项目追加到列表末尾。

### POST /api/projects

没有路径参数。请求体：

```json
{"name":"内容平台"}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `name` | string | 是 | 去除首尾空白后不能为空。 |

返回 `201 Created` 与新项目；新建项目没有节点：

```json
{"id":"p1","name":"内容平台","nodes":[]}
```

失败状态：`400` 请求无效或名称为空；`500` 保存失败。重复提交会新建多个项目，接口不去重。

### GET /api/projects/:projectID

路径参数 `projectID` 为项目 ID，无请求体。返回 `200 OK` 与完整项目：

```json
{
  "id":"p1",
  "name":"内容平台",
  "nodes":[
    {"id":"r1","kind":"role","name":"内容创作者"},
    {"id":"e1","kind":"epic","parentId":"r1","name":"发布文章"},
    {"id":"s1","kind":"story","parentId":"e1","name":"添加封面"},
    {"id":"ss1","kind":"substory","parentId":"s1","name":"选择封面图片"}
  ]
}
```

空项目的 `nodes` 为 `[]`，不是 `null`。失败状态：`404` 项目不存在。当前没有独立的节点列表或单节点查询接口，通过此接口读取节点。

### PATCH /api/projects/:projectID

路径参数 `projectID` 为项目 ID。请求体：

```json
{"name":"内容创作平台"}
```

`name` 为必填 string，去除首尾空白后不能为空。只修改名称，保留已有节点。返回 `200 OK` 与完整更新后的 Project，包含实际的 `nodes`：

```json
{
  "id":"p1",
  "name":"内容创作平台",
  "nodes":[{"id":"r1","kind":"role","name":"内容创作者"}]
}
```

失败状态：`400` 请求无效或名称为空；`404` 项目不存在；`500` 保存失败。

### DELETE /api/projects/:projectID

路径参数 `projectID` 为项目 ID，无请求体。删除项目及该项目中的全部节点，成功返回 `204 No Content`，无响应体。没有回收站或恢复接口。

失败状态：`404` 项目不存在（包括重复删除）；`500` 保存失败。

## 节点管理

### POST /api/projects/:projectID/nodes

路径参数 `projectID` 为项目 ID。请求体示例：

```json
{"name":"发布文章","kind":"epic","parentId":"r1"}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `name` | string | 是 | 去除首尾空白后不能为空。 |
| `kind` | string | 是 | 必须为四种节点类型之一。 |
| `parentId` | string | 条件必填 | `role` 可省略或传 `""`；其他类型须指定同项目内、正确层级的父节点 ID。 |
| `afterId` | string | 否 | 在指定同级节点之后插入；省略或传 `""` 时追加至同级末尾。 |

返回 `201 Created` 与新增 Node：

```json
{"id":"e1","kind":"epic","parentId":"r1","name":"发布文章"}
```

创建根级角色的请求为 `{"name":"内容创作者","kind":"role"}`，响应示例为 `{"id":"r1","kind":"role","name":"内容创作者"}`，没有 `parentId` 字段。

同级插入示例：已有顺序为 `e1, e2`，提交：

```json
{"name":"审核文章","kind":"epic","parentId":"r1","afterId":"e1"}
```

得到新节点 `e3` 后，同级顺序为 `e1, e3, e2`。`afterId` 必须属于同一项目、具有相同 `kind` 和 `parentId`；它只确定位置，不替代 `parentId`。

失败状态：`400` 请求无效、名称为空、类型/父节点不合法或插入锚点不合法；`404` 项目不存在；`500` 保存失败。特别地，父节点不存在或属于其他项目返回 `400`，不是 `404`。重复提交会创建多个节点。

### PATCH /api/projects/:projectID/nodes/:nodeID

路径参数：`projectID` 为项目 ID，`nodeID` 为该项目中的节点 ID。请求体：

```json
{"name":"上传文章封面"}
```

`name` 为必填 string，去除首尾空白后不能为空。仅修改节点名称；改变父节点应使用排序/移动接口，节点类型不可通过此接口改变。

返回 `200 OK` 与更新后的 Node：

```json
{"id":"s1","kind":"story","parentId":"e1","name":"上传文章封面"}
```

失败状态：`400` 请求无效或名称为空；`404` 项目或该项目中的节点不存在；`500` 保存失败。

### PUT /api/projects/:projectID/nodes/order

路径参数 `projectID` 为项目 ID。请求体：

```json
{"nodeId":"e2","parentId":"r1","nodeIds":["e2","e1"]}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `nodeId` | string | 是 | 被移动节点的 ID，必须属于该项目。 |
| `parentId` | string | 条件必填 | **移动后的**父节点 ID；角色排序传 `""` 或省略，其他类型必须指定合法父节点。 |
| `nodeIds` | string[] | 是 | **目标父节点下移动完成后的完整同级顺序**，必须包含移动节点及目标下所有其他同级节点，每个 ID 恰好一次。 |

成功返回 `204 No Content`，无响应体。需要最新节点列表时重新查询项目详情。

同一父节点下，若 `r1` 原有 `e1, e2`，上述请求将顺序改为 `e2, e1`。

跨父节点示例：`e1` 原在 `r1` 下，`r2` 下已有 `e3, e4`。把 `e1` 插在它们之间，应提交：

```json
{"nodeId":"e1","parentId":"r2","nodeIds":["e3","e1","e4"]}
```

移动规则：

- 节点类型不变，目标父节点必须符合固定层级且属于同一项目。不能把史诗挂到另一个史诗下，也不能把角色变成子节点。
- `nodeIds` 只包含目标分组，不包含原分组中未移动的节点、其他分支或后代节点。目标分组为空时传 `["被移动节点ID"]`。
- 后代节点的 `parentId` 保持原样，因此整个子树随移动节点一起转移；不需要逐个更新后代。
- 目标分组在 `Project.nodes` 中被重新写到数组末尾；其他节点保留相对顺序。客户端应按父子关系及同级相对顺序展示。

失败状态：`400` 请求无效、排序列表为空/缺失/重复/含无关节点、移动节点不存在或父节点不合法；`404` 项目不存在；`500` 保存失败。此接口中的未知 `nodeId` 返回 `400`「节点排序无效」。

### DELETE /api/projects/:projectID/nodes/:nodeID

路径参数：`projectID` 为项目 ID，`nodeID` 为该项目中的节点 ID，无请求体。删除节点及其所有层级的后代。例如删除史诗会同时删除它下面的用户故事及二级故事。

成功返回 `204 No Content`，无响应体；不返回已删除的 ID 列表。其他分支保留。没有回收站或恢复接口。

失败状态：`404` 项目或节点不存在（包括重复删除）；`500` 保存失败。

### PUT /api/projects/:projectID/nodes

用一份完整的节点列表替换项目的全部节点，用于撤销 AI 助手的一轮修改（前端在每轮开始前保存地图快照）。

```json
{"nodes":[{"id":"r1","kind":"role","name":"读者"},{"id":"e1","kind":"epic","parentId":"r1","name":"阅读"}]}
```

`nodes` 必填（可为空数组以清空地图）。整份列表须自洽：ID 非空且不重复；名称去除首尾空白后 1–80 个字符、无控制字符；角色没有 `parentId`，其余节点的父节点必须在同一列表中且层级正好高一层。数组顺序即同级顺序。校验失败返回 `400` 且不修改任何数据；成功返回 `200` 与替换后的 `Project`。此接口是整体覆盖：调用前别人对该项目的修改会被覆盖。

## AI 助手

### POST /api/projects/:projectID/assistant/chat

与 AI 助手进行一轮对话。助手可以先讨论、提问，也可以调用工具直接修改地图；一轮内可多次调用模型和工具，直到模型给出不带工具调用的回复。

请求体：

```json
{"messages":[],"input":"帮我为读者补充分享相关的史诗"}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `input` | string | 必填。本轮用户消息，去除首尾空白后 1–4000 个字符。 |
| `messages` | array | 之前各轮的对话记录，格式为 OpenAI Chat Completions 消息（`user` / `assistant`（可含 `tool_calls`）/ `tool`）。服务端不保存会话，由客户端把每轮 `done` 事件返回的 `messages` 追加后在下一轮原样传回。不允许 `system` 消息，`tool` 消息必须回应其前方 `assistant` 的 `tool_calls`，否则返回 `400`。超过 80 条时从最早的用户消息处截断。 |

请求体上限 2 MiB。项目不存在返回 `404`，AI 未配置返回 `503`，以上校验都在开始流式响应前完成，使用普通 JSON 错误结构。

通过校验后返回 `200`，`Content-Type: text/event-stream`，每个事件为 `event: <名称>` 加一行 JSON `data:`：

| 事件 | data | 说明 |
| --- | --- | --- |
| `start` | `{}` | 开始处理。 |
| `reasoning` | `{"text"}` | 模型思考过程的增量文本（模型支持时）。 |
| `text` | `{"text"}` | 回复正文的增量文本（Markdown）。 |
| `tool_pending` | `{"key","name"}` | 模型开始生成某个工具调用，参数尚未完整。`key` 在本轮内唯一，用于关联后续事件。 |
| `tool_start` | `{"key","name","args"}` | 工具开始执行，`args` 为解析后的参数。 |
| `tool_end` | `{"key","name","ok","summary","error","changedIds"}` | 工具执行结束。`summary` 为给人看的中文摘要，`changedIds` 为新增或修改的节点 ID。失败时 `ok` 为 false，错误也会返回给模型，让它自行修正。 |
| `project` | `Project` | 工具修改地图后的完整项目，客户端直接替换显示。 |
| `retry` | `{"attempt"}` | 上游连接中断、卡住或返回 429/5xx，正在重试这次模型调用；客户端应丢弃自上一个已完成工具以来流出的内容。 |
| `done` | `{"messages"}` | 本轮结束，`messages` 为本轮新增的对话记录（含工具调用与结果）。 |
| `error` | `{"error","messages"}` | 本轮失败。`messages` 仍是完整的已完成步骤，可追加到对话记录。 |

助手可用的工具（模型侧）：

| 工具 | 作用 |
| --- | --- |
| `view_map` | 查看含节点 ID 的完整地图。 |
| `add_nodes` | 在父节点下追加嵌套的多层节点，层级由深度决定；单次最多 100 个，同级不重名。 |
| `rename_node` | 重命名节点，同级不重名。 |
| `delete_nodes` | 删除节点及其下级。 |
| `move_node` | 调整顺序，或移到同层级的另一个父节点下。 |

工具对存储的修改立即保存。每轮开始时，后端把项目名称和整张地图（含 ID）写入系统提示，因此用户在两轮之间手动修改的内容模型也能看到。发给模型的只有系统提示、对话记录和工具定义，不包含其他项目的数据。

模型调用：使用 Chat Completions 的流式接口与函数调用（`stream: true`、`tools`）。单次调用受 `AI_TIMEOUT` 限制；数据流 45 秒无数据视为卡住。连接失败、卡住、HTTP 429 或 5xx 自动重试最多 2 次，其他错误不重试。一轮最多调用模型 12 次，达到上限时提示用户回复「继续」。客户端断开连接即取消本轮，已执行的工具修改保留。

## 错误响应

业务处理器主动返回的错误使用以下 JSON 结构，无额外业务错误码：

```json
{"error":"未找到对应内容"}
```

| HTTP 状态 | `error` 文本 | 场景 |
| --- | --- | --- |
| 400 | `请求内容无效` | JSON 解码失败、字段类型不匹配；AI 的未知字段、额外 JSON 内容或请求体超限。 |
| 400 | `名称不能为空` | 普通新建/重命名的名称去除首尾空白后为空。 |
| 400 | `节点层级关系无效` | 类型不受支持、父节点不存在/不在本项目/层级不符，或生成上下文中的祖先关系无效。 |
| 400 | `节点排序无效` | 插入锚点不合法，或排序/移动的节点、完整同级列表不符合要求。 |
| 400 | `消息不能为空，且不能超过 4000 个字符` | 助手对话的 `input` 不合法。 |
| 400 | `对话记录无效，请开始新对话` | 助手对话的 `messages` 结构不合法。 |
| 400 | `名称不能超过 80 个字符` | 替换节点列表时名称过长。 |
| 404 | `未找到对应内容` | 项目或操作目标节点不存在/不属于指定项目。创建节点的父节点和排序目标的特殊规则见各接口。 |
| 500 | `服务器暂时无法处理请求` | 存储写入失败等内部错误。 |
| 502 | `AI 返回的内容无法解析，请重试` | 仅出现在助手的 `error` 事件中：模型流式输出格式错误。 |
| 502 | `AI 服务暂时不可用，请稍后重试` | 仅出现在助手的 `error` 事件中：重试后上游仍连接失败或返回非 200，包括鉴权失败、限流、服务错误。 |
| 503 | `AI 助手尚未配置` | 服务没有加载 AI 配置时调用助手对话。 |
| 504 | `AI 响应超时，请稍后重试` | 仅出现在助手的 `error` 事件中：单次模型调用超过 `AI_TIMEOUT`。 |

错误响应不返回密钥、上游响应正文或内部错误堆栈。未注册的路径或 HTTP 方法走 Gin 默认处理，通常返回 `404` 与纯文本 `404 page not found`，不遵循业务 JSON 错误结构；客户端应保留非 JSON 错误回退。

## curl 调用示例

以下命令各自对应上面的接口。ID 为占位值，应使用前序响应中的真实 ID；删除示例会删除对应数据。`--fail-with-body` 可在 HTTP 错误时保留响应正文。

```sh
# 服务状态与 AI 配置状态
curl --fail-with-body http://localhost:8080/api/health
curl --fail-with-body http://localhost:8080/api/ai/status

# 项目列表与创建项目
curl --fail-with-body http://localhost:8080/api/projects
curl --fail-with-body http://localhost:8080/api/projects \
  -H 'Content-Type: application/json' -d '{"name":"内容平台"}'

# 查询与重命名项目
curl --fail-with-body http://localhost:8080/api/projects/PROJECT_ID
curl --fail-with-body -X PATCH http://localhost:8080/api/projects/PROJECT_ID \
  -H 'Content-Type: application/json' -d '{"name":"内容创作平台"}'

# 新建角色；随后使用返回的节点 ID 作为 ROLE_ID
curl --fail-with-body http://localhost:8080/api/projects/PROJECT_ID/nodes \
  -H 'Content-Type: application/json' -d '{"name":"内容创作者","kind":"role"}'

# 新建史诗；用 afterId 可在同级节点之后插入
curl --fail-with-body http://localhost:8080/api/projects/PROJECT_ID/nodes \
  -H 'Content-Type: application/json' \
  -d '{"name":"发布文章","kind":"epic","parentId":"ROLE_ID"}'

# 重命名节点
curl --fail-with-body -X PATCH http://localhost:8080/api/projects/PROJECT_ID/nodes/EPIC_ID \
  -H 'Content-Type: application/json' -d '{"name":"发布图文内容"}'

# 排序：此例假定 ROLE_ID 下恰好存在 EPIC_1、EPIC_2 两个史诗
curl --fail-with-body -X PUT http://localhost:8080/api/projects/PROJECT_ID/nodes/order \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"EPIC_2","parentId":"ROLE_ID","nodeIds":["EPIC_2","EPIC_1"]}'

# AI 助手：一轮对话，-N 关闭缓冲以实时查看 SSE 事件；需先在后端配置模型服务
curl -N --fail-with-body http://localhost:8080/api/projects/PROJECT_ID/assistant/chat \
  -H 'Content-Type: application/json' -d '{"messages":[],"input":"为每个史诗补充 3 个用户故事"}'

# 删除节点及后代，或删除整个项目；成功时响应体为空
curl --fail-with-body -X DELETE http://localhost:8080/api/projects/PROJECT_ID/nodes/NODE_ID
curl --fail-with-body -X DELETE http://localhost:8080/api/projects/PROJECT_ID
```

## 维护与验证

新增或调整路由、请求字段、返回结构、节点层级、排序规则、AI 限制或错误映射时，应在同一次提交中同步本文件的总览、接口正文和示例。启动参数与环境变量保留在 [后端 README](../backend/README.md)，避免维护两份接口契约。

核对接口时，以 `router.go` 的注册路由和响应状态、`store.go` 的业务行为以及 `assistant.go`、`ai.go` 的助手与模型调用逻辑为准。后端回归命令在 `backend` 目录执行：

```sh
go test -race ./...
go vet ./...
go build ./...
```

现有测试覆盖节点层级、插入与排序、级联删除、持久化和 AI 参数/输出校验、并发冲突、回滚、取消、超时及上游失败。AI HTTP 测试使用本地模拟服务；真实模型可用性需配置实际密钥、地址和模型后验证。
