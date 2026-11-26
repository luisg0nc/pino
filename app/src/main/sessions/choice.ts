import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The file a command names: itself when it is a path, else the first match on PATH. */
export function findCommand(command: string, path = ''): string | null {
  const candidates = command.includes('/') ? [command] : path.split(delimiter).filter(Boolean).map((dir) => join(dir, command))
  for (const file of candidates) {
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return file
    } catch {
      // Not here.
    }
  }
  return null
}
