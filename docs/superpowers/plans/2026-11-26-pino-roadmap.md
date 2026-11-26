# pino roadmap

Status: 2026-11-26. Spec: `docs/superpowers/specs/2026-11-26-pino-design.md` (approved by Luis on 2026-11-26).

The design covers several subsystems, so it is built from one plan per stage. Each plan produces working, tested
software on its own and is written when the stage before it has taught what it needs to.

| Stage | Plan | Depends on | State |
|---|---|---|---|
| 1. Spikes: router, board writer, schematic writer, 2D board view | briefs in `.worktrees/spike-*.brief.md` (not committed) | spec | done |
| 2. App shell: torno's copied parts, green accent, first screen, session dock, server, guard, CI | `2026-11-26-pino-shell.md` | spec | built, PR #1 open |
| 3. Design mocks: three directions each for the board view, marks on the board, the logo and first screen; the person's mark colour | picks in `../specs/2026-11-26-pino-design-picks.md` | shell | picked 2026-11-26, open to change |
| 4. Engine: `board.py` library, schematic writer, board writer, placement, fast build loop | written from spikes 2 and 3 | spikes, shell | built, PR #2 open |
| 5. Views: Schematic, Board (2D) and 3D tabs, changes highlighted | `2026-11-26-pino-views-marks.md` | engine, mocks | built, in review |
| 6. Marks and MCP tools (look, measure, check, diff, nets, ratsnest, parts, route, point) | `2026-11-26-pino-views-marks.md` | views | built with stage 5 (`parts` waits for stage 8) |
| 7. Routing in the background, DRC, copper checks | written from spike 1 | engine | PR #3 open; the app side is built with stage 5 |
| 8. Parts (KiCad libraries, EasyEDA fallback, jlcsearch), fab limits in the Brief, release to JLC fab files | written after stage 7 | engine | not started |

Each stage runs on its own branch with one whole-branch review at the end (Opus), per Luis's lean-review rule.

## Design bar (Luis, 2026-11-26)

torno's first UI was "bad design" and much of it was reworked. pino copies torno's current, reworked design, never an
older state, and must do better where it diverges from torno: the Board, Schematic and 3D views, marks on a board,
and the routing and checks process. For those parts: three mocked directions each, made with the frontend-design
skill on real boards (the spike boards), judged from screenshots taken the way Luis would see them, then built, then
an Opus design review alongside the code review before merge.
