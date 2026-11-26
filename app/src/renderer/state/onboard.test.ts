import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_LINKS, MOST_REFERENCES } from '../../shared/projectName'
import { MAX_SIZES } from '../../shared/size'
import { MAX_TEXT_CHARS } from '../../shared/cards'
import { DEFAULT_FAB, MAX_CONNECTIONS, MAX_PARTS_HAD, MAX_POWER, MAX_SHAPE_NOTE } from '../../shared/slots'
import { createRequest, previewDraft, rowsWrong } from '../ui/onboard/make'
import { actions } from './store'
import { draftHas, onboard, onboarding, heldSaid, sizeBlank, sizeProblem, sizesWrong, type Draft, type DoodleDraft, type PhotoDraft, type SizeDraft } from './onboard'

const photo = (n: number): Omit<PhotoDraft, 'uid' | 'note'> => ({ path: `/p/photo-${n}.jpg`, file: `photo-${n}.jpg`, image: new Uint8Array([n]), url: `blob:p${n}` })
const doodle = (n: number): Omit<DoodleDraft, 'uid' | 'note'> => ({ strokes: [{ tool: 'pen', width: 4, points: [[n, n]] }], png: new Uint8Array([n]), url: `blob:d${n}` })
const info = (root: string) => ({ root, name: 'a', projects: [] })
const row = (what: string, value: string): SizeDraft => ({ uid: what, what, value, unit: 'mm', source: 'a guess', note: '' })
const draftWith = (over: Partial<Draft>): Draft => ({ ...onboard.getState().draft, ...over })

beforeEach(() => {
  actions.openWorkspace(info('/ws/a'))
  onboarding.discard()
})

