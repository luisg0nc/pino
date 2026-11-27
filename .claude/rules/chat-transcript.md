---
paths:
  - "app/src/main/sessions/transcript.ts"
  - "app/src/main/sessions/transcript.test.ts"
  - "app/src/main/sessions/stream.ts"
  - "app/src/main/sessions/stream.test.ts"
  - "app/src/main/sessions/claude.ts"
  - "app/src/main/sessions/claude.test.ts"
  - "app/src/shared/chat.ts"
  - "app/test/fixtures/**"
---

# The transcript, and what the CLI says of itself

## Agents (`app/src/main`)

- The transcript (`Transcript`) knows what the stream means and nothing of processes or files: it reduces
  messages and pino's own records (a prompt sent, a hook answered, an ask, the end) to the items of
  `shared/chat.ts`, at most 2,000, and the 40 newest pictures keep their data. Items are never changed once
  handed out. A prompt sent while the agent works is `queued`: it is drawn last, and is sent, moving to the end,
  when the CLI takes it up; the transcript is the one source of that order, for live and for reload, and of
  whether any prompt is still untaken (`untakenCount`, which `Sessions` asks: there is no counter of its own). The
  CLI takes a prompt up in one of two ways, as measured on the real one: a `UserPromptSubmit` hook that names it
  (matched by text; else the oldest untaken that is not a command), which also folds a prompt sent while a tool
  ran into the running turn with no `init` and no result of its own; or, for a prompt beginning with `/`, an
  `init` that no hook explains (`explained`). After a `result`, prompts still untaken are given 1.5 s
  (`IDLE_GRACE_MS`) for their hook or `init` to come; if nothing came, the CLI is idle and they are taken
  (`idle()`), so nothing waits for good. The context of a `UserPromptSubmit` is put under the prompt that hook
  names; the window never parses text for it. Every prompt pino writes carries a `uuid` (kept by the transcript, not
  on the item), and the CLI's `command_lifecycle` with `state: "started"` for it takes it up first and whatever else
  has or has not happened; a prompt taken up that way is not taken twice, and the `init` it explains takes no other.
  An `interrupt` drops nothing: the prompts in its `still_queued` stay queued and the CLI runs them afterwards,
  together, in one turn with one `init`. A prompt the CLI never took up is `not-sent` when the session ends, and only
  then. A tool whose ask the person refused is `denied`, one whose ask ended with the turn stopped `cancelled` (the
  later error result does not make either "failed"); `error` is for a failure the person did not cause. The messages
  of a subagent (`parent_tool_use_id`) are not the agent's words: they are counted on the `Task` card (`steps`) and
  its tool calls listed in `inside`. A thought's `seconds` run from its block's start to its stop. A `user` message
  that is the compaction summary (`isSynthetic`) is not drawn; one that is `<local-command-stdout>` is a quiet note,
  and the "Compacted" of `/compact` is not a second one.
- **What the CLI says of itself** (`Transcript.system`, `finished`). From the `init`, the meta (`ChatMeta`) takes
  `version` (`claude_code_version`), `apiKeySource` and `appConnected` (pino's MCP server); `result` adds `costUsd`
  and `context`, and the `turn` item takes what the turn used as `usage` (numbers only, so it is in the chat's log):
  the tokens and calls the `result` counts, and `costUsd` and `models` as what the CLI's running totals grew by since
  the last `result` (a resumed session's first turn has neither, only `sessionCostUsd`). It also takes the `builds`
  that ran during the turn (`turnBuilds`, from the turn's `init` on; see `usage`). A `warn` note `NO_HOOKS` says once per session that the hooks do not arrive (a prompt of ours the CLI
  started with no `UserPromptSubmit` by 8 s or the end of its turn, in a session where none has come); it never moves
  the status. When the `init` names a key as the credentials' source the note is `RUNNING_BARE` instead. `api_retry`
  sets `retrying` until the API answers. Other notes: a `warn` when pino's tools are `failed`, a `quiet` once a
  session when `apiKeySource` is anything but `none` or `oauth`, a `quiet` once a session when the version is older
  than `TESTED_CLAUDE`'s minimum or of a newer major or minor than its maximum, and a `warn` at a `result` for each
  `permission_denials` entry no card shows. pino passes no plugin of skills yet, so none of the plugin notes can show.
  **A field that is missing or is not the shape expected is "not known", never a warning,** and nothing here throws.
- **A turn that could not authenticate** is known by one typed field alone, an assistant message's
  `error: "authentication_failed"`, never by the words of the message or of the `result`: a `warn` note,
  `LOGIN_FAILED`, once a session. It has no button: pino has no terminal view yet. It moves no status.
- Nothing of the person's settings is read.
