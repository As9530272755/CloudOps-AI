# API 接口文档

CloudOps Platform 采用 RESTful API 设计，所有业务接口统一以 `/api/v1` 为前缀。认证接口除外，其余接口需在 HTTP Header 中携带 `Authorization: Bearer <token>`。

---

## 一、认证相关

### POST /api/v1/auth/login
用户登录

**请求体：**
```json
{
  "username": "admin",
  "password": "admin"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "user": {
      "id": 1,
      "username": "admin",
      "email": "admin@cloudops.local",
      "is_superuser": true,
      "tenant_id": 1
    }
  }
}
```

### POST /api/v1/auth/logout
用户登出

### GET /api/v1/auth/profile
获取当前登录用户信息

---

## 二、集群管理

### GET /api/v1/clusters
获取集群列表

### POST /api/v1/clusters
创建集群

**请求体：**
```json
{
  "name": "prod-k8s",
  "display_name": "生产集群",
  "description": "核心业务集群",
  "auth_type": "kubeconfig",
  "kubeconfig": "apiVersion: v1\n..."
}
```

### GET /api/v1/clusters/:id
获取集群详情

### DELETE /api/v1/clusters/:id
删除集群

---

## 三、K8s 资源管理

### GET /api/v1/clusters/:id/namespaces
获取集群命名空间列表

### GET /api/v1/clusters/:id/stats
获取集群统计信息

### POST /api/v1/clusters/:id/refresh
刷新集群缓存

### GET /api/v1/search/resources
全局搜索资源

**查询参数：**
- `keyword`：搜索关键词
- `limit`：返回数量，默认 20

### GET /api/v1/clusters/:id/resources/:kind
获取指定类型资源列表

**查询参数：**
- `namespace`：命名空间过滤
- `page`：页码
- `limit`：每页数量

**支持的 kind：** `pods`, `deployments`, `services`, `nodes`, `configmaps`, `secrets`, `ingresses`, `persistentvolumes`, `events`, `namespaces` 等

### GET /api/v1/clusters/:id/resources/:kind/:name
获取资源详情

### GET /api/v1/clusters/:id/resources/:kind/:name/yaml
获取资源 YAML 定义

---

## 四、AI 对话

### POST /api/v1/ai/chat
非流式 AI 对话

**请求体：**
```json
{
  "messages": [
    { "role": "system", "content": "你是 K8s 专家" },
    { "role": "user", "content": "Pod 一直处于 Pending 怎么办？" }
  ],
  "session_id": "sess-abc123"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "content": "Pod 处于 Pending 通常是因为..."
  }
}
```

### POST /api/v1/ai/chat/stream
流式 AI 对话（SSE）

返回 `text/event-stream`，每行数据格式：
```
data: {"content":"第一步","done":false}

data: {"content":"","done":true}

```

### POST /api/v1/ai/chat/task ⭐ 新增
创建异步 AI 任务

**请求体：** 同 `/ai/chat`

**响应：**
```json
{
  "success": true,
  "data": {
    "task_id": "task-1713024000000000000",
    "status": "running"
  }
}
```

### GET /api/v1/ai/chat/task/:id ⭐ 新增
轮询任务状态

**响应：**
```json
{
  "success": true,
  "data": {
    "id": "task-1713024000000000000",
    "status": "running",
    "result": "当前已返回的部分内容...",
    "error": "",
    "updated_at": "2026-04-13T14:30:00+08:00"
  }
}
```

---

## 五、AI 平台配置

### GET /api/v1/settings/ai
获取当前 AI 平台配置

### PUT /api/v1/settings/ai
更新 AI 平台配置

**请求体：**
```json
{
  "provider": "openclaw",
  "url": "http://127.0.0.1:18789",
  "token": "sk-xxx",
  "model": "openclaw"
}
```

### POST /api/v1/settings/ai/test
测试 AI 平台连接

### GET /api/v1/settings/ai/models
获取 AI 平台可用模型列表

---

## 六、巡检中心

### GET /api/v1/inspection/tasks
获取巡检任务列表

### POST /api/v1/inspection/tasks
创建巡检任务

### GET /api/v1/inspection/tasks/:id
获取巡检任务详情

### PUT /api/v1/inspection/tasks/:id
更新巡检任务

### DELETE /api/v1/inspection/tasks/:id
删除巡检任务

### POST /api/v1/inspection/tasks/:id/trigger
手动触发巡检任务

### POST /api/v1/inspection/quick
快速巡检

### GET /api/v1/inspection/jobs
获取巡检任务执行记录

### GET /api/v1/inspection/jobs/:id/report
下载巡检报告

### GET /api/v1/inspection/results/:id
获取巡检结果详情

---

## 七、网络追踪

### GET /api/v1/network-trace/config
获取网络追踪配置

### PUT /api/v1/network-trace/config
更新网络追踪配置

### GET /api/v1/clusters/:id/network/flows/topology
获取流量拓扑图

### POST /api/v1/clusters/:id/network/flows/enhance
增强拓扑分析

### GET /api/v1/clusters/:id/network/flows/traffic
获取 Pod 流量数据

### GET /api/v1/clusters/:id/network/flows/list
获取流量连接列表

### GET /api/v1/clusters/:id/network/flows/timeseries
获取流量时序数据

### POST /api/v1/clusters/:id/network/debug
创建网络调试任务（启动 ephemeral container 抓包）

### GET /api/v1/clusters/:id/network/debug/logs
获取网络调试日志

---

## 八、通用响应格式

所有 API 返回统一结构：

```json
{
  "success": true,
  "data": { ... },
  "error": "错误信息"
}
```

- `success` 为 `true` 时，`data` 包含业务数据
- `success` 为 `false` 时，`error` 包含错误描述

---

## 九、状态码说明

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 请求成功（业务结果需查看 `success` 字段） |
| 400 | 参数错误 |
| 401 | 未授权，Token 无效或已过期 |
| 404 | 接口不存在或资源未找到 |
| 500 | 服务器内部错误 |
