# pino: design

Status: for Luis's approval, 2026-11-26. Approaches picked by Luis on 2026-11-26 (section 4); his rulings are
recorded in section 9.

## 1. What pino is, and why

pino is a Linux desktop workbench where Claude Code designs printed circuit boards end to end. It is a sibling of
torno (the build123d CAD workbench): same shape, same look, same session plumbing, as much shared code as possible,
so work on one can be carried to the other.

Luis calls the way of working "vibePCB", after torno's "vibeCAD": he describes the board and points at it; Claude
does all the work, including placement and routing; pino shows the result on every save. Nobody edits the board by
hand, and nobody needs to open KiCad.

Why it exists, in Luis's words and from an earlier engine-controller board made mostly this way (the closest prior art):

- "I don't see what claude is building until I ask it to show me some rendered pages in html." On that board his whole view
  of the layout was three static renders, sent once as file paths, in which the copper was barely visible.
- Pointing was easy on the schematic (part names) but "lines in pcbs were harder because you had to explain in
  words, what can easily be communicated by pointing in real life." Its placement review went back and forth in
  prose ("move R7 and R8 2 mm east").

So pino's two jobs, in order: the board is always on screen and updates when Claude saves; and Luis points instead
of describing.

## 2. Goals, non-goals, anti-goals

Goals (first version):

1. A live view with three tabs over one build: Schematic, Board (2D, per layer), 3D. Rebuilt on every save of the
   source file, with what changed highlighted. Shown without being asked.
2. Marks: click a part, pin, wire, pad, track, via or zone; draw arrows, strokes and regions. Each reaches Claude as
   an exact reference (part, pad, net, layer, position in mm), never as a picture to interpret.
3. Claude sees what Luis sees: the same views and marks through MCP tools, and it can point back (highlight the
   parts and tracks it means).
4. Two speeds: a fast build on every save (schematic, placement with ratsnest, electrical checks, fit) in seconds;
   routing as a background job in minutes, followed by the design rule checks.
5. Checks that cannot be fooled by names: connections are checked by the parts and pins on a net, not by net names
   (on the earlier board, a name-based check passed a wrong join).
6. Real, orderable parts: JLCPCB in-stock parts by default, basic over extended, checked through jlcsearch.
7. Done means fab files for JLCPCB assembly: Gerbers, drill, BOM and CPL in JLC's format, with hand-fit parts left
   out of assembly. Luis uploads them himself.
8. Torno's design language with a PCB solder-mask green accent where torno uses blue.

Non-goals (first version):

- Hand editing of the board, in pino or in KiCad. KiCad files are an output, like torno's STEP.
- Filling the JLC cart, ordering, production records (pcb-kit's fab-order and production tooling).
- The torno link (board as a 3D reference part in torno, enclosure outline flowing back). Parked by Luis: "for now
  just focus on pino". The outline file format below is kept compatible so the link can come later.
- SPICE simulation, the 1:1 fit print, failure reviews: later skills, not v1.
- macOS. torno supports it; pino starts Linux only (KiCad paths and the pcbnew Python differ). Revisit later. pino is
  still meant for other people to install, like torno (Luis), so nothing may depend on how Arch packages KiCad.
- BGA parts, controlled impedance, copper heavier than 1 oz, boards past about 100 parts: later. v1 covers 2 and 4
  layers, about 100 parts, fine-pitch QFN and USB differential pairs (Luis).
- Languages other than English. pino ships in English, like torno (Luis); translation can come to both later.

Anti-goals (would make pino a failure even if it works):

- Static pictures the person has to ask for, or renders where copper cannot be read.
- Spatial feedback that has to be written as prose.
- A check that passes because two nets have the right names.
- A token bill like the earlier board's (about 2.2B cache-read tokens over its phases). Cost stays in view and in tests, as torno
  does with `turncost.test.ts` (my call: per-turn ceilings, starting from torno's: system prompt plus server
  instructions under 12,000 characters, up-front tools under 33,000, at most six pictures in an answer; build
  verdicts and tool results get size caps of their own, set in the plan).
- Jargon without a gloss ("What does this footprints number mean?"). Choices come with plain words.
- Fab limits discovered after a choice (the earlier board picked 2 oz copper, then found a reused module could not be built at
  2 oz). The fab's limits are shown before options are offered.
- Anything that steals focus, touches Luis's running apps, or writes outside the project's own folder.

## 3. Constraints

- Development machine: Arch Linux, Wayland. KiCad 10.0.6 and kicad-cli are installed. `pcbnew` imports only under
  `/usr/bin/python3` (3.14.7); the `python3` on PATH (miniforge 3.12) lacks it. ngspice 47, node 26, uv and java are
  present; freerouting, kikit, atopile and kipy are not.
- KiCad 10's IPC API needs a running KiCad window; headless IPC comes with KiCad 11. pino works from files and
  kicad-cli, plus pcbnew in a child process for what the CLI cannot do.
- pcbnew's SWIG bindings are deprecated and have known traps (BOARD.Remove on some items corrupts bindings,
  SaveBoard aborts headless: use PCB_IO_MGR.Save; iterator breakage on Python 3.14). Every pcbnew call runs in a
  fresh child process with JSON in and out.
