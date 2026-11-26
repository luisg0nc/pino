import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { MAX_PDF_BYTES, MAX_PHOTO_BYTES, MOST_REFERENCES, PDF_FORMATS, projectNameProblem } from '../../../shared/projectName'
import type { ProjectInfo } from '../../../shared/project'
import { DEFAULT_FAB } from '../../../shared/slots'
import { cardsActions } from '../../state/cards'
import { actions, store, useStore } from '../../state/store'
import { draftHas, onboard, onboarding, sizesWrong, useOnboard, type Stroke } from '../../state/onboard'
import { Confirm } from '../Confirm'
import { numbered } from '../numbered'
import { TYPING, giveKeysBack } from '../typing'
import { useReady } from '../useReady'
import { ConnectionsSlot } from './ConnectionsSlot'
import { Doodle } from './Doodle'
import { FabSlot } from './FabSlot'
import { PartsSlot } from './PartsSlot'
import { PowerSlot } from './PowerSlot'
import { HEIC_REASON, pastedFiles, prepareImage } from './images'
import { DraftPaneLive, type Make } from './DraftPane'
import { LinksSlot } from './LinksSlot'
import { liveMakeDeps } from './liveDeps'
import { makeProject, reason, rowsWrong } from './make'
import { ReferenceCards } from './ReferenceItems'
import { RulesSlot } from './RulesSlot'
import { SessionChoice } from './SessionChoice'
import { PicTile, Slot } from './Slot'
import { SizesSlot } from './SizesSlot'

/** Brings the New project page up over what is shown, and goes on with the draft there is. */
export async function openNewProject(): Promise<void> {
  const s = store.getState()
  if (!s.workspace || s.page === 'new' || s.page === 'first') return
  // The Brief on screen has been seen: said while main still holds its project open, which making another ends.
  if (s.page === 'project' && s.tab === 'brief') await cardsActions.leaveBrief()
  onboarding.begin(s.page === 'project' ? 'project' : 'projects')
  actions.showPage('new')
}

/** Back to where the page was opened from; with no project open, the page of projects. */
function leaveNewProject(): void {
  actions.showPage(onboard.getState().from === 'project' && store.getState().project !== null ? 'project' : 'projects')
}

const IMAGE_ENDINGS = ['.png', '.jpg', '.jpeg', '.webp']
const isImage = (name: string): boolean => IMAGE_ENDINGS.some((end) => name.toLowerCase().endsWith(end))
const isPdf = (name: string): boolean => PDF_FORMATS.some((end) => name.toLowerCase().endsWith(end))
const basename = (path: string): string => path.split(/[\\/]/).pop() || path
/** Why a dropped file with no path on the disk cannot be copied. */
const NO_PATH = 'it is not a file on this machine, so it cannot be copied.'
/** Elements of the page that ask something of their own, or lie over it: the page leaves its keys to them. */
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]'

