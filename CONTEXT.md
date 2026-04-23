# CloudOps-v2 项目知识库

> 本文档是项目核心知识沉淀，用于指导后续开发和维护。非开发日记，不包含逐日变更记录。
> 最后更新：2026-04-23

---

## 一、项目概况

CloudOps 是一个 Kubernetes 多集群运维管理平台，支持集群接入、资源管理、日志查询、AI 助手、巡检报告等功能。

### 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Go 1.22 + Gin + GORM + client-go (informer) |
| 前端 | React 18 + Vite + MUI v5 + Monaco Editor + js-yaml |
| 数据库 | PostgreSQL 14（唯一数据库，已移除 SQLite） |
| 缓存 | Redis（列表缓存、会话） |
| 前端服务器 | nginx 1.18.0（静态文件 + API/Ws 反向代理） |
| 部署 | systemd 服务 + 离线包一键安装 |

### 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| cloudops-backend | 9000 | Go 后端 API |
| nginx (frontend) | 18000 | 前端静态文件 + 反向代理 |
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 缓存 |

> Agent Runtime（Node.js 子进程，端口 19000）已彻底清理，不再存在。

---

## 二、系统架构

### 2.1 后端架构

```
HTTP Request → Gin Router → Middleware → Handler → Service → DB/Redis/K8s
                                    ↓
                              WebSocket Hub → 广播资源变化
```

**关键模块：**
- `internal/api/` — HTTP handler、路由、中间件
- `internal/service/` — 业务逻辑层
- `internal/model/` — GORM 数据模型
- `internal/pkg/` — 公共包（AI provider、日志适配、WebSocket）
- `internal/pkg/ai/` — AI 平台抽象层（Ollama / OpenClaw / Hermes）

**已废弃/清理的模块：**
- `agent-runtime/` Node.js 子进程（已删除）
- `AgentRuntimeProxy` Go 代理（已删除）

### 2.2 K8s Informer 架构

每个集群接入后，`K8sManager` 创建一个 `ClusterClient`，包含：
- `*kubernetes.Clientset` — 标准 client
- `dynamic.Interface` — 复用的 dynamic client（写操作）
- 33 个 `cache.Store` — Informer 缓存（各资源类型）
- 24 个 informer — 全量注册，非按需

**关键参数：**
- `NewSharedInformerFactory(client, 60*time.Second)` — 60 秒 resync 周期（原 10 分钟）
- `WaitForCacheSync` 超时 120 秒（覆盖全部 24 个 informer）

**写操作后同步：**
- `CreateResource`/`UpdateResource`/`DeleteResource` 成功后调用 `syncObjectToStore`
- `syncObjectToStore` 通过 dynamic client `Get` 最新对象，调用 `store.Update()`（增量同步，非 Replace）
- 失败后指数退避重试（最多 5 次，总等待约 3 秒）
- 成功后广播 WebSocket `resource_change` 消息 + 清除 Redis 列表缓存

### 2.3 WebSocket 推送架构

```
后端 Hub (internal/pkg/ws/hub.go)
  ├── Client 订阅：clusterID + kinds 过滤
  ├── 资源变化广播：syncObjectToStore → ResourceChangeMessage
  ├── 集群状态广播：probeClusterHealth 状态变化 → cluster_status_change
  └── 前端接收：即时刷新对应资源列表
```

**前端策略：**
- 资源页：WebSocket 实时推送 + 30 秒轮询兜底
- 集群列表页：WebSocket 状态推送，彻底移除轮询
- 概览页：不订阅 WebSocket

### 2.4 Redis 缓存策略

- **列表缓存**：`k8s:list:${clusterID}:${kind}:${namespace}:${keyword}:${page}:${limit}`，TTL 5 秒
- **写操作后**：立即 `SCAN` + `DEL` 清除匹配的列表缓存 key
- **多用户共享**：同参数请求命中同一缓存

---

## 三、数据模型

### 3.1 核心表结构

