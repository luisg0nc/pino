// The files of a build and of a route, read for the window and for pino's tools. Only what a build's own result
// lists, from inside that build's folder: a name or a path that leads anywhere else is refused.

import { readFile, realpath } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { APP } from '../shared/app'
import { ARTIFACTS, buildResultOf, type ArtifactName, type BuildResult } from '../shared/build'
import type { ProjectInfo } from '../shared/project'
import { ownFolder } from './own'

export const BUILD_HASH = /^[0-9a-f]{12}$/
export const ROUTE_KEY = /^[0-9a-f]{8,64}$/

const ROUTE_FILES = { board: 'board.kicad_pcb', filled: 'filled/board.kicad_pcb', route: 'route.json', glb: 'board.glb' } as const
export type RouteFile = keyof typeof ROUTE_FILES

/** Whether `path` lies inside `folder` (both absolute and normal). */
function within(folder: string, path: string): boolean {
  const from = relative(folder, path)
  return from !== '' && from !== '..' && !from.startsWith(`..${sep}`) && resolve(folder, from) === path
}

const outside = (name: string) => new Error(`${name} is not in the folder of its build`)

export function artifactPath(project: ProjectInfo, hash: string, name: ArtifactName, result: BuildResult): string {
  if (!BUILD_HASH.test(hash)) throw new Error('not a build hash')
  const listed = (ARTIFACTS as readonly string[]).includes(name) ? result.artifacts[name] : undefined
  if (typeof listed !== 'string') throw new Error(`h${result.number} has no ${name}`)
  const path = resolve(project.dir, listed)
  if (!within(join(project.dir, APP.folder, 'build', hash), path)) throw outside(name)
  return path
}

export function routePath(project: ProjectInfo, key: string, name: RouteFile): string {
  if (!ROUTE_KEY.test(key)) throw new Error('not a route key')
  if (!Object.hasOwn(ROUTE_FILES, name)) throw new Error(`a route has no ${name}`)
  return join(project.dir, APP.folder, 'routes', key, ROUTE_FILES[name])
}

/** The file at `path`, once `.pino` and the folders down to `folder` are the project's own and no link leads out. */
async function readIn(project: ProjectInfo, inside: string[], path: string, name: string): Promise<Buffer> {
  const folder = await ownFolder(project.dir, ...inside)
  const [real, root] = await Promise.all([realpath(path), realpath(folder)])
  if (!within(root, real)) throw outside(name)
  return readFile(real)
}

/** A file of a build: text, and the model's bytes as they are. */
export async function readArtifact(project: ProjectInfo, hash: string, name: ArtifactName, result: BuildResult): Promise<string | Uint8Array> {
  const path = artifactPath(project, hash, name, result)
  const bytes = await readIn(project, ['build', hash], path, name)
  return name === 'glb' ? new Uint8Array(bytes) : bytes.toString('utf8')
}

/** A file of a route, as a build's are read: text, and the model's bytes as they are. */
export async function readRouteFile(project: ProjectInfo, key: string, name: RouteFile): Promise<string | Uint8Array> {
  const path = routePath(project, key, name)
  const bytes = await readIn(project, ['routes', key], path, name)
  return name === 'glb' ? new Uint8Array(bytes) : bytes.toString('utf8')
}

/** The result of the build with this hash: one already in hand, else the `result.json` its folder keeps. */
export async function resultOfBuild(project: ProjectInfo, hash: string, inHand: ReadonlyArray<BuildResult | null>): Promise<BuildResult> {
  if (!BUILD_HASH.test(hash)) throw new Error('not a build hash')
  const held = inHand.find((r) => r?.hash === hash)
  if (held) return held
  const path = join(project.dir, APP.folder, 'build', hash, 'result.json')
  const kept = await readIn(project, ['build', hash], path, 'result.json').then(
    (bytes) => buildResultOf(JSON.parse(bytes.toString('utf8'))),
    () => null
  )
  if (!kept || kept.hash !== hash) throw new Error(`build ${hash} is no longer kept`)
  return kept
}
