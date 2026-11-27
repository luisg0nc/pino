---
paths:
  - "app/src/shared/usage.ts"
  - "app/src/shared/usage.test.ts"
  - "app/src/shared/format.ts"
  - "app/src/main/sessions/usage.ts"
  - "app/src/main/sessions/usage.test.ts"
  - "app/src/renderer/state/usage.ts"
  - "app/src/renderer/ui/usage/**"
  - "app/src/renderer/ui/chat/TurnUsage.tsx"
  - "app/src/renderer/ui/chat/TurnUsage.test.ts"
  - "app/src/renderer/styles/usage.css"
  - "app/e2e/usage.spec.ts"
---

# What Claude Code spent: the turn's line, why a turn was large, the Usage page

torno's, with Luis's picks for it of 2026-11-26: the numbers said in words, dollars first with tokens beside, and a turn
is large at 3 times the project's median turn cost, never within its first 3 prompts. There is no median until more
than 3 prompts have said their cost (`listUsage`): older logs of pino kept none.

- **Only the CLI's numbers.** Every cost, count of tokens and of calls is the `usage` a turn item carries (the
  `result`'s, `TurnUsage`) or a sum of them. Pictures are counts of the log's own items, by the tool that brought them
  (`look` is pino's one tool that returns a picture; `Read` is Claude Code's). Builds are the turn item's `builds`.
  Nothing is estimated, and a turn's cost is never split by cause (no dollars per picture). Numbers through
  `shared/format.ts`: `dollars` (to the cent, whole from $100, `under $0.01`), `tokens` (three digits, `k`, `M`),
  `number`.
- **A turn's own cost** (`Transcript.usageOf`): `total_cost_usd` and `modelUsage` are the CLI's running totals, so a
  turn gets what they grew by. The first turn of a resumed session has `sessionCostUsd` and no `costUsd`
  (`isResumedTurn`): it is said as "not known", never worked out. A turn with neither (a log from before pino kept
  costs) is "not known" too, and is not called a resume.
- **A turn's builds** (`Builds.ranSince`, asked by the transcript through `SessionDomain.turnBuilds` as the turn ends):
  the builds of the open project that began since the turn did and came back, whatever saved the file, with the newest
  before them and the newest of them that drew something (`h<n>`). A build still running when the turn ends is in no
  turn.
- **The project's usage in the window** is `state/usage.ts` (`usageStore`): the rows of `chat.usage` for the open
  project (`Sessions.usage`, which waits for the chat logs being written; `listUsage`, over `listPrompts`, read only),
  asked when it opens (`useProjectUsage`), when a `turn` item comes (`connectChat`) and when the page mounts; an answer
  for another project or older than the last ask is let go. It also holds the page's range (week, the default, month,
  all; never kept), the conversation open and the prompt lit.
- **The end of a turn** (`ui/chat/TurnUsage.tsx`): one sentence under "Done in" (`usageLine`), the reason under a
  resumed turn's, and for a large one `whyLarge`'s facts with "Open in Usage", which chooses the Usage tab with that
  prompt lit.
- **The Usage page** (`ui/usage/UsagePage.tsx`, the rules pure in `ui/usage/usageView.ts`, styles `usage.css`) is the
  last tab of the middle of the window (`PaneTab` `usage`, no view: `isViewTab`). It has no band or selection, Claude's
  `look` there draws the board, and Claude is told "The person sees the Usage page."
  The page: the head (`Usage of <project>`, the span, Week | Month | All as `.segmented`), the lead (`pageLead`: the
  cost over prompts and conversations and the share read again; under it the prompt that took at least a quarter and
  twice the next one, and the prompts with no cost to count), the cost by day or by week (`buckets`; an SVG, one series
  in the accent, a value over each column of a week and over the highest one otherwise, `?` dashed where only unknown
  costs are, `+ n ?` over a column with some, a `<title>` per column), where the tokens went (`tokenKinds`, each kind
  labelled with its share), the turns by their pictures (`byPictures`: 5 or more, 2 to 4, 1 or none, each turn whole),
  and the conversations (`conversationsOf`, named by their first prompt) with `PLAN_NOTE` at the foot. A conversation
  opens to its ledger: a row a prompt, a large one lit with `WhyLarge` under it, and "Resumed here, in a new Claude Code
  process" before a resumed turn.
- **Not here yet:** torno also says each prompt's cost on the chips of its builds timeline, which pino does not have.
  `largeTimes`, `dollars` and `usageStore` are what such a chip reads.