```go
type Cluster struct {
    ID              uint
    Name            string
    Server          string        // API Server 地址（仅平台管理员可见）
    KubeConfig      string        // base64 编码
    TenantID        uint
    PermissionScope string        // admin | read-write | read-only | unknown
    HealthStatus    string        // pending | healthy | unhealthy | offline
    DeletedAt       gorm.DeletedAt // 软删除
}

type ClusterMetadata struct {
    ClusterID   uint
    NodeCount   int    // 每 30 秒从 informer 同步
    PodCount    int
    Version     string
}

type ClusterLogBackend struct {
    ID        uint
    Name      string
    Type      string        // elasticsearch | opensearch
    URL       string
    Index     string        // opensearch 默认 k8s-os-logs-*，es 默认 k8s-es-logs-*
    TenantID  uint          // 与集群生命周期解耦
    DeletedAt gorm.DeletedAt // 软删除
}

type User struct {
    ID        uint
    Username  string
    Password  string        // bcrypt，明文存储（已移除 AES 加密）
    Email     string
    RoleID    uint
    IsActive  bool          // 禁用后 middleware 拦截 token
    TenantID  uint
    DeletedAt gorm.DeletedAt
}

type Role struct {
    ID          uint
    Name        string
    Scope       string        // platform | cluster | namespace
    Permissions pq.StringArray // 如 ["pod:*", "deployment:read"]
}

type NamespaceGrant struct {
    ID        uint
    UserID    uint
    ClusterID uint
    Namespace string
}

type InspectionTask struct {
    ID         uint
    Name       string        // (name + tenant_id) 唯一索引
    ClusterIDs pq.Int64Array
    TenantID   uint
    Enabled    bool
}

type AIPlatform struct {
    ID         uint
    Name       string
    Type       string        // ollama | openclaw | openai
    ConfigJSON string        // 序列化的平台配置
}
```

### 3.2 关键设计约束

- **敏感数据明文存储**：已去掉 AES 字段级加密
- **ClusterLogBackend 与集群解耦**：删除集群不再级联删除日志后端
- **软删除**：`clusters`、`users`、`data_sources`、`inspection_tasks`、`cluster_log_backends` 均使用 `gorm.DeletedAt`
- **级联物理删除**：`cluster_secrets`、`cluster_metadata`、`cluster_permissions` 随集群物理删除

---

## 四、权限体系

### 4.1 RBAC 三级权限

| 级别 | 标识 | 范围 |
|------|------|------|
| platform | `*:*` | 全站 |
| cluster | `cluster:*` | 租户内全部集群 |
| namespace | `namespace:*` | 指定集群的指定命名空间 |

**角色 scope 判定：**
- `GetUserEffectiveRole` 返回用户的实际角色
- namespace 级用户的所有数据操作必须检查 `GetAllowedNamespaces`
- **关键安全逻辑**：`isNsScoped` 必须用 `role.Scope == "namespace"` 判定，不能用 `len(allowed) > 0`（否则撤销全部授权后仍能查看数据）

### 4.2 NSPermissionMiddleware

**URL 路径 -> 资源权限标识映射：**

`extractResourceAction` 从 URL 提取复数资源名，通过映射表转为单数：
```
pods->pod, deployments->deployment, services->service,
configmaps->configmap, secrets->secret, events->event, nodes->node,
namespaces->namespace, statefulsets->statefulset, daemonsets->daemonset,
replicasets->replicaset, jobs->job, cronjobs->cronjob, ingresses->ingress,
endpoints->endpoint, serviceaccounts->serviceaccount,
clusterroles->clusterrole, roles->role,
clusterrolebindings->clusterrolebinding, rolebindings->rolebinding,
persistentvolumes->persistentvolume, persistentvolumeclaims->persistentvolumeclaim,
storageclasses->storageclass, customresourcedefinitions->customresourcedefinition
```

**权限校验规则：**
- `roleHasPermission` 检查 `permissions` 数组是否包含 `resource:action`
- `*` verb 匹配所有 action
- `*` resource 匹配所有资源

### 4.3 kubeconfig 权限探测（动态识别）

`probePermissionScope` 通过 K8s `SelfSubjectRulesReview` API 在 `default` namespace 探测权限：

**判定规则：**
- 跳过 `authorization.k8s.io` 和 `authentication.k8s.io` API 组（默认权限自查，不代表实际操作权限）
- 有 `*` verb -> `admin`
- 有 `create/update/patch` -> `read-write`
- 否则 -> `read-only`
- 探测失败默认 `read-only`（安全保守策略）

