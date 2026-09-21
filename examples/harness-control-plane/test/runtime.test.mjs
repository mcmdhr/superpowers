import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext, exportOtel, readEvents, readState, transition } from "../src/runtime.mjs";
import { ingestJsonl } from "../src/adapters.mjs";

async function workspace() {
  return mkdtemp(join(tmpdir(), "superpowers-harness-"));
}

test("initializes a trace and starts at intake", async () => {
  const root = await workspace();
  const state = await readState(root);
  assert.equal(state.state, "intake");
  assert.ok(state.trace_id);
  assert.ok(state.run_id);
});

test("valid transitions are persisted and audited", async () => {
  const root = await workspace();
  const next = await transition(root, "brainstorming", { actor: "test" });
  assert.equal(next.state, "brainstorming");
  const events = await readEvents(root);
  assert.equal(events[0].type, "state_transition");
  assert.deepEqual(events[0].payload, { from: "intake", to: "brainstorming" });
});

test("invalid transitions fail closed", async () => {
  const root = await workspace();
  await assert.rejects(() => transition(root, "done"), /Invalid transition/);
});

test("Claude and Codex JSONL are normalized into one event schema", async () => {
  const root = await workspace();
  await ingestJsonl(root, '{"type":"assistant","message":"plan"}\n', "claude-code");
  await ingestJsonl(root, '{"type":"function_call","name":"read_file"}\n', "codex");
  const events = await readEvents(root);
  assert.equal(events[0].type, "generation");
  assert.equal(events[0].agent, "claude-code");
  assert.equal(events[1].type, "tool_call");
  assert.equal(events[1].agent, "codex");
});

test("context and OTLP exports are reproducible artifacts", async () => {
  const root = await workspace();
  await transition(root, "brainstorming");
  const context = await buildContext(root);
  const otel = await exportOtel(root);
  assert.equal(context.state, "brainstorming");
  assert.equal(otel.spans, 1);
  const saved = JSON.parse(await readFile(join(root, ".superpowers", "otel-traces.json"), "utf8"));
  assert.equal(saved.resourceSpans[0].scopeSpans[0].spans.length, 1);
});
