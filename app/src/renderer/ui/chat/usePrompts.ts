import { useEffect, useState } from 'react'
import type { PromptRow } from '../../../shared/chat'
import { useStore } from '../../state/store'

/**
 * The prompts of the open project, oldest first, numbered across all its conversations (`chat.prompts`, read from
 * `.pino/chat/` by main): asked when the project is opened and again whenever `key` changes (the window says what
 * changed: a card named another prompt, the session's status moved). The rows it had stay while the new ones come.
 * Undefined until main has answered.
 */
export function usePrompts(active: boolean, key: string): PromptRow[] | undefined {
  const projectId = useStore((s) => s.project?.id ?? null)
  const [found, setFound] = useState<{ of: string; rows: PromptRow[] } | undefined>(undefined)
  useEffect(() => {
    if (!active || projectId === null) return
    let current = true
    window.pino.chat.prompts(projectId).then(
      (rows) => current && setFound({ of: projectId, rows }),
      () => current && setFound({ of: projectId, rows: [] })
    )
    return () => {
      current = false
    }
  }, [active, projectId, key])
  return found !== undefined && found.of === projectId ? found.rows : undefined
}