**前端控制：**
| permission_scope | 前端操作按钮 |
|------------------|------------|
| read-only | 隐藏创建/编辑/删除 |
| read-write / admin | 显示操作按钮 |

**健康检查补充探测**：集群状态 healthy 且 `permission_scope` 为 `unknown`/`空`/`read-only` 时，自动补充探测。

### 4.4 权限变更即时生效

- 前端 `usePermission` hook：`staleTime = 30 秒`（原 5 分钟）
- 管理员保存用户权限后，主动 `invalidateQueries` 刷新权限缓存
- 被修改用户的后端资源请求实时生效（无缓存）
- 前端 UI 过滤最多 30 秒延迟

### 4.5 前端权限过滤

- **ClusterDetail.tsx**：`filteredCategories` / `filteredStats` / 子资源 Tabs 均按 `permissions` 过滤
- **Clusters.tsx**：「添加集群」按钮、「API Server」列、「节点/Pod」列、编辑/删除按钮，均仅平台管理员可见
- **无权限自动跳转**：namespace 级用户无集群授权时，后端返回 403，前端自动 `navigate('/clusters')`

---

## 五、K8s 资源管理

### 5.1 支持的资源类型（33 种）

| 分类 | 资源类型 |
|------|----------|
| 工作负载（10） | pods, deployments, statefulsets, daemonsets, replicasets, jobs, cronjobs, horizontalpodautoscalers, poddisruptionbudgets, replicationcontrollers |
| 服务与网络（5） | services, ingresses, endpoints, networkpolicies, endpointslices |
| 存储（3） | persistentvolumes, persistentvolumeclaims, storageclasses |
| 配置（5） | configmaps, secrets, serviceaccounts, limitranges, resourcequotas |
| 访问控制（4） | roles, rolebindings, clusterroles, clusterrolebindings |
| 节点（1） | nodes |
| 命名空间（1） | namespaces |
| 事件（1） | events |
| 自定义资源（2） | customresourcedefinitions, servicemonitors |

> 已移除 6 种不兼容资源：certificatesigningrequests, priorityclasses, runtimeclasses, volumeattachments, csidrivers, csinodes

### 5.2 资源列表接口

**后端 `ListResources`：**
- 参数：`clusterID`, `kind`, `namespace`, `keyword`, `page`, `limit`, `labelSelector`, `resourceType`
- 从 informer store `List()` 读取 -> 过滤（namespace/keyword/label/type）-> 稳定排序（按名称）-> 分页
- Label 选择器格式：`key=value`（精确匹配）或 `key`（仅要求存在），多条件空格/逗号分隔（AND 关系）

**前端展示：**
- 全部 33 种资源表格均展示 `labels` 列（最多 2 个 Chip，超出 `+N` 悬浮提示）
- 全部列支持表头点击排序（数字/字符串/null 处理）
- `TableSortLabel` 默认显示灰色排序箭头，排序后彩色高亮

### 5.3 创建/编辑弹窗

**ResourceEditorDialog 组件：**
- 顶部「编辑 YAML」Switch 切换表单/YAML 模式
- 33 种资源全部支持 YAML 模式，部分支持表单模式
- 表单 <-> YAML 双向同步
- all namespace 下隐藏创建按钮

### 5.4 Pod 状态逻辑

`podStatus()` 函数优先级（从高到低）：
1. `DeletionTimestamp != nil` -> `"Terminating"`
2. `Phase == Succeeded` -> `"Completed"`
3. 容器/初始化容器/Ephemeral 容器的 `Waiting.Reason` / `Terminated.Reason`
4. fallback -> `string(Phase)`

### 5.5 CRD 页面

- CRD 列表新增「查看 CR 实例」按钮
- 点击弹窗展示该 CRD 下的 Custom Resource 实例列表
- 后端通过 dynamic client 按 CRD 定义的 GVR 查询

---

## 六、集群连接状态

### 6.1 四层状态模型

