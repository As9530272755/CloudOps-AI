import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Message,
  Model,
  TextContent,
  ToolCall,
} from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { createOllamaStreamFn, OLLAMA_NATIVE_BASE_URL } from "./ollama-stream.js";
import { cloudopsTools } from "./cloudops-tools.js";

const sessions = new Map<string, AgentSession>();
const toolCallArgsCache = new Map<string, any>();

export interface ModelConfig {
  provider: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface CloudOpsMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function buildModel(config: ModelConfig): Model<any> {
  return {
    id: config.modelId,
    name: config.modelId,
    api: "ollama" as any,
    provider: config.provider as any,
    baseUrl: config.baseUrl || OLLAMA_NATIVE_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow || 65536,
    maxTokens: config.maxTokens || 4096,
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
  };
}

function convertGoMessages(goMessages: CloudOpsMessage[]): {
  systemPrompt: string;
  agentMessages: AgentMessage[];
} {
  let systemPrompt = "";
  const agentMessages: AgentMessage[] = [];
  const toolCallIdToName = new Map<string, string>();

  for (const msg of goMessages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallIdToName.set(tc.id, tc.function.name);
      }
    }
  }

  for (const msg of goMessages) {
    if (msg.role === "system") {
      systemPrompt = msg.content;
      continue;
    }

    if (msg.role === "user") {
      agentMessages.push({
        role: "user",
        content: msg.content,
        timestamp: Date.now(),
      } as UserMessage);
      continue;
    }

    if (msg.role === "assistant") {
      const content: AssistantMessage["content"] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }
          content.push({
            type: "toolCall",
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          });
        }
      }
      agentMessages.push({
        role: "assistant",
        content,
        api: "ollama" as any,
        provider: "ollama" as any,
        model: "unknown",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
        timestamp: Date.now(),
      } as AssistantMessage);
      continue;
    }

    if (msg.role === "tool") {
      const toolName = msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) || "unknown" : "unknown";
      agentMessages.push({
        role: "toolResult",
        toolCallId: msg.tool_call_id || "",
        toolName,
        content: [{ type: "text", text: msg.content }],
        isError: false,
        timestamp: Date.now(),
      } as ToolResultMessage);
      continue;
    }
  }

  return { systemPrompt, agentMessages };
}

export function buildSystemPrompt(): string {
  return `You are CloudOps, an intelligent operations assistant for Kubernetes clusters and logs.

## Available Tools

1. list_clusters()
   - Lists all connected Kubernetes clusters.
   - Returns: array of {id, name}.

2. get_cluster_status(cluster_id: integer)
   - Gets resource overview of a specific cluster.
   - Returns: stats including nodes, pods, deployments, services, etc.

3. list_pods(cluster_id: integer, namespace?: string)
   - Lists pods in a specific cluster.
   - Returns: array of pod objects.

4. query_logs(cluster_id: integer, keyword?: string, log_type?: string, namespace?: string, start_time?: string, end_time?: string, limit?: integer)
   - Queries Elasticsearch/OpenSearch logs. Defaults to last 1 hour.
   - Returns: log entries.

## Rules

- If the user mentions a cluster by name (e.g., "KS cluster", "YH cluster") and you do not yet have its cluster_id, you MUST call list_clusters first to get the mapping.
- After a tool call, if the information is still insufficient to answer the user's question, you MUST continue calling the next needed tool. Do NOT ask the user for clarification unless the task is truly impossible.
- Always base your final answer on the real data returned by tools.
- Answer concisely in Chinese.
- Do NOT expose raw JSON structures in the final answer; summarize them in a natural way.
- CRITICAL: Never output phrases like "用户询问...", "我需要...", "让我先...", or any internal reasoning. Output ONLY the final answer or the tool call.`;
}

export async function createSession(
  sessionId: string,
  modelConfig: ModelConfig,
): Promise<AgentSession> {
  if (sessions.has(sessionId)) {
    const old = sessions.get(sessionId)!;
    old.dispose();
    sessions.delete(sessionId);
  }

  const model = buildModel(modelConfig);
  const agentDir = `/tmp/cloudops-agent/${sessionId}`;
  const cwd = `/tmp/cloudops-agent/${sessionId}/workspace`;
  await import("node:fs/promises").then((fs) => fs.mkdir(cwd, { recursive: true }));

  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const settingsManager = SettingsManager.create(cwd, agentDir);

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    tools: [],
    customTools: cloudopsTools,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    authStorage,
    modelRegistry,
  });

  if (modelConfig.provider === "ollama" || model.api === "ollama") {
    session.agent.streamFn = createOllamaStreamFn(
      modelConfig.baseUrl || OLLAMA_NATIVE_BASE_URL,
      model.headers,
    );
  }

  (session.agent.state as any).systemPrompt = buildSystemPrompt();
  sessions.set(sessionId, session);
  return session;
}

