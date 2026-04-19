# CloudOps 用户管理模块设计方案 V2

> 针对"KubeSphere 已管理 20+ 集群多用户，CloudOps 需独立接管并支持从只读到读写的渐进扩展"场景设计。
>
> 核心原则：**不改 KubeSphere 现有体系，CloudOps 独立建权，集群支持多凭证分级。**

---

## 一、背景与现状

### 1.1 现状

| 项目 | 现状 |
|------|------|
| K8s 集群 | 20+ 个，10000+ Pod |
| 现有平台 | KubeSphere（已完成多用户、多租户、RBAC） |
| CloudOps 接入方式 | 只读 kubeconfig（get/list/watch） |
| 目标 | 所有功能开发，后续部分集群升级为 admin 读写 kubeconfig |

### 1.2 核心矛盾

```
KubeSphere          CloudOps
──────────          ────────
用户A → 操作集群A    用户A → CloudOps → 只读凭证 → 只能看
用户B → 操作集群B    用户B → CloudOps → 只读凭证 → 只能看
                         ↓
                    所有用户共享同一个凭证
                    无法区分"谁能做什么"
```

**矛盾点**：
- KubeSphere 已经有一套完整的用户/权限/租户体系
- CloudOps 如果重建一套，两套体系不一致（KubeSphere 里用户 A 是 admin，CloudOps 里可能是 viewer）
- 但如果 CloudOps 完全依赖 KubeSphere，就无法独立运行

---

## 二、设计原则

1. **CloudOps 独立建权**：不依赖 KubeSphere 用户体系，保持平台独立性
2. **集群多凭证分级**：一个集群支持配置多个凭证（只读 / 运维 / 管理）
3. **动态凭证路由**：后端根据"当前用户角色"自动选择对应级别的凭证调用 K8s
4. **渐进式扩展**：先支持只读，再支持读写，无需重构已有代码
5. **与 KubeSphere 共存**：两套体系并行，用户自行约定权限一致性

---

## 三、核心架构：多凭证分级路由

### 3.1 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CloudOps 前端                              │
│  用户A (viewer)          用户B (operator)          用户C (admin)    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     CloudOps 后端 (Gin + Go)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ JWT 认证     │→│ 权限中间件   │→│ 凭证路由选择器           │  │
│  │ 获取 UserID  │  │ 查角色/权限  │  │ 根据用户角色选凭证       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                              ↓                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              ClusterSecret 池（每个集群多个）                  │  │
│  │  集群A: [viewer-kubeconfig] [admin-kubeconfig]               │  │
│  │  集群B: [viewer-kubeconfig]                                  │  │
│  │  集群C: [viewer-kubeconfig] [operator-kubeconfig]            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  K8s API 调用                                                │  │
│  │  用户A(viewer) → 用 viewer-kubeconfig → get/list/watch      │  │
│  │  用户B(operator)→ 用 operator-kubeconfig→ 写 Deployment     │  │
│  │  用户C(admin)   → 用 admin-kubeconfig   → 全部操作           │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 为什么这样设计？

| 场景 | 处理方式 | 是否需重构 |
|------|---------|-----------|
| 当前：所有集群只读 | 每个集群只配一个 `viewer` 凭证，所有用户路由到 viewer | ❌ 无需重构 |
| 未来：某集群升级 admin | 给该集群新增 `admin` 凭证，admin 用户路由到 admin | ❌ 只需新增凭证 |
| 未来：某集群分级（viewer/operator/admin） | 给该集群配 2~3 个凭证，按角色路由 | ❌ 只需新增凭证 |
| 未来：集群 A 从 admin 降级回只读 | 删除 admin 凭证，所有用户回落到 viewer | ❌ 只需删凭证 |

**结论**：从只读到读写，不需要改代码，只需要在页面上"新增/删除凭证"。

---

## 四、数据模型设计

### 4.1 ClusterSecret 扩展（核心改动）