| 状态 | 显示 | 触发条件 |
|------|------|---------|
| `pending` | 检测中 | 刚添加集群初始化 |
| `healthy` | 正常 | 探测成功 |
| `unhealthy` | 不健康 | 连续 1~2 次探测失败 |
| `offline` | 离线 | 连续 >=3 次探测失败 |

> 废弃状态：`error`、`warning`

### 6.2 健康检查机制

- **内存缓存**：`healthCache`（map + RWMutex），连续 3 次失败标记 offline
- **自适应周期**：健康 30s / 异常 5s / offline 60s
- **并发探测**：每个集群独立 goroutine，`ServerVersion()` 用 goroutine + select 实现 10 秒超时
- **离线拦截**：`ClusterStateMiddleware` 对 offline 集群直接返回 503
- **巡检预检**：`inspectCluster` 开头检查 `IsClusterHealthy`，offline 直接返回 failed

### 6.3 WebSocket 状态推送

- `probeClusterHealth` 只在状态真正变化时广播（old != new）
- 前端 Clusters.tsx 收到后只更新对应行的 `health_status`
- 集群列表页彻底移除轮询

---

## 七、AI 助手

### 7.1 架构

```
用户消息 -> AIPlatformService -> Provider (工厂模式) -> 外部 AI 平台
   ↓                                    ↓
前端 SSE (XMLHttpRequest)          StreamResponse
```

**Provider 实现：**
| 平台类型 | 文件 | 特点 |
|----------|------|------|
| ollama | `ollama.go` | 本地模型，NDJSON 流 |
| openclaw | `openclaw.go` | 企业平台，`X-Session-ID` |
| openai | `hermes.go` | Hermes Agent，`X-Hermes-Session-Id` |

### 7.2 Hermes Session 绑定

- Hermes 通过 HTTP Header `X-Hermes-Session-Id` 识别会话
- 首次请求不带 header -> Hermes 返回新 session ID（response header）
- 后续请求携带 header -> 同一 session 延续
- `API_SERVER_KEY=cloudops-hermes-key` 已配置

### 7.3 SSE 可靠性

- 使用 `XMLHttpRequest` + `onprogress` 替代 `fetch`，逐行解析 SSE
- 动态超时：`STREAM_MAX_MS = timeout x 1000`（Ollama 默认 600s，其他 300s）
- 错误分类：`context_exceeded` / `timeout` / `network` / `rate_limit` / `unknown`
- 兜底轮询：`runWatchdog` 每 5 秒检查 `getMessages`

---

## 八、日志查询

### 8.1 后端支持

| 类型 | 默认索引前缀 | 适配文件 |
|------|-------------|---------|
| OpenSearch | `k8s-os-logs-*` | `internal/pkg/log/es_adapter.go` |
| Elasticsearch | `k8s-es-logs-*` | `internal/pkg/log/es_adapter.go` |

### 8.2 Namespace 字段兼容性

不同采集器写入的 namespace 字段名不同，查询使用 `bool.should` 同时匹配：
- `kubernetes.namespace_name`
- `kubernetes.namespace_name.keyword`
- `namespace`
- `namespace.keyword`

---

## 九、离线部署包

### 9.1 包结构

```
cloudops-offline-ubuntu22.tar.gz (246MB)
├── install.sh              # 一键安装脚本
├── uninstall.sh
├── README-DEPLOY.md
├── bin/
│   └── cloudops-backend    # Go 后端二进制
├── config/
│   ├── db-commands.sql
│   └── nginx-cloudops.conf # nginx 配置模板
├── data/                   # Web 终端 kubectl 二进制 + completion 脚本
│   ├── kubectl
│   └── kubectl-completion.bash
├── deps/
│   ├── nodejs/             # Node.js 二进制（仅开发用）
│   ├── postgresql-14/      # 154 个 DEB
│   ├── redis-server/       # Redis DEB
│   └── nginx/              # nginx 1.18.0 + 109 个 DEB
└── frontend/dist/          # 前端构建产物
```

### 9.2 install.sh 关键逻辑

