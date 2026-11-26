---
paths:
  - "app/src/shared/marks.ts"
  - "app/src/main/marks/**"
  - "app/src/main/domain.ts"
  - "app/src/main/mcp/markTools.ts"
  - "app/src/renderer/board/marks/**"
  - "app/src/renderer/ui/MarkChip.tsx"
  - "app/src/renderer/ui/route/MarkInHand.tsx"
  - "app/src/renderer/ui/route/MarksBlock.tsx"
  - "app/src/renderer/ui/chat/markChips.ts"
---

# Marks: what the person points at, and what Claude points back with

- A mark is a point (on the board or the sheet), an arrow, a stroke or a region. The person's are violet
  (`--user-mark`), Claude's orange (`--agent-mark`). Ids are `M1`, `M2`, and none is used twice.
- Main is the only writer, one change at a time, to `.pino/marks/marks.json` (`pino.marks/1`), through `ownFolder`
  and `writeFileAtomic`. A file that cannot be read is set aside and said; it is never overwritten. What the window
  or a tool asks to be marked is a `NewMark`; main works out the id, label, position and `payload`, and
  `sanitiseMark` keeps only the fields pino knows.
- `payload` is the exact line Claude gets (`markPayload`). The route card shows it as it is.
- The life: the person's mark is a draft until a prompt takes it. Main puts drafts into the prompt's context and
  marks them sent only once that context has reached the agent (`PromptContext.delivered`). Claude's are sent from
  the start. `resolve_mark` and the person resolve a sent mark; a draft cannot be resolved.
- After every build that drew something, each open mark is looked for again by its ids (`reanchor.ts`): moved
  (more than 0.01 mm) or stale (gone). A stale mark stays where it was, faded, with what it was. Claude's arrow
  across a gap keeps both things (`toward`) and is measured again: its ends, its chip and its line. Resolved marks
  are left as they are.
- A chip sits on its mark's point with no leader, moved up only to keep off another chip (`chips.ts`). The same chips
  are in the composer (what goes with the next prompt, removable), under the prompt they went with, and on the card of
  Claude's `point`.
- Claude's `point` makes all its marks or none: every name is looked up and the limit checked first. A gap is an arrow
  across the two nearest points of copper (`gapSpan`), labelled with what `measure` says.
