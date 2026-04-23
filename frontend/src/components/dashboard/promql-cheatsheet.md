# K8s Prometheus 常用指标速查

> 以下 PromQL 均支持变量插值，例如：`$cluster`、`$namespace`、`$node`

---

## 一、节点（Node）指标

### 1.1 CPU

```promql
# 节点 CPU 使用率
100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle",instance=~"$node"}[5m])) * 100)

# 节点 CPU 各模式占比
avg by (instance, mode) (irate(node_cpu_seconds_total{instance=~"$node"}[5m]))

# 节点 CPU 核心数
count by (instance) (node_cpu_seconds_total{mode="idle",instance=~"$node"})
```

### 1.2 内存

```promql
# 节点内存使用率
100 * (1 - ((node_memory_MemAvailable_bytes{instance=~"$node"} or node_memory_MemFree_bytes{instance=~"$node"}) / node_memory_MemTotal_bytes{instance=~"$node"}))

# 节点内存总量/可用/已用（GB）
node_memory_MemTotal_bytes{instance=~"$node"} / 1024 / 1024 / 1024
node_memory_MemAvailable_bytes{instance=~"$node"} / 1024 / 1024 / 1024
(node_memory_MemTotal_bytes{instance=~"$node"} - node_memory_MemAvailable_bytes{instance=~"$node"}) / 1024 / 1024 / 1024

# 节点内存各类型（缓存/缓冲区）
node_memory_Cached_bytes{instance=~"$node"} / 1024 / 1024 / 1024
node_memory_Buffers_bytes{instance=~"$node"} / 1024 / 1024 / 1024
```

### 1.3 磁盘

```promql
# 节点磁盘使用率
100 * (1 - node_filesystem_avail_bytes{instance=~"$node",mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{instance=~"$node",mountpoint="/",fstype!="tmpfs"})

# 节点磁盘 I/O 速率（读）
irate(node_disk_read_bytes_total{instance=~"$node"}[5m])

# 节点磁盘 I/O 速率（写）
irate(node_disk_written_bytes_total{instance=~"$node"}[5m])

# 节点磁盘 IOPS（读）
irate(node_disk_reads_completed_total{instance=~"$node"}[5m])
```

### 1.4 网络

```promql
# 节点网络接收速率
irate(node_network_receive_bytes_total{instance=~"$node",device!~"lo"}[5m])

# 节点网络发送速率
irate(node_network_transmit_bytes_total{instance=~"$node",device!~"lo"}[5m])

# 节点网络接收包速率
irate(node_network_receive_packets_total{instance=~"$node",device!~"lo"}[5m])
```

### 1.5 负载 / 进程

```promql
# 节点负载
node_load1{instance=~"$node"}
node_load5{instance=~"$node"}
node_load15{instance=~"$node"}

# 运行中进程数
node_procs_running{instance=~"$node"}
```

---

## 二、Pod / 容器指标

### 2.1 CPU

```promql
# Pod CPU 使用率（占节点核心数百分比）
sum by (pod, namespace) (rate(container_cpu_usage_seconds_total{namespace=~"$namespace",pod!=""}[5m])) * 100

# 容器 CPU 限制
kube_pod_container_resource_limits{resource="cpu",namespace=~"$namespace"}

# 容器 CPU 请求
kube_pod_container_resource_requests{resource="cpu",namespace=~"$namespace"}
```

### 2.2 内存

```promql
# Pod 内存使用
sum by (pod, namespace) (container_memory_working_set_bytes{namespace=~"$namespace",pod!=""}) / 1024 / 1024

# Pod 内存限制
kube_pod_container_resource_limits{resource="memory",namespace=~"$namespace"} / 1024 / 1024

# Pod 内存请求
kube_pod_container_resource_requests{resource="memory",namespace=~"$namespace"} / 1024 / 1024
```

### 2.3 重启次数

```promql
# Pod 容器重启次数
kube_pod_container_status_restarts_total{namespace=~"$namespace"}
```

---

## 三、Deployment / Workload 指标

```promql
# Deployment 期望副本数
kube_deployment_status_replicas{namespace=~"$namespace"}

# Deployment 可用副本数
kube_deployment_status_replicas_available{namespace=~"$namespace"}

# Deployment 不可用副本数
kube_deployment_status_replicas_unavailable{namespace=~"$namespace"}

# StatefulSet 副本数
kube_statefulset_status_replicas{namespace=~"$namespace"}

# DaemonSet 运行副本数
kube_daemonset_status_number_ready{namespace=~"$namespace"}
```

---

## 四、集群级指标

```promql
# 集群节点总数
count(kube_node_info)

# 集群节点 Ready 状态
sum(kube_node_status_condition{condition="Ready",status="true"})

# 集群 Pod 总数
sum(kube_pod_status_phase{phase!="Succeeded",phase!="Failed"})

# 集群各命名空间 Pod 数
count by (namespace) (kube_pod_info)

# 集群 PVC 使用量
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100
```

---

## 五、变量配置示例

### 变量 1：cluster（集群）
| 字段 | 值 |
|------|-----|
| 类型 | 查询 |
| PromQL | `kube_node_info` |
| Label | `cluster` |
| 多选 | ✅ |
| 包含 All | ✅ |

### 变量 2：namespace（命名空间）
| 字段 | 值 |
|------|-----|
| 类型 | 查询 |
| PromQL | `kube_namespace_labels{cluster=~"$cluster"}` |
| Label | `namespace` |
| 多选 | ❌ |
| 包含 All | ✅ |

### 变量 3：node（节点）
| 字段 | 值 |
|------|-----|
| 类型 | 查询 |
| PromQL | `kube_node_info{cluster=~"$cluster"}` |
| Label | `node` |
| 多选 | ✅ |
| 包含 All | ✅ |
