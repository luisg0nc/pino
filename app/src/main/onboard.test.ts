// The first prompt of a new project, and the call that sends it.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OnboardDraft } from '../shared/bridge'
import type { CardsFile, PartReading } from '../shared/cards'
import type { ProjectInfo } from '../shared/project'
import { DEFAULT_FAB, type PowerRow } from '../shared/slots'
import { cardsLine } from './cards/text'
import { type ImageBytes, MOST_IMAGES, checkedImage, onboardProject, type OnboardDeps, onboardPrompt, previewPrompt, type PromptInput, SETTLE } from './onboard'
import { makeReadings } from './projects/readings'

const t = (tool: string) => `mcp__pino__${tool}`
/** The eighteen tools pino has (`turncost.test.ts` holds the list to the server). */
const TOOL_NAMES = ['add_card', 'brief', 'check', 'look', 'marks', 'measure', 'nets', 'parts', 'point', 'project', 'resolve_mark', 'route', 'trace', 'ratsnest', 'diff', 'route_net', 'nudge', 'keep']
const usbC: PowerRow = { source: 'USB-C', kind: '', volts: '5', amps: '0.5', note: '' }
const READING: PartReading = { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }
const NO_SLOTS = { power: [], connections: [], sizes: [], enclosure: '', edges: '', parts: [], fab: null, rules: '', links: [] }
const input = (over: Partial<PromptInput> = {}): PromptInput => ({ name: 'blinky', description: 'Blinks an LED.', items: [], pdfs: [], ...NO_SLOTS, ...over })

/** A PNG with the header of a picture w x h (and not a picture after it). */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
/** A JPEG with a comment segment, then a start of frame of w x h. */
function jpeg(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32)
  b.set([0xff, 0xd8, 0xff, 0xfe, 0, 6, 1, 2, 3, 4, 0xff, 0xc0, 0, 8, 8])
  const v = new DataView(b.buffer)
  v.setUint16(15, h)
  v.setUint16(17, w)
  return b
}
const image = (bytes: Uint8Array): ImageBytes => checkedImage(bytes)!

/** The end of the first prompt: that all of it is kept, and what to settle before board.py. */
const ASK_FIRST = [
  'There is no board.py yet. All of the above is kept for later conversations: brief.md holds their words and each slot is a card of theirs (mcp__pino__brief); you need not read them now.',
  '',
  'Before you write board.py, settle what would make the first board wrong: what the board connects to and how each thing talks, how it is powered and what it draws, where it has to fit, its mounting holes and which edge each connector sits on, which parts it uses and whether JLC has them, and how many layers it has and who assembles it. Something has a source when the person gave it above, or a picture, a PDF or a link says it; what they gave is not asked again.',
  'Ask the person in one round, before you write board.py, with AskUserQuestion, only what would change the board, and for a value one option a typical value labelled as typical ("3.3 V from an LDO, usual for an ESP32-C3"). The person may answer "build with assumptions". If nothing would change the board, ask nothing.',
  'Check every part you mean to use with mcp__pino__parts, basic parts first. Then, before you write board.py, write what you settled as cards of yours with mcp__pino__add_card, one per topic: a requirement, a decision with its reason, an open question with what waits on it, each part by LCSC number, and the power budget of each rail. With fab and assembly given, set layers in Board(...) of board.py to what they asked; pino picks the fab profile for that layer count. Your reply lists what you assumed.'
].join('\n')

