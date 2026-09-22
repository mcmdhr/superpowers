# Claude Code adapter

The adapter keeps Claude Code as the agent runtime and treats the Harness Control Plane as the policy, state, and telemetry boundary.

Pipe a Claude JSONL hook payload into the adapter:

```sh
export SUPERPOWERS_HARNESS_WORKSPACE="$PWD"
./examples/harness-control-plane/adapters/claude-code/hook.sh < claude-event.jsonl
```

The adapter writes normalized events to `.superpowers/events.jsonl`; it does not change the Claude session or start a nested model loop.