describe('the draft of a new project', () => {
  it('turns a draft into the request main makes the project from', () => {
    expect(createRequest(draftWith({ name: 'blinky', description: 'Blinks.', sizes: [row('Board width', '50')], enclosure: 'Hammond 1551K', rules: 'hand-solderable' }))).toMatchObject({ name: 'blinky', sizes: [{ what: 'Board width', value: '50', unit: 'mm', source: 'a guess' }], enclosure: 'Hammond 1551K', rules: 'hand-solderable', power: [], parts: [], fab: null })
  })

  it('sends the PCB rows as main takes them, and leaves out the ones nothing was typed in', () => {
    onboarding.addPower()
    onboarding.addConnection()
    onboarding.addConnection()
    onboarding.addPart()
    onboarding.addPart()
    const draft = onboard.getState().draft
    onboarding.setPower(draft.power[0].uid, { volts: '5', amps: '0.5' })
    onboarding.setConnection(draft.connections[0].uid, { what: 'SHT40 sensor', bus: 'I2C', connector: 'JST-SH 4-pin' })
    onboarding.setPart(draft.parts[0].key, { what: 'c25804', note: 'pull-up' })
    onboarding.setFab(DEFAULT_FAB)
    expect(createRequest(onboard.getState().draft)).toMatchObject({
      power: [{ source: 'USB-C', kind: '', volts: '5', amps: '0.5', note: '' }],
      connections: [{ what: 'SHT40 sensor', bus: 'I2C', connector: 'JST-SH 4-pin' }],
      parts: [{ what: 'C25804', note: 'pull-up' }],
      fab: DEFAULT_FAB,
      enclosure: '',
      edges: ''
    })
    expect(createRequest(onboard.getState().draft).connections).toHaveLength(1)
    expect(createRequest(onboard.getState().draft).parts).toHaveLength(1)
  })

  it('forgets what was read of a part once its number changes, and keeps it when its note does', () => {
    onboarding.addPart()
    const { key } = onboard.getState().draft.parts[0]
    onboarding.setPart(key, { what: 'C25804', reading: { missing: true, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true } })
    onboarding.setPart(key, { note: 'pull-up' })
    expect(onboard.getState().draft.parts[0].reading).toBeDefined()
    onboarding.setPart(key, { what: 'C2580' })
    expect(onboard.getState().draft.parts[0]).toEqual({ key, what: 'C2580', note: 'pull-up' })
  })

  it('holds the PCB slots to their caps, and each alone is something in the draft', () => {
    for (const [add, most, said] of [[onboarding.addPower, MAX_POWER, 'power rows'], [onboarding.addConnection, MAX_CONNECTIONS, 'connections'], [onboarding.addPart, MAX_PARTS_HAD, 'parts']] as const) {
      onboarding.discard()
      for (let n = 0; n < most; n += 1) expect(add()).toBeNull()
      expect(draftHas(onboard.getState().draft)).toBe(true)
      expect(add()).toBe(`At most ${most} ${said}.`)
    }
    for (const put of [() => onboarding.setEnclosure('a box'), () => onboarding.setEdges('left'), () => onboarding.setFab(DEFAULT_FAB)]) {
      onboarding.discard()
      expect(draftHas(onboard.getState().draft)).toBe(false)
      put()
      expect(draftHas(onboard.getState().draft)).toBe(true)
    }
    expect(onboarding.setEnclosure('x'.repeat(MAX_SHAPE_NOTE + 1))).toBe(`At most ${MAX_SHAPE_NOTE} characters.`)
  })

  it('holds the project back over a number of boards the fab does not take, and leaves it out of the preview', () => {
    onboarding.setFab({ ...DEFAULT_FAB, boards: 0 })
    expect(rowsWrong(onboard.getState().draft)).toBe('Between 1 and 10,000 boards.')
    expect(previewDraft(onboard.getState().draft).fab).toBeNull()
  })

  it('removes a row of any slot', () => {
    onboarding.addPower()
    onboarding.addPart()
    onboarding.remove('power', onboard.getState().draft.power[0].uid)
    onboarding.remove('parts', onboard.getState().draft.parts[0].key)
    expect([onboard.getState().draft.power, onboard.getState().draft.parts]).toEqual([[], []])
  })

  it('starts empty, and says it holds something once a name, a few words or any reference is in it', () => {
    expect(draftHas(onboard.getState().draft)).toBe(false)
    onboarding.setName('  ')
    onboarding.setDescription('\n')
    expect(draftHas(onboard.getState().draft)).toBe(false)
    onboarding.setName('clip')
    expect(draftHas(onboard.getState().draft)).toBe(true)
    onboarding.discard()
    onboarding.addDoodle(doodle(1))
    expect(draftHas(onboard.getState().draft)).toBe(true)
  })

  it('keeps at most as many of each kind as main makes an object with, and says how many were left out', () => {
    const photos = Array.from({ length: MOST_REFERENCES.photos + 3 }, (_, n) => photo(n))
    expect(onboarding.addPhotos(photos)).toEqual({ added: MOST_REFERENCES.photos, left: 3, same: 0 })
    expect(onboard.getState().draft.photos).toHaveLength(MOST_REFERENCES.photos)
    expect(onboarding.addPhotos([photo(99)])).toEqual({ added: 0, left: 1, same: 0 })

    for (let n = 0; n < MOST_REFERENCES.doodles; n += 1) expect(onboarding.addDoodle(doodle(n))).toBe(true)
    expect(onboarding.addDoodle(doodle(9))).toBe(false)
  })

  it('takes a photo once', () => {
    expect(onboarding.addPhotos([photo(1), photo(1)])).toEqual({ added: 1, left: 0, same: 1 })
    expect(onboard.getState().draft.photos).toHaveLength(1)
  })

  it('changes a note, removes an item, and changes a doodle in place: the same key, the strokes kept as vectors', () => {
    onboarding.addPhotos([photo(1), photo(2)])
    const [first, second] = onboard.getState().draft.photos
    onboarding.setNote('photos', second.uid, 'the desk edge')
    expect(onboard.getState().draft.photos.map((p) => p.note)).toEqual(['', 'the desk edge'])
    onboarding.remove('photos', first.uid)
    expect(onboard.getState().draft.photos.map((p) => p.uid)).toEqual([second.uid])

    onboarding.addDoodle(doodle(1))
    const [d] = onboard.getState().draft.doodles
    onboarding.setNote('doodles', d.uid, 'the shape')
    onboarding.replaceDoodle(d.uid, doodle(2))
    const [again] = onboard.getState().draft.doodles
    expect(again).toMatchObject({ uid: d.uid, note: 'the shape', strokes: [{ tool: 'pen', width: 4, points: [[2, 2]] }] })
  })

  it('keeps the doodle and its picture when the photo it was drawn over is removed, and forgets which photo it was', () => {
    onboarding.addPhotos([photo(1), photo(2)])
    const [first, second] = onboard.getState().draft.photos
    onboarding.addDoodle({ ...doodle(1), over: second.uid })
    onboarding.addDoodle({ ...doodle(2), over: first.uid })
    onboarding.remove('photos', second.uid)
    const [a, b] = onboard.getState().draft.doodles
    expect(a.over).toBeUndefined()
    expect(a.onPhoto).toBe(true)
    expect(a).toMatchObject({ png: new Uint8Array([1]), strokes: [{ tool: 'pen', width: 4, points: [[1, 1]] }] })
    expect(b.over).toBe(first.uid)
    expect(b.onPhoto).toBeUndefined()
    onboarding.replaceDoodle(a.uid, { ...doodle(3), over: undefined })
    expect(onboard.getState().draft.doodles[0].onPhoto).toBeUndefined()
  })

  it('is let go by discard: nothing stays, and the page is not on', () => {
    onboarding.setName('clip')
    onboarding.addPhotos([photo(1)])
    onboarding.discard()
    expect(draftHas(onboard.getState().draft)).toBe(false)
    expect(onboard.getState().draft.photos).toEqual([])
  })

  it('is dropped with the workspace: it was written for a folder that is closed', () => {
    onboarding.setName('clip')
    actions.openWorkspace(info('/ws/b'))
    expect(draftHas(onboard.getState().draft)).toBe(false)
    // A workspace that is listed again is the same one: the draft stays. So it does while the person goes to its page of projects and back.
    onboarding.setName('clip')
    actions.setWorkspace(info('/ws/b'))
    actions.showPage('new')
    actions.showPage('projects')
    expect(onboard.getState().draft.name).toBe('clip')
  })

  it('words the notice of a first prompt that was not sent', () => {
    expect(heldSaid({ text: '', reason: 'No agent.' })).toBe('The first prompt of this project was not sent: No agent. What was given is in brief.md, reference/ and the Brief.')
    expect(heldSaid({ text: 'p', reason: 'No agent.' })).toBe('The first prompt of this project was not sent: No agent. It is kept: it goes when you start a session.')
  })

  it('holds the prompt that was not sent for the object, once', () => {
    onboarding.hold('clip', { text: 'First prompt', reason: 'claude is not installed' })
    expect(onboarding.held('clip')).toEqual({ text: 'First prompt', reason: 'claude is not installed' })
    expect(onboarding.take('clip')).toBe('First prompt')
    // The reason stays to be read; the text is held no longer.
    expect(onboarding.take('clip')).toBe('')
    expect(onboarding.held('clip')).toEqual({ text: '', reason: 'claude is not installed', taken: true })
    onboarding.dismiss('clip')
    expect(onboarding.held('clip')).toBeUndefined()
  })

  it('knows when the draft was thrown away since a photo began to be read', () => {
    const began = onboarding.epoch()
    expect(onboarding.epoch()).toBe(began)
    onboarding.discard()
    expect(onboarding.epoch()).not.toBe(began)
  })

  it('counts a size, the rules, a link or a PDF alone as something in the draft', () => {
    expect(onboarding.addSize({ what: 'tray', value: '186 x 128' })).toBeNull()
    expect(draftHas(onboard.getState().draft)).toBe(true)
    onboarding.discard()
    expect(draftHas(onboard.getState().draft)).toBe(false)
    expect(onboarding.setRules('  ')).toBeNull()
    expect(draftHas(onboard.getState().draft)).toBe(false)
    expect(onboarding.setRules('hand-solderable')).toBeNull()
    expect(draftHas(onboard.getState().draft)).toBe(true)
    onboarding.discard()
    expect(onboarding.addLink('https://example.com/datasheet')).toBeNull()
    expect(draftHas(onboard.getState().draft)).toBe(true)
    onboarding.discard()
    expect(onboarding.addPdf({ path: '/p/a.pdf', file: 'a.pdf' })).toBeNull()
    expect(draftHas(onboard.getState().draft)).toBe(true)
  })

  it('refuses a 41st size, a 21st link, a 7th PDF and rules over 4000 characters, with the reason', () => {
    for (let n = 0; n < MAX_SIZES; n += 1) expect(onboarding.addSize({ what: `s${n}`, value: '1' })).toBeNull()
    expect(onboarding.addSize({ what: 'one more', value: '1' })).toBe(`At most ${MAX_SIZES} sizes.`)
    expect(onboard.getState().draft.sizes).toHaveLength(MAX_SIZES)

    for (let n = 0; n < MAX_LINKS; n += 1) expect(onboarding.addLink(`https://example.com/${n}`)).toBeNull()
    expect(onboarding.addLink('https://example.com/more')).toBe(`At most ${MAX_LINKS} links.`)
    expect(onboard.getState().draft.links).toHaveLength(MAX_LINKS)

    for (let n = 0; n < MOST_REFERENCES.pdfs; n += 1) expect(onboarding.addPdf({ path: `/p/${n}.pdf`, file: `${n}.pdf` })).toBeNull()
    expect(onboarding.addPdf({ path: '/p/more.pdf', file: 'more.pdf' })).toBe(`At most ${MOST_REFERENCES.pdfs} PDFs.`)
    expect(onboard.getState().draft.pdfs).toHaveLength(MOST_REFERENCES.pdfs)

    expect(onboarding.setRules('x'.repeat(MAX_TEXT_CHARS))).toBeNull()
    expect(onboarding.setRules('x'.repeat(MAX_TEXT_CHARS + 1))).toBe(`The rules are at most ${MAX_TEXT_CHARS} characters.`)
    expect(onboard.getState().draft.rules).toHaveLength(MAX_TEXT_CHARS)
  })

  it('takes a link once, only as http or https, and a PDF once by its path', () => {
    expect(onboarding.addLink('ftp://example.com/a')).toMatch(/http or https/)
    expect(onboarding.addLink('javascript:alert(1)')).toMatch(/http or https/)
    expect(onboarding.addLink(`https://example.com/${'a'.repeat(2000)}`)).toMatch(/at most 2000/)
    expect(onboarding.addLink('https://example.com/a', 'x'.repeat(301))).toMatch(/at most 300/)
    expect(onboarding.addLink('https://example.com/a', 'the datasheet')).toBeNull()
    expect(onboarding.addLink('https://example.com/a')).toMatch(/there already/)
    expect(onboard.getState().draft.links).toMatchObject([{ url: 'https://example.com/a', note: 'the datasheet' }])
    expect(onboarding.addPdf({ path: '/p/a.pdf', file: 'a.pdf' })).toBeNull()
    expect(onboarding.addPdf({ path: '/p/a.pdf', file: 'a.pdf' })).toMatch(/there already/)
  })

  it('keeps a size as typed, changes it in place and notes it, and the problem of one that is not whole is said', () => {
    expect(onboarding.addSize()).toBeNull()
    const [row] = onboard.getState().draft.sizes
    // A size on a board not drawn yet is what is wanted of it: a guess until the person says otherwise.
    expect(row).toMatchObject({ what: '', value: '', unit: 'mm', source: 'a guess', note: '' })
    expect(sizeProblem(row)).toMatch(/what it measures/)
    // A row nothing is typed in is left alone: it is not a problem of the draft.
    expect(sizeBlank(row)).toBe(true)
    expect(sizesWrong([row])).toBe(false)
    expect(sizesWrong([{ ...row, value: '3' }])).toBe(true)
    onboarding.setSize(row.uid, { what: 'battery tray', value: 'Ø 62,5', unit: '°', source: 'a guess', note: 'by eye' })
    const [again] = onboard.getState().draft.sizes
    expect(again).toMatchObject({ uid: row.uid, what: 'battery tray', value: 'Ø 62,5', unit: '°', source: 'a guess', note: 'by eye' })
    expect(sizeProblem(again)).toBeNull()
    onboarding.remove('sizes', row.uid)
    expect(onboard.getState().draft.sizes).toEqual([])
  })

  it('removes a link and a PDF, and sets a note on them', () => {
    onboarding.addLink('https://example.com/a')
    onboarding.addPdf({ path: '/p/a.pdf', file: 'a.pdf' })
    const { links, pdfs } = onboard.getState().draft
    onboarding.setNote('links', links[0].uid, 'forum')
    onboarding.setNote('pdfs', pdfs[0].uid, 'the manual')
    expect(onboard.getState().draft.links[0].note).toBe('forum')
    expect(onboard.getState().draft.pdfs[0].note).toBe('the manual')
    onboarding.remove('links', links[0].uid)
    onboarding.remove('pdfs', pdfs[0].uid)
    expect(onboard.getState().draft.links).toEqual([])
    expect(onboard.getState().draft.pdfs).toEqual([])
  })
})
