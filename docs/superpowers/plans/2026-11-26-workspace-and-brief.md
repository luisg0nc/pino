# pino: a workspace of boards, a New project page and a Brief that lives on, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pino opens a workspace folder of boards (first run suggests `~/boards`), with torno's title bar (a workspace crumb and a project crumb), a page of projects with thumbnails, a Brief tab first among the views (the person's `brief.md` and Claude's cards on a spine of the prompts that wrote them), and a New project page of PCB slots whose Start makes the folder whole and sends a first prompt that settles what is missing before `board.py`.

**Architecture:** Main gains a holder of the open workspace and its one open project (`main/opened.ts`), the workspace scanner copied from torno, a cards store in `<project>/.pino/brief/` copied from torno's board store with PCB card kinds, two MCP tools (`brief`, `add_card`), and torno's `objects/create.ts` and `onboard.ts` as `projects/create.ts` and `onboard.ts`. The window gains the crumbs and menus, the page of projects, the Brief tab (torno #347's two voices) and the New project page (torno's page of slots, `New A`), all drawing what main says; main is the only writer of every file. torno's code comes from GitHub main at one commit, copied first and adapted second, each copy listed in `shared-from-torno.json`.

**Tech Stack:** Electron, React 19, zustand, zod, chokidar (all there already), vitest and Playwright as in the shell and views plans. No kernel change: the parts lookup is the engine's `parts` job (`get`).

**Spec:** `docs/superpowers/specs/2026-11-26-workspace-and-brief-design.md` (read all of it; "Decided by Luis" and "My calls" are settled). Also read `CLAUDE.md`, the rules named in each task, `shared-from-torno.json`, and the shell, views and fab plans in this folder, whose names this plan uses.

**Where to work:** branch `workspace-brief`, cut from `main` after PR #8 (`fix/menus-parts-resize`), the routed-3D PR (`fix/routed-3d`) and the silk-labels PR (`feat/silk-labels`) have merged, in a worktree at `.worktrees/workspace-brief`. One PR to `main` after the leak audit; one whole-branch review (Opus) at the end. The director merges once CI is green and the review found nothing blocking (Luis, 2026-11-26).

**Reference code, read only:** torno at GitHub main `8086e7cac36981150e41ffd342160f749a712c07` (Version 0.2.3, #326 and #347 merged). Read a file with `gh api "repos/luisg0nc/torno/contents/<path>?ref=8086e7ca" --jq .content | base64 -d`, list with `gh api "repos/luisg0nc/torno/git/trees/8086e7ca?recursive=1"`. The local checkout `~/projects/torno` is at #325 but holds the commit object, so `scripts/torno-sync` (which only runs `git show <commit>:<path>` there) can read it. Never change torno's git state, never install or run anything there. Also read torno's `docs/superpowers/specs/2026-11-16-new-project-board-design.md`, `docs/superpowers/plans/2026-11-26-brief-two-voices.md`, `.claude/rules/new-object-onboard.md` and the bodies of torno PRs #326 and #347 (`gh pr view <n> -R luisg0nc/torno`).

**Builds on, and touches the same files as:**
- PR #8: `Fab` gets the engine through `lookupEngine()` (a parts lookup needs no build); `index.ts`, `App.tsx` (the dock's resize handle), `mcp/tools.ts` (`project` gives the default fab), `fab.ts`, `shared/fab.ts`, `styles/viewbars.css` (torno's `.menu` rules) and `titlebar.css`. Tasks 2, 6 and 7 build on those versions; rebase, never revert them.
- Routed 3D: `shared/bridge.ts` (`routeFile` gains `glb`), `state/viewModel.ts`, `three/*`. Task 2 and Task 7 edit `bridge.ts` and `ViewPane.tsx` beside it.
- Silk labels: `main/prompt.ts` gains one line and `turncost.test.ts` one case. Task 6 adds its line after that one and keeps the case.

## Global Constraints

- Copy now, extract later: every file taken from torno is read from `8086e7ca` with `gh api`, written to disk first as torno has it, then adapted; never retyped. torno is only ever read.
- `shared-from-torno.json` lists each copy with the full commit `8086e7cac36981150e41ffd342160f749a712c07`, `as-is` or `adapted` with a one-line `change`. A copy keeps torno's path (with `torno` in a file name read as `pino`) unless a pino rule renames it; then the entry carries `moved` with the rule, in one line (Task 3 adds this to `manifest.test.ts`). The renames are only these: `object` becomes `project` (`objects/` is `projects/`, `NewObject.tsx` is `NewProject.tsx`, `objectName.ts` is `projectName.ts`), torno's board of cards becomes `cards` (`shared/board.ts` is `shared/cards.ts`, `main/board/` is `main/cards/`, `state/board.ts` is `state/cards.ts`, `mcp/boardTools.ts` is `mcp/cardTools.ts`), and torno's `show/cards.ts` thumbnails are `main/thumb.ts`.
- An entry already in the manifest (copied at `597befd`) that gains code from `8086e7ca` keeps its commit and mode `adapted`, and its `change` ends with `; <what> from 8086e7ca`.
- One app prefix from `app/src/shared/app.ts`. Code says "project", never "object" (`names.test.ts`). In pino "board" means the printed circuit board: the cards' code, channels and tools say `cards` or `brief`, never `board`.
- Workspace writes, the new exception (`CLAUDE.md` and `.claude/rules/workspace-writes.md` say it in Task 9's commit): making a new project writes ONE new folder `<workspace>/<name>/` with `brief.md`, `reference/` (photos, doodles, PDFs) and `.pino/brief/cards.json`, made in a hidden `.<name>.pino-new-<12 hex>` beside it and renamed into place last, so it is whole or not there. Nothing is written in the workspace before Start or "Make it without starting Claude". Main never writes `brief.md` after that.
- `<project>/.pino/brief/` holds `cards.json` (main its only writer, ids `C<n>` main's and never reused, goes into git), `seen.json` and `told.json` (ignored: `ensureIgnored(dir, ['brief/seen.json', 'brief/told.json'])`). `.pino/thumb.png` and `.pino/thumb.json` are ignored too. Every write goes through `ownFolder(dir, 'brief')` or `writeOwn` and `writeFileAtomic`.
- Claude never writes `brief.md` (`refusalOf` denies `Write`, `Edit`, `MultiEdit`, `NotebookEdit` of it) and never changes or removes a person's card. A part card's reading (class, package, stock, price, date) is main's, from the engine's lookup, never Claude's or the window's.
- `turncost.test.ts` keeps its numbers: up-front tools under 33,000 characters, each description over 20 and under 700 characters, system prompt plus `SERVER_INSTRUCTIONS` under 12,000. The tool count goes from 16 to 18 (`brief` and `add_card`, both up front). The system prompt gains exactly one line about the Brief.
- Tests: every Electron launch through `e2e/launch.ts` (hidden window, `PINO_TEST=1`, own HOME and config, `PINO_PARTS_OFFLINE=1`), the stand-in agent (`agent: true`) and the stand-in engine; stock comes from the stand-in's canned parts (`FAKE_KERNEL_SERVE: '3'`, `C25804`, `C51118`) or, in `real-kernel.spec.ts` only, from `PINO_PARTS_RECORDED=<repo>/kernel/tests/fixtures/parts/jlcsearch`. Dialogs answer through `globalThis.__pinoMain` (`pickFolder`, `pickFiles`). Never `page.screenshot()`, never the clipboard, never the person's home.
- English only, sentence case UI text, no em dashes in docs, UI copy or prompts. pnpm. No new runtime dependency.
- Commits: plain messages, no Co-Authored-By trailer, no "Generated with" footer. Run `pnpm test`, `pnpm -C app typecheck`, `bash .claude/hooks/guard-bash.test.sh` and `pnpm test:e2e` before each commit (the kernel is not touched).

## Review Focus

1. **A `cards.json` that does not parse**, because a git merge left conflict markers in it or a newer pino wrote a kind this one lacks: the file is copied aside as `cards.json.corrupt-<stamp>` (or `cards.json.dropped-<stamp>` when only some cards were left out), a new file starts with `next` above every `C<n>` found in the old text, the window is told once, and no id is ever given twice. Test: `keeps a merge-conflicted file aside and never reuses its ids` (Task 4).
2. **Start pressed twice, or a name another folder has in another case** (`Blinky` beside `blinky`), or a `.blinky.pino-new-…` left by a crash: one folder or none, never half of one, and the refusal says why in plain words. Tests: `refuses a name another folder has in any case`, `a second Start for the same name is refused and leaves the first whole` (Task 9).
3. **jlcsearch cannot be reached while the person types a part, and they press Start anyway:** the row says the stock was not checked and why, Start is not held back, the part card is made with no reading, and "Check stock again" on the Brief fills it later without making it "new since you looked". Tests: `a part typed while jlcsearch cannot be reached says so and does not hold Start` (Task 11), `Check stock again fills the reading and is not new since you looked` (Task 8).
4. **`brief.md` changed in another editor while the Brief is on screen:** "In your words" shows the new text within a second without leaving the tab; a `brief.md` that is removed shows the empty state, not a blank sheet. Test: `follows brief.md changed and removed from outside` (Task 7).
5. **A project folder directly in the home folder** (`~/blinky`, remembered from before workspaces, or given to the launcher): the home folder (or `/`) is never made a workspace and never listed; pino starts on the first screen and says why. Tests: `never makes the home or the root a workspace` (Task 1), `a project in the home folder opens the first screen and says why` (Task 2).

---

## File structure

```
CLAUDE.md                                      modify: copies may be moved; the write exception; rules by area
shared-from-torno.json                         modify: every copy below
.claude/rules/first-screen.md                  modify: the workspace, the crumbs, the page of projects
.claude/rules/workspace-writes.md              modify: the new-project exception, .pino/brief/, thumb.png
.claude/rules/views.md                         modify: the Brief tab first
.claude/rules/engine-client.md                 modify: eighteen tools
.claude/rules/brief.md                         new: the cards store, the Brief page, the card tools
.claude/rules/new-project.md                   moved from torno .claude/rules/new-object-onboard.md
scripts/pino                                   modify: a folder names a workspace or a project (help text)
app/e2e/launch.ts                              modify: tempProject writes brief.md; pickFiles
app/e2e/workspace.spec.ts                      new
app/e2e/brief.spec.ts                          new
app/e2e/onboard.spec.ts                        new
app/e2e/{boot,welcome,chat,real-kernel}.spec.ts  modify
app/src/manifest.test.ts                       modify: moved
app/src/shared/
  workspace.ts                                 copy: WorkspaceInfo, ListedProject
  cards.ts                                     moved copy of shared/board.ts: Card, CardsFile, kinds, readings
  size.ts                                      copy as-is
  brief.ts                                     copy: briefSpine, handOf, seenHash, briefWords, ...
  slots.ts                                     new: the PCB slots' rows, caps, checks and words
  projectName.ts                               moved copy of shared/objectName.ts
  view.ts  bridge.ts  chat.ts  keys.ts         modify
app/src/main/
  workspace.ts                                 copy: scanWorkspace, scanOrder
  opened.ts                                    new: the open workspace and its one open project
  recent.ts  project.ts  index.ts  ipc.ts  domain.ts  prompt.ts  fab.ts  view.ts   modify
  thumb.ts                                     moved copy of show/cards.ts (thumbnails only)
  images.ts                                    copy: checkedImage
  onboard.ts                                   copy: onboardPrompt, previewPrompt, onboardProject
  cards/file.ts  cards/store.ts  cards/text.ts  cards/start.ts  cards/watch.ts   moved copies of main/board/*
  projects/create.ts  projects/offered.ts      moved copies of main/objects/*
  projects/readings.ts                         new: the stock readings main gave this run
  sessions/prompts.ts                          copy: listPrompts
  sessions/chatlog.ts  sessions/manager.ts  sessions/reach.ts   modify
  mcp/cardTools.ts                             moved copy of mcp/boardTools.ts: brief, add_card
  mcp/tools.ts  mcp/schemas.ts                 modify
app/src/renderer/
  App.tsx  state/store.ts  ui/TitleBar.tsx  ui/FolderMenu.tsx  ui/Welcome.tsx  ui/ViewPane.tsx  ui/RouteCard.tsx   modify
  ui/ProjectsPage.tsx                          new
  ui/Confirm.tsx                               copy
  ui/strip/thumbs.ts  state/keepThumb.ts       modify, new
  state/cards.ts                               moved copy of state/board.ts
  ui/brief/{BriefPage,BriefWords,Rows,Spine,SizeForm,TextForm,PictureView}.tsx  ops.ts  refPieces.ts   copies
  ui/chat/usePrompts.ts                        copy
  state/onboard.ts                             copy
  ui/onboard/{NewProject,DraftPane,Slot,SizesSlot,LinksSlot,RulesSlot,ReferenceItems,Doodle,SessionChoice}.tsx   copies
  ui/onboard/{images,attach,make,liveDeps}.ts  copies
  ui/onboard/{PowerSlot,ConnectionsSlot,PartsSlot,FabSlot}.tsx   new
  ui/ink/InkPad.tsx  ui/ink/strokes.ts         copies
  styles/brief.css  styles/onboard.css         copies; styles/projects.css new
```

## Changes to existing interfaces

- Task 1: `Config` becomes `{ workspace?: string; project?: string; workspaces: string[] }`; `configOf(value, home)` takes the home folder.
- Task 2: the `project:pick`, `project:open(dir)`, `project:current`, `project:recent`, `project:close` channels become `workspace:*` and `project:open(name)` / `project:close`; `Projects` in `ipc.ts` becomes `Opened` from `opened.ts`; `PinoBridge.project` changes shape and gains `workspace`. `e2e/launch.ts` `tempProject()` writes `brief.md`, so a temp project is a project by the launcher's rule.
- Task 5: `Sessions` gains `turnNow(projectId)` and `sendBlocks(sessionId, blocks)`.
- Task 6: `ToolDeps` gains `cards`, `turnNow`, `prompts`; `Fab` gains `lookup(q)`; `DomainDeps` gains `cards`; tools go from 16 to 18.
- Task 7: `ViewTab` stays the three views; the window's tab is `PaneTab = 'brief' | ViewTab`; `view:tell` and `ViewHolder` accept `'brief'`.

---

### Task 1: The workspace listing and the config's workspaces

**Files:**
- Create: `app/src/main/workspace.ts`, `app/src/main/workspace.test.ts`, `app/src/shared/workspace.ts`
- Modify: `app/src/main/recent.ts`, `app/src/main/recent.test.ts`, `app/src/main/project.ts`, `app/src/main/project.test.ts`, `shared-from-torno.json`
- Copies (from `8086e7ca`): `app/src/main/workspace.ts` adapted ("a project is any direct subfolder that is not hidden and not a link; board, brief and empty from its files; no models, no common/ or pyproject"), `app/src/main/workspace.test.ts` adapted ("pino's listing rules"), `app/src/shared/workspace.ts` adapted ("ListedProject and WorkspaceInfo for boards; RecentFolder stays in shared/project.ts; no example").

**Interfaces:**
- Produces:
  - `shared/workspace.ts`: `ListedProject { name: string; dir: string; board: boolean; brief: boolean; empty: boolean }` (`empty` when neither `board.py` nor `brief.md` is a plain file there); `WorkspaceInfo { root: string; name: string; projects: ListedProject[] }`, projects sorted by name with `localeCompare(b, 'en')`.
  - `main/workspace.ts`: `scanWorkspace(root: string): Promise<WorkspaceInfo>`; `scanOrder(): () => () => boolean` (torno's, unchanged); `TEMP_NEW = /^\..+\.pino-new-[0-9a-f]{12}$/` (never listed; hidden anyway).
  - `main/project.ts`: `isProjectFolder(dir: string): Promise<boolean>` (`board.py` or `brief.md` there as a plain file); `workspaceOf(projectDir: string, home: string): string | null` (the parent, or null when the parent is `/` or `home`).
  - `main/recent.ts`: `Config { workspace?: string; project?: string; workspaces: string[] }`; `MAX_RECENT = 8`; `recentWith`, `recentWithout` unchanged; `configOf(value: unknown, home: string): Config`; `listed(recent: readonly string[]): Promise<RecentFolder[]>` unchanged.

- [x] **Step 1: Copy torno's two workspace files and their test, then write the failing tests**

```ts
// main/workspace.test.ts
it('lists real subfolders only: hidden ones, files, links and pino-new folders are left out', async () => {
  const root = temp() // a, empty, .hidden, .a.pino-new-0123456789ab, notes.txt, link -> elsewhere/x
  mkdirSync(join(root, 'a')); writeFileSync(join(root, 'a', 'board.py'), '')
  mkdirSync(join(root, 'b')); writeFileSync(join(root, 'b', 'brief.md'), '# b\n')
  mkdirSync(join(root, 'empty')); mkdirSync(join(root, '.hidden')); mkdirSync(join(root, '.a.pino-new-0123456789ab'))
  writeFileSync(join(root, 'notes.txt'), ''); symlinkSync(temp(), join(root, 'link'))
  const ws = await scanWorkspace(root)
  expect(ws.projects.map((p) => [p.name, p.board, p.brief, p.empty])).toEqual([['a', true, false, false], ['b', false, true, false], ['empty', false, false, true]])
  expect(ws.name).toBe(basename(root))
})
it('lists a folder named with spaces and non-ASCII letters', async () => { /* 'placa ação' listed by that name, dir joined */ })
it('a board.py that is a folder or a link out does not make a board', async () => { /* board false, empty true */ })

// main/recent.test.ts
it('turns the recent project folders into recent workspaces, once', () => {
  expect(configOf({ project: '/w/a', recent: ['/w/a', '/w/b', '/x/c'] }, '/h')).toEqual({ workspace: '/w', project: '/w/a', workspaces: ['/w', '/x'] })
  expect(configOf({ workspace: '/w', project: '/w/a', workspaces: [] , recent: ['/x/c'] }, '/h')).toEqual({ workspace: '/w', project: '/w/a', workspaces: [] })
})
it('never makes the home or the root a workspace', () => {
  expect(configOf({ project: '/h/blinky', recent: ['/h/blinky', '/top'] }, '/h')).toEqual({ project: '/h/blinky', workspaces: [] })
  expect(workspaceOf('/h/blinky', '/h')).toBeNull()
  expect(workspaceOf('/top', '/h')).toBeNull()
  expect(workspaceOf('/h/boards/blinky', '/h')).toBe('/h/boards')
})
it('keeps whole paths only, once each, eight at most', () => { /* relative paths dropped, duplicates, 10 -> 8 */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/workspace.test.ts src/main/recent.test.ts src/main/project.test.ts`
Expected: FAIL (`scanWorkspace` lists by model files; `configOf` has no `workspaces`; `workspaceOf` not defined)

- [x] **Step 3: Adapt `scanWorkspace`, write `isProjectFolder`, `workspaceOf` and the new `configOf`**

`scanWorkspace` keeps torno's `readdir(root, { withFileTypes: true })` and sort, and reads `board.py` and `brief.md` with `lstat` (a link is not a plain file). The migration in `configOf` runs only when `workspaces` is not an array: then `workspaces` is the parents of `recent` by `workspaceOf`, newest first, once each, and `workspace` the parent of `project`; the next `changeConfig` writes the new shape, so it never runs again. Add the three entries to `shared-from-torno.json`.

- [x] **Step 4: Run them to verify they pass**

Run: `pnpm -C app exec vitest run src/main/workspace.test.ts src/main/recent.test.ts src/main/project.test.ts src/manifest.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add app/src/main/workspace.ts app/src/main/workspace.test.ts app/src/shared/workspace.ts app/src/main/recent.ts app/src/main/recent.test.ts app/src/main/project.ts app/src/main/project.test.ts shared-from-torno.json
git commit -m "A workspace lists its boards; recent folders become recent workspaces"
```

---

### Task 2: A workspace in main and in the window: the holder, the first screen, the crumbs, the page of projects

**Files:**
- Create: `app/src/main/opened.ts`, `app/src/main/opened.test.ts`, `app/src/renderer/ui/ProjectsPage.tsx`, `app/src/renderer/styles/projects.css`, `app/e2e/workspace.spec.ts`
- Modify: `app/src/main/index.ts` (the inline `projectHolder` goes to `opened.ts`), `app/src/main/ipc.ts`, `app/src/preload/index.ts`, `app/src/shared/bridge.ts`, `app/src/renderer/App.tsx`, `app/src/renderer/state/store.ts`, `app/src/renderer/ui/Welcome.tsx`, `app/src/renderer/ui/TitleBar.tsx`, `app/src/renderer/ui/FolderMenu.tsx`, `app/src/renderer/styles/titlebar.css`, `app/src/renderer/styles/welcome.css`, `scripts/pino` (usage words only), `app/e2e/launch.ts`, `app/e2e/boot.spec.ts`, `app/e2e/welcome.spec.ts`, `app/e2e/chat.spec.ts`, `.claude/rules/first-screen.md`, `shared-from-torno.json`
- Copies: `app/src/renderer/ui/TitleBar.tsx` adapted ("the workspace crumb and the project crumb with its menu; no session signs, no dock toggle, no page key"), `app/src/renderer/ui/FolderMenu.tsx` adapted ("the recent workspaces and Open workspace…; RecentFolder from shared/project"). pino's own `TitleBar.tsx` and `FolderMenu.tsx` are replaced by the copies.

**Interfaces:**
- Consumes: Task 1's `scanWorkspace`, `isProjectFolder`, `workspaceOf`, `Config`, `configOf`, `recentWith`, `listed`; `openProject(dir)` of `project.ts`.
- Produces:
  - `main/opened.ts`:
    ```ts
    export interface OpenedDeps {
      home: string
      readConfig(): Promise<Config>
      changeConfig(change: (c: Config) => Config): Promise<void>
      /** The folder dialog, or the test hook's answer. */
      pickFolder(): Promise<string | null>
      /** Ends the open project's session (and one starting): `Sessions.stopAll`. */
      stopAll(): Promise<void>
      /** The project is no longer open: routing, fab and the build loop let it go. */
      closed(project: ProjectInfo): void
      opened(project: ProjectInfo): void
      /** Called with every workspace opened, before it is listed (Task 9 sweeps there). */
      sweep?(root: string): void
    }
    export interface Opened {
      workspace(): WorkspaceInfo | undefined
      project(): ProjectInfo | undefined
      /** What is open; rejects once with why the folder pino was started with could not be. */
      current(): Promise<{ workspace: WorkspaceInfo | null; project: ProjectInfo | null }>
      openWorkspace(root: string): Promise<WorkspaceInfo>
      pickWorkspace(): Promise<WorkspaceInfo | null>
      suggested(): Promise<{ path: string; exists: boolean }>
      useSuggested(): Promise<WorkspaceInfo>
      recent(): Promise<RecentFolder[]>
      /** The open workspace listed again. */
      list(): Promise<WorkspaceInfo>
      /** A project of the open workspace, by the name the listing gave it. */
      openProject(name: string): Promise<ProjectInfo>
      /** Ends the project's session and leaves it: the page of projects. */
      closeProject(): Promise<void>
      startAt(dir: string, said: boolean): Promise<void>
    }
    export const SUGGESTED = 'boards'
    export function openedHolder(deps: OpenedDeps): Opened
    ```
  - IPC (`ipc.ts` header list updated): invoked `workspace:current`, `workspace:pick`, `workspace:open(root)`, `workspace:suggested`, `workspace:useSuggested`, `workspace:recent`, `workspace:list`, `project:open(name)`, `project:close`. Gone: `project:pick`, `project:current`, `project:recent`, `project:open(dir)`.
  - `PinoBridge.workspace { current(); pick(); open(root); suggested(); useSuggested(); recent(); list() }` and `PinoBridge.project { open(name: string): Promise<ProjectInfo>; close(): Promise<void> }` with the types above.
  - `state/store.ts`: `page: 'first' | 'projects' | 'project'` (Task 10 adds `'new'`), `workspace: WorkspaceInfo | null`; actions `openWorkspace(ws)`, `setWorkspace(ws)`, `closeWorkspace()`; `recent` holds recent workspaces.
  - Selectors: crumbs `button[name="Workspace <name>"]` (menu `Workspaces`) and `button[name="Project <name>"]` (menu `Projects`); the page `main[aria-label="All projects"]`, each project a `button` named by the project's name in `role="list"` `Projects in <workspace>`.

- [x] **Step 1: Write the failing unit tests**

```ts
// main/opened.test.ts: real temp folders, a fake config and session stop counter
it('opens the parent of a project folder on that project, and a workspace folder on its page', async () => {
  const root = temp(); project(root, 'blinky', 'board.py')
  const o = holder()
  await o.startAt(join(root, 'blinky'), true)
  expect([o.workspace()?.root, o.project()?.name]).toEqual([root, 'blinky'])
  await o.startAt(root, true)
  expect([o.workspace()?.root, o.project()]).toEqual([root, undefined])
})
it('remembers the workspace and the project, and another workspace ends the project first', async () => {
  // open a/blinky, then workspace b: stopAll called once, closed(blinky) once, config { workspace: b, workspaces: [b, a] } with no project
})
it('opens only a project the workspace lists', async () => {
  await expect(o.openProject('../x')).rejects.toThrow('There is no project ../x in boards.')
  await expect(o.openProject('.hidden')).rejects.toThrow('There is no project .hidden in boards.')
})
it('useSuggested makes ~/boards when it is not there, and opens it; a link in its place is refused', async () => {
  expect(await o.suggested()).toEqual({ path: join(home, 'boards'), exists: false })
  expect((await o.useSuggested()).root).toBe(join(home, 'boards'))
  // with ~/boards a link: rejects with 'boards in your home folder is a link: choose a folder instead.'
})
it('a project in the home folder opens the first screen and says why', async () => {
  project(home, 'blinky', 'board.py')
  await o.startAt(join(home, 'blinky'), false)
  expect(o.workspace()).toBeUndefined()
  await expect(o.current()).rejects.toThrow('blinky is in your home folder, not in a folder of boards. Choose a folder for your boards, such as ~/boards, and move blinky into it.')
})
it('closeProject ends the session and keeps the workspace', async () => { /* stopAll once; workspace kept; config project removed */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/opened.test.ts`
Expected: FAIL with "Cannot find module './opened'"

- [x] **Step 3: Write `openedHolder`, wire it in `index.ts` and `ipc.ts`, change the bridge and preload**

Move the body of `index.ts`'s `projectHolder` (its one-change-at-a-time `inTurn`, the start problem said once, the order "look at the folder first, then close the old one") into `openedHolder`; `index.ts` passes the config functions, `routing.drop`, `fab.drop`, `builds.close`, `builds.open` and the dialog (`title: 'Choose a folder for your boards'`, `properties: ['openDirectory', 'createDirectory']`, `defaultPath` the suggested folder; under test `testHooks.pickFolder`). `useSuggested` makes the folder with `mkdir` (not recursive), refusing one that `lstat` says is a link or a file. The second-instance handler opens what it is handed by the same `startAt` rule when no project is open. `scripts/pino` usage: `folder  a folder of boards, or one board in it, to open (default: what was open last)`.

- [x] **Step 4: Write the window: first screen, crumbs and menus, the page of projects**

- `Welcome.tsx`, first run: title `Choose a folder for your boards`, lead `Each board is a folder in it. Nothing is written there until you start a board.`, buttons `Use ~/boards` (primary; `Open ~/boards` when it exists; the path from `workspace:suggested`, `~` for the home) and `Choose folder…`. Coming back: the navigation `Recent workspaces` stands where the lead does. The ready lines and the `role="alert"` problem stay. Foot: `pino writes only into a .pino folder inside each board, and makes a board's folder when you start one.`
- `TitleBar.tsx`: logo, workspace crumb, then on a project the project crumb, then the window controls. The workspace menu: `Recent workspaces` (the open one marked `current`, a gone one struck `Not found`), rule, `Open workspace…`. The project menu: `New project…` (disabled until Task 10), `All projects`, rule, each project of the listing (the open one marked `current`, an empty one marked `empty`). Both lists are read when the menu opens (`workspace:list`, `workspace:recent`).
- `ProjectsPage.tsx` (pino's own, written after torno's `ShowPage.tsx` without its bench, shelves, git or session signs): `main` labelled `All projects`, heading the workspace's name, a `New project` card first (disabled until Task 10) and a card per project with its name and `No board yet` (a `brief.md` alone) or `Empty`; arrows move between cards, Enter opens, typing filters by name (`role="searchbox"` `Filter projects`), Escape clears the filter. An empty workspace says `No boards here yet.` The ready lines that are not ok stand at its foot (`shared/ready.ts`). Reads the listing again on window focus.
- `App.tsx`: `page` `first` (no workspace), `projects` (a workspace, no project), `project`. `All projects` calls `project:close`.

- [x] **Step 5: Write the failing e2e spec, and change the specs that opened a folder**

`launch.ts`: `tempProject(name)` also writes `brief.md` (`# <name>\n`), so `PINO_PROJECT` names a project; add `pickFiles` to the hooks list in its comment. `boot.spec.ts`: the empty-views case first presses the `Schematic` tab (Task 7 makes the Brief the first tab: write the click now, it is harmless before); "Close project" becomes "All projects ends the project and shows the page". `chat.spec.ts`: `brief.md: absent.` becomes `brief.md: present.`; "closing the project in the middle of a turn" uses `All projects`. `welcome.spec.ts`: Open folder becomes Choose folder; Recent folders becomes Recent workspaces.

```ts
// e2e/workspace.spec.ts
test("first run offers ~/boards, makes it in the run's home and opens its page", async () => {
  const { app, page } = await launch()
  await expect(page.getByRole('heading', { name: 'Choose a folder for your boards' })).toBeVisible()
  await page.getByRole('button', { name: 'Use ~/boards' }).click()
  await expect(page.getByRole('main', { name: 'All projects' })).toContainText('No boards here yet.')
  const home = await app.evaluate(() => process.env.HOME!)
  expect(statSync(join(home, 'boards')).isDirectory()).toBe(true)
})
test('the page lists the boards; Enter opens one; the crumbs name both', async () => {
  // workspace with a (board.py), b (brief.md), empty: cards ['New project', 'a', 'b', 'empty'], b says 'No board yet', empty says 'Empty'
  // focus a, press Enter: Workspace <name> and Project a buttons visible, state().page === 'project'
})
test('the project menu lists every board with the open one current, and switches', async () => { /* menu items ['New project…', 'All projects', 'a', 'b', 'empty'] */ })
test('the workspace menu lists the recent workspaces and opens another', async () => { /* config with two workspaces; pickFolder for Open workspace…; a gone one 'Not found' and disabled */ })
test('a launcher folder that is a project opens its parent on it, and starts there again next time', async () => { /* launch({ project: tempProject('blinky') }) then relaunch with the same config and no project */ })
test('All projects in the middle of a turn ends the session and shows the page', async () => { /* agent: true; slow 30; agentsIn(dir) [] within 10 s; the page visible */ })
```

- [x] **Step 6: Run the unit tests and the e2e suite**

Run: `pnpm test && pnpm -C app typecheck && pnpm test:e2e`
Expected: PASS, with `workspace.spec.ts` in the list

- [x] **Step 7: Update `first-screen.md` (paths: `main/opened.ts`, `main/workspace.ts`, `ui/ProjectsPage.tsx`, `styles/projects.css`, `e2e/workspace.spec.ts`; the rules above) and the manifest, and commit**

```bash
git add -A app/src app/e2e scripts/pino shared-from-torno.json .claude/rules/first-screen.md
git commit -m "Open a workspace of boards: first screen, workspace and project crumbs, the page of projects"
```

---

### Task 3: Thumbnails on the page of projects, and copies that move

**Files:**
- Create: `app/src/main/thumb.ts`, `app/src/main/thumb.test.ts`, `app/src/renderer/state/keepThumb.ts`
- Modify: `app/src/manifest.test.ts`, `CLAUDE.md` (the copy invariant), `app/src/renderer/ui/strip/thumbs.ts`, `app/src/renderer/ui/ProjectsPage.tsx`, `app/src/renderer/App.tsx`, `app/src/main/ipc.ts`, `app/src/preload/index.ts`, `app/src/shared/bridge.ts`, `app/e2e/workspace.spec.ts`, `.claude/rules/workspace-writes.md` (thumb lines), `shared-from-torno.json`
- Copies: `app/src/main/show/cards.ts` to `app/src/main/thumb.ts`, adapted ("thumbnailRefusal, saveThumbnail and thumbnailOnFile only; of a build by its hash, no model, box or sources"), `moved: "torno's show/cards.ts is the page's cards; in pino cards are the Brief's"`.

**Interfaces:**
- Produces:
  - `manifest.test.ts`: `Entry` gains `moved?: string`; the path rule reads: an entry without `moved` has `pino === torno.replace(/torno(?=[^/]*$)/g, 'pino')`; one with `moved` has a non-empty one-line `moved` and `pino !== torno`.
  - `main/thumb.ts`: `THUMB_PNG = 'thumb.png'`, `THUMB_JSON = 'thumb.json'`, `THUMB_MAX_BYTES = 512 * 1024`; `thumbnailRefusal(png: Uint8Array): string | null`; `saveThumbnail(dir: string, png: Uint8Array, of: { hash: string }, now: Date): Promise<void>` (`writeOwn` both files, `ensureIgnored(dir, ['thumb.png', 'thumb.json'])`); `thumbnailOnFile(dir: string): Promise<Uint8Array | null>` (a plain file through no link, at most `THUMB_MAX_BYTES`).
  - IPC `project:thumb(name) -> Uint8Array | null` (a project of the open workspace), `project:saveThumb(projectId, hash, png) -> void` (only the open project, only a `BUILD_HASH` that is `builds.lastGood(id).hash`).
  - `ui/strip/thumbs.ts`: `boardPicture(model: ViewModel, size: { w: number; h: number }, dark: boolean): string` (the drawing `draw` makes, of any size); `PAGE_THUMB = { w: 240, h: 160 }`.
  - `state/keepThumb.ts`: `useKeepThumb(): void`, used once in `App.tsx`: for each new hash of the open project's newest good build, draws `boardPicture(model, PAGE_THUMB, false)` and sends its PNG bytes.

- [x] **Step 1: Write the failing tests**

```ts
// manifest.test.ts
it("keeps torno's paths, or says in moved which pino rule renamed a copy", () => {
  for (const f of manifest()) {
    if (f.moved === undefined) expect(f.pino).toBe(f.torno.replace(/torno(?=[^/]*$)/g, 'pino'))
    else expect([f.pino, f.moved.trim().length > 0, f.moved.includes('\n'), f.pino !== f.torno]).toEqual([f.pino, true, false, true])
  }
})
// main/thumb.test.ts
it('keeps a PNG under .pino with its build, ignored by git, and reads it back', async () => {
  await saveThumbnail(dir, PNG, { hash: 'aaaaaaaaaaaa' }, new Date('2026-11-26T10:00:00Z'))
  expect(await thumbnailOnFile(dir)).toEqual(PNG)
  expect(JSON.parse(readFileSync(join(dir, '.pino', 'thumb.json'), 'utf8'))).toEqual({ hash: 'aaaaaaaaaaaa', at: '2026-11-26T10:00:00.000Z' })
  expect(readFileSync(join(dir, '.pino', '.gitignore'), 'utf8')).toMatch(/^thumb\.png$/m)
})
it('refuses what is not a PNG or is over 512 KB', () => {
  expect(thumbnailRefusal(new Uint8Array([1, 2, 3]))).toBe('A thumbnail is a PNG; this is not one.')
  expect(thumbnailRefusal(bigPng(512 * 1024 + 1))).toBe('A thumbnail is at most 512 KB.')
})
it('reads no thumbnail through a link', async () => { /* .pino/thumb.png a link to a PNG elsewhere: null */ })
// e2e/workspace.spec.ts
test('a board built in this run has its picture on its card', async () => {
  // referenceProject in a workspace; waitForBuild(page, 1); All projects; the card's img has naturalWidth 480 (240 at 2x)
})
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/manifest.test.ts src/main/thumb.test.ts`
Expected: FAIL (`thumb` missing; the manifest rule has no `moved`)

- [x] **Step 3: Copy, adapt and wire**

`CLAUDE.md`'s first invariant becomes: "Copy now, extract later. A copied torno file lives at the same relative path as in torno (where torno's own file name says torno, pino's says pino), unless a pino rule renames it (object to project, torno's board of cards to cards); then its manifest entry says so in `moved`." `ProjectsPage` asks `project:thumb` for a card when it comes into view (`IntersectionObserver`), shows it as an `img` from a blob URL, revoked when the card goes.

- [x] **Step 4: Run the tests and the e2e suite**

Run: `pnpm test && pnpm -C app typecheck && pnpm test:e2e`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add -A app/src app/e2e CLAUDE.md shared-from-torno.json .claude/rules/workspace-writes.md
git commit -m "Each board's newest build on its card; a copy renamed by a pino rule says so in moved"
```

---

### Task 4: The cards file: kinds for boards, read whole or kept aside

**Files:**
- Create: `app/src/shared/cards.ts`, `app/src/shared/cards.test.ts`, `app/src/shared/size.ts`, `app/src/shared/size.test.ts`, `app/src/main/cards/file.ts`, `app/src/main/cards/file.test.ts`
- Modify: `shared-from-torno.json`
- Copies: `app/src/shared/board.ts` to `app/src/shared/cards.ts` adapted ("PCB card kinds, frames as groups with no place or size, no arrows, pictures, cameras, pins or attachments; part readings"), `moved: "board means the printed circuit board in pino"`; `app/src/shared/board.test.ts` to `app/src/shared/cards.test.ts` likewise; `app/src/shared/size.ts` and `size.test.ts` as-is (if `checkTie` is unused, still as-is); `app/src/main/board/file.ts` and `file.test.ts` to `app/src/main/cards/file.ts` and `file.test.ts`, adapted ("cards.json in .pino/brief/, pino's kinds and fields, ownFolder"), `moved` as above.

**Interfaces:**
- Produces, `shared/cards.ts`:
  ```ts
  export type CardKind = 'frame' | 'note' | 'rule' | 'link' | 'size' | 'requirement' | 'decision' | 'question' | 'part' | 'power' | 'connection' | 'fab'
  export const CARD_KINDS = ['frame', 'note', 'rule', 'link', 'size', 'requirement', 'decision', 'question', 'part', 'power', 'connection', 'fab'] as const
  /** What Claude may add (`add_card` `kind`). */
  export const AGENT_KINDS = ['requirement', 'decision', 'question', 'part', 'power', 'connection', 'size', 'rule', 'link', 'note'] as const
  export type AgentKind = (typeof AGENT_KINDS)[number]
  /** What the person may add on the Brief page. */
  export const PERSON_KINDS: readonly CardKind[] = [...AGENT_KINDS, 'fab']
  export type PartReading =
    | { class: 'basic' | 'preferred' | 'extended'; package: string; stock: number | null; price: number | null; checkedAt: string; fresh: boolean }
    | { missing: true; checkedAt: string; fresh: boolean }
  export interface PartFact { lcsc?: string; reading?: PartReading }
  export interface FabAsk { layers: 2 | 4; thickness: 0.8 | 1.0 | 1.2 | 1.6 | 2.0; assembly: 'jlc' | 'hand' | 'mix'; boards: number }
  export interface Card { id: string; kind: CardKind; by: 'person' | 'agent'; frame?: string; name?: string; text?: string; size?: SizeFact; part?: PartFact; fab?: FabAsk; turn?: CardTurn; at?: string; was?: CardWas[]; from?: CardFrom }
  export interface CardsFile { next: number; cards: Card[] }
  // CardTurn, CardWas, CardFrom, MAX_WAS = 6 as torno's
  export const CARD_ID = /^C[1-9]\d*$/
  export const LCSC = /^C[1-9]\d{0,9}$/
  export const MAX_CARDS = 2000, MAX_TEXT_CHARS = 4000, MAX_NAME_CHARS = 200
  export type PersonChange =
    | { op: 'add'; kind: CardKind; text?: string; size?: SizeFact; lcsc?: string; fab?: FabAsk }
    | { op: 'edit'; id: string; text?: string; size?: SizeFact; fab?: FabAsk }
    | { op: 'remove'; ids: string[] }
    | { op: 'restore'; ids: string[] }
    | { op: 'adopt'; id: string }
  export type AgentChange =
    | { op: 'add'; kind: AgentKind; text?: string; size?: { what: string; value: string; unit?: SizeUnit; note?: string }; lcsc?: string }
    | { op: 'edit'; id: string; text?: string; size?: { what: string; value: string; unit?: SizeUnit; note?: string }; lcsc?: string }
    | { op: 'remove'; id: string }
  export function readingOrder(cards: readonly Card[]): Card[]   // each frame by id, then its cards by id; then the cards of no frame by id
  export function readingOf(result: PartsResult, lcsc: string, now: Date): PartReading | { refused: string }
  export function readingLine(reading: PartReading): string
  export function fabText(fab: FabAsk): string
  export const emptyCards = (): CardsFile => ({ next: 1, cards: [] })
  // firstLink, linksIn, MAX_LINK_CHARS as torno's
  ```
- Produces, `main/cards/file.ts`: `FILE = 'cards.json'`; `textOf(file: CardsFile): string`; `sanitiseCard(value: unknown): Card | null`; `readCardsFile(value: unknown): { file: CardsFile; dropped: number } | null`; `loadCardsFile(dir: string, now?: () => Date): Promise<{ file: CardsFile; text: string | null; problem?: string }>`; `saveCardsFile(dir: string, file: CardsFile): Promise<void>`.

- [x] **Step 1: Copy the four files and their tests, cut what pino has no use for, then write the failing tests**

```ts
// shared/cards.test.ts
it('reads frames by id, each followed by its cards, then the loose cards', () => {
  expect(readingOrder([card('C4'), card('C1', { kind: 'frame' }), card('C3', { frame: 'C1' }), card('C2', { frame: 'C1' })]).map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4'])
})
it('says a part reading in one line', () => {
  expect(readingLine({ class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true })).toBe('basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)')
  expect(readingLine({ class: 'extended', package: 'SOT-25-5', stock: null, price: 0.09, checkedAt: '2026-11-03T22:33:00.000Z', fresh: true })).toBe('extended · SOT-25-5 · stock not known · $0.09 each (checked 2026-11-03)')
  expect(readingLine({ missing: true, checkedAt: '2026-11-26T06:00:00+00:00', fresh: true })).toBe('JLC has no such part (checked 2026-11-26)')
  expect(readingLine({ class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-20T06:00:00+00:00', fresh: false })).toBe('basic · 0603 · stock 1,234,567 · $0.0024 each (from 2026-11-20: jlcsearch could not be reached)')
})
it('takes a reading from a parts answer, or says why there is none', () => {
  // the stand-in's C25804 answer -> class basic, checkedAt '2026-11-26T05:00:00.000Z', fresh true
  // parts [] and no error finding -> { missing: true, checkedAt: now.toISOString(), fresh: true }
  // a parts_unavailable finding -> { refused: 'jlcsearch could not be reached' } (the headline without "Parts: ")
})
it('says what the person asked of the fab', () => {
  expect(fabText({ layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 })).toBe('2 layers, 1.6 mm, JLC assembles it, 5 boards')
  expect(fabText({ layers: 4, thickness: 1.0, assembly: 'mix', boards: 1 })).toBe('4 layers, 1.0 mm, JLC assembles some and you solder the rest, 1 board')
})
// main/cards/file.test.ts
it('reads a file of every kind back as it was written', async () => { /* one card of each CardKind with its fields, turn, at, was, from */ })
it('leaves out a card it cannot read whole, keeps the file as it was beside it, and says how many', async () => {
  // a part card with lcsc 'R1': problem '1 card in the cards file of this project was not whole, and left out. The file as it was is kept as .pino/brief/cards.json.dropped-<stamp>.'
})
it('keeps a merge-conflicted file aside and never reuses its ids', async () => {
  writeCards(dir, '<<<<<<< HEAD\n{"next": 9, "cards": [{"id": "C8", "kind": "note", "by": "agent", "text": "a"}]}\n=======\n{"next": 4}\n>>>>>>> other\n')
  const read = await loadCardsFile(dir, () => new Date('2026-11-26T10:00:00Z'))
  expect(read.problem).toBe('The cards file of this project could not be read. It was kept as .pino/brief/cards.json.corrupt-2026-11-26T10-00-00-000Z, and a new one was started.')
  expect(read.file).toEqual({ next: 9, cards: [] })
})
it('writes nothing through a .pino/brief that is a link', async () => { /* saveCardsFile rejects; the link's target is untouched */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/cards.test.ts src/shared/size.test.ts src/main/cards/file.test.ts`
Expected: FAIL (the kinds, `readingOf`, `readingLine`, `fabText` and the pino paths are not there yet)

- [x] **Step 3: Adapt the copies to the interfaces above**

`sanitiseCard` takes `size` only on `size`, `part` only on `part` (`lcsc` matching `LCSC`; a `reading` whole or dropped alone), `fab` only on `fab`, `name` only on `frame`, `text` on the rest; `by` only `person` or `agent`. The salvaged `next` is one above the largest `C<n>` in the text, as torno's `salvagedNext`.

- [x] **Step 4: Run them to verify they pass**

Run: `pnpm -C app exec vitest run src/shared/cards.test.ts src/shared/size.test.ts src/main/cards/file.test.ts src/manifest.test.ts src/names.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add app/src/shared/cards.ts app/src/shared/cards.test.ts app/src/shared/size.ts app/src/shared/size.test.ts app/src/main/cards shared-from-torno.json
git commit -m "The Brief's cards file in .pino/brief/: PCB card kinds, read whole or kept aside"
```

---

### Task 5: The cards store, the prompt a card was written in, and brief.md followed

**Files:**
- Create: `app/src/main/cards/store.ts`, `app/src/main/cards/store.test.ts`, `app/src/main/cards/watch.ts`, `app/src/main/cards/watch.test.ts`, `app/src/main/sessions/prompts.ts`, `app/src/main/sessions/prompts.test.ts`, `app/src/shared/brief.ts`, `app/src/shared/brief.test.ts`
- Modify: `app/src/main/sessions/chatlog.ts`, `app/src/main/sessions/manager.ts`, `app/src/main/sessions/manager.test.ts`, `app/src/shared/chat.ts`, `shared-from-torno.json`
- Copies: `app/src/main/board/store.ts` and `store.test.ts` to `app/src/main/cards/store.ts` and `store.test.ts`, adapted ("cards only: no arrows, places, pictures, ties, pins, reconcile or aside; agent and person rules for PCB kinds; part readings main's"), `moved: "board means the printed circuit board in pino"`; `app/src/main/board/watch.ts` and `watch.test.ts` to `app/src/main/cards/watch.ts`, `watch.test.ts`, adapted ("brief.md and .pino/brief/cards.json only"), moved likewise; `app/src/main/sessions/prompts.ts` and `prompts.test.ts` adapted ("chat logs only: no terminal prompts, no history, no marks or review"). `chatlog.ts` entry: change ends `; conversations and readPrompts from 8086e7ca`. `shared/chat.ts` entry: `; PromptRow from 8086e7ca`.

**Interfaces:**
- Consumes: Task 4's types, `loadCardsFile`, `saveCardsFile`; `shared/brief.ts`'s `seenOf`, `seenHash` (copy `shared/brief.ts` and `brief.test.ts` here, adapted: "PCB kinds on the spine; seenHash without a part's reading; referenceNotes"; Task 7 uses the rest of it).
- Produces:
  ```ts
  export interface AgentResult { id: string; file: CardsFile }
  export class CardStore {
    constructor(deps: { dirOf(projectId: string): string | undefined; now?(): Date; onChange?(projectId: string, file: CardsFile): void; onProblem?(projectId: string, message: string): void })
    read(projectId: string): Promise<CardsFile>
    person(projectId: string, change: PersonChange, stamp?: { reading?: PartReading }): Promise<CardsFile>
    agent(projectId: string, change: AgentChange, stamp: { turn?: CardTurn; reading?: PartReading }): Promise<AgentResult>
    /** A new reading of a part card: main's fields only, no `was`, no `at`. */
    restock(projectId: string, id: string, reading: PartReading): Promise<CardsFile>
    seen(projectId: string): Promise<Seen | null>
    markSeen(projectId: string): Promise<Seen>
    told(projectId: string): Promise<Record<string, string>>
    markTold(projectId: string, told: Record<string, string>): Promise<void>
    /** Main has read the file again from disk (a pull, an edit by hand): what it holds is dropped. */
    refresh(projectId: string): Promise<void>
    forget(projectId: string): void
  }
  ```
  - `shared/chat.ts`: `PromptRow { conversation: string; id: string; number: number; text: string; at: number }`.
  - `sessions/chatlog.ts`: `conversations(dir: string): Promise<string[]>`; `readPrompts(dir: string, conversationId: string): Promise<Array<{ id: string; text: string; at: number }>>` (the `user` items whose state is `sent`).
  - `sessions/prompts.ts`: `MOST_PROMPTS = 2000`; `listPrompts(dir: string, opts?: { most?: number }): Promise<PromptRow[]>`.
  - `Sessions.turnNow(projectId: string): CardTurn | undefined`: the prompt the project's session is answering (the transcript's `taken()` item and the session's `conversationId`), only while its status is `working` or `needs_input`.
  - `Sessions.sendBlocks(sessionId: string, blocks: PromptBlock[]): Promise<void>`: `send` for text and pictures (Task 12 uses it).
  - `cards/watch.ts`: `watchBrief(dir: string, onChange: (what: { brief: boolean; cards: boolean }) => void, debounceMs?: number): () => void`.

- [x] **Step 1: Copy the files and tests, cut torno's arrows, places, pictures and ties out of them, then write the failing tests**

```ts
// main/cards/store.test.ts
it('gives ids C1, C2 in order, and never again after a remove', async () => { /* add, add, remove C2, add -> C3 */ })
it("an agent changes only its own cards: the person's are refused in words", async () => {
  await expect(store.agent(P, { op: 'edit', id: 'C1', text: 'x' }, {})).rejects.toThrow("C1 is the person's: you may change or remove only your own cards. Add a card of yours instead.")
  await expect(store.agent(P, { op: 'remove', id: 'C9' }, {})).rejects.toThrow('There is no card C9 in the Brief.')
})
it('stamps the prompt and the time, and keeps what an edit replaced, at most six', async () => {
  // agent add with turn {prompt:'u1', conversation:'k'}, then 7 edits: was has 6 entries, oldest dropped; at is now()
})
it('a size or part needs its own field, and a part an LCSC number', async () => {
  await expect(store.agent(P, { op: 'add', kind: 'part', text: 'MCU' }, {})).rejects.toThrow('A part card names its part by LCSC number, such as lcsc: "C2838500". Nothing was done.')
})
it('make it yours keeps who wrote it, in which prompt and when', async () => {
  // adopt C3: by 'person', from { by: 'agent', turn, at, since }
})
it('a new reading of a part changes neither was nor what the person has seen', async () => {
  const { id } = await store.agent(P, { op: 'add', kind: 'part', lcsc: 'C25804', text: 'Pull-up: 10k' }, { reading: OLD })
  const seen = await store.markSeen(P)
  const after = await store.restock(P, id, NEW)
  expect(after.cards[0].was).toBeUndefined()
  expect(seenOf(after.cards, seen.at)).toEqual(seen)
})
it('seen.json and told.json are ignored by git; cards.json is not', async () => {
  // after markSeen and markTold: .pino/.gitignore lines include 'brief/seen.json' and 'brief/told.json' and not 'brief/cards.json'
})
it('a file it could not read is said once, and the next read says nothing', async () => { /* onProblem called once */ })
// sessions/prompts.test.ts
it('numbers the sent prompts of every conversation by time', async () => { /* two logs, a queued and a not-sent item left out */ })
// sessions/manager.test.ts
it('turnNow names the prompt the session is answering, and none between turns', async () => { /* fake agent: before hook undefined, during { prompt: <user item id>, conversation }, after Stop undefined */ })
it('sendBlocks sends text and pictures as one prompt', async () => { /* stand-in `images` says 'images: 1 4x4' */ })
// cards/watch.test.ts
it('calls once per burst when brief.md or cards.json changes, and not for anything else', async () => { /* write brief.md twice in 100 ms -> once { brief: true, cards: false }; board.py change -> no call */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/cards src/main/sessions/prompts.test.ts src/main/sessions/manager.test.ts src/shared/brief.test.ts`
Expected: FAIL

- [x] **Step 3: Adapt the store, the prompts and the watch; add `turnNow` and `sendBlocks` to `Sessions`**

One change at a time per project (torno's queue). An agent `add` of `part` with a `reading` in the stamp keeps it; its `text` holds Claude's words and reasons. `adopt` takes a card of `by: 'agent'` only. A person may not `edit` the text of a card of Claude's that is not adopted (refused: `C4 is Claude's: make it yours first.`). `seenHash` leaves out `part.reading`. `sendBlocks` is `send` with the blocks as given (the transcript already shows the first text and keeps captions).

- [x] **Step 4: Run them to verify they pass**

Run: `pnpm -C app exec vitest run src/main/cards src/main/sessions src/shared/brief.test.ts src/manifest.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add app/src/main/cards app/src/main/sessions app/src/shared/chat.ts app/src/shared/brief.ts app/src/shared/brief.test.ts shared-from-torno.json
git commit -m "The cards store: one writer, ids never reused, the prompt each card of Claude's came from"
```

---

### Task 6: Claude's card tools, the Brief in each prompt, and brief.md refused

**Files:**
- Create: `app/src/main/mcp/cardTools.ts`, `app/src/main/mcp/cardTools.test.ts`, `app/src/main/cards/text.ts`, `app/src/main/cards/text.test.ts`
- Modify: `app/src/main/mcp/tools.ts`, `app/src/main/mcp/schemas.ts`, `app/src/main/mcp/server.test.ts`, `app/src/main/turncost.test.ts`, `app/src/main/prompt.ts`, `app/src/main/domain.ts`, `app/src/main/domain.test.ts`, `app/src/main/sessions/reach.ts`, `app/src/main/sessions/reach.test.ts`, `app/src/main/fab.ts`, `app/src/main/fab.test.ts`, `app/src/main/index.ts`, `.claude/rules/engine-client.md`, `shared-from-torno.json`
- Copies: `app/src/main/mcp/boardTools.ts` to `app/src/main/mcp/cardTools.ts`, adapted ("brief and add_card for PCB kinds; no frames, arrows, pictures, ties; a part looked up by main"), `moved: "board means the printed circuit board in pino"`; `app/src/main/board/text.ts` and `text.test.ts` to `app/src/main/cards/text.ts`, `text.test.ts`, adapted ("cards and brief.md only; no live facts, pictures or attachments"), moved likewise. `reach.ts` and `reach.test.ts` entries: change ends `; BRIEF_REFUSAL from 8086e7ca`.

**Interfaces:**
- Consumes: Task 5's `CardStore`, `Sessions.turnNow`, `listPrompts`; PR #8's `Fab.lookupEngine`.
- Produces:
  - `Fab.lookup(q: PartsQuery): Promise<PartsResult>`: the engine's `parts` job with no project (`parts(p, q)` becomes `engineMayWrite(p.dir)` then `lookup(q)`).
  - `ToolDeps` gains `cards: Pick<CardStore, 'read' | 'agent'>`, `turnNow(projectId: string): CardTurn | undefined`, `prompts(project: ProjectInfo): Promise<PromptRow[]>`, and `fab` gains `'lookup'`.
  - `schemas.ts`: `briefInput = z.strictObject({ kind: z.enum(CARD_KINDS).optional() })`; `addCardInput = z.strictObject({ kind: z.enum(AGENT_KINDS).optional(), text: z.string().max(MAX_TEXT_CHARS).optional(), size: z.strictObject({ what: z.string(), value: z.string(), unit: z.enum(['mm', '°']).optional(), note: z.string().optional() }).optional(), lcsc: z.string().optional(), card: z.string().optional(), remove: z.boolean().optional() })`; `DESCRIPTIONS.brief`, `DESCRIPTIONS.add_card` (exact copy below); `SERVER_INSTRUCTIONS` gains one line after "Parts" (below).
  - `cardTools.ts`: `registerCardTools(server: McpServer, deps: ToolDeps, onProject: OnProject): void`, both tools `_meta: ALWAYS`.
  - `cards/text.ts`: `cardLine(card: Card, prompts?: ReadonlyMap<string, number>): string`; `cardsText(file: CardsFile, opts: { brief?: string; limit: number; kind?: CardKind; prompts?: ReadonlyMap<string, number> }): string`; `cardsLine(file: CardsFile, told: Record<string, string>, brief: string | undefined, toolName: (t: string) => string): { line: string; told: Record<string, string> }`; `BRIEF_LIMIT = 2000` (the most of `brief.md` the `brief` tool gives).
  - `DomainDeps` gains `cards: Pick<CardStore, 'read' | 'told' | 'markTold'>` and `brief(project: ProjectInfo): Promise<string | undefined>`; `promptContext` adds `cardsLine` after the verdict and marks it told in `delivered`.
  - `reach.ts`: `BRIEF_REFUSAL(name: string): string`.

Exact copy:
- System prompt line, last of "How to work": `` `- Never edit brief.md: it is the person's own words. What you learn or settle goes on cards of yours with ${t('add_card')} (a requirement, decision, open question, part or power budget), one card per topic that starts with its name, and when a topic changes you change your card. ${t('brief')} reads brief.md and every card.` ``
- `SERVER_INSTRUCTIONS` line: `"Brief: brief (brief.md, the person's words, and every card by id), add_card (a card of yours: a requirement, decision, question, part by LCSC number, power budget, connection, size, rule, link or note; card with text changes one of yours, remove takes it down). The person's words and cards are theirs."`
- `DESCRIPTIONS.brief`: `"The project's Brief: brief.md, the person's words, then every card by id, kind and author with the prompt it was written in. The person's: power, connections, size and shape, the parts they have, fab and assembly, rules, links. Yours: requirements, decisions, open questions, parts with their stock reading, power budgets. kind narrows to one kind. Read it before you plan and when the person points at a card."`
- `DESCRIPTIONS.add_card`: `"Adds a card of yours to the Brief, or changes or removes one of yours; answers with its id, or why not. kind is requirement, decision, question (what is open and what waits on it), part, power (a rail, its source and what draws from it, with numbers), connection, size, rule, link or note. One card per topic, its text starting with the topic's name (\"MCU: ESP32-C3-MINI-1, for Wi-Fi\"); when a topic changes, give card and text rather than add another. A part takes lcsc, and pino fills its class, package, stock and price. brief.md and the person's cards are never yours to change."`
- `BRIEF_REFUSAL(name)`: `` `${name} may not write brief.md: it is the person's own words, and only they change it. Write down what you learned as a card of yours with add_card, one card per topic that begins with its name ("Power: USB-C, 5 V"); when a topic changes, change your card of it (card and text) rather than add another.` ``

- [x] **Step 1: Copy, then write the failing tests**

```ts
// main/cards/text.test.ts
it('says each card in one line with its author and prompt', () => {
  expect(cardLine(part('C7', 'agent', 'Pull-up: 10k for I2C', 'C25804', READING, 'u1'), new Map([['u1', 3]]))).toBe('C7 · part · by you, prompt 3: Pull-up: 10k for I2C · C25804 basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)')
  expect(cardLine(power('C2', 'person', 'USB-C, 5 V, 0.5 A'))).toBe('C2 · power · by the person: USB-C, 5 V, 0.5 A')
})
it('tells what is new since the last prompt, once', () => {
  const first = cardsLine(file3, {}, '# blinky\n', (t) => `mcp__pino__${t}`)
  expect(first.line).toBe('Brief: 3 cards (3 new: C1, C2, C3). Read them with mcp__pino__brief.')
  expect(cardsLine(file3, first.told, '# blinky\n', (t) => `mcp__pino__${t}`).line).toBe('Brief: 3 cards (0 new). Read them with mcp__pino__brief.')
  expect(cardsLine(file3, first.told, '# blinky\nnow USB-C\n', (t) => `mcp__pino__${t}`).line).toBe('Brief: 3 cards (0 new); brief.md changed since. Read them with mcp__pino__brief.')
  expect(cardsLine(emptyCards(), {}, undefined, (t) => t).line).toBe('')
})
// main/mcp/cardTools.test.ts: toolsOver with a CardStore on a temp project and a fake fab
it('add_card adds a part with the reading main looked up, and brief reads it back', async () => {
  expect(await call('add_card', { kind: 'part', lcsc: 'c25804', text: 'Pull-up: 10k for I2C' })).toBe('Added C1, part: C25804 is basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26).')
  expect(await call('brief')).toContain('C1 · part · by you: Pull-up: 10k for I2C · C25804 basic')
})
it('a part whose stock cannot be checked is still added, and says so', async () => {
  expect(await call('add_card', { kind: 'part', lcsc: 'C25804', text: 'R1' })).toBe('Added C1, part: stock not checked (jlcsearch could not be reached). The person can check it again on the Brief.')
})
it("refuses the person's card, a second change shape and an empty card", async () => {
  // { card: 'C1', text: 'x' } on a person's card -> isError, "C1 is the person's: ..."
  // {} -> 'add_card needs kind and text, size or lcsc: nothing was done.'
})
it('stamps the card with the prompt the session is answering', async () => { /* turnNow returns { prompt: 'u7' } -> card.turn */ })
// main/sessions/reach.test.ts
it('refuses a write of brief.md, by any path to it, and names add_card', () => {
  for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['MultiEdit', 'file_path'], ['NotebookEdit', 'notebook_path']]) expect(refusalOf(dir, tool, { [key]: 'brief.md' })).toBe(BRIEF_REFUSAL(tool))
  expect(refusalOf(dir, 'Write', { file_path: join(dir, 'sub', '..', 'brief.md') })).toBe(BRIEF_REFUSAL('Write'))
  expect(refusalOf(dir, 'Write', { file_path: join(dir, 'reference', 'brief.md') })).toBeUndefined()
})
// main/domain.test.ts
it("adds the Brief's line to a prompt and marks it told once delivered", async () => { /* context text contains 'Brief: 2 cards (2 new: C1, C2).'; after delivered, the next says '(0 new)' */ })
// main/turncost.test.ts
const UP_FRONT = ['add_card', 'brief', 'check', 'look', 'marks', 'measure', 'nets', 'parts', 'point', 'project', 'resolve_mark', 'route']
it('the tools loaded up front are the twelve the prompt relies on, in at most 33,000 characters', async () => { /* as now, toHaveLength(18) */ })
it("the prompt says brief.md is the person's and Claude writes cards", () => {
  expect(systemPrompt(toolName)).toContain(`- Never edit brief.md: it is the person's own words. What you learn or settle goes on cards of yours with ${toolName('add_card')}`)
})
// main/fab.test.ts
it('looks a part up with no project and no build', async () => { /* lookup({ lcsc: 'C25804' }) on a holder with no build: parts[0].lcsc C25804 */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/cards src/main/mcp src/main/sessions/reach.test.ts src/main/domain.test.ts src/main/turncost.test.ts src/main/fab.test.ts`
Expected: FAIL

- [x] **Step 3: Write the tools, the line, the refusal and `Fab.lookup`; wire the store in `index.ts`**

`add_card` normalises `lcsc` with `.trim().toUpperCase()`, looks it up with `deps.fab.lookup({ lcsc })` and `readingOf`, and passes the reading (or none) in the stamp; a lookup that throws or refuses adds the card with no reading. `brief`'s answer is the `brief.md` words (`briefWords`, cut at `BRIEF_LIMIT` with "the rest is in brief.md") then `cardsText`, capped by `capText`. `index.ts` makes one `CardStore` (`dirOf` the open project's folder; `onChange` broadcasts `cards:changed`; `onProblem` a `notice`), passes it to `mountMcp`, `PinoDomain` and (Task 7) `registerIpc`; `turnNow` is `sessions.turnNow`, `prompts` is `listPrompts(project.dir)`.

- [x] **Step 4: Run them, and measure the turn's cost**

Run: `pnpm test && pnpm -C app typecheck`
Expected: PASS. Put the measured up-front characters and the prompt plus instructions length (printed once by a temporary `console.log` in `turncost.test.ts`, removed before the commit) in the commit message.

- [x] **Step 5: Update `engine-client.md` (eighteen tools, `brief` and `add_card` up front) and commit**

```bash
git add -A app/src/main shared-from-torno.json .claude/rules/engine-client.md
git commit -m "brief and add_card: Claude writes what it learns as cards, never brief.md"
```

---

### Task 7: The Brief tab: In your words, and the tables

**Files:**
- Create: `app/src/renderer/state/cards.ts`, `app/src/renderer/ui/brief/BriefPage.tsx`, `BriefWords.tsx`, `Rows.tsx`, `SizeForm.tsx`, `TextForm.tsx`, `PictureView.tsx`, `ops.ts`, `refPieces.ts`, `refPieces.test.ts`, `app/src/renderer/styles/brief.css`, `app/e2e/brief.spec.ts`, `.claude/rules/brief.md`
- Modify: `app/src/shared/view.ts`, `app/src/shared/view.test.ts`, `app/src/main/view.ts`, `app/src/main/view.test.ts`, `app/src/main/domain.ts`, `app/src/main/ipc.ts`, `app/src/preload/index.ts`, `app/src/shared/bridge.ts`, `app/src/shared/keys.ts`, `app/src/renderer/ui/ViewPane.tsx`, `app/src/renderer/ui/RouteCard.tsx`, `app/src/renderer/look.ts`, `app/src/renderer/state/store.ts`, `app/src/renderer/App.tsx`, `app/src/renderer/styles/styles.test.ts` (if it lists sheets), `app/e2e/boot.spec.ts`, `.claude/rules/views.md`, `CLAUDE.md` (rules by area), `shared-from-torno.json`
- Copies: `app/src/renderer/state/board.ts` to `app/src/renderer/state/cards.ts`, adapted ("the cards, brief.md, the reference files and seen of the open project; no attachments, pictures store or column"), `moved: "board means the printed circuit board in pino"`; `app/src/renderer/ui/brief/BriefPage.tsx`, `BriefWords.tsx`, `Rows.tsx`, `SizeForm.tsx`, `TextForm.tsx`, `PictureView.tsx`, `ops.ts`, `refPieces.ts`, `refPieces.test.ts` adapted (BriefPage: "PCB sections, no marks, checks, ties or board switch"; Rows: "PCB kinds, part readings and the board's size beside a size"; the rest: "pino's cards and channels"); `app/src/renderer/styles/brief.css` adapted ("pino's tokens"). `Held.tsx`, `TiePanel.tsx`, `BoardSwitch.tsx` are not copied.

**Interfaces:**
- Consumes: Task 6's store wiring; `cards:*` handlers call the store; `readBrief` (from torno `main/board/live.ts`: copy only that function into `main/cards/text.ts`, its entry's change says so); Task 5's `watchBrief` (started by `opened` for the open project, stopped when it closes).
- Produces:
  - `shared/view.ts`: `PaneTab = 'brief' | ViewTab`; `PANE_TABS: readonly PaneTab[] = ['brief', 'schematic', 'board', '3d']`; `PANE_NAMES = { brief: 'Brief', ...TAB_NAMES }`; `firstTab(listed: ListedProject | undefined, remembered: PaneTab | null): PaneTab` (no `board.py`: `brief`; else the one remembered, else `schematic`); `lookTab(asked: ViewTab | undefined, onScreen: PaneTab): ViewTab` (the asked tab, else on the Brief `board`, else the one on screen).
  - `store.tab: PaneTab`, remembered per project in `localStorage` under `pino.tab:<project id>` (read and written in try/catch); `openProject` sets `tab` from `firstTab`.
  - IPC: invoked `cards:read(projectId)`, `cards:change(projectId, change)`, `cards:brief(projectId) -> string | null`, `cards:references(projectId) -> string[]` (the plain files of `reference/` named `photo-<n>`, `doodle-<n>` or `*.pdf`, sorted), `cards:reference(projectId, file) -> { mediaType: string; bytes: Uint8Array } | null` (a photo or doodle of that list, at most 25 MB), `cards:openLink(projectId, cardId, nth?) -> void` (`shell.openExternal`, `http` or `https` only, from main's own card or `brief.md`; nothing under test); to the window `cards:changed { projectId, file }`, `cards:briefChanged { projectId }`.
  - `PinoBridge.cards { read; change; brief; references; reference; openLink; onChanged; onBriefChanged }` (Task 8 adds `seen`, `markSeen`, `restock`, and `chat.prompts`).
  - `shared/brief.ts` (copied in Task 5): `briefSections(file: CardsFile): { yours: Array<{ frame: Card | null; cards: Card[] }>; sizes: Card[]; rules: Card[]; fab: Card | null }`; `referenceNotes(brief: string): Map<string, string>` (the `- reference/<file>: <note>` lines of `## References`); `BOARD_SIZE: Record<'width' | 'height', RegExp> = { width: /^board width$/i, height: /^board height$/i }`; `sizeAgainst(card: Card, box: { w: number; h: number } | null): { built: number; differs: boolean } | null` (differs past 0.05 mm).
  - Page copy: tab `Brief`; sections `In your words`, `What Claude wrote down` (Task 8 fills it; here its empty line `Claude has written nothing down yet.`), `Size and shape`, `Rules`, `Fab`; with no `brief.md`: `No brief.md yet. Write what the board does there, or tell Claude.`; hand pills `You`, `Claude, prompt <n>`, `Yours, from prompt <n>`; a size beside the board: `the board is 56 mm` (`data-differs` when it differs); the fab row: `You asked for 2 layers, 1.6 mm, JLC assembles it, 5 boards` above `FabBlock`; buttons `Add a note`, `Add a size`, `Add a rule`, `Remove`.
  - Route card: the `Brief` section is a button `Open the Brief` (sets the tab) above `FabBlock`; the line about `brief.md` goes.
  - `domain.ts` `viewLine`: on the Brief, `The person sees the Brief.`

- [x] **Step 1: Write the failing unit tests**

```ts
// shared/view.test.ts
it('opens a project with no board.py on the Brief, and one with a board where it was left', () => {
  expect(firstTab({ name: 'a', dir: '/w/a', board: false, brief: true, empty: false }, 'board')).toBe('brief')
  expect(firstTab({ name: 'a', dir: '/w/a', board: true, brief: true, empty: false }, '3d')).toBe('3d')
  expect(firstTab({ name: 'a', dir: '/w/a', board: true, brief: false, empty: false }, null)).toBe('schematic')
})
it("Claude's look on the Brief draws the board unless it asks for a tab", () => {
  expect([lookTab(undefined, 'brief'), lookTab('schematic', 'brief'), lookTab(undefined, '3d')]).toEqual(['board', 'schematic', '3d'])
})
// shared/brief.test.ts
it("reads the notes of the reference files from brief.md's References", () => {
  expect([...referenceNotes('# a\n\nwords\n\n## References\n\n- reference/photo-1.jpg: the old board\n- reference/doodle-1.png\n')]).toEqual([['reference/photo-1.jpg', 'the old board'], ['reference/doodle-1.png', '']])
})
it("sets the board's width beside a size of that name, and marks a difference", () => {
  expect(sizeAgainst(size('Board width', '50'), { w: 56, h: 44 })).toEqual({ built: 56, differs: true })
  expect(sizeAgainst(size('board height', '44'), { w: 56, h: 44 })).toEqual({ built: 44, differs: false })
  expect(sizeAgainst(size('USB-C offset', '3'), { w: 56, h: 44 })).toBeNull()
})
// main/view.test.ts
it("takes the Brief as what the person sees", () => { expect(viewOf({ tab: 'brief', look: DEFAULT_LOOK, selection: null })?.tab).toBe('brief') })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/view.test.ts src/shared/brief.test.ts src/main/view.test.ts src/main/domain.test.ts`
Expected: FAIL

- [x] **Step 3: Copy the window's files, adapt them, add the tab and the channels**

`ViewPane` draws `PANE_TABS` (Left and Right go round all four); the Brief's panel is `BriefPage`, the others as now; the band at the foot only on the three views. "In your words" is torno's `BriefWords` (headings, paragraphs, lists with hanging indents, links as a link with its host, numbers in Martian Mono) on its sheet, the pictures beside it (`PictureTile` from `cards:reference`, with the note from `referenceNotes`), the PDF lines, then the person's cards by frame (`briefSections(file).yours`, each frame's name a heading). The size table compares with `model.board.box` of the build on show.

- [x] **Step 4: Write the failing e2e spec**

```ts
// e2e/brief.spec.ts: a temp project with brief.md, reference/photo-1.png and .pino/brief/cards.json written by the test
test('a project with no board.py opens on the Brief with its words, its picture and its cards', async () => {
  // tabs ['Brief', 'Schematic', 'Board', '3D'], Brief selected; 'In your words' shows the paragraph and an img; frame 'Power' lists 'USB-C, 5 V, 0.5 A' with pill 'You'
})
test('follows brief.md changed and removed from outside', async () => {
  writeFileSync(join(dir, 'brief.md'), '# blinky\n\nNow with a buzzer.\n')
  await expect(page.locator('.brief-words')).toContainText('Now with a buzzer.', { timeout: 2000 })
  rmSync(join(dir, 'brief.md'))
  await expect(page.getByText('No brief.md yet. Write what the board does there, or tell Claude.')).toBeVisible({ timeout: 2000 })
})
test("a note added on the page is the person's card, in the file", async () => { /* Add a note, type, Enter: cards.json has { kind: 'note', by: 'person' } */ })
test('a board built opens on the views next time; the route card opens the Brief', async () => { /* referenceProject: first tab Schematic; Open the Brief selects Brief; relaunch keeps Brief */ })
test("the board's width beside the person's size, marked when they differ", async () => { /* referenceProject + size card Board width 50: row says 'the board is 56 mm', data-differs */ })
```

- [x] **Step 5: Run the unit tests and the e2e suite**

Run: `pnpm test && pnpm -C app typecheck && pnpm test:e2e`
Expected: PASS

- [x] **Step 6: Write `.claude/rules/brief.md` (paths: `app/src/main/cards/**`, `app/src/shared/cards.ts`, `app/src/shared/brief.ts`, `app/src/renderer/ui/brief/**`, `app/src/renderer/state/cards.ts`, `app/src/main/mcp/cardTools.ts`, `app/e2e/brief.spec.ts`), name it in `CLAUDE.md`'s rules by area, update `views.md` (the Brief tab first), and commit**

```bash
git add -A app/src app/e2e shared-from-torno.json .claude/rules CLAUDE.md
git commit -m "The Brief, the first tab: the person's words and pictures, their cards, sizes against the board, rules and the fab"
```

---

### Task 8: What Claude wrote down: the spine, Make it yours, new since you looked, Check stock again

**Files:**
- Create: `app/src/renderer/ui/brief/Spine.tsx`, `app/src/renderer/ui/chat/usePrompts.ts`
- Modify: `app/src/renderer/ui/brief/BriefPage.tsx`, `Rows.tsx`, `ops.ts`, `app/src/renderer/state/cards.ts`, `app/src/main/ipc.ts`, `app/src/preload/index.ts`, `app/src/shared/bridge.ts`, `app/src/shared/brief.test.ts`, `app/e2e/brief.spec.ts`, `.claude/rules/brief.md`, `shared-from-torno.json`
- Copies: `app/src/renderer/ui/brief/Spine.tsx` adapted ("PCB kinds and part readings; no 'Show prompt N in the chat'"), `app/src/renderer/ui/chat/usePrompts.ts` adapted ("pino's chat:prompts").

**Interfaces:**
- Consumes: Task 5's `briefSpine`, `freshCards`, `seenOf`, `handOf`, `promptsSaid`, `whenSaid`, `listPrompts`, `CardStore.seen`, `markSeen`, `restock`; Task 6's `Fab.lookup`, `readingOf`.
- Produces:
  - IPC: invoked `cards:seen(projectId) -> Seen | null`, `cards:markSeen(projectId) -> Seen`, `cards:restock(projectId, cardId) -> CardsFile` (main looks the card's `lcsc` up and stores the reading; a lookup that refuses rejects with its words and changes nothing), `chat:prompts(projectId) -> PromptRow[]`.
  - Page copy: each node `Prompt <n> · <time>` with `You: <the prompt, two lines>`, then the cards; a card's earlier words struck in the node of the prompt that wrote them with `Changed in prompt <n>`; cards with no prompt in one node first, `Before pino kept the prompt`; a prompt whose log is not here `A prompt not on this computer`; new prompts with the accent node and a `new` pill, the band `New since you looked: prompt 4` (`promptsSaid`), seen prompts folded to one line; buttons `Make it yours`, `Remove` (on Claude's own: the person may take Claude's card down), `Mark as seen`, and on a part card `Check stock again`. Leaving the Brief tab, or the project, marks seen (`markSeen`); the first time a project's Brief is opened nothing is new and `seen.json` is written.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/brief.test.ts (spine cases copied from torno's, then)
it("puts Claude's PCB cards on the spine and leaves the person's off it", () => {
  // agent requirement u1, agent part u2, person power: nodes ['u1', 'u2'] with one card each
})
it("a part's new reading is not new since you looked", () => {
  const seen = seenOf([partCard(READING_A)], '2026-11-26T10:00:00Z')
  expect(freshCards(briefSpine([partCard(READING_B)], new Map()), seen)).toEqual(new Set())
})
// e2e/brief.spec.ts
test("Claude's cards stand under the prompt that wrote them, a change struck in the older node", async () => {
  // agent: true; send 'tool mcp__pino__add_card {"kind":"decision","text":"Power: USB-C, 5 V"}' then 'tool mcp__pino__add_card {"card":"C1","text":"Power: a LiPo cell"}'
  // node 'Prompt 1' shows 'Power: USB-C, 5 V' struck with 'Changed in prompt 2'; node 'Prompt 2' shows 'Power: a LiPo cell' with pill 'Claude, prompt 2'
})
test('Make it yours gives the card to the person, and Claude may no longer change it', async () => {
  // Make it yours on C1: pill 'Yours, from prompt 1'; then 'tool mcp__pino__add_card {"card":"C1","text":"x"}' answers "C1 is the person's"
})
test('what came since the person looked is marked new, once', async () => { /* open Brief, leave, add a card through the stand-in, open: 'New since you looked: prompt 3', a 'new' pill; Mark as seen: the pill goes */ })
test('Check stock again fills the reading and is not new since you looked', async () => {
  // FAKE_KERNEL_SERVE '3' and FAKE_KERNEL_PARTS 'offline': add_card part C25804 -> row says 'from 2026-11-20: jlcsearch could not be reached'
  // relaunch without FAKE_KERNEL_PARTS, mark seen, Check stock again: row says 'basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)'; no 'new' pill
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/brief.test.ts && pnpm test:e2e -- brief.spec.ts`
Expected: FAIL (`pnpm test:e2e` builds first)

- [ ] **Step 3: Copy `Spine.tsx` and `usePrompts.ts`, adapt them, add the channels and the buttons**

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm test && pnpm -C app typecheck && pnpm test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A app/src app/e2e shared-from-torno.json .claude/rules/brief.md
git commit -m "What Claude wrote down: its cards by prompt, Make it yours, new since you looked, Check stock again"
```

---

### Task 9: Making a new project's folder, whole or not at all

**Files:**
- Create: `app/src/main/projects/create.ts`, `create.test.ts`, `offered.ts`, `offered.test.ts`, `readings.ts`, `readings.test.ts`, `app/src/main/cards/start.ts`, `start.test.ts`, `app/src/shared/projectName.ts`, `projectName.test.ts`, `app/src/shared/slots.ts`, `slots.test.ts`, `app/src/main/images.ts`
- Modify: `app/src/main/opened.ts` (the sweep), `app/src/main/index.ts`, `app/src/main/ipc.ts`, `app/src/preload/index.ts`, `app/src/shared/bridge.ts`, `CLAUDE.md`, `.claude/rules/workspace-writes.md`, `shared-from-torno.json`
- Copies: `app/src/main/objects/create.ts` and `create.test.ts` to `app/src/main/projects/create.ts`, `create.test.ts`, adapted ("no template model, STEP files, scans or other projects; PCB slots into cards; .pino-new; returns the project's name"), `moved: "object is project in pino"`; `app/src/main/objects/offered.ts`, `offered.test.ts` to `app/src/main/projects/`, as-is, `moved` likewise; `app/src/shared/objectName.ts` to `app/src/shared/projectName.ts` adapted ("projectNameProblem; no STEP, scans or objects in MOST_REFERENCES; no moduleName"), moved likewise; `app/src/main/board/start.ts`, `start.test.ts` to `app/src/main/cards/start.ts`, `start.test.ts`, adapted ("the PCB slots' frames, no places, no brief or reference cards"), `moved: "board means the printed circuit board in pino"`; `app/src/main/images.ts` adapted ("names").

**Interfaces:**
- Produces, `shared/slots.ts` (pino's own):
  ```ts
  export const POWER_SOURCES = ['USB-C', 'battery', 'barrel jack', "a host's header", 'other'] as const
  export const BUSES = ['I2C', 'SPI', 'UART', 'GPIO', 'USB', 'analog', 'other'] as const
  export interface PowerRow { source: (typeof POWER_SOURCES)[number]; kind: string; volts: string; amps: string; note: string }
  export interface ConnectionRow { what: string; bus: (typeof BUSES)[number]; connector: string }
  export interface PartHad { what: string; note: string }   // an LCSC number (LCSC) or a module in words
  export const MAX_POWER = 4, MAX_CONNECTIONS = 24, MAX_PARTS_HAD = 24, MAX_ROW = 120, MAX_ROW_NOTE = 300, MAX_SHAPE_NOTE = 300
  export const THICKNESSES = [0.8, 1.0, 1.2, 1.6, 2.0] as const
  export const DEFAULT_FAB: FabAsk = { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 }
  export function checkPower(raw: unknown): PowerRow | string
  export function checkConnection(raw: unknown): ConnectionRow | string
  export function checkPartHad(raw: unknown): PartHad | string
  export function checkFab(raw: unknown): FabAsk | string           // boards 1 to 10,000
  export function powerText(row: PowerRow): string                  // 'USB-C, 5 V, 0.5 A' / 'battery (LiPo 1S), 3.7 V: in the lid'
  export function connectionText(row: ConnectionRow): string        // 'SHT40 sensor over I2C, JST-SH 4-pin'
  ```
- Produces, `shared/projectName.ts`: `MAX_PROJECT_NAME = 64`, `MAX_PHOTO_BYTES`, `MOST_IMAGES = 6`, `MOST_REFERENCES = { photos: 12, doodles: 6, pdfs: 6 }`, `PDF_FORMATS`, `MAX_PDF_BYTES`, `MAX_LINKS = 20`, `MAX_URL = 2000`, `MAX_LINK_NOTE = 300`, `linkProblem`, `referenceFiles`, `projectNameProblem(name: string, existing: readonly string[]): string | null` (torno's rule: compared without regard to case).
- Produces, `CreateRequest` in `shared/bridge.ts`:
  ```ts
  export interface CreateRequest {
    name: string; description: string
    photos: Array<{ path: string; note: string } | { png: Uint8Array; note: string }>
    doodles: Array<{ png: Uint8Array; note: string; over?: number }>
    pdfs: Array<{ path: string; note: string }>
    power: PowerRow[]; connections: ConnectionRow[]; sizes: SizeFact[]; enclosure: string; edges: string
    parts: PartHad[]; fab: FabAsk | null; rules: string; links: Array<{ url: string; note: string }>
  }
  ```
- Produces, `main/projects/create.ts`: `CreateDeps { root: string; readings: Readings; hooks?: { afterTemp?; beforeCards?; beforeRename? } }`; `createProject(req: CreateRequest, deps: CreateDeps): Promise<{ name: string }>`; `sweepStaleNew(root: string, now: number): void` (`.<name>.pino-new-<12 hex>`, real folders older than `STALE_AFTER_MS = 10 * 60 * 1000`); `readPhoto(path: unknown): Promise<Uint8Array>`; `checkLink`.
- Produces, `main/cards/start.ts`: `StartRequest` (the slot fields of `CreateRequest` checked, parts with `reading?`); `START_FRAMES = ['Power', 'Connections', 'Size and shape', 'Parts I have', 'Fab and assembly', 'Rules', 'Links']`; `startCards(req: StartRequest): CardsFile` (a frame per group that holds something, in that order; cards by the person; `Size and shape` holds the size cards then `requirement` cards `Fits an enclosure: <note>` and `Connector edges: <text>`; a part with an `LCSC` `what` has `part.lcsc`, its `text` the note, else a `part` card with no `lcsc` whose text is `<what>: <note>`; one `rule` card holds the rules; a `link` card's text is `<url>\n<note>`).
- Produces, `main/projects/readings.ts`: `Readings { put(lcsc: string, reading: PartReading): void; get(lcsc: string): PartReading | undefined }` (the newest reading main gave this run, an hour at most).
- IPC: invoked `project:create(req) -> ProjectInfo` (made, listed, then opened), `project:pickPhotos() -> string[]`, `project:pickPdf() -> string | null`, `project:readPhoto(path) -> Uint8Array` (only paths the dialog or a drop offered), `project:taken() -> string[]`, `parts:lookup(lcsc) -> { reading: PartReading } | { refused: string }` (puts the reading in `Readings`); `PinoBridge.project` gains `create`, `pickPhotos`, `pickPdf`, `readPhoto`, `pathOf(file: File): string`, `taken`; `PinoBridge.parts { lookup(lcsc: string) }`. Test hooks: `pickFiles: string[] | null` answers both pickers.

- [ ] **Step 1: Copy the files and tests, then write the failing tests**

```ts
// main/projects/create.test.ts (torno's cases for the hidden folder, links, caps and PDFs kept, renamed; then)
it("makes brief.md, reference/ and the cards, and nothing else", async () => {
  await createProject(request({ name: 'blinky', description: 'Blinks an LED.', power: [usbC], parts: [{ what: 'C25804', note: 'pull-up' }], fab: DEFAULT_FAB }), deps)
  expect(tree(join(root, 'blinky'))).toEqual(['.pino/brief/cards.json', 'brief.md'])
  expect(readFileSync(join(root, 'blinky', 'brief.md'), 'utf8')).toBe('# blinky\n\nBlinks an LED.\n')
  expect(readdirSync(root)).toEqual(['blinky'])
})
it('a part has the reading main gave this run, never one from the request', async () => {
  deps.readings.put('C25804', READING)
  // request parts [{ what: 'c25804', note: '' }] plus a forged reading field: the card's part is { lcsc: 'C25804', reading: READING }
})
it('refuses a name another folder has in any case', async () => {
  mkdirSync(join(root, 'Blinky'))
  await expect(createProject(request({ name: 'blinky' }), deps)).rejects.toThrow('A folder `Blinky` is there already.')
})
it('a second Start for the same name is refused and leaves the first whole', async () => {
  const [a, b] = await Promise.allSettled([createProject(request({ name: 'blinky' }), deps), createProject(request({ name: 'blinky' }), deps)])
  expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
  expect(readdirSync(root)).toEqual(['blinky'])
})
it('sweeps only its own temp folders, older than ten minutes', () => { /* .x.pino-new-<12 hex> old: gone; young: kept; .x.pino-new-zz: kept; a file of that name: kept */ })
it('makes nothing at all when it fails after the claim', async () => { /* hooks.beforeRename throws: no blinky, no temp */ })
// main/cards/start.test.ts
it('puts each slot in its frame, in order, with ids C1 onwards', () => {
  expect(startCards(full).cards.filter((c) => c.kind === 'frame').map((c) => c.name)).toEqual(START_FRAMES)
  expect(startCards({ ...none, rules: 'hand-solderable, 0805 or larger' }).cards).toEqual([
    { id: 'C1', kind: 'frame', by: 'person', name: 'Rules' },
    { id: 'C2', kind: 'rule', by: 'person', frame: 'C1', text: 'hand-solderable, 0805 or larger' }
  ])
})
// shared/slots.test.ts
it('says a power source and a connection in a row', () => {
  expect(powerText({ source: 'USB-C', kind: '', volts: '5', amps: '0.5', note: '' })).toBe('USB-C, 5 V, 0.5 A')
  expect(powerText({ source: 'battery', kind: 'LiPo 1S', volts: '3.7', amps: '', note: 'in the lid' })).toBe('battery (LiPo 1S), 3.7 V: in the lid')
  expect(connectionText({ what: 'SHT40 sensor', bus: 'I2C', connector: 'JST-SH 4-pin' })).toBe('SHT40 sensor over I2C, JST-SH 4-pin')
})
it('holds each row to its caps', () => {
  expect(checkConnection({ what: 'x'.repeat(121), bus: 'I2C', connector: '' })).toBe('What plugs in is at most 120 characters.')
  expect(checkFab({ layers: 3, thickness: 1.6, assembly: 'jlc', boards: 5 })).toBe('A board has 2 or 4 layers here.')
  expect(checkFab({ layers: 2, thickness: 1.6, assembly: 'jlc', boards: 0 })).toBe('Between 1 and 10,000 boards.')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/projects src/main/cards/start.test.ts src/shared/slots.test.ts src/shared/projectName.test.ts`
Expected: FAIL

- [ ] **Step 3: Adapt `create.ts` and `start.ts`, write `slots.ts` and `readings.ts`, wire the channels and the sweep**

`brief.md` is `# <name>`, the description, and `## References` with one line per photo, doodle and PDF (`- reference/photo-1.jpg: <note>`; a doodle over a photo says `drawn over reference/photo-1.jpg`), as torno writes it. The cards are written in the temp folder before the rename, through `writeFileAtomic` (the one write under `.pino/` there); the `.gitignore` lines are the store's, later. `opened.ts` calls `sweepStaleNew(root, Date.now())` when a workspace is opened (`deps.sweep`). `project:create` lists the workspace again, opens the new project and answers it.

- [ ] **Step 4: Write the exception into `CLAUDE.md` and `workspace-writes.md`**

`CLAUDE.md`'s invariant becomes: "Never write inside a project folder except under `<project>/.pino/`. One exception: making a new project (`main/projects/create.ts`) writes one new folder `<workspace>/<name>/` with `brief.md`, `reference/` and `.pino/brief/cards.json`, made in a hidden `.<name>.pino-new-<12 hex>` and renamed into place last; it never writes into or replaces a folder that is there. Nothing is written in the workspace before Start." `workspace-writes.md` says the same with torno's detail (links never followed, files read as plain files and capped, the sweep) and adds `.pino/brief/` to "what is written, and by whom". Add `main/projects/**` and `main/cards/**` to its paths.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm test && pnpm -C app typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A app/src CLAUDE.md .claude/rules/workspace-writes.md shared-from-torno.json
git commit -m "Make a new project's folder whole or not at all, with brief.md, reference/ and the person's cards"
```

---

### Task 10: The New project page: torno's slots, and Make it without starting Claude

**Files:**
- Create: `app/src/renderer/state/onboard.ts`, `onboard.test.ts`, `app/src/renderer/ui/onboard/NewProject.tsx`, `DraftPane.tsx`, `DraftPane.test.ts`, `Slot.tsx`, `SizesSlot.tsx`, `LinksSlot.tsx`, `RulesSlot.tsx`, `ReferenceItems.tsx`, `Doodle.tsx`, `SessionChoice.tsx`, `images.ts`, `images.test.ts`, `attach.ts`, `make.ts`, `make.test.ts`, `liveDeps.ts`, `app/src/renderer/ui/ink/InkPad.tsx`, `strokes.ts`, `strokes.test.ts`, `app/src/renderer/ui/Confirm.tsx`, `app/src/renderer/styles/onboard.css`, `app/e2e/onboard.spec.ts`
- Modify: `app/src/renderer/App.tsx`, `app/src/renderer/state/store.ts` (`page: 'new'`), `app/src/renderer/ui/TitleBar.tsx` and `ProjectsPage.tsx` (New project enabled), `app/src/shared/keys.ts`, `app/src/shared/keys.test.ts`, `shared-from-torno.json`
- Copies (all adapted, with these changes): `state/onboard.ts` ("pino's draft: no STEP, scans or other projects; the PCB slots' rows; Size and shape's two fields"), `ui/onboard/NewObject.tsx` to `ui/onboard/NewProject.tsx` ("pino's slots and words"; `moved: "object is project in pino"`), `DraftPane.tsx`, `DraftPane.test.ts`, `Slot.tsx`, `SizesSlot.tsx` ("Size and shape: the sizes with four offered names, the enclosure and the connector edges"), `LinksSlot.tsx`, `RulesSlot.tsx`, `ReferenceItems.tsx` ("photos, doodles and PDFs only"), `Doodle.tsx`, `SessionChoice.tsx`, `images.ts`, `images.test.ts`, `attach.ts`, `make.ts`, `make.test.ts`, `liveDeps.ts` (each: "pino's channels and names"), `ui/ink/InkPad.tsx` ("no labels; pino's key rows"), `ui/ink/strokes.ts`, `strokes.test.ts` (as-is when they need no change), `ui/Confirm.tsx` (as-is), `styles/onboard.css` ("pino's tokens"). torno's `EmptyWorkspace.tsx` is not copied: an empty workspace opens on this page.
- Key rows, copied from torno's `shared/keys.ts` (`8086e7ca`) into pino's with a new scope `newproject` and context `New project`: `new.back` (Esc), `new.sketch` (S), `ink.undo` (Ctrl+Z, torno's `board.undo`), `sheet.round` (Tab, hidden). `keys.test.ts`'s `keyClashes()` stays `[]`.

**Interfaces:**
- Consumes: Task 9's channels, `CreateRequest`, `slots.ts`, `projectName.ts`.
- Produces:
  - `state/onboard.ts`: `Draft { name; description; photos: PhotoDraft[]; doodles: DoodleDraft[]; pdfs: PdfDraft[]; sizes: SizeDraft[]; enclosure: string; edges: string; rules: string; links: LinkDraft[]; power: PowerDraft[]; connections: ConnectionDraft[]; parts: PartDraft[]; fab: FabAsk | null }`; `PartDraft { key: string; what: string; note: string; reading?: PartReading; looking?: true; problem?: string }`; `Kind = 'photos' | 'doodles' | 'pdfs' | 'sizes' | 'links' | 'power' | 'connections' | 'parts'`; `onboard` store, `onboarding` actions (torno's, with `power*`, `connection*`, `part*`, `setFab`, `setEnclosure`, `setEdges`), `draftHas(draft)`. The draft is dropped when the workspace changes, and kept while the person goes to All projects and back; Discard empties it.
  - `make.ts`: `makeProject(draft: Draft, deps: MakeDeps, choice?: AgentChoice, start?: boolean): Promise<Outcome>`; `createRequest(draft: Draft): CreateRequest`; `previewDraft(draft: Draft): PromptPreviewDraft` (Task 12 sends it).
  - Page copy: field `Name` (checked as main checks it, against `project:taken`), `What it does` with photos beside it; tiles `Sketch it`, `Power`, `Connections`, `Size and shape`, `Parts I have`, `Fab and assembly`, `Rules`, `Links and PDFs` (Task 11 fills four of them; here they are tiles that open an empty slot); the right pane `DraftPane` (Task 12 fills its preview; here it shows the folder the project will have, `<workspace>/<name>/`), `SessionChoice`, `Start: make the project and ask Claude` (disabled until Task 12), `or make it without starting Claude`, `Discard`. Size and shape offers `Board width`, `Board height`, `Height limit`, `Mounting holes` as chips that add a row of that name, and the fields `Fits an enclosure` and `Connector edges`.
  - `App.tsx`: page `new` from `New project…`, the `New project` card, and a workspace with no projects.

- [ ] **Step 1: Copy every file, cut what pino has no slot for, then write the failing tests**

```ts
// state/onboard.test.ts (torno's cases for photos, doodles, sizes, links kept; then)
it("turns a draft into the request main makes the project from", () => {
  expect(createRequest(draftWith({ name: 'blinky', description: 'Blinks.', sizes: [row('Board width', '50')], enclosure: 'Hammond 1551K', rules: 'hand-solderable' }))).toMatchObject({ name: 'blinky', sizes: [{ what: 'Board width', value: '50', unit: 'mm', source: 'a guess' }], enclosure: 'Hammond 1551K', rules: 'hand-solderable', power: [], parts: [], fab: null })
})
// e2e/onboard.spec.ts
test('an empty workspace opens on the New project page, and nothing is written before Make it', async () => {
  // launch with an empty workspace: heading 'New project'; type name 'blinky' and What it does; readdirSync(root) is still []
})
test('Make it without starting Claude makes the folder whole and opens it on the Brief', async () => {
  // pickFiles answers one PNG for photos; Size and shape: Board width 50; Rules: 'hand-solderable'; click 'or make it without starting Claude'
  // the project opens, tab Brief; tree is ['.pino/brief/cards.json', 'brief.md', 'reference/photo-1.png']; no stand-in running (agentsIn(dir) [])
})
test('a name another folder has is refused before anything is made', async () => { /* mkdir Blinky; type blinky: the field says 'A folder `Blinky` is there already.' and Make it is disabled */ })
test('a sketch over the photo is a doodle in reference/', async () => { /* S, draw with page.mouse, Done; Make it: reference/doodle-1.png; brief.md says 'drawn over reference/photo-1.png' */ })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/state/onboard.test.ts src/renderer/ui/onboard src/renderer/ui/ink src/shared/keys.test.ts && pnpm test:e2e -- onboard.spec.ts`
Expected: FAIL

- [ ] **Step 3: Adapt the copies and wire the page**

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm test && pnpm -C app typecheck && pnpm test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A app/src app/e2e shared-from-torno.json
git commit -m "The New project page: name, what it does, photos, sketch, size and shape, rules, links and PDFs"
```

---

### Task 11: The PCB slots: power, connections, parts I have with their stock, fab and assembly

**Files:**
- Create: `app/src/renderer/ui/onboard/PowerSlot.tsx`, `ConnectionsSlot.tsx`, `PartsSlot.tsx`, `FabSlot.tsx`, `app/src/renderer/ui/onboard/parts.ts`, `parts.test.ts`
- Modify: `app/src/renderer/ui/onboard/NewProject.tsx`, `app/src/renderer/state/onboard.ts`, `onboard.test.ts`, `app/src/renderer/styles/onboard.css`, `app/e2e/onboard.spec.ts`, `app/e2e/real-kernel.spec.ts`, `app/test/fake-kernel.mjs` (a switch `FAKE_KERNEL_PARTS=unreachable`: no parts, a `parts_unavailable` error finding, headline `Parts: jlcsearch could not be reached`; its header lists it), `app/src/fakeKernel.test.ts`

**Interfaces:**
- Consumes: `parts:lookup` (Task 9), `slots.ts`, `readingLine`, `LCSC`.
- Produces:
  - `ui/onboard/parts.ts`: `LOOKUP_AFTER_MS = 400`; `partState(row: PartDraft): { kind: 'module' | 'looking' | 'read' | 'refused' | 'none'; said: string }` (`module`: `A module in words: Claude looks it up.`; `looking`: `Checking JLC…`; `read`: `readingLine(row.reading)`; `refused`: `Stock not checked: <why>.`; `none`: '' while the row is empty); `useStockCheck(row: PartDraft): void` (looks up an `LCSC` 400 ms after the last key, once per number; an answer for a number the row no longer holds is dropped).
  - Slots: Power rows of source (`POWER_SOURCES`), kind (shown for `battery`), volts, current (optional), note; at most `MAX_POWER`. Connections rows of what, bus (`BUSES`), connector; at most `MAX_CONNECTIONS`. Parts I have rows of an LCSC number or a module, and a note, with `partState` under each; at most `MAX_PARTS_HAD`. Fab and assembly: layers 2 or 4, thickness (`THICKNESSES`), `JLC assembles it`, `I solder it`, `A mix`, and how many boards; filled from `DEFAULT_FAB` when the tile is opened. Rows are kept as typed; one that `checkPower`/`checkConnection`/`checkPartHad` refuses says why under it and holds Make it.

- [ ] **Step 1: Write the failing tests**

```ts
// ui/onboard/parts.test.ts
it('says what a typed part is, as it stands', () => {
  expect(partState({ key: 'k', what: 'ESP32-C3 module', note: '' })).toEqual({ kind: 'module', said: 'A module in words: Claude looks it up.' })
  expect(partState({ key: 'k', what: 'C25804', note: '', looking: true })).toEqual({ kind: 'looking', said: 'Checking JLC…' })
  expect(partState({ key: 'k', what: 'C25804', note: '', reading: READING })).toEqual({ kind: 'read', said: 'basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)' })
  expect(partState({ key: 'k', what: 'C25804', note: '', problem: 'jlcsearch could not be reached' })).toEqual({ kind: 'refused', said: 'Stock not checked: jlcsearch could not be reached.' })
})
// e2e/onboard.spec.ts (FAKE_KERNEL_SERVE '3')
test('a part typed in Parts I have is checked against JLC as it is typed', async () => {
  // type C25804: the row says 'basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)'; type C1: 'JLC has no such part (checked …)'
})
test('a part typed while jlcsearch cannot be reached says so and does not hold Start', async () => {
  // env FAKE_KERNEL_PARTS 'unreachable': row says 'Stock not checked: jlcsearch could not be reached.'; Make it is enabled; the card has part { lcsc: 'C25804' } and no reading
})
test('every PCB slot becomes cards of the person, in frames', async () => {
  // Power USB-C 5 V 0.5 A; Connections SHT40 sensor I2C JST-SH 4-pin; Fab 4 layers; Make it: the Brief lists frames Power, Connections, Parts I have, Fab and assembly with 'USB-C, 5 V, 0.5 A', 'SHT40 sensor over I2C, JST-SH 4-pin', 'You asked for 4 layers, 1.6 mm, JLC assembles it, 5 boards'
})
// e2e/real-kernel.spec.ts
test('the New project page checks a part with the real engine from recorded answers', async () => {
  // env as #8's parts case (UV_NO_SYNC, UV_OFFLINE, PINO_PARTS_RECORDED, PINO_CACHE_DIR temp); empty workspace; C25804 row says 'basic · 0603'; readdirSync(root) is []
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer/ui/onboard/parts.test.ts && pnpm test:e2e -- onboard.spec.ts`
Expected: FAIL

- [ ] **Step 3: Write the four slots and the stock check, and open them from their tiles**

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm test && pnpm -C app typecheck && pnpm test:e2e`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A app/src app/e2e
git commit -m "The PCB slots: power, connections, parts checked against JLC as they are typed, fab and assembly"
```

---

### Task 12: The first prompt, and Start

**Files:**
- Create: `app/src/main/onboard.ts`, `app/src/main/onboard.test.ts`, `.claude/rules/new-project.md`
- Modify: `app/src/main/ipc.ts`, `app/src/main/index.ts`, `app/src/preload/index.ts`, `app/src/shared/bridge.ts`, `app/src/renderer/ui/onboard/NewProject.tsx`, `DraftPane.tsx`, `make.ts`, `app/src/renderer/state/onboard.ts`, `app/src/renderer/ui/chat/StartChat.tsx`, `app/e2e/onboard.spec.ts`, `CLAUDE.md` (rules by area), `shared-from-torno.json`
- Copies: `app/src/main/onboard.ts` and `onboard.test.ts` adapted ("a board's first prompt in torno's long form only: what to settle before board.py, parts checked, findings as cards; PCB slots; no scans, STEP or other projects"); `.claude/rules/new-object-onboard.md` to `.claude/rules/new-project.md` adapted ("pino's create, page and first prompt"), `moved: "object is project in pino"`.

**Interfaces:**
- Consumes: Task 5's `Sessions.sendBlocks`, `CardStore.markTold`/`told` (through `cardsLine`, so the first prompt's line reads `(0 new)`), Task 9's checks, Task 10's `previewDraft`.
- Produces:
  ```ts
  export const SETTLE = [
    'what the board connects to and how each thing talks',
    'how it is powered and what it draws',
    'where it has to fit, its mounting holes and which edge each connector sits on',
    'which parts it uses and whether JLC has them',
    'how many layers it has and who assembles it'
  ] as const
  export interface PromptInput {
    name: string; description: string
    items: Array<{ file: string; note: string; image?: ImageBytes; over?: true }>
    pdfs: Array<{ file: string; note: string }>
    power: PowerRow[]; connections: ConnectionRow[]; sizes: SizeFact[]; enclosure: string; edges: string
    parts: Array<{ what: string; note: string; reading?: PartReading }>; fab: FabAsk | null; rules: string; links: Array<{ url: string; note: string }>
  }
  export function onboardPrompt(input: PromptInput, toolName?: (t: string) => string): { text: string; held: string; blocks: PromptBlock[]; attached: Array<number | null> }
  export function previewPrompt(name: string, draft: PromptPreviewDraft, toolName?: (t: string) => string): PromptPreview
  export interface OnboardDeps {
    project(id: string): ProjectInfo | undefined
    sessions: Pick<Sessions, 'start' | 'current' | 'sendBlocks'>
    cards: Pick<CardStore, 'read' | 'markTold'>
    readings: Readings
    toolName: (t: string) => string
  }
  export function onboardProject(deps: OnboardDeps, projectId: string, draft: OnboardDraft): Promise<Onboarded>
  ```
  - `OnboardDraft` (bridge): the slot fields of `CreateRequest`, `items` (each picture's `reference/` file, note, the window's PNG or JPEG scaled to 1280 px, `over`), `pdfs` by file, and `choice?: AgentChoice`. `PromptPreviewDraft`: the same with `hasImage: boolean` in place of the bytes. `Onboarded = { sessionId: string | null; prompt: string; held: string; problem?: string }`.
  - IPC: `project:onboard(projectId, draft) -> Onboarded`, `project:previewPrompt(name, draft) -> PromptPreview`.
  - The prompt's text (long form, the only form; `held` is the same with every picture `not attached: read reference/<file>`):
    - `This is a new board, <name>, made in pino just now. What it does, in the person's words:`, a blank line, the description.
    - `What they gave (all of it is also in brief.md; files are in reference/):` and a line per photo, doodle and PDF (torno's wording; a PDF `A PDF; read it with your own tools if it helps.`).
    - Then each slot that holds something, in this order: `Power:` (`- <powerText>`), `Connections:` (`- <connectionText>`), `Size and shape:` (`- <saySize>`, `- Fits an enclosure: <note>`, `- Connector edges: <text>`), `Parts they have:` (`- C25804: pull-up · basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)`, a part with no reading says `stock not checked`, a module `- ESP32-C3 module: <note>`), `Fab and assembly: <fabText>.`, `Rules:` and the text, `Links (pino does not open links; read one only if it helps):`.
    - The doodle lines as torno's (grid: `1 square = 40 px`, or ink over a photo).
    - `There is no board.py yet. All of the above is kept for later conversations: brief.md holds their words and each slot is a card of theirs (<brief>); you need not read them now.`
    - `Before you write board.py, settle what would make the first board wrong: <SETTLE joined with ", " and ", and " before the last>. Something has a source when the person gave it above, or a picture, a PDF or a link says it; what they gave is not asked again.`
    - `Ask the person in one round, before you write board.py, with AskUserQuestion, only what would change the board, and for a value one option a typical value labelled as typical ("3.3 V from an LDO, usual for an ESP32-C3"). The person may answer "build with assumptions". If nothing would change the board, ask nothing.`
    - `Check every part you mean to use with <parts>, basic parts first. Then, before you write board.py, write what you settled as cards of yours with <add_card>, one per topic: a requirement, a decision with its reason, an open question with what waits on it, each part by LCSC number, and the power budget of each rail. With fab and assembly given, set layers in Board(...) of board.py to what they asked; pino picks the fab profile for that layer count. Your reply lists what you assumed.`
  - `StartChat.tsx`: with a first prompt held for the project (`onboard.held[projectId]`), the start buttons read `New session` as now and the line `The first prompt is kept: it goes when you start a session.`; starting sends it as text with `chat.send`.

- [ ] **Step 1: Copy `onboard.ts` and its test, adapt the input, then write the failing tests**

```ts
// main/onboard.test.ts
const t = (tool: string) => `mcp__pino__${tool}`
it('says what to settle before board.py, once, and names the tools pino has', () => {
  const { text } = onboardPrompt(input({ name: 'blinky', description: 'Blinks an LED.' }), t)
  expect(text).toContain('Before you write board.py, settle what would make the first board wrong: what the board connects to and how each thing talks, how it is powered and what it draws, where it has to fit, its mounting holes and which edge each connector sits on, which parts it uses and whether JLC has them, and how many layers it has and who assembles it.')
  expect(text.match(/Before you write board\.py, settle/g)).toHaveLength(1)
  // TOOL_NAMES: the eighteen names of turncost.test.ts's UP_FRONT and DEFERRED
  for (const tool of text.match(/mcp__pino__\w+/g) ?? []) expect(TOOL_NAMES).toContain(tool.slice('mcp__pino__'.length))
  expect(text).toContain(`write what you settled as cards of yours with ${t('add_card')}`)
})
it('tells every slot in its words, and leaves out the empty ones', () => {
  const { text } = onboardPrompt(input({ power: [usbC], parts: [{ what: 'C25804', note: 'pull-up', reading: READING }, { what: 'C51118', note: '' }], fab: DEFAULT_FAB }), t)
  expect(text).toContain('Power:\n- USB-C, 5 V, 0.5 A')
  expect(text).toContain('Parts they have:\n- C25804: pull-up · basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)\n- C51118: stock not checked')
  expect(text).toContain('Fab and assembly: 2 layers, 1.6 mm, JLC assembles it, 5 boards.')
  expect(text).not.toContain('Connections:')
})
it('attaches at most six pictures, each after a line that names it', () => { /* torno's case: 8 photos -> 6 image blocks, the rest 'not attached: read reference/photo-7.png' */ })
it('the preview is the text that is sent', async () => { /* previewPrompt(name, draft).text === onboardPrompt(sameInput).text with stand-in pictures */ })
it('refuses a draft that is not what it may be, before any session starts', async () => { /* a picture not in reference/, 41 sizes, a connection over its cap: rejects; sessions.start not called */ })
it('a session that cannot start is not a rejection: the prompt comes back to be held', async () => { /* start answers { refused }: { sessionId: null, held, problem: refused } */ })
it("marks the Brief told before the prompt goes, so its line says nothing new", async () => { /* cards.markTold called with every card before sendBlocks */ })
// e2e/onboard.spec.ts (agent: true)
test('Start makes the project, opens it on the Brief and sends the first prompt with its picture', async () => {
  // one photo; Start: the chat's first user item starts 'This is a new board, blinky, made in pino just now.'; the stand-in's session is in the folder (agentsIn(dir) length 1)
  // the item's context says 'Brief: <n> cards (0 new).'
})
test('the right pane shows the first prompt as main writes it, as the slots fill', async () => { /* type a power row: the pane contains 'Power:\n- USB-C, 5 V' */ })
test('with no Claude Code, Start makes the project and keeps the first prompt for later', async () => {
  // agent: false: the dock says the refusal and 'The first prompt is kept: it goes when you start a session.'
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C app exec vitest run src/main/onboard.test.ts && pnpm test:e2e -- onboard.spec.ts`
Expected: FAIL

- [ ] **Step 3: Write the prompt, `onboardProject` and `previewPrompt`; wire Start, the preview and the held prompt**

`onboardProject` checks the draft whole (the checks of Task 9, the pictures by `checkedImage`, at most `MOST_IMAGES`), refuses a project that is not the open one or that has a session (`sessions.current`), one onboarding at a time per project (a set entered before anything is done, freed in `finally`), starts the session on the draft's choice, calls `markTold` with what `cardsLine` would tell, then `sendBlocks`. A part's reading in the prompt comes from `deps.readings`, never from the draft. `DraftPane` asks `project:previewPrompt` 300 ms after the draft last changed and shows the text with the person's words marked, as torno's.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm test && pnpm -C app typecheck && bash .claude/hooks/guard-bash.test.sh && pnpm test:e2e`
Expected: PASS

- [ ] **Step 5: Write `.claude/rules/new-project.md` (paths: `app/src/main/onboard.ts`, `app/src/main/onboard.test.ts`, `app/src/main/projects/**`, `app/src/shared/slots.ts`, `app/src/shared/projectName.ts`, `app/src/renderer/state/onboard.ts`, `app/src/renderer/ui/onboard/**`, `app/src/renderer/ui/ink/**`, `app/e2e/onboard.spec.ts`), name it in `CLAUDE.md`, and commit**

```bash
git add -A app/src app/e2e .claude/rules CLAUDE.md shared-from-torno.json
git commit -m "Start: the first prompt settles what is missing, checks the parts and writes cards before board.py"
```

---

## After the last task

- Run `node scripts/torno-sync` and read its report: every new entry at `8086e7ca`, no as-is copy changed. `app/src/tornoSync.test.ts`'s real-checkout case passes against `~/projects/torno` (it holds the commit object).
- The leak audit (Luis's rule): search the tree and every commit of the branch for personal data, local paths and deployment details (`git log -p main..HEAD | rg -n '/home/|luisg|@'`); test fixtures use temp folders only.
- Check by hand, outside the tests, once: pino against the real Claude Code on a new project in a scratch workspace (the first question round, cards written before `board.py`, a `Write` of `brief.md` refused). Say in the PR body that it was done or not.
- The PR body lists the calls made here (below) for Luis to check.

## Calls made in this plan, for Luis to check

- `shared-from-torno.json` gains `moved` for a copy a pino rule renames (`objects/` to `projects/`, torno's board of cards to `cards`, `show/cards.ts` to `thumb.ts`); `CLAUDE.md`'s copy invariant says so. The design asked for the renames; the manifest's path test did not allow them.
- No cards of main's own: the description and pictures live in `brief.md` and `reference/` (the page reads the notes from `brief.md`'s References), and only the other slots become cards, in frames. Two kinds beyond the design's list: `connection` (the Connections slot) and `fab` (what the person asked of the fab).
- `All projects` closes the open project (one project open at a time, as today's Close project) instead of lying over it as torno's page does.
- "Use ~/boards" makes the folder when it is not there. The home folder and `/` are never a workspace.
- "Opens where it was left" is the tab remembered per project in the window's storage.
- Two card tools, `brief` and `add_card` (which also changes and removes, as torno's does): the "siblings" are `brief`.
- "Check stock again" asks the engine's `parts get`, which answers from its cache for 24 hours; the row says the date jlcsearch checked it.
- Sizes are compared with the drawn build's board box (builds carry no `outline.json`), for size cards named `Board width` and `Board height`.
- Leaving the New project page keeps the draft instead of asking; Discard empties it.
- Torno's "Show prompt N in the chat" is left out of the spine.
