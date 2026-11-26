# pino roadmap

Status: 2026-11-26. Spec: `docs/superpowers/specs/2026-11-26-pino-design.md` (approved by Luis on 2026-11-26).

The design covers several subsystems, so it is built from one plan per stage. Each plan produces working, tested
software on its own and is written when the stage before it has taught what it needs to.

| Stage | Plan | Depends on | State |
|---|---|---|---|
| 1. Spikes: router, board writer, schematic writer, 2D board view | briefs in `.worktrees/spike-*.brief.md` (not committed) | spec | running |
| 2. App shell: torno's copied parts, green accent, first screen, session dock, server, guard, CI | `2026-11-26-pino-shell.md` | spec | being written |
| 3. Design mocks: three directions each for the board view, marks on the board, the logo and first screen; the person's mark colour | written after stage 1 | shell | not started |
| 4. Engine: `board.py` library, schematic writer, board writer, placement, fast build loop | written from spikes 2 and 3 | spikes, shell | not started |
| 5. Views: Schematic, Board (2D) and 3D tabs, changes highlighted | written from spike 4 and the mocks | engine, mocks | not started |
| 6. Marks and MCP tools (look, measure, check, diff, nets, ratsnest, parts, route, point) | written after stage 5 | views | not started |
| 7. Routing in the background, DRC, copper checks | written from spike 1 | engine | not started |
| 8. Parts (KiCad libraries, EasyEDA fallback, jlcsearch), fab limits in the Brief, release to JLC fab files | written after stage 7 | engine | not started |

Each stage runs on its own branch with one whole-branch review at the end (Opus), per Luis's lean-review rule.
