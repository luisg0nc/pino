# A workspace of boards, a New project page and a Brief that lives on

Luis tried pino on his own machine on 2026-11-26 and found what torno has and pino lacks: no way to start a new board
except picking a folder by hand, no list of his boards, and no brief. This design brings torno's start of a project
to pino, adapted for printed circuit boards. Luis asked for an initial idea he can grow from, so it settles the shape
and leaves room.

## Why

A board starts the way it goes on. What the person knows before Claude writes a line (what the board does, how it is
powered, what plugs into it, where it has to fit, the parts already in the drawer, how it will be made) should reach
Claude as given, so the first round of questions asks only for what is missing. Then what Claude learns along the way
(the parts it chose and why, the open questions, the power budget) should stay where both of them can read it later,
not scroll away in the chat. pcb-kit makes every project write a `DESIGN.md` (requirements, candidate parts with the
date stock was checked, decisions with their reasons, open questions and what waits on them) before any schematic,
for the same reason. torno's Brief in two voices (torno #347) is the page for it.

## Goals

1. **A workspace.** On first run pino asks for one folder that holds the person's boards (suggested: `~/boards`). Its
   boards are its direct subfolders. pino remembers the workspace and the workspaces opened lately.
2. **The title bar as torno's:** a workspace crumb (its menu: the recent workspaces, "Open workspace…") and a project
   crumb (its menu: every board in the workspace, "New project…" at the top). This replaces pino's single folder
   crumb and its recent-folders menu.