```go
type ClusterSecret struct {
    ID            uint       `gorm:"primaryKey"`
    ClusterID     uint       `gorm:"index;not null"`
    SecretType    string     `gorm:"size:50"`        // kubeconfig / token
    EncryptedData string     `gorm:"type:text"`      // 凭证内容（明文）
    
    // ===== 新增字段 =====
    Level         string     `gorm:"size:32;default:'viewer'"`  // viewer / operator / admin
    Description   string     `gorm:"size:255"`                  // 描述：如 "生产集群只读凭证"
    IsDefault     bool       `gorm:"default:false"`             // 是否默认凭证（无匹配时用）
    Priority      int        `gorm:"default:0"`                 // 优先级（同 Level 时选高优先级）
    
    ExpiresAt     *time.Time
    CreatedAt     time.Time
}
```

**Level 定义**：

| Level | K8s 权限范围 | 对应 CloudOps 功能 |
|-------|-------------|-------------------|
| `viewer` | get / list / watch | 查看资源、日志、事件、拓扑、AI 助手 |
| `operator` | viewer + create / update / patch / delete（限定资源） | 以上 + 扩缩容、重启 Pod、编辑 YAML、更新镜像 |
| `admin` | 全部权限 | 以上 + Web Terminal、网络追踪抓包、创建/删除 Namespace、管理 RBAC |

### 4.2 ClusterGrant 扩展（用户-集群授权）

```go
type ClusterGrant struct {
    ID              uint
    UserID          uint
    ClusterID       uint
    RoleTemplateID  uint       // 用户在该集群的角色模板
    
    // ===== 凭证匹配逻辑（新增）=====
    // 不直接绑定 SecretID，而是通过 "RoleTemplate.Level → ClusterSecret.Level" 动态匹配
    // 例如：用户角色是 operator → 后端自动找该集群的 operator 级别凭证
    
    NamespaceScope  string     // 空=全部，否则逗号分隔 NS 白名单
    GrantedBy       uint
    GrantedAt       time.Time
    ExpiresAt       *time.Time
}
```

### 4.3 凭证路由逻辑（核心算法）

```go
// SelectCredential 为用户+集群选择最合适的凭证
func (km *K8sManager) SelectCredential(clusterID uint, userRoleLevel string) (*ClusterSecret, error) {
    // 1. 精确匹配：找与用户角色同级别的凭证
    var secret ClusterSecret
    err := km.db.Where("cluster_id = ? AND level = ?", clusterID, userRoleLevel).
        Order("priority DESC").First(&secret).Error
    
    if err == nil {
        return &secret, nil
    }
    
    // 2. 降级匹配：如果没有 operator 凭证，找 viewer 凭证（只读保底）
    if userRoleLevel == "operator" || userRoleLevel == "admin" {
        err = km.db.Where("cluster_id = ? AND level = ?", clusterID, "viewer").
            Order("priority DESC").First(&secret).Error
        if err == nil {
            // 降级提示：返回凭证但标记为降级
            return &secret, fmt.Errorf("DEGRADED: cluster %d has no %s credential, fallback to viewer", clusterID, userRoleLevel)
        }
    }
    
    // 3. 默认凭证兜底
    err = km.db.Where("cluster_id = ? AND is_default = ?", clusterID, true).
        First(&secret).Error
    if err == nil {
        return &secret, nil
    }
    
    return nil, fmt.Errorf("no available credential for cluster %d", clusterID)
}
```

**降级策略**：
- 用户是 `admin`，但集群只有 `viewer` 凭证 → 降级为只读（前端提示："该集群未配置管理凭证，已降级为只读"）
- 用户是 `operator`，但集群只有 `viewer` 凭证 → 降级为只读
- 用户是 `viewer`，集群有 `admin` 凭证 → 不升级，仍然只用 viewer 权限（CloudOps 中间件拦截）

### 4.4 RoleTemplate 与 Level 映射

```go
// RoleTemplate → 对应的 K8s 凭证级别
var roleLevelMap = map[string]string{
    "platform-admin":     "admin",
    "platform-auditor":   "viewer",
    "cluster-admin":      "admin",
    "cluster-operator":   "operator",
    "cluster-viewer":     "viewer",
    "namespace-admin":    "admin",
    "namespace-operator": "operator",
    "namespace-viewer":   "viewer",
}
```

