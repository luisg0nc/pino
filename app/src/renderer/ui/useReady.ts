import { useEffect, useState } from 'react'
import { readyLines, type ReadyLine } from '../../shared/ready'

/** Whether Claude Code, KiCad and the engine are on this machine (`shared/ready.ts`); null while main is asking. */
export function useReady(): ReadyLine[] | null {
  const [ready, setReady] = useState<ReadyLine[] | null>(null)
  useEffect(() => {
    let here = true
    void window.pino.build.engineInfo().then(
      (info) => here && setReady(readyLines(info)),
      () => {}
    )
    return () => {
      here = false
    }
  }, [])
  return ready
}
