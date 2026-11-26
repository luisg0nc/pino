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
---

# The first screen, the title bar, recent folders

## The first screen

- The folders opened lately are `recent` in pino's own config file (`~/.config/pino/config.json`, or `PINO_CONFIG`;
  `src/main/recent.ts`): the newest first, eight at most, beside `project`, the one to open at the next start. Never
  in a project. One that is no longer a folder is shown struck as "Not found" and cannot be pressed. A test run reads
  and writes no config file but one it names with `PINO_CONFIG`.
- A project is one folder (`main/project.ts`): opened by its real path, with an id that is a hash of it, so no path
  reaches a URL. A folder named at start (`PINO_PROJECT`) that cannot be opened is said on the first screen; a
  remembered one that is gone is only listed as missing. "Close project" forgets `project`.
- Opening another project, or closing the open one, ends the session first (`stopAll`, which also waits for one that
  is starting). A second pino opens the folder it was given only when none is open in the first, and otherwise says
  so in a notice.
- With no project open the window is `ui/Welcome.tsx`, two halves of one grid (`welcome.css`) to the window's edges:
  at the left the dyed plate (`ui/plate/Plate.tsx`, its children on `--dye`), at the right, on `--surface`, the one
  way in, "Open folder", and what the stage does not do yet. Coming back, "Recent folders" stands where the first
  run's sentence does. The error of a folder that did not open is one `role="alert"` line.
- **The first screen has no title bar and the window no frame**, so the top 40 px (`welcome-drag`) is a drag strip
  over both halves, and the window controls (`BareControls`) stand over its right end. pino draws the three controls
  itself everywhere (`ui/WindowControls.tsx`): it is Linux only.
- **The logo and the first screen's drawing are placeholders** until the design mocks: `ui/Logo.tsx` is the word
  `pino` in Instrument Sans 600, and the plate has no drawing.
- With a project open, the title bar (`ui/TitleBar.tsx`) has the logo, the project's crumb and its menu
  (`ui/FolderMenu.tsx`, `useMenu` for its keys): the recent folders (the open one marked "current"), "Open folder…"
  and "Close project".

## Quitting

- Closing the window ends pino and its session. `before-quit` waits, once and 3 s at most, for `stopAll` and for the
  config file (`quit.ts` `quitGate`); what is still there at `will-quit` is killed (`killAll`). The window asks no
  question before it closes yet.
