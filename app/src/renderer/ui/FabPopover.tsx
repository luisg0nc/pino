// The status line's "Fab files…": what stands in the way of a release, the release at work, and what it made. The
// person's press is the only way to release; Claude has no tool for it.

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Finding } from '../../shared/build'
import { readinessWords, type FabState, type Readiness, type ReleaseResult } from '../../shared/fab'
import type { ProjectInfo } from '../../shared/project'
import { actions, useStore } from '../state/store'
import { useViewModel } from '../state/viewModel'
import { numbered } from './numbered'
import { Popover } from './Popover'

const MOST_FINDINGS = 12
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const sizeWords = (bytes: number): string => (bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`)

/** The release's files at the top of its folder, and how many more are in its subfolders. */
function Files({ result }: { result: ReleaseResult }) {
  const inside = `${result.folder}/`
  const names = result.files.map((f) => ({ ...f, name: f.path.startsWith(inside) ? f.path.slice(inside.length) : f.path }))
  const top = names.filter((f) => !f.name.includes('/'))
  const deeper = names.length - top.length
  return (
    <ul className="fab-files">
      {top.map((f) => (
        <li key={f.path}>
          <span className="num fab-file">{f.name}</span>
          <span className="num muted">{sizeWords(f.bytes)}</span>
        </li>
      ))}
      {deeper > 0 && <li className="muted">{numbered(`and ${plural(deeper, 'file')} in gerbers/`)}</li>}
    </ul>
  )
}

/** The findings of a release that did not go through; pointing at one lights its pin on the view. */
function Findings({ findings, base }: { findings: Finding[]; base: number }) {
  const hot = useStore((s) => s.hotFinding)
  const shown = findings.slice(0, MOST_FINDINGS)
  return (
    <ul className="fab-findings">
      {shown.map((f, i) => (
        <li key={i}>
          <button
            type="button"
            className="fab-finding"
            data-severity={f.severity}
            data-hot={hot === base + i || undefined}
            onPointerEnter={() => actions.hoverFinding(base + i)}
            onPointerLeave={() => actions.hoverFinding(null)}
            onFocus={() => actions.hoverFinding(base + i)}
            onBlur={() => actions.hoverFinding(null)}
            onClick={() => f.at?.space === 'board' && actions.setTab('board')}
          >
            {numbered(f.message)}
          </button>
        </li>
      ))}
      {findings.length > shown.length && <li className="muted">{numbered(`and ${findings.length - shown.length} more, listed in the checks`)}</li>}
    </ul>
  )
}

function Made({ result, project, base }: { result: ReleaseResult; project: ProjectInfo; base: number }) {
  const counts = result.counts
  const warnings = result.findings.filter((f) => f.severity === 'warning').length
  const turned = new Set(result.findings.filter((f) => f.code === 'rotation_unchecked').flatMap((f) => f.refs ?? [])).size
  const placed = `JLC places ${plural(counts.assembled ?? 0, 'part')} in ${plural(counts.bom_lines ?? 0, 'BOM line')}${counts.hand_fit ? `; ${counts.hand_fit} by hand` : ''}`
  return (
    <>
      <p className="fab-headline selectable">{numbered(result.headline)}</p>
      {result.state === 'released' && (
        <>
          <p className="num selectable">{`${result.folder}/`}</p>
          <Files result={result} />
          <p>{numbered(placed)}</p>
          {warnings > 0 && <p data-tone="warn">{numbered(`${plural(warnings, 'warning')}, listed in the checks`)}</p>}
          {turned > 0 && <p data-tone="warn">{numbered(`Check rotations in JLC's preview: ${plural(turned, 'part')}`)}</p>}
          <button type="button" className="button" onClick={() => void window.pino.fab.showFolder(project.id)}>
            Show in folder
          </button>
        </>
      )}
      {(result.state === 'refused' || result.state === 'failed') && <Findings findings={result.findings} base={base} />}
    </>
  )
}

/** Whether a release would go through, and the button that makes it. */
function Next({ readiness, project }: { readiness: Readiness; project: ProjectInfo }) {
  const blocked = readinessWords(readiness)
  if (readiness.ready && !readiness.next_version) return <p>{numbered(`Nothing new: ${readiness.why[0] ?? 'the files are those of the last release'}.`)}</p>
  const why = readiness.why.slice(0, 3).join('; ')
  const said = readiness.bump ? `${readiness.bump}: ${why}` : why
  return (
    <>
      {readiness.ready ? (
        <p>{numbered(`Next: v${readiness.next_version} (${said})`)}</p>
      ) : (
        <ul className="fab-blockers">
          {blocked.map((words) => (
            <li key={words}>{numbered(words)}</li>
          ))}
        </ul>
      )}
      {readiness.ready && readiness.warnings.length > 0 && <p data-tone="warn">{numbered(plural(readiness.warnings.length, 'warning'))}</p>}
      <button type="button" className="button button-primary" disabled={!readiness.ready} title={blocked[0]} onClick={() => void window.pino.fab.release(project.id)}>
        Make fab files
      </button>
    </>
  )
}

function Content({ fab, project }: { fab: FabState | null; project: ProjectInfo }) {
  const build = useStore((s) => s.build?.lastGood ?? null)
  const { model } = useViewModel()
  const [asked, setAsked] = useState<string | null>(null)
  const running = fab?.running ?? false

  // What a release would be is asked when the popover opens, and again when a new build lands.
  useEffect(() => {
    if (running) return
    setAsked(null)
    void window.pino.fab.readiness(project.id).catch((e: Error) => setAsked(e.message))
  }, [project.id, build?.hash, running])

  if (fab?.running) {
    return (
      <>
        <p role="status">{numbered(`Making fab files: ${fab.step}`)}</p>
        <button type="button" className="button" onClick={() => void window.pino.fab.cancel(project.id)}>
          Cancel
        </button>
      </>
    )
  }
  // The last release is shown while the build on show is the one it was made from.
  const result = fab?.result && build?.hash && fab.result.build?.hash === build.hash ? fab.result : null
  const readiness = fab?.readiness ?? null
  const done = result?.state === 'released' || result?.state === 'unchanged'
  return (
    <>
      {(fab?.error ?? asked) && <p data-tone="fail">{fab?.error ?? asked}</p>}
      {result && <Made result={result} project={project} base={model?.result.findings.length ?? 0} />}
      {!done && (readiness ? <Next readiness={readiness} project={project} /> : !asked && <p className="muted">Checking what a release would need…</p>)}
    </>
  )
}

export function FabPopover({ project, anchor }: { project: ProjectInfo; anchor: HTMLElement | null }) {
  const fab = useStore((s) => s.fab)
  const title = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  // The focus goes in, so that Escape is heard.
  useEffect(() => heading.current?.focus({ preventScroll: true }), [])
  // On the body: inside the status line's layer, the view's own bars would be drawn over it.
  return createPortal(
    <Popover anchor={anchor} side="above" width={340} onClose={actions.closeFab} className="fab-pop" aria-labelledby={title}>
      <h4 id={title} ref={heading} tabIndex={-1}>
        Fab files for JLCPCB
      </h4>
      <div className="fab-body">
        <Content fab={fab} project={project} />
      </div>
    </Popover>,
    document.body
  )
}
