const GO_BASE_URL = process.env.GO_INTERNAL_URL || "http://127.0.0.1:9000";
const GO_API_KEY = process.env.GO_INTERNAL_API_KEY || ""; // if needed

export async function executeToolOnGo(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${GO_BASE_URL}/internal/agent/tool-execute`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(GO_API_KEY ? { Authorization: `Bearer ${GO_API_KEY}` } : {}),
    },
    body: JSON.stringify({ tool: toolName, arguments: args }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Go tool execute error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { output?: string; error?: string };
  if (data.error) {
    throw new Error(data.error);
  }
  return data.output || "";
}
