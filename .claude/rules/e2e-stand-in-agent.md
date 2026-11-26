---
paths:
  - "app/test/**"
  - "app/src/main/sessions/stream.ts"
  - "app/src/main/sessions/stream.test.ts"
---

# The stand-in agent, the specs that use it, and never the real CLI

## The chat and the stand-in agent (`app/test`)

A chat session is tested with `app/test/fake-agent.mjs` in its stream mode, which it enters when started with
`--input-format stream-json`: it speaks Claude Code's protocol on its pipes and prints nothing else. Its header
lists everything it does; in short, a prompt's text is a script of one command per line: `say`, `tool <name>
<json>` (a name beginning `mcp__pino__` calls pino's MCP server for real), `ask <name> <json>` (a permission
request, answered by the window), `slow <s>`, `work <s>` (a tool that takes that long), `rate <percent>`, `images`,
`garbage`, `retry`, `deny` and `argv`; `/noop` and `/compact` are what the CLI does for them. `write <file>
<content>` and `edit <file> <old> <new>` play a `Write` and an `Edit` with their hooks, and write the file for real;
a `PreToolUse` pino answers with `permissionDecision: deny` writes nothing. A `Stop` pino answers with
`decision: block` is not the end of the turn: the stand-in says the reason as a `hook_response` and posts it again.
As the real CLI does, a prompt that comes while a tool runs is folded into the running turn, and an interrupt while a
request waits sends `control_cancel_request` first.

The app's name is held once at the top of the stand-in (`const APP = 'pino'`), and a test holds it equal to
`APP.name`.

Two fixtures were recorded from the real CLI and scrubbed (in torno, from which they were copied):
`app/test/fixtures/claude-stream.jsonl` (Claude Code 2.1.300: a turn, tool use, hooks) and
`claude-stream-asks.jsonl` (2.1.301: a permission, a question and `/compact`). Every line of both parses as JSON.
Never run the real `claude` to record or check; that is done by hand (`app/test/fixtures/RECORDING.md`).

## Never run a real agent CLI from tests (root `CLAUDE.md`)

Tests set `PINO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`. No test runs `claude`: a real CLI spends
the person's subscription, depends on their login and settings, and asks questions in folders it has not seen.
Checking pino against a real CLI is done by hand, once per change that needs it. Give the run a HOME of its own when
a spec checks that nothing is written to the person's settings.
