import { memo, useMemo, useState, type ReactNode } from 'react'
import type { ChatItem } from '../../../shared/chat'
import { drawn } from '../../state/chat'
import { useStore } from '../../state/store'
import { MarkChip } from '../MarkChip'
import { chipsFor } from './markChips'
import { numbered } from '../numbered'
import { AskCard } from './AskCard'
import { type Entry, foldRuns } from './fold'
import { Markdown } from './markdown'
import { TasksCard } from './Tasks'
import { isTaskTool, listsAt } from './taskList'
import { ToolCard } from './ToolCard'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/** The still dot of something under way: set by the one-second beat the pane keeps, and by no animation that runs on. */
function Dot({ beat }: { beat: boolean }) {
  return <span className="chat-dot" data-beat={beat ? undefined : 'off'} aria-hidden="true" />
}

/** What pino added to a prompt, under it: the exact text the agent was given, to open out. */
const Added = memo(function Added({ item }: { item: Of<'context'> }) {
  const [open, setOpen] = useState(false)
  const marks = useStore((s) => s.marks)
  const chips = chipsFor(item.marks, marks)
  return (
    <div className="chat-item chat-added" data-kind="context">
      <div className="chat-added-line">
        <span className="chat-added-label">with</span>
        {chips.map((chip) => (
          <MarkChip key={chip.id} chip={chip} />
        ))}
        {item.instructions !== undefined && item.instructions > 0 && (
          <span className="chat-added-instructions" title="The instruction files Claude Code reads here, named in the text below">
            <span className="num">{item.instructions}</span> instruction {item.instructions === 1 ? 'file' : 'files'}
          </span>
        )}
        <button type="button" className="chat-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide text' : 'Show text'}
        </button>
      </div>
      {open && <pre className="chat-pre chat-added-text selectable">{item.text}</pre>}
    </div>
  )
})

const User = memo(function User({ item }: { item: Of<'user'> }) {
  return (
    <div className="chat-item chat-user" data-kind="user" data-state={item.state}>
      {item.text !== '' && <p className="chat-you selectable">{numbered(item.text)}</p>}
      {item.state === 'not-sent' && <p className="chat-user-state">Not sent</p>}
    </div>
  )
})

/** How a turn ended, in a line: how long it took, that it was stopped, or why it failed. */
function TurnLine({ item }: { item: Of<'turn'> }) {
  const head = item.stopped ? 'Stopped' : item.ok ? `Done in ${item.seconds < 10 ? item.seconds.toFixed(1) : Math.round(item.seconds)} s` : `Failed${item.error ? `: ${item.error}` : ''}`
  return (
    <div className="chat-item chat-turn" data-kind="turn" data-ok={item.ok && !item.stopped ? '' : undefined}>
      <div className="chat-turn-main">
        <p className="chat-turn-line">
          <b className="chat-turn-head">{numbered(head)}</b>
        </p>
      </div>
    </div>
  )
}

/**
 * One item of the transcript. Memoized: an item that did not change (the pane keeps its object) is not drawn again
 * for what else changes; `beat` is passed only to the items that show a dot, a constant to the rest.
 */
export const ItemView = memo(function ItemView({ item, beat }: { item: ChatItem; beat: boolean }) {
  switch (item.kind) {
    case 'user':
      return <User item={item} />
    case 'context':
      return <Added item={item} />
    case 'text':
      return (
        <div className="chat-item chat-text" data-kind="text">
          <Markdown text={item.text} />
          {item.streaming && <Dot beat={beat} />}
        </div>
      )
    case 'thinking':
      return (
        <p className="chat-item chat-note" data-kind="thinking">
          {item.streaming ? (
            <>
              Thinking <Dot beat={beat} />
            </>
          ) : item.seconds !== undefined ? (
            <>Thought for {numbered(`${Math.max(1, Math.round(item.seconds))} s`)}</>
          ) : (
            'Thought'
          )}
        </p>
      )
    case 'tool':
      return <ToolCard item={item} beat={beat} />
    case 'ask':
      return <AskCard item={item} />
    case 'turn':
      return <TurnLine item={item} />
    case 'note':
      return (
        <p className="chat-item chat-note" data-kind="note" data-tone={item.tone}>
          {numbered(item.text)}
        </p>
      )
  }
})

/** Whether an item is something under way, which shows a dot that beats. */
const underWay = (item: ChatItem): boolean => ((item.kind === 'text' || item.kind === 'thinking') && item.streaming) || (item.kind === 'tool' && item.state === 'running')

