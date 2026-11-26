---
paths:
  - "app/src/renderer/ui/chat/**"
  - "app/src/renderer/ui/SessionDock.tsx"
  - "app/src/renderer/ui/QuestionCard.tsx"
  - "app/src/renderer/state/dock.ts"
  - "app/e2e/dock.spec.ts"
  - "app/src/renderer/state/chat.ts"
  - "app/src/renderer/state/chat.test.ts"
  - "app/src/renderer/styles/chat.css"
  - "app/src/renderer/styles/chat-slip.css"
  - "app/src/renderer/styles/chat-foot.css"
  - "app/e2e/chat.spec.ts"
  - "app/e2e/helpers.ts"
---

# The session dock and the chat pane

## The dock (`ui/SessionDock.tsx`)

- One session per project, shown as a chat. The dock is drawn anew for each project (`key`), and takes nothing from an
  answer that comes after it has gone.
- The header: "Claude Code", the status word (`role="status"`, the same words as the status line,
  `ui/sessionWords.ts`), the model button once the CLI has named its models, and "More" (Resume once a session has
  ended, New session, Stop). Stop in More ends the session; Stop in the composer interrupts the turn.
- With no session the body is `ui/chat/StartChat.tsx`: the end of the last conversation, "New session" and, when one
  can be resumed, "Resume". Nothing starts until the person acts.
- A start that is refused is said in the dock (`role="alert"`). Refused for the folder's own Claude Code settings, it
  is the question `ui/QuestionCard.tsx` ("This folder has Claude Code settings of its own", the files in the number
  face, "Trust and start" and "Not now").

## Its width

- The dock's left edge is its resize handle (`App.tsx`, `role="separator"`, "Resize session", `.dock-edge` in
  `layout.css`): dragged, or moved 16 px a press with Left and Right (`dock.resize`), from 320 px to what leaves the
  view 420 px beside the card. The width is the window's (`localStorage`, `pino.dock`; `state/dock.ts`), never a
  project's; with none kept, `--dock-w` stands. A smaller window shows less and keeps what was asked for.

## The chat pane (`ui/chat/`, `state/chat.ts`)

- The window draws what main's transcript says: `placed` and `drawn` in `state/chat.ts` reproduce main's order (an
  item keeps its place; a queued prompt is drawn after all the others; sent, it goes to the end), and items and metas
  are merged by `seq` with the history, so none is drawn twice or lost. `App.tsx` connects the store once, before any
  session starts.
- `Items.tsx` draws the person's words, the agent's markdown, thoughts, tool chips (a run of them folded once its turn
  is over), asks, notes, the task list, what pino added to a prompt ("Show text"), and one line at the end of a turn
  (done, stopped, or failed with why). A ref (`U1`, `M4`) in text is set in the number face. Marks are chips: those a
  prompt went with under it, and Claude's on the card of its `point` (`markChips.ts`).
- A tool of pino's own is marked `data-own` (`chat.css`). A result is text; an edit is a `Diff`.
- `Composer.tsx`: Enter sends, Shift+Enter breaks the line, Escape stops a turn at work (else it gives the keys back);
  every key comes from `shared/keys.ts`. A prompt sent while Claude works is queued. With a permission or a plan
  waiting, "Deny and send" refuses it with what is written.
- An open ask takes the foot of the dock (`AskTakeover.tsx`) and takes the focus once, never from someone typing.
- Selectors the specs use: `[data-region="session"]`, `.chat`, `[data-chat-composer]`, `.chat-turn`,
  `.session-status`.
