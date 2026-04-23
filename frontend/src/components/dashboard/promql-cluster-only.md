# 双集群 VM 场景 — 基于 $cluster 变量的常用指标

> 两个 K8s 集群对接到同一个 VictoriaMetrics，通过 `cluster` label 区分。
> 所有 PromQL 均基于 `$cluster` 变量筛选，在面板查询中使用 `{cluster=~"$cluster"}`。

---

## 一、节点级指标（带 cluster 筛选）

### CPU
```promql
# 各集群节点平均 CPU 使用率
avg by (cluster) (100 - avg by (cluster, instance) (irate(node_cpu_seconds_total{mode="idle",cluster=~"$cluster"}[5m])) * 100)

# 各节点 CPU 使用率（表格用）
100 - (avg by (cluster, instance) (irate(node_cpu_seconds_total{mode="idle",cluster=~"$cluster"}[5m])) * 100)

# 集群总 CPU 核心数
sum by (cluster) (count by (cluster, instance) (node_cpu_seconds_total{mode="idle",cluster=~"$cluster"}))
```

### 内存
```promql
# 各集群内存使用率
avg by (cluster) (100 * (1 - node_memory_MemAvailable_bytes{cluster=~"$cluster"} / node_memory_MemTotal_bytes{cluster=~"$cluster"}))

# 各节点内存使用率
100 * (1 - node_memory_MemAvailable_bytes{cluster=~"$cluster"} / node_memory_MemTotal_bytes{cluster=~"$cluster"})

# 集群内存总量 (GB)
sum by (cluster) (node_memory_MemTotal_bytes{cluster=~"$cluster"}) / 1024 / 1024 / 1024

# 集群内存已用 (GB)
sum by (cluster) (node_memory_MemTotal_bytes{cluster=~"$cluster"} - node_memory_MemAvailable_bytes{cluster=~"$cluster"}) / 1024 / 1024 / 1024
```

### 磁盘
```promql
# 各集群磁盘平均使用率
avg by (cluster) (100 * (1 - node_filesystem_avail_bytes{cluster=~"$cluster",mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{cluster=~"$cluster",mountpoint="/",fstype!="tmpfs"}))

# 节点磁盘使用率
100 * (1 - node_filesystem_avail_bytes{cluster=~"$cluster",mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{cluster=~"$cluster",mountpoint="/",fstype!="tmpfs"})
```

### 网络
```promql
# 集群总网络接收速率 (MB/s)
sum by (cluster) (irate(node_network_receive_bytes_total{cluster=~"$cluster",device!~"lo"}[5m])) / 1024 / 1024

# 集群总网络发送速率 (MB/s)
sum by (cluster) (irate(node_network_transmit_bytes_total{cluster=~"$cluster",device!~"lo"}[5m])) / 1024 / 1024
```

### 负载
```promql
# 集群平均 1m 负载
avg by (cluster) (node_load1{cluster=~"$cluster"})

# 集群平均 5m 负载
avg by (cluster) (node_load5{cluster=~"$cluster"})
```

---

## 二、Pod / 容器指标

### Pod CPU
```promql
# 各命名空间 Pod CPU 使用率 Top10
sum by (cluster, namespace, pod) (rate(container_cpu_usage_seconds_total{cluster=~"$cluster",pod!=""}[5m])) * 100

# 集群总 Pod CPU 使用率
sum by (cluster) (rate(container_cpu_usage_seconds_total{cluster=~"$cluster",pod!=""}[5m]))
```

### Pod 内存
```promql
# 各命名空间 Pod 内存使用 Top10 (MB)
sum by (cluster, namespace, pod) (container_memory_working_set_bytes{cluster=~"$cluster",pod!=""}) / 1024 / 1024

# 集群总 Pod 内存使用 (GB)
sum by (cluster) (container_memory_working_set_bytes{cluster=~"$cluster",pod!=""}) / 1024 / 1024 / 1024
```

### Pod 状态
```promql
# 集群中 Running Pod 数
sum by (cluster) (kube_pod_status_phase{cluster=~"$cluster",phase="Running"})

# 集群中 Pending Pod 数
sum by (cluster) (kube_pod_status_phase{cluster=~"$cluster",phase="Pending"})

# 集群中 Failed Pod 数
sum by (cluster) (kube_pod_status_phase{cluster=~"$cluster",phase="Failed"})
```

---

## 三、Workload 指标

```promql
# Deployment 可用率（可用/期望）
sum by (cluster) (kube_deployment_status_replicas_available{cluster=~"$cluster"}) / sum by (cluster) (kube_deployment_status_replicas{cluster=~"$cluster"}) * 100

# 各集群 Deployment 总数
count by (cluster) (kube_deployment_info{cluster=~"$cluster"})

# StatefulSet 可用率
sum by (cluster) (kube_statefulset_status_replicas_ready{cluster=~"$cluster"}) / sum by (cluster) (kube_statefulset_status_replicas{cluster=~"$cluster"}) * 100
```

---

## 四、集群概览对比（双集群并排）

这些查询特别适合做**单值统计（Stat）**面板，横向对比两个集群：

```promql
# 节点数
count by (cluster) (kube_node_info{cluster=~"$cluster"})

# Pod 数
sum by (cluster) (kube_pod_status_phase{cluster=~"$cluster",phase="Running"})

# CPU 平均使用率
avg by (cluster) (100 - avg by (cluster, instance) (irate(node_cpu_seconds_total{mode="idle",cluster=~"$cluster"}[5m])) * 100)

# 内存平均使用率
avg by (cluster) (100 * (1 - node_memory_MemAvailable_bytes{cluster=~"$cluster"} / node_memory_MemTotal_bytes{cluster=~"$cluster"}))

# 磁盘平均使用率
avg by (cluster) (100 * (1 - node_filesystem_avail_bytes{cluster=~"$cluster",mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{cluster=~"$cluster",mountpoint="/",fstype!="tmpfs"}))
```

---

## 五、推荐面板布局

| 面板 | 图表类型 | PromQL |
|------|---------|--------|
| 节点数对比 | Stat | `count by (cluster) (kube_node_info{cluster=~"$cluster"})` |
| Pod 数对比 | Stat | `sum by (cluster) (kube_pod_status_phase{cluster=~"$cluster",phase="Running"})` |
| CPU 使用率 | Line | `avg by (cluster) (100 - ...)` |
| 内存使用率 | Line | `avg by (cluster) (100 * (1 - ...))` |
| 磁盘使用率 | Gauge | `avg by (cluster) (100 * (1 - ...))` |
| 网络吞吐 | Line | `sum by (cluster) (irate(...))` |
| 负载 | Line | `avg by (cluster) (node_load1{cluster=~"$cluster"})` |
| Top Pod CPU | Table | `sum by (cluster,namespace,pod) (rate(...))` |
| Top Pod 内存 | Table | `sum by (cluster,namespace,pod) (...)` |
