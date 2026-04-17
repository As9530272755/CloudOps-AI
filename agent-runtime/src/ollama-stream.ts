import { randomUUID } from "node:crypto";
import type { StreamFunction } from "@mariozechner/pi-ai";
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ToolCall,
  Tool,
  Message,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

export const OLLAMA_NATIVE_BASE_URL = "http://127.0.0.1:11434";

// ── Ollama /api/chat request types ──────────────────────────────────────────

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    thinking?: string;
    reasoning?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ── Message conversion ──────────────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractOllamaImages(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "image"; data: string } => part.type === "image")
    .map((part) => part.data);
}

function extractToolCalls(content: unknown): OllamaToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content as InputContentPart[];
  const result: OllamaToolCall[] = [];
  for (const part of parts) {
    if (part.type === "toolCall") {
      result.push({ function: { name: part.name, arguments: part.arguments } });
    } else if (part.type === "tool_use") {
      result.push({ function: { name: part.name, arguments: part.input } });
    }
  }
  return result;
}

export function convertToOllamaMessages(
  messages: Array<{ role: string; content: unknown; toolCallId?: string; toolName?: string }>,
  system?: string,
): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const { role } = msg;

    if (role === "user") {
      const text = extractTextContent(msg.content);
      const images = extractOllamaImages(msg.content);
      result.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
    } else if (role === "assistant") {
      const text = extractTextContent(msg.content);
      const toolCalls = extractToolCalls(msg.content);
      result.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (role === "toolResult") {
      const text = extractTextContent(msg.content);
      const toolName = typeof msg.toolName === "string" ? msg.toolName : undefined;
      result.push({
        role: "tool",
        content: text,
        ...(toolName ? { tool_name: toolName } : {}),
      });
    }
  }

  return result;
}

// ── Tool extraction ─────────────────────────────────────────────────────────

function extractOllamaTools(tools: Tool[] | undefined): OllamaTool[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const result: OllamaTool[] = [];
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !tool.name) {
      continue;
    }
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: (tool.parameters ?? {}) as Record<string, unknown>,
      },
    });
  }
  return result;
}

// ── Response conversion ─────────────────────────────────────────────────────