/**
 * A run of the agent's tools, once its turn has ended, as one line: what it did ("Read 3 files, Grep ×2, Bash"), to
 * open into the lines themselves. Drawing only: the items are the same ones.
 */
function ToolFold({ entry }: { entry: Extract<Entry, { kind: 'fold' }> }) {
  const [open, setOpen] = useState(false)
  const count = entry.items.filter((item) => item.kind === 'tool').length
  return (
    <div className="chat-fold" data-fold={entry.id} data-open={open ? '' : undefined}>
      <div className="chat-item chat-tool chat-fold-head" data-kind="fold">
        <div className="chat-tool-row">
          <button type="button" className="chat-tool-line" aria-expanded={open} aria-label={`${entry.label}: ${count} tools`} title={entry.label} onClick={() => setOpen(!open)} />
          <span className="chat-tool-label">{numbered(entry.label)}</span>
          <span className="chat-tool-steps">{numbered(`${count} tools`)}</span>
        </div>
      </div>
      {open &&
        entry.items.map((item) => (
          <div key={item.id} className="chat-group" data-id={item.id}>
            <ItemView item={item} beat />
          </div>
        ))}
    </div>
  )
}

/** Whether an entry is a tool's chip (a fold of tools, or a tool that is not the list `TodoWrite` is): the tools that follow one another stand side by side, wrapping. */
const isChip = (entry: Entry): boolean => entry.kind === 'fold' || (entry.item.kind === 'tool' && entry.item.name !== 'TodoWrite')
const keyOf = (entry: Entry): string => (entry.kind === 'fold' ? entry.id : entry.item.id)

/**
 * The items in the order they are drawn, with each `context` under the prompt it was made for. A run of the agent's
 * tools that is over is one line (`foldRuns`), and its task list is a card (`TasksCard`).
 */
export function ChatItems({ items, beat }: { items: ChatItem[]; beat: boolean }) {
  const order = useMemo(() => drawn(items), [items])
  const under = useMemo(() => {
    const byUser = new Map<string, Array<Of<'context'>>>()
    for (const item of order) if (item.kind === 'context') byUser.set(item.forUser, [...(byUser.get(item.forUser) ?? []), item])
    return byUser
  }, [order])
  const ids = useMemo(() => new Set(order.map((item) => item.id)), [order])
  // What is drawn on its own: a context whose prompt is here is drawn under that one.
  const entries = useMemo(() => foldRuns(order.filter((item) => !(item.kind === 'context' && ids.has(item.forUser))), new Set(under.keys())), [order, ids, under])
  const lists = useMemo(() => listsAt(order), [order])

  const draw = (entry: Entry, at: number): ReactNode => {
    if (entry.kind === 'fold') return <ToolFold key={entry.id} entry={entry} />
    const item = entry.item
    // The list the agent keeps: `TodoWrite` is its list whole, a card of its own; the task tools are lines, and the list stands under the last of a run of them.
    const next = entries[at + 1]
    const last = item.kind === 'tool' && (item.name === 'TodoWrite' || next?.kind !== 'item' || !isTaskTool(next.item))
    const list = isTaskTool(item) && item.state === 'done' && last ? lists.get(item.id) : undefined
    const listed = list && list.length > 0 ? list : undefined
    return (
      <div key={item.id} className="chat-group" data-id={item.id}>
        {item.kind === 'tool' && item.name === 'TodoWrite' && listed ? <TasksCard list={listed} /> : <ItemView item={item} beat={underWay(item) ? beat : true} />}
        {under.get(item.id)?.map((context) => <Added key={context.id} item={context} />)}
        {listed && !(item.kind === 'tool' && item.name === 'TodoWrite') && <TasksCard list={listed} />}
      </div>
    )
  }

  /** The entries in order, with the tools that follow one another (and the folds of them) in one wrapping row of chips. */
  const out: ReactNode[] = []
  let run: ReactNode[] = []
  let runKey = ''
  const flush = (): void => {
    if (run.length > 0) out.push(<div key={`tools-${runKey}`} className="chat-tools">{run}</div>)
    run = []
  }
  entries.forEach((entry, at) => {
    if (isChip(entry)) {
      if (run.length === 0) runKey = keyOf(entry)
      run.push(draw(entry, at))
    } else {
      flush()
      out.push(draw(entry, at))
    }
  })
  flush()
  return <>{out}</>
}
