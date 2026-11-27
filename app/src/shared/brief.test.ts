import { describe, expect, it } from 'vitest'
import { type Card, linksIn, type PartReading } from './cards'
import { boardDisagreements, briefSections, referenceNotes,sizeAgainst, briefSpine, briefWords, freshCards, handOf, promptsSaid, seenHash, seenOf, whenSaid, linkLabel, sizeSource, sizeValue, spineSaid, topicOf } from './brief'
import type { PromptRow } from './chat'

const card = (id: string, extra: Partial<Card>): Card => ({ id, kind: 'note', by: 'person', ...extra })

describe('briefSections', () => {
  it("sorts the cards into the page: the person's by frame, every size and rule, and what was asked of the fab", () => {
    const sections = briefSections({
      next: 20,
      cards: [
        card('C1', { kind: 'frame', name: 'Power' }),
        card('C2', { kind: 'power', frame: 'C1', text: 'USB-C, 5 V' }),
        card('C3', { kind: 'frame', name: 'Rules' }),
        card('C4', { kind: 'rule', frame: 'C3', text: '0603 or larger' }),
        card('C5', { kind: 'size', size: { what: 'Board width', value: '50', unit: 'mm', source: 'a guess' } }),
        card('C6', { kind: 'fab', fab: { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 } }),
        card('C7', { kind: 'note', text: 'loose' }),
        card('C8', { kind: 'decision', by: 'agent', text: "Claude's" }),
        card('C9', { kind: 'rule', by: 'agent', text: "Claude's rule" }),
        card('C10', { kind: 'note', text: 'adopted', from: { by: 'agent' } })
      ]
    })
    // A frame with nothing of its own left to show here has no heading.
    expect(sections.yours.map((g) => [g.frame?.name ?? null, g.cards.map((c) => c.id)])).toEqual([
      ['Power', ['C2']],
      [null, ['C7']]
    ])
    expect([sections.sizes.map((c) => c.id), sections.rules.map((c) => c.id), sections.fab?.id]).toEqual([['C5'], ['C4', 'C9'], 'C6'])
  })
})

describe('the board beside what was asked', () => {
  it("reads the notes of the reference files from brief.md's References", () => {
    expect([...referenceNotes('# a\n\nwords\n\n## References\n\n- reference/photo-1.jpg: the old board\n- reference/doodle-1.png\n')]).toEqual([['reference/photo-1.jpg', 'the old board'], ['reference/doodle-1.png', '']])
    expect([...referenceNotes('# a\n\n- reference/photo-1.jpg: in the words, not the list\n')]).toEqual([])
  })

  it("sets the board's width beside a size of that name, and marks a difference", () => {
    const size = (what: string, value: string): Card => card('C1', { kind: 'size', size: { what, value, unit: 'mm', source: 'measured' } })
    expect(sizeAgainst(size('Board width', '50'), { w: 56, h: 44 })).toEqual({ built: 56, differs: true })
    expect(sizeAgainst(size('board height', '44'), { w: 56, h: 44 })).toEqual({ built: 44, differs: false })
    expect(sizeAgainst(size('USB-C offset', '3'), { w: 56, h: 44 })).toBeNull()
    expect(sizeAgainst(size('Board width', '56.04'), { w: 56.0000001, h: 44 })).toEqual({ built: 56, differs: false })
    expect(sizeAgainst(size('Board width', '56.1'), { w: 56, h: 44 })?.differs).toBe(true)
    // A value that is no one number is not compared, nor is anything with no board.
    expect(sizeAgainst(size('Board width', 'about 50'), { w: 56, h: 44 })).toBeNull()
    expect(sizeAgainst(size('Board width', '50'), null)).toBeNull()
  })
})