- The repo starts private and is treated as public: a leak audit before every push; no personal paths, hosts,
  credentials, data from other projects or other people's details. No Claude attribution on commits or PRs while private.
- Licenses: pino is Apache-2.0 like torno (my call). Code ported from pcb-kit (MIT) keeps its notice in a NOTICE
  file and in the ported files. Freerouting is GPL: if used, it runs as a separate program and is never bundled
  into pino's code. konnect (AGPL) is not used. The earlier board's tools belong to
  another project: reference only, nothing copied (Luis).
- Torno's hard rules carry over: pino never writes into a project outside `<project>/.pino/` (plus the source file
  the agent writes, a new-project folder and fab output folder); the agent's session token lives only in the
  environment; tests never run the real `claude` CLI; tests never open a visible window or steal focus.

## 4. Approaches

### 4.1 What the board's source file is (Luis picked A, "if it is actually possible")

pcb-kit generates whole schematics from Python blocks, and the earlier board's tools edited `.kicad_sch` by script with a
byte-identical round trip, so it is possible; the schematic-writer spike in section 7 proves the round trip through
KiCad 10 before anything is built on it.

- **A. A Python board file, torno's way (recommended).** Claude writes `board.py` with a small pino library: parts,
  connections by pin, placement intent and rules. pino's Python engine turns it into KiCad 10 files with stable IDs
  on every save; kicad-cli gives checks, pictures and 3D; routing runs in the background. Same shape as torno
  (code file, Python engine, rebuild on save); KiCad files are what JLC and every tool take. Cost: pino owns a KiCad
  writer, a few hundred lines per file type by pcb-kit's and the earlier board's evidence.
- **B. tscircuit (TSX).** Same language as the app, its own React viewers, fastest first picture. Its router is the
  weakest of the options and KiCad is only an output, so the riskiest part (routing) sits on the weakest base.
- Ruled out: data files as the source, the earlier board's way (less expressive than code, and the model is code); driving KiCad
  live through IPC or a KiCad MCP server (needs the GUI until KiCad 11, and the MCP servers are imperative edit
  tools, the opposite of "the model is a file").

### 4.2 How pino shares code with torno (Luis picked A)

- **A. Copy now, extract later (recommended).** pino starts with torno's general modules copied at mirrored paths,
  listed in a manifest with the torno commit they came from; a sync script reports drift both ways. pino uses
  "project" in code and a configurable app prefix from day one, so the copies already have the shape of a shared
  package. When pino goes public, the shared parts move into packages in small torno PRs. No risk to torno now.
- **B. One repo with shared packages now.** Cleanest end state, but impossible while pino is private and torno is
  public, and it rearranges torno while it has live worktrees.
- **C. A separate shared package repo now.** Every shared change becomes a release across three repos: too much
  friction this early.

## 5. How it works

### 5.1 A pino project folder

```
my-board/
  board.py            the model: Claude writes it, pino builds it on every save
  brief.md            requirements in words (as torno's Brief)
  reference/          datasheets, photos, sketches
  outline.json        board outline, holes, keep-outs, height limit (pcb-kit enclosure.json shape)
  .pino/              owned by pino only
    build/<hash>/     the KiCad project (.kicad_pro, .kicad_sch, .kicad_pcb, .kicad_dru), SVGs, GLB, check JSON
    routes/<hash>/    routed copper, keyed by what it depends on
    marks/            marks file (atomic writes, main process is the only writer)
    builds.json       build history
  fab/<version>/      Gerbers, drill, BOM, CPL (written by the release step only)
```

### 5.2 The board file (sketch; the library's exact API is the builder's)

