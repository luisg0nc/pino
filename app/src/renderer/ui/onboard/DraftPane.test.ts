import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Draft } from '../../state/onboard'
import { BLANK_DESCRIPTION, DraftPane, pictureState, promptPieces, wordsOf } from './DraftPane'

const make = { folder: 'boards/blinky/', files: 0 }
const preview = { text: 'This is a new board, blinky.\n\nA small blinker\n\nmore', attached: [1, null] }

describe('the right side of the New project page', () => {
  it("shows the prompt, with the person's words apart from pino's", () => {
    const thumbs = [
      { file: 'reference/photo-1.jpg', url: 'blob:a', attached: 1, hasPicture: true },
      { file: 'reference/photo-7.jpg', url: 'blob:b', attached: null, hasPicture: true }
    ]
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: ['A small blinker'], thumbs, make }))
    expect(out).toContain('What Claude gets first')
    expect(out).toContain('Written from this page as you add to it.')
    expect(out).toContain('<span class="draft-pane-mine">A small blinker</span>')
    expect(out).toContain('attached: picture 1')
    expect(out).toContain('named only: over 6')
  })

  it('is the dyed plate, and says what will be made from the page', () => {
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make }))
    expect(out).toContain('data-plate')
    expect(out).toContain('Makes <span class="num">boards/blinky/</span> with <span class="num">brief.md</span>')
    expect(out).not.toContain('reference/')
    const more = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make: { ...make, files: 3 } }))
    expect(more).toContain('<span class="num">reference/</span> (<span class="num">3</span> files)')
    const none = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make: 'Give it a name and say what it does.' }))
    expect(none).toContain('Give it a name and say what it does.')
    expect(none).not.toContain('Makes')
  })

  it('stands with what will be made alone while there is no prompt to show', () => {
    const out = renderToStaticMarkup(createElement(DraftPane, { preview: undefined, words: [], thumbs: [], make }))
    expect(out).toContain('boards/blinky/')
    expect(out).not.toContain('draft-pane-text')
    expect(out).not.toContain('What Claude gets first')
  })

  it('shows a muted line where the description will go while it is empty, and none once there is one (#324)', () => {
    const empty = { ...preview, text: "This is a new board, blinky, made in pino just now. What it does, in the person's words:\n\n\n\nThere is no board.py yet." }
    const out = renderToStaticMarkup(createElement(DraftPane, { preview: empty, words: [], thumbs: [], make, blank: true }))
    const line = `<span class="draft-pane-blank">${BLANK_DESCRIPTION}</span>`
    expect(out).toContain(line)
    // Between the opening line and what follows, where the words will be.
    expect(out.indexOf("person&#x27;s words:")).toBeLessThan(out.indexOf(line))
    expect(out.indexOf(line)).toBeLessThan(out.indexOf('There is no board.py'))
    expect(renderToStaticMarkup(createElement(DraftPane, { preview, words: ['A small blinker'], thumbs: [], make }))).not.toContain('draft-pane-blank')
  })

  it('puts the foot, the choice and the buttons, at the bottom of the plate', () => {
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make, children: createElement('button', null, 'Start') }))
    expect(out.indexOf('new-will')).toBeLessThan(out.indexOf('<button>Start</button>'))
  })

  it('draws the references of the prompt as outlined chips, and the sizes in the face of numbers', () => {
    const text = 'Hello\n\n- reference/photo-1.png: the edge (attached: picture 1)\n\nSize and shape:\n- Board width 50 mm (a guess)\n- Fits an enclosure: a tin\n\nRules:\nhand-solderable'
    const out = renderToStaticMarkup(createElement(DraftPane, { preview: { ...preview, text }, words: ['a tin'], thumbs: [], make }))
    expect(out).toContain('<span class="draft-pane-chip">reference/photo-1.png</span>')
    expect(out).toContain('<span class="draft-pane-chip">attached: picture 1</span>')
    expect(out).toContain('<span class="draft-pane-size num">')
    expect(out).toContain('<span class="draft-pane-mine">a tin</span>')
    // Only the sizes' lines are in mono, not the rules after them.
    expect(out).not.toContain('<span class="draft-pane-size num">Rules')
  })

  it('splits a text at the words, longest first, and at none when there are none', () => {
    expect(promptPieces('a big clip here', ['clip', 'big clip'])).toEqual([
      { text: 'a ', mine: false },
      { text: 'big clip', mine: true },
      { text: ' here', mine: false }
    ])
    expect(promptPieces('abc', [' '])).toEqual([{ text: 'abc', mine: false }])
  })

  it('says why a picture is only named', () => {
    expect(pictureState(2, true)).toBe('attached: picture 2')
    expect(pictureState(null, false)).toBe('named only')
  })
})

describe('the words that are the person\'s own', () => {
  it('are the description, the rules, the notes of every kind, a size\'s name, a link\'s address and what each PCB row says', () => {
    const d = {
      name: 'x',
      description: 'A blinker',
      photos: [{ note: 'p' }],
      doodles: [{ note: 'd' }],
      sizes: [{ what: 'tray', note: 'by eye' }],
      enclosure: 'a tin',
      edges: 'left',
      rules: '0805',
      links: [{ url: 'https://example.com', note: 'forum' }],
      pdfs: [{ note: 'manual' }],
      power: [{ kind: 'LiPo', note: 'lid' }],
      connections: [{ what: 'sensor', connector: 'JST' }],
      parts: [{ what: 'C25804', note: 'pull-up' }]
    } as unknown as Draft
    expect(wordsOf(d)).toEqual(['A blinker', '0805', 'p', 'd', 'tray', 'by eye', 'a tin', 'left', 'https://example.com', 'forum', 'manual', 'LiPo', 'lid', 'sensor', 'JST', 'C25804', 'pull-up'])
  })
})
