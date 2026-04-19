# Web 终端权限分析

> 分析 CloudOps Web Terminal 与 NS 级权限的集成问题。
>
> 核心问题：
> 1. 用户是否有 Web 终端使用权限？
> 2. 如果给他们使用终端，他们是否能只识别/操作自己 NS 中的 Pod？

---

## 一、当前终端实现分析

### 1.1 现有代码逻辑

```
用户点击"终端"按钮
    ↓
前端打开 WebSocket: ws://host/ws/terminal?cluster_id=1&token=xxx
    ↓
后端 handler 处理：
  1. JWT 认证 → 获取 user_id
  2. 权限检查：IsSuperuser OR ClusterPermission.CanExec
  3. 获取集群 kubeconfig（当前所有用户共用同一个）
  4. 创建 chroot + Linux Namespace 沙盒
  5. 将 kubeconfig 注入沙盒 ~/.kube/config
  6. 启动 bash shell，通过 WebSocket 双工通信
```

### 1.2 当前权限检查的缺陷

```go
// 当前代码 (terminal.go:71-82)
if !claims.IsSuperuser {
    var perm model.ClusterPermission
    hasExec := false
    if err := h.db.Where("user_id = ? AND cluster_id = ?", userID, clusterID).First(&perm).Error; err == nil {
        hasExec = perm.CanExec  // ← 只有 true/false，没有 NS 维度
    }
    if !hasExec {
        c.AbortWithStatusJSON(403, gin.H{"error": "无终端执行权限"})
        return
    }
}
```

**问题**：
- 权限是**集群级布尔值**，不是 NS 级
- 无法区分"用户1在NS-A有终端权限，在NS-B没有"
- 所有有终端权限的用户看到的是同一个 kubeconfig

---

## 二、核心问题解答

### 2.1 用户是否有 Web 终端使用权限？

**答：由角色模板中的 `terminal:use` 权限决定。**

根据 V3 方案中的角色定义：

| 角色 | 是否含 `terminal:use` | 能否使用终端 |
|------|----------------------|-------------|
| `platform-admin` | ✅ | 能 |
| `cluster-admin` | ✅ | 能 |
| `cluster-viewer` | ✅ | 能（只读终端） |
| `namespace-admin` | ✅ | 能 |
| `namespace-operator` | ✅ | 能 |
| `namespace-viewer` | ❌ | **不能** |

**即：viewer 角色用户无法打开 Web 终端。**

### 2.2 终端内能否只操作自己 NS 中的 Pod？

**答：这取决于注入终端的 kubeconfig 权限，不是 CloudOps 说了算。**

#### 情况分析

```
场景：用户张三 在 Cluster-A 的 NS-B 是 admin，但没有其他 NS 权限

CloudOps 终端注入的是 Cluster-A 的 kubeconfig（当前是 viewer 级别 ServiceAccount）

张三在终端执行：
  $ kubectl get pods -n ns-b      → ✅ 能看（viewer 能读）
  $ kubectl get pods -n ns-a      → ✅ 能看（viewer 能读所有 NS）
  $ kubectl delete pod xxx -n ns-b → ❌ 不能删（viewer 不能删）
  $ kubectl delete pod xxx -n ns-a → ❌ 不能删（viewer 不能删）
```

**关键发现**：
- 当前所有终端共用 **viewer 级别 kubeconfig**
- 即使 CloudOps 给张三 NS-B 授权了 admin，终端里也只能做 viewer 能做的事
- 终端内 kubectl 的行为由 **K8s RBAC（ServiceAccount）** 控制，不是 CloudOps 的 `NamespaceGrant`

#### 理想情况 vs 现实

```
理想（用户期望）：
  张三在终端里只能看到 NS-B 的 Pod，看不到 NS-A 的

现实（当前实现）：
  张三在终端里能看到所有 NS 的 Pod（因为 viewer SA 通常有全局 list 权限）
  但只能读不能写

差距：
  CloudOps 的 NS 授权 ≠ K8s 的 RBAC 授权
  终端里的 kubectl 听 K8s 的，不听 CloudOps 的
```

---

## 三、解决方案

### 方案 A：终端功能按角色开放，但权限受 K8s RBAC 限制（推荐，最简单）

```
CloudOps 角色 → 终端权限 → 终端内 kubectl 权限
─────────────────────────────────────────────────
namespace-viewer    ❌ 不能使用终端      —
namespace-operator  ✅ 能使用终端      viewer 凭证（只能读，不能写/删）
namespace-admin     ✅ 能使用终端      viewer 凭证（只能读，不能写/删）
cluster-admin       ✅ 能使用终端      admin 凭证（全部权限）
```

**优点**：
- 实现简单，不改终端架构
- 安全：viewer 根本进不了终端
- operator/admin 虽然有终端，但 kubectl 受 SA 权限限制

**缺点**：
- operator/admin 在 CloudOps 里有更多权限，但在终端里只能读
- 用户可能困惑："我在 CloudOps 能删 Pod，为什么在终端里不能？"

