// The picture on the open project's card: drawn from its newest good build, once for each, and sent to main, which
// keeps it under the project's `.pino/`.

import { useEffect } from 'react'
import { boardPicture, PAGE_THUMB } from '../ui/strip/thumbs'
import { useStore } from './store'
import { loadViewModel } from './viewModel'

const bytesOf = (dataUrl: string): Uint8Array => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

export function useKeepThumb(): void {
  const projectId = useStore((s) => s.project?.id ?? null)
  const lastGood = useStore((s) => s.build?.lastGood ?? null)
  const hash = lastGood?.hash ?? null
  useEffect(() => {
    if (!projectId || !lastGood || !hash) return
    let here = true
    // A build that cannot be read, or a folder pino may not write into (said in the window by main), leaves the card as it was.
    void loadViewModel(projectId, lastGood)
      .then((model) => (here ? window.pino.project.saveThumb(projectId, hash, bytesOf(boardPicture(model, PAGE_THUMB, false))) : undefined))
      .catch(() => {})
    return () => {
      here = false
    }
    // For each new hash: the same build landing again is the same picture.
  }, [projectId, hash])
}