1. `dpkg -i` 安装 PostgreSQL、Redis、nginx DEB 包（`|| true` 不中断）
2. 初始化数据库、运行 db-commands.sql
3. 部署后端二进制 + 前端静态文件
4. 复制 `data/` 到安装目录（含 kubectl 二进制，供 Web 终端使用）
5. 权限修复：`chmod 751` + `o+rX`（www-data 必须能读取）
6. 渲染 nginx 配置到 `/etc/nginx/sites-available/cloudops`
7. `nginx -t && systemctl restart nginx && systemctl enable nginx`
8. 启动后端，健康检查 `/health`

### 9.3 开机自启服务

| 服务 | 状态 |
|------|------|
| postgresql | `systemctl enable` |
| redis-server | `systemctl enable` |
| nginx | `systemctl enable` |
| cloudops-backend | `systemctl enable` |

---

## 十、UI 规范

### 10.1 弹窗内错误提示

- **与用户当前操作直接相关的错误**，必须显示在弹窗/表单内部
- 禁止飘到页面顶部的全局 Alert（会被弹窗遮挡）
- 每个弹窗独立维护 `xxxError` state，关闭时清空

### 10.2 前端排序逻辑

- 数字按数值排序
- 字符串忽略大小写排序
- `null` 值始终排在末尾

### 10.3 侧边栏分组折叠

**组件**：`frontend/src/components/layout/MainLayout.tsx`

**功能**：
- 每个菜单分组（如 KUBERNETES、运维、智能、系统）可独立展开/折叠
- 点击分组标题右侧的 ▼/▶ 图标切换折叠状态
- 当前路由所在分组自动展开
- 用户手动折叠状态持久化到 `localStorage`（key: `sidebar_collapsed_groups`）
- 使用 MUI `Collapse` 组件实现平滑展开/折叠动画

**实现要点**：
- 分组标题使用 `ListItemButton` 包裹，可点击
- 菜单项使用 `Collapse in={expanded}>` 包裹，控制显隐
- `isGroupActive` 函数检测当前路由是否在分组下
- 优先尊重用户手动折叠选择，其次自动展开当前路由分组

---

## 十一、已知限制与外部依赖

| 限制 | 说明 |
|------|------|
| metrics-server | 不支持 informer watch，每次请求实时查询 REST API |
| nginx 离线包体积 | 比 Node.js 版大 65MB（含 109 个 DEB 依赖） |
| informer 内存占用 | 全量缓存 33 种资源类型，大规模集群需关注内存 |
| 前端排序 | 客户端排序，仅对当前页数据生效 |
| SelfSubjectRulesReview | 只探测 default namespace 权限，全局权限通过 ClusterRole 推断 |
| 日志后端历史数据 | 曾被物理删除，用户需手动重新配置 |
| namespace 级用户"全部命名空间" | 已修复：后端将授权 NS 列表逗号拼接后过滤，不再只返回 default |
| 标签筛选模糊匹配 | 已修复：`matchLabels` 从精确匹配改为大小写不敏感的包含匹配，`app=f` 可匹配 `app=fluent-bit` |

---

## 十二、启动方式

### 12.1 开发环境（推荐）

**后端：**
```bash
cd /data/projects/cloudops-v2
go build -o cloudops-backend ./cmd/server
nohup ./cloudops-backend > backend.log 2>&1 &
```

**前端（热更新）：**
```bash
cd /data/projects/cloudops-v2/frontend
npm run dev          # 端口 18000，支持 HMR 热更新
```

前端代理已配置（`vite.config.ts`）：`/api`、`/ws`、`/uploads` 自动代理到 `localhost:9000`。

**停止：**
```bash
pkill -f cloudops-backend
pkill -f "vite --port"
```

### 12.2 验证生产构建

```bash
cd /data/projects/cloudops-v2/frontend
npm run build        # 生成 dist/
npm run preview      # 端口 18000，预览生产产物
```

### 12.3 生产/离线环境（nginx）

```bash
# 安装 nginx（离线包已预下载 DEB）
dpkg -i deps/nginx/*.deb || true

# 部署配置（install.sh 自动完成）
sed -e "s|{{INSTALL_DIR}}|/opt/cloudops|g" \
    -e "s|{{FRONTEND_PORT}}|18000|g" \
    -e "s|{{BACKEND_PORT}}|9000|g" \
    config/nginx-cloudops.conf \
    > /etc/nginx/sites-available/cloudops
ln -sf /etc/nginx/sites-available/cloudops /etc/nginx/sites-enabled/cloudops
rm -f /etc/nginx/sites-enabled/default

# 启动
nginx -t && systemctl restart nginx && systemctl enable nginx
nohup ./cloudops-backend > backend.log 2>&1 &
```

