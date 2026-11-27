import { join } from 'node:path'
import { app } from 'electron'
import { APP } from '../shared/app'

/**
 * The engine's Python project (the folder with its pyproject.toml). In
 * development that is the repository's `kernel/`, beside `app/`; a packaged app
 * carries a copy in its resources.
 */
export function kernelDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'kernel') : join(app.getAppPath(), '..', 'kernel')
}

/**
 * The window's icon, where the desktop takes it from the window (X11; on Wayland the desktop entry's is shown, by the
 * app id): the icon beside the launcher, `scripts/pino.png`, which is `scripts/pino.svg` drawn at 512 px
 * (`rsvg-convert -w 512 -h 512`; Electron reads no SVG). A packaged app carries a copy in its resources.
 */
export function windowIconFile(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), '..', 'scripts', `${APP.name}.png`)
}
