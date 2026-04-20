# Kubeconfig 权限控制前端按钮显示方案

> 基于现有用户管理 + NS 授权体系，叠加 kubeconfig 真实能力约束

---

## 一、设计原则

**分层控制，各司其职：**

| 层级 | 控制什么 | 决策依据 | 粒度 |
|------|---------|---------|------|
| **平台权限** | 用户能否看到「集群管理」菜单 | Role.permissions_data | 平台级 |
| **NS 授权** | 用户能看到哪些集群 / 哪些 NS | NamespaceGrant | NS 级 |
| **Kubeconfig 权限** | 进了集群后能不能创建/编辑/删除 | cluster.permission_scope | 集群级 |

**核心公式：**

```
最终按钮显示 = 用户有平台权限 AND 用户有 NS 授权 AND kubeconfig 支持写操作
```

---

## 二、现状分析

### 已有基础

1. `probePermissionScope` 已存在，返回 `read-only` / `read-write` / `admin` / `unknown`
2. 结果存储在 `cluster.permission_scope` 字段
3. 前端 `ClusterDetail.tsx` 已部分使用 `permission_scope` 控制按钮
4. 用户管理 Phase 1 已完成（Role / NamespaceGrant / 模块权限）

### 当前问题

1. `probePermissionScope` 只探测 `default` namespace，对 ClusterRole 判断不准确
2. 部分按钮（如详情弹窗内的「编辑 YAML」）可能遗漏了 `permission_scope` 判断
3. `unknown` 状态下按钮行为不一致

---

## 三、后端改造

### 3.1 修复 `probePermissionScope` 探测逻辑

**文件：** `internal/service/cluster_service.go`

**问题：** 当前只探测 `default` namespace 的权限，如果用户是 ClusterRoleBinding（全局权限），在 `default` NS 探测会漏判。

**改造：** 同时探测「全局权限」和 `default` namespace 权限，取最严格的。

```go
func (s *ClusterService) probePermissionScope(ctx context.Context, client *kubernetes.Clientset) string {
    // 1. 探测全局权限（ClusterRole）
    globalReview := &authorizationv1.SelfSubjectRulesReview{
        Spec: authorizationv1.SelfSubjectRulesReviewSpec{
            Namespace: "", // 空字符串 = 全局
        },
    }
    globalResult, err := client.AuthorizationV1().SelfSubjectRulesReviews().Create(ctx, globalReview, metav1.CreateOptions{})
    globalScope := evaluateRules(globalResult.Status.ResourceRules)

    // 2. 探测 default namespace 权限（Role）
    nsReview := &authorizationv1.SelfSubjectRulesReview{
        Spec: authorizationv1.SelfSubjectRulesReviewSpec{
            Namespace: "default",
        },
    }
    nsResult, _ := client.AuthorizationV1().SelfSubjectRulesReviews().Create(ctx, nsReview, metav1.CreateOptions{})
    nsScope := evaluateRules(nsResult.Status.ResourceRules)

    // 3. 探测失败时默认 read-only（安全保守）
    if err != nil && nsResult == nil {
        return "read-only"
    }

    // 4. 取最严格的
    return stricterScope(globalScope, nsScope)
}

func evaluateRules(rules []authorizationv1.ResourceRule) string {
    hasWrite := false
    hasDelete := false
    for _, rule := range rules {
        for _, verb := range rule.Verbs {
            if verb == "*" {
                return "admin"
            }
            if verb == "create" || verb == "update" || verb == "patch" {
                hasWrite = true
            }
            if verb == "delete" {
                hasDelete = true
            }
        }
    }
    if hasWrite && hasDelete {
        return "admin"
    }
    if hasWrite {
        return "read-write"
    }
    return "read-only"
}

func stricterScope(a, b string) string {
    order := map[string]int{
        "admin":      3,
        "read-write": 2,
        "read-only":  1,
        "unknown":    0,
    }
    if order[a] < order[b] {
        return a
    }
    return b
}
```

### 3.2 已有集群补充探测

**文件：** `internal/service/cluster_service.go` → `StartHealthMonitor`

**问题：** 已有集群的 `permission_scope` 可能是 `unknown`（添加时探测失败）。

**改造：** 健康检查 Monitor 中，如果 `permission_scope == "unknown"`，补充探测一次。

```go
// probeClusterHealth 中
if newStatus == "healthy" {
    // 补充探测权限（仅 unknown 时）
    s.healthMu.RLock()
    clusterMeta := /* 查询 cluster 表 */
    s.healthMu.RUnlock()
    if clusterMeta.PermissionScope == "unknown" || clusterMeta.PermissionScope == "" {
        go s.refreshPermissionScope(clusterID)
    }
}
```

### 3.3 确保 `ListClusters` / `GetCluster` 返回 `permission_scope`

**文件：** `internal/service/cluster_service.go` → `ListClusters`