function buildUsage(input: number, output: number): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildAssistantMessage(
  response: OllamaChatResponse,
  modelInfo: { api: string; provider: string; id: string },
): AssistantMessage {
  const content: (TextContent | { type: "thinking"; thinking: string } | ToolCall)[] = [];

  if (response.message.content) {
    content.push({ type: "text", text: response.message.content });
  }

  if (response.message.thinking) {
    content.push({ type: "thinking", thinking: response.message.thinking });
  }

  if (response.message.reasoning) {
    content.push({ type: "thinking", thinking: response.message.reasoning });
  }

  const toolCalls = response.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      content.push({
        type: "toolCall",
        id: `ollama_call_${randomUUID()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      });
    }
  }

  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const stopReason: StopReason = hasToolCalls ? "toolUse" : "stop";

  return {
    role: "assistant",
    content,
    api: modelInfo.api as any,
    provider: modelInfo.provider as any,
    model: modelInfo.id,
    usage: buildUsage(
      response.prompt_eval_count ?? 0,
      response.eval_count ?? 0,
    ),
    stopReason,
    timestamp: Date.now(),
  };
}

// ── NDJSON streaming parser ─────────────────────────────────────────────────

async function* parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OllamaChatResponse> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        yield JSON.parse(trimmed) as OllamaChatResponse;
      } catch {
        // ignore invalid JSON lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim()) as OllamaChatResponse;
    } catch {
      // ignore
    }
  }
}

// ── Stream function factory ─────────────────────────────────────────────────

export function createOllamaStreamFn(
  baseUrl: string,
  defaultHeaders?: Record<string, string>,
): StreamFunction {
  const chatUrl = `${baseUrl.replace(/\/$/, "")}/api/chat`;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const ollamaMessages = convertToOllamaMessages(
          (context.messages as any) ?? [],
          context.systemPrompt,
        );

        const ollamaTools = extractOllamaTools(context.tools);

        const ollamaOptions: Record<string, unknown> = {
          num_ctx: model.contextWindow ?? 65536,
        };
        if (typeof options?.temperature === "number") {
          ollamaOptions.temperature = options.temperature;
        }
        if (typeof options?.maxTokens === "number") {
          ollamaOptions.num_predict = options.maxTokens;
        }

        const body: OllamaChatRequest = {
          model: model.id,
          messages: ollamaMessages,
          stream: true,
          ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
          options: ollamaOptions,
        };

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...defaultHeaders,
          ...options?.headers,
        };
        if (options?.apiKey) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        const fetchRes = await fetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!fetchRes.ok) {
          const errorText = await fetchRes.text().catch(() => "unknown error");
          throw new Error(`Ollama API error ${fetchRes.status}: ${errorText}`);
        }

        if (!fetchRes.body) {
          throw new Error("Ollama API returned empty response body");
        }

        const reader = fetchRes.body.getReader();
        let accumulatedContent = "";
        let fallbackContent = "";
        let sawContent = false;
        const accumulatedToolCalls: OllamaToolCall[] = [];
        let finalResponse: OllamaChatResponse | undefined;

        // Emit start event with empty partial
        const partialMessage: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          api: model.api as any,
          provider: model.provider as any,
          model: model.id,
          usage: buildUsage(0, 0),
          stopReason: "stop",
          timestamp: Date.now(),
        };
        stream.push({ type: "start", partial: partialMessage });

        for await (const chunk of parseNdjsonStream(reader)) {
          if (chunk.message?.content) {
            sawContent = true;
            const delta = chunk.message.content.slice(accumulatedContent.length);
            accumulatedContent = chunk.message.content;
            if (delta) {
              partialMessage.content = [{ type: "text", text: accumulatedContent }];
              stream.push({
                type: "text_delta",
                contentIndex: 0,
                delta,
                partial: partialMessage,
              });
            }
          } else if (!sawContent && chunk.message?.thinking) {
            fallbackContent += chunk.message.thinking;
            partialMessage.content = [{ type: "text", text: fallbackContent }];
            stream.push({
              type: "text_delta",
              contentIndex: 0,
              delta: chunk.message.thinking,
              partial: partialMessage,
            });
          } else if (!sawContent && chunk.message?.reasoning) {
            fallbackContent += chunk.message.reasoning;
            partialMessage.content = [{ type: "text", text: fallbackContent }];
            stream.push({
              type: "text_delta",
              contentIndex: 0,
              delta: chunk.message.reasoning,
              partial: partialMessage,
            });
          }

          if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
            // Ollama may emit tool_calls incrementally; deduplicate by JSON string
            for (const tc of chunk.message.tool_calls) {
              const key = JSON.stringify(tc);
              if (!accumulatedToolCalls.some((existing) => JSON.stringify(existing) === key)) {
                accumulatedToolCalls.push(tc);
              }
            }
          }

          if (chunk.done) {
            finalResponse = chunk;
          }
        }

        // Build final message from accumulated data
        // Ollama's final done:true chunk may not include tool_calls, so we use accumulated data
        const finalMessage = buildAssistantMessage(
          {
            model: model.id,
            created_at: new Date().toISOString(),
            message: {
              role: "assistant",
              content: accumulatedContent || fallbackContent,
              thinking: fallbackContent || undefined,
              tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
            },
            done: true,
            prompt_eval_count: finalResponse?.prompt_eval_count,
            eval_count: finalResponse?.eval_count,
          },
          { api: model.api, provider: model.provider, id: model.id },
        );

        stream.end(finalMessage);
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        const errorAssistant: AssistantMessage = {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          api: model.api as any,
          provider: model.provider as any,
          model: model.id,
          usage: buildUsage(0, 0),
          stopReason: "error",
          errorMessage,
          timestamp: Date.now(),
        };
        stream.end(errorAssistant);
      }
    };

    run();
    return stream;
  };
}