```python
from pino import Board, part, jlc

b = Board("blinky-c6", layers=2, outline="outline.json", fab=jlc.standard_2layer)

mcu  = b.add(jlc("C<mcu>"), ref="U1", role="MCU")            # LCSC part numbers: placeholders, not real parts
usb  = b.add(jlc("C<usb>"), ref="J1", role="USB-C")
ldo  = b.add(jlc("C<ldo>"), ref="U2", role="3V3 LDO")

b.net("VBUS", usb.VBUS, ldo.VIN)
b.net("3V3",  ldo.VOUT, mcu["3V3"])
b.gnd(usb.GND, ldo.GND, mcu.GND)

b.place(usb, edge="bottom", center=True)                     # intent, not coordinates
b.place(ldo, near=usb, side="top")
b.keepout(region=(0, 0, 10, 6), layers="all", why="antenna")

b.expect_path(usb.VBUS, ldo.VIN)                             # checked by pins, not by names
b.net_class("power", ["VBUS", "3V3"], width=0.5)
```

- Parts come by LCSC number or by KiCad library name (my call on the source): KiCad's own libraries first, with the
  LCSC number kept as a field; EasyEDA's data only as a fallback, converted by a port of pcb-kit's MIT
  `import_easyeda.py` (no AGPL tools such as easyeda2kicad). Converted symbols, footprints and 3D models are cached in
  a user-level cache and copied into `.pino/`. A rotation-correction table per footprint makes JLC's CPL right
  (KiCad-library footprints usually need one).
- Connections are by pin. Net names are labels for people.
- Placement is intent (edge, near, side, group, fixed position when needed). pino's placer turns intent into
  positions and scores them (pcb-kit's ratsnest scorer, ported).
- `expect_path` and similar assertions are the model's own checks, shown with the others.
- Schematic layout (my call): the schematic is a sheet Luis can review, not only a click surface. Claude declares
  blocks and each part's role in them in `board.py` (pcb-kit's `block(path=..., shunt=...)` idea: path, shunt, tap,
  across); pino arranges each block by those roles and the blocks on the sheet. No general netlist auto-layout.
  The readability lint (overlaps, label collisions, direction rules) is a check like the others.

### 5.3 Build loop

Fast build, on every save (target: a few seconds on a small board):