**现状：** `Cluster` 模型的 `permission_scope` 已带 `json` tag，API 应该已经返回。

**验证：** 检查 `ListClusters` 的返回结构是否包含 `permission_scope`。

---

## 四、前端改造

### 4.1 统一封装权限判断 Hook

**文件：** 新建 `frontend/src/hooks/useClusterWritePermission.ts`

```ts
import { useMemo } from 'react'

export function useClusterWritePermission(cluster: { permission_scope?: string } | null) {
  return useMemo(() => {
    if (!cluster) return false
    const scope = cluster.permission_scope
    return scope === 'admin' || scope === 'read-write'
  }, [cluster?.permission_scope])
}
```

### 4.2 ClusterDetail.tsx 按钮统一改造

**改造点清单：**

| 位置 | 当前逻辑 | 改造后 |
|------|---------|--------|
| 资源 Tab 栏下方「创建」按钮 | `permission_scope === 'admin' \|\| 'read-write'` | 使用 `useClusterWritePermission` |
| 列表表头「操作」列 | 同上 | 同上 |
| 列表行内「编辑/删除」按钮 | 同上 | 同上 |
| 资源详情弹窗「编辑 YAML」按钮 | 同上 | 同上 |
| YAML 编辑器弹窗「保存」按钮 | 同上 | 同上 |

**统一模式：**

```tsx
const canWrite = useClusterWritePermission(cluster)

// 创建按钮
{canWrite && <Button variant="contained">创建</Button>}

// 操作列
{canWrite && (
  <TableCell align="right">
    <Button size="small" onClick={handleEdit}>编辑</Button>
    <Button size="small" color="error" onClick={handleDelete}>删除</Button>
  </TableCell>
)}

// 详情弹窗
{canWrite && (
  <Button variant="contained" onClick={handleSave}>保存</Button>
)}
```

### 4.3 read-only 状态 UX 优化

当 `permission_scope === 'read-only'` 时：

1. **创建按钮区域**显示提示文案：
   ```
   当前集群 kubeconfig 为只读权限，无法创建资源
   ```

2. **列表行内**不显示「操作」列，避免空列占宽

3. **详情弹窗**只保留「查看 YAML」按钮，隐藏「编辑 YAML」

### 4.4 unknown 状态处理

当 `permission_scope === 'unknown'` 时：

- 默认隐藏所有写操作按钮（保守策略）
- 显示提示：`权限探测中，请稍后刷新...`
- 等 Monitor 补充探测完成后自动恢复

---

## 五、实施步骤

### Phase 1：后端修复（半天）

1. 改造 `probePermissionScope`（全局 + NS 双重探测）
2. 健康检查 Monitor 补充探测 `unknown` 集群
3. 编译验证 + 重启服务

### Phase 2：前端改造（半天）

1. 新建 `useClusterWritePermission` Hook
2. 统一改造 `ClusterDetail.tsx` 所有按钮渲染点
3. read-only / unknown 状态 UX 优化
4. 编译验证

### Phase 3：测试验证（半天）

1. 准备两个测试集群：
   - 集群 A：read-only kubeconfig
   - 集群 B：read-write kubeconfig
2. 验证集群 A：
   - 不显示创建按钮 ✅
   - 列表无操作列 ✅
   - 详情弹窗无保存按钮 ✅
3. 验证集群 B：
   - 所有按钮正常显示 ✅
   - 创建/编辑/删除功能正常 ✅

---

## 六、对用户管理的影响

| 用户管理功能 | 是否改动 | 说明 |
|-------------|---------|------|
| Role / Permission | ❌ 不改 | 平台权限层独立 |
| NamespaceGrant | ❌ 不改 | NS 授权层独立 |
| `usePermission` Hook | ❌ 不改 | 复用现有 |
| 用户列表 / 编辑 / 授权 | ❌ 不改 | 用户管理页面独立 |
| ClusterDetail 按钮 | ✅ 改 | 叠加 kubeconfig 约束 |

**结论：用户管理功能零侵入。**

---

## 七、工作量评估

| 任务 | 工时 |
|------|------|
| 后端：`probePermissionScope` 改造 | 2h |
| 后端：Monitor 补充探测 | 1h |
| 前端：`useClusterWritePermission` Hook | 0.5h |
| 前端：ClusterDetail 按钮统一改造 | 2h |
| 前端：read-only / unknown UX | 1h |
| 测试验证 | 2h |
| **总计** | **~1.5 天** |

---

## 八、一句话总结

> **集群页按钮 = kubeconfig `permission_scope` 说了算（read-only 全隐藏，read-write 全显示）。**
> 
> **用户数据范围 = NamespaceGrant 说了算（只能看授权的 NS）。**
> 
> **两者取交集：先要有 NS 授权才能进，进了之后 kubeconfig 决定能不能改。**