3. **New project page**, torno's page of slots (`New A`), with PCB slots. At the top: the name (the folder's name)
   and "What it does" in the person's words, with photos beside it. Then tiles to add:
   - **Power:** where it comes from (USB-C, battery and its kind, barrel jack, a host's header), the voltage, the
     current if known.
   - **Connections:** a row per thing that plugs in or sits on the board (a sensor, a display, a button, an LED),
     with how it talks (I2C, SPI, UART, GPIO, USB, analog) and its connector if known.
   - **Size and shape:** width and height, or "fits an enclosure" with a note; mounting holes; a height limit; which
     edge a connector must sit on.
   - **Parts I have:** LCSC numbers or modules (an ESP32-C3 module), each checked against JLC stock as it is typed,
     through the same lookup Claude's `parts` tool uses.
   - **Fab and assembly:** layers (2 or 4), board thickness, whether JLC assembles it, I solder it, or a mix, and
     how many boards.
   - **Rules:** free text ("hand-solderable, 0805 or larger", "antenna at the edge").
   - **Links and PDFs:** datasheets and reference designs, as torno's slot.
   - **Sketch:** torno's doodle, on the grid or over a photo (a block diagram, where the connector goes).
   The right pane shows the first prompt as main writes it, updated as the slots fill (torno's draft pane).
   **Start** makes the project, opens it and sends the first prompt; "Make it without starting Claude" does all but
   the last.
4. **The first prompt** says what to settle before `board.py` exists, once (torno #326, adapted): Claude asks what is
   missing, checks the parts it means to use, and writes its findings as cards before it writes the board.
5. **The Brief page**, torno's two voices:
   - **In your words:** `brief.md`, formatted, with the person's pictures. It belongs to the person. Claude never
     writes it (torno's hook refuses Claude's `Write`, `Edit` and `MultiEdit` of `brief.md`).
   - **What Claude wrote down:** Claude's cards on a spine of the prompts that wrote them, as torno #347: under each
     prompt what the person said, struck through where a later prompt changed it, "new since you looked", and
     "make it yours".
   - **Tables:** size and shape, rules, and the fab's limits (spec 5.7, already in pino), each row saying who wrote it.
6. **Card kinds for boards,** from pcb-kit's `DESIGN.md`, on top of torno's note, size, rule and link:
      (The skeleton of this list is copied from torno at GitHub main `8086e7ca`, where #326 and #347 are merged.)
   - **Requirement:** one thing the board must do or meet.
   - **Decision:** what was chosen and why (pcb-kit's decisions table).
   - **Open question:** what is not known yet and what waits on it.
   - **Part:** an LCSC number with its class (basic or extended), package, stock and price, and the date stock was
     checked. The page can check stock again on request.
   - **Power budget:** a rail, its source and what draws from it, with the numbers Claude used.
   Claude adds and changes cards with an `add_card` tool and its siblings, as torno's; it changes its own card for a
   topic instead of adding another.
7. **What the person entered on the New project page** becomes the first content: the description and photos into
   `brief.md` and `reference/`, each other slot into cards of the person's (power, connections, sizes, parts, fab,
   rules, links), grouped as torno groups them in frames.

## Non-goals

- Renaming or moving a part by hand: its own design, next (Luis ruled torno's side on 2026-11-26: rename only, written
  like Go back, Claude told once at its next prompt; torno issue #359).
- Importing an outline from a torno project. pino's design kept the outline format compatible, and Luis parked the
  torno link ("for now just focus on pino").
- Fetching a link or reading a PDF's text in pino: Claude reads them with its own tools, as in torno.
- Keeping a draft of the New project page on disk between runs (as torno).
- A free canvas on the New project page (Luis picked the page of slots over the board for torno, option B).
- Projects outside the workspace. A board elsewhere is opened by opening its parent as a workspace.

## Anti-goals

- Nothing is written in the workspace until Start (or "Make it without starting Claude").
- A new project's folder is whole or not there: made under a hidden name and renamed, as torno's `objects/create.ts`.
- Claude never changes the person's words (`brief.md`) or the person's cards.
- The first prompt does not grow without bound: every slot is capped, as torno caps notes, sizes, rules and links.
- No network from tests: the stock check on the New project page uses the recorded jlcsearch answers in tests, like
  the `parts` tool (`PINO_PARTS_OFFLINE`, `PINO_PARTS_RECORDED`).

## Constraints

- **Copy now, extract later.** Each torno file is copied from a named torno commit at the same relative path, then
  adapted, and listed in `shared-from-torno.json`. Never retyped from memory. torno is only ever read.
- **torno moves fast.** Its local checkout (`~/projects/torno`, at #325) is behind GitHub main (`8086e7ca`,
  Version 0.2.3, #358). Copy from GitHub main at a fixed commit (`gh api`), or after Luis pulls his checkout; record
  that commit. The parts shelf (torno, in progress) is not copied.
- **The workspace-write invariant changes.** Today: "Never write inside a project folder except under
  `<project>/.pino/`. This stage has no exceptions." After: one exception, as torno's: making a new project (its
  folder, `brief.md`, its pictures, sketches and PDFs in `reference/`, and its cards). The Brief page never writes
  `brief.md` (torno's at `8086e7ca` does not: notes the person makes on the page are cards). `CLAUDE.md` and
  `.claude/rules/workspace-writes.md` say so in the same change.
- **Cards live in `.pino/brief/`** (not `.pino/board/`: "board" means the PCB in pino). Main is the only writer; ids
  are main's and never reused, as torno's `C<n>`. The cards file is part of the project and goes into git; what the
  person has seen (`seen.json`) does not.
- **One app prefix** (`app/src/shared/app.ts`), "project" in code, never "object" (`names.test.ts`): torno's `objects/`
  and `ObjectInfo` are renamed on the way in, and `shared-from-torno.json` says so.
- **The system prompt's size cap** (`turncost.test.ts`): one short line about the Brief; the skill and the tools carry
  the detail.
- Hidden windows only in tests, the stand-in agent and engine, the live-desktop rules.

## Approaches

- **A. Port torno's code (picked).** Copy torno's workspace scanner, `objects/create.ts`, the onboard page, the
  cards store, the Brief page and its hook, then adapt the slots and card kinds for boards. Most of the code is shared,
  so a later extraction into one package is a move, not a merge.
- **B. A pino-only lighter version:** a form that writes `brief.md` and a read-only Brief. Less work now, but the two
  apps drift and the Brief stops being a page that lives on. Against why Luis wants it.
- **C. Wait for torno to extract a shared package.** No package exists and torno's brief changed today; pino would
  wait on work nobody has planned.

## Decided by Luis (2026-11-26)

- A workspace folder holds every project (over "any folder, New project asks where").
- The Brief lives on, as torno's now (over "the first message only").
- The silk, menus, parts tool, chat resize and 3D tracks are fixed separately (PRs on their own branches).
- No mockups for now; the shape above is a starting point he will grow.

## My calls (Claude's, for Luis to check)

- The default workspace suggested on first run is `~/boards`.
- A project is any direct subfolder of the workspace that is not hidden; one with neither `board.py` nor `brief.md` is
  listed as empty.
- Cards in `.pino/brief/`, and the PCB card kinds above.
- "Fab and assembly" sets the fab profile the first prompt asks Claude to write into `board.py`; the profile stays in
  `board.py` (the source of truth), the card records what the person asked for.
- Stock on a part card is checked again only when the person asks (a button), not on every open: jlcsearch is a
  public service.
- **No pino skill in this round.** pino starts Claude with `skills: false` and has no plugin; adding one is a stage
  of its own. The detail goes into the card tools' descriptions, `SERVER_INSTRUCTIONS` and the first prompt, inside
  `turncost.test.ts`'s caps (tools under 33,000 characters, the fixed tool count raised by the new card tools, system
  prompt and instructions under 12,000). The first prompt uses torno's long form (the one torno sends when no skill
  is loaded).
- **Opening a workspace** shows torno's page of projects, each board with its newest build's thumbnail; an empty
  workspace opens on the New project page. pino starts on the project that was open last. The first screen
  (`Welcome.tsx`) stays for first run (choosing the workspace) and for what is missing on the machine.
- **Part cards:** Claude gives the LCSC number and its reasons; main fills class, package, stock, price and the date
  from the lookup, so the numbers are never Claude's guess. "Check stock again" stores a new reading in those
  main-owned fields; it is not an edit of Claude's words, so it neither goes into `was` nor counts as new since you
  looked.
- **The launcher's folder** may name a workspace or a project. A folder that is a project (it holds `board.py` or
  `brief.md`) opens its parent as the workspace, on that project. The recent project folders in pino's config become
  recent workspaces (their parents), once, and `project` keeps naming the last project.
- **Sizes on the Brief** show the person's size cards and, beside each, what the newest build's `outline.json` says,
  marked when the two disagree; the board file stays the truth, the card what was asked for (as with the fab).
- The route card's "Brief" section, which says Claude keeps the brief in `brief.md`, is replaced by a link to the
  Brief page.

## Left to the builder

- Which torno files to copy, at the commit recorded; how torno's frames group the person's cards, kept as is.
- The exact fields of each PCB slot and card kind, as long as each maps to a row the person can read.
- How the first prompt words what to settle, within the system prompt's cap.
- The order of the work (the plan): workspace and title bar first, then the cards store and Brief page, then the New
  project page and first prompt.