> **注意**：`serve-frontend.js`（Node.js 零依赖脚本）已废弃，WebSocket 高并发下会崩溃，生产/离线环境必须使用 **nginx**。

## 十三、发布流程（代码修改后必做）

> **原则**：每次修改代码后，必须**重新编译 → 重启服务 → 重新打包离线包**，否则运行环境还是旧版本。

### 13.1 开发环境（修改后立即验证）

**前端修改后：**
```bash
cd /data/projects/cloudops-v2/frontend
npm run build              # 生成 dist/
```

**后端修改后：**
```bash
cd /data/projects/cloudops-v2
go build -o cloudops-backend ./cmd/server

# 重启后端
pkill -f cloudops-backend
nohup ./cloudops-backend > backend.log 2>&1 &
```

### 13.2 更新离线包（保持离线包永远最新）

```bash
cd /data/projects/cloudops-v2

# 1. 构建后端
go build -o offline-package/bin/cloudops-backend ./cmd/server

# 2. 构建前端并复制到离线包
cd frontend
npm run build
cd ..
cp -r frontend/dist/* offline-package/frontend/dist/

# 3. 重新打包
rm -f cloudops-offline-ubuntu22.tar.gz
tar czf cloudops-offline-ubuntu22.tar.gz offline-package/

# 4. 推送到 GitHub
git add -A
git commit -m "feat/fix: xxx"
git push origin main
```

### 13.3 生产环境升级（已有旧版本）

**不要重新运行 `install.sh`**，因为 `install.sh` 会重新生成 `config.yaml`，覆盖数据库密码和 JWT secret，导致所有用户登录失效。

使用离线包自带的 `upgrade.sh`：

```bash
# 1. 传包到服务器
scp cloudops-offline-ubuntu22.tar.gz root@<服务器IP>:/opt/

# 2. 服务器上解压并执行升级
ssh root@<服务器IP> '
  cd /opt
  tar xzf cloudops-offline-ubuntu22.tar.gz
  cd offline-package
  ./upgrade.sh --yes
'
```

`upgrade.sh` 行为：
- 停止现有服务
- 备份当前版本到 `backup/YYYYMMDD_HHMMSS/`
- 替换后端二进制、前端 dist、data 目录
- **保留 `config.yaml` 和数据库**
- 启动服务，后端自动执行 AutoMigrate 更新表结构

如需手动回滚：
```bash
BACKUP_DIR="/opt/cloudops/backup/20250101_120000"
cp "${BACKUP_DIR}/cloudops-backend" /opt/cloudops/
cp -r "${BACKUP_DIR}/dist" /opt/cloudops/frontend/
systemctl restart cloudops-backend
```

---

## 十四、常用运维命令

```bash
# 后端编译
go build -o cloudops-backend ./cmd/server

# 前端编译
cd frontend && npm run build

# 检查服务状态
curl -s http://localhost:9000/health
ss -ntl | grep -E '9000|18000|5432|6379'

# 查看后端日志
tail -f backend.log

# 数据库连接
psql -h localhost -U cloudops -d cloudops

# Redis
redis-cli ping
```

---

## 十三、文件索引

