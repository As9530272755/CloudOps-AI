import { apiClient as api } from './api'

export interface FlowNode {
  id: string
  name: string
  namespace?: string
  node?: string
  type: 'target' | 'pod' | 'service' | 'external' | 'database' | 'ingress'
  symbolSize?: number
}

export interface FlowEdge {
  source: string
  target: string
  protocol: string
  port: number
  bytes: number
  requests: number
  latencyP95: number
  successRate: number
  lineWidth?: number
}

export interface FlowTopology {
  target: FlowNode
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowItem {
  sourcePod: string
  sourceNamespace: string
  sourceNode: string
  protocol: string
  port: number
  requests: number
  bytes: number
  latencyP95: number
  successRate: number
  lastActive: string
}

export interface TimeseriesData {
  timestamps: string[]
  bytesPerSecond: number[]
  requestsPerSecond: number[]
  latencyP95: number[]
}

export interface NetworkTraceConfig {
  debug_image: string
}

export interface PodTrafficMetrics {
  rx_bytes: number
  tx_bytes: number
  rx_packets: number
  tx_packets: number
  rx_errors: number
  tx_errors: number
}

export const networkTraceAPI = {
  getTopology: async (clusterId: number | string, namespace: string, pod: string, duration = '5m') => {
    const res = await api.get(`/clusters/${clusterId}/network/flows/topology`, {
      params: { namespace, pod, duration },
    })
    return res.data as { success: boolean; data?: FlowTopology; error?: string }
  },

  getFlowList: async (clusterId: number | string, namespace: string, pod: string, duration = '5m') => {
    const res = await api.get(`/clusters/${clusterId}/network/flows/list`, {
      params: { namespace, pod, duration },
    })
    return res.data as { success: boolean; data?: FlowItem[]; error?: string }
  },

  getTimeseries: async (
    clusterId: number | string,
    source: string,
    target: string,
    protocol: string,
    duration = '15m'
  ) => {
    const res = await api.get(`/clusters/${clusterId}/network/flows/timeseries`, {
      params: { source, target, protocol, duration },
    })
    return res.data as { success: boolean; data?: TimeseriesData; error?: string }
  },

  // 配置管理
  getConfig: async () => {
    const res = await api.get('/network-trace/config')
    return res.data as { success: boolean; data?: NetworkTraceConfig; error?: string }
  },

  updateConfig: async (data: Partial<NetworkTraceConfig>) => {
    const res = await api.put('/network-trace/config', data)
    return res.data as { success: boolean; data?: NetworkTraceConfig; error?: string }
  },

  // Prometheus 流量指标
  getPodTraffic: async (clusterId: number | string, namespace: string, pod: string) => {
    const res = await api.get(`/clusters/${clusterId}/network/flows/traffic`, {
      params: { namespace, pod },
    })
    return res.data as { success: boolean; data?: PodTrafficMetrics; error?: string }
  },

  // 增强拓扑（K8s + Prometheus + 抓包）
  enhanceTopology: async (clusterId: number | string, data: { namespace: string; pod: string }) => {
    const res = await api.post(`/clusters/${clusterId}/network/flows/enhance`, data)
    return res.data as { success: boolean; data?: { topology: FlowTopology; prometheus: PodTrafficMetrics }; error?: string }
  },

  // 调试 / 抓包
  createDebug: async (clusterId: number | string, data: {
    namespace: string
    pod: string
    image?: string
    command?: string
  }) => {
    const res = await api.post(`/clusters/${clusterId}/network/debug`, data)
    return res.data as { success: boolean; message?: string; error?: string }
  },

  getDebugLogs: async (clusterId: number | string, namespace: string, pod: string) => {
    const res = await api.get(`/clusters/${clusterId}/network/debug/logs`, {
      params: { namespace, pod },
    })
    return res.data as { success: boolean; data?: string; error?: string }
  },
}
