---
paths:
  - "app/e2e/**"
  - "app/playwright.config.ts"
  - "app/src/e2e.test.ts"
  - "app/src/main/testProfile.ts"
  - "app/src/main/testProfile.test.ts"
---

# Testing the app in a hidden window: every launch of Electron

## About the folder (`app/e2e`)

The Playwright specs, which start the built app. The rules here bind every launch of Electron, by a test, a script or
a check, whoever makes it.

## Testing the app in a hidden window

The person is working on this desktop. No test, script or check may put a window on it or take the focus.

- Every spec launches through `e2e/launch.ts` (`src/e2e.test.ts` holds it). It always sets `PINO_TEST=1`: main then
  creates the window with `show: false`, never shows it, and exposes the test hooks.
- Under `PINO_TEST=1` Electron's own profile (`userData`, `sessionData`, `crashDumps`) is a folder of the run,
  `<tmp>/pino-test-<pid>-…` (`src/main/testProfile.ts`), set before `ready` and removed once the process has gone.
  Only a spec of what is kept across a relaunch names one, a `tempFolder`, in `PINO_TEST_PROFILE`.
  `launch` also gives the run a `HOME` and XDG folders of its own in the temporary folder, and a config file of its
  own, so nothing of a test is written under the person's home. It sets `PINO_PARTS_OFFLINE=1`, so the real engine
  asks jlcsearch nothing. A check that launches Electron without `PINO_TEST`
  must give it a `--user-data-dir` of its own.
- A run never reaches the real `claude`: with `agent` the command is the stand-in, without it a path that is not
  there.
- Never pass an ozone platform of `headless`: Electron segfaults with it here.
- No test and no check runs `scripts/pino --install-desktop` or `--uninstall-desktop` with the person's own `HOME` or
  `XDG_DATA_HOME`: `src/launcher.test.ts` gives the script a temporary one of each. The entry is tested by
  `--print-desktop`, which writes nothing.
- `page.screenshot()` never returns on a hidden window. Do not call it. Do not touch the clipboard. What takes a
  picture is `e2e/shots.spec.ts` alone, through main's `capturePage()` (`helpers.ts` `capture`), and only with
  `PINO_SHOTS` naming a folder outside the repository. A hidden window gives **one** picture a launch, and **none**
  once it has been resized with a board drawn (the call never returns): a shot of another size is a launch with
  `PINO_TEST_SIZE=1920x1080`, which main reads under test alone (`frame.ts` `windowSize`). No spec resizes.
- A CI runner has no GPU, and Chromium makes no WebGL context there unless asked to draw it in software: `launch.ts`
  passes `--enable-unsafe-swiftshader` when `CI` is set. The app itself never does. A run that must have no WebGL
  passes `--disable-gpu --disable-software-rasterizer` (`--disable-webgl` and `--disable-3d-apis` leave it on).
- Every spec runs the engine's stand-in (`app/test/fake-kernel.mjs`, whose header lists its switches).
  `real-kernel.spec.ts` alone asks for the real engine (`launch({ kernel: 'real' })`), and is skipped where uv,
  kicad-cli or `kernel/.venv` is missing; it runs uv offline, so nothing is fetched into the run's empty home.
- A CSS animation that never ends grows a hidden window's memory for as long as it runs: there is none, and
  `styles/styles.test.ts` fails for one.
- State is read through hooks, not pixels: `window.__pinoTest.state()` in the window, and `globalThis.__pinoMain` in
  main (`app.evaluate`) for a project's MCP address and a token that opens it (`mcpFor(id)`: send the token in the
  `X-Pino-Session` header, or every request is 404) and the config file (`configPath()`).
- `page.mouse` and `page.keyboard` work on the hidden window.
- A test works on a temporary folder (`tempProject`), never on a real project.
- Never click "Open folder" unless main runs with `PINO_TEST=1`: only then is the folder dialog replaced by
  `globalThis.__pinoMain.pickFolder` (the folder to answer with, or null), and `picks` counts the times it was asked.
- A test kills only processes it or its app started, by pid. `agentsIn(folder)` (`e2e/terminal.ts`) finds the
  stand-ins running in a folder.
- `PINO_TEST=1` also skips the single-instance lock, so test launches can run side by side.
