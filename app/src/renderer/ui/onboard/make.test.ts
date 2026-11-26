import { describe, expect, it, vi } from 'vitest'
import type { CreateRequest, OnboardDraft, Onboarded } from '../../../shared/bridge'
import type { Draft } from '../../state/onboard'
import { makeProject, pdfReferences, previewDraft, type MakeDeps } from './make'

const draft = (): Draft => ({
  name: 'cable-clip',
  description: '  A clip for a 6 mm cable.  ',
  photos: [
    { uid: 'a', path: '/home/me/IMG_1.JPG', file: 'IMG_1.JPG', note: 'desk edge', image: new Uint8Array([1]), url: 'blob:a' },
    { uid: 'b', path: '/home/me/two.webp', file: 'two.webp', note: '', image: new Uint8Array([2]), url: 'blob:b' }
  ],
  doodles: [{ uid: 'c', strokes: [], png: new Uint8Array([3]), note: 'the shape', url: 'blob:c' }],
  sizes: [],
  enclosure: '',
  edges: '',
  rules: '',
  links: [],
  pdfs: [],
  power: [],
  connections: [],
  parts: [],
  fab: null
})

const INFO = { id: 'p123456789abc', name: 'cable-clip', dir: '/ws/cable-clip' }
/** The slots a bare draft sends: nothing. */
const NO_SLOTS = { sizes: [], enclosure: '', edges: '', rules: '', links: [], power: [], connections: [], parts: [], fab: null }

function deps(over: Partial<MakeDeps> = {}) {
  const calls: string[] = []
  const made: MakeDeps = {
    create: vi.fn(async (_req: CreateRequest) => (calls.push('create'), INFO)),
    onboard: vi.fn(async (_id: string, _d: OnboardDraft): Promise<Onboarded> => (calls.push('onboard'), { sessionId: 's1', prompt: 'the prompt', held: 'the held prompt' })),
    listed: vi.fn(async () => (calls.push('listed'), ['plain', 'cable-clip'])),
    show: vi.fn(async () => void calls.push('show')),
    open: vi.fn(async () => (calls.push('open'), INFO)),
    discard: vi.fn(() => void calls.push('discard')),
    hold: vi.fn(),
    sameWorkspace: vi.fn(() => true),
    folderOf: vi.fn((name: string) => `/ws/${name}`),
    ...over
  }
  return { made, calls }
}

describe('pdfReferences', () => {
  it('names the PDFs as create does: their own names, a name taken in any case numbered', () => {
    expect(pdfReferences([{ path: '/p/Data Sheet.PDF', note: 'a' }, { path: '/q/data sheet.pdf', note: '' }])).toEqual([
      { file: 'reference/Data_Sheet.pdf', note: 'a' },
      { file: 'reference/data_sheet-2.pdf', note: '' }
    ])
  })
})

