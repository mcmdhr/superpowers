# Codex adapter

The adapter keeps Codex as the agent runtime and maps Codex JSONL into the same Harness event schema used by Claude Code.

```sh
export SUPERPOWERS_HARNESS_WORKSPACE="$PWD"
./examples/harness-control-plane/adapters/codex/hook.sh < codex-event.jsonl
```

Use `superpowers-harness state transition <state>` for workflow policy and `superpowers-harness export otel --send` when an OTLP/Langfuse endpoint is configured.
