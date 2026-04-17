import { Type, type Static } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { executeToolOnGo } from "./go-client.js";

const ListClustersSchema = Type.Object({});
const GetClusterStatusSchema = Type.Object({
  cluster_id: Type.Integer({ description: "集群 ID" }),
});
const ListPodsSchema = Type.Object({
  cluster_id: Type.Integer({ description: "集群 ID" }),
  namespace: Type.Optional(Type.String({ description: "命名空间过滤，可选" })),
});
const QueryLogsSchema = Type.Object({
  cluster_id: Type.Integer({ description: "集群 ID" }),
  keyword: Type.Optional(Type.String({ description: "搜索关键词" })),
  log_type: Type.Optional(Type.String({ description: "日志类型: app | ingress | coredns | lb，默认 app" })),
  namespace: Type.Optional(Type.String({ description: "命名空间过滤" })),
  start_time: Type.Optional(Type.String({ description: "开始时间，RFC3339" })),
  end_time: Type.Optional(Type.String({ description: "结束时间，RFC3339" })),
  limit: Type.Optional(Type.Integer({ description: "返回条数，默认 20，最大 100" })),
});

export const cloudopsTools: ToolDefinition[] = [
  {
    name: "list_clusters",
    label: "List Clusters",
    description: "列出当前用户对接的所有 Kubernetes 集群，返回集群 ID 与名称的映射列表。",
    parameters: ListClustersSchema,
    execute: async (_toolCallId, _params: Static<typeof ListClustersSchema>, signal) => {
      const output = await executeToolOnGo("list_clusters", {}, signal);
      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  },
  {
    name: "get_cluster_status",
    label: "Cluster Status",
    description: "获取指定集群的资源统计概览，包括节点数、Pod 数、Deployment 数等。",
    parameters: GetClusterStatusSchema,
    execute: async (_toolCallId, params: Static<typeof GetClusterStatusSchema>, signal) => {
      const output = await executeToolOnGo("get_cluster_status", params as any, signal);
      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  },
  {
    name: "list_pods",
    label: "List Pods",
    description: "列出指定集群中的 Pod 列表。",
    parameters: ListPodsSchema,
    execute: async (_toolCallId, params: Static<typeof ListPodsSchema>, signal) => {
      const output = await executeToolOnGo("list_pods", params as any, signal);
      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  },
  {
    name: "query_logs",
    label: "Query Logs",
    description: "查询 Elasticsearch/OpenSearch 日志，默认查最近 1 小时。",
    parameters: QueryLogsSchema,
    execute: async (_toolCallId, params: Static<typeof QueryLogsSchema>, signal) => {
      const output = await executeToolOnGo("query_logs", params as any, signal);
      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  },
];
