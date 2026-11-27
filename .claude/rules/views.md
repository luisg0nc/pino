---
paths:
  - "app/src/shared/board/**"
  - "app/src/shared/sheet.ts"
  - "app/src/shared/view.ts"
  - "app/src/shared/look.ts"
  - "app/src/renderer/board/**"
  - "app/src/renderer/sheet/**"
  - "app/src/renderer/three/**"
  - "app/src/renderer/look.ts"
  - "app/src/renderer/ui/ViewPane.tsx"
  - "app/src/renderer/ui/view/**"
  - "app/src/renderer/ui/strip/**"
  - "app/src/renderer/ui/route/Head.tsx"
  - "app/src/renderer/state/timeline.ts"
  - "app/src/renderer/styles/strip.css"
  - "app/e2e/timeline.spec.ts"
---

# The three views: Board, Schematic and 3D

The middle of the window has five tabs: the **Brief** first (see `brief`), then the three views, then **Usage** (see
`usage`). A project with no `board.py` opens on the Brief, one with a board where it was left (`firstTab`,
`shared/view.ts`). The band and the route's pictures are the views' alone (`isViewTab`).

All three draw one view model (`state/viewModel.ts`): the board read from the build's `.kicad_pcb` by
`shared/board/` (pino draws the board itself; the engine's SVG layers are not used), the circuit, the placement, and a
route's copper while there is one.

## Frames

- Two frames, one converter. The board file's is KiCad's page millimetres, y down: parsing and drawing are in it.
  Everything a person or Claude reads or is told is in pino's board frame: millimetres from the outline centre, x
  right, y up. Only `shared/board/coords.ts` converts. The sheet has its own millimetres, y down, from `sheet.json`.
- Numbers come from the board file (`measure.ts`, `refs.ts`), never from pixels. A thing's exact reference is
  `describeTarget`, and the tag, the route card, the marks and Claude's context all say that one string.
- Things are held by stable ids: refs, pins, net names and uuids. A pad of a net KiCad names `unconnected-(...)` is on
  no net.

## The look (the design picks)

- The Board is a technical drawing: graphite copper on the layer in front, pencil tone on the others, pours as
  hatching, pads in ink. A pour's fill has slits to its holes, walked out and back: they are filled with it and never
  stroked (`outlineEdges`). Net colours are a switch, off by default. No net colour's hue lies from 235 to 285 degrees,
  which is the violet of the person's marks (`palette.test.ts`).
- Stale copper fades toward the paper; pads never do.
- The Schematic is KiCad's SVG in pino's ink (`sheet/ink.ts` maps KiCad's colours to tokens and strips anything that
  runs, restyles the window or reaches out). What is where comes from `sheet.json`. Pins and chips on it are HTML at a fixed size.
- 3D is a GLB, lit and recoloured (`three/stage.ts`, `material.ts`, by mesh name). Which one has one rule
  (`shared/model3d.ts`), so that 3D shows the copper the Board view shows: the route's `board.glb` while that copper is
  a route's, fresh or stale, else the build's, which has no routed tracks. Where 3D is then not the board on the Board
  view (a stale route's parts, a route with no model), it says so under its switches, and so does Claude's picture.
- It is drawn only when something changed. Where there is no WebGL the tab says so: an error thrown out of an effect
  blanks the window.
- The route card's head names the newest build in the builds timeline's words (`buildNamed`: `Latest build · prompt 5`,
  `· saved by you`, `· route you ran`; an earlier run's is `Latest build` alone; its history id is the title only) and
  says how it stands in a word or three (`headSaid`: `routed`, `copper stale`, `checks pass`); the counts are in its
  checks. An older build on show is `Prompt 3 · older build` with Back to latest, and no word: the word is the newest's.
- Pins nearer than `GATHER` are one pin with a count. A chip stands off what it marks: at a part's or a pad's corner.
- A tag stands clear of what it names and is tied to it by a leader. What lies over a view carries `data-tag-avoid`.
  The wheel zooms over chips, pins and tags as over the drawing: it is heard on the view's root.
- At the foot of a view, one band at a time (`bandFor`): an older build, a failed build, a route under way, stale
  copper.

## The builds timeline (`ui/strip/`, from torno #332)

- **A bar under the views, folded by default.** `BuildsTimeline` is drawn by `ViewPane` under the Schematic, the Board
  and 3D (`isViewTab`), never on the Brief or Usage, which are no build's (torno draws it only with the model on
  screen). It is `--timeline-h`
  (34 px) across the foot of the views, above the status line; `.views:has(> .timeline) > .views-panel` stands the view
  on it, and the band sits on it. The bar: the toggle (`.timeline-toggle`, `Builds` and how many there are, failed and
  not-kept ones too, so that it is what the chips' counts add up to; how many are kept is the drawer's head,
  `<n> kept`) and a chip
  for each group (`.tl-chip`, oldest at the left; the person's own have a dot in their violet; a prompt's ends with
  what it cost, `chipCost`, torno #372, rule `usage`). The drawer rises from
  the bar over the view (it never resizes it), `inert` while folded. Open or shut is `state/timeline.ts`, the window's
  (`localStorage` `pino.timeline`), toggled by the toggle and by `builds.toggle` (`Ctrl+Shift+H`, global, `App`'s
  `useTimelineKey`, only with one of a project's three views on screen). Which groups show every build is the run's only.
- The rules are `strip.ts`, pure and held by `strip.test.ts`: `stripNodes(history, at, numbering)` (one node a build,
  its caption as today: `ok`, `routed`, `stale`, `2 errors`, `failed`, `not kept`, `building`; `by`, the label:
  `Prompt 4` for a build of a numbered prompt, `Saved by you`, `Route you ran` (the person pressed Route and the router
  laid the copper: pino has no hand routing, so never words that say they drew it), `Earlier` for `unknown`, `Claude Code`
  for a prompt with no number; a running build nothing is known of is `Building`), `stripGroups` (consecutive builds of
  one prompt, or of one other cause, are one group), `groupTitle` (the prompt's words, then its builds; never in the
  label), `buildNamed` (the route card's head) and `stripSays`. What made a build is main's (`BuildEntry.cause`, see
  `engine-client`); the prompts are numbered by `chat.prompts` (`useStripNodes`). pino has no Manual edit (no
  Parameters) and no Went back (no Go back).
- In the drawer a group of several builds is a pile (`.tl-pile`) until a click on it or its label shows every build;
  a chip opens the drawer at its group. A build is a button: a press shows it in the views (`actions.showBuild`), the
  newest that drew being the live one; one not kept cannot be pressed. There is no menu, compare, star or review.
- `e2e/timeline.spec.ts` holds the bar, the groups and their costs, the drawer, the key, the Brief and Usage, and the
  window's memory;
  `views.spec.ts` the route's and a save's builds.

## Motion

Only where something changed, once, and at its end at once for a person who asked for less: the wash over what a
build changed (0.7 s), a landed route's copper drawn in net by net from the pads (1.6 s after 0.5 s; open lines and
pins come back after it), and a band dropping in.

## Keys

Every key is in `shared/keys.ts` and is heard outside fields (`keysHeard.ts` `typingIn`). Esc puts down the nearest
thing in hand first: a line being drawn, the tool, a mark, the selection.

## Claude's picture (`look`)

`renderer/look.ts` draws the asked tab from the build on show onto a canvas of its own, with the view's own drawing
code, so nothing the person sees moves. A picture's lines and chips are never thinner than on screen
(`pixelRatio`). The 3D picture has no window and draws no marks, and says so.

## Checking a change

Compare it with the picked mockup (`docs/superpowers/specs/2026-11-26-pino-design-picks.md`) by taking
`e2e/shots.spec.ts` into a folder outside the repository (see `e2e-hidden-window`).