describe('making the project', () => {
  it('creates, lists, discards the draft, shows the project, then onboards once, with the pictures named as create names them', async () => {
    const { made, calls } = deps()
    const outcome = await makeProject(draft(), made)
    expect(outcome).toEqual({ kind: 'done', name: 'cable-clip' })
    expect(calls).toEqual(['create', 'listed', 'discard', 'show', 'onboard'])
    expect(made.show).toHaveBeenCalledWith(INFO)
    const req = (made.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRequest
    expect(req).toMatchObject({ name: 'cable-clip', description: 'A clip for a 6 mm cable.', photos: [{ path: '/home/me/IMG_1.JPG', note: 'desk edge' }, { path: '/home/me/two.webp', note: '' }] })
    expect(req.doodles).toEqual([{ png: new Uint8Array([3]), note: 'the shape' }])
    expect(made.onboard).toHaveBeenCalledTimes(1)
    expect((made.onboard as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      INFO.id,
      {
        description: 'A clip for a 6 mm cable.',
        items: [
          { file: 'reference/photo-1.jpg', note: 'desk edge', image: new Uint8Array([1]) },
          { file: 'reference/photo-2.webp', note: '', image: new Uint8Array([2]) },
          { file: 'reference/doodle-1.png', note: 'the shape', image: new Uint8Array([3]) }
        ],
        pdfs: [],
        ...NO_SLOTS
      }
    ])
    expect(made.hold).not.toHaveBeenCalled()
  })

  it('hands main the bytes of a pasted picture, which has no file, and names it photo-<n>.png (#196)', async () => {
    const d = draft()
    d.photos = [d.photos[0], { uid: 'p', path: '', pasted: true, file: 'pasted.png', note: 'screenshot', image: new Uint8Array([9]), url: 'blob:p' }]
    d.doodles = [{ uid: 'c', strokes: [], png: new Uint8Array([3]), note: '', url: 'blob:c', over: 'p' }]
    const { made } = deps()
    await makeProject(d, made)
    const req = (made.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRequest
    expect(req.photos).toEqual([{ path: '/home/me/IMG_1.JPG', note: 'desk edge' }, { png: new Uint8Array([9]), note: 'screenshot' }])
    expect(req.doodles).toEqual([{ png: new Uint8Array([3]), note: '', over: 1 }])
    const sent = (made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1] as OnboardDraft
    expect(sent.items.map((i) => i.file)).toEqual(['reference/photo-1.jpg', 'reference/photo-2.png', 'reference/doodle-1.png'])
    expect(sent.items[2].note).toBe('drawn over reference/photo-2.png')
  })

  it('sends the index of the photo a doodle is drawn over, and says so in the note the prompt gets, as create does on the card', async () => {
    const d = draft()
    d.doodles = [
      { uid: 'c', strokes: [], png: new Uint8Array([3]), note: 'the shape', url: 'blob:c', over: 'b' },
      { uid: 'g', strokes: [], png: new Uint8Array([4]), note: '', url: 'blob:g', over: 'a' },
      { uid: 'h', strokes: [], png: new Uint8Array([5]), note: 'plain', url: 'blob:h' },
      { uid: 'i', strokes: [], png: new Uint8Array([6]), note: 'pointing', url: 'blob:i', onPhoto: true },
      { uid: 'j', strokes: [], png: new Uint8Array([7]), note: '', url: 'blob:j', onPhoto: true }
    ]
    const { made } = deps()
    await makeProject(d, made)
    const req = (made.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRequest
    expect(req.doodles).toEqual([
      { png: new Uint8Array([3]), note: 'the shape', over: 1 },
      { png: new Uint8Array([4]), note: '', over: 0 },
      { png: new Uint8Array([5]), note: 'plain' },
      { png: new Uint8Array([6]), note: 'pointing', onPhoto: true },
      { png: new Uint8Array([7]), note: '', onPhoto: true }
    ])
    const sent = (made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1] as OnboardDraft
    // The flag the prompt reads: set for the doodles over a photo or one taken out after, never for the plain one.
    expect(sent.items.slice(2).map((i) => i.over === true)).toEqual([true, true, false, true, true])
    expect(sent.items.slice(2).map((i) => [i.file, i.note])).toEqual([
      ['reference/doodle-1.png', 'the shape (drawn over reference/photo-2.webp)'],
      ['reference/doodle-2.png', 'drawn over reference/photo-1.jpg'],
      ['reference/doodle-3.png', 'plain'],
      ['reference/doodle-4.png', 'pointing (drawn over a photo)'],
      ['reference/doodle-5.png', 'drawn over a photo']
    ])
  })

  it('hands the model and effort chosen to the onboarding, and nothing of a choice for the person\'s defaults', async () => {
    const { made } = deps()
    await makeProject(draft(), made, { model: 'opus', effort: 'xhigh' })
    expect((made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ choice: { model: 'opus', effort: 'xhigh' } })
    const plain = deps()
    await makeProject(draft(), plain.made, {})
    expect((plain.made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty('choice')
  })

  it('stays on the page, with the reason and the draft, when create refuses', async () => {
    const { made, calls } = deps({ create: vi.fn(async () => Promise.reject(new Error("Error invoking remote method 'project:create': Error: A folder `cable-clip` is there already."))) })
    expect(await makeProject(draft(), made)).toEqual({ kind: 'refused', message: 'A folder `cable-clip` is there already.' })
    expect(calls).toEqual([])
    expect(made.onboard).not.toHaveBeenCalled()
    expect(made.discard).not.toHaveBeenCalled()
  })

  it('does not offer to create again when the project was made and could not be opened: it opens it if it is listed', async () => {
    const said = 'cable-clip was made, but it could not be opened: no.'
    const { made, calls } = deps({ create: vi.fn(async () => Promise.reject(new Error(said))), listed: vi.fn(async () => ['cable-clip']) })
    const outcome = await makeProject(draft(), made)
    expect(outcome).toEqual({ kind: 'made', name: 'cable-clip', message: `${said} The folder is /ws/cable-clip.`, opened: true })
    expect(calls).toEqual(['discard', 'open'])
    expect(made.onboard).not.toHaveBeenCalled()
    // The page is gone once the project opens: the reason is said where the session is.
    expect(made.hold).toHaveBeenCalledWith(INFO.id, { text: '', reason: `${said} The folder is /ws/cable-clip.` })
  })

  it('says so, and opens nothing, when the project was made and is not listed', async () => {
    const { made } = deps({ create: vi.fn(async () => Promise.reject(new Error('cable-clip was made, but its folder of boards was left before it could be opened.'))), listed: vi.fn(async () => ['plain']) })
    expect(await makeProject(draft(), made)).toMatchObject({ kind: 'made', opened: false })
    expect(made.open).not.toHaveBeenCalled()
  })

  it('holds the prompt for the dock, with the reason, when no session was started', async () => {
    const { made } = deps({ onboard: vi.fn(async () => ({ sessionId: null, prompt: 'the prompt', held: 'the held prompt', problem: 'claude is not installed' })) })
    expect(await makeProject(draft(), made)).toEqual({ kind: 'done', name: 'cable-clip', problem: 'claude is not installed' })
    expect(made.hold).toHaveBeenCalledWith(INFO.id, { text: 'the held prompt', reason: 'claude is not installed' })
  })

  it('holds it too when a session started and was sent nothing, and when onboard itself rejects (its text is then not known)', async () => {
    const a = deps({ onboard: vi.fn(async () => ({ sessionId: 's1', prompt: 'the prompt', held: 'the held prompt', problem: 'This agent has no chat' })) })
    await makeProject(draft(), a.made)
    expect(a.made.hold).toHaveBeenCalledWith(INFO.id, { text: 'the held prompt', reason: 'This agent has no chat' })
    const b = deps({ onboard: vi.fn(async () => Promise.reject(new Error('cable-clip has a session already.'))) })
    expect(await makeProject(draft(), b.made)).toEqual({ kind: 'done', name: 'cable-clip', problem: 'cable-clip has a session already.' })
    expect(b.made.hold).toHaveBeenCalledWith(INFO.id, { text: '', reason: 'cable-clip has a session already.' })
  })

  it('holds a second call while one runs: a click on Start while it works does nothing', async () => {
    let release!: () => void
    const { made } = deps({ create: vi.fn(() => new Promise<typeof INFO>((resolve) => (release = () => resolve(INFO)))) })
    const first = makeProject(draft(), made)
    expect(await makeProject(draft(), made)).toEqual({ kind: 'busy' })
    release()
    await first
    expect(made.create).toHaveBeenCalledTimes(1)
    expect(made.onboard).toHaveBeenCalledTimes(1)
    // And it is free again afterwards.
    expect((await makeProject(draft(), deps().made)).kind).toBe('done')
  })

  it('shows nothing and sends nothing when the workspace was left while it worked', async () => {
    const { made } = deps({ sameWorkspace: vi.fn(() => false) })
    expect(await makeProject(draft(), made)).toMatchObject({ kind: 'made', opened: false })
    expect(made.show).not.toHaveBeenCalled()
    expect(made.onboard).not.toHaveBeenCalled()
    const other = deps({ create: vi.fn(async () => Promise.reject(new Error('cable-clip was made, but it could not be opened: no.'))), sameWorkspace: vi.fn(() => false) })
    expect(await makeProject(draft(), other.made)).toMatchObject({ kind: 'made', opened: false })
    expect(other.made.open).not.toHaveBeenCalled()
  })

  it('says the project could not be shown when showing it failed, and still hands the prompt over', async () => {
    const { made } = deps({ show: vi.fn(async () => Promise.reject(new Error('superseded'))) })
    expect(await makeProject(draft(), made)).toEqual({ kind: 'done', name: 'cable-clip', shown: false })
    expect(made.onboard).toHaveBeenCalledTimes(1)
  })

  it('sends the slots of the draft to create and to the onboarding, a size without a note having none', async () => {
    const d = draft()
    d.sizes = [
      { uid: 'z1', what: 'battery tray', value: '186 x 128', unit: 'mm', source: 'measured', note: '' },
      { uid: 'z2', what: 'hinge', value: '90', unit: '°', source: 'from a manual or datasheet', note: 'page 4' }
    ]
    d.rules = 'hand-solderable'
    d.links = [{ uid: 'l1', url: 'https://example.com/ds', note: 'the datasheet' }]
    d.pdfs = [{ uid: 'p1', path: '/p/Data Sheet.pdf', file: 'Data Sheet.pdf', note: 'the manual' }]
    d.power = [{ uid: 'w1', source: 'USB-C', kind: '', volts: '5', amps: '', note: '' }]
    d.parts = [{ key: 'q1', what: 'C25804', note: '', reading: { missing: true, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true } }]
    const { made } = deps()
    await makeProject(d, made)
    const req = (made.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRequest
    expect(req.sizes).toEqual([
      { what: 'battery tray', value: '186 x 128', unit: 'mm', source: 'measured' },
      { what: 'hinge', value: '90', unit: '°', source: 'from a manual or datasheet', note: 'page 4' }
    ])
    expect(req.rules).toBe('hand-solderable')
    expect(req.links).toEqual([{ url: 'https://example.com/ds', note: 'the datasheet' }])
    expect(req.pdfs).toEqual([{ path: '/p/Data Sheet.pdf', note: 'the manual' }])
    expect(req.power).toEqual([{ source: 'USB-C', kind: '', volts: '5', amps: '', note: '' }])
    // A part's reading is main's: the window sends the number and the note alone.
    expect(req.parts).toEqual([{ what: 'C25804', note: '' }])
    const sent = (made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1] as OnboardDraft
    expect(sent).toMatchObject({ sizes: req.sizes, power: req.power, parts: req.parts, rules: req.rules, links: req.links, pdfs: [{ file: 'reference/Data_Sheet.pdf', note: 'the manual' }] })
  })

  it('refuses, making nothing, a size that is not whole', async () => {
    const d = draft()
    d.sizes = [{ uid: 'z1', what: '', value: '3', unit: 'mm', source: 'measured', note: '' }]
    const { made } = deps()
    expect(await makeProject(d, made)).toMatchObject({ kind: 'refused', message: expect.stringMatching(/what it measures/) })
    expect(made.create).not.toHaveBeenCalled()
  })

  it('refuses, making nothing, a PCB row that is not whole', async () => {
    const d = draft()
    d.connections = [{ uid: 'k1', what: '', bus: 'I2C', connector: 'JST' }]
    const { made } = deps()
    expect(await makeProject(d, made)).toEqual({ kind: 'refused', message: 'Say what plugs in.' })
    expect(made.create).not.toHaveBeenCalled()
  })

  it('leaves a size row nothing was typed in out, and makes the rest', async () => {
    const d = draft()
    d.sizes = [{ uid: 'z0', what: ' ', value: '', unit: 'mm', source: 'measured', note: '' }, { uid: 'z1', what: 'lid', value: '3', unit: 'mm', source: 'measured', note: '' }]
    const { made } = deps()
    expect(await makeProject(d, made)).toMatchObject({ kind: 'done' })
    expect((made.create as ReturnType<typeof vi.fn>).mock.calls[0][0].sizes).toEqual([{ what: 'lid', value: '3', unit: 'mm', source: 'measured' }])
  })

  it('"Make it without starting Claude" makes, lists, shows and spends the draft, and never calls onboard', async () => {
    const { made, calls } = deps()
    const outcome = await makeProject(draft(), made, { model: 'opus' }, false)
    expect(outcome).toEqual({ kind: 'done', name: 'cable-clip' })
    expect(calls).toEqual(['create', 'listed', 'discard', 'show'])
    expect(made.onboard).not.toHaveBeenCalled()
    expect(made.hold).not.toHaveBeenCalled()
  })
})

describe('the preview of a draft', () => {
  it('has the sizes that are whole, the rules, the links and the PDFs by the file create will name them', () => {
    const d = draft()
    d.sizes = [
      { uid: 'z1', what: 'tray', value: '10', unit: 'mm', source: 'a guess', note: '' },
      { uid: 'z2', what: '', value: '', unit: 'mm', source: 'measured', note: '' }
    ]
    d.rules = 'PETG'
    d.links = [{ uid: 'l1', url: 'https://example.com', note: '' }]
    d.pdfs = [{ uid: 'p1', path: '/p/a b.pdf', file: 'a b.pdf', note: 'n' }]
    expect(previewDraft(d)).toMatchObject({ sizes: [{ what: 'tray', value: '10', unit: 'mm', source: 'a guess' }], rules: 'PETG', links: [{ url: 'https://example.com', note: '' }], pdfs: [{ file: 'reference/a_b.pdf', note: 'n' }] })
  })
})