**适用**：当前 viewer-only 凭证阶段

---

### 方案 B：多凭证注入 + NS 隔离（增强版）

```
终端启动时：
  1. 查询用户的 EffectiveRole（cluster + namespace）
  2. 根据角色选择对应凭证级别：
     - admin → 注入 admin kubeconfig
     - operator → 注入 operator kubeconfig
     - viewer → 拒绝连接
  3. 额外注入 kubectl alias 限制：
     alias kubectl='kubectl -n <授权NS>'
     alias k='kubectl -n <授权NS>'
```

**如果用户有多个 NS 授权**：
```
张三在 Cluster-A 有：NS-B(admin) + NS-C(viewer)

终端注入：
  KUBECONFIG=admin-kubeconfig  ← 因为有 admin 需求
  alias kb='kubectl -n ns-b'   ← 快捷操作 NS-B
  alias kc='kubectl -n ns-c'   ← 快捷操作 NS-C
  alias kubectl='kubectl --all-namespaces=false'  ← 不允许跨 NS
```

**但有个根本问题**：

kubectl 的 `-n` 只是默认 NS，用户可以通过 `--all-namespaces` 或 `-n other-ns` 绕过。

**真正的 NS 隔离需要 K8s 层面的限制**：

```yaml
# 为每个用户/角色创建专用的 ServiceAccount + RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cloudops-zhangsan-nsb-admin
  namespace: ns-b
subjects:
- kind: ServiceAccount
  name: cloudops-zhangsan
  namespace: cloudops-system
roleRef:
  kind: Role
  name: namespace-admin  # pod:*, deployment:*, service:*
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cloudops-zhangsan-nsc-viewer
  namespace: ns-c
subjects:
- kind: ServiceAccount
  name: cloudops-zhangsan
  namespace: cloudops-system
roleRef:
  kind: Role
  name: namespace-viewer  # pod:read, deployment:read
  apiGroup: rbac.authorization.k8s.io
```

这样张三的 ServiceAccount 在 ns-b 是 admin，在 ns-c 是 viewer，在其他 NS 无任何权限。

**方案 B 完整流程**：

```
用户打开终端
    ↓
后端查询用户的所有 NamespaceGrant
    ↓
为该用户创建/复用专用 ServiceAccount（每个集群一个）
    ↓
根据 NamespaceGrant 创建 RoleBinding（按需创建/更新）
    ↓
生成该 ServiceAccount 的 token → 写入 kubeconfig
    ↓
注入终端
    ↓
用户在终端执行 kubectl → 受 K8s RBAC 限制，只能操作授权的 NS
```

**优点**：
- 真正的 NS 级隔离
- CloudOps 权限与 K8s 权限一致
- operator/admin 在终端里也能做写操作

**缺点**：
- 复杂度高：需要维护 ServiceAccount + RoleBinding
- 需要集群内安装 CloudOps Agent 或前置服务来创建 RBAC
- 需要 admin 凭证才能创建 RoleBinding（当前只有 viewer 凭证）
- 用户多了之后 ServiceAccount 数量爆炸

---

### 方案 C：终端只读模式（折中）

```
所有能使用终端的用户（operator/admin）
终端内只注入 viewer 凭证

额外功能：
  - 在 CloudOps 页面点"进入终端"时，自动携带 NS 上下文
  - 终端启动后自动执行：kubectl config set-context --current --namespace=<NS>
  - 用户默认就在自己的 NS 里操作

限制：
  - 用户仍可通过 -n 切换 NS（但 viewer 凭证在其他 NS 也只能读）
  - 不能做写操作（kubectl apply/delete/edit 会被 K8s 拒绝）
```

**适用**：当前阶段（只有 viewer 凭证），保证安全的同时提供终端便利

---

## 四、推荐方案（分阶段）

### 第一阶段（当前 viewer-only 凭证）

采用 **方案 A + 方案 C 的自动 NS 上下文**：

```
1. 终端权限由 CloudOps NS 授权控制：
   - namespace-viewer → 前端"终端"按钮灰色不可点
   - namespace-operator/admin → 前端"终端"按钮可用

2. 终端内只注入 viewer kubeconfig（当前唯一凭证）

3. 终端启动时自动设置默认 NS：
   kubectl config set-context --current --namespace=<用户授权的NS>
   
   如果用户在该集群有多个 NS 授权：
   - 默认进入第一个 admin 级别的 NS
   - 提供 alias：ka='kubectl -n ns-a', kb='kubectl -n ns-b'

4. 用户实际能做的事：
   - kubectl get pods/services/deployments（读操作）
   - kubectl logs（读日志）
   - kubectl exec（viewer 凭证通常不允许）
   - kubectl delete/edit/apply（会被 K8s 拒绝）
```

### 第二阶段（有了 admin/operator 凭证后）

升级为 **方案 B 简化版**：