describe('where the build and the Brief disagree, in the left column', () => {
  const size = (id: string, what: string, value: string): Card => card(id, { kind: 'size', size: { what, value, unit: 'mm', source: 'measured' } })

  it('says nothing when they agree', () => {
    expect(boardDisagreements([size('C1', 'Board width', '40'), size('C2', 'Board height', '30.04')], { w: 40, h: 30 })).toEqual([])
  })

  it('says a board too wide, with what the Brief says', () => {
    expect(boardDisagreements([size('C1', 'Board width', '35 mm')], { w: 40, h: 30 })).toEqual([{ card: 'C1', words: 'Board is 40.0 mm wide, the Brief says 35 mm' }])
  })

  it('says each side that differs, in the order of the cards, with the decimals the board has', () => {
    expect(boardDisagreements([size('C10', 'board height', '31,5'), size('C2', 'Board width', '41')], { w: 40.25, h: 30 })).toEqual([
      { card: 'C2', words: 'Board is 40.25 mm wide, the Brief says 41 mm' },
      { card: 'C10', words: 'Board is 30.0 mm high, the Brief says 31.5 mm' }
    ])
  })

  it('says nothing with no size cards, no board, or a size nothing measures', () => {
    expect(boardDisagreements([], { w: 40, h: 30 })).toEqual([])
    expect(boardDisagreements([card('C1', { kind: 'rule', text: 'Board width 35 mm' })], { w: 40, h: 30 })).toEqual([])
    expect(boardDisagreements([size('C1', 'Board width', '35')], null)).toEqual([])
    expect(boardDisagreements([size('C1', 'USB-C offset', '3'), size('C2', 'Board width', 'about 35')], { w: 40, h: 30 })).toEqual([])
  })
})

describe('what the ledger says of a size', () => {
  const size = (value: string, over = {}) => ({ what: 'w', value, unit: 'mm' as const, source: 'measured' as const, ...over })
  it('shows the numbers read from the value, and the value as typed when it holds none', () => {
    expect(sizeValue(size('Ø6,6'))).toBe('Ø 6.6')
    expect(sizeValue(size('186 x 128 mm'))).toBe('186 × 128')
    expect(sizeValue(size('about 60 mm'))).toBe('about 60')
    expect(sizeValue(size('mm'))).toBe('mm')
  })
  it('says where it came from, with the note after', () => {
    expect(sizeSource(size('1', { source: 'from a manual or datasheet', note: 'photo-1.jpg' }))).toBe('from a datasheet · photo-1.jpg')
    expect(sizeSource(size('1', { source: 'a guess' }))).toBe('a guess')
  })
})