interface Source {
  /** Empty for a picture pasted from the clipboard, which has no file: `pasted` is then set and its bytes are what is kept. */
  path: string
  pasted?: true
  name: string
  bytes: () => Promise<Uint8Array>
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The slots a tile opens, in the order they stand on the page and in the Brief. */
const SLOTS = [
  { id: 'power', title: 'Power', hint: 'Where it comes from' },
  { id: 'connections', title: 'Connections', hint: 'What plugs in or sits on it' },
  { id: 'shape', title: 'Size and shape', hint: 'Width, holes, edges' },
  { id: 'parts', title: 'Parts I have', hint: 'LCSC numbers or modules' },
  { id: 'fab', title: 'Fab and assembly', hint: 'Layers, who solders' },
  { id: 'rules', title: 'Rules', hint: 'Hand-solderable, 0805' },
  { id: 'links', title: 'Links and PDFs', hint: 'Datasheets, designs' }
] as const

/** A slot, which opens to an editor of its own and stays open while it is empty. */
type SlotId = (typeof SLOTS)[number]['id']

/**
 * The New project page: at the left the brief on paper (the name, "What it does" in the person's words with the photos
 * and doodles beside it, and a tile for each slot not opened yet), and at the right, on the dye, what will be made and
 * the buttons that make it (`DraftPane`). Nothing is written until it is made (`makeProject`). The draft is the
 * window's (`state/onboard.ts`); a dropped file is taken by its path, and a picture is scaled here for the prompt.
 */
export function NewProject({ onShow }: { onShow: (project: ProjectInfo) => void }) {
  const workspace = useStore((s) => s.workspace)!
  const draft = useOnboard((s) => s.draft)
  const choice = useOnboard((s) => s.choice)
  const names = workspace.projects.map((p) => p.name)
  const missing = useReady()?.filter((line) => !line.ok) ?? []
  const page = useRef<HTMLElement>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'start' | 'make' | null>(null)
  const [reading, setReading] = useState(0)
  const [said, setSaid] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [madeAlready, setMadeAlready] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** The board: closed, or open on a new doodle (`uid: null`) or on one to change. */
  const [board, setBoard] = useState<{ uid: string | null } | null>(null)
  const boardOpen = useRef(false)
  boardOpen.current = board !== null
  const asked = useRef(false)
  asked.current = asking
  const [opened, setOpened] = useState<readonly SlotId[]>([])
  /** The slot whose first field takes the focus once it is on the page. */
  const [focusSlot, setFocusSlot] = useState<string | null>(null)

  /** Every entry of the workspace folder, as main reads it: a folder that is no project, a file, is a name taken too. */
  const [taken, setTaken] = useState<string[]>([])
  const refreshTaken = useCallback((): void => void window.pino.project.taken().then(setTaken, () => {}), [])
  useEffect(refreshTaken, [refreshTaken])
  const working = busy !== null
  const busyNow = useRef(false)
  busyNow.current = working

  const nameProblem = draft.name === '' ? null : projectNameProblem(draft.name, [...new Set([...names, ...taken])])
  const rowIssue = sizesWrong(draft.sizes) || rowsWrong(draft) !== null
  const said_what = draft.description.trim() !== ''
  const ready = draft.name !== '' && nameProblem === null && said_what && !rowIssue
  const files = draft.photos.length + draft.doodles.length + draft.pdfs.length
  /** Whether the draft holds something of a slot, which keeps it open when the page is come back to. */
  const holds: Record<SlotId, boolean> = {
    power: draft.power.length > 0,
    connections: draft.connections.length > 0,
    shape: draft.sizes.length > 0 || draft.enclosure !== '' || draft.edges !== '',
    parts: draft.parts.length > 0,
    fab: draft.fab !== null,
    rules: draft.rules !== '',
    links: draft.links.length + draft.pdfs.length > 0
  }
  const isOpen = (slot: SlotId): boolean => opened.includes(slot) || holds[slot]
  const open = (slot: SlotId): void => {
    // The fab is asked for in whole: it starts as the usual order, and every field is there to change.
    if (slot === 'fab' && onboard.getState().draft.fab === null) onboarding.setFab(DEFAULT_FAB)
    setOpened((now) => (now.includes(slot) ? now : [...now, slot]))
    setFocusSlot(slot)
  }

  // The first field of a slot that was just asked for takes the focus.
  useEffect(() => {
    if (focusSlot === null) return
    page.current?.querySelector<HTMLElement>(`[data-slot="${focusSlot}"] [data-first]:not(:disabled)`)?.focus()
    setFocusSlot(null)
  }, [focusSlot, opened])

  // The page takes the focus when it comes, and gives it back to where it was when it goes.
  useEffect(() => {
    const before = document.activeElement
    nameField.current?.focus()
    return () => {
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  /** Discard: what the draft holds is asked about first; an empty one is let go at once. */
  const discard = (): void => {
    // While the project is made nothing can drop the draft.
    if (busyNow.current) return
    if (draftHas(onboard.getState().draft)) setAsking(true)
    else {
      onboarding.discard()
      leaveNewProject()
    }
  }

  // The keys are the page's while it is up: Escape leaves it, which keeps the draft, and S doodles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      const here = target !== null && page.current!.contains(target)
      // The ink pad has its own keys; what asks something of its own keeps its keys.
      if (boardOpen.current) return
      if (!here && target?.closest(`${TYPING}, input, ${LAYER}`)) return
      if (here && target.closest(LAYER)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (target?.closest(TYPING) && here) {
        // In a field the keys are the field's, but for Escape: it leaves the field.
        if (!pressed(e, 'new.back')) return
        e.preventDefault()
        e.stopPropagation()
        giveKeysBack(target as HTMLElement)
        return
      }
      if (pressed(e, 'new.back')) {
        e.preventDefault()
        e.stopPropagation()
        if (!asked.current && !busyNow.current) leaveNewProject()
      } else if (pressed(e, 'new.sketch')) {
        e.preventDefault()
        e.stopPropagation()
        if (!asked.current && !busyNow.current && onboard.getState().draft.doodles.length < MOST_REFERENCES.doodles) setBoard({ uid: null })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /** Takes pictures in: each is read, scaled for the prompt and drawn small; one that cannot be read is said, the others go in. */
  async function takePhotos(sources: Source[]): Promise<void> {
    setSaid(null)
    const epoch = onboarding.epoch()
    setReading((n) => n + sources.length)
    const problems: string[] = []
    const ready: Parameters<typeof onboarding.addPhotos>[0] = []
    for (const source of sources) {
      try {
        const prepared = await prepareImage(await source.bytes(), source.name)
        // A pasted picture is written by main as a PNG: one too heavy to stay a PNG is asked for as a file.
        if (source.pasted && prepared.type !== 'image/png') throw new Error(`${source.name} is too large to be pasted: save it as a file and add that.`)
        const detail =
          prepared.from.width === prepared.width && prepared.from.height === prepared.height
            ? `${prepared.from.width} × ${prepared.from.height}`
            : `${prepared.from.width} × ${prepared.from.height}, sent at ${prepared.width} × ${prepared.height}`
        ready.push({ path: source.path, ...(source.pasted ? { pasted: true as const } : {}), file: source.name, image: prepared.image, url: URL.createObjectURL(new Blob([prepared.image as BlobPart], { type: prepared.type })), detail })
      } catch (e) {
        problems.push(reason(e))
      }
      setReading((n) => n - 1)
    }
    // The draft was thrown away while these were being read: they are not put back into it.
    if (onboarding.epoch() !== epoch) {
      for (const item of ready) URL.revokeObjectURL(item.url)
      return
    }
    const { left, same } = onboarding.addPhotos(ready)
    if (left > 0) problems.push(`${plural(left, 'photo was', 'photos were')} left out: at most ${MOST_REFERENCES.photos}.`)
    if (same > 0) problems.push(`${plural(same, 'photo is', 'photos are')} there already.`)
    if (problems.length > 0) setSaid(problems.join(' '))
  }

  async function addPhotos(): Promise<void> {
    const paths = await window.pino.project.pickPhotos().catch(() => [] as string[])
    await takePhotos(paths.map((path) => ({ path, name: basename(path), bytes: () => window.pino.project.readPhoto(path) })))
  }

  async function addPdf(): Promise<void> {
    const path = await window.pino.project.pickPdf().catch(() => null)
    if (path === null) return
    setSaid(onboarding.addPdf({ path, file: basename(path) }))
  }

  /** Files taken in, by what they are: pictures are photos, `.pdf` PDFs. */
  function taking(list: readonly File[], pasted = false): void {
    const pictures: Source[] = []
    const problems: string[] = []
    for (const file of list) {
      const path = window.pino.project.pathOf(file)
      if (isPdf(file.name)) {
        // The size first: a file over the cap is never copied, whatever else is said of it.
        if (file.size > MAX_PDF_BYTES) problems.push(`${file.name} is over ${MAX_PDF_BYTES / (1024 * 1024)} MB.`)
        else if (!path) problems.push(`${file.name}: ${NO_PATH}`)
        else {
          const why = onboarding.addPdf({ path, file: file.name, size: file.size })
          if (why !== null) problems.push(why)
        }
      } else if (isImage(file.name)) {
        // The size first: a file over the cap is never read, whatever else is said of it.
        if (file.size > MAX_PHOTO_BYTES) problems.push(`${file.name} is over ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`)
        else if (!path && !pasted) problems.push(`${file.name}: ${NO_PATH}`)
        else pictures.push({ path, ...(path ? {} : { pasted: true as const }), name: file.name, bytes: async () => new Uint8Array(await file.arrayBuffer()) })
      } else if (/\.(heic|heif)$/i.test(file.name)) problems.push(`${file.name}: ${HEIC_REASON}`)
      else problems.push(`${file.name} is neither a picture nor a PDF.`)
    }
    setSaid(problems.length > 0 ? problems.join(' ') : null)
    if (pictures.length > 0) void takePhotos(pictures).then(() => problems.length > 0 && setSaid((now) => [...problems, ...(now ? [now] : [])].join(' ')))
  }
  const dropped = (list: FileList): void => taking([...list])
  const carriesFiles = (e: DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  // An image pasted anywhere on the page is taken as a dropped one is; one with no file on the disk (a screenshot) is kept as the bytes the window scaled.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/') || isImage(f.name))
      if (pasted.length === 0 || boardOpen.current || asked.current || busyNow.current) return
      e.preventDefault()
      // A picture with no name (and no path) is one the system made on the spot: it is named by its kind. A copied file keeps its own.
      taking(pastedFiles(pasted, (f) => window.pino.project.pathOf(f)), true)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create(start: boolean): Promise<void> {
    if (working || !ready) return
    setBusy(start ? 'start' : 'make')
    setProblem(null)
    const outcome = await makeProject(
      onboard.getState().draft,
      liveMakeDeps(onShow),
      onboard.getState().choice,
      start
    )
    if (outcome.kind === 'refused') setProblem(outcome.message)
    else if (outcome.kind === 'made') setMadeAlready(outcome.message)
    else if (outcome.kind === 'done' && outcome.shown === false) {
      // The project is made and listed, and another is on show: back to the page of projects, where it is.
      actions.showPage('projects')
    }
    setBusy(null)
    refreshTaken()
  }

  const editing = board?.uid ? draft.doodles.find((d) => d.uid === board.uid) : undefined
  const free = (kind: keyof typeof MOST_REFERENCES): boolean => draft[kind].length < MOST_REFERENCES[kind]
  const make: Make = ready
    ? { folder: `${workspace.name}/${draft.name}/`, files }
    : rowIssue && draft.name !== '' && nameProblem === null && said_what
      ? 'Finish or remove the rows that are not whole.'
      : 'Give it a name and say what it does.'

  const slotBody: Record<SlotId, React.ReactNode> = {
    power: <PowerSlot rows={draft.power} disabled={working} onSaid={setSaid} />,
    connections: <ConnectionsSlot rows={draft.connections} disabled={working} onSaid={setSaid} />,
    shape: <SizesSlot sizes={draft.sizes} enclosure={draft.enclosure} edges={draft.edges} disabled={working} onSaid={setSaid} />,
    parts: <PartsSlot rows={draft.parts} disabled={working} onSaid={setSaid} />,
    fab: draft.fab ? <FabSlot fab={draft.fab} disabled={working} /> : null,
    rules: <RulesSlot rules={draft.rules} disabled={working} onRefused={setSaid} />,
    links: <LinksSlot draft={draft} disabled={working} onAddPdf={() => void addPdf()} onSaid={setSaid} />
  }
  const closed = SLOTS.filter((s) => !isOpen(s.id))

  return (
    <>
    <section
      ref={page}
      className="new-page"
      data-region="viewport"
      aria-label="New project"
      tabIndex={-1}
      data-dragging={dragging ? '' : undefined}
      onDragOver={(e) => {
        if (!carriesFiles(e) || working) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        if (!carriesFiles(e) || working) return
        e.preventDefault()
        dropped(e.dataTransfer.files)
      }}
    >
      <div className="new-layout">
        <div className="new-column">
          <header className="new-head">
            <h1 className="new-title">New project</h1>
            <p className="new-lead">Nothing is written until you start.</p>
            <button type="button" className="button button-quiet" disabled={working} title={`Empty this page (${hint('new.back')} leaves it and keeps what is in it)`} onClick={discard}>
              Discard
            </button>
          </header>

          {madeAlready !== null && (
            <p className="new-problem" role="alert">
              {numbered(madeAlready)} It is not made again.
            </p>
          )}

          <div className="new-field">
            <label className="new-name-label" htmlFor="new-name">
              Name
            </label>
            <div className="new-name">
              <span className="new-name-folder" aria-hidden="true">
                {workspace.name} /
              </span>
              <input id="new-name" ref={nameField} className="new-name-input" type="text" value={draft.name} placeholder="a-name" spellCheck={false} autoComplete="off" disabled={working} aria-invalid={nameProblem !== null} aria-describedby="new-name-help" onChange={(e) => onboarding.setName(e.target.value)} />
            </div>
            <p id="new-name-help" className="new-help" data-tone={nameProblem ? 'fail' : undefined}>
              {nameProblem ?? "The folder's name: letters, digits, \u2212 and _."}
            </p>
          </div>

          <section className="new-brief" aria-labelledby="new-making">
            <h3 className="new-label" id="new-making">
              What it does
            </h3>
            <textarea
              id="new-what"
              className="new-what"
              aria-labelledby="new-making"
              rows={4}
              value={draft.description}
              disabled={working}
              placeholder="A sensor node that reads temperature and humidity and sends them over Wi-Fi from a LiPo cell…"
              onChange={(e) => onboarding.setDescription(e.target.value)}
            />
            <ReferenceCards
              draft={draft}
              kinds={['photos', 'doodles']}
              label="What you have"
              onEditDoodle={(key) => setBoard({ uid: key })}
              tail={
                <>
                  <li className="ref-add">
                    <PicTile title="Sketch it" hint={<>or press <span className="pic-key num">{hint('new.sketch')}</span></>} disabled={working || !free('doodles')} onClick={() => setBoard({ uid: null })} />
                  </li>
                  <li className="ref-add">
                    <PicTile title="Add photos" hint="or drop and paste them" disabled={working || !free('photos')} help="Choose photos, or drop pictures or a PDF on the page" onClick={() => void addPhotos()} />
                  </li>
                </>
              }
            />
          </section>

          <div className="new-cards" role="group" aria-label="What else you know">
            {SLOTS.filter((s) => isOpen(s.id)).map((s) => (
              <Slot key={s.id} id={s.id} title={s.title} hint={s.hint} wide>
                {slotBody[s.id]}
              </Slot>
            ))}
          </div>
          {closed.length > 0 && (
            <ul className="new-tiles" aria-label="Add">
              {closed.map((s) => (
                <li key={s.id}>
                  <PicTile title={s.title} hint={s.hint} disabled={working} onClick={() => open(s.id)} />
                </li>
              ))}
            </ul>
          )}

          <p className="new-help new-reading" role="status">
            {reading > 0 && <>Reading {numbered(plural(reading, 'picture', 'pictures'))}… </>}
          </p>
          {said !== null && (
            <p className="new-help" data-tone="warn" role="status">
              {numbered(said)}
            </p>
          )}
          <p className="new-hint">
            Drop files anywhere · paste an image · <span className="num">{hint('new.sketch')}</span> doodle
          </p>
        </div>

        <DraftPaneLive make={make}>
          <div className="new-foot">
            {/* What is missing, before the folder is made: the project is made without it, and Claude cannot start in it. */}
            {missing.length > 0 && (
              <ul className="new-missing" aria-label="What pino needs">
                {missing.map((line) => (
                  <li key={line.text}>{numbered(line.text)}</li>
                ))}
              </ul>
            )}
            {problem !== null && (
              <p className="new-problem" role="alert">
                {numbered(problem)}
              </p>
            )}
            <SessionChoice choice={choice} disabled={working} onChange={onboarding.setChoice} />
            {/* On once the first prompt is written (`main/onboard.ts`). */}
            <button type="button" className="button button-primary new-start" disabled onClick={() => void create(true)}>
              {busy === 'start' ? 'Starting…' : 'Start: make the project and ask Claude'}
            </button>
            <button type="button" className="button button-quiet new-make" disabled={!ready || working || reading > 0} onClick={() => void create(false)}>
              {busy === 'make' ? 'Making…' : 'or make it without starting Claude'}
            </button>
          </div>
        </DraftPaneLive>
      </div>

      {asking && (
        <div className="new-confirm">
          <Confirm
            label="Discard this new project?"
            accept="Discard"
            cancel="Keep editing"
            onCancel={() => {
              setAsking(false)
              nameField.current?.focus()
            }}
            onAccept={() => {
              setAsking(false)
              onboarding.discard()
              leaveNewProject()
            }}
          >
            Discard this new project? What you wrote and gave is not kept anywhere else.
          </Confirm>
        </div>
      )}

    </section>
    {/* Over the page, not in its scroll: the board is a sheet of its own. */}
    {board !== null && (
      <Doodle
        initial={editing?.strokes ?? []}
        photos={draft.photos}
        over={editing?.over}
        onCancel={() => setBoard(null)}
        onDone={(strokes: Stroke[], png: Uint8Array, over: string | undefined) => {
          const item = { strokes, png, url: URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })), ...(over === undefined ? {} : { over }) }
          if (board.uid) onboarding.replaceDoodle(board.uid, item)
          else onboarding.addDoodle(item)
          setBoard(null)
        }}
      />
    )}
    </>
  )
}
