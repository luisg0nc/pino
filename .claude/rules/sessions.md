---
paths:
  - "app/src/main/sessions/**"
  - "app/src/shared/chat.ts"
---

# Sessions: the agent, the chat transport, mode, model and effort

## What crosses processes (root `CLAUDE.md`)

- Claude Code is the one agent pino runs, shown as a chat: the CLI's own headless mode
  (`-p --input-format stream-json --output-format stream-json`) on pipes, under the person's own login, never run by a
  test. There is no terminal view yet. Hooks are the one source of status; the stream adds only that a request waiting
  for the person is `needs_input`. What the CLI says of itself is shown as notes and meta and never changes the status.
  `.pino/chat/` holds text only: no address, no secret, no picture data. A permission answer never writes the person's
  settings: "Allow for this session" sends only `addRules` suggestions, rewritten to `destination: "session"`.

## The manager (`app/src/main/sessions/manager.ts`)

- The manager is plumbing. What the app's domain adds is behind `SessionDomain` (`domain.ts`): `promptContext` (added
  to a prompt through its `UserPromptSubmit` hook) and `stopAnswer` (the `Stop` hook's answer: a block, or null). The
  board's side of it is `PinoDomain` (`main/domain.ts`); nothing about boards goes into the manager. A domain that throws is logged, and the
  prompt and the turn go on.
- One session per project. A second `start` while one runs or starts is answered with the first, and `stopAll` waits
  for one that is being started. Closing or replacing the open project goes through `stopAll`, never through
  `current`, which does not yet see a session that is starting.
- `start` answers, it does not throw, when it cannot start: `{ refused }`, before any token, file or process is made,
  when the command is not found on PATH, and `{ refused, question: { kind: 'trust', files } }` before the first chat
  in a folder with Claude Code settings of its own (`trust.ts`).
- Each session gets a token for `/mcp/<project id>` and `/hooks/<session id>`, revoked at exit, and an MCP config file
  in `configDir` (mode 0600, no secret), removed at exit.
- `stop` ends the CLI's stdin (interrupting a turn at work first), sends SIGTERM to its group after 2 s and SIGKILL
  after 4 s, and, once it has gone, SIGKILL to whatever of its group is left: what the agent started goes with it.
  It resolves once the session's writes under `.pino/` have landed, so nothing is written after. A quit that will wait
  no longer calls `killAll`.
- Every write of a session under the project (the chat log, `session.json`) is in one line (`logging`). A `.pino` that
  is a link or a file is written through by none of them, and the chat goes on.
- When the CLI stops without being asked to, or with a non-zero code, the chat gets a `warn` note with its last
  stderr line and, when it never printed a line, what to check.
- **The agent's writes** (`reach.ts`, `refusalOf`, answered in `Sessions.hook`). A `PreToolUse` of `Write`, `Edit`,
  `MultiEdit` or `NotebookEdit` whose path is outside the project folder, or under `<project>/.pino/`, is answered
  `permissionDecision: deny` with the reason, judged by real paths. So is a write of the project's `brief.md`, which is
  the person's: the reason names `add_card`. All three are judged by where the write lands: a link is followed also
  while what it names is not there yet, since the write would make it. `Bash` is never judged: no path can be read from
  a command, so the CLI's own card stays.
- **Mode, model and effort** are the session's alone (`set_permission_mode`, `set_model`, `apply_flag_settings`,
  held in the CLI's memory), checked before they are sent, and never written to a settings file. `start` takes a
  model and an effort and drops what is neither (`agentChoiceOf`). The last list of models a CLI offered is kept in
  pino's own user data (`KnownModels`).
- `session.json` holds the conversation to resume (`resume.ts`), written when the CLI first names it in the hook of a
  prompt, and is ignored by git, as `chat/` is.