---

## 五、权限校验 + 凭证路由流程

```
用户请求：DELETE /api/v1/clusters/5/namespaces/default/pods/nginx-xxx
    ↓
[1] JWT 认证 → 获取 UserID
    ↓
[2] 权限中间件
    ├─ 检查用户是否有 "pod:delete" 权限 → 无 → 403
    ├─ 检查用户是否对集群 5 有授权 → 无 → 403
    └─ 获取用户在该集群的角色模板 → "cluster-operator"
    ↓
[3] 凭证路由选择器
    ├─ roleLevelMap["cluster-operator"] → "operator"
    ├─ SelectCredential(clusterID=5, level="operator")
    ├─ 找到集群 5 的 operator 凭证 → 返回
    └─ 如果降级 → 在 gin context 中标记 "credential_degraded=true"
    ↓
[4] 如果是降级场景且请求是写操作
    ├─ 中间件检测到降级 + 写操作 → 直接返回 403
    └─ "该集群未配置 operator 凭证，无法执行写操作"
    ↓
[5] 执行 Handler，用选定凭证调用 K8s API
    ↓
[6] 审计日志记录（含使用的凭证级别）
```

---

## 六、前端交互设计

### 6.1 集群凭证管理（新增页面）

```
集群管理 → 点击集群 → "凭证管理" Tab

┌─────────────────────────────────────────────┐
│ 集群：生产集群-A (10.0.0.11)                 │
├─────────────────────────────────────────────┤
│ 凭证列表                                     │
│ ┌──────────┬──────────┬──────────┬────────┐ │
│ │ 级别     │ 类型     │ 描述     │ 操作   │ │
│ ├──────────┼──────────┼──────────┼────────┤ │
│ │ viewer   │ kubeconfig│ 只读监控 │ 测试   │ │
│ │ operator │ token    │ 运维操作 │ 测试   │ │
│ │ admin    │ —        │ 未配置   │ 添加   │ │
│ └──────────┴──────────┴──────────┴────────┘ │
│                                              │
│ [添加凭证]                                   │
└─────────────────────────────────────────────┘

添加凭证弹窗：
- 级别：viewer / operator / admin（单选）
- 类型：kubeconfig / token
- 内容：文本域粘贴凭证
- 描述：如 "生产集群 admin 凭证（慎用）"
- 优先级：数字（同 Level 冲突时选高的）
- 设为默认：checkbox
```

### 6.2 集群卡片状态显示

```
┌────────────────────────────┐
│ 🔴 生产集群-A               │
│ 10.0.0.11:6443             │
│ 凭证: viewer ✅ operator ❓ │  ← 绿色=已配置，灰色=未配置
│ Pod: 1,234                 │
└────────────────────────────┘
```

### 6.3 降级提示

当用户打开一个没有对应级别凭证的集群时：

```
⚠️ 您当前角色为 "集群运维"，但该集群未配置 operator 级别的凭证。
已自动降级为 "只读模式"，以下功能不可用：
- 删除 Pod
- Web Terminal
- 网络追踪抓包

请联系管理员为该集群添加 operator 凭证。
```

---

## 七、与 KubeSphere 的关系

### 7.1 两套体系如何共存？

```
KubeSphere                        CloudOps
──────────                        ────────
用户A → admin → 集群A            用户A → admin → 集群A
用户B → viewer → 集群A           用户B → viewer → 集群A

┌──────────────────────────────────────────────────────┐
│ 两套体系独立，但建议通过"组织约定"保持一致：          │
│                                                      │
│ 1. 在 CloudOps 中创建与 KubeSphere 对应的角色        │
│ 2. 手动保持用户授权一致（初期）                      │
│ 3. 未来可通过 LDAP/OIDC 统一认证源（Phase 3）        │
└──────────────────────────────────────────────────────┘
```

### 7.2 是否需要打通 KubeSphere API？

**Phase 1/2：不需要。**

理由：
- KubeSphere 的用户/权限模型与 CloudOps 不同，强行打通耦合度高
- KubeSphere 的 API 不稳定，版本升级可能破坏集成
- 两套体系并行是业内常见做法（如 Rancher + OpenShift 共存场景）

