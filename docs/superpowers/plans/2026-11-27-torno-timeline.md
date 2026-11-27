# Builds timeline from torno #342

torno #342 (closes torno #332, #335) moved the builds strip from the top of the session pane to a slim bar across the
foot of the view, grouped by what made the builds, and named the build on show in words at the head of the left
column. pino brings it to its three views. torno commit `e253b28`, merge of #342 `82918d2`.

## What pino lacks that torno has

- torno's history entries carry `cause` and `turn`; pino's history is the engine's `.pino/builds.json`, which says
  neither. So main keeps them itself (part A).
- No compare, star, review, Go back, Parameters, error sheet or status-line ticks in pino. Those parts of the
  timeline stay out: a build's click shows it (`actions.showBuild`), as the strip's does today.
- torno's chip cost (#372) is the usage worker's.

## Part A: main keeps what made each build

- `shared/build.ts`: `BuildCause` (`agent`, `person`, `route`, `unknown`), `BuildTurn`, `KeptCause`; `BuildEntry`
  gains `cause?` and `turn?`.
- `main/buildCauses.ts`: reads and writes `.pino/build-causes.json` (`pino.build-causes/1`), through `whyNotOwn` and
  `writeOwn`, the newest 200; git ignores it (`ensureIgnored`).
- `Builds`: `causeNow(projectId)` asked at the first save of a burst (`onSeen`); an opening and a Rebuild are
  `unknown`; `rebuild(projectId, cause)` for the route's. Causes merged in one run rank agent, route, person,
  unknown. At a build's start its number is stamped, the file written, and every history told carries them.
- `index.ts`: `causeNow` is `agent` with `Sessions.turnNow` while a prompt's turn works, else `person`.
- `Routing.start(p, by)`: the window's start is the person's (`route`), a tool's is `causeNow` at the start; the
  build after the route carries it.

## Part B: the window

- `ui/strip/strip.ts` from torno's: `stripNodes(history, at, numbering)`, `stripGroups`, `groupTitle`,
  `buildNamed`; pino's captions (routed, stale, errors, not kept) kept per build. Labels: `Prompt 4`,
  `Saved by you`, `Routed by you`, `Earlier`, `Claude Code` (a prompt with no number); `Building`, `Failed build`.
- `state/timeline.ts` from torno's, key `${APP.name}.timeline`.
- `ui/strip/BuildsTimeline.tsx` from torno's: the bar and the drawer, piles, chips; drawn by `ViewPane` under the
  three views, not on the Brief (torno draws it only with the model on screen, never with the Brief in its place).
- `shared/keys.ts`: `builds.toggle`, `Ctrl+Shift+H`, global; `useTimelineKey` in `App`.
- `styles/strip.css` from torno's; `--timeline-h` in tokens; the view panel stands on the bar.
- The route card's head (`ui/route/Head.tsx`, pino's On block): `Latest build · prompt 5` and pino's word
  (`routed`, `copper stale`, `checks pass`); an older build on show is `Prompt 3 · older build` with Back to latest.
- `BuildsStrip.tsx` deleted with its manifest entry; the dock loses it.
- e2e: `timeline.spec.ts` (bar, chips, drawer by toggle and key, a group opened, kept across projects, hidden on the
  Brief); `views.spec.ts` head check moved to the new words.
- Rules: `views.md`, `engine-client.md`, `workspace-writes.md`; README line.
