---
paths:
  - "scripts/**"
  - "app/src/launcher.test.ts"
  - "app/src/main/loginPath.ts"
  - "app/src/main/loginPath.test.ts"
  - "app/electron-builder.yml"
  - "app/src/main/paths.ts"
  - "app/e2e/packaged.spec.ts"
  - ".github/workflows/release.yml"
---

# The launcher, the desktop entry and the package

Linux only.

## The package

- `pnpm dist:linux` makes `app/dist/pino-<version>.AppImage` and `pino-app-<version>.tar.gz` (`electron-builder.yml`);
  `pnpm pack:check` makes the folder alone, `app/dist/linux-unpacked`. The version is the one in `app/package.json`,
  which the root `package.json` repeats (`ci.test.ts`). The engine's version (`kernel/`) is its own.
- The package carries the engine's sources beside the asar (`resources/kernel`: `pyproject.toml`, `uv.lock`, `NOTICE`,
  `src/`), the window's icon, `LICENSE` and `NOTICE`. uv, KiCad 10 and Claude Code stay the person's. A new thing main
  reads from the repository is added to `extraResources` and found through `main/paths.ts`.
- Packaged, the engine is `uv run --frozen --no-dev` on that folder, with its environment in
  `<userData>/kernel-env` and no bytecode (`kernel/client.ts` `kernelCommand`, `kernelEnv`): an AppImage is read-only,
  and mounted somewhere new at every start. `run_board.py` passes `-B` on to the child that runs `board.py`, since
  `-I` reads no `PYTHON*` variable. Nothing is ever written in the package.
- `PINO_PACKAGED=<executable> pnpm -C app exec playwright test e2e/packaged.spec.ts` checks the folder or the
  AppImage, hidden. CI does not run it: run it by hand after a change to the package, the engine's start or its files.
- `.github/workflows/release.yml`: a `v*` tag runs the checks, builds both files and puts them on a draft release;
  `workflow_dispatch` is a dry run that makes none. The notes are written by hand.
- The package installs no desktop entry and does not update itself.

## `scripts/pino`

- `scripts/pino [folder]` installs the dependencies if they are missing, builds the app when its sources changed since
  the last build that succeeded, and starts Electron on it. A folder goes in `PINO_PROJECT`, by its real path, never
  as an argument; `--` ends the options, so a folder may begin with a dash. The command is made once:
  `--print-command` prints what would be started and starts nothing.
- The stamp (`app/out/.built`) is a hash of the sources' paths and contents (`app/src` without tests, the app's
  `package.json`, build config and `tsconfig.json`, the lockfile), not a time. A failed build leaves no stamp.
- It is a POSIX `sh` script and holds the app's name in one variable, `app_name`, which a test holds equal to
  `APP.name`.
- `PINO_OZONE` (`wayland` or `x11`) tells Electron the platform; `headless` is refused, whoever asks, and under
  `PINO_TEST=1` no platform is passed at all.
- `--print-desktop`, `--install-desktop` and `--uninstall-desktop` are all it ever writes outside the repository, one
  file under the person's data folder, and only when asked. Never as root. `--from-desktop` makes what goes wrong a
  notice (`notify-send`) or a line in `${XDG_STATE_HOME:-~/.local/state}/pino/launcher.log`.
- A desktop start has a thin `PATH`: main asks the login shell for its own (`loginPath.ts`) before any session.
- No test and no check installs a desktop entry in the person's home, or starts the real app:
  `src/launcher.test.ts` gives the script a temporary `HOME` and data folder, and builds against a stand-in
  repository.

## The icon

- `scripts/pino.svg` is the mark, pin one, on a paper tile, and `pino-16.svg` the 16 px drawing; both are what
  `ui/pinOne.ts` draws (`pinOne.test.ts` holds them to it). The desktop entry names `pino.svg`.
  `scripts/pino.png` is the same at 512 px (`rsvg-convert -w 512 -h 512 scripts/pino.svg -o scripts/pino.png`), for
  the window: Electron reads no SVG. Change one, render the other.
- `app.setName`, `setDesktopName('pino.desktop')` and the entry's `StartupWMClass=pino` are how the desktop matches
  the window to its entry.
