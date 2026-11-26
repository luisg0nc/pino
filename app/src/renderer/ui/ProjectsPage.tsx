import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { keyName, pressed, which } from '../../shared/keys'
import type { ListedProject } from '../../shared/workspace'
import { actions, useStore } from '../state/store'
import { numbered } from './numbered'
import { useReady } from './useReady'

/** What a card says of a board with nothing drawn: a brief alone, or neither file. */
const saidOf = (p: ListedProject): string | null => (p.board ? null : p.brief ? 'No board yet' : 'Empty')

/**
 * The page of projects, while a workspace is open and no project is: New project first, then a card a board. Arrows
 * move between the cards, Enter opens one, and typing filters them by name. Written after torno's page of projects
 * (`ShowPage.tsx`), without its bench, shelves, git or session signs.
 */
export function ProjectsPage({ busy, onOpen }: { busy: boolean; onOpen: (name: string) => void }) {
  const workspace = useStore((s) => s.workspace)
  const said = useStore((s) => s.problem ?? s.notice)
  const [filter, setFilter] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const missing = useReady()?.filter((line) => !line.ok) ?? []

  // The folder is the person's: it is listed again whenever the window is come back to.
  useEffect(() => {
    const read = (): void => void window.pino.workspace.list().then(actions.setWorkspace, (e: Error) => actions.problem(e.message))
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [workspace?.root])

  // A letter typed on the page, outside a field and a menu, is the filter's: the focus goes there before it lands.
  useEffect(() => {
    const type = (e: KeyboardEvent): void => {
      const at = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || keyName(e).length !== 1 || at.closest('input, textarea, [role="menu"]')) return
      field.current?.focus()
    }
    window.addEventListener('keydown', type)
    return () => window.removeEventListener('keydown', type)
  }, [])

  if (!workspace) return null
  const wanted = filter.trim().toLocaleLowerCase('en')
  const shown = workspace.projects.filter((p) => p.name.toLocaleLowerCase('en').includes(wanted))

  const leaveFilter = (e: ReactKeyboardEvent): boolean => {
    if (!filter || !pressed(e, 'field.leave')) return false
    e.preventDefault()
    setFilter('')
    return true
  }

  const onCardKey = (e: ReactKeyboardEvent): void => {
    if (leaveFilter(e)) return
    const way = which(e, 'boards.move')
    if (way < 0) return
    const cards = [...(list.current?.querySelectorAll<HTMLButtonElement>('.project-card') ?? [])]
    const at = cards.indexOf(e.target as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    // As many to a row as stand level with the first.
    const columns = cards.filter((card) => card.parentElement!.offsetTop === cards[0].parentElement!.offsetTop).length
    // Left, Right, Up, Down, as the row of the key table names them.
    const next = cards[at + [-1, 1, -columns, columns][way]]
    if (next && !next.disabled) next.focus()
  }

  return (
    <main className="projects-page" data-region="viewport" aria-label="All projects">
      <div className="projects-head">
        <h1 className="projects-title" title={workspace.root}>
          {workspace.name}
        </h1>
        {workspace.projects.length > 0 && (
          <input
            ref={field}
            type="search"
            className="projects-filter"
            aria-label="Filter projects"
            placeholder="Filter projects"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={leaveFilter}
          />
        )}
      </div>
      {said !== null && (
        <p className="projects-problem" role="alert">
          {said}
        </p>
      )}
      <ul ref={list} className="projects-list" role="list" aria-label={`Projects in ${workspace.name}`} onKeyDown={onCardKey}>
        <li>
          <button type="button" className="project-card project-card-new" aria-label="New project" disabled title="The New project page is not here yet">
            <span className="project-picture" aria-hidden="true">
              +
            </span>
            <span className="project-card-name">New project</span>
          </button>
        </li>
        {shown.map((p) => (
          <li key={p.name}>
            <button type="button" className="project-card" aria-label={p.name} aria-description={saidOf(p) ?? undefined} title={p.dir} disabled={busy} onClick={() => onOpen(p.name)}>
              <span className="project-picture" aria-hidden="true" />
              <span className="project-card-name">{p.name}</span>
              {saidOf(p) !== null && <span className="project-card-said">{saidOf(p)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {workspace.projects.length === 0 && <p className="projects-empty">No boards here yet.</p>}
      {workspace.projects.length > 0 && shown.length === 0 && <p className="projects-empty">No board has “{filter.trim()}” in its name.</p>}
      {missing.length > 0 && (
        <ul className="welcome-ready projects-ready" aria-label="What pino needs">
          {missing.map((line) => (
            <li key={line.text} data-ok="false">
              {numbered(line.text)}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