**Phase 3（可选）**：
- 如果 KubeSphere 配置了 LDAP/OIDC
- CloudOps 也接入同一个 LDAP/OIDC
- 实现"一套账号，两个平台"（但权限仍需各自管理）

---

## 八、实施阶段（调整版）

### Phase 1：多凭证基础（2 周）

- [ ] 扩展 `ClusterSecret` 模型（Level / Description / IsDefault / Priority）
- [ ] 实现 `SelectCredential` 凭证路由算法
- [ ] 修改 `buildConfig` 为 `buildConfigForUser`（根据当前用户角色选凭证）
- [ ] 集群凭证管理前端页面（新增/编辑/删除/测试凭证）
- [ ] 集群卡片显示凭证配置状态
- [ ] 降级提示组件

### Phase 2：用户管理 + 权限中间件（2 周）

- [ ] 用户 CRUD、角色模板管理
- [ ] `ClusterGrant` 模型 + 集群授权页面
- [ ] 权限校验中间件（Resource + Verb 矩阵）
- [ ] 凭证降级处理逻辑
- [ ] 前端按钮级权限控制

### Phase 3：审计 + 高级功能（2 周）

- [ ] 审计日志（记录使用了哪个 Level 的凭证）
- [ ] 密码策略、登录历史
- [ ] LDAP/OIDC 集成（与 KubeSphere 共用认证源）
- [ ] Web Terminal、网络追踪等高危操作的二次确认

---

## 九、关键决策

### 决策 1：一个集群配几个凭证？

**推荐：最多 3 个**（viewer / operator / admin）。

- 只读集群：配 1 个 viewer
- 生产集群谨慎升级：先配 viewer，需要时再配 operator
- 测试/开发集群：可直接配 admin

### 决策 2：凭证内容存什么？

| 场景 | 推荐方式 | 说明 |
|------|---------|------|
| 只读 | kubeconfig | 长期稳定，不易过期 |
| 运维 | ServiceAccount Token | 可设置 TTL，过期自动失效 |
| 管理 | ServiceAccount Token | 高风险，建议短 TTL + 定期轮换 |

### 决策 3：operator 级别包含哪些 K8s 权限？

建议 operator 在 K8s 层面的权限：

```yaml
# operator ClusterRole 示例
rules:
  # 可读全部
  - apiGroups: ["*"]
    resources: ["*"]
    verbs: ["get", "list", "watch"]
  # 可写常见工作负载
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps", "secrets"]
    verbs: ["create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
    verbs: ["create", "update", "patch", "delete"]
  # 不可操作 Namespace / Node / RBAC / 网络策略
```

---

## 十、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| admin 凭证泄露 | 极高 | Token 短 TTL（7 天）、定期轮换、操作审计 |
| operator 误删生产 Pod | 高 | 高危操作（delete/exec）增加二次确认弹窗 |
| 凭证降级导致用户困惑 | 中 | 前端明确提示降级原因和建议 |
| 多个凭证导致配置混乱 | 中 | 集群卡片直观显示凭证配置状态 |
| KubeSphere 与 CloudOps 权限不一致 | 中 | 组织约定 + 定期审计 + 未来 LDAP 统一 |

---

## 十一、与 V1 方案的主要差异

| 对比项 | V1 方案 | V2 方案（本版） |
|--------|---------|----------------|
| 集群凭证 | 每个集群一个 | 每个集群多个（分级） |
| 只读→读写扩展 | 需改代码 | 只需新增凭证 |
| K8s RBAC 同步 | Phase 3 评估 | **不做**，用多凭证替代 |
| 与 KubeSphere 关系 | 未提及 | 明确共存策略 |
| 降级策略 | 无 | 自动降级 + 前端提示 |
| 凭证管理页面 | 无 | 新增集群凭证管理 Tab |

---

*方案撰写：2026-04-19*
*适用场景：已有 KubeSphere 管理多集群，CloudOps 需独立接管并支持从只读到读写的渐进扩展*