function extractTextFromMessage(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function looksLikeThinking(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Only the most obvious internal-reasoning prefixes.
  // We intentionally keep this conservative: missing a thinking prefix
  // is better than hiding the final answer.
  const patterns = [
    /^用户[说问]?/,
    /^我需要先/,
    /^我应该/,
    /^让我先/,
    /^让我调用/,
    /^我先/,
    /^现在我需要/,
  ];
  return patterns.some((p) => p.test(t));
}

export async function runPrompt(
  sessionId: string,
  messages: CloudOpsMessage[],
  onEvent: (event: { type: string; content?: string; tool?: string; input?: string; output?: string; done?: boolean }) => void,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const { systemPrompt, agentMessages } = convertGoMessages(messages);
  if (systemPrompt) {
    (session.agent.state as any).systemPrompt = systemPrompt;
  }

  (session.agent.state as any).messages = agentMessages;

  return new Promise((resolve, reject) => {
    let finished = false;
    let lastTextSent = "";
    let lastThinkingSent = "";

    const finish = () => {
      if (finished) return;
      finished = true;
      unsubscribe();
      // Fallback: if no text was emitted but we have thinking, flush it as text
      // so the user doesn't see an empty bubble.
      if (!lastTextSent && lastThinkingSent) {
        onEvent({ type: "text", content: lastThinkingSent });
      }
      onEvent({ type: "done", done: true });
      resolve();
    };

    const unsubscribe = session.subscribe((ev: AgentSessionEvent) => {
      if (ev.type === "agent_start") {
        // no-op
      } else if (ev.type === "message_start") {
        lastTextSent = "";
        lastThinkingSent = "";
      } else if (ev.type === "message_update") {
        const ame = (ev as any).assistantMessageEvent;
        if (ame?.type === "text_delta") {
          const delta: string = ame.delta || "";
          const fullText = extractTextFromMessage(ev.message as AssistantMessage);
          if (looksLikeThinking(fullText)) {
            const thinkingDelta = fullText.slice(lastThinkingSent.length);
            if (thinkingDelta) {
              lastThinkingSent = fullText;
              onEvent({ type: "thinking", content: thinkingDelta });
            }
            // Do NOT update lastTextSent here so that when we switch to real text
            // the delta from the last real text position is emitted.
          } else {
            const textDelta = fullText.slice(lastTextSent.length);
            if (textDelta) {
              lastTextSent = fullText;
              onEvent({ type: "text", content: textDelta });
            }
            lastThinkingSent = fullText;
          }
        } else if (ame?.type === "thinking_delta") {
          const delta: string = ame.delta || "";
          if (delta) {
            onEvent({ type: "thinking", content: delta });
          }
        } else {
          // Fallback: handle raw message content updates (non-streaming or unknown event shape)
          const msg = ev.message as AssistantMessage;
          for (const c of msg.content) {
            if (c.type === "text") {
              const fullText = c.text;
              const delta = fullText.slice(lastTextSent.length);
              if (delta) {
                lastTextSent = fullText;
                if (looksLikeThinking(fullText)) {
                  onEvent({ type: "thinking", content: delta });
                } else {
                  onEvent({ type: "text", content: delta });
                }
              }
            } else if (c.type === "toolCall") {
              onEvent({
                type: "tool_start",
                tool: c.name,
                input: JSON.stringify(c.arguments),
              });
            }
          }
        }
      } else if (ev.type === "tool_execution_start") {
        toolCallArgsCache.set(ev.toolCallId, ev.args);
        onEvent({
          type: "tool_start",
          tool: ev.toolName,
          input: JSON.stringify(ev.args),
        });
      } else if (ev.type === "tool_execution_end") {
        const args = toolCallArgsCache.get(ev.toolCallId);
        if (args) toolCallArgsCache.delete(ev.toolCallId);
        onEvent({
          type: "tool_end",
          tool: ev.toolName,
          input: args ? JSON.stringify(args) : "",
          output: ev.result?.content?.map((c: any) => c.text).join("\n") || "",
        });
      } else if (ev.type === "agent_end") {
        finish();
      } else if (ev.type === "message_end") {
        const msg = ev.message as AssistantMessage;
        if (msg.stopReason === "stop" || msg.stopReason === "error") {
          finish();
        }
      }
    });

    session.agent.prompt(agentMessages).catch((err: any) => {
      finish();
      onEvent({ type: "error", content: err.message });
      reject(err);
    });
  });
}

export function disposeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.dispose();
    sessions.delete(sessionId);
  }
}
