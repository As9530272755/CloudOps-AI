import express, { Request, Response } from "express";
import cors from "cors";
import { createSession, runPrompt, disposeSession, type CloudOpsMessage } from "./agent-handler.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = parseInt(process.env.AGENT_RUNTIME_PORT || "19000", 10);

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Create session
app.post("/v1/agent/sessions", async (req: Request, res: Response) => {
  try {
    const { sessionId, modelConfig } = req.body;
    if (!sessionId || !modelConfig) {
      res.status(400).json({ error: "sessionId and modelConfig are required" });
      return;
    }
    await createSession(sessionId, modelConfig);
    res.json({ success: true, sessionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run prompt (SSE)
app.post("/v1/agent/sessions/:id/prompt", async (req: Request, res: Response) => {
  const sessionId = req.params.id as string;
  const { messages } = req.body as { messages?: CloudOpsMessage[] };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const writeEvent = (event: { type: string; content?: string; tool?: string; input?: string; output?: string; done?: boolean }) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };

  try {
    await runPrompt(sessionId, messages, writeEvent);
  } catch (err: any) {
    writeEvent({ type: "error", content: err.message });
    writeEvent({ type: "done", done: true });
  } finally {
    res.end();
  }
});

// Delete session
app.delete("/v1/agent/sessions/:id", (req: Request, res: Response) => {
  disposeSession(req.params.id as string);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`[agent-runtime] listening on http://127.0.0.1:${PORT}`);
});
