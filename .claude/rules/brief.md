---
paths:
  - "app/src/main/cards/**"
  - "app/src/shared/cards.ts"
  - "app/src/shared/brief.ts"
  - "app/src/renderer/ui/brief/**"
  - "app/src/renderer/state/cards.ts"
  - "app/src/main/mcp/cardTools.ts"
  - "app/e2e/brief.spec.ts"
---

# The Brief: the cards, the page and Claude's card tools

A project's **Brief** is two things: `brief.md`, the person's own words, and the **cards** of
`.pino/brief/cards.json`. In pino a "board" is the printed circuit board: the cards' code, channels and tools say
`cards` or `brief`, never `board`. The files are torno's board of cards, copied and renamed (`moved` in the manifest).

## The cards (`shared/cards.ts`, `main/cards/`)

- Kinds: `frame` (a named group, nothing else), `note`, `rule`, `link`, `size`, `requirement`, `decision`, `question`,
  `part`, `power`, `connection`, `fab`. `size` holds a size, `part` an LCSC number and main's reading of it, `fab` what
  the person asked of the fab; the rest hold words. By `person` or `agent`; main makes no card of its own.
- **Main is the only writer** (`store.ts`), one change at a time for a project, each written whole before it is told.
  Ids are `C<n>`, main's, never given twice. `cards.json` goes into git; `seen.json` and `told.json` beside it are
  ignored.
- **A file that cannot be read whole** (`file.ts`) is copied aside, `cards.json.corrupt-<time>` for one that does not
  parse (a merge's marks), `cards.json.dropped-<time>` when only some cards were left out (a newer pino's kind), and
  the new file's `next` is above every `C<n>` the old text shows (an LCSC number is no id). The window is told once.
- **Who may change what.** Claude adds cards of its own kinds (`AGENT_KINDS`) and changes or removes only those. The
  person adds, removes (Claude's too) and puts back; edits their own words; "Make it yours" (`adopt`) gives them a card
  of Claude's, and keeps who wrote it, in which prompt and when (`from`). Claude's words before each edit are kept
  (`was`, the last six). No id, author, time, prompt or reading is ever taken from the window or a tool.
- **A part's reading is main's** (`readingOf`, from the engine's `parts get`): class, package, stock, price, the day,
  and whether jlcsearch answered. A new reading (`restock`) is no edit: no `was`, no `at`, and nothing new to the
  person or to Claude (`seenHash` and the prompt's line leave it out).
- Followed while the project is open (`watch.ts`): `brief.md` (the window is told) and `cards.json` (read again, a
  pull).

## What Claude gets

- `brief` (`mcp/cardTools.ts`, `cards/text.ts`): `brief.md`'s words, cut at `BRIEF_LIMIT`, then a line a card.
  `add_card`: adds, changes or removes a card of Claude's, stamped with the prompt the session is answering
  (`Sessions.turnNow`).
- Each prompt carries one line, `Brief: <n> cards (<m> new: ...)`, and `brief.md changed since` when it did; it is kept
  as told only once delivered.
- Claude never writes `brief.md`: `refusalOf` denies it and names `add_card`. Main never writes it from the Brief page.

## The page (`ui/brief/`, `state/cards.ts`)

- The Brief is the first tab of the middle of the window. A project with no `board.py` opens on it; else on the tab it
  was left on, kept by the window (`localStorage`, `pino.tab:<project id>`), else the schematic (`firstTab`). Claude's
  `look` there draws the board unless it asks for a tab (`lookTab`).
- Sections, in order: **In your words** (`brief.md` formatted, without its `# name` line and `## References`; the
  photos, doodles and PDFs of `reference/` beside it with their notes from that list; the person's cards by frame),
  **What Claude wrote down**, **Size and shape** (every size; beside one named `Board width` or `Board height`, what
  the build on show measures, marked past 0.05 mm: the board file is the truth, the card what was asked for), **Rules**
  and **Fab** (what the person asked, above the fab's limits).
- The window is given no path and no address: it names a file of `reference/` that main lists, or a link by its card
  and place (`cards/references.ts`), and main opens only `http` and `https`, nothing under test.
