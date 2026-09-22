import { createHash } from "node:crypto";
import { emitEvent, readEvents } from "./runtime.mjs";

export function normalizeExternalEvent(raw, agent) {
  const type = raw.type ?? raw.event ?? raw.kind ?? "event";
  const payload = raw.payload ?? raw.message ?? raw.data ?? raw;
  let normalizedType = type;
  if (agent === "claude-code") {
    normalizedType = type === "assistant" || type === "generation" ? "generation" :
      type === "tool_use" || type === "tool_result" ? "tool_call" : type;
  }
  if (agent === "codex") {
    normalizedType = type === "response_item" || type === "assistant_message" ? "generation" :
      type === "function_call" || type === "tool_call" ? "tool_call" : type;
  }
  return {
    type: normalizedType,
    agent,
    source: `${agent}-adapter`,
    trace_id: raw.trace_id ?? raw.traceId ?? null,
    run_id: raw.run_id ?? raw.runId ?? null,
    payload,
    metadata: {
      external_event_type: type,
      session_id: raw.session_id ?? raw.sessionId ?? null,
      model: raw.model ?? raw.model_id ?? null
    }
  };
}

export async function ingestJsonl(workspace, content, agent) {
  const parsed = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
    parsed.push({ raw, line });
  }
  const existing = new Set((await readEvents(workspace))
    .map((event) => event.metadata?.event_fingerprint)
    .filter(Boolean));
  const results = [];
  for (const { raw, line } of parsed) {
    const fingerprint = createHash("sha256").update(`${agent}:\n${line}`).digest("hex");
    if (existing.has(fingerprint)) continue;
    const event = normalizeExternalEvent(raw, agent);
    results.push(await emitEvent(workspace, {
      ...event,
      id: fingerprint.slice(0, 32),
      metadata: { ...event.metadata, event_fingerprint: fingerprint }
    }));
    existing.add(fingerprint);
  }
  return results;
}