1. Run `board.py` in the Python engine (torno's kernel pattern: a long-lived process, builds in forked workers) and
   produce a circuit model as JSON.
2. Write `.kicad_sch` with deterministic UUIDs derived from refs and pins, so the board's links never go stale
   (pcb-kit regenerates schematics with new UUIDs, which breaks its own parity checks).
3. Export the netlist; run ERC (`kicad-cli sch erc --format json`).
4. Update the board from the schematic headlessly (match by symbol UUID path), place by intent, compute the ratsnest
   and its score. pino writes `.kicad_pcb` itself: it parses `.kicad_mod` footprints, assigns pad nets and writes
   the board text, because pino is for other people to install and pcbnew is missing from Flatpak KiCad, lives
   elsewhere on other distros, and goes away in KiCad 11. pcbnew (in a child process, under a configurable KiCad
   Python) is allowed only where nothing else will do, each use listed in the kernel's README with what replaces
   it in KiCad 11; zone filling goes through `kicad-cli pcb drc --refill-zones --save-board` where possible.
5. Write per-layer geometry for the 2D view, a GLB (`kicad-cli pcb export glb --include-tracks --include-pads
   --include-zones --include-silkscreen --include-soldermask`) for 3D, and the schematic SVG.
6. Run the fast checks: ERC, pin-based connection checks, schematic readability lint, courtyards, fit against
   `outline.json`, parts stock and basic/extended.
7. Tell the agent the result (torno's build verdict: "On hN", counts, what waits).

Routing, in the background:

- Started by Claude (MCP `route`) or by Luis from the view. Runs in its own process; the view shows "routing" and
  swaps in the copper when done, then DRC (`kicad-cli pcb drc --format json --schematic-parity`) and the copper
  checks run.
- Routed copper is a build artifact keyed by a hash of nets and placement. A save that changes neither keeps the
  copper; one that does marks it stale (drawn faded) until the next route. Claude can keep a route it is happy with
  by writing it into `board.py` (a `keep_route` or fixed track), so the source stays the whole truth. (My call; the
  builder may refine.)
- Which router: settled by a spike before the plan's routing stage (see 7).
- Routing is router plus Claude (my call). The autorouter does what it can; Claude finishes the rest by writing
  tracks into `board.py` (fixed tracks, or routes through a region), guided by Luis's stroke marks. The spike is not
  a go/no-go gate. Pass mark: the reference board fully routed, DRC clean, with the router's share and time
  recorded. A router that crashes headless or takes over five minutes on the reference board is dropped.

### 5.4 The three views

- **Schematic.** Drawn from the KiCad SVG export, with a hit-test layer from pino's own circuit model (pino wrote
  the sheet, so it knows where every symbol, pin and label is). Readable by construction: inputs left, outputs
  right, ground down, supplies up (pcb-kit's schematic-sheets rules).
- **Board (2D).** Drawn by pino from the parsed `.kicad_pcb` geometry on a canvas, per layer, with toggles, net
  colours and the ratsnest. pino draws it itself because every pad, track, via and zone must be clickable. kicad-cli
  layer SVG stays available as "what the fab sees".
- **3D.** The GLB in three.js, reusing torno's viewport patterns where they fit.
- Changed items are highlighted once after a build (torno's "only where something changed, once" motion rule).

### 5.5 Marks

Torno's mark lifecycle (ids `M<n>`, draft, sent, resolved; Claude's marks in Claude Code's orange, the person's
marks in a colour clearly apart from that orange and from the green accent, so not red; chosen in the mocks;
main process as the only writer; marks sit beside the message in the chat) with PCB anchors:

| Mark | Reaches Claude as |
|---|---|
| click a part | `U1` (value, footprint, position, side) |
| click a pin or pad | `U1.3` (pin name, net, layer) |
| click a wire or net label | `net USB_D+` (members by part and pin) |
| click a track segment | layer, net, width, from and to in mm, uuid |
| click a via or zone | net, layers, position or outline |
| arrow | from an item to a point in mm: "move this here" |
| stroke | a path in mm on a named layer, plus the nets and parts it crosses: "route this way" |
| region | a polygon in mm on named layers: "keep out", "put these here" |

Marks re-anchor after a rebuild by stable ids (refs, pins, nets); a track mark whose track is gone is shown as
stale with where it was.

### 5.6 What Claude gets (MCP tools)

Mapped from torno's tools and pcb-kit's commands:

- `look`: a picture of what Luis sees (tab, layers, window, marks drawn), capped like torno's pictures.
- `measure`: exact numbers from the board file, never from pixels: gaps, a net's routed length, widths along a path,
  copper area, via count, distance to edge.
- `check`: all checks with findings that carry positions (ERC, DRC, pin-based paths, lint, courtyards, fit, stock).
- `diff`: what changed between two builds in words (pcb-kit's circuit and layout change functions, ported).
- `nets` / `trace`: members of a net, where a pin leads, connected copper groups.
- `ratsnest`: placement score and crossings, cheap enough to run on every save.
- `parts`: jlcsearch lookup, stock, price, basic or extended.
- `route`: start, status, cancel.
- `point`: Claude highlights parts, pads and tracks in the view when it explains something.

### 5.7 Brief and fab limits

The Brief page (torno's) carries the board's requirements plus PCB facts: layer count, copper weight, board
thickness, the fab's capability table (JLC's limits for the chosen build), net classes. The fab's limits are shown
before Claude offers choices. A `.kicad_dru` rules file per fab build is generated from those limits; DRC runs after
every edit of it (a syntax error disables every custom rule).

### 5.8 Agent rules carried from pcb-kit

Ported nearly as written into pino's system prompt and skills: never waive a finding yourself (a waiver is Luis's
call, with a note); numbers come from the board file, not from pixels; make the picture, look at it, say what you
see, and say what it does not show; state each job's scope and depth up front and name every step left out; an
accepted DRC error gets a measured, part-scoped rule, never an exclusion; plain words for every choice, with jargon
glossed.

### 5.9 Look and feel

- Torno's design language whole: the surface-plate idea, warm paper grey and graphite, Instrument Sans and Martian
  Mono, sentence case, hairlines, one shadow, one easing, motion only where something changed, the same grid (title
  bar, route card, view, session dock, status line), the same chat and session dock.
- Accent: PCB solder-mask green in place of layout blue, in light and dark, held to torno's contrast tests. The
  "dye" field floods the first screen and empty states as solder mask does a bare board.
- Board colours: copper, mask, silk and per-net colours are a second palette, separate from the accent.
- pino needs its own logo and its own scribed first-screen drawing, in torno's construction.
- Per Luis's design taste: about three mocked directions for the board view, the marks on the board and the logo,
  for him to pick from, before those parts are built.

### 5.10 Code layout and sharing (assumes 4.2 A)

- `app/`: Electron + electron-vite + TypeScript, pnpm, mirroring torno's `app/src/{main,renderer,shared}` layout.
  Copied from torno at mirrored paths: the HTTP server and per-session tokens, MCP mount, the Claude launch adapter
  and stream parsing, the write guard (`.pino`), design tokens and fonts, contrast and style tests, the launcher and
  `.desktop` install, the fake agent and e2e helpers, the Bash guard hook, CI minus the kernel jobs. Then, with light
  changes: chat UI, Brief, onboarding, first screen, picker, key sheet, title bar, build history strip.
- `shared-from-torno.json`: each copied file, its torno path and the torno commit. `scripts/torno-sync` shows drift
  both ways and never writes into torno.
- App prefix (`PINO_*`, `X-Pino-Session`) comes from one constant, so the copied code is ready to become a package.
- `kernel/`: Python package `pino_kernel` (uv). Writes KiCad files itself; the rare pcbnew work runs in a child
  process under the KiCad Python (found at start, overridable; `/usr/bin/python3` on Arch). Ports from pcb-kit (MIT, notice kept): S-expression parsing and
  writing, diff functions, schematic lint, route check, courtyards, cleanup, DRC/ERC wrappers, netview, placement
  scorer.
- Tests: vitest, pytest, Playwright e2e in hidden windows with the fake agent; a small fixture board exercises the
  whole loop; CI installs KiCad 10.

## 6. Proving board

Luis has no board in hand for pino. My call: a small two-layer reference board (an ESP32-C6 module, USB-C power,
an LDO, a button and two LEDs) as the e2e fixture, the demo on the site, and the first board taken all the way to
JLC fab files. The earlier board stays in its own project; nothing of it comes into this repo.

## 7. Order of work, and the risky parts first

1. Spikes (throwaway, reported back): the router (KiCadRoutingTools and Freerouting, headless, time and completion)
   on the 2-layer reference board and on a 4-layer test board of about 60 to 100 parts with a QFN and a USB pair;
   the schematic writer round-trip through kicad-cli with stable UUIDs; pino's own `.kicad_pcb` writer accepted by
   `kicad-cli pcb drc`; clickable 2D board drawing from a parsed `.kicad_pcb` at that size.
2. App shell from torno's copied parts, green accent, empty project, session dock working with the fake agent.
3. Engine: board.py to schematic to board with placement, the fast build, the three views.
4. Marks and MCP tools.
5. Routing in the background, DRC, copper checks.
6. Parts, fab limits in the Brief, release to fab files.
7. Design mocks (three directions) for the board view, marks and logo come before stages 3 and 4 build their UI.

## 8. Left to the builder

- The pino library's exact API, names and module layout.
- How placement intent is solved (pcb-kit's scorer search is the starting point).
- Hit-testing and rendering technique for the 2D board and the schematic.
- Caching and hashing details of builds and routes.
- Which torno files are copied as-is versus adapted, within the list above.

## 9. Luis's rulings (2026-11-26)

- vibePCB: only Claude lays out and routes; no hand edits.
- Two speeds: fast build on save, routing in the background ("Seems about right").
- JLCPCB, in-stock parts, basic over extended; done means fab files he uploads himself. (A sponsorship pitch to JLC
  once pino is public is an idea for later, not v1 work.)
- The torno link is wanted, but parked: "for now just focus on pino".
- Private repo for now, treated as public; going public "in near future".
- Source: Python `board.py`. Sharing: copy now, extract later.
- Scope: 2 and 4 layers, about 100 parts. Audience: other people install it, like torno.
- Schematics generated from `board.py` blocks and roles, reviewable, clickable.
- Claude's marks in Claude Code's colour; the person's marks a different colour.
- English only. The earlier board's tools are reference only.

## Calls I made (for Luis to check)

- Apache-2.0, Linux only for v1, the reference board (and a 4-layer router test board), routed copper as a keyed
  artifact with `keep_route`, router plus Claude finishing the routes, KiCad libraries first with a ported EasyEDA
  fallback, pino drawing the 2D board itself, three-direction mocks before UI build, per-turn cost ceilings, project
  folder layout, the logo and first-screen drawing left to the mocks.
