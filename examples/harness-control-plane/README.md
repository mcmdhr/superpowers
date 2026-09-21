# Harness Control Plane CLI demo

This is a small, dependency-free demo of the proposed Superpowers architecture:

```text
Claude Code / Codex / Pi
          │
     thin adapter
          │
Harness Control Plane CLI
   state · policy · events
          │
   JSONL facts + OTLP
          │
    Langfuse / replay / eval
```

The CLI does not replace the agent loop. It owns the workflow state machine, a stable event schema, context snapshots, and an optional OTLP export boundary. JSONL remains the local source of truth; Langfuse is an observability sink rather than the event store.

## Run it

```sh
cd examples/harness-control-plane
npm test
npm run demo -- --workspace /tmp/superpowers-demo
node bin/superpowers-harness.mjs state current --workspace /tmp/superpowers-demo
node bin/superpowers-harness.mjs context build --workspace /tmp/superpowers-demo
node bin/superpowers-harness.mjs export otel --workspace /tmp/superpowers-demo
```

The demo writes only these artifacts under the selected workspace:

```text
.superpowers/
├── state.json          # current control-plane state
├── events.jsonl        # append-only normalized facts
├── context.json        # bounded replay/context pack
└── otel-traces.json    # OTLP-compatible trace payload
```

## Optional Langfuse/OTLP export

Set either `OTEL_EXPORTER_OTLP_ENDPOINT` or `LANGFUSE_HOST`. For Langfuse, also set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`, then run:

```sh
node bin/superpowers-harness.mjs export otel --workspace /tmp/superpowers-demo --send
```

No Langfuse SDK is bundled in this demo, so the core remains zero-dependency and the exporter can be replaced by Phoenix, Tempo, or a custom viewer.

## Adapter contract

`adapters/claude-code/hook.sh` and `adapters/codex/hook.sh` accept JSONL on stdin. They normalize the different harness event names into one schema:

```json
{
  "trace_id": "...",
  "run_id": "...",
  "type": "generation | tool_call | state_transition",
  "agent": "claude-code | codex | harness",
  "state": "brainstorming",
  "payload": {},
  "metadata": {}
}
```

This is intentionally an adapter demo, not a claim that every Claude Code or Codex hook emits the same fields. A production adapter should bind to the exact hook/event contract of the installed harness and preserve the raw line alongside the normalized event.
