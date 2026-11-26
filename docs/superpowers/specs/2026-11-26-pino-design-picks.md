# pino design picks (stage 3)

Status: 2026-11-26. Picked by the director while Luis was asleep, on his instruction to take the recommended option;
open to his change. The mockups live on the local branch `design-mocks` (`design/mockups/`, start at `index.html`),
like torno's `design/*` branches, and are not merged.

All mocks were drawn on a real board (an MIT-licensed ESP32-C3 dev board, routed by KiCadRoutingTools in the router
spike) and the schematic spike's generated sheet, and judged from headless screenshots at 1440x900 and 1920x1080.

## Board view: A, "drafting"

The board as a technical drawing: graphite copper on the active layer, pencil tone on the others, pours as section
hatching, the layer control drawn as the stack seen edge-on. Findings are pins; the one in hand gets torno's leader.
Stale copper fades while pads stay in ink.

- Taken from C ("net map"): net colours as a switch (off by default), and the named list of open nets in the route
  card's Routing block.
- Taken from B ("solder mask"): the material look (mask, tin, silk) for the 3D tab only. B is not the 2D view because
  its green fights the green accent and halves the violet marks' contrast.

## Marks on a board: A, "pencil"

torno's mark lifecycle and look on the board: chips sit on their points with no leaders, the route card lists each
mark with the exact payload Claude gets, tools live in torno's reed. Tool and row names use verbs (from C): "Point",
"Arrow: move this here", "Stroke: route this way", "Region: keep this clear" / "put these here".

- The person's marks: marking-pen violet, `--user-mark #6440C4` light, `#A88BFA` dark (white on it 6.84:1, on the
  panel 6.49:1; dark 6.29:1 and 5.67:1). Claude's marks stay Claude Code orange (`#C0502B` light, `#D97757` dark).
  Net colour palettes keep out of hues 235 to 285 degrees.

## Schematic and 3D: A, "the sheet"

KiCad's sheet redrawn in the board view's ink on one paper, blocks as light frames, selection, nets, findings and
marks drawn over it. The tab you are not on shows the selection's ref ("Board · J1"), and switching tabs keeps the
selection. The 3D tab is a live three.js view of the board's GLB in B's material look, with torno's compass and
leader (not a raster render).

## Logo and first screen: E, "pin one"

Picked by Luis on 2026-11-26, replacing the probe (B). A chip seen from above with eight legs, in torno's
construction (64-unit grid, graphite shapes, one green part, a 16 px version on whole pixels). Pino is pin 1: where a
chip's pins are counted from, and the first thing checked before a board goes out. Pin 1, the top left leg, is the
green one, and the pin-1 dot is a hole cut in the body, so the mark works on any background. The dyed first screen
carries it as a scribed drawing whose dimensions (3.9, 1.27, pin 1) draw themselves once (1.6 s). Source shapes:
`design/mockups/logo/e-pin-one.html` on the `design-mocks` branch.

## Open for Luis

- Is the drafting view too quiet as a first impression? Net colours on by default instead?
- Violet for his marks?
- The first screen's tagline.