| 文件 | 说明 |
|------|------|
| `cmd/server/main.go` | 后端入口 |
| `internal/api/routes.go` | 路由注册 |
| `internal/api/middleware/rbac.go` | RBAC 中间件 + 资源名映射 |
| `internal/api/middleware/cluster_state.go` | 集群离线拦截 |
| `internal/api/middleware/user_exist.go` | 用户存在 + 状态检查 |
| `internal/api/handlers/k8s.go` | K8s 资源列表/详情/CRUD handler |
| `internal/service/k8s_manager.go` | Informer 管理 + ClusterClient + 资源列表过滤 |
| `internal/service/k8s_resource_service.go` | 资源 CRUD + 状态转换 + metrics |
| `internal/service/cluster_service.go` | 集群管理 + 健康检查 + 权限探测 |
| `internal/service/agent_service.go` | AI Agent 逻辑 |
| `internal/pkg/ai/hermes.go` | Hermes Provider |
| `internal/pkg/ai/openclaw.go` | OpenClaw Provider |
| `internal/pkg/ai/ollama.go` | Ollama Provider |
| `internal/pkg/ws/hub.go` | WebSocket Hub |
| `frontend/src/pages/ClusterDetail.tsx` | 集群详情（资源列表、弹窗、排序） |
| `frontend/src/pages/Clusters.tsx` | 集群管理列表 |
| `frontend/src/pages/AI.tsx` | AI 助手页面 |
| `frontend/src/components/ResourceEditorDialog.tsx` | 资源创建/编辑弹窗 |
| `frontend/src/lib/k8s-api.ts` | K8s API 封装 |
| `frontend/src/lib/ws.ts` | WebSocket 客户端 |
| `frontend/src/hooks/usePermission.ts` | 权限查询 hook |
| `internal/api/handlers/terminal.go` | Web 终端 handler（chroot + Namespace 沙箱） |
| `offline-package/install.sh` | 离线安装脚本（首次部署） |
| `offline-package/upgrade.sh` | 离线升级脚本（保留配置和数据） |
| `offline-package/config/nginx-cloudops.conf` | nginx 配置模板 |
| `scripts/prepare-deps.sh` | 联网预下载依赖脚本 |
| `internal/api/handlers/k8s.go` | 资源列表接口（含 namespace 级权限过滤） |

---

## 十四、Windows 开发环境

> 场景：Kimi Code CLI + Go + Node.js 全部在 Windows VDI 上运行，数据库（Redis/PostgreSQL）部署在远程 Linux 服务器。

### 14.1 环境安装

**Kimi Code CLI：**
```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
uv tool install kimi-cli
```

**Go：**
从 https://go.dev/dl/ 下载 `go1.22.windows-amd64.msi` 双击安装。

**Node.js：**
从 https://nodejs.org 下载 LTS 版 `.msi` 双击安装。

### 14.2 数据库远程连接

修改 `config/config.yaml`：
```yaml
database:
  host: <linux-ip>      # Linux 服务器 IP
  port: 5432
redis:
  host: <linux-ip>      # Linux 服务器 IP
  port: 6379
```

Linux 服务器放行：
```bash
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'" /etc/postgresql/14/main/postgresql.conf
sudo bash -c 'echo "host all all 0.0.0.0/0 scram-sha-256" >> /etc/postgresql/14/main/pg_hba.conf'
sudo sed -i 's/^bind 127.0.0.1/bind 0.0.0.0/' /etc/redis/redis.conf
sudo systemctl restart postgresql redis-server
```

### 14.3 Windows 启动前后端

```powershell
# 后端
cd C:\cloudops-v2
go build -o cloudops-backend.exe ./cmd/server
.\cloudops-backend.exe

# 前端（另一个 Terminal）
cd C:\cloudops-v2\frontend
npm install
npm run dev
```

访问：`http://localhost:18000`

> 前后端在同一台 Windows 上，vite.config.ts proxy 配置无需修改。

### 14.4 编译部署到 Linux

**Windows 上交叉编译：**
```powershell
$env:GOOS = "linux"; $env:GOARCH = "amd64"; $env:CGO_ENABLED = "0"
go build -o cloudops-backend ./cmd/server

cd frontend
npm run build
```

**上传到 Linux：**
```powershell
scp cloudops-backend root@<linux-ip>:/opt/cloudops/
scp -r frontend/dist root@<linux-ip>:/opt/cloudops/frontend/
```

**Linux 上启动：**
```bash
cd /opt/cloudops
nohup ./cloudops-backend > backend.log 2>&1 &
systemctl restart nginx
```

### 14.5 用户现场离线部署

使用预编译的离线包：
```bash
tar xzf cloudops-offline-ubuntu22.tar.gz -C /opt/
cd /opt/cloudops-offline
./install.sh --db-password "xxx" --yes
```