describe('the spine of what Claude wrote down (#338)', () => {
  const row = (id: string, number: number, at: number): PromptRow => ({ conversation: 'c1', id, number, text: `prompt ${number}`, at })
  const prompts = new Map([row('u2', 2, 2000), row('u6', 6, 6000), row('u11', 11, 11000), row('u13', 13, 13000)].map((r) => [r.id, r]))
  const t = (prompt: string) => ({ prompt, conversation: 'c1' })

  it('hangs each card of Claude’s on the prompt that wrote or last changed it, oldest first, and leaves the person’s and the frames out', () => {
    const nodes = briefSpine(
      [
        card('C10', { by: 'agent', text: 'Screen: Waveshare', turn: t('u2') }),
        card('C20', { by: 'agent', text: 'Controls: 9 buttons', turn: t('u13') }),
        card('C14', { by: 'agent', kind: 'size', turn: t('u2'), size: { what: 'screen', value: '40.9 x 19.7', unit: 'mm', source: 'from Claude' } }),
        card('C5', { text: 'mine' }),
        card('C7', { by: 'agent', kind: 'frame', name: 'Rules', turn: t('u2') })
      ],
      prompts
    )
    expect(nodes.map((n) => [n.id, n.prompt?.number, n.cards.map((c) => c.id)])).toEqual([
      ['u2', 2, ['C10', 'C14']],
      ['u13', 13, ['C20']]
    ])
  })

  it('puts what a card said before in the node of the prompt that wrote it, struck, with the prompt that changed it', () => {
    const mount = card('C13', { by: 'agent', text: 'Mount: an arm', turn: t('u11'), was: [{ text: 'Mount: a blade', turn: t('u2') }, { text: 'Mount: a tube', turn: t('u6') }] })
    const nodes = briefSpine([mount], prompts)
    expect(nodes.map((n) => [n.id, n.cards.map((c) => c.id), n.ghosts])).toEqual([
      ['u2', [], [{ card: 'C13', text: 'Mount: a blade', changedIn: 6 }]],
      ['u6', [], [{ card: 'C13', text: 'Mount: a tube', changedIn: 11 }]],
      ['u11', ['C13'], []]
    ])
  })

  it('keeps a card the person made theirs where Claude wrote it, and puts cards with no prompt first and a prompt not on this computer by its time', () => {
    const nodes = briefSpine(
      [
        card('C1', { by: 'person', text: 'Controls: mine', from: { by: 'agent', turn: t('u13') } }),
        card('C2', { by: 'agent', text: 'old', at: '2026-11-20T10:00:00.000Z' }),
        card('C3', { by: 'agent', text: 'elsewhere', turn: t('u99'), at: new Date(5000).toISOString() })
      ],
      prompts
    )
    expect(nodes.map((n) => [n.id, n.at, n.cards.map((c) => c.id)])).toEqual([
      ['', Date.parse('2026-11-20T10:00:00.000Z'), ['C2']],
      ['u99', 5000, ['C3']],
      ['u13', 13000, ['C1']]
    ])
  })

  it('says whose a card is, with its prompt when it is known', () => {
    expect(handOf(card('C1', { by: 'agent', turn: t('u13') }), prompts).label).toBe('Claude, prompt 13')
    expect(handOf(card('C1', { by: 'agent', turn: t('u99') }), prompts)).toEqual({ hand: 'claude', label: 'Claude' })
    expect(handOf(card('C1', { from: { by: 'agent', turn: t('u2') } }), prompts)).toEqual({ hand: 'you', label: 'Yours, from prompt 2' })
    expect(handOf(card('C1', {}), prompts)).toEqual({ hand: 'you', label: 'You' })
  })

  it("puts Claude's PCB cards on the spine and leaves the person's off it", () => {
    const nodes = briefSpine(
      [
        card('C1', { kind: 'requirement', by: 'agent', text: 'USB-C powered', turn: t('u2') }),
        card('C2', { kind: 'part', by: 'agent', text: 'LDO', part: { lcsc: 'C51118' }, turn: t('u6') }),
        card('C3', { kind: 'power', text: 'USB-C, 5 V' })
      ],
      prompts
    )
    expect(nodes.map((n) => [n.id, n.cards.map((c) => c.id)])).toEqual([
      ['u2', ['C1']],
      ['u6', ['C2']]
    ])
    // Every kind Claude may add has its place there.
    for (const kind of ['requirement', 'decision', 'question', 'part', 'power', 'connection', 'size', 'rule', 'link', 'note'] as const) expect(briefSpine([card('C9', { kind, by: 'agent' })], prompts)).toHaveLength(1)
  })

  it('counts what Claude wrote down, and reads a card’s topic', () => {
    const cards = [card('C1', { kind: 'decision' }), card('C2', { kind: 'decision' }), card('C3', { kind: 'question' }), card('C4', { kind: 'size' }), card('C5', { kind: 'power' }), card('C6', { kind: 'part' })]
    expect(spineSaid(cards)).toBe('2 decisions, an open question, a part, a power budget, a size')
    expect(spineSaid([])).toBe('nothing yet')
    expect(topicOf('Mount: an adjustable arm')).toEqual({ topic: 'Mount', rest: 'an adjustable arm' })
    expect(topicOf('Every encoder size is assumed. Measure one: then')).toBeNull()
    expect(topicOf('see https://example.com')).toBeNull()
  })
})

