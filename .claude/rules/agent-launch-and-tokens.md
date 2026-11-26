---
paths:
  - "app/src/main/http.ts"
  - "app/src/main/http.test.ts"
  - "app/src/main/sessions/adapter.ts"
  - "app/src/main/sessions/claude.ts"
  - "app/src/main/sessions/claude.test.ts"
  - "app/src/main/sessions/agentEnv.ts"
  - "app/src/main/sessions/agentEnv.test.ts"
  - "app/src/main/mcp/server.ts"
  - "app/src/main/mcp/server.test.ts"
  - "app/test/fake-agent.mjs"
---

# Launching the agent: the HTTP server, the tokens, the environment

## Global Constraints (root `CLAUDE.md`)

- The HTTP server binds `127.0.0.1` only, on an OS-assigned port. An address holds no secret (`/mcp/<project id>`,
  `/hooks/<session id>/<event>`) and is made only by `HttpRouter.url`. Every request carries a token in the
  `X-Pino-Session` header, compared in constant time (hashed, against every live token); a missing, empty, wrong,
  revoked or unexpanded one (`${PINO_SESSION}`, `$PINO_SESSION`), or one of another session, is answered 404. Each
  session has its own (`HttpRouter.grant` in `Sessions.start`: 32 random bytes as base64url), which opens its own
  hooks and its project's MCP server and is revoked when it has gone. It reaches the agent only in its environment
  (`PINO_SESSION`), never in an argument: a command line is readable by every user of the machine
  (`/proc/<pid>/cmdline`, `ps`), the environment by its owner alone. Claude Code sends it itself: each http hook has
  `headers` with `$PINO_SESSION` and `allowedEnvVars: ["PINO_SESSION"]`, and `--mcp-config` is the path of a file
  under `<userData>/agent/` (never a project; removed with the session, the folder cleared at start) whose
  `headers` hold the placeholder `${PINO_SESSION}`, never the token. It is kept in memory only, never logged
  (`HttpRouter.redact` takes every token of the run out of whatever is logged or kept of an agent's arguments or
  output) and never written to `.pino/chat/` or any other file. The test hook `__pinoMain.mcpFor(id)` gives a
  project's MCP address and a token that opens it; the stand-in agent reads `--mcp-config` from its file and expands
  both placeholders from its environment, as Claude Code does.
- A request with an `Origin` header, or a `Host` that is not this server's own name, is answered 403.

## Agents (`app/src/main`)

- Claude Code is the one agent pino runs. It is started by an adapter (`sessions/adapter.ts`: `AgentAdapter`;
  `claude.ts` `claudeAdapter`, the one there is), which says the `command` looked for on PATH, how its client names a
  tool of pino's to the model (`toolName`: `mcp__pino__project`), and `launch(ctx)`: the command, its arguments as a
  list of strings (never a line for a shell), variables to add to the environment, and files to write
  (`AgentLaunch.files`). Everything the agent is given of pino is on its command line, in its environment, or in a
  config file of pino's that holds no secret (`<userData>/agent/<session id>.mcp.json`, written before the agent
  starts and removed when it has gone). pino passes no skills yet (`skills: false`, no `--plugin-dir`) and every hook
  has a 5 s timeout. The session's token (`LaunchContext.token`) is in its environment alone, as `PINO_SESSION`.
- A `PINO_SESSION`, `PINO_PROJECT_ID` or `PINO_SESSION_ID` pino itself was started with (from inside a session of
  another pino), and the same variables of a sibling app (`SIBLING_PREFIXES` in `shared/app.ts`), reach no process it
  starts: `withoutSession` of `sessions/agentEnv.ts` takes them out, and `agentEnv` also drops pino's own switches and
  the marks of a Claude Code session. An outer token would otherwise reach a model that prints its environment, and
  from its output a chat log that `redact` does not know it for.
- Nothing of the person's Claude Code configuration is written, and none of its settings is read, except that a
  project's own `.claude/settings.json` and `.mcp.json` are looked for before the first chat (`trust.ts`). Nothing is
  written in the project folder outside `.pino/`. The MCP address given is of that project alone.
