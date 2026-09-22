import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const STATES = [
  "intake",
  "brainstorming",
  "planning",
  "implementation",
  "testing",
  "review",
  "done"
];

const TRANSITIONS = new Map([
  ["intake", new Set(["brainstorming"])],
  ["brainstorming", new Set(["planning"])],
  ["planning", new Set(["implementation"])],
  ["implementation", new Set(["testing"])],
  ["testing", new Set(["review", "implementation"])],
  ["review", new Set(["done", "implementation"])],
  ["done", new Set([])]
]);

export function workspacePaths(workspace) {
  const root = resolve(workspace);
  const dir = join(root, ".superpowers");
  return {
    root,
    dir,
    state: join(dir, "state.json"),
    events: join(dir, "events.jsonl"),
    context: join(dir, "context.json"),
    otel: join(dir, "otel-traces.json")
  };
}

export async function ensureWorkspace(workspace) {
  const paths = workspacePaths(workspace);
  await mkdir(paths.dir, { recursive: true });
  try {
    await readFile(paths.state, "utf8");
  } catch {
    await writeFile(paths.state, `${JSON.stringify({
      state: "intake",
      trace_id: randomUUID(),
      run_id: randomUUID(),
      updated_at: new Date().toISOString()
    }, null, 2)}\n`);
  }
  return paths;
}

export async function readState(workspace) {
  const paths = await ensureWorkspace(workspace);
  return JSON.parse(await readFile(paths.state, "utf8"));
}

export async function appendEvent(workspace, event) {
  const paths = await ensureWorkspace(workspace);
  await appendFile(paths.events, `${JSON.stringify(event)}\n`);
  return event;
}

export async function emitEvent(workspace, input = {}) {
  const state = await readState(workspace);
  const event = {
    id: input.id ?? randomUUID(),
    trace_id: input.trace_id ?? state.trace_id,
    run_id: input.run_id ?? state.run_id,
    timestamp: input.timestamp ?? new Date().toISOString(),
    type: input.type ?? "event",
    agent: input.agent ?? "harness",
    source: input.source ?? "superpowers-harness",
    state: input.state ?? state.state,
    payload: input.payload ?? {},
    metadata: input.metadata ?? {}
  };
  return appendEvent(workspace, event);
}

export async function transition(workspace, nextState, metadata = {}) {
  if (!STATES.includes(nextState)) {
    throw new Error(`Unknown state: ${nextState}. Expected one of ${STATES.join(", ")}`);
  }
  const paths = await ensureWorkspace(workspace);
  const current = JSON.parse(await readFile(paths.state, "utf8"));
  if (current.state !== nextState && !TRANSITIONS.get(current.state)?.has(nextState)) {
    throw new Error(`Invalid transition: ${current.state} -> ${nextState}`);
  }
  const next = { ...current, state: nextState, updated_at: new Date().toISOString() };
  await writeFile(paths.state, `${JSON.stringify(next, null, 2)}\n`);
  await appendEvent(workspace, {
    id: randomUUID(),
    trace_id: next.trace_id,
    run_id: next.run_id,
    timestamp: next.updated_at,
    type: "state_transition",
    agent: "harness",
    source: "superpowers-harness",
    state: nextState,
    payload: { from: current.state, to: nextState },
    metadata
  });
  return next;
}

export async function readEvents(workspace) {
  const paths = await ensureWorkspace(workspace);
  let content;
  try {
    content = await readFile(paths.events, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return content.split("\n").reduce((events, line, index) => {
    if (!line.trim()) return events;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Invalid event log JSONL at line ${index + 1}: ${error.message}`);
    }
    return events;
  }, []);
}

export async function buildContext(workspace, limit = 20) {
  const state = await readState(workspace);
  const events = await readEvents(workspace);
  const context = {
    trace_id: state.trace_id,
    run_id: state.run_id,
    state: state.state,
    generated_at: new Date().toISOString(),
    recent_events: events.slice(-limit),
    event_count: events.length
  };
  const paths = workspacePaths(workspace);
  await writeFile(paths.context, `${JSON.stringify(context, null, 2)}\n`);
  return context;
}

export function eventToSpan(event, index) {
  const start = Date.parse(event.timestamp) * 1_000_000;
  return {
    traceId: event.trace_id.replaceAll("-", "").slice(0, 32).padEnd(32, "0"),
    spanId: event.id.replaceAll("-", "").slice(0, 16).padEnd(16, "0") || index.toString(16).padStart(16, "0"),
    name: `${event.agent}.${event.type}`,
    kind: event.type === "generation" ? 3 : 1,
    startTimeUnixNano: String(Number.isFinite(start) ? start : Date.now() * 1_000_000),
    endTimeUnixNano: String((Number.isFinite(start) ? start : Date.now() * 1_000_000) + 1_000_000),
    attributes: [
      ["superpowers.state", event.state],
      ["superpowers.agent", event.agent],
      ["superpowers.source", event.source],
      ["superpowers.event_type", event.type],
      ["superpowers.payload", JSON.stringify(event.payload)],
      ["superpowers.metadata", JSON.stringify(event.metadata)]
    ].map(([key, value]) => ({ key, value: { stringValue: String(value) } }))
  };
}

export async function exportOtel(workspace, { send = false } = {}) {
  const events = await readEvents(workspace);
  const paths = workspacePaths(workspace);
  const traces = {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "superpowers-harness" } }] },
      scopeSpans: [{ scope: { name: "superpowers-harness-demo", version: "0.1.0" }, spans: events.map(eventToSpan) }]
    }]
  };
  await writeFile(paths.otel, `${JSON.stringify(traces, null, 2)}\n`);
  if (send) await sendOtel(traces);
  return { path: paths.otel, spans: events.length, sent: send };
}

async function sendOtel(body) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    (process.env.LANGFUSE_HOST ? `${process.env.LANGFUSE_HOST.replace(/\/$/, "")}/api/public/otel/v1/traces` : "");
  if (!endpoint) throw new Error("Set OTEL_EXPORTER_OTLP_ENDPOINT or LANGFUSE_HOST before using --send");
  const headers = { "content-type": "application/json" };
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")}`;
  }
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`OTLP export failed: ${response.status} ${await response.text()}`);
}
