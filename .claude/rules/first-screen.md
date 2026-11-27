---
paths:
  - "app/src/renderer/ui/openFolder.ts"
  - "app/src/renderer/ui/openFolder.test.ts"
  - "app/src/main/index.ts"
  - "app/src/main/project.ts"
  - "app/src/main/recent.ts"
  - "app/src/main/recent.test.ts"
  - "app/src/main/quit.ts"
  - "app/src/main/quit.test.ts"
  - "app/src/renderer/ui/Welcome.tsx"
  - "app/src/renderer/ui/FolderMenu.tsx"
  - "app/src/renderer/ui/TitleBar.tsx"
  - "app/src/renderer/ui/WindowControls.tsx"
  - "app/src/renderer/App.tsx"
  - "app/src/renderer/ui/Logo.tsx"
  - "app/src/renderer/ui/plate/Plate.tsx"
  - "app/src/renderer/styles/plate.css"
  - "app/src/renderer/styles/welcome.css"
  - "app/e2e/welcome.spec.ts"
  - "app/src/main/opened.ts"
  - "app/src/main/opened.test.ts"
  - "app/src/main/workspace.ts"
  - "app/src/main/workspace.test.ts"
  - "app/src/renderer/ui/ProjectsPage.tsx"
  - "app/src/renderer/styles/projects.css"
  - "app/e2e/workspace.spec.ts"
---

# The first screen, the workspace, the title bar, the page of projects

## The workspace and its projects

- A **workspace** is one folder of boards; its projects are its direct subfolders that are not hidden and not links
  (`main/workspace.ts`), by name. A board is one that holds `board.py` as a plain file; one with `brief.md` alone has
  no board yet; one with neither is empty. The home folder, `/` and any folder that holds the home folder are never a
  workspace, and a listed project whose real folder is the home folder or holds it is not opened: an open project is
  written into.
- `main/opened.ts` holds the open workspace and its one open project, and every rule of opening and leaving them. The
  window names a project and is given only one the workspace lists. A project is opened by its real path
  (`main/project.ts`), with an id that is a hash of it, so no path reaches a URL.
- pino's own config file (`~/.config/pino/config.json`, or `PINO_CONFIG`; `main/recent.ts`) holds `workspace` and
  `project`, the ones to open at the next start, and `workspaces`, those opened lately: the newest first, eight at
  most. Never in a project. A config from before there were workspaces has `recent` project folders: their parents
  become `workspaces`, once. A test run reads and writes no config file but one it names with `PINO_CONFIG`.
- **A folder given to pino** by the dialog ("Choose folder…", "Open workspace…") is held to the rule of a folder named
  at start, below: a project opens its parent on it, and one in the home folder or at `/` is refused with the reason.
- **A folder named at start** (`PINO_PROJECT`, the launcher's argument) that is a project (`board.py` or `brief.md`)
  opens its parent as the workspace, on it; any other folder is a workspace. The project open last is opened again as
  a project whatever it holds, so an empty board is not taken for a workspace. A project directly in the home folder
  (or at `/`) leaves the first screen, which says why. A folder named at start that cannot be opened is said too; a
  remembered one that is gone is quiet, and the remembered workspace is shown.
- Opening another project or workspace, or going to All projects, ends the session first (`stopAll`, which also waits
  for one that is starting). All projects closes the project: one is open at a time. A second pino opens the folder it
  was given only when no project is open in the first, and otherwise says so in a notice.

## The first screen

- With no workspace the window is `ui/Welcome.tsx`, two halves of one grid (`welcome.css`) to the window's edges: at
  the left the dyed plate (`ui/plate/Plate.tsx`, its children on `--dye`), at the right, on `--surface`, the ways in,
  "Use ~/boards" ("Open ~/boards" when it is there; made if it is not, refused if a link or a file stands there) and
  "Choose folder…", and what pino needs. Coming back, "Recent workspaces" stands where the first run's sentence does;
  one that is gone is struck as "Not found" and cannot be pressed. The error of a folder that did not open is one
  `role="alert"` line.
- **The first screen has no title bar and the window no frame**, so the top 40 px (`welcome-drag`) is a drag strip
  over both halves, and the window controls (`BareControls`) stand over its right end. pino draws the three controls
  itself everywhere (`ui/WindowControls.tsx`): it is Linux only.
- **The mark is pin one** (`ui/pinOne.ts`): a chip seen from above, eight legs, pin 1 in the accent, and the pin-1
  dot cut out of the body (even-odd rule), so it works on any background. `ui/Logo.tsx` draws it with no tile (at 16
  and 20 px from the drawing made on whole pixels). The first screen carries it as a scribed drawing
  (`ui/plate/PinOneDrawing.tsx`, `plate.css`) that is made once, in 1.6 s, and stands drawn when less motion
  is asked for. `scripts/pino.svg` and `pino-16.svg` are what the shapes draw (`pinOne.test.ts`); after a change
  there, redraw `scripts/pino.png` with `rsvg-convert -w 512 -h 512 scripts/pino.svg -o scripts/pino.png`.
- Under the way in, three lines say whether Claude Code, KiCad and the engine are there (`shared/ready.ts`). Main
  asks the engine `version` once a run (`main/engineInfo.ts`), only when the screen asks.

## The title bar and the page of projects

- With a workspace open, the title bar (`ui/TitleBar.tsx`) has the logo and the workspace's crumb
  (`ui/FolderMenu.tsx`; button "Workspace <name>", menu "Workspaces": the recent workspaces, the open one marked
  "current", and "Open workspace…"). On a project, a slash and its crumb ("Project <name>", menu "Projects": "New
  project…", "All projects", then every project, the open one "current", an empty one "empty"). Both lists are read when the menu opens (`useMenu` for the keys; it moves the focus into a menu in a layout effect, so the menu has
  them as soon as it is drawn). The pages that listen for keys, and the Brief's picture opened large, leave a
  focused `[role="menu"]` its keys (`e2e/menus.spec.ts` holds this and the focus); the ink pad does not, and covers the
  title bar's menus. The menus and their rows are `.menu` and
  `.menu-item` (`viewbars.css`), as are the view cube's. A recent workspace's row is two lines (name, path), so its
  style is `.menu-item.folder-item` (`titlebar.css`): `.folder-item` alone loses its height and padding to
  `.menu-item`, which comes later in the cascade (`e2e/menus.spec.ts` holds the rows apart).
- With a workspace and no project, `ui/ProjectsPage.tsx` (`projects.css`; `main` "All projects", the list "Projects in
  <workspace>"): New project first, then a card a board, "No board yet" or "Empty" where there is no `board.py`. Arrows
  move between cards (`boards.move`), Enter opens, a typed letter goes to "Filter projects", Escape clears it. The
  listing is read again whenever the window is come back to. What pino needs and does not have stands at the foot.
- A workspace with no projects opens on the New project page (`ui/onboard/NewProject.tsx`, see `new-project`); so do
  "New project…" and the New project card.

## Quitting

- Closing the window ends pino and its session. `before-quit` waits, once and 3 s at most, for `stopAll` and for the
  config file (`quit.ts` `quitGate`); what is still there at `will-quit` is killed (`killAll`). The window asks no
  question before it closes yet.