describe('links of brief.md', () => {
  it('reads every address in order, as firstLink reads one', () => {
    expect(linksIn('A [cockpit](https://cdn.shopify.com/files/GT1-EVO_cockpit.pdf?v=3). See http://a.b/c, then https://x.y/(z).')).toEqual(['https://cdn.shopify.com/files/GT1-EVO_cockpit.pdf?v=3', 'http://a.b/c', 'https://x.y/(z)'])
    expect(linksIn('none')).toEqual([])
  })

  it('labels an address by its file and host, never as the address itself', () => {
    expect(linkLabel('https://cdn.shopify.com/s/files/1/GT1-EVO_cockpit.pdf?v=1')).toEqual({ label: 'GT1 EVO cockpit, PDF', host: 'cdn.shopify.com' })
    expect(linkLabel('https://www.example.com/')).toEqual({ label: 'example.com', host: 'example.com' })
  })
})

describe('the person’s words of brief.md', () => {
  it('leaves out the name pino wrote on top and the References it listed, and keeps the rest as written', () => {
    const text = '# simracing-panel\n\nWe want a box.\n\n- 5 toggles\n- 18 buttons\n\n## References\n\n- reference/photo-1.jpg: the switch\n\n## Where\n\nOn the arm.\n'
    expect(briefWords(text)).toBe('We want a box.\n\n- 5 toggles\n- 18 buttons\n\n## Where\n\nOn the arm.')
    expect(briefWords('Just words, no title.')).toBe('Just words, no title.')
    expect(briefWords('```\n## not a heading\n```')).toBe('```\n## not a heading\n```')
  })

  it('says when, as the spine does', () => {
    expect(whenSaid(new Date(2026, 10, 25, 9, 5).getTime())).toBe('25 Nov 09:05')
  })
})

describe('new since you looked (#340)', () => {
  const prompts = new Map([['u13', { conversation: 'c', id: 'u13', number: 13, text: '', at: 13 }], ['u14', { conversation: 'c', id: 'u14', number: 14, text: '', at: 14 }]])
  const a = card('C1', { by: 'agent', text: 'Controls: 9 buttons', turn: { prompt: 'u13' } })
  const b = card('C2', { by: 'agent', kind: 'size', turn: { prompt: 'u14' }, size: { what: 'plate', value: '15 x 8', unit: 'mm', source: 'from Claude' } })

  it('keeps a hash of each card of Claude’s, and says which are new: added, or saying something else, not moved', () => {
    const seen = seenOf([a, card('C5', { text: 'mine' })], '2026-11-25T17:50:00.000Z')
    expect(Object.keys(seen.cards)).toEqual(['C1'])
    const nodes = briefSpine([{ ...a, frame: 'C9' }, b], prompts)
    expect([...freshCards(nodes, seen)]).toEqual(['C2'])
    expect([...freshCards(briefSpine([{ ...a, text: 'Controls: 3 toggles' }], prompts), seen)]).toEqual(['C1'])
    expect(freshCards(nodes, null).size).toBe(0)
  })

  it("a part's new reading is not new since you looked, and another number is", () => {
    const reading = (stock: number): PartReading => ({ class: 'basic', package: '0603', stock, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true })
    const partCard = (lcsc: string, read?: PartReading): Card => card('C1', { kind: 'part', by: 'agent', text: 'Pull-up', part: { lcsc, ...(read ? { reading: read } : {}) }, turn: { prompt: 'u13' } })
    const seen = seenOf([partCard('C25804', reading(10))], '2026-11-26T10:00:00Z')
    expect(freshCards(briefSpine([partCard('C25804', reading(20))], prompts), seen)).toEqual(new Set())
    expect(seenHash(partCard('C25804'))).toBe(seenHash(partCard('C25804', reading(20))))
    expect(freshCards(briefSpine([partCard('C51118', reading(10))], prompts), seen)).toEqual(new Set(['C1']))
  })

  it('names the prompts in a line', () => {
    expect(promptsSaid([13])).toBe('prompt 13')
    expect(promptsSaid([13, 14])).toBe('prompts 13 and 14')
    expect(promptsSaid([4, 9, 13])).toBe('prompts 4, 9 and 13')
    expect(promptsSaid([])).toBe('')
  })
})