```
1. 按用户角色注入对应级别凭证：
   - namespace-admin → admin kubeconfig
   - namespace-operator → operator kubeconfig
   
2. 仍然限制默认 NS（kubectl config set-context）

3. 用户可以做写操作，但只能在自己的 NS 内
   （因为 admin/operator kubeconfig 也是 NS-scoped 的 ServiceAccount）
```

### 第三阶段（完整 RBAC 同步）

```
1. CloudOps 自动在集群内创建 ServiceAccount + RoleBinding
2. 真正的 NS 级隔离
3. 用户甚至无法通过 kubectl 看到未授权的 NS
```

---

## 五、终端权限检查代码（第一阶段）

```go
// terminal.go - 权限检查改造

func (h *TerminalHandler) Terminal(c *gin.Context) {
    // 1. 认证
    tokenStr := c.Query("token")
    // ... JWT 验证
    userID := claims.UserID
    
    // 2. 解析 cluster_id
    clusterID, _ := strconv.ParseUint(c.Query("cluster_id"), 10, 32)
    
    // 3. 获取 namespace 参数（新增）
    namespace := c.Query("namespace")
    if namespace == "" {
        c.AbortWithStatusJSON(400, gin.H{"error": "必须指定 namespace"})
        return
    }
    
    // 4. NS 级权限检查（替换原有 ClusterPermission 检查）
    rbacService := service.NewRBACService(h.db)
    effectiveRole, err := rbacService.GetEffectiveRole(c.Request.Context(), userID, uint(clusterID), namespace)
    if err != nil {
        c.AbortWithStatusJSON(403, gin.H{"error": "您无权访问该命名空间的终端"})
        return
    }
    
    // 5. 检查是否有 terminal:use 权限
    if !effectiveRole.Role.HasPermission("terminal", "use") {
        c.AbortWithStatusJSON(403, gin.H{
            "error": "您的角色 " + effectiveRole.Role.DisplayName + " 没有终端使用权限",
            "required": "terminal:use",
        })
        return
    }
    
    // 6. 获取对应级别的 kubeconfig
    credentialLevel := effectiveRole.Role.GetCredentialLevel()
    kubeconfigBytes, err := h.k8sManager.GetClusterKubeconfigByLevel(uint(clusterID), credentialLevel)
    if err != nil {
        // 降级到 viewer
        kubeconfigBytes, err = h.k8sManager.GetClusterKubeconfigContent(uint(clusterID))
        if err != nil {
            c.AbortWithStatusJSON(500, gin.H{"error": "获取集群凭证失败"})
            return
        }
        credentialLevel = "viewer"
    }
    
    // 7. 创建沙盒...
    
    // 8. 注入 kubeconfig + 设置默认 NS
    // 在 .bashrc 中追加：
    //   kubectl config set-context --current --namespace=<namespace>
    //   echo "默认命名空间: <namespace>"
    
    // 如果用户有多个 NS 授权，创建 alias
    allowedNS, _ := rbacService.GetAllowedNamespaces(c.Request.Context(), userID, uint(clusterID))
    // 生成 alias 脚本...
}
```

---

## 六、前端按钮控制

```typescript
// PodListPage.tsx
const PodListPage = ({ clusterID, namespace }) => {
    const { canUseTerminal, credentialLevel } = useNSPermission(clusterID, namespace);
    
    return (
        <Table>
            {pods.map(pod => (
                <TableRow key={pod.name}>
                    <TableCell>{pod.name}</TableCell>
                    <TableCell>
                        {/* 终端按钮 */}
                        {canUseTerminal ? (
                            <Tooltip title={`进入终端 (${credentialLevel} 权限)`}>
                                <IconButton 
                                    onClick={() => openTerminal(clusterID, namespace, pod.name)}
                                    color="primary"
                                >
                                    <TerminalIcon />
                                </IconButton>
                            </Tooltip>
                        ) : (
                            <Tooltip title="当前角色无终端权限">
                                <span>
                                    <IconButton disabled>
                                        <TerminalIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        )}
                        
                        {/* 删除按钮 */}
                        {canDeletePod && (
                            <IconButton color="error">
                                <DeleteIcon />
                            </IconButton>
                        )}
                    </TableCell>
                </TableRow>
            ))}
        </Table>
    );
};
```

---

## 七、总结

| 问题 | 答案 |
|------|------|
| 用户是否有终端权限？ | 由 `terminal:use` 权限控制，viewer 角色**没有** |
| 终端内能否只操作自己 NS？ | **当前不能**（所有用户共用 viewer 凭证，kubectl 受 K8s RBAC 限制） |
| 如何改进？ | 第一阶段：按角色控制终端入口 + 自动设置默认 NS；第二阶段：多凭证注入 |
| 安全风险 | viewer 进不了终端；operator/admin 能进但只能读（当前凭证限制），较安全 |

---

*分析日期：2026-04-19*
*结论：第一阶段先实现"按角色控制终端入口"，等 admin/operator 凭证到位后再做"多凭证注入"*
