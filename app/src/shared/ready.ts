// Whether what pino needs is on this machine, as the first screen says it.

export interface EngineInfo {
  /** Claude Code's command was found. */
  claude: boolean
  /** The engine's version; null when it did not answer. */
  kernel: string | null
  /** KiCad's version, once the engine has found kicad-cli and KiCad's libraries. */
  kicad: string | null
  /** Why the engine did not answer. */
  problem: string | null
}

export interface ReadyLine {
  ok: boolean
  text: string
}

export function readyLines(info: EngineInfo): ReadyLine[] {
  const claude = info.claude ? { ok: true, text: 'Claude Code is ready' } : { ok: false, text: 'Claude Code was not found: install it, then start pino again' }
  if (info.kernel === null) return [claude, { ok: false, text: `pino's Python environment did not start: ${info.problem ?? 'it did not say why'}` }]
  const kicad = info.kicad ? { ok: true, text: `KiCad ${info.kicad} found, with its libraries` } : { ok: false, text: 'KiCad was not found: pino needs kicad-cli and the KiCad libraries' }
  return [claude, kicad, { ok: true, text: "pino's Python environment is ready" }]
}
