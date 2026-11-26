# pino stages 5 and 6: live views and marks, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app builds `board.py` on every save through the engine, draws the build live in three tabs (Schematic, Board, 3D) in the drafting look of the design picks, lets the person point at the board with pencil marks that reach Claude as exact references, and gives Claude MCP tools to see, measure, check, point back and route.

**Architecture:** Main starts `pino-kernel serve` once per run and talks JSON lines to it (`main/kernel/client.ts`). A watcher on the project builds once per settled save (`main/builds.ts`); each result is a `pino.build/1` object plus the build folder's files. The `.kicad_pcb` parser, hit-test, references and measurements are DOM-free TypeScript in `app/src/shared/board/` (ported from the board-view spike), so main (marks, MCP tools) and the renderer (drawing) use one rule. The renderer draws the board on two canvases, the schematic as KiCad's SVG recoloured with an SVG hit layer from a new `sheet.json`, and 3D with three.js over the build's GLB. Marks live in main (only writer, `.pino/marks/marks.json`); the session domain tells Claude the build and the marks with each prompt and holds a Stop while a turn's build is unfinished or unseen.

**Tech Stack:** Electron 44, electron-vite 5, TypeScript 7, React 19, zustand 5, Canvas 2D, three 0.186.1 (new), chokidar ^5.0.0 (new), @modelcontextprotocol/sdk 1.32, zod 4, vitest 5, Playwright 1.64; kernel Python 3.12 with uv and pytest.

