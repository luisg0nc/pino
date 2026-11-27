/**
 * What Claude Code spent on the open project: the rows main reads from its chat logs (`chat.usage`, `ProjectUsage`),
 * asked when the project is opened, when a turn of one of its sessions ends and when the Usage page is shown; and where
 * the Usage page stands (the range, the conversation open, the prompt lit). Nothing is kept: the page opens on the week.
 */
import { useEffect } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { ProjectUsage } from '../../shared/usage'
import { store, useStore } from './store'

export type UsageRange = 'week' | 'month' | 'all'

interface UsageState {
  /** The project the rows are of; null for none. */
  of: string | null
  usage: ProjectUsage | null
  range: UsageRange
  /** The conversation the page shows as a ledger; null: the project's page. */
  conversation: string | null
  /** The prompt lit in the ledger (its id): the one "Open in Usage" was pressed under. */
  lit: string | null
}

export const usageStore = createStore<UsageState>(() => ({ of: null, usage: null, range: 'week', conversation: null, lit: null }))

export const useUsage = <T>(pick: (s: UsageState) => T): T => useZustand(usageStore, pick)

/** Each ask is numbered: an answer older than the last ask is let go. */
let asked = 0

export const usageActions = {
  /** Asks main again for the rows of the open project. */
  refresh(): void {
    const projectId = store.getState().project?.id ?? null
    const ask = ++asked
    if (projectId === null) {
      usageStore.setState({ of: null, usage: null, conversation: null, lit: null })
      return
    }
    if (usageStore.getState().of !== projectId) usageStore.setState({ of: projectId, usage: null, conversation: null, lit: null })
    window.pino.chat.usage(projectId).then(
      (usage) => {
        if (ask === asked && store.getState().project?.id === projectId) usageStore.setState({ of: projectId, usage })
      },
      () => {}
    )
  },
  setRange(range: UsageRange): void {
    usageStore.setState({ range })
  },
  /** Opens a conversation as a ledger, with a prompt lit; null goes back to the project's page. */
  openConversation(conversation: string | null, lit: string | null = null): void {
    usageStore.setState({ conversation, lit })
  }
}

/** The open project's usage, asked of main once for each project; undefined until it has answered. */
export function useProjectUsage(): ProjectUsage | undefined {
  const projectId = useStore((s) => s.project?.id ?? null)
  const usage = useUsage((s) => (s.of === projectId ? s.usage : null))
  useEffect(() => {
    if (projectId !== null && usageStore.getState().of !== projectId) usageActions.refresh()
  }, [projectId])
  return usage ?? undefined
}
