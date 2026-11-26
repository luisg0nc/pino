# pino roadmap

Status: 2026-11-26. Spec: `docs/superpowers/specs/2026-11-26-pino-design.md` (approved by Luis on 2026-11-26).

The design covers several subsystems, so it is built from one plan per stage. Each plan produces working, tested
software on its own and is written when the stage before it has taught what it needs to.

| Stage | Plan | Depends on | State |
|---|---|---|---|
| 1. Spikes: router, board writer, schematic writer, 2D board view | briefs in `.worktrees/spike-*.brief.md` (not committed) | spec | done: all four passed (router: KiCadRoutingTools, 77 to 92 percent of nets, Claude finishes the rest) |
| 2. App shell: torno's copied parts, green accent, first screen, session dock, server, guard, CI | `2026-11-26-pino-shell.md` | spec | built, reviewed, CI green: PR #1 waits for Luis to merge |
| 3. Design mocks: three directions each for the board view, marks on the board, the logo and first screen; the person's mark colour | picks in `docs/superpowers/specs/2026-11-26-pino-design-picks.md` | spikes | done: drafting board view, pencil marks, the sheet, probe logo, violet marks |
| 4. Engine: `board.py` library, schematic writer, board writer, placement, fast build loop | `2026-11-26-pino-engine.md` | spikes | built, reviewed: PR #2 (247 tests, reference board 0 errors) waits for Luis to merge |
| 5. Views: Schematic, Board (2D) and 3D tabs, changes highlighted | `2026-11-26-pino-views-marks.md` | engine, mocks | built, reviewed: draft PR #4 |
| 6. Marks and MCP tools (look, measure, check, diff, nets, ratsnest, parts, route, point) | `2026-11-26-pino-views-marks.md` | views | built with stage 5, in PR #4 (`parts` is in PR #5) |
| 7. Routing in the background, DRC, copper checks | `2026-11-26-pino-routing.md` | engine | built, reviewed: PR #3 (reference board 14/14 nets, DRC clean; the 4-layer Watchy reaches 45/50, held as an expected failure); the app side is in PR #4 |
| 8. Parts (KiCad libraries, jlcsearch), fab limits in the Brief, release to JLC fab files | `2026-11-26-pino-fab.md` | engine | built, reviewed: draft PR #5 (reference board released to `fab/v1.0.0/`); EasyEDA deferred to Luis; CPL rotations not yet seen in JLC's preview |

Each stage runs on its own branch with one whole-branch review at the end (Opus), per Luis's lean-review rule. The
auto-mode classifier refuses `gh pr merge` for the director, so Luis merges; later stages stack on the branch they
need and their PRs target it.

## Design bar (Luis, 2026-11-26)

torno's first UI was "bad design" and much of it was reworked. pino copies torno's current, reworked design, never an
older state, and must do better where it diverges from torno: the Board, Schematic and 3D views, marks on a board,
and the routing and checks process. For those parts: three mocked directions each, made with the frontend-design
skill on real boards (the spike boards), judged from screenshots taken the way Luis would see them, then built, then
an Opus design review alongside the code review before merge.
