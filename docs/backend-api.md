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
| POST | `/api/projects/:projectID/nodes/:nodeID/generate-children` | AI 生成并保存直接子节点 | 201 |

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

## AI 生成

### POST /api/projects/:projectID/nodes/:nodeID/generate-children

路径参数：`projectID` 为项目 ID，`nodeID` 为生成目标的**父节点** ID。该父节点必须属于指定项目。

请求体必须是一个 JSON 对象，可传 `{}` 使用默认值；不能省略整个请求体，也不能传 `null`：

```json
{"count":3,"prompt":"重点考虑手机端操作，拆分为用户可完成的具体步骤"}
```

| 字段 | 类型 | 必填 | 默认值与约束 |
| --- | --- | --- | --- |
| `count` | integer | 否 | 默认 3，范围 1–10；省略或 `null` 使用默认值。不能传浮点数或字符串。 |
| `prompt` | string | 否 | 默认空；最多 2000 个 Unicode 字符，校验长度后去除首尾空白。省略或 `null` 等价于空字符串。 |

不接受 `kind`、`parentId`、`afterId` 或其他字段。请求体上限为 16 KiB，超过上限返回 `400`「请求内容无效」。

后端把项目名称、由根到父节点的祖先链、父节点名称与类型、已有直接子节点名称、生成数量和附加提示词发给所配置的 AI 服务。不发送内部 ID 或整个项目的其他分支。这里的“父节点内容”就是 `Node.name`；附加提示词仅用于本次生成，不作为节点属性保存。

| 父节点 | 自动生成的子节点 |
| --- | --- |
| `role` | `epic` |
| `epic` | `story` |
| `story` | `substory` |
| `substory` | 已到最末层级，返回 400，不调用模型。 |

成功返回 `201 Created`。此时节点已整批追加到该父节点的子节点末尾并持久化，**不是待确认的预览**：

```json
{
  "parentId":"s1",
  "nodes":[
    {"id":"ss2","kind":"substory","parentId":"s1","name":"裁剪封面图片"},
    {"id":"ss3","kind":"substory","parentId":"s1","name":"调整封面位置"},
    {"id":"ss4","kind":"substory","parentId":"s1","name":"预览封面效果"}
  ]
}
```

响应中的 `nodes` 仅包含本次新建节点，顺序与模型输出一致。客户端可追加这些节点，或重新查询项目详情。当前前端尚未提供 AI 生成入口。

校验与并发行为：

- 模型只提供名称；ID、父节点 ID 和类型由后端决定。生成数量必须与请求完全一致。
- 名称去除首尾空白后须为 1–80 个 Unicode 字符，不含控制字符；批次内部及与已有直接子节点之间不能重名，比较时忽略大小写并去除首尾空白。
- 非 JSON、额外结构字段、空名称、超长、重复、数量不符、截断或拒绝生成等情况均整批失败，不保存部分结果。
- 序列化给模型的上下文最多 64 KiB；超过时返回 `400`。模型 HTTP 响应大小上限为 1 MiB；超过时返回 `502`。
- 模型调用期间不占用存储锁。保存前重新核对项目名称、父节点、祖先链和已有直接子节点（含顺序）；相关信息改变返回 `409`，项目或父节点已删除返回 `404`。无关分支的编辑会被保留。
- 全批校验通过后只保存一次；保存失败恢复内存状态。不会自动重试模型请求。
- 请求不具备幂等键，重复提交可能再次创建子节点。连接中断、超时或响应丢失导致结果不明时，先查询项目再决定是否重新生成。

失败状态：`400` 请求/层级/上下文不合法；`404` 项目或父节点不存在；`408` 调用方取消；`409` 生成期间上下文发生变化；`500` 保存失败；`502` AI 服务异常或输出无效；`503` AI 未配置；`504` AI 调用超时。具体提示见下表。父节点与请求校验发生在 AI 配置检查之前，因此 AI 未配置时，无效请求仍可能先返回 `400` 或 `404`。

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
| 400 | `二级故事已是最末层级，无法生成子节点` | 对 `substory` 调用 AI 生成。 |
| 400 | `生成数量须为 1 到 10 个` | AI `count` 超出范围。 |
| 400 | `附加提示词不能超过 2000 个字符` | AI 附加提示词不符合字符要求。 |
| 400 | `当前节点上下文过长，请精简内容后再试` | 发给模型的上下文超过 64 KiB。 |
| 404 | `未找到对应内容` | 项目或操作目标节点不存在/不属于指定项目。创建节点的父节点和排序目标的特殊规则见各接口。 |
| 408 | `生成请求已取消` | AI 请求被调用方取消；连接已断开时调用方可能无法收到此响应。 |
| 409 | `生成期间节点内容已变化，请重新生成` | AI 调用期间相关项目、父节点、祖先或直接子节点发生变化。 |
| 500 | `服务器暂时无法处理请求` | 存储写入失败等内部错误。 |
| 502 | `AI 返回的内容不符合节点要求，请调整提示词后重试` | 模型返回的格式、数量或名称不符合要求。 |
| 502 | `AI 服务暂时无法生成内容，请稍后重试` | 上游连接失败或返回非 200，包括鉴权失败、限流、服务错误。 |
| 503 | `AI 生成功能尚未配置` | 有效生成请求到达时，服务没有加载 AI 客户端。 |
| 504 | `AI 生成超时，请稍后重试` | 超过 `AI_TIMEOUT` 或请求上下文截止时间。 |

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

# AI：为史诗生成三个用户故事；需先在后端配置模型服务
curl --fail-with-body http://localhost:8080/api/projects/PROJECT_ID/nodes/EPIC_ID/generate-children \
  -H 'Content-Type: application/json' -d '{"count":3,"prompt":"优先考虑移动端场景"}'

# 删除节点及后代，或删除整个项目；成功时响应体为空
curl --fail-with-body -X DELETE http://localhost:8080/api/projects/PROJECT_ID/nodes/NODE_ID
curl --fail-with-body -X DELETE http://localhost:8080/api/projects/PROJECT_ID
```

## 维护与验证

新增或调整路由、请求字段、返回结构、节点层级、排序规则、AI 限制或错误映射时，应在同一次提交中同步本文件的总览、接口正文和示例。启动参数与环境变量保留在 [后端 README](../backend/README.md)，避免维护两份接口契约。

核对接口时，以 `router.go` 的注册路由和响应状态、`store.go` 的业务行为以及 AI 生成逻辑为准。后端回归命令在 `backend` 目录执行：

```sh
go test -race ./...
go vet ./...
go build ./...
```

现有测试覆盖节点层级、插入与排序、级联删除、持久化和 AI 参数/输出校验、并发冲突、回滚、取消、超时及上游失败。AI HTTP 测试使用本地模拟服务；真实模型可用性需配置实际密钥、地址和模型后验证。
