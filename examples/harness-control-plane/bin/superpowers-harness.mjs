#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildContext, ensureWorkspace, exportOtel, readEvents, readState, transition, emitEvent } from "../src/runtime.mjs";
import { ingestJsonl } from "../src/adapters.mjs";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";
const workspace = option(args, "workspace") ?? process.cwd();

function option(values, name) {
  const index = values.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = values[index + 1];
  values.splice(index, value && !value.startsWith("--") ? 2 : 1);
  return value ?? true;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  if (command === "help") {
    console.log(`Superpowers Harness Control Plane demo\n\nCommands:\n  demo                         Run an end-to-end local demo\n  state current                Print the current workflow state\n  state transition <state>     Move to the next state\n  emit <json>                  Append a normalized event\n  ingest <claude|codex> <file> Normalize external JSONL events\n  context build                Write .superpowers/context.json\n  export otel [--send]         Write OTLP traces; optionally send to Langfuse\n\nOptions:\n  --workspace <dir>            Project workspace (default: cwd)`);
    return;
  }
  await ensureWorkspace(workspace);
  if (command === "demo") {
    const demoEvents = [
      ["brainstorming", { requirement: "Add an observable harness control plane" }],
      ["planning", { plan: ["state machine", "event log", "adapters", "OTLP export"] }],
      ["implementation", { files: ["src/runtime.mjs", "src/adapters.mjs"] }],
      ["testing", { command: "node --test" }],
      ["review", { checks: ["zero dependencies", "JSONL source of truth"] }],
      ["done", { result: "demo complete" }]
    ];
    for (const [state, payload] of demoEvents) {
      await transition(workspace, state, { demo: true });
      await emitEvent(workspace, { type: "generation", agent: "demo-agent", payload });
    }
    output({ state: await readState(workspace), context: await buildContext(workspace), otel: await exportOtel(workspace) });
    return;
  }
  if (command === "state" && args[0] === "current") return output(await readState(workspace));
  if (command === "state" && args[0] === "transition") return output(await transition(workspace, args[1]));
  if (command === "emit") return output(await emitEvent(workspace, JSON.parse(args.join(" "))));
  if (command === "ingest") {
    const agentName = args[0] === "claude" ? "claude-code" : args[0] === "codex" ? "codex" : args[0];
    const file = args[1] ?? "-";
    const content = file === "-" ? await readStdin() : await readFile(file, "utf8");
    return output({ ingested: (await ingestJsonl(workspace, content, agentName)).length, agent: agentName });
  }
  if (command === "context" && args[0] === "build") return output(await buildContext(workspace));
  if (command === "export" && args[0] === "otel") return output(await exportOtel(workspace, { send: Boolean(option(args, "send")) }));
  throw new Error(`Unknown command: ${command}`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  console.error(`superpowers-harness: ${error.message}`);
  process.exitCode = 1;
});
