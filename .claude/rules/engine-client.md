---
paths:
  - "app/src/main/kernel/**"
  - "app/src/main/builds.ts"
  - "app/src/main/routing.ts"
  - "app/src/main/engineInfo.ts"
  - "app/src/main/artifacts.ts"
  - "app/src/main/model.ts"
  - "app/src/main/mcp/**"
  - "app/src/main/turncost.test.ts"
  - "app/src/shared/build.ts"
  - "app/test/fake-kernel.mjs"
---

# The engine, the build loop, and Claude's tools

## The engine

- `pino-kernel serve`, JSON lines (`kernel/README.md`), one for the app, started when a project first has a
  `board.py`, in a process group of its own, and ended with pino. `PINO_KERNEL_CMD` replaces the command;
  `PINO_KERNEL_DIR` the folder uv runs it from. It gets pino's environment without any session's token.
- Before main asks it for a build, a route or a trial, `.pino` and the folders it writes must be the project's own
  (`engineMayWrite`). A build's files are read only from its own folder, through no link.
- The build loop (`builds.ts`): one build at a time for each project, wanted by a save (debounced), ignoring `.pino`
  and the like. A folder with no `board.py` is neither built nor written in. A failed build keeps the last drawing.
  An engine that has not answered its first ping in 2 minutes is ended. A failed or stopped engine is started again
  at most once in 10 s.
- The engine's `routing` field in a build's result is the one account of where copper stands. A route is a job
  (`routing.ts`) with progress told in the build state; when it ends, main asks for a build. Its findings are kept
  apart by the engine: `withRouteFindings` joins them, once, while the route is current. Which build copper is "from"
  has one rule (`Builds.routedOn`, `BuildState.copperFrom`): the first build seen with it current. A build the engine
  had cached is numbered anew with the same hash, and its `changes` are since another board: compare hashes.
- An engine that speaks protocol 1 does not route: the route tools answer `ROUTING_UNAVAILABLE`. One below protocol 3
  has no parts and makes no fab files: `parts` answers `FAB_UNAVAILABLE` and the window shows no `Fab files…`.
- Releasing is a job (`fab.ts`, one a project), started only by the person's `Make fab files`: Claude has no release
  tool. `fab_profiles` is asked once for each engine process.
- Every test runs the stand-in, `app/test/fake-kernel.mjs`, whose header lists its switches. It writes only under
  `.pino/` (and `fab/v1.0.0/` on a release, as the engine does), in the engine's shapes: change it with the protocol.
  `e2e/real-kernel.spec.ts` alone runs the real one.

## What a Stop waits for

`domain.ts` holds a turn at its end only while the turn's own build is running, has failed or was not looked at
(`check` or `look`), at most twice. It waits only for a save the watcher has heard of or a build of this turn, never
for a fixed time: with a fixed wait at every Stop, a turn is still at work when the next prompt arrives, and the CLI
folds that prompt into it.

## Claude's tools (`main/mcp/`)

- Sixteen: `project`, `look`, `check`, `measure`, `nets`, `parts`, `point`, `marks`, `resolve_mark` and `route` are
  loaded up front; `trace`, `ratsnest`, `diff`, `route_net`, `nudge` and `keep` are loaded when needed. `project` ends
  with the fab's limits, and `check` adds the newest release's findings while the build on show is the one it released.
- Every turn pays for the descriptions, the schemas, the server's instructions and the system prompt, and every call
  for its answer: `turncost.test.ts` holds their sizes. A text is capped (`TOOL_TEXT_LIMIT`, `MOST_LINES`) and says
  how to narrow it. `look` returns one picture.
- Inputs are zod strict objects. A refusal is words Claude can act on, with the nearest names for one that is not on
  the board. Answers name the build they read.
- No tool changes the project. `route_net`, `nudge` and `keep` answer with lines for Claude to write into `board.py`.