describe('checkedImage', () => {
  it('takes a PNG or a JPEG whose long edge is at most 2000, and says which', () => {
    expect(checkedImage(png(1280, 720))).toMatchObject({ mediaType: 'image/png', width: 1280, height: 720 })
    expect(checkedImage(jpeg(2000, 1500))).toMatchObject({ mediaType: 'image/jpeg', width: 2000, height: 1500 })
  })

  it('refuses a longer edge, a WebP, a PDF, too few bytes, a size of 0 and a JPEG with no frame header', () => {
    expect(checkedImage(png(2001, 10))).toBeNull()
    expect(checkedImage(jpeg(10, 2001))).toBeNull()
    expect(checkedImage(png(0, 10))).toBeNull()
    expect(checkedImage(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull()
    expect(checkedImage(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull()
    expect(checkedImage(new Uint8Array(0))).toBeNull()
    expect(checkedImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
    expect(checkedImage('nope' as unknown as Uint8Array)).toBeNull()
  })

  it('refuses a picture of more than 3.75 MB (its base64 would be over 5 MB)', () => {
    const ok = new Uint8Array(3_750_000)
    ok.set(png(10, 10))
    expect(checkedImage(ok)).not.toBeNull()
    const big = new Uint8Array(3_750_001)
    big.set(png(10, 10))
    expect(checkedImage(big)).toBeNull()
  })
})

const full = (): PromptInput =>
  input({
    description: 'Blinks an LED\nwhen the door opens.',
    items: [
      { file: 'reference/photo-1.jpg', note: 'the case', image: image(jpeg(1280, 960)) },
      { file: 'reference/doodle-1.png', note: 'where the LED goes', image: image(png(1200, 800)) }
    ]
  })

describe('what pino asks of a first board', () => {
  it('says what to settle before board.py, once, and names the tools pino has', () => {
    const { text } = onboardPrompt(input(), t)
    expect(text).toContain('Before you write board.py, settle what would make the first board wrong: what the board connects to and how each thing talks, how it is powered and what it draws, where it has to fit, its mounting holes and which edge each connector sits on, which parts it uses and whether JLC has them, and how many layers it has and who assembles it.')
    expect(text.match(/Before you write board\.py, settle/g)).toHaveLength(1)
    expect(SETTLE).toHaveLength(5)
    const named = [...text.matchAll(/mcp__pino__(\w+)/g)].map((m) => m[1])
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((tool) => !TOOL_NAMES.includes(tool))).toEqual([])
    expect(text).toContain(`write what you settled as cards of yours with ${t('add_card')}`)
  })

  it('names the tools as the agent knows them when none is given', () => {
    expect(onboardPrompt(input()).text).toBe(onboardPrompt(input(), t).text)
  })

  it('tells every slot in its words, and leaves out the empty ones', () => {
    const { text } = onboardPrompt(input({ power: [usbC], parts: [{ what: 'C25804', note: 'pull-up', reading: READING }, { what: 'C51118', note: '' }], fab: DEFAULT_FAB }), t)
    expect(text).toContain('Power:\n- USB-C, 5 V, 0.5 A')
    expect(text).toContain('Parts they have:\n- C25804: pull-up · basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)\n- C51118: stock not checked')
    expect(text).toContain('Fab and assembly: 2 layers, 1.6 mm, JLC assembles it, 5 boards.')
    expect(text).not.toContain('Connections:')
    expect(onboardPrompt(input(), t).text).not.toMatch(/Power:|Connections:|Size and shape:|Parts they have:|Fab and assembly:|Rules:|Links \(|A PDF;|What they gave/)
  })

  it('says every slot, in the order they stand in the Brief', () => {
    const { text, held } = onboardPrompt(
      input({
        pdfs: [{ file: 'reference/datasheet.pdf', note: 'the cell' }, { file: 'reference/other.pdf', note: '' }],
        power: [usbC],
        connections: [{ what: 'SHT40 sensor', bus: 'I2C', connector: 'JST-SH 4-pin' }],
        sizes: [{ what: 'Board width', value: '50', unit: 'mm', source: 'a guess' }],
        enclosure: 'a mint tin',
        edges: 'USB on a short edge',
        parts: [{ what: 'ESP32-C3 module', note: 'from the drawer' }, { what: 'an OLED', note: '' }, { what: 'C25804', note: '', reading: READING }, { what: 'C51118', note: 'the LDO' }],
        fab: { layers: 4, thickness: 1.0, assembly: 'mix', boards: 1 },
        rules: 'Hand-solderable.\n0805 or larger.',
        links: [{ url: 'https://example.com/tray', note: 'a reference design' }, { url: 'https://example.com/b', note: '' }]
      }),
      t
    )
    expect(text).toBe(
      [
        "This is a new board, blinky, made in pino just now. What it does, in the person's words:",
        '',
        'Blinks an LED.',
        '',
        'What they gave (all of it is also in brief.md; files are in reference/):',
        '- reference/datasheet.pdf: the cell. A PDF; read it with your own tools if it helps.',
        '- reference/other.pdf. A PDF; read it with your own tools if it helps.',
        '',
        'Power:',
        '- USB-C, 5 V, 0.5 A',
        '',
        'Connections:',
        '- SHT40 sensor over I2C, JST-SH 4-pin',
        '',
        'Size and shape:',
        '- Board width 50 mm (a guess)',
        '- Fits an enclosure: a mint tin',
        '- Connector edges: USB on a short edge',
        '',
        'Parts they have:',
        '- ESP32-C3 module: from the drawer',
        '- an OLED',
        '- C25804: basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)',
        '- C51118: the LDO · stock not checked',
        '',
        'Fab and assembly: 4 layers, 1.0 mm, JLC assembles some and you solder the rest, 1 board.',
        '',
        'Rules:',
        'Hand-solderable.\n0805 or larger.',
        '',
        'Links (pino does not open links; read one only if it helps):',
        '- https://example.com/tray: a reference design',
        '- https://example.com/b',
        '',
        ASK_FIRST
      ].join('\n')
    )
    expect(held).toBe(text)
  })
})

describe('onboardPrompt', () => {
  it('says a doodle drawn over a photo is the person\'s ink over that photo, not a drawing on a grid', () => {
    const over = { ...full(), items: [{ file: 'reference/doodle-1.png', note: 'the shape (drawn over reference/photo-1.jpg)', image: image(png(1200, 800)), over: true as const }] }
    const { text } = onboardPrompt(over)
    expect(text).not.toContain('light grid')
    expect(text).toContain("A doodle drawn over a photo is the person's ink over that photo")
    // A photo that was taken from the draft is still what is under the ink: the same sentence, and no grid.
    const gone = { ...full(), items: [{ file: 'reference/doodle-1.png', note: 'the shape (drawn over a photo)', image: image(png(1200, 800)), over: true as const }] }
    expect(onboardPrompt(gone).text).not.toContain('light grid')
    expect(onboardPrompt(gone).text).toContain("the person's ink over that photo")
    // One of each says both.
    const both = { ...full(), items: [...over.items, { file: 'reference/doodle-2.png', note: 'a plain one', image: image(png(1200, 800)) }] }
    expect(onboardPrompt(both).text).toContain('light grid')
    expect(onboardPrompt(both).text).toContain("the person's ink over that photo")
  })

  it('reads whether a doodle is over a photo from the flag, not from the words of its note', () => {
    const grid = { ...full(), items: [{ file: 'reference/doodle-1.png', note: 'the shape (drawn over a photo)', image: image(png(1200, 800)) }] }
    expect(onboardPrompt(grid).text).toContain('light grid')
    expect(onboardPrompt(grid).text).not.toContain("the person's ink over that photo")
  })

  it('writes the text with its pictures, each after a line that names it', () => {
    const { text, blocks } = onboardPrompt(full(), t)
    expect(text).toBe(
      [
        "This is a new board, blinky, made in pino just now. What it does, in the person's words:",
        '',
        'Blinks an LED\nwhen the door opens.',
        '',
        'What they gave (all of it is also in brief.md; files are in reference/):',
        '- reference/photo-1.jpg: the case (attached: picture 1)',
        '- reference/doodle-1.png: where the LED goes (attached: picture 2)',
        '',
        'A doodle is drawn over a light grid: 1 square = 40 px, with no scale. Read proportions from it, not sizes.',
        '',
        ASK_FIRST
      ].join('\n')
    )
    expect(blocks[0]).toEqual({ type: 'text', text })
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text', 'image'])
    expect(blocks.filter((b) => b.type === 'text').slice(1)).toEqual([
      { type: 'text', text: "Picture 1: reference/photo-1.jpg (the person's photo): the case" },
      { type: 'text', text: "Picture 2: reference/doodle-1.png (the person's doodle): where the LED goes" }
    ])
    expect(blocks.filter((b) => b.type === 'image').map((b) => (b as { source: { media_type: string } }).source.media_type)).toEqual(['image/jpeg', 'image/png'])
  })

  it('captions only the pictures that are attached, numbered in order, and folds a note to one line', () => {
    const { blocks } = onboardPrompt(input({ items: [{ file: 'reference/photo-1.jpg', note: 'no picture' }, { file: 'reference/doodle-1.png', note: 'a\nb', image: image(png(100, 100)) }, { file: 'reference/doodle-2.png', note: '', image: image(png(100, 100)) }] }))
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'image', 'text', 'image'])
    expect((blocks[1] as { text: string }).text).toBe("Picture 1: reference/doodle-1.png (the person's doodle): a b")
    expect((blocks[3] as { text: string }).text).toBe("Picture 2: reference/doodle-2.png (the person's doodle)")
  })

  it('writes a text to hold that says no picture is attached and names the files of the pictures', () => {
    const { text, held } = onboardPrompt(full())
    expect(text).toContain('(attached: picture 1)')
    expect(held).not.toContain('attached: picture')
    expect(held).not.toContain('Picture 1')
    expect(held).toContain('- reference/photo-1.jpg: the case (not attached: read reference/photo-1.jpg)')
    expect(held).toContain('- reference/doodle-1.png: where the LED goes (not attached: read reference/doodle-1.png)')
  })

  it('attaches at most six pictures, each after a line that names it', () => {
    const many = input({ items: Array.from({ length: 8 }, (_, i) => ({ file: `reference/photo-${i + 1}.png`, note: `n${i + 1}`, image: image(png(10 + i, 10)) })) })
    const { text, blocks, attached } = onboardPrompt(many)
    expect(MOST_IMAGES).toBe(6)
    const images = blocks.filter((b) => b.type === 'image')
    expect(images).toHaveLength(6)
    const widths = images.map((b) => new DataView(new Uint8Array(Buffer.from((b as { source: { data: string } }).source.data, 'base64')).buffer).getUint32(16))
    expect(widths).toEqual([10, 11, 12, 13, 14, 15])
    expect(attached).toEqual([1, 2, 3, 4, 5, 6, null, null])
    expect(blocks.map((b) => b.type)).toEqual(['text', ...Array.from({ length: 6 }, () => ['text', 'image']).flat()])
    expect(text).toContain('- reference/photo-7.png: n7 (not attached: read reference/photo-7.png)')
  })

  it('names an item with no usable picture as not attached, and takes every note as one line', () => {
    const { text, blocks } = onboardPrompt(input({ items: [{ file: 'reference/photo-1.webp', note: 'line one\n\n- injected: yes\t  end' }] }))
    expect(text).toContain('- reference/photo-1.webp: line one - injected: yes end (not attached: read reference/photo-1.webp)')
    expect(blocks).toHaveLength(1)
  })

  it('folds a link and a PDF to one line each', () => {
    const { text } = onboardPrompt(input({ links: [{ url: 'https://a.example/x', note: 'a\n- injected' }], pdfs: [{ file: 'reference/a.pdf', note: 'a\n- injected' }] }))
    expect(text).not.toMatch(/^- injected/m)
  })
})

describe('onboardProject', () => {
  let base: string
  let dir: string
  const calls: string[] = []
  let sent: Array<{ sessionId: string; blocks: Array<{ type: string; text?: string }> }>
  let file: CardsFile
  let readings: ReturnType<typeof makeReadings>
  let marked: Record<string, string> | undefined
  const project = (): ProjectInfo => ({ id: 'p1', name: 'blinky', dir })

  type Start = OnboardDeps['sessions']['start']
  function deps(over: Partial<Omit<OnboardDeps, 'sessions'>> & { sessions?: Partial<OnboardDeps['sessions']> } = {}): OnboardDeps {
    const { sessions, ...rest } = over
    return {
      project: (id) => (id === 'p1' ? project() : undefined),
      sessions: {
        current: () => null,
        start: (async (p) => {
          calls.push(`start ${p.name}`)
          return { sessionId: 'sess', status: 'starting' as const }
        }) satisfies Start,
        sendBlocks: async (sessionId, blocks) => {
          calls.push('prompt')
          sent.push({ sessionId, blocks })
        },
        ...sessions
      },
      cards: {
        read: async () => file,
        markTold: async (id, told) => {
          calls.push(`told ${id}`)
          marked = told
        }
      },
      readings,
      toolName: t,
      ...rest
    }
  }
  const draft = (over: Partial<OnboardDraft> = {}): OnboardDraft => ({ description: 'Blinks an LED.', items: [], pdfs: [], ...NO_SLOTS, ...over })

  beforeEach(() => {
    base = mkdtempSync(join(realpathSync(tmpdir()), 'pino-onboard-'))
    dir = join(base, 'blinky')
    mkdirSync(join(dir, 'reference'), { recursive: true })
    writeFileSync(join(dir, 'brief.md'), '# blinky\n\nBlinks an LED.\n')
    writeFileSync(join(dir, 'reference', 'photo-1.jpg'), 'x')
    writeFileSync(join(dir, 'reference', 'doodle-1.png'), 'x')
    calls.length = 0
    sent = []
    marked = undefined
    readings = makeReadings()
    file = { next: 3, cards: [{ id: 'C1', kind: 'rule', by: 'person', text: '0805' }, { id: 'C2', kind: 'power', by: 'person', text: 'USB-C' }] }
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('the preview is the text that is sent', async () => {
    readings.put('C25804', READING)
    const given = { power: [usbC], parts: [{ what: 'C25804', note: 'pull-up' }], fab: DEFAULT_FAB, rules: '0805' }
    const d = draft({
      ...given,
      items: [{ file: 'reference/photo-1.jpg', note: 'the case', image: jpeg(1280, 960) }, { file: 'reference/doodle-1.png', note: 'shape', image: png(1200, 800), over: true }]
    })
    const shown = previewPrompt('blinky', { ...d, items: d.items.map(({ image: _image, ...item }) => ({ ...item, hasImage: true })) }, t, readings)
    expect(calls).toEqual([])
    expect(shown.attached).toEqual([1, 2])
    await onboardProject(deps(), 'p1', d)
    expect(sent[0].blocks[0].text).toBe(shown.text)
    expect(shown.text).toContain('- C25804: pull-up · basic · 0603')
  })

  it('previews a page still being filled: what is not whole yet is left out, and a nameless board has a name to be said', () => {
    const shown = previewPrompt('  ', { ...draft(), description: '', items: [], connections: [{ what: '', bus: 'I2C', connector: '' }, { what: 'LED', bus: 'GPIO', connector: '' }], fab: { ...DEFAULT_FAB, boards: 0 }, sizes: [{ what: '', value: '', unit: 'mm', source: 'measured' }], links: [{ url: 'nope', note: '' }] }, t)
    expect(shown.text).toContain('This is a new board, new-board, made in pino just now.')
    expect(shown.text).toContain('Connections:\n- LED over GPIO')
    expect(shown.text).not.toMatch(/Size and shape:|Fab and assembly:|Links \(/)
  })

  it('takes a part’s reading from main, never from the draft', async () => {
    const forged = { ...READING, stock: 9 }
    await onboardProject(deps(), 'p1', draft({ parts: [{ what: 'C25804', note: '', reading: forged } as never] }))
    expect(sent[0].blocks[0].text).toContain('- C25804: stock not checked')
  })

  it("marks the Brief told before the prompt goes, so its line says nothing new", async () => {
    await onboardProject(deps(), 'p1', draft())
    expect(calls).toEqual(['start blinky', 'told p1', 'prompt'])
    expect(cardsLine(file, marked!, '# blinky\n\nBlinks an LED.\n', t).line).toBe(`Brief: 2 cards (0 new). Read them with ${t('brief')}.`)
  })

  it('sends the prompt all the same when the Brief cannot be marked as told', async () => {
    const out = await onboardProject(deps({ cards: { read: async () => file, markTold: async () => { throw new Error('disk full') } } }), 'p1', draft())
    expect(out).toMatchObject({ sessionId: 'sess' })
    expect(out.problem).toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('refuses a draft that is not what it may be, before any session starts', async () => {
    writeFileSync(join(dir, 'reference', 'a.pdf'), '%PDF-1.4')
    const size = { what: 'cable', value: '6', unit: 'mm', source: 'measured' }
    const bad: Array<[Partial<OnboardDraft>, RegExp]> = [
      [{ description: 3 as never }, /description/],
      [{ items: [{ file: '../../etc/passwd', note: '' }] }, /reference/],
      [{ items: [{ file: 'reference/photo-9.png', note: '' }] }, /not there/],
      [{ items: [{ file: 'reference/photo-1.jpg', note: 5 as never }] }, /note/],
      [{ items: [{ file: 'reference/photo-1.jpg', note: 'x'.repeat(2001) }] }, /note/],
      [{ items: [{ file: 'reference/photo-1.jpg', note: '' }, { file: 'reference/photo-1.jpg', note: '' }] }, /twice/],
      [{ power: 'no' as never }, /power rows/],
      [{ connections: [{ what: 'x'.repeat(121), bus: 'I2C', connector: '' }] }, /at most 120/],
      [{ parts: [{ what: '', note: '' }] }, /LCSC number or name a module/],
      [{ fab: { ...DEFAULT_FAB, boards: 0 } }, /boards/],
      [{ enclosure: 'x'.repeat(301) }, /enclosure/],
      [{ sizes: 'no' as never }, /sizes/],
      [{ sizes: Array.from({ length: 41 }, () => size) as never }, /At most 40 sizes/],
      [{ sizes: [{ ...size, source: 'from Claude' }] as never }, /from Claude/],
      [{ sizes: [{ ...size, value: 'a\nb' }] as never }, /one line/],
      [{ rules: 3 as never }, /rules/],
      [{ rules: 'x'.repeat(4001) }, /rules/],
      [{ links: 'no' as never }, /links/],
      [{ links: Array.from({ length: 21 }, () => ({ url: 'https://example.com', note: '' })) }, /At most 20 links/],
      [{ links: [{ url: 'file:///etc/passwd', note: '' }] }, /http or https/],
      [{ links: [{ url: 'javascript:alert(1)', note: '' }] }, /http or https/],
      [{ links: [{ url: `https://example.com/${'a'.repeat(2000)}`, note: '' }] }, /2000/],
      [{ links: [{ url: 'https://example.com/a b', note: '' }] }, /space/],
      [{ links: [{ url: 'https://example.com', note: 'x'.repeat(301) }] }, /300/],
      [{ pdfs: 'no' as never }, /PDFs/],
      [{ pdfs: Array.from({ length: 7 }, (_, i) => ({ file: `reference/a${i}.pdf`, note: '' })) }, /At most 6 PDFs/],
      [{ pdfs: [{ file: '../../etc/a.pdf', note: '' }] }, /PDF/],
      [{ pdfs: [{ file: 'reference/a.txt', note: '' }] }, /PDF/],
      [{ pdfs: [{ file: 'reference/sub/a.pdf', note: '' }] }, /PDF/],
      [{ pdfs: [{ file: 'reference/missing.pdf', note: '' }] }, /not there/],
      [{ pdfs: [{ file: 'reference/a.pdf', note: '' }, { file: 'reference/a.pdf', note: '' }] }, /twice/]
    ]
    for (const [over, why] of bad) await expect(onboardProject(deps(), 'p1', draft(over)), JSON.stringify(over).slice(0, 80)).rejects.toThrow(why)
    await expect(onboardProject(deps(), 'p1', null as never)).rejects.toThrow(/draft/)
    expect(calls).toEqual([])
    await expect(onboardProject(deps(), 'p1', draft({ pdfs: [{ file: 'reference/a.pdf', note: 'ok' }] }))).resolves.toMatchObject({ sessionId: 'sess' })
  })

  it('refuses a PDF that is a link, not a plain file', async () => {
    symlinkSync('/etc/hostname', join(dir, 'reference', 'l.pdf'))
    await expect(onboardProject(deps(), 'p1', draft({ pdfs: [{ file: 'reference/l.pdf', note: '' }] }))).rejects.toThrow(/not there/)
  })

  it('starts the session on the model and effort chosen on the page, and on the person\'s defaults for what is not one', async () => {
    const chosen: unknown[] = []
    const starting = deps({ sessions: { start: async (_p, choice) => (chosen.push(choice), { sessionId: 'sess', status: 'starting' }) } })
    await onboardProject(starting, 'p1', draft({ choice: { model: 'opus', effort: 'high' } }))
    await onboardProject(starting, 'p1', draft({ choice: { model: '-x', effort: 'loud' } as never }))
    await onboardProject(starting, 'p1', draft())
    expect(chosen).toEqual([{ model: 'opus', effort: 'high' }, {}, {}])
  })

  it('does not attach a picture that is not one, and says so in the text', async () => {
    const out = await onboardProject(deps(), 'p1', draft({ items: [{ file: 'reference/photo-1.jpg', note: 'desk', image: new Uint8Array([1, 2, 3]) }] }))
    expect(sent[0].blocks.map((b) => b.type)).toEqual(['text'])
    expect(out.prompt).toContain('(not attached: read reference/photo-1.jpg)')
  })

  it('a session that cannot start is not a rejection: the prompt comes back to be held', async () => {
    for (const start of [async () => ({ refused: 'Claude Code was not found' }), async () => Promise.reject(new Error('Claude Code was not found\n  at somewhere'))]) {
      const out = await onboardProject(deps({ sessions: { start } }), 'p1', draft({ items: [{ file: 'reference/photo-1.jpg', note: '', image: jpeg(10, 10) }] }))
      expect(out).toMatchObject({ sessionId: null, problem: 'Claude Code was not found' })
      expect(out.prompt).toContain('(attached: picture 1)')
      expect(out.held).toContain('(not attached: read reference/photo-1.jpg)')
    }
    expect(calls).toEqual([])
  })

  it('refuses a project that is not the open one, or has a session already, and does nothing', async () => {
    await expect(onboardProject(deps(), 'nope', draft())).rejects.toThrow('That project is not open.')
    await expect(onboardProject(deps({ sessions: { current: () => ({ sessionId: 'x', status: 'idle' }) } }), 'p1', draft())).rejects.toThrow('blinky has a session already.')
    expect(calls).toEqual([])
    expect(sent).toEqual([])
  })

  it('lets one call at a time onboard a project: a second, while the first starts, rejects before it starts anything', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = deps({ sessions: { start: async () => (calls.push('start'), await gate, { sessionId: 'sess', status: 'starting' }) } })
    const first = onboardProject(slow, 'p1', draft())
    await expect(onboardProject(slow, 'p1', draft())).rejects.toThrow('blinky is being started already.')
    release()
    expect((await first).sessionId).toBe('sess')
    expect(calls.filter((c) => c === 'start')).toHaveLength(1)
    expect(sent).toHaveLength(1)
    // And once it ended, it may be asked again (a rejected call frees it too).
    await expect(onboardProject(deps(), 'p1', draft({ description: 3 as never }))).rejects.toThrow()
    await expect(onboardProject(deps(), 'p1', draft())).resolves.toMatchObject({ sessionId: 'sess' })
  })

  it('keeps the session and the prompt, and says why, when the prompt cannot be sent', async () => {
    const out = await onboardProject(deps({ sessions: { sendBlocks: async () => { throw new Error('This session has ended') } } }), 'p1', draft())
    expect(out).toMatchObject({ sessionId: 'sess', problem: 'This session has ended' })
    expect(out.held).toContain('This is a new board')
  })
})