**Spec:** `docs/superpowers/specs/2026-11-26-pino-design.md` (sections 2, 3, 5.3 to 5.6, 5.8, 5.9). Design picks (binding for the look): `docs/superpowers/specs/2026-11-26-pino-design-picks.md`, and the mockups on the local branch `design-mocks` (`design/mockups/`: each part's `README.md`, the HTML sources in `src/`, `lib/pino.css`, `lib/views.css`, `lib/sheet.css`, `lib/drafting.js`, `lib/marks.js`, and the PNGs of the picked directions `board/a-drafting*.png`, `marks/a-pencil*.png`, `views/a-sheet*.png`, `logo/b-probe*.png`). Also read: the shell plan (`2026-11-26-pino-shell.md`) and `CLAUDE.md` and `.claude/rules/*` of the shell branch; the engine's `kernel/README.md` and `kernel/schema/build-result-1.schema.json`; the routing plan (`2026-11-26-pino-routing.md`, Tasks 8 to 11, for `routing`, `route`, `route_status`, `route_cancel`, `route_net`, `nudge`, `keep`); the board-view spike's report (`.worktrees/spike-board-view.report.md`, "What the plan's view stage must include") and code (`spike/board-view/src/` on branch `spike-board-view`).

**Where to work:** branch `views`, which the director creates from `shell` with `engine` merged in locally, in a worktree at `.worktrees/views`. One draft PR against `main` whose body says it contains #1 (shell) and #2 (engine) until they merge, after the leak audit (Task 19). One whole-branch review (Opus) plus one design review (Opus) at the end. If `routing` merges first, merge it into `views` before Task 16; otherwise Task 16 builds the guard and the fake, and the route tools say "routing not available".

**torno, read only:** the checkout beside pino at `TORNO_COMMIT = 597befd755fbffb7af5740f21d64892db0abbd63` (the shell's commit; read with `git -C ../torno show <commit>:<path>`). Every copy is an entry of `shared-from-torno.json`.

## Global Constraints

Every constraint of the shell plan and of `CLAUDE.md` holds. Repeated here because they bite in this stage:

- One app prefix, from `app/src/shared/app.ts` only: `PINO_*`, `X-Pino-Session`, `.pino`, `window.pino`, `window.__pinoTest`, `globalThis.__pinoMain`, MCP server `pino` (`mcp__pino__<tool>`). New env switches: `PINO_KERNEL_CMD` (the kernel command, split on spaces, as `PINO_AGENT_CMD`) and `PINO_KERNEL_DIR` (the kernel folder; default `<repo>/kernel`, found as `resolve(app.getAppPath(), '..', 'kernel')`).
- Code says "project", never "object" (`names.test.ts`).
- pino writes inside a project only under `<project>/.pino/`, through `ownFolder`. The kernel writes `.pino/build/`, `.pino/routes/`, `.pino/trials/`, `.pino/kicad/`, `builds.json`, `routes.json` itself; main writes only `.pino/marks/marks.json` (atomic, `writeFileAtomic`, main the only writer). Nothing else in a project is written, `board.py` included.
- Tests never run the real `claude` (`PINO_AGENT_CMD` is the stand-in). The app's unit and e2e tests use `PINO_KERNEL_CMD="node <abs>/app/test/fake-kernel.mjs"`; only `e2e/real-kernel.spec.ts` runs the real engine, and it skips with a message unless `uv` and `kicad-cli` are on `PATH`.
- Tests never open a visible window: every launch through `e2e/launch.ts` (`PINO_TEST=1`), never `--ozone-platform=headless`, never `page.screenshot()` (it hangs on a hidden window; pictures come from `webContents.capturePage()` in main), never the clipboard. Kill only processes the test or the app started, by pid or by a process group the app created. The kernel child is spawned with `detached: true` (its own group) and stopped with `shutdown`, then SIGTERM to its group, then SIGKILL after 2 s.
- No Co-Authored-By trailer, no "Generated with" footer. English only. Sentence case. No em dashes in docs, UI copy, tool descriptions or prompts (`app/src/copy.test.ts`, Task 9).
- pnpm only. New dependencies, at torno's versions, each with its reason in the commit message: `chokidar ^5.0.0` (Task 3), `three ^0.186.1` and `@types/three ^0.186.0` (Task 8). Nothing else.
- Coordinates. Everything a person or Claude reads (references, mark payloads, tool inputs and outputs, findings) is pino's board frame: mm, origin at the outline centre, x right, y up, two decimals; sheet positions are sheet mm, top left, y down, as the kernel's findings give them. Parsed geometry stays in KiCad's page frame internally (the spike's code, checked to 50 um). `app/src/shared/board/coords.ts` is the only converter: `toBoard(X, Y) = [X - 100, 100 - Y]`, `toKicad(x, y) = [x + 100, 100 - y]`, the same `ORIGIN = (100, 100)` as `kernel/src/pino_kernel/coords.py`. Angles are the same number in both frames.
- Colours, existing (unchanged): accent `#17663A` / dark `#5CC489`, accent wash `#E0EEE4` / `#1F3A2A`, dye `#17663A` / `#123D25`, scribe `#7DB892` / `#4C9A6A`, on-dye `#F1F8F3` / `#E6F4EA`, on-dye-muted `#C4E0CC` / `#A8D4B5`, `--user-mark #6440C4` / `#A88BFA`, `--agent-mark #C0502B` / `#D97757`, `--on-mark #FFFFFF` / `#1A1C1F`.
- Colours, new tokens in `tokens.css` (light / dark), from the mocks' `lib/pino.css`, `lib/views.css`, `lib/sheet.css`, `src/board/b-mask.html`:
  - Mark washes: `--user-wash #ECE6F8` / `#2D2840`, `--agent-wash #F7E7E0` / `#3A2A24`.
  - Board, drafting: `--board-paper #FCFBF8` / `#202327`, `--cu #2A2F37` / `#E6E3DC`, `--cu-far #CBC6BC` / `#464B52`, `--hatch rgb(42 47 55 / .22)` / `rgb(230 227 220 / .2)`, `--hatch-far rgb(42 47 55 / .09)` / `rgb(230 227 220 / .07)`, `--silk #A29D93` / `#6F747B`, `--rat #6E6A62` / `#A7A39A`.
  - Sheet: `--sch-paper #FCFBF8` / `#202327`, `--sch-ink #2A2F37` / `#E6E3DC`, `--sch-fill #F5F3EE` / `#272A2F`, `--sch-wire #2A2F37` / `#E6E3DC`, `--sch-net #4A4F57` / `#C9C6BF`, `--sch-pin #7A7F86` / `#9EA3AA`, `--sch-block #8A857B` / `#747A82`, `--sch-dnp #B4AFA5` / `#5A5F66`.
  - 3D material, the same in both themes: `--mask #1E5B3B`, `--mask-cu #3F8C5F`, `--tin #DCDFD8`, `--silk-3d #F2F0E8`, `--fr4 #C2BB9C`.
- Net colours (`app/src/shared/board/palette.ts`, off by default): signals take `['#2E6DB4', '#5F7F1F', '#B0478C', '#1F8F86', '#7C6A0E', '#3E5FA8', '#4E8A2E', '#A44C7E', '#2A7FA8', '#6B7A16']` in natural name order; supply nets take `['#1E7F8C', '#8A6D12', '#9A3F86']` in turn; ground nets are `--rat`. In dark each colour is mixed 62 % with 38 % white. No net hue lies in 235 to 285 degrees (held by a test).
- Motion (torno's one easing `--ease`; once, only where something changed; `prefers-reduced-motion` shows the end state; nothing loops): stroke drawn by hand 1.4 s ease out with its readout following; a mark's chip pops 0.2 s; a tool's name grows out of the reed 0.22 s; copper arriving from a route 1.6 s linear after 0.5 s, net by net from the pads out; finding pins pop 0.2 s; a leader draws 0.24 s; the band drops in 0.32 s; a build node lands in the strip 0.7 s from 34 px; changed items get the accent wash once for 0.7 s; the first screen's drawing scribes itself 1.6 s, its dimensions fade in at 1.1 s, its part fills at 1.4 s.
- Copy decided by the picks: tool names "Point", "Arrow: move this here", "Stroke: route this way", "Region: keep this clear" / "Region: put these here"; tabs "Schematic", "Board", "3D"; the inactive tab carries the selection as `Board · J1`; layer toggles "Pours", "Ratsnest", "Silk", "Net colours"; the first screen's tagline "Make circuit boards with an AI agent. It writes the board in Python; you point at what to change."
- Size caps, per turn (spec section 2, values set here): system prompt plus server instructions under 12,000 characters; tools loaded up front under 33,000 characters; a prompt's added context at most `CONTEXT_LIMIT = 6000` characters, of which the build verdict at most `VERDICT_LIMIT = 1200`; a Stop reason at most 1200; any tool's text at most `TOOL_TEXT_LIMIT = 8000` characters, lists at most `MOST_LINES = 40` lines with the rest counted; `look` returns one picture, long edge `DEFAULT_SIZE = 1280`, `MIN_SIZE = 400`, `MAX_SIZE = 2000`; an answer carries at most 6 pictures.
- Licences: the spike's code is pino's own (port it with no notice). torno copies keep torno's Apache-2.0 header practice.

## Review Focus

1. **Saves in bursts, and saves while a build runs** (an editor writing twice, the agent writing three times in a second, a save in the middle of an eight-second build): exactly one build per settled save, one more after a running one at most, and a result never replaces a newer one on screen. Test: `builds.test.ts` `a result that lands after a newer one is not shown` and `three saves in one burst build once` (Task 3).
2. **A failed build** (a syntax error in `board.py`, a footprint not found, kicad-cli missing): the views keep the last good drawing with a band "Drawn from h7. h8 failed: <reason>, board.py line 12", the route card says it, and marks are not made stale by a build that drew nothing. Tests: `builds.test.ts` `a failed build keeps the last good one for the views` (Task 3), `reanchor.test.ts` `a failed build re-anchors nothing` (Task 11), `views.spec.ts` `a failing save keeps the drawing and says why` (Task 18).
3. **Marks across rebuilds and a damaged marks file**: a part renamed or removed, a track rerouted away, a net renamed; the mark is shown stale where it was, its payload says so, and nothing is silently dropped. A `marks.json` that is not JSON or not `pino.marks/1` is kept as `marks.json.bad-<n>`, the app starts with no marks and a notice. Tests: `reanchor.test.ts` (Task 11), `file.test.ts` `a damaged file is set aside and said` (Task 11).
4. **The engine missing or dying, and odd project paths**: no `uv`, a wrong `PINO_KERNEL_DIR`, the kernel crashing mid-build, the app quit mid-build, a project at `/tmp/my board ação`. The route card says "The engine did not start: <reason>" in plain words, the next save tries again, nothing waits forever, no kernel outlives the app, and the path reaches the kernel as one JSON string. Tests: `client.test.ts` (Task 3), `views.spec.ts` `a project in a folder with spaces and accents builds` (Task 18).
5. **The look on screen, against the picks**: the drafting board, pencil marks, the sheet, the 3D material and the probe first screen, at 1440x900 and 1920x1080, light and dark, with a dense corner where chips meet. Nothing in a unit test sees this. `e2e/shots.spec.ts` (Task 18) captures the set from hidden windows; the design review in Task 19 compares each with the mock PNG it answers to and lists what differs.

---

## File structure

```
kernel/src/pino_kernel/schematic/writer.py   modify: sheet_json
kernel/src/pino_kernel/build.py              modify: write sheet.json, artifact "sheet"
kernel/src/pino_kernel/ops.py                new: extra serve ops (diff)
kernel/src/pino_kernel/cli.py                modify: one call into ops
kernel/src/pino_kernel/__init__.py           modify: __version__ "0.1.1"
kernel/schema/build-result-1.schema.json     modify: artifacts.sheet (additive)
kernel/schema/sheet-1.schema.json            new
app/package.json                             modify: chokidar, three, @types/three
app/scripts/reference-build.mjs              new: makes app/test/fixtures/reference-build/ with the real engine
app/test/fake-kernel.mjs                     new: the engine's stand-in
app/test/fixtures/reference-build/           new: result.json and the build files of the reference board
app/test/fixtures/boards/tiny.kicad_pcb      new: hand-written board with tracks, an arc, vias and a zone
app/src/shared/
  build.ts  circuit.ts  sheet.ts  marks.ts  view.ts  checks.ts
  board/ sexpr.ts geom.ts board.ts coords.ts hit.ts refs.ts measure.ts nets.ts changes.ts palette.ts
  leader.ts (torno, as-is)
app/src/main/
  kernel/client.ts  builds.ts  model.ts  domain.ts  view.ts  artifacts.ts
  marks/ file.ts store.ts reanchor.ts
  mcp/ tools.ts schemas.ts readTools.ts markTools.ts routeTools.ts
  sessions/domain.ts manager.ts claude.ts   modify
  index.ts ipc.ts prompt.ts                 modify
app/src/preload/index.ts  shared/bridge.ts  modify
app/src/renderer/
  state/store.ts                            modify
  board/ scene.ts draw.ts style.ts viewport.ts BoardView.tsx LayerStack.tsx FindingPins.tsx look.ts
  board/marks/ tools.ts drawMarks.ts MarkReed.tsx ChipLayer.tsx
  sheet/ ink.ts SheetView.tsx look.ts
  three/ glb.ts material.ts ThreeView.tsx look.ts
  ui/ ViewPane.tsx RouteCard.tsx StatusLine.tsx SessionDock.tsx Logo.tsx Welcome.tsx  modify
  ui/route/ Head.tsx InHand.tsx ChecksBlock.tsx RoutingBlock.tsx BoardBlock.tsx BlocksBlock.tsx NetBlock.tsx MarksBlock.tsx
  ui/MarkChip.tsx  ui/view/Band.tsx Compass.tsx ViewCube.tsx Tag.tsx  ui/LeaderLayer.tsx  ui/strip/BuildsStrip.tsx strip.ts
  ui/chat/Composer.tsx Items.tsx ToolCard.tsx  modify
  styles/ tokens.css app.css board.css sheet.css three.css marks.css leaders.css compass.css strip.css route.css views.css welcome.css
app/e2e/ views.spec.ts real-kernel.spec.ts shots.spec.ts launch.ts helpers.ts
scripts/pino.svg  pino-16.svg  pino.png     replace / new
.claude/rules/ views.md marks.md engine-client.md (new), workspace-writes.md e2e-hidden-window.md (modify)
CLAUDE.md  shared-from-torno.json           modify
```

Copied from torno at `TORNO_COMMIT` (copy, then adapt only as named; list each in the manifest): `app/src/shared/leader.ts` and `leader.test.ts` (as-is), `app/src/renderer/ui/LeaderLayer.tsx` (adapted: pino's store), `app/src/renderer/styles/leaders.css` (as-is), `app/src/renderer/ui/view/Compass.tsx` and `ViewCube.tsx` (adapted: the 3D tab only, no sketch planes, no saved views), `app/src/renderer/styles/compass.css` (adapted: cut sketch, scan and section rules), `app/src/renderer/ui/view/Band.tsx` and `Tag.tsx` (adapted: pino's band kinds), `app/src/renderer/ui/strip/BuildsStrip.tsx` and `strip.ts`, `strip.test.ts` (adapted: pino's build entries), `app/src/renderer/styles/strip.css`, `tools.css` (adapted: the reed only) and `marks.css` (adapted: chips only), `app/src/renderer/viewport/lights.ts` (as-is if it imports nothing pino lacks, else adapted). pino's own files are new and not in the manifest; `main/builds.ts` and `main/kernel/client.ts` are written in the shape of torno's (`watchFolder`, `KernelClient`), not copied, because torno's kernel speaks binary frames.

---

### Task 1: The engine writes `sheet.json` and answers `diff`

> As built: no version bump (director's call). The schematic SVG is exported with `--exclude-drawing-sheet`, so the Schematic tab shows blocks on one paper without KiCad's title block. `sheet.json` gives the paper's nominal size; KiCad's SVG is a few microns off it.

**Files:**
- Modify: `kernel/src/pino_kernel/schematic/writer.py`, `kernel/src/pino_kernel/build.py`, `kernel/src/pino_kernel/cli.py`, `kernel/src/pino_kernel/__init__.py`, `kernel/schema/build-result-1.schema.json`, `kernel/README.md`
- Create: `kernel/src/pino_kernel/ops.py`, `kernel/schema/sheet-1.schema.json`
- Test: `kernel/tests/test_sheet_json.py`, `kernel/tests/test_ops.py`

**Interfaces:**
- Consumes: `layout_sheet`, `Canvas` (`syms`, `pins`, `wires`, labels, `frames`), `symbol_boxes` (engine `schematic/writer.py`), `diff.changes`, `result.cap_changes`.
- Produces:
  - `writer.sheet_json(canvas: Canvas, paper: str, circuit: Circuit) -> dict`: `{"schema": "pino.sheet/1", "paper": {"name": "A3", "width": 420.0, "height": 297.0}, "symbols": [{"ref", "x0", "y0", "x1", "y1", "pins": [{"number", "name", "net", "x", "y"}]}], "power": [{"net", "x", "y"}], "wires": [{"net", "a": [x, y], "b": [x, y]}], "labels": [{"net", "x", "y", "global": bool}], "frames": [{"key", "title", "x0", "y0", "x1", "y1"}]}`, sheet mm (top left, y down, the SVG's own units), 4 decimals, lists sorted (symbols by ref, pins by natural number, wires by net then points).
  - `SchematicFiles` gains `sheet: dict`; `build` writes `.pino/build/<hash>/sheet.json` (`json.dumps(indent=1, sort_keys=True)` plus newline) and `artifacts["sheet"] = ".pino/build/<hash>/sheet.json"`.
  - `ops.extra_op(req: dict) -> dict | None`: answers `{"id", "op": "diff", "project", "from": "<hash>", "to": "<hash>"}` with `{"id", "ok": true, "changes": {"circuit": [...], "layout": [...]}}` from the two folders' `board.kicad_pcb` through `cap_changes(changes(a, b))`; a folder that is gone gives `{"ok": false, "error": "build <hash> is no longer kept"}`; a hash that is not 12 hex gives `"not a build hash"`. `None` for any other op. `cli._answer` calls it before its "unknown op" line, nothing else changes there (the routing branch moves the loop to `serve.py`: the merge keeps this one call).
  - `__version__ = "0.1.1"` (old caches stop matching, so every build has `sheet.json`). If `routing` merged first with `0.2.0`, use `0.2.1`.

- [x] **Step 1: Write the failing tests**

```python
def test_sheet_json_has_every_pin_once(reference_circuit, real_symbols):
    files = write_schematic(reference_circuit, real_symbols)
    pins = [(s["ref"], p["number"]) for s in files.sheet["symbols"] for p in s["pins"]]
    assert sorted(pins) == sorted((p.ref, p.number) for p in all_symbol_pins(reference_circuit))
    assert len(pins) == len(set(pins))

def test_sheet_pins_name_their_net_and_sit_in_their_symbol(reference_circuit, real_symbols):
    sheet = write_schematic(reference_circuit, real_symbols).sheet
    j1 = next(s for s in sheet["symbols"] if s["ref"] == "J1")
    vbus = next(p for p in j1["pins"] if p["name"] == "VBUS")
    assert vbus["net"] == "VBUS_IN"
    assert all(j1["x0"] - 5.08 <= p["x"] <= j1["x1"] + 5.08 and j1["y0"] - 5.08 <= p["y"] <= j1["y1"] + 5.08 for p in j1["pins"])

def test_frames_are_the_blocks(reference_circuit, real_symbols):
    sheet = write_schematic(reference_circuit, real_symbols).sheet
    assert [(f["key"], f["title"]) for f in sheet["frames"]] == [("usb", "USB power in"), ("reg", "3V3 regulator"), ("mcu", "MCU")]

def test_sheet_json_matches_its_schema_and_is_deterministic(reference_circuit, real_symbols):
    a = write_schematic(reference_circuit, real_symbols).sheet
    jsonschema.validate(a, load_schema("sheet-1.schema.json"))
    assert a == write_schematic(reference_circuit, real_symbols).sheet

@pytest.mark.kicad_cli
def test_build_writes_sheet_json_and_names_it(reference_project):
    r = build(reference_project)
    assert r.artifacts["sheet"] == f".pino/build/{r.hash}/sheet.json"
    svg = (reference_project / r.artifacts["schematic_svg"]).read_text()
    paper = json.loads((reference_project / r.artifacts["sheet"]).read_text())["paper"]
    assert f'width="{num(paper["width"])}mm"' in svg   # the SVG's units are the sheet's mm
```

```python
def test_diff_between_two_kept_builds(two_builds):            # fixture: a project built, R1 moved 2 mm, built again
    project, a, b = two_builds
    out = extra_op({"id": 4, "op": "diff", "project": str(project), "from": a, "to": b})
    assert out["ok"] and any("R1" in line for line in out["changes"]["layout"])

def test_diff_of_a_pruned_build_says_so(two_builds):
    project, a, b = two_builds
    shutil.rmtree(project / ".pino" / "build" / a)
    assert extra_op({"id": 5, "op": "diff", "project": str(project), "from": a, "to": b}) == {"id": 5, "ok": False, "error": f"build {a} is no longer kept"}

def test_other_ops_are_not_extra():
    assert extra_op({"id": 1, "op": "ping"}) is None

def test_serve_answers_diff(two_builds): ...   # through cli.serve with io.StringIO, in order with a ping
```

- [x] **Step 2: Run them to verify they fail**

Run: `uv run --directory kernel pytest tests/test_sheet_json.py tests/test_ops.py -v`
Expected: FAIL with `AttributeError: 'SchematicFiles' object has no attribute 'sheet'` and `ModuleNotFoundError: No module named 'pino_kernel.ops'`.

- [x] **Step 3: Write `sheet_json`, `ops.py`, the schema, the build step and the README lines**

The schema's `artifacts` gains `"sheet": {"type": "string"}`; nothing else in it changes. README: `sheet.json` in the build folder list, `diff` in the serve protocol.

- [x] **Step 4: Run the kernel suite**

Run: `uv run --directory kernel pytest -v`
Expected: PASS (the engine's 247 tests plus the new ones; kicad tests run here).

- [x] **Step 5: Commit**

```bash
git add kernel/
git commit -m "kernel: sheet.json for the views' hit layer, and a diff op between two kept builds"
```

---

### Task 2: Build types, the reference build fixture and the engine's stand-in

> As built: the stand-in's pong has no `serve` at protocol 1, as the real engine's has none. A move applies once `board.py` differs from what the first build read (not simply from build 2), so the build pino asks for right after a route keeps the copper current, as the real engine's cache would.

**Files:**
- Create: `app/src/shared/build.ts`, `app/src/shared/circuit.ts`, `app/src/shared/sheet.ts`, `app/scripts/reference-build.mjs`, `app/test/fake-kernel.mjs`, `app/test/fixtures/reference-build/` (generated), `app/test/fixtures/boards/tiny.kicad_pcb`
- Test: `app/src/shared/build.test.ts`, `app/src/fakeKernel.test.ts`

**Interfaces:**
- Produces (`shared/build.ts`):
  - `type Verdict = 'ok' | 'errors' | 'failed'`; `interface FindingAt { space: 'board' | 'sheet' | 'source'; x?: number; y?: number; layer?: string; file?: string; line?: number }`; `interface Finding { source: string; code: string; severity: 'error' | 'warning' | 'info'; message: string; at?: FindingAt; refs?: string[]; pins?: string[]; nets?: string[] }`.
  - `interface RoutingState { state: 'none' | 'running' | 'current' | 'stale'; key: string; route: string | null; route_key: string | null; number: number | null; stale_because: string[]; complete: boolean | null; unrouted: number | null; router_share: number | null; router_seconds: number | null; drc_errors: number | null; copper_errors: number | null; verdict: string | null }` (routing plan Task 9).
  - `interface BuildResult` mirroring `pino.build/1` field for field (`schema`, `kernel_version`, `kicad_cli`, `number`, `hash`, `verdict`, `headline`, `counts {errors, warnings, infos, parts, nets, unrouted, crossings}`, `findings`, `truncated`, `artifacts`, `timings`, `changes {circuit, layout}`, `placement {score, crossings, length_mm} | null`, `waiting`, `cached`) plus `routing?: RoutingState` and `artifacts.sheet?: string`.
  - `buildResultOf(value: unknown): BuildResult | null` (shape check: required fields and types, `schema === 'pino.build/1'`, extra fields kept).
  - `ARTIFACTS = ['board', 'filled', 'schematic_svg', 'sheet', 'circuit', 'placement', 'glb', 'drc'] as const`; `type ArtifactName`.
  - `verdictWords(r: BuildResult): { on: string; rest: string }`: `On h4` and the headline after its colon.
  - `type EngineState = { state: 'starting' } | { state: 'ready'; kernel: string; serve: number } | { state: 'failed'; reason: string }`.
  - `interface BuildEntry { number: number; hash: string | null; verdict: Verdict | 'running'; at: string; kept: boolean }`.
  - `interface RouteProgress { job: number; step: string; index: number; of: number; net?: string; routed?: number; startedAt: number }`.
  - `interface BuildState { projectId: string; engine: EngineState; building: boolean; latest: BuildResult | null; lastGood: BuildResult | null; history: BuildEntry[]; route: RouteProgress | null; problem: string | null }`.
- Produces (`shared/circuit.ts`): `Circuit` (`parts: {ref, value, footprint, symbol, block, role, dnp, lcsc, pins: {number, name, etype}[]}[]`, `nets: {name, kind: 'signal' | 'supply' | 'gnd', pins: [string, string][]}[]`, `blocks: {key, title, parts}[]`), `circuitOf(value: unknown): Circuit | null`, `Placement` (`poses: Record<string, {x, y, rot, back}>`, `edges: [net: string, a: [number, number], b: [number, number], kind: string][]`), `placementOf(value): Placement | null`. Read `kernel/src/pino_kernel/circuit.py` `to_json` for the exact keys before writing.
- Produces (`shared/sheet.ts`): `Sheet` as `pino.sheet/1` (Task 1), `sheetOf(value: unknown): Sheet | null`.
- Produces (fixture): `app/test/fixtures/reference-build/` holds `result.json` (with `number: 1`, artifact paths pointing at `.pino/build/<hash>/`), `board.kicad_pcb`, `filled/board.kicad_pcb`, `schematic.svg`, `sheet.json`, `circuit.json`, `placement.json`, `drc.json`, `board.glb`. `reference-build.mjs` copies `kernel/tests/fixtures/reference/` to a temp folder, runs `uv run --directory kernel pino-kernel build <tmp>`, and copies those files back; it never writes into `kernel/`. Run once in this task; the fixture is committed.
- Produces (`fake-kernel.mjs`): speaks the serve protocol on stdin and stdout. `ping` answers `{"pong": {"kernel": "0.1.1-fake", "schema": "pino.build/1", "serve": <1 or 2>}}`; `build` copies the fixture into `<project>/.pino/build/<hash>/` (hash `` `aaaaaaaa${n.toString(16).padStart(4, '0')}` `` for build n), appends `.pino/builds.json` (`{"schema": "pino.builds/1", "builds": [...]}`), answers the fixture's result with `number` counted up and `changes` filled from the move. `diff` answers from its log of moves. Switches: `FAKE_KERNEL_SERVE=1|2` (default 1: no routing), `FAKE_KERNEL_DELAY_MS` (per build), `FAKE_KERNEL_FAIL_ON=<n>` (build n answers verdict `failed` with one finding `{"source": "board.py", "code": "syntax_error", "severity": "error", "message": "invalid syntax", "at": {"space": "source", "file": "board.py", "line": 12}}`), `FAKE_KERNEL_DIE=start|build` (exit 1 with a stderr line), `FAKE_KERNEL_MOVE=<ref>:<dx>,<dy>` (from the second build on, that footprint's `(at …)` in both boards moves by dx, dy board mm, y up). With `FAKE_KERNEL_SERVE=2`: `route` streams `{"id", "event": {"event": "step", "step": "signals", "index": 1, "of": 1}}`, one `{"event": "net", …}` per placement edge net, then `{"id", "ok": true, "result": {…pino.route/1…}}`, after writing `.pino/routes/<key>/board.kicad_pcb` and `filled/board.kicad_pcb` as the build's filled board plus one F.Cu segment per placement edge (width 0.25, the edge's net, uuid from a counter) and `route.json`; later builds answer `routing` `current` while no move happened since the route and `stale` with `stale_because: ["parts moved"]` after one; `route_status`, `route_cancel`, `route_net`, `nudge`, `keep` answer canned `pino.trial/1`-shaped results. `FAKE_KERNEL_ROUTE_MS` spaces the net events.
- `tiny.kicad_pcb`: written by hand in KiCad 10's format (copy the header, layer table and net syntax from the fixture's `board.kicad_pcb`): one two-pad 0402 footprint `R1` at board (0, 0), one SOT-23 `U1` at (5, 0) on the back, nets `A` and `GND`, two F.Cu segments and one F.Cu arc on `A`, one through via on `A`, one B.Cu filled zone on `GND`, Edge.Cuts rectangle 20 x 10 mm centred on (100, 100).

- [x] **Step 1: Write the failing tests**

```ts
it('reads the reference build result and refuses another schema', () => {
  const r = buildResultOf(readJson('test/fixtures/reference-build/result.json'))!
  expect(r.number).toBe(1)
  expect(r.verdict).not.toBe('failed')
  expect(buildResultOf({ ...r, schema: 'pino.build/2' })).toBeNull()
})
it('holds every required field of the kernel schema', () => {
  const schema = readJson('../kernel/schema/build-result-1.schema.json')
  expect(REQUIRED_FIELDS).toEqual(schema.required)   // REQUIRED_FIELDS exported by build.ts
})
it('says the verdict as the route card head does', () => {
  expect(verdictWords({ ...ref, number: 4, headline: 'On h4: 0 errors, 2 warnings, 18 unrouted' } as BuildResult)).toEqual({ on: 'On h4', rest: '0 errors, 2 warnings, 18 unrouted' })
})
it('reads circuit, placement and sheet of the fixture', () => {
  expect(circuitOf(readJson(fx('circuit.json')))!.parts.map((p) => p.ref)).toContain('U2')
  expect(placementOf(readJson(fx('placement.json')))!.edges.length).toBeGreaterThan(0)
  expect(sheetOf(readJson(fx('sheet.json')))!.frames.map((f) => f.key)).toEqual(['usb', 'reg', 'mcu'])
})
```

```ts
// fakeKernel.test.ts: spawns node test/fake-kernel.mjs in a temp project, by pid
it('builds into the project and counts up', async () => { /* two builds: numbers 1, 2; .pino/build/<hash>/board.kicad_pcb exists; builds.json has two entries */ })
it('moves a part from the second build on', async () => { /* FAKE_KERNEL_MOVE=R4:1.5,0: second board's R4 at is 1.5 mm right; changes.layout names R4 */ })
it('streams a route and then answers stale after a move', async () => { /* FAKE_KERNEL_SERVE=2 */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/build.test.ts src/fakeKernel.test.ts`
Expected: FAIL with "Cannot find module './build'".

- [x] **Step 3: Generate the fixture, write the types and the stand-in**

Run: `node app/scripts/reference-build.mjs` (needs `uv` and `kicad-cli`; about 10 s). Check `git status` shows changes only under `app/test/fixtures/reference-build/`.

- [x] **Step 4: Run the tests**

Run: `pnpm -C app exec vitest run src/shared/build.test.ts src/fakeKernel.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src/shared/build.ts app/src/shared/circuit.ts app/src/shared/sheet.ts app/src/shared/build.test.ts app/src/fakeKernel.test.ts app/scripts/reference-build.mjs app/test/fake-kernel.mjs app/test/fixtures/
git commit -m "Build result types, the reference build as a fixture, and a stand-in for the engine"
```

---

### Task 3: Kernel client and the build loop in main

> As built: a folder with no `board.py` yet is not built and no engine is started, so opening an empty folder writes nothing. Main also refuses to ask the engine to build when `.pino` or a folder it writes under it is a link. `Builds.patch` is added for the router's progress.

**Files:**
- Create: `app/src/main/kernel/client.ts`, `app/src/main/builds.ts`, `app/src/main/artifacts.ts`
- Modify: `app/package.json` (`chokidar ^5.0.0`), `app/src/main/index.ts`, `app/src/main/ipc.ts`, `app/src/shared/bridge.ts`, `app/src/preload/index.ts`, `app/src/renderer/state/store.ts`, `app/src/renderer/App.tsx`
- Test: `app/src/main/kernel/client.test.ts`, `app/src/main/builds.test.ts`, `app/src/main/artifacts.test.ts`

**Interfaces:**
- Consumes: `BuildResult`, `buildResultOf`, `BuildState`, `BuildEntry`, `EngineState`, `ArtifactName` (Task 2); `ownFolder` (shell).
- Produces (`main/kernel/client.ts`):
  - `kernelCommand(env: NodeJS.ProcessEnv, appPath: string): string[]`: `PINO_KERNEL_CMD` split on spaces, else `['uv', 'run', '--directory', env.PINO_KERNEL_DIR ?? resolve(appPath, '..', 'kernel'), 'pino-kernel', 'serve']`.
  - `class KernelError extends Error { constructor(message: string, readonly kind: 'refused' | 'stopped') }` (`refused`: the kernel answered `ok: false`; `stopped`: it exited or never started).
  - `interface Pong { kernel: string; schema: string; serve: number }` (`serve` 1 when absent).
  - `interface KernelClient { readonly pid: number | undefined; ping(): Promise<Pong>; build(project: string, opts?: { timeout?: number }): Promise<BuildResult>; request<T = unknown>(op: string, args: Record<string, unknown>): Promise<T>; job<T = unknown>(op: string, args: Record<string, unknown>, onEvent: (e: Record<string, unknown>) => void): { id: number; done: Promise<T> }; cancel(jobId: number): Promise<boolean>; onExit(cb: (code: number | null) => void): () => void; stderrTail(): string; dispose(): Promise<void> }`.
  - `startKernel(command: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }): KernelClient`: spawns with `detached: true`, no shell, `stdio: pipe`; ids count from 1; replies matched by id; a line that is no JSON is logged and skipped; stderr keeps its last 4000 characters; on exit every waiting call rejects with `KernelError(…, 'stopped')` whose message is the last stderr line. `dispose()` writes `{"op": "shutdown"}`, waits 2 s, then SIGTERM to `-pid`, then SIGKILL after 2 s.
- Produces (`main/builds.ts`):
  - `DEBOUNCE_MS = 300`.
  - `watchProject(dir: string, onChange: (paths: string[]) => void, debounceMs = DEBOUNCE_MS): () => void`: chokidar on `dir`, ignoring dotfiles and the folders `.pino`, `__pycache__`, `.venv`, `node_modules`, `.git`, `fab`, `reference` at any depth; reports `*.py` and `outline.json` changes only.
  - `class Builds { constructor(deps: { kernel: () => KernelClient; watch?: typeof watchProject; readHistory?: (dir: string) => Promise<BuildEntry[]>; now?: () => number }); open(project: ProjectInfo): BuildState; close(projectId: string): void; rebuild(projectId: string): void; state(projectId: string): BuildState | undefined; latest(projectId: string): BuildResult | null; lastGood(projectId: string): BuildResult | null; startedAt(projectId: string): number | undefined; endedAt(projectId: string): number | undefined; whenSettled(projectId: string, deadline: number): Promise<BuildState>; onState(cb: (s: BuildState) => void): () => void; onResult(cb: (projectId: string, r: BuildResult) => void): () => void }`. One build at a time; a change during a build queues exactly one more; a result whose `number` is below the shown one is dropped; `lastGood` is the newest result with a `hash`; history is `.pino/builds.json` read after each build, each entry's `kept` true when `.pino/build/<hash>/result.json` exists.
  - `readBuildHistory(dir: string): Promise<BuildEntry[]>`.
  - Engine state: `starting` until `ping` answers, then `ready` with `serve`; a kernel that exits becomes `failed` with `"The engine stopped: <last stderr line>"`, and the next save starts a new one (at most one restart per 10 s).
- Produces (`main/artifacts.ts`): `artifactPath(project: ProjectInfo, hash: string, name: ArtifactName, result: BuildResult): string` (refuses a hash that is not 12 hex, a name the result does not list, and a path that leaves `.pino/build/<hash>/`); `routePath(project: ProjectInfo, key: string, name: 'board' | 'filled' | 'route'): string` (key `/^[0-9a-f]{8,64}$/`).
- Bridge (`shared/bridge.ts`), channels `build:state`, `build:rebuild`, `build:file`, `build:routeFile`, to the window `build:state`:
  - `build: { state(projectId: string): Promise<BuildState | null>; rebuild(projectId: string): Promise<void>; file(projectId: string, hash: string, name: ArtifactName): Promise<string | Uint8Array>; routeFile(projectId: string, key: string, name: 'board' | 'filled' | 'route'): Promise<string>; onState(cb: (s: BuildState) => void): () => void }` (`glb` is a `Uint8Array`, the rest text).
- Store: `build: BuildState | null`, `shown: number | null` (an older build chosen in the strip; null is the latest), actions `setBuild(s: BuildState)`, `showBuild(n: number | null)`.

- [x] **Step 1: Write the failing tests**

```ts
// client.test.ts (spawns the stand-in; kills only its own pid group)
it('pings, builds and says serve 1 when the engine does not name it', async () => {
  const k = startKernel(['node', FAKE_KERNEL], { env: {}, cwd: tmp })
  expect(await k.ping()).toEqual({ kernel: '0.1.1-fake', schema: 'pino.build/1', serve: 1 })
  expect((await k.build(project)).number).toBe(1)
  await k.dispose()
  expect(alive(k.pid!)).toBe(false)
})
it('passes a project path with spaces and accents as one string', async () => { /* project '/tmp/.../my board ação': build ok */ })
it('rejects every waiting call with the last stderr line when the engine dies', async () => {
  const k = startKernel(['node', FAKE_KERNEL], { env: { FAKE_KERNEL_DIE: 'build' }, cwd: tmp })
  await expect(k.build(project)).rejects.toThrow(/fake kernel died during a build/)
})
it('names the dev command from the app path, or PINO_KERNEL_CMD', () => {
  expect(kernelCommand({}, '/r/app')).toEqual(['uv', 'run', '--directory', '/r/kernel', 'pino-kernel', 'serve'])
  expect(kernelCommand({ PINO_KERNEL_CMD: 'node /x/fake.mjs' }, '/r/app')).toEqual(['node', '/x/fake.mjs'])
})
it('relays a job's events, then its result', async () => { /* FAKE_KERNEL_SERVE=2, job('route'): events then done */ })
```

```ts
// builds.test.ts (watch injected: a function the test calls)
it('three saves in one burst build once', async () => { /* the injected watcher reports three paths in one call -> kernel.build called once */ })
it('a save during a build queues exactly one more', async () => { /* FAKE_KERNEL_DELAY_MS 200; two saves during build 1 -> builds 1 and 2 only */ })
it('a result that lands after a newer one is not shown', async () => { /* kernel answers number 3 then number 2 -> latest stays 3 */ })
it('a failed build keeps the last good one for the views', async () => {
  // FAKE_KERNEL_FAIL_ON=2: latest.verdict 'failed', lastGood.number 1, problem 'h2 failed: invalid syntax, board.py line 12'
})
it('an engine that will not start is said in plain words and tried again on the next save', async () => {
  // FAKE_KERNEL_DIE=start: engine { state: 'failed', reason: 'The engine did not start: fake kernel died at start' }; a save 10 s later (now injected) starts a new kernel
})
it('reads the history and marks pruned builds as not kept', async () => {})
```

```ts
// artifacts.test.ts
it('refuses a name the result does not list, and a hash that is not one', () => {
  expect(() => artifactPath(project, '../../etc', 'board', r)).toThrow('not a build hash')
  expect(() => artifactPath(project, r.hash!, 'glb', { ...r, artifacts: {} })).toThrow('h1 has no glb')
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/kernel/client.test.ts src/main/builds.test.ts src/main/artifacts.test.ts`
Expected: FAIL with "Cannot find module".

- [x] **Step 3: Add chokidar, write the client, the loop, the artifact paths, IPC, preload, store**

`pnpm -C app add chokidar@^5.0.0`. `index.ts` makes one `Builds`, opens the project when `projects.openAt` succeeds, closes it on close, disposes the kernel in `before-quit` through `quitGate`, and broadcasts `build:state`. `App.tsx` subscribes once and calls `actions.setBuild`.

- [x] **Step 4: Run the tests, then the whole unit suite and typecheck**

Run: `pnpm -C app exec vitest run src/main && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/package.json pnpm-lock.yaml app/src/main app/src/shared/bridge.ts app/src/preload/index.ts app/src/renderer/state/store.ts app/src/renderer/App.tsx
git commit -m "Build board.py on every save through the engine's serve mode (chokidar: watch the project's Python and outline)"
```

---

### Task 4: The board model, shared by main and the renderer

> As built: the pad outlines used by crossings, gaps and areas are in one more module, `outlines.ts`. A courtyard whose lines close into one loop keeps its true shape (an L stays an L); otherwise its convex hull. `netColour` takes the supply names as a fifth argument, to give supplies their colours in turn.

**Files:**
- Create: `app/src/shared/board/sexpr.ts`, `geom.ts`, `board.ts`, `coords.ts`, `hit.ts`, `refs.ts`, `nets.ts`, `measure.ts`, `changes.ts`, `palette.ts`
- Test: `app/src/shared/board/board.test.ts`, `coords.test.ts`, `hit.test.ts`, `refs.test.ts`, `nets.test.ts`, `measure.test.ts`, `changes.test.ts`, `palette.test.ts`

**Interfaces:**
- Consumes: the spike's `sexpr.ts`, `geom.ts`, `board.ts`, `hit.ts`, `ref.ts` (branch `spike-board-view`, `spike/board-view/src/`), copied and then changed as below; `Circuit` (Task 2).
- Produces:
  - `board.ts`: the spike's types `Shape`, `Pad`, `Footprint`, `Track`, `Via`, `Zone`, `Board` (KiCad page frame), and `readBoard(src: string): Board`. Changes from the spike: `Footprint.outline` is the real courtyard polygon (union hull of the F/B.CrtYd shapes, else the spike's oriented box) with `outlineFrom: 'courtyard' | 'fab' | 'pads'`; teardrop zones are kept as `Zone.teardrop` and never hit (a click there is its pad or track); net names unescaped once (`{slash}` and friends); a footprint ref that is empty or holds `*` is `footprint <uuid8>`.
  - `coords.ts`: `ORIGIN = [100, 100]`, `toBoard(p: Pt): Pt`, `toKicad(p: Pt): Pt`, `mm(v: number): string` (two decimals, `-0.00` written `0.00`), `at(p: Pt): string` = `(x, y)` in board frame.
  - `hit.ts`: the spike's `Index` and `hitTest(index, p, opts)`, with `HitOpts = { visible: Set<string>; active: string; tol: number }` and the spike's order (exact before near within `tol`, active layer first, then pad, via, track, part, zone; repeat clicks cycle).
  - `refs.ts`, the exact payload text (board frame, two decimals, `·` between fields):
    - `type Target = { kind: 'part'; ref: string } | { kind: 'pad'; ref: string; number: string } | { kind: 'net'; name: string } | { kind: 'track'; uuid: string } | { kind: 'via'; uuid: string } | { kind: 'zone'; uuid: string; at: Pt }` (`at` board frame).
    - `layerWords(layer: string): string`: `F.Cu` "top copper", `B.Cu` "bottom copper", `In1.Cu` "inner copper 1", any other the KiCad name.
    - `targetOf(hit: Hit, click: Pt): Target`; `findTarget(board: Board, t: Target): Hit['target'] | null`; `centreOf(board: Board, t: Target): Pt | null` (board frame).
    - `describeTarget(board: Board, circuit: Circuit | null, t: Target): string`:
      - part: `part U2 · AP2112K-3.3 · SOT-23-5 · at (x, y) mm · rot 90° · top`
      - pad: `pad U2.1 · VIN · net VBUS · top copper · at (x, y) mm` (pin name from the circuit, else the file's `pinfunction`, else omitted; through-hole pads say `through`)
      - net: `net VBUS · 7 pins: F1.2, R9.2, C1.1, C3.1, U2.1 VIN, U2.3 EN, …` (circuit order, pin names where the symbol names them, at most 24 then `and N more`)
      - track: `track · top copper · net +3V3 · 0.50 mm wide · from (x, y) to (x, y) mm · uuid <full>`; an arc adds `through (x, y)`
      - via: `via · net GND · top to bottom copper · at (x, y) mm · 0.60 mm, drill 0.30 · uuid <full>`
      - zone: `zone · net GND · bottom copper · x a to b, y c to d mm · clicked (x, y) mm · uuid <full>`
    - `shortLabel(board: Board, t: Target): string`: `U2`, `U2.1`, `VBUS`, `track +3V3`, `via GND`, `zone GND` (chips and tab labels).
    - `crossings(board: Board, path: Pt[], layer: string): { nets: string[]; parts: string[] }` (path in KiCad frame): pads, vias, tracks and arcs (exact arc intersection), zones and part outlines; nets in first-crossed order.
  - `nets.ts`: `copperGroups(board: Board, net: string): CopperGroup[]` (`{ pads: string[]; tracks: number; vias: number; length: number }`, connected by shape contact on shared layers and vias); `netLength(board: Board, net: string): number` (track and arc length, mm).
  - `measure.ts`: `type Measure = { what: 'gap'; a: Target; b: Target } | { what: 'distance'; a: Target; b: Target } | { what: 'length'; net: string } | { what: 'width'; net: string } | { what: 'area'; net: string; layer?: string } | { what: 'vias'; net?: string } | { what: 'edge'; a: Target }`; `measure(board: Board, m: Measure): { value: number; unit: 'mm' | 'mm²' | 'vias'; said: string }` (`gap`: copper edge to copper edge on a shared layer, else outline to outline; `width`: `min 0.25, max 0.50 mm over 12 segments`; `edge`: nearest Edge.Cuts distance from the item's outline).
  - `changes.ts`: `interface ChangedSet { parts: string[]; tracks: string[]; vias: string[]; zones: string[] }`; `changedItems(prev: Board | null, next: Board): ChangedSet` (a part changed when its position moved over 0.01 mm, its angle or side changed, or it is new; copper by uuid added; nothing on a first build).
  - `palette.ts`: `SIGNAL_COLOURS`, `SUPPLY_COLOURS` (Global Constraints values), `netColour(net: string, kind: 'signal' | 'supply' | 'gnd', signals: readonly string[], dark: boolean): string | null` (null for gnd: the caller uses `--rat`), `hueOf(hex: string): number`.

- [x] **Step 1: Copy the spike's five modules into `app/src/shared/board/`, then write the failing tests**

```ts
it('reads the tiny board: parts, pads, tracks, an arc, a via and a zone', () => {
  const b = readBoard(read('test/fixtures/boards/tiny.kicad_pcb'))
  expect(b.footprints.map((f) => f.ref).sort()).toEqual(['R1', 'U1'])
  expect(b.tracks.filter((t) => t.arc).length).toBe(1)
  expect(b.vias).toHaveLength(1)
  expect(b.zones.filter((z) => !z.keepout && !z.teardrop)).toHaveLength(1)
})
it('converts frames as the kernel does', () => {
  expect(toBoard({ x: 130, y: 90 })).toEqual({ x: 30, y: 10 })
  expect(toKicad(toBoard({ x: 101.5, y: 97.25 }))).toEqual({ x: 101.5, y: 97.25 })
  expect(mm(-0.001)).toBe('0.00')
})
it('gives the exact pad reference of the reference board', () => {
  const b = readBoard(read(fx('filled/board.kicad_pcb'))), c = circuitOf(readJson(fx('circuit.json')))!
  const pad = findTarget(b, { kind: 'pad', ref: 'U2', number: '1' }) as Pad
  expect(describeTarget(b, c, { kind: 'pad', ref: 'U2', number: '1' })).toBe(`pad U2.1 · VIN · net VBUS · top copper · at ${at(toBoard(pad.center))} mm`)
})
it('says a track with its full uuid and width', () => { /* tiny.kicad_pcb: starts 'track · top copper · net A · 0.25 mm wide · from (' and ends with the uuid */ })
it('hits a pad before the track under it, and cycles on a repeat', () => {})
it('a stroke across the tiny board crosses net A and part R1 in order', () => {
  expect(crossings(tiny, [toKicad({ x: -2, y: 0 }), toKicad({ x: 6, y: 0 })], 'F.Cu')).toEqual({ nets: ['A', 'GND'], parts: ['R1', 'U1'] })
})
it('groups connected copper and measures length', () => { /* tiny: net A one group with 2 pads, length = sum of segments and arc */ })
it('measures a gap between two pads from copper edge to copper edge', () => {})
it('finds a moved part and new copper, and nothing on a first build', () => {
  expect(changedItems(null, tiny)).toEqual({ parts: [], tracks: [], vias: [], zones: [] })
  expect(changedItems(tiny, movedR1).parts).toEqual(['R1'])
})
it('keeps every net colour out of the marks' violet hues', () => {
  const outside = (h: number) => h < 235 || h > 285
  for (const c of [...SIGNAL_COLOURS, ...SUPPLY_COLOURS]) expect(outside(hueOf(c))).toBe(true)
  const signals = SIGNAL_COLOURS.map((_, i) => `S${i}`)
  for (const n of signals) expect(outside(hueOf(netColour(n, 'signal', signals, true)!))).toBe(true)
  expect(netColour('GND', 'gnd', signals, false)).toBeNull()
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/board`
Expected: FAIL (missing `coords`, `refs` exports, the courtyard polygon and arc crossings).

- [x] **Step 3: Make the changes listed in Interfaces**

The spike's `render.ts` and `main.ts` are not copied here (Task 5 takes what it needs of `render.ts`). No module in `shared/board/` touches the DOM (`Path2D`, `DOMMatrix`, `document`): `board.test.ts` greps the folder for those names.

- [x] **Step 4: Run the tests**

Run: `pnpm -C app exec vitest run src/shared/board`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src/shared/board
git commit -m "Port the board-view spike's parser, hit test and references into shared code, in pino's board frame"
```

---

### Task 5: Drawing the board in the drafting look

> As built: `--agent-mark` is 2.79:1 (light) and 2.82:1 (dark) on `--cu-far`, under the plan's 3:1, and both are the picks' colours. Marks are drawn cased in the paper (4.5:1 all round) and the test holds the pair at 2.75. `toPaths` takes the board (and the stale uuids), since a scene needs it. `DrawOpts` also carries `netColourOf`.

**Files:**
- Create: `app/src/renderer/board/scene.ts`, `draw.ts`, `style.ts`, `app/src/renderer/styles/board.css`
- Modify: `app/src/renderer/styles/tokens.css`, `app/src/renderer/styles/app.css`, `app/src/shared/contrast.test.ts`
- Test: `app/src/renderer/board/scene.test.ts`, `app/src/renderer/board/style.test.ts`, `app/src/shared/contrast.test.ts`

**Interfaces:**
- Consumes: `Board`, `palette.ts`, `ChangedSet` (Task 4); the spike's `render.ts` (`shapePath`, `addPad`, `addTrack`, `holePath`, batching) and the mocks' `lib/drafting.js` and `lib/board.js` (hatch pattern at constant screen density, 6 px gap, 1 px line).
- Produces:
  - `scene.ts` (DOM-free): `interface Batch { layer: string; net: string; kind: 'pad' | 'track' | 'via' | 'zone' | 'silk' | 'edge' | 'hole'; width: number; items: Prim[] }`; `bakeBatches(board: Board): Batch[]`; `revealOrder(board: Board): string[]` (nets in the order copper arrives: by distance of their first pad from the board's centre).
  - `draw.ts`: `interface DrawOpts { active: string; layers: string[]; pours: boolean; silk: boolean; ratsnest: boolean; netColours: boolean; stale: { tracks: Set<string> } | null; quiet?: (item: string) => boolean; reveal?: number; dark: boolean }`; `interface BoardScene { board: Board; paths: Map<Batch, Path2D> }`; `toPaths(batches: Batch[]): BoardScene`; `drawBoard(ctx: CanvasRenderingContext2D, scene: BoardScene, view: { scale: number; tx: number; ty: number }, dpr: number, opts: DrawOpts, colours: BoardColours, rats: Array<[Pt, Pt, string]>): void`.
  - `style.ts`: `interface BoardColours { paper; cu; cuFar; hatch; hatchFar; silk; rat; accent; accentWash; warn }` read from the tokens; `boardColours(el: Element): BoardColours`; `copperColour(o: { active: boolean; throughHole: boolean; net: string; netColours: boolean; stale: boolean }, c: BoardColours, netColourOf: (net: string) => string | null): string` with the drafting rules: active-layer copper `--cu`, other layers `--cu-far`, through-hole pads always `--cu`, net colours replace `--cu` only when on, stale copper mixed 60 % toward `--board-paper` while pads keep `--cu`, a via is a paper disc with a 1.3 px `--cu` ring and a `--cu` hole dot, pours are `--hatch` (active) or `--hatch-far` hatching with a 35 % mixed edge on the active layer, silk 1 px `--silk` (top only when the top is active), ratsnest `--rat` 1.3 px dashed `[4, 3]` with 2 px end dots.
  - Tokens: every new token of the Global Constraints in `tokens.css` (light and dark); `board.css` lays the two stacked canvases (`canvas.board`, `canvas.over`, `pointer-events: none` on the top one).

- [x] **Step 1: Write the failing tests**

```ts
it('bakes the reference board into batches by layer, net and width', () => {
  const batches = bakeBatches(readBoard(read(fx('filled/board.kicad_pcb'))))
  expect(new Set(batches.map((b) => b.layer))).toEqual(new Set(['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'Edge.Cuts']))
  expect(batches.filter((b) => b.kind === 'pad').reduce((n, b) => n + b.items.length, 0)).toBe(totalPads)
})
it('draws copper by the drafting rules', () => {
  const c = LIGHT // the token values
  expect(copperColour({ active: true, throughHole: false, net: 'A', netColours: false, stale: false }, c, none)).toBe('#2A2F37')
  expect(copperColour({ active: false, throughHole: false, net: 'A', netColours: false, stale: false }, c, none)).toBe('#CBC6BC')
  expect(copperColour({ active: false, throughHole: true, net: 'A', netColours: false, stale: false }, c, none)).toBe('#2A2F37')
  expect(copperColour({ active: true, throughHole: false, net: 'A', netColours: true, stale: false }, c, () => '#2E6DB4')).toBe('#2E6DB4')
})
it('holds the new tokens to their contrasts', () => {
  // contrast.test.ts: --cu on --board-paper 7:1 at least in both themes; --cu-far 1.5:1 at least; --rat 3:1; --silk 2:1;
  // --user-mark and --agent-mark 3:1 on --board-paper and on --cu-far; --sch-ink 7:1 on --sch-paper
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/board src/shared/contrast.test.ts`
Expected: FAIL.

- [x] **Step 3: Write the scene, the style and the draw**

Dim by mixing toward `--board-paper`, never by alpha (the spike's rule: overlaps inside a layer do not darken). The board fills with `--board-paper`; the edge is 1.4 px `--cu`.

- [x] **Step 4: Run them**

Run: `pnpm -C app exec vitest run src/renderer/board src/shared/contrast.test.ts src/renderer/styles`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src/renderer/board app/src/renderer/styles app/src/shared/contrast.test.ts
git commit -m "Draw the board as a technical drawing: graphite copper, pencil far layers, hatched pours"
```

---

### Task 6: The Board view: pan, zoom, click, layers, findings, ratsnest

> As built: torno's `tagPlace`, `leaders` store and `useTagAt` are copied as they are, which keeps `LeaderLayer` byte-identical; `Tag` and `Band` are the adapted ones. The card and dock take their narrow widths at 1500px and under, as the mocks do (torno's 1359px left the board 68 px less). Findings that would cover one another gather into a square pin with a count. A `build.result` call was added for older builds. The e2e launcher takes `kernel` from this task on, so no spec starts uv. A hidden window gives one picture a launch, so `shots.spec.ts` launches once per picture. `whyNotOwn` asks about .pino without using up the window's one notice.

**Files:**
- Create: `app/src/renderer/board/viewport.ts`, `BoardView.tsx`, `LayerStack.tsx`, `FindingPins.tsx`, `app/src/shared/view.ts`; copy torno's `shared/leader.ts`, `leader.test.ts`, `ui/LeaderLayer.tsx`, `styles/leaders.css`, `ui/view/Tag.tsx`, `ui/view/Band.tsx`
- Modify: `app/src/renderer/ui/ViewPane.tsx`, `app/src/renderer/state/store.ts`, `app/src/shared/keys.ts`, `app/src/renderer/styles/views.css`, `shared-from-torno.json`
- Test: `app/src/renderer/board/viewport.test.ts`, `app/src/shared/view.test.ts`, `app/src/shared/keys.test.ts`

**Interfaces:**
- Consumes: Tasks 3 to 5; `build.file`, `build.routeFile`.
- Produces:
  - `shared/view.ts`: `type ViewTab = 'schematic' | 'board' | '3d'` (moved from the store); `interface Selection { tab: ViewTab; target: Target; text: string; label: string }`; `tabLabel(tab: ViewTab, chosen: ViewTab, selection: Selection | null): string` (`Board · J1` on a tab not chosen when something is selected, else the plain name); `interface BoardLook { active: string; pours: boolean; ratsnest: boolean; silk: boolean; netColours: boolean }`, `DEFAULT_LOOK = { active: 'F.Cu', pours: true, ratsnest: true, silk: true, netColours: false }`.
  - `viewport.ts`: `fit(box: BBox, w: number, h: number, inset: { l: number; r: number; t: number; b: number }): View`; `zoomAt(v: View, screen: Pt, factor: number): View` (the point under the cursor stays); `toScreen(v: View, p: Pt): Pt`; `toModel(v: View, s: Pt): Pt`; `MIN_SCALE`, `MAX_SCALE = 400` px/mm; `DRAG_SLOP = 4` px (a drag never selects).
  - `BoardView.tsx`: loads the board file of the shown build (`filled` when listed, else `board`), and when `routing.state` is `current`, the route's `filled` board; when `stale`, the build's board drawn whole plus the route's tracks, vias and zones as `stale` copper. Keeps the view and the selection across reloads. Ratsnest: `placement.edges` (board frame, converted with `toKicad`), only the nets with open connections when a route is current (the route's `net_unrouted` findings). Changed items (`changedItems(previous shown board, this one)`) get the accent wash once (0.7 s).
  - `LayerStack.tsx`: the stack seen edge-on in the compass corner (mock `a-drafting.html` "Layers" panel): one row per layer from top silk to bottom silk, the copper rows clickable with their number key, the board's thickness and copper weight in the head (`1.6 mm, 1 oz` from the fixture's stackup), "seen from the top", and the four toggles. Grows a row per copper layer (2 and 4 layers).
  - `FindingPins.tsx`: numbered pins at each finding with a `board` position (`warn` ring for warnings, `fail` for errors, `muted` for infos); the finding in hand (hovered row of the route card, `store.hotFinding`) draws torno's leader to a `Tag` with its message and position.
  - `Band.tsx` (adapted): kinds `failed` ("Drawn from h7. h8 failed: <reason>, board.py line 12"), `older` ("Showing h12. The latest is h15." with "Back to latest"), `routing` (Task 16), `stale` (Task 16); drops in 0.32 s at the foot of the view.
  - Keys (`shared/keys.ts`): new scope `'view'` (heard over the view, outside fields) with `board.layer` `1` to `8`, `board.fit` `F`, `board.nets` `N`, `view.drop` `Esc` (drops the tool in hand, then the selection).
  - Store: `selection: Selection | null`, `look: BoardLook`, `hotFinding: number | null`, actions `select(s: Selection | null)`, `setLook(patch: Partial<BoardLook>)`, `hoverFinding(i: number | null)`.
  - Test hook (`window.__pinoTest`, only under `?test=1`): `screenOf(target: Target): { x: number; y: number } | null` (client px of the target's centre in the chosen view), `drawn(): { board: { hash: string | null; route: string | null; layers: string[]; active: string; items: number; highlighted: string[]; marks: string[]; stale: number } }`.

- [x] **Step 1: Write the failing tests**

```ts
it('keeps the point under the cursor when zooming', () => {
  const v = fit(box, 800, 600, INSET), s = { x: 300, y: 200 }
  const before = toModel(v, s), after = toModel(zoomAt(v, s, 1.25), s)
  expect(after.x).toBeCloseTo(before.x, 9); expect(after.y).toBeCloseTo(before.y, 9)
})
it('labels the tab you are not on with the selection', () => {
  expect(tabLabel('board', 'schematic', { tab: 'schematic', label: 'J1' } as Selection)).toBe('Board · J1')
  expect(tabLabel('schematic', 'schematic', sel)).toBe('Schematic')
  expect(tabLabel('3d', 'board', null)).toBe('3D')
})
it('has no key clash with the new view scope', () => { expect(clashes(KEYS)).toEqual([]) })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/board/viewport.test.ts src/shared/view.test.ts src/shared/keys.test.ts`
Expected: FAIL.

- [x] **Step 3: Copy the torno files, then write the view**

The click rule is the spike's (Task 4 `hitTest`, tolerance 4 px over the scale); a click sets `selection` with `describeTarget` as its `text`. Wheel zooms by 1.0015 per delta pixel; a drag pans. `F` fits the outline with the mock's insets (left 64 for the reed, right 240 for the stack, top 56, bottom 56). The scale bar is drawn as on a drawing (mock `.scale`), the hint pill at the foot says "Click a part, pad or track · drag pans · scroll zooms". A board file is parsed once per (hash, route) and cached for the run.

- [x] **Step 4: Run them, the unit suite and typecheck**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src shared-from-torno.json
git commit -m "Board tab: pan, zoom, click for the exact reference, layer stack, findings pinned with torno's leader"
```

---

### Task 7: The Schematic view: the sheet in the board's ink

> As built: findings on the sheet are the same pins as on the board, at a constant size on screen, not 2.6 px numbers in sheet mm. The block wash is drawn over the picture, since KiCad's background paints over anything under it. `ink.ts` also holds the sheet's tag words and where a target sits.

**Files:**
- Create: `app/src/renderer/sheet/ink.ts`, `SheetView.tsx`, `app/src/renderer/styles/sheet.css`
- Modify: `app/src/renderer/ui/ViewPane.tsx`, `app/src/renderer/styles/app.css`
- Test: `app/src/renderer/sheet/ink.test.ts`

**Interfaces:**
- Consumes: `Sheet`, `Circuit` (Task 2), `Selection`, `Target`, `describeTarget` (Tasks 4, 6), `build.file(…, 'schematic_svg' | 'sheet')`.
- Produces:
  - `ink.ts` (pure string work, no DOM): `KICAD_COLOURS: Record<string, string>`, the mock's `tools/extract_sch.py` map (`#840000` to `var(--sch-ink)`, `#FFFFC2` `var(--sch-fill)`, `#009600` `var(--sch-wire)`, `#006464` `var(--sch-net)`, `#A90000` `var(--sch-pin)`, `#0000C2` and `#000084` `var(--sch-block)`, `#DC090D` `var(--fail)`, `#9B9B98` and `#939390` `var(--sch-dnp)`, `#F5F4EF` `var(--sch-paper)`, `#000000` `var(--sch-ink)`), case-insensitive; `inkSvg(svg: string): string` replaces them, sets `width="100%" height="100%"`, drops `<title>`, and removes `<script>` elements and every `on*` attribute; `viewBoxOf(svg: string): [number, number, number, number]`.
  - `sheetTargetAt(sheet: Sheet, p: Pt): Target | null` (in `ink.ts`): a pin within 1.0 mm first (as `pad` target `ref.number`), then a wire or label within 0.6 mm (as `net`), then a symbol box (as `part`).
  - `SheetView.tsx`: the inked SVG under an SVG overlay in the same viewBox: hit boxes, the selection as an accent wash with a 0.45 stroke, a selected net drawn as a 0.7 accent line along its wires, block frames lit when their block is in hand, finding pins at `sheet` positions (2.6 px mono numbers), and marks (Task 12). Pan and zoom by the SVG's viewBox with Task 6's `zoomAt`. A part or pin selected here has its board `describeTarget` text (the selection carries over to the Board tab and back). After a build, symbols whose box moved or whose part changed (`changes.circuit` names it) get the accent wash once.
  - Test hook: `drawn().sheet = { hash: string | null; symbols: number; selected: string | null; net: string | null }`.

- [x] **Step 1: Write the failing tests**

```ts
it('recolours the reference sheet to the ink and leaves none of KiCad's colours', () => {
  const out = inkSvg(read(fx('schematic.svg')))
  for (const k of Object.keys(KICAD_COLOURS)) expect(out.toUpperCase()).not.toContain(k.toUpperCase())
  expect(out).toContain('var(--sch-ink)')
})
it('strips scripts and event attributes', () => {
  expect(inkSvg('<svg><script>x()</script><g onclick="y()"/></svg>')).toBe('<svg width="100%" height="100%"><g/></svg>')
})
it('finds a pin before its wire, and a symbol by its box', () => {
  const sheet = sheetOf(readJson(fx('sheet.json')))!
  const u2 = sheet.symbols.find((s) => s.ref === 'U2')!, vin = u2.pins.find((p) => p.name === 'VIN')!
  expect(sheetTargetAt(sheet, { x: vin.x + 0.3, y: vin.y })).toEqual({ kind: 'pad', ref: 'U2', number: vin.number })
  expect(sheetTargetAt(sheet, { x: (u2.x0 + u2.x1) / 2, y: (u2.y0 + u2.y1) / 2 })).toEqual({ kind: 'part', ref: 'U2' })
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/sheet`
Expected: FAIL.

- [x] **Step 3: Write `ink.ts` and `SheetView.tsx`**

The sheet sits on the plate as one paper (`--sch-paper`) with the float shadow; fonts inside the SVG are `var(--font-mono)` (mock `sheet.css`). Hint pill: "Click a part, pin or wire · drag pans · scroll zooms".

- [x] **Step 4: Run them**

Run: `pnpm -C app exec vitest run src/renderer/sheet && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src/renderer
git commit -m "Schematic tab: KiCad's sheet in the board's ink, clickable by part, pin and net"
```

---

### Task 8: The 3D view: the GLB in the solder-mask material

> As built: the GLB's materials are only `mat_N`, so `classify` tells the board from its parts by KiCad's mesh names (`board_soldermask`, `board_copper`, `board_pad`, `board_silkscreen`, `board_PCB`). The GLB is in metres on the board file's page (x to x, y to z). `Bare board` hides the parts, the silk and the mask, to show the copper as etched. The cube has no number keys, since 1 to 8 pick copper layers. The lights are turned down so the mask reads as the picked green. Clicking in 3D does not select (the plan does not ask for it).

**Files:**
- Create: `app/src/renderer/three/glb.ts`, `material.ts`, `ThreeView.tsx`, `app/src/renderer/styles/three.css`; copy torno's `ui/view/Compass.tsx`, `ui/view/ViewCube.tsx`, `styles/compass.css`, `viewport/lights.ts`
- Modify: `app/package.json` (`three ^0.186.1`, `@types/three ^0.186.0`), `app/src/renderer/ui/ViewPane.tsx`, `shared-from-torno.json`
- Test: `app/src/renderer/three/material.test.ts`, `app/src/renderer/three/glb.test.ts`

**Interfaces:**
- Consumes: `build.file(…, 'glb')` (`Uint8Array`), `Board`, `centreOf` (Task 4), `Selection` (Task 6).
- Produces:
  - `glb.ts`: `glbFrame(boardBox: BBox /* KiCad frame */, glbBox: { min: [number, number, number]; max: [number, number, number] }): { scale: number; toGlb(p: Pt): [number, number, number] }`, the mapping from KiCad page mm to the GLB's units and axes, decided from the fixture in Step 1 (KiCad's GLB export is in metres with y up; record what the fixture shows in the test).
  - `material.ts`: `MATERIAL_LOOK = { mask: '#1E5B3B', maskCu: '#3F8C5F', tin: '#DCDFD8', silk: '#F2F0E8', fr4: '#C2BB9C' }`; `classify(m: { name: string; color: [number, number, number] }): 'mask' | 'copper' | 'tin' | 'silk' | 'fr4' | 'part'`, by the material names and colours KiCad writes into the fixture GLB (list them in Step 1); `restyle(root: Object3D): void` sets the board's materials to `MATERIAL_LOOK` and leaves the parts' own.
  - `ThreeView.tsx`: a live three.js view (WebGLRenderer, `antialias`, `preserveDrawingBuffer: true` so `look` can read it), orbit by drag, pan by right drag, zoom by wheel; torno's compass (Perspective, Ortho) top right; options "Parts", "Silk", "Bare board" top left; the selected part gets torno's leader to a `Tag` with the part's `describeTarget`; disposes geometry and textures on each new GLB. Hint pill: "Drag turns, right drag pans, scroll zooms".
  - Test hook: `drawn().three = { hash: string | null; loaded: boolean; meshes: number; board: boolean }`.

- [x] **Step 1: Inspect the fixture GLB, then write the failing tests**

Read the fixture's `board.glb` JSON chunk with a small node snippet (first 20 bytes are the header, then the JSON chunk) and write down its material names, base colours and the board node's bounding box. Then:

```ts
it('names the board materials of the reference GLB', () => {
  const mats = glbMaterials(read(fx('board.glb')))   // test helper: parses the JSON chunk
  expect(mats.map(classify)).toEqual(expect.arrayContaining(['mask', 'tin', 'silk', 'fr4']))
})
it('maps a board point into the GLB where the board is', () => {
  const f = glbFrame(boardBoxOf(fixtureBoard), glbBoxOf(fixtureGlb))
  const [x, , z] = f.toGlb(toKicad({ x: 0, y: 0 }))
  expect(x).toBeCloseTo(glbCentre[0], 4); expect(z).toBeCloseTo(glbCentre[2], 4)
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/three`
Expected: FAIL.

- [x] **Step 3: Add three, copy the compass, write the view**

`pnpm -C app add three@^0.186.1 && pnpm -C app add -D @types/three@^0.186.0`. GLTFLoader from `three/examples/jsm/loaders/GLTFLoader.js`. The board sits on the plate with a soft shadow; no ground grid.

- [x] **Step 4: Run them**

Run: `pnpm -C app exec vitest run src/renderer/three && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/package.json pnpm-lock.yaml app/src/renderer shared-from-torno.json
git commit -m "3D tab: the build's GLB in three.js in the solder-mask look, with torno's compass (three: render the GLB)"
```

---

### Task 9: The route card, the status line and the builds strip

> As built: the engine's `model3d` findings have a row of their own, `3D models`, shown only when it has something to say. A finding from a source no row names goes to Engine, so none is dropped. In hand shows the exact reference Claude gets, without a second summary of the part. `status.css` becomes an adapted copy. The em-dash test also covers `domain.ts`, `marks.ts`, `view.ts` and `measure.ts`.

**Files:**
- Create: `app/src/shared/checks.ts`, `app/src/renderer/ui/route/Head.tsx`, `InHand.tsx`, `ChecksBlock.tsx`, `RoutingBlock.tsx`, `BoardBlock.tsx`, `BlocksBlock.tsx`, `NetBlock.tsx`, `app/src/copy.test.ts`; copy torno's `ui/strip/BuildsStrip.tsx`, `ui/strip/strip.ts`, `strip.test.ts`, `styles/strip.css`
- Modify: `app/src/renderer/ui/RouteCard.tsx`, `StatusLine.tsx`, `SessionDock.tsx`, `app/src/renderer/styles/route.css`, `shared-from-torno.json`
- Test: `app/src/shared/checks.test.ts`, `app/src/renderer/ui/strip/strip.test.ts`, `app/src/copy.test.ts`

**Interfaces:**
- Consumes: `BuildState`, `BuildResult`, `verdictWords` (Task 2), `Selection`, `hotFinding` (Task 6), `Circuit`.
- Produces:
  - `shared/checks.ts`: `interface CheckRow { label: string; findings: number[] /* indexes into result.findings */; errors: number; warnings: number; infos: number; word: 'pass' | 'warn' | 'fail' | 'note' | 'skipped' }`; `CHECK_ROWS: ReadonlyArray<{ label: string; sources: string[]; codes?: RegExp }>` in this order: "Electrical rules" (`erc`), "Connections, by part and pin" (`netlist`, `expect`, `pads`), "Board matches the schematic" (`drc`, codes `^parity_`), "Design rules" (`drc`, other codes), "Courtyards, fit in outline" (`courtyard`, `fit`), "Placement" (`placement`), "Reads left to right" (`lint`), "Copper" (`copper`), "Routing" (`route`), "Engine" (`kernel`, `board.py`; shown only when it has findings); `checkRows(r: BuildResult): CheckRow[]` (a row whose check the build skipped, named in `waiting` or by a `kernel` finding such as `kicad_cli_missing`, is `skipped`); `openNets(r: BuildResult, placement: Placement, routeFindings: Finding[] | null): string[]` (nets with open connections, natural order).
  - Route card (mock `a-drafting.png`): head `On h15` in 16 px 600 with the headline's rest in mono (`verdictWords`), and under it "Fast build 2.4 s" from `timings` and what waits; then "In hand" when something is selected (Task 12 adds marks there), "Routing" (gauge of nets routed, one cell per net, open cells hollow, stale cells hatched; the router and its time; "Copper is from this build" or "Copper is from an older build h15"; the open nets by name), "Checks" with its rows (a row's hover sets `hotFinding` to its first finding with a position), "Board" (size from the outline, parts and nets, copper mm and vias when routed), "Blocks" and "Net" on the Schematic tab (mock `a-sheet.png`: blocks with part counts; the selected net's pins, "Checked by part and pin, not by name" with the expect verdict), then the shell's "Brief". The engine's failure (`engine.state === 'failed'`) replaces the head with "The engine did not start" and its reason.
  - Status line: `h15 built in 2.4 s`, a "Rebuild" button (`build.rebuild`), `routed 24/31` (or `not routed`), the warnings count as a link that hovers the first, the part count, `kicad 10.0.6` from `kicad_cli`.
  - Builds strip (torno's, adapted) at the top of the session dock: "Builds of <project>" and the count kept; nodes `hN` with a 62 x 44 thumbnail drawn by `drawBoard` at that size (kept in memory for the run; a node of a build not kept is greyed with "not kept"); caption `routed`, `stale`, `ok`, `2 errors` or `failed`; a click shows that build (`showBuild`), the shown node is ringed in the accent; a new node lands 0.7 s from 34 px.
  - `copy.test.ts`: no em dash (U+2014) in `app/src/renderer/**/*.tsx`, `app/src/main/prompt.ts`, `app/src/main/mcp/*.ts`, `app/src/shared/checks.ts`, `app/src/shared/board/refs.ts`.

- [x] **Step 1: Write the failing tests**

```ts
it('sorts the reference build's findings into the card's rows', () => {
  const rows = checkRows(ref)
  expect(rows.map((r) => r.label).slice(0, 2)).toEqual(['Electrical rules', 'Connections, by part and pin'])
  expect(rows.find((r) => r.label === 'Board matches the schematic')!.word).toBe('pass')
})
it('says a check was skipped when kicad-cli was missing', () => {
  expect(checkRows(withFinding(ref, { source: 'kernel', code: 'kicad_cli_missing', severity: 'warning', message: 'x' })).find((r) => r.label === 'Electrical rules')!.word).toBe('skipped')
})
it('lists open nets from the ratsnest, or from the route when one is current', () => {})
it('has no em dash in UI copy, prompts or tool text', () => { /* reads the files named above */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/checks.test.ts src/copy.test.ts src/renderer/ui/strip`
Expected: FAIL.

- [x] **Step 3: Write `checks.ts`, the card blocks, the status line; copy and adapt the strip**

- [x] **Step 4: Run them, the unit suite and typecheck**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src shared-from-torno.json
git commit -m "Route card on a build: On hN, routing, checks by part and pin, board; status line and builds strip"
```

---

### Task 10: The session domain: the build in every prompt, and Stop holds

> As built: the `Mark` types are in `shared/marks.ts` from this task on; Task 11 adds what they do. Before a Stop is judged, the domain waits the watcher's debounce plus 200 ms. Claude's last save may not have started its build yet, and that Stop must still be held. `Builds.routedOn` says which build a route was made on. The window tells main what it shows (`view:tell`, checked by `main/view.ts`).

**Files:**
- Create: `app/src/main/domain.ts`
- Modify: `app/src/main/sessions/domain.ts`, `app/src/main/sessions/manager.ts`, `app/src/main/sessions/claude.ts`, `app/src/main/prompt.ts`, `app/src/main/index.ts`, `shared-from-torno.json` (claude.ts change line)
- Test: `app/src/main/domain.test.ts`, `app/src/main/sessions/manager.test.ts` (one new case), `app/src/main/turncost.test.ts`

**Interfaces:**
- Consumes: `Builds` (Task 3), `MarkStore` (Task 11 adds the marks; this task passes an empty list until then), `checkRows` (Task 9).
- Produces:
  - `sessions/domain.ts` (seam change, the one touch of the manager): `interface PromptContext { text: string; sentMarkIds: string[]; delivered?: () => Promise<void> }`; `SessionDomain.promptContext(project: ProjectInfo, prompt: string): Promise<PromptContext>`; `NO_DOMAIN.promptContext` answers `{ text: '', sentMarkIds: [] }`. The manager passes `sentMarkIds` to `transcript.context` and calls `delivered()` after `sendJson` of the hook's answer.
  - `claude.ts`: `STOP_HOOK_TIMEOUT_S = 25` for the `Stop` hook (torno's value), others stay 5.
  - `main/domain.ts`: `CONTEXT_LIMIT = 6000`, `VERDICT_LIMIT = 1200`, `STOP_WAIT_MS = 20_000`, `MOST_HOLDS = 2`; `class PinoDomain implements SessionDomain { constructor(deps: { builds: Builds; marks: { drafts(p: ProjectInfo): Promise<Mark[]>; open(p: ProjectInfo): Promise<Mark[]>; markSent(p: ProjectInfo, ids: string[]): Promise<void> }; view: () => { tab: ViewTab; look: BoardLook; selection: Selection | null } | null; toolName: (t: string) => string; now?: () => number }); looked(projectId: string): void; promptContext(...); stopAnswer(...) }`.
  - `verdictText(r: BuildResult, state: BuildState): string`: `On h7: 0 errors, 2 warnings, 18 unrouted.` then up to 5 error and warning findings as `- [error] drc clearance: <message> at (x, y) mm`, then `Building h8 now.` when one runs, then the routing line (`Routing: current, r3.` / `Routing: stale (parts moved), copper from h5.` / `Routing: running, 12 of 31 nets.`), cut at `VERDICT_LIMIT` with `(cut)`; a failed build says `h8 failed: <message>, board.py line 12. The views still show h7.`; the engine down says `The engine is not running: <reason>.`
  - `promptContext` text, in this order, at most `CONTEXT_LIMIT`: the verdict; `The person sees the Board tab, top copper.` (or Schematic, 3D) with `Selected: <selection text>.`; each draft mark of the person as `M3 <payload>` plus ` · note: "<note>"` when it has one (oldest first; those that do not fit are counted `and 2 more marks: call marks`); `Open marks: M1, M2 (stale: its track is gone).`. `sentMarkIds` are the drafts listed; `delivered` marks them sent. It records the turn's start (`now()`) per project.
  - `stopAnswer` holds, at most `MOST_HOLDS` times a turn and once per reason: `running` (a build started after the turn began is still running after waiting up to `STOP_WAIT_MS`: "h8, started in this turn, is still building. Wait for it, then call mcp__pino__check."), `failed` (the newest build, started in the turn, failed: the verdict text plus "Fix board.py, or say it is still broken."), `unlooked` (a build started in the turn ended after the last `look` or `check` of the turn and changed the board (`changes` not empty): "h8 was built in this turn and you have not looked at it. Call mcp__pino__look or mcp__pino__check before finishing."). A build that started before the turn holds nothing.
  - `prompt.ts`: the system prompt says what pino is, that the views rebuild on every save, the tools by name, and spec 5.8's rules in plain words (never waive a finding, a waiver is the person's call with a note; numbers from the board file through `measure`, never from pixels; make the picture, look, say what you see and what it does not show; state each job's scope and depth up front and name every step left out; an accepted DRC error gets a measured part-scoped rule, never an exclusion; plain words for every choice, jargon glossed; marks: answer by id, resolve with `resolve_mark` when done).

- [x] **Step 1: Write the failing tests**

```ts
it('tells the verdict, the view and the drafts, and sends the drafts once delivered', async () => {
  const d = domainWith({ latest: ref, drafts: [m3stroke], view: { tab: 'board', look: DEFAULT_LOOK, selection: padSel } })
  const c = await d.promptContext(project, 'fix it')
  expect(c.text.split('\n')[0]).toBe(`On h1: ${verdictWords(ref).rest}.`)
  expect(c.text).toContain('The person sees the Board tab, top copper. Selected: pad U2.1 · VIN')
  expect(c.text).toContain(`M3 ${m3stroke.payload}`)
  expect(c.sentMarkIds).toEqual(['M3'])
  await c.delivered!(); expect(markSent).toHaveBeenCalledWith(project, ['M3'])
})
it('stays under CONTEXT_LIMIT and counts the marks that do not fit', async () => {})
it('holds a Stop once while a build of the turn is running, and lets the next go', async () => {})
it('holds a Stop for a failed build of the turn with its line', async () => {})
it('holds a Stop once for a build of the turn that nobody looked at', async () => {})
it('holds nothing for a build begun before the turn', async () => {})
it('never holds a third time in a turn', async () => {})
```

```ts
// manager.test.ts, new case
it('puts the marks the domain sent on the prompt's context item, and calls delivered', async () => {})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/domain.test.ts src/main/sessions/manager.test.ts`
Expected: FAIL.

- [x] **Step 3: Change the seam, write the domain and the prompt, wire it in `index.ts`**

- [x] **Step 4: Run them, turncost included**

Run: `pnpm -C app exec vitest run src/main && pnpm -C app typecheck`
Expected: PASS (`turncost.test.ts` still holds the system prompt plus server instructions under 12,000).

- [x] **Step 5: Commit**

```bash
git add app/src/main shared-from-torno.json
git commit -m "Tell Claude the build with every prompt, and hold a Stop while its build runs, failed or was not looked at"
```

---

### Task 11: Marks in main: the model, the file, the store, re-anchoring

> As built: main works out where a point stands (the centre of its target, not the pixel clicked), what a stroke crosses and what a region holds, whatever the window said. Claude's arrows span a measured gap and keep their two ends. Whether the target is still there is still checked. A long stroke's path is said by its first and last twelve points. The person hears of a damaged file when the window asks for its marks, since at the start no window is listening yet.

**Files:**
- Create: `app/src/shared/marks.ts`, `app/src/main/marks/file.ts`, `store.ts`, `reanchor.ts`, `app/src/main/model.ts`
- Modify: `app/src/main/ipc.ts`, `app/src/main/index.ts`, `app/src/shared/bridge.ts`, `app/src/preload/index.ts`, `app/src/renderer/state/store.ts`, `.claude/rules/workspace-writes.md`
- Test: `app/src/shared/marks.test.ts`, `app/src/main/marks/file.test.ts`, `store.test.ts`, `reanchor.test.ts`, `app/src/main/model.test.ts`

**Interfaces:**
- Consumes: `Target`, `describeTarget`, `crossings`, `shortLabel`, `findTarget`, `centreOf` (Task 4), `Sheet` (Task 2), `Builds.onResult` (Task 3), `ownFolder`, `writeFileAtomic` (shell).
- Produces (`shared/marks.ts`):
  - `type MarkStatus = 'draft' | 'sent' | 'resolved'`; `type AnchorState = 'ok' | 'moved' | 'stale'`.
  - `interface MarkBase { id: string; author: 'user' | 'agent'; status: MarkStatus; anchor: AnchorState; build: number; checkedBuild?: number; note: string; payload: string; label: string; createdAt: string; resolvedNote?: string; resolvedBy?: 'user' | 'agent'; was?: { at: Pt; text: string } }` (`payload` is the exact line Claude gets, `label` the chip's text, `was` where a stale target was and what it was).
  - `interface PointMark extends MarkBase { kind: 'point'; space: 'board' | 'sheet'; target: Target; at: Pt }`; `interface ArrowMark extends MarkBase { kind: 'arrow'; from: Target | null; fromAt: Pt; to: Pt }`; `interface StrokeMark extends MarkBase { kind: 'stroke'; layer: string; points: Pt[]; crosses: { nets: string[]; parts: string[] } }`; `interface RegionMark extends MarkBase { kind: 'region'; layers: string[]; points: Pt[]; intent: 'keep-clear' | 'put-here' | null; holds: string[] }`; `type Mark = PointMark | ArrowMark | StrokeMark | RegionMark`. All positions board frame (sheet mm for a sheet point).
  - `type NewMark` = a mark without `id`, `status`, `anchor`, `build`, `createdAt`, `payload`, `label` (main computes those); `type MarkPatch = { note?: string; intent?: 'keep-clear' | 'put-here' | null; layer?: string; status?: 'draft' }`.
  - `MAX_NOTE = 300`, `MAX_STROKE_POINTS = 400`, `MOST_MARKS = 200`, `MOST_AGENT_TARGETS = 8`, `STROKE_TOLERANCE = 0.1` (mm, Ramer-Douglas-Peucker).
  - `markPayload(mark: Mark, board: Board, circuit: Circuit | null): string`, the exact text: point is `describeTarget`; arrow `arrow · from part U2 (x, y) to (x, y) mm · 1.50 mm down` (direction words from dx, dy in the y-up frame: `up`, `down`, `left`, `right`, or `2.12 mm, 1.50 right and 1.50 down`); stroke `stroke · bottom copper · 6.10 mm · path (x, y) (x, y) … mm · crosses nets SPIQ, SPID, +3V3 · passes parts U2`; region `region · both copper layers · x a to b, y c to d mm · 5 points · holds SW1, R1`, prefixed `keep this clear: ` or `put these here: ` when it has an intent; a stale mark ends `· stale: <what is gone>, it was at (x, y) mm`.
  - `markLabel(mark: Mark): string`: the id for the person's marks (`M3`), `shortLabel` of the target for Claude's (`U2`, `gap 0.83 mm`).
- Produces (`main/marks/file.ts`): `MARKS_FILE = 'marks/marks.json'` under `.pino`; `interface MarksFile { schema: 'pino.marks/1'; next: number; marks: Mark[] }`; `loadMarks(dir: string): Promise<{ file: MarksFile; problem?: string }>` (a file that is not JSON or not this schema is renamed `marks.json.bad-<n>`, the first free n, and the problem says "Your marks file could not be read. It was kept as .pino/marks/marks.json.bad-1."); `saveMarks(dir: string, file: MarksFile): Promise<void>` through `ownFolder` and `writeFileAtomic`; `sanitiseMark(value: unknown): Mark | null`.
- Produces (`main/marks/store.ts`): `class MarkStore { constructor(deps: { model: (p: ProjectInfo) => Promise<BuildModel | null>; now?: () => Date; notice?: (text: string) => void }); list(p): Promise<Mark[]>; drafts(p): Promise<Mark[]>; open(p): Promise<Mark[]>; add(p, m: NewMark, by: 'user' | 'agent'): Promise<Mark>; update(p, id, patch: MarkPatch): Promise<Mark>; remove(p, id): Promise<void>; markSent(p, ids: string[]): Promise<void>; resolve(p, id, note: string, by: 'user' | 'agent'): Promise<Mark>; reanchor(p, model: BuildModel): Promise<void>; onChange(cb: (projectId: string, marks: Mark[]) => void): () => void }`. Ids `M<next>`, never reused; a person's mark is a draft, Claude's is `sent` at once; one write at a time per project; `MOST_MARKS` refused with "pino keeps 200 marks: resolve or remove some".
- Produces (`main/marks/reanchor.ts`): `reanchor(mark: Mark, model: BuildModel): Mark` (pure): a part by ref, a pad by ref and number, a net by name, a track, via or zone by uuid; found and moved over 0.01 mm is `moved` (position updated, payload redone), found in place is `ok`, gone is `stale` with `was` (kept position and old text); strokes and regions keep their points and redo `crosses` and `holds`; resolved marks are not touched; a failed build (no hash) re-anchors nothing.
- Produces (`main/model.ts`): `interface BuildModel { result: BuildResult; board: Board; routeBoard: Board | null; circuit: Circuit | null; placement: Placement | null; sheet: Sheet | null }`; `class Models { get(p: ProjectInfo, r: BuildResult): Promise<BuildModel | null> }` (parses once per hash and route, keeps the newest 3).
- Bridge, channels `marks:list`, `marks:add`, `marks:update`, `marks:remove`, `marks:resolve`, to the window `marks:changed`: `marks: { list(projectId): Promise<Mark[]>; add(projectId, mark: NewMark): Promise<Mark>; update(projectId, id, patch: MarkPatch): Promise<Mark>; remove(projectId, id): Promise<void>; resolve(projectId, id, note: string): Promise<Mark>; onChange(cb: (m: { projectId: string; marks: Mark[] }) => void): () => void }`. Store: `marks: Mark[]`, `setMarks`.

- [x] **Step 1: Write the failing tests**

```ts
// marks.test.ts
it('says an arrow with its direction in words', () => {
  expect(markPayload(arrow({ from: { kind: 'part', ref: 'U2' }, fromAt: { x: 3, y: 2 }, to: { x: 3, y: 0.5 } }), b, c)).toBe('arrow · from part U2 (3.00, 2.00) to (3.00, 0.50) mm · 1.50 mm down')
})
it('says a region with its intent and what it holds', () => {})
it('labels the person's marks by id and Claude's by target', () => {})

// file.test.ts
it('writes atomically under .pino/marks and reads it back', async () => {})
it('a damaged file is set aside and said', async () => {
  await writeFile(join(dir, '.pino/marks/marks.json'), '{nope')
  const { file, problem } = await loadMarks(dir)
  expect(file.marks).toEqual([]); expect(problem).toContain('marks.json.bad-1')
  expect(existsSync(join(dir, '.pino/marks/marks.json.bad-1'))).toBe(true)
})
it('refuses to write through a .pino that is a link', async () => {})

// store.test.ts
it('numbers marks M1, M2 and never reuses a removed id', async () => {})
it('keeps the person's marks as drafts and Claude's as sent', async () => {})
it('one write at a time: ten adds at once give ten marks in the file', async () => {})

// reanchor.test.ts
it('a pad that moved is moved, and its payload redone', () => {})
it('a track whose uuid is gone is stale where it was', () => {
  const m = reanchor(trackMark, modelWithout(trackUuid))
  expect(m.anchor).toBe('stale'); expect(m.was!.at).toEqual(trackMark.at)
  expect(m.payload).toMatch(/· stale: its track is gone, it was at \(/)
})
it('a renamed part is stale, a net renamed is stale, a resolved mark is left alone', () => {})
it('a failed build re-anchors nothing', () => {})
it('a stroke redoes what it crosses after a part moved under it', () => {})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/marks.test.ts src/main/marks src/main/model.test.ts`
Expected: FAIL.

- [x] **Step 3: Write the model, file, store, re-anchor, IPC and preload; wire `Builds.onResult` to `marks.reanchor`; give the domain its marks**

`workspace-writes.md` gains `.pino/marks/marks.json` (main, atomic) as the one file pino's main writes in a project in this stage.

- [x] **Step 4: Run them**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src .claude/rules/workspace-writes.md
git commit -m "Marks in main: M<n> ids, drafts and sent, one atomic file, re-anchored on every build by stable ids"
```

---

### Task 12: Pencil marks on the board and the sheet

> As built: dragging an arrow from a pad starts it at the pad's part, since a part is what gets moved. A new region means "keep this clear" until changed. The reed fills only a marking tool in violet, never Select, as the mock does. The mock scene gets its track mark once routed copper exists (Task 16). KiCad's `unconnected-(...)` names count as no net, so a stroke no longer lists open pins as nets. `numbered()` sets refs and rails whole. The plan's track mark is not in the pencil shot yet.

**Files:**
- Create: `app/src/renderer/board/marks/tools.ts`, `drawMarks.ts`, `MarkReed.tsx`, `ChipLayer.tsx`, `app/src/renderer/ui/route/MarksBlock.tsx`, `app/src/renderer/ui/MarkChip.tsx`; copy torno's `styles/tools.css` (reed rules) and `styles/marks.css` (chip rules)
- Modify: `app/src/renderer/board/BoardView.tsx`, `app/src/renderer/sheet/SheetView.tsx`, `app/src/renderer/ui/route/InHand.tsx`, `app/src/renderer/state/store.ts`, `app/src/shared/keys.ts`, `shared-from-torno.json`
- Test: `app/src/renderer/board/marks/tools.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 7, 11.
- Produces:
  - `tools.ts` (pure): `type MarkTool = 'select' | 'point' | 'arrow' | 'stroke' | 'region'`; `TOOL_NAMES: Record<MarkTool, string>` = `{ select: 'Select', point: 'Point at a part, pad or track', arrow: 'Arrow: move this here', stroke: 'Stroke: route this way', region: 'Region: keep this clear' }`; `strokeOf(screen: Pt[], view: View): Pt[]` (to KiCad frame, Ramer-Douglas-Peucker at `max(STROKE_TOLERANCE, 1.5 px / scale)`, at most `MAX_STROKE_POINTS`); `newMarkFrom(tool: MarkTool, input: { hit?: Hit; points: Pt[]; layer: string; layers: string[] }, board: Board): NewMark | null` (board frame in the mark; region of fewer than 3 points or under 0.5 mm² is null; arrow with no start item starts at a point); `liveReadout(points: Pt[], board: Board, layer: string): string` (`6.10 mm · crosses SPIQ, SPID`).
  - Keys, scope `view`: `mark.point` `P`, `mark.arrow` `A`, `mark.stroke` `D`, `mark.region` `R`, `mark.select` `V`.
  - `MarkReed.tsx`: torno's reed at the left of the view, five round buttons; the tool in hand is filled `--user-mark` and grows its name pill (0.22 s) with its key.
  - `drawMarks.ts`: the mock `lib/marks.js` shapes, in the mark's colour (`--user-mark` or `--agent-mark`, the accent for the selection): a part's courtyard outlined 1.8 px over a 10 % wash; a pad ringed 2 px over a 30 % wash; a track cased; an arrow with a dashed ghost of the part's outline where it would land; a stroke as a soft round 3 px pen line drawn in over 1.4 s while it is made; a region dashed with a 12 % wash; a stale mark drawn at `was` in 40 % of its colour with a dashed outline. Drawn on the top canvas, never redrawing the board.
  - `ChipLayer.tsx`: each mark's chip on its point (`transform: translate(4px, -100%)`, no leader), violet with white text, orange for Claude's, popping 0.2 s when new; a chip whose box would cover another moves up by its height until free (at most 3 steps).
  - `MarksBlock.tsx`: the route card's "Marks" section with "N to send" (mock `a-pencil.png`): torno's two-line rows, the chip, the note (or the verb of the tool) on line one, `payload` on line two in mono; the in-hand row has an accent left rule. `InHand.tsx` for a mark: "In hand M3, stroke", the payload, and buttons "Note", the layer menu (stroke and region), "Keep this clear" / "Put these here" (region), "Remove".
  - On the sheet, only `point` is offered (the reed shows Select and Point).
  - Test hook: `drawn().board.marks` lists the ids drawn; `drawn().sheet.marks` too.

- [x] **Step 1: Write the failing tests**

```ts
it('simplifies a hand stroke and keeps it on its layer', () => {
  const nm = newMarkFrom('stroke', { points: wiggle(300), layer: 'B.Cu', layers: ['F.Cu', 'B.Cu'] }, tiny)!
  expect(nm.kind).toBe('stroke'); expect((nm as StrokeMark).points.length).toBeLessThan(40)
})
it('makes no region from a click', () => { expect(newMarkFrom('region', { points: [p, p], layer: 'F.Cu', layers }, tiny)).toBeNull() })
it('starts an arrow at the part under the press', () => {})
it('reads a stroke's length and crossings live', () => { expect(liveReadout(path, tiny, 'F.Cu')).toBe('8.00 mm · crosses A, GND') })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/board/marks`
Expected: FAIL.

- [x] **Step 3: Write the tools, the drawing, the chips and the card rows; copy the reed and chip CSS**

- [x] **Step 4: Run them**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src shared-from-torno.json
git commit -m "Pencil marks: point, arrow, stroke and region on the board, point on the sheet, chips on their points"
```

---

### Task 13: Chips in the composer and the chat

> As built: `chipsFor` is in `ui/chat/markChips.ts` rather than `Items.tsx`, so that the tool card can use it without importing the items; it also reads a point's ids out of its answer. `chat-prompt.css` becomes an adapted copy.

**Files:**
- Modify: `app/src/renderer/ui/chat/Composer.tsx`, `app/src/renderer/ui/chat/Items.tsx`, `app/src/renderer/ui/chat/ToolCard.tsx`, `app/src/renderer/styles/chat-prompt.css`, `shared-from-torno.json` (their change lines)
- Test: `app/src/renderer/ui/chat/chips.test.ts`

**Interfaces:**
- Consumes: `Mark`, `markLabel` (Task 11), `MarkChip` (Task 12), the chat's `context` item (`marks: string[]`, shell).
- Produces:
  - `chipsFor(ids: readonly string[], marks: readonly Mark[]): Array<{ id: string; label: string; author: 'user' | 'agent'; hollow: boolean; title: string }>` in `Items.tsx`'s module (exported for the test): ids not in the store are dropped; `title` is the payload.
  - Composer: above the text, "Goes with your next prompt:" and a chip per draft of the person (mock `a-pencil.png`), each removable with its x; "Mark on board" in the composer's foot switches the view to the Board tab with the Point tool. Nothing about sending changes: the domain sends the drafts (Task 10).
  - Chat: under a prompt, its `context` item's marks as hollow chips beside the message; a `mcp__pino__point` tool card shows Claude's new marks as filled orange chips with their labels; hovering any chip lights its mark on the view (`store.hotMark`).

- [x] **Step 1: Write the failing test**

```ts
it('gives hollow chips for a sent prompt, by author colour, and drops ids it does not know', () => {
  expect(chipsFor(['M1', 'M9', 'M2'], [user('M1'), agent('M2', 'U2')])).toEqual([
    { id: 'M1', label: 'M1', author: 'user', hollow: true, title: user('M1').payload },
    { id: 'M2', label: 'U2', author: 'agent', hollow: true, title: agent('M2', 'U2').payload }
  ])
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm -C app exec vitest run src/renderer/ui/chat/chips.test.ts`
Expected: FAIL.

- [x] **Step 3: Write it**

- [x] **Step 4: Run the chat tests**

Run: `pnpm -C app exec vitest run src/renderer/ui/chat && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src shared-from-torno.json
git commit -m "Marks as chips in the composer, beside the prompt they went with, and on Claude's point card"
```

---

### Task 14: Claude sees what the person sees: look, check, measure, nets, trace, ratsnest, diff

> As built: the pictures are drawn on detached canvases, not `OffscreenCanvas` (`toDataURL` answers at once). The picture rules are in `shared/look.ts`; the 3D setup moved to `three/stage.ts` and the sheet's reader to `sheet/drawing.ts`, so that view and picture share them. A picture's lines and chips are never thinner than on screen. The 3D picture has no window and no marks, and takes the person's angle. `check` adds the current route's findings. `e2e/look.spec.ts` asks the real app for every tab through MCP.

**Files:**
- Create: `app/src/main/view.ts`, `app/src/main/mcp/readTools.ts`, `app/src/renderer/board/look.ts`, `app/src/renderer/sheet/look.ts`, `app/src/renderer/three/look.ts`
- Modify: `app/src/main/mcp/tools.ts`, `app/src/main/mcp/schemas.ts`, `app/src/main/turncost.test.ts`, `app/src/main/index.ts`, `app/src/shared/bridge.ts`, `app/src/preload/index.ts`, `app/src/renderer/App.tsx`
- Test: `app/src/main/mcp/readTools.test.ts`, `app/src/main/view.test.ts`, `app/src/main/turncost.test.ts`

**Interfaces:**
- Consumes: `Models`, `BuildModel` (Task 11), `measure`, `copperGroups`, `netLength`, `describeTarget` (Task 4), `checkRows` (Task 9), `PinoDomain.looked` (Task 10), `KernelClient.request('diff', …)` (Tasks 1, 3).
- Produces:
  - `main/view.ts`: `class NoAnswer extends Error {}`; `askWindow<T>(win: BrowserWindow, kind: 'look', req: LookRequest, timeoutMs = 10_000): Promise<T>` over `view:ask` and `view:answer` (torno's `look.ts` request pattern: one id per ask, rejects when the window closes or times out). Bridge: `view: { onAsk(cb: (m: { id: number; kind: 'look'; req: LookRequest }) => void): () => void; answer(id: number, result: LookResult | { error: string }): void }`.
  - `shared/view.ts` gains `interface LookRequest { tab?: ViewTab; layers?: string[]; window?: { x0: number; y0: number; x1: number; y1: number }; marks?: boolean; size?: number }` and `interface LookResult { png: string /* base64 */; width: number; height: number; said: string }` (`said`: `Board tab, h7, top copper over bottom, window x -10 to 10, y -5 to 5 mm, 3 marks drawn`).
  - The renderer's `look.ts` per view draws to an `OffscreenCanvas` at the asked size (Board: `drawBoard` plus `drawMarks`; Schematic: the inked SVG rasterised through an `Image`; 3D: the renderer's canvas read through `toBlob`), without changing what the person sees.
  - `schemas.ts`: `DEFAULT_SIZE = 1280`, `MIN_SIZE = 400`, `MAX_SIZE = 2000`, `TOOL_TEXT_LIMIT = 8000`, `MOST_LINES = 40`; `SERVER_INSTRUCTIONS` names every tool, the deferred ones too; one description per tool, plain words, each under 700 characters.
  - Tools (registered in `tools.ts` from `readTools.ts`), inputs as zod strict objects:
    - `look { tab?, layers?, window?, marks? = true, size? }`: one image (`image/png`) plus `said`; refuses a size out of range in words; calls `domain.looked`.
    - `check { source?: string; severity?: 'error' | 'warning' | 'info'; near?: string }`: `On h7: …` then the check rows (`Electrical rules: pass`), then findings as `[warning] drc silk_overlap · <message> · at (x, y) mm · U1, C5`, at most `MOST_LINES`, then `and N more: narrow with source or near`; calls `domain.looked`.
    - `measure { what, a?, b?, net?, layer? }` (targets written as `U1`, `U1.3`, `net:VBUS`, `track:<uuid>`, `via:<uuid>`): `measure()`'s `said` plus `From the board file of h7 (route r3).`; an unknown name is answered with the nearest names.
    - `nets { net?: string; part?: string }`: a net's members by part and pin with pin names and kind, or a part's pins with their nets, or (neither) every net with its member count.
    - `trace { pin: string }`: where `U1.3` leads: its net, the other pins, and the connected copper groups (`copperGroups`): "2 groups: U1.3, R4.2 joined by 3 tracks, 1 via; C7.1 not joined yet".
    - `ratsnest {}`: `score`, `crossings`, `length_mm` of `placement`, then the open connections as `VBUS: F1.2 to C1.1, 4.20 mm`, at most `MOST_LINES`.
    - `diff { from?: number; to?: number }`: default the previous build to the latest; consecutive builds answer from `changes`, others through the kernel's `diff`; a build no longer kept says so.
    - Up front (`'anthropic/alwaysLoad': true`): `project`, `look`, `check`, `measure`, `nets`, `point`, `marks`, `resolve_mark`, `route`. Deferred: `trace`, `ratsnest`, `diff`, `route_net`, `nudge`, `keep`.
  - Every text result goes through `capText(text: string, limit = TOOL_TEXT_LIMIT): string` (cut at a line, `(cut: N more characters)`).

- [x] **Step 1: Write the failing tests**

```ts
// readTools.test.ts: in-memory MCP client over registerTools with deps from the fixture model
it('check lists the rows and the findings with positions, capped', async () => {
  const t = await call('check', {})
  expect(t.split('\n')[0]).toBe(`On h1: ${verdictWords(ref).rest}`)
  expect(t).toMatch(/^\[warning\] drc .* · at \(-?\d+\.\d\d, -?\d+\.\d\d\) mm/m)
})
it('measure gives numbers from the board file and names the build', async () => {
  expect(await call('measure', { what: 'distance', a: 'U2', b: 'J1' })).toMatch(/^distance U2 to J1: \d+\.\d\d mm\. From the board file of h1\.$/)
})
it('measure answers an unknown name with the nearest ones', async () => { expect(await call('measure', { what: 'edge', a: 'U9' })).toContain('No part U9. Nearest: U1, U2') })
it('nets lists VBUS by part and pin', async () => { expect(await call('nets', { net: 'VBUS' })).toContain('U2.1 VIN') })
it('trace says a pin is not joined on an unrouted board', async () => {})
it('diff of consecutive builds is the stored changes; a pruned build is said', async () => {})
it('every text stays under TOOL_TEXT_LIMIT', async () => {})
```

```ts
// turncost.test.ts (torno's shape)
it('a picture costs by its area: the default look about 1,600 tokens at 4:3, the largest 3,900', () => {
  expect(pictureTokens(DEFAULT_SIZE, (DEFAULT_SIZE * 3) / 4)).toBe(1610)
  expect(pictureTokens(MAX_SIZE, (MAX_SIZE * 3) / 4)).toBe(3888)
})
it('look returns one picture, so six looks are the most an answer carries under 10,000 tokens', () => {
  expect(6 * pictureTokens(DEFAULT_SIZE, (DEFAULT_SIZE * 3) / 4)).toBeLessThan(10_000)
})
it('the tools loaded up front are the nine the prompt relies on, in at most 33,000 characters', async () => {
  expect(loaded.map((t) => t.name).sort()).toEqual(['check', 'look', 'marks', 'measure', 'nets', 'point', 'project', 'resolve_mark', 'route'])
  expect(chars).toBeLessThan(33_000)
  expect(tools).toHaveLength(15)
})
it('the system prompt with the server instructions is under 12,000 characters, and names every deferred tool', () => {
  expect(systemPrompt(toolName).length + SERVER_INSTRUCTIONS.length).toBeLessThan(12_000)
  for (const t of ['trace', 'ratsnest', 'diff', 'route_net', 'nudge', 'keep']) expect(SERVER_INSTRUCTIONS).toContain(t)
})
it('a prompt's context and a Stop reason stay under their caps', () => { expect(CONTEXT_LIMIT).toBe(6000); expect(VERDICT_LIMIT).toBe(1200) })
```

`point`, `marks`, `resolve_mark`, `route`, `route_net`, `nudge` and `keep` are registered in this task with their final names, descriptions and schemas, as stubs that answer "not yet", so the counts hold; Tasks 15 and 16 fill them.

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/mcp src/main/view.test.ts src/main/turncost.test.ts`
Expected: FAIL.

- [x] **Step 3: Write the ask channel, the renderer's pictures and the tools**

- [x] **Step 4: Run them**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src
git commit -m "MCP: look, check, measure, nets, trace, ratsnest and diff, with the turn's cost held"
```

---

### Task 15: Claude points back: point, marks, resolve_mark

> As built: `gapSpan` in `shared/board/measure.ts` gives the arrow its two ends by the same rule `measure` takes the gap by. `sheetPlace` moved to `shared/sheet.ts` so that main places a sheet mark where the view draws it; a gap on the sheet is refused. Every target is looked up, and the limit on marks checked, before any mark is made.

**Files:**
- Create: `app/src/main/mcp/markTools.ts`
- Modify: `app/src/main/mcp/tools.ts`, `app/src/main/mcp/schemas.ts`
- Test: `app/src/main/mcp/markTools.test.ts`

**Interfaces:**
- Consumes: `MarkStore` (Task 11), `Models`, name parsing of Task 14 (`targetOfName(board: Board, circuit: Circuit | null, name: string): Target | { error: string }`, exported from `readTools.ts`).
- Produces:
  - `point { targets: Array<string | { gap: [string, string] }>; note?: string; space?: 'board' | 'sheet' }` (1 to `MOST_AGENT_TARGETS`): one Claude mark per target (author `agent`, status `sent`; a name is a `point` mark on its target; a gap is an `arrow` mark from the first item to the second item's nearest copper point, label `gap 0.83 mm` from `measure`); answers `Pointed: M7 U2, M8 U1, M9 gap 0.83 mm. They are orange in the view.` Unknown names: nothing is made, the answer lists them with the nearest names.
  - `marks { status?: 'open' | 'all' }`: every mark as `M3 · draft · person · <payload> · note: "…"`, open first, at most `MOST_LINES`.
  - `resolve_mark { id: string; note: string }`: resolves a person's or Claude's mark with the note; a draft cannot be resolved ("M4 has not been sent to you yet"), nor an id that is not there.

- [x] **Step 1: Write the failing tests**

```ts
it('point makes orange marks the view will draw, and says their ids', async () => {
  expect(await call('point', { targets: ['U2', 'U2.1'], note: 'these two' })).toBe('Pointed: M1 U2, M2 U2.1. They are orange in the view.')
  expect((await store.list(project)).map((m) => [m.id, m.author, m.status])).toEqual([['M1', 'agent', 'sent'], ['M2', 'agent', 'sent']])
})
it('point with an unknown name makes nothing', async () => {})
it('point a gap measures it and labels the mark', async () => {})
it('point refuses more than 8 targets', async () => {})
it('resolve_mark refuses a draft and resolves a sent mark with its note', async () => {})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/mcp/markTools.test.ts`
Expected: FAIL.

- [x] **Step 3: Write the three tools**

- [x] **Step 4: Run them with the turn-cost test**

Run: `pnpm -C app exec vitest run src/main/mcp src/main/turncost.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add app/src/main/mcp
git commit -m "MCP: Claude points at parts, pads and gaps in orange, reads the marks and resolves them"
```

---

### Task 16: Routing in the views and Claude's route tools

**Files:**
- Create: `app/src/main/mcp/routeTools.ts`, `app/src/main/routing.ts`
- Modify: `app/src/main/mcp/tools.ts`, `app/src/main/mcp/schemas.ts`, `app/src/main/builds.ts`, `app/src/main/index.ts`, `app/src/shared/bridge.ts`, `app/src/preload/index.ts`, `app/src/renderer/board/BoardView.tsx`, `app/src/renderer/board/draw.ts`, `app/src/renderer/ui/view/Band.tsx`, `app/src/renderer/ui/route/RoutingBlock.tsx`
- Test: `app/src/main/routing.test.ts`, `app/src/main/mcp/routeTools.test.ts`

**Interfaces:**
- Consumes: `KernelClient.job`, `request`, `cancel`, `Pong.serve` (Task 3), `RoutingState`, `RouteProgress` (Task 2), the routing plan's serve ops (`route`, `route_status`, `route_cancel`, `route_net`, `nudge`, `keep`; results `pino.route/1`, `pino.trial/1`).
- Produces:
  - `main/routing.ts`: `ROUTING_UNAVAILABLE = 'Routing is not available in this engine yet: it comes with the routing stage.'`; `class Routing { constructor(deps: { kernel: () => KernelClient; builds: Builds; engine: () => EngineState }); available(): boolean /* serve >= 2 */; start(p: ProjectInfo): Promise<{ job: number }>; cancel(p: ProjectInfo): Promise<boolean>; status(p: ProjectInfo): Promise<RoutingState | null>; trial(p: ProjectInfo, op: 'route_net' | 'nudge' | 'keep', args: Record<string, unknown>): Promise<unknown>; progress(projectId: string): RouteProgress | null }`. One route job per project; its events update `BuildState.route`; when it ends, main asks for a build (the cache answers at once) so `routing` in the result is the one truth.
  - Bridge: `route: { start(projectId: string): Promise<void>; cancel(projectId: string): Promise<void> }` (the band's "Route again" and "Cancel").
  - Tools: `route { action: 'start' | 'status' | 'cancel' }` (start answers `Routing h7 started. It takes minutes; the view shows its progress. Call route with status to follow it.`; status answers the routing state in words, with the open nets by name; cancel says whether one was running); `route_net { net, region?: [number, number, number, number], layers?: string[], corridor?: Array<[number, number]>, rip?: string[] }`, `nudge { part, by?: [number, number], rot?: number, back?: boolean, route?: boolean }`, `keep { net }`: each answers the trial's headline, `before` and `after`, its findings (capped), and `Write this into board.py:` with the `snippet` (and `It replaces line N.` when `replaces_line` is set). Every route tool answers `ROUTING_UNAVAILABLE` when `available()` is false.
  - Views: `routing` band "Routing in the background, 18 of 31" with a 120 px progress bar and "Cancel"; when routing lands, its copper is drawn in net by net from the pads out (`revealOrder`, 1.6 s linear after 0.5 s), then the open connections appear and finding pins pop; `stale` band "Copper from h15. U4 moved since." with "Route again" and "Keep it" ("Keep it" closes the band for this build and leaves the faded copper on show; it changes no file); stale copper faded, pads in ink; the Routing block's gauge from the route's counts, router and time from `router_seconds`, the open nets by name.

- [ ] **Step 1: Write the failing tests**

```ts
it('says routing is not available when the engine speaks serve 1', async () => {
  expect(await call('route', { action: 'start' }, { serve: 1 })).toBe(ROUTING_UNAVAILABLE)
  for (const t of ['route_net', 'nudge', 'keep']) expect(await call(t, argsFor(t), { serve: 1 })).toBe(ROUTING_UNAVAILABLE)
})
it('starts a route, relays its progress, then builds once it is done', async () => {
  // FAKE_KERNEL_SERVE=2: progress().of === number of edge nets; after done, builds.latest().routing.state === 'current'
})
it('cancels a running route', async () => {})
it('a save after a route makes the copper stale and says why', async () => { /* FAKE_KERNEL_MOVE: routing.state 'stale', stale_because ['parts moved'] */ })
it('route_net answers the snippet to write into board.py', async () => {})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/routing.test.ts src/main/mcp/routeTools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the routing holder, the tools and the view states**

If `routing` has merged into `views`, also run the real engine's `route_status` once by hand on the reference fixture copy and compare its JSON keys with `RoutingState`; fix `shared/build.ts` if they differ.

- [ ] **Step 4: Run them**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "Routing in the views and route, route_net, nudge and keep for Claude, guarded until the engine routes"
```

---

### Task 17: The probe: logo, icon and the first screen

**Files:**
- Modify: `scripts/pino.svg`, `scripts/pino.png`, `app/src/renderer/ui/Logo.tsx`, `app/src/renderer/ui/Welcome.tsx`, `app/src/renderer/styles/welcome.css`, `app/src/renderer/ui/TitleBar.tsx`, `CLAUDE.md` (the placeholder line), `.claude/rules/first-screen.md`
- Create: `scripts/pino-16.svg`, `app/src/renderer/ui/probe.ts`
- Test: `app/src/renderer/ui/probe.test.ts`, `app/src/launcher.test.ts` (icon case)

**Interfaces:**
- Consumes: the shapes of `design/mockups/src/logo/b-probe.html` on branch `design-mocks` (`tile`, `icon16`, `part`, `scribe`, `dims`) and `lib/firstscreen.js` (the motion).
- Produces:
  - `probe.ts`: `TILE_SHAPES` (64-unit grid, from `tile`: the board `[6, 52, 52, 6, 1]` in the accent, the pad, barrel, collar, plunger and crown in ink), `ICON16_SHAPES` (from `icon16`, whole pixels), `SCRIBE_PATHS`, `DIMENSIONS` (`⌀1.02`, `1.5 travel`, `pad 1.6`), `PART_PATH`; `probeSvg(shapes, colours: { ink: string; accent: string; tile?: string }): string`.
  - `scripts/pino.svg`: the 64-unit tile (paper-grey tile, radius 14) in ink and accent; `scripts/pino-16.svg`: the 16 px drawing on whole pixels; `scripts/pino.png` redrawn at 512 px from `pino.svg` (`rsvg-convert -w 512 -h 512`).
  - `Logo.tsx`: `Logo({ size: 16 | 20 | 64, tone: 'ink' | 'on-dye' })`, the title bar's mark at 20 px from `ICON16_SHAPES` scaled on whole pixels.
  - First screen (mock `logo/b-probe.png`): the dyed field on the left with the scribed probe drawing in `--scribe` (strokes draw 1.6 s by `stroke-dashoffset`, dimensions fade in at 1.1 s, the board part's hatch fills at 1.4 s, once; reduced motion shows it drawn), the name in Instrument Sans 600 and the tagline in the Global Constraints; the right-hand panel as the shell has it, with the line about the engine removed and the readiness lines "Claude Code is ready", "KiCad 10.0.6 found, with its libraries", "pino's Python environment is ready" taken from `kernel version` through a new `build.engineInfo(): Promise<{ kicad: string | null; kernel: string | null; problem: string | null }>` (main runs the kernel's `version` once at start, under test the stand-in's).

- [ ] **Step 1: Write the failing tests**

```ts
it('draws the icon on whole pixels and the tile on the 64 grid', () => {
  for (const s of ICON16_SHAPES) for (const v of s.rect ?? []) expect(Number.isInteger(v)).toBe(true)
  for (const s of TILE_SHAPES) for (const v of (s.rect ?? []).slice(0, 4)) expect(v % 0.5).toBe(0)
})
it('ships the probe as the launcher's icon', () => {
  expect(read('scripts/pino.svg')).toContain('#17663A'); expect(existsSync('scripts/pino-16.svg')).toBe(true)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/ui/probe.test.ts src/launcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the shapes, the icons, the logo and the first screen**

`styles.test.ts` keeps holding that no animation is infinite.

- [ ] **Step 4: Run them**

Run: `pnpm -C app exec vitest run && pnpm -C app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts app/src CLAUDE.md .claude/rules/first-screen.md
git commit -m "The probe: logo, 16 px icon, and the scribed first screen"
```

---

### Task 18: End to end in hidden windows, and the screenshots for the design review

**Files:**
- Create: `app/e2e/views.spec.ts`, `app/e2e/real-kernel.spec.ts`, `app/e2e/shots.spec.ts`
- Modify: `app/e2e/launch.ts` (`kernel` option), `app/e2e/helpers.ts`, `app/src/e2e.test.ts`, `.claude/rules/e2e-hidden-window.md`, `.github/workflows/ci.yml` (nothing new to install: the stand-in kernel is node)
- Test: the three specs

**Interfaces:**
- Consumes: everything above; `window.__pinoTest.state()`, `screenOf`, `drawn()` (Tasks 6 to 12); `globalThis.__pinoMain`.
- Produces:
  - `launch(opts: { project?; agent?; env?; kernel?: 'fake' | 'real' })`: `fake` (the default) sets `PINO_KERNEL_CMD="node <abs>/app/test/fake-kernel.mjs"`; `real` leaves it unset so the app runs `uv run --directory <repo>/kernel pino-kernel serve`. `referenceProject(name = 'reference')`: a temp folder with a copy of `kernel/tests/fixtures/reference/` (board.py and outline.json).
  - `helpers.ts`: `waitForBuild(page, n: number)`, `clickTarget(page, t: Target)` (through `screenOf`), `drawStroke(page, from: Target, through: Array<{ dx: number; dy: number }>)` (mouse down, moves in 20 steps, up), `capture(app, file: string)` (main's `webContents.capturePage()` to PNG, never `page.screenshot()`).
  - `views.spec.ts` tests:
    1. `opens the reference board and the build lands`: `drawn().board.hash` is the build's, the route card head reads `On h1`, the Schematic tab has symbols, the 3D tab says `loaded`.
    2. `a click on a pad gives the exact reference`: Board tab, `clickTarget(page, { kind: 'pad', ref: 'U2', number: '1' })`, `state().selection.text` equals `describeTarget` computed in the spec from the fixture board and circuit with the shared code; the Schematic tab's label is `Schematic · U2.1`.
    3. `a stroke is sent with the prompt and Claude points back`: press `D`, `drawStroke` from U2.1 across the board; `state().marks` has `M1` stroke, draft, `crosses.nets` contains `VBUS`; the composer shows chip `M1`; send the prompt `tool mcp__pino__point {"targets":["U2"],"note":"this one"}` with the stand-in agent; the chat's context item for it has `marks: ['M1']` and its text contains `M1 ` plus M1's payload; M1 is `sent`; a mark `M2` by `agent` on `U2` is `sent` and `drawn().board.marks` contains `M2`.
    4. `a save rebuilds once and the moved part is highlighted`: `FAKE_KERNEL_MOVE=R4:1.5,0`, touch `board.py`; build 2 lands, `drawn().board.highlighted` contains `R4`.
    5. `a failing save keeps the drawing and says why`: `FAKE_KERNEL_FAIL_ON=2`; after the save the board still draws h1 and the band reads `Drawn from h1. h2 failed: invalid syntax, board.py line 12`.
    6. `a project in a folder with spaces and accents builds`: `referenceProject('my board ação')`.
    7. `the engine that will not start is said`: `FAKE_KERNEL_DIE=start`; the route card says `The engine did not start` and the app keeps its chat.
    8. `routing runs in the background and its copper goes stale after a move` (`FAKE_KERNEL_SERVE=2`): "Route again" starts it, the band counts nets, `drawn().board.route` is set when done, after a move `drawn().board.stale` is above 0.
  - `real-kernel.spec.ts`: `builds the reference board with the real engine` (skips with "needs uv and kicad-cli on PATH" otherwise): build lands with verdict not `failed`, the board draws, the pad click of test 2 gives its reference.
  - `shots.spec.ts`: skips unless `PINO_SHOTS` names a folder outside the repo; with reduced motion (`page.emulateMedia({ reducedMotion: 'reduce' })`) and `nativeTheme.themeSource` set from main, captures at 1440x900 and 1920x1080 (`win.setContentSize`): `first-light`, `first-dark`, `board`, `board-1920`, `board-dark`, `board-nets`, `board-bottom`, `board-routing`, `board-stale`, `marks` (the six marks of the mock's scene made on the reference board: a part, an arrow, a stroke, a region, a track, a pad), `marks-drawing` (mouse held mid-stroke), `marks-dense` (five chips within 3 mm), `sheet`, `sheet-dark`, `3d`, `3d-dark`.

- [ ] **Step 1: Write the specs**

- [ ] **Step 2: Build and run them, expecting failures only where the code is wrong**

Run: `pnpm -C app build && pnpm -C app exec playwright test e2e/views.spec.ts e2e/real-kernel.spec.ts`
Expected: views PASS (8 tests); real-kernel PASS here (uv and kicad-cli are installed), skipped in CI.

- [ ] **Step 3: Take the screenshots**

Run: `PINO_SHOTS=<scratch folder> pnpm -C app exec playwright test e2e/shots.spec.ts`
Expected: 16 PNGs in the folder; open each with the Read tool and compare with the mock it answers to (`board/a-drafting*.png`, `marks/a-pencil*.png`, `views/a-sheet*.png`, `logo/b-probe*.png`). Fix what differs in the task that owns it before going on, and list what remains for the design review.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm test && pnpm test:e2e && pnpm -C app typecheck && bash .claude/hooks/guard-bash.test.sh`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/e2e app/src/e2e.test.ts .claude/rules/e2e-hidden-window.md .github/workflows/ci.yml
git commit -m "End to end on the reference board: build, click, stroke, send, Claude points back; screenshots for the design review"
```

---

### Task 19: Rules, manifest, audit, the draft PR and the two reviews

**Files:**
- Create: `.claude/rules/views.md`, `.claude/rules/marks.md`, `.claude/rules/engine-client.md`
- Modify: `CLAUDE.md`, `README.md` (what the app now does), `shared-from-torno.json` (check every copy of this stage is listed), `docs/superpowers/plans/2026-11-26-pino-roadmap.md` (stages 5 and 6 state)
- Test: `app/src/rules.test.ts`, `app/src/manifest.test.ts`, `app/src/tornoSync.test.ts`

**Interfaces:**
- Consumes: the whole branch.
- Produces: rules with `paths:` frontmatter (`views.md`: `app/src/shared/board/**`, `app/src/renderer/board/**`, `sheet/**`, `three/**`; `marks.md`: `app/src/shared/marks.ts`, `app/src/main/marks/**`, `app/src/renderer/board/marks/**`; `engine-client.md`: `app/src/main/kernel/**`, `app/src/main/builds.ts`, `app/test/fake-kernel.mjs`), each stating the constraints of this plan that bind its files (frames, colours, motion, only writer, stand-in kernel in tests). `CLAUDE.md` loses "Stage 2 has no engine" and the placeholder-logo line, and names the new rules.

- [ ] **Step 1: Run the rule, manifest and drift tests**

Run: `pnpm -C app exec vitest run src/rules.test.ts src/manifest.test.ts src/tornoSync.test.ts && node scripts/torno-sync`
Expected: PASS, `0 drifted`.

- [ ] **Step 2: Run humanizer on README, the rules and the PR body; fix what it finds**

- [ ] **Step 3: Leak audit over every commit of the branch**

Search files and messages for personal names, home paths, hosts, e-mail addresses, tokens and other projects' data, as the shell plan's Task 16 did (`git log -p origin/main..HEAD`), the fixture's `result.json` and `.kicad_pcb` files included (they must hold no absolute path: `normalize.py` takes them out; check).

- [ ] **Step 4: Push and open the draft PR**

```bash
git push -u origin views
gh pr create --draft --base main --title "Stages 5 and 6: live views and marks" --body-file <scratch>/pr.md
```

The body says: it contains #1 and #2 until they merge; what it adds; the test results; the screenshots are attached to the design review, not committed. No Claude attribution.

- [ ] **Step 5: The two reviews**

One whole-branch code review (Opus, read only, the `reviewer` agent) and one design review (Opus) given the shots folder, the mock PNGs and the picks document, asked to compare each shot with its mock and list what differs, most visible first. Fix Critical and Important findings test first; note the rest in the PR.

- [ ] **Step 6: Commit the docs and fixes**

```bash
git add .claude CLAUDE.md README.md shared-from-torno.json docs/superpowers/plans/2026-11-26-pino-roadmap.md
git commit -m "Rules for the views, marks and engine client; roadmap: stages 5 and 6 built"
```

---

## Self-review

**Spec coverage.**
- 5.3 build loop in the app (fast build per save, verdict to the agent, "On hN"): Tasks 3, 9, 10. Spec step 5's "per-layer geometry for the 2D view" is replaced by parsing `.kicad_pcb` in TypeScript (spike recommendation 1); `sheet.json` added for the schematic hit layer (Task 1).
- 5.3 routing in the background, stale copper, keep a route: Task 16 (app side; the engine side is the routing plan).
- 5.4 Schematic (SVG plus hit layer from pino's model), Board (canvas, per layer, toggles, net colours, ratsnest, clickable), 3D (GLB, three.js), changes highlighted once: Tasks 5 to 8, `changedItems` in Task 4.
- 5.5 marks (lifecycle, colours, main the only writer, chips beside the message, the payload table, re-anchoring, stale shown where it was): Tasks 11 to 13.
- 5.6 tools: `look`, `measure`, `check`, `diff`, `nets` and `trace`, `ratsnest`, `route` (start, status, cancel), `point`: Tasks 14 to 16; `marks` and `resolve_mark` added for the lifecycle's "resolved". `parts` is out of scope (stage 8).
- 5.8 agent rules: the system prompt in Task 10.
- 5.9 look: tokens and palettes in Global Constraints, Tasks 5, 17; logo and first screen Task 17; the design bar's screenshots and Opus design review: Tasks 18, 19.
- Section 2 anti-goals: copper readable (drafting graphite, contrast test), pointing not prose (marks), cost in tests (turncost, caps), focus never stolen (hidden e2e).
- Section 3: writes only under `.pino/` (marks file through `ownFolder`), the real `claude` never run, no window.

**Left out on purpose:** the route card's "Needs you" block of the mock (it is Claude's question, from the chat, not the build), "Fab files..." in the status line (stage 8), parts lookup (stage 8), the mirrored bottom view, KiCad's stroke font for copper text, `remove_unused_layers` (spike item 10), the GPU-less bitmap cache while dragging (spike item 11), and turning the spike's `compare.mjs` into a CI test (spike item 12): each is a follow-up issue, named in the PR.

**Type consistency.** `Target`, `describeTarget`, `shortLabel`, `crossings` (Task 4) are the names Tasks 6, 7, 11, 12, 14 and 15 use; `BuildState`, `BuildResult`, `RoutingState`, `RouteProgress` (Task 2) are the names of Tasks 3, 9, 10 and 16; `Mark`, `NewMark`, `MarkPatch`, `markPayload`, `markLabel` (Task 11) those of Tasks 10, 12, 13 and 15; `ViewTab`, `Selection`, `BoardLook`, `LookRequest`, `LookResult` live in `shared/view.ts` (Tasks 6 and 14).

## Director's calls (2026-11-26, Luis asleep, recommendations taken)

- Task 1 does not bump `__version__`; `sheet.json` and the `diff` serve op are additive. The routing branch owns the next version bump, so the two never clash.
- The `SessionDomain.promptContext` change (sent mark ids) stays: small, tested, and the seam was made for this.
- Left for later and listed for Luis: the "Needs you" block, net colours on by default, a verb per region, the mirrored bottom view.
- Built by one Sonnet worker (high effort) to spare the weekly budget; the closing code review and design review are Opus.
