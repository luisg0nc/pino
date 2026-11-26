import { describe, expect, it } from 'vitest'
import { lookLayers, lookSaid, lookSize, lookWindow, pixelRatio } from './look'

describe('the size of a picture', () => {
  it("takes the subject's shape, with the asked size on the long edge", () => {
    expect(lookSize({ w: 40, h: 30 }, 1280)).toEqual({ width: 1280, height: 960 })
    expect(lookSize({ w: 30, h: 40 }, 800)).toEqual({ width: 600, height: 800 })
  })

  it('is never thinner than one to two', () => {
    expect(lookSize({ w: 100, h: 5 }, 1000)).toEqual({ width: 1000, height: 500 })
    expect(lookSize({ w: 5, h: 100 }, 1000)).toEqual({ width: 500, height: 1000 })
  })
})

describe("a picture's pixels", () => {
  it('draws lines and chips thicker in a large picture, and never thinner than on screen', () => {
    expect(pixelRatio(1920)).toBe(2)
    expect(pixelRatio(960)).toBe(1)
    expect(pixelRatio(400)).toBe(1)
  })
})

describe('the layers of a picture', () => {
  const copper = ['F.Cu', 'In1.Cu', 'B.Cu']
  it('are all of them with the one in front on top, unless Claude chooses', () => {
    expect(lookLayers(undefined, copper, 'B.Cu')).toEqual({ layers: copper, active: 'B.Cu' })
    expect(lookLayers(['B.Cu', 'F.Cu'], copper, 'F.Cu')).toEqual({ layers: ['B.Cu', 'F.Cu'], active: 'B.Cu' })
  })

  it('refuses a layer the board does not have', () => {
    expect(lookLayers(['In4.Cu'], copper, 'F.Cu')).toEqual({ error: 'This board has no copper layer In4.Cu. It has F.Cu, In1.Cu, B.Cu.' })
    expect(lookLayers([], copper, 'F.Cu')).toEqual({ layers: copper, active: 'F.Cu' })
  })
})

describe('the window of a picture', () => {
  it('turns board millimetres, y up, into a box of the board file, y down', () => {
    expect(lookWindow({ x0: -10, y0: -5, x1: 10, y1: 5 }, 'board')).toEqual({ x0: 90, y0: 95, x1: 110, y1: 105 })
  })

  it('keeps sheet millimetres as they are, whichever corner came first', () => {
    expect(lookWindow({ x0: 60, y0: 40, x1: 20, y1: 10 }, 'schematic')).toEqual({ x0: 20, y0: 10, x1: 60, y1: 40 })
  })

  it('refuses a window with no area', () => {
    expect(lookWindow({ x0: 1, y0: 1, x1: 1, y1: 5 }, 'board')).toEqual({ error: 'The window has no area: give two corners that differ in x and in y.' })
  })
})

describe('what a picture says of itself', () => {
  it('names the tab, the build, the layers, the window and the marks', () => {
    expect(lookSaid({ tab: 'board', build: 7, layers: ['F.Cu', 'B.Cu'], active: 'F.Cu', window: { x0: -10, y0: -5, x1: 10, y1: 5 }, marks: 3 })).toBe(
      'Board tab, h7, top copper over bottom, window x -10 to 10, y -5 to 5 mm, 3 marks drawn'
    )
  })

  it('says the whole board, one layer, and one mark', () => {
    expect(lookSaid({ tab: 'board', build: 2, layers: ['B.Cu'], active: 'B.Cu', marks: 1 })).toBe('Board tab, h2, bottom copper only, the whole board, 1 mark drawn')
  })

  it('speaks of the sheet and of the 3D view', () => {
    expect(lookSaid({ tab: 'schematic', build: 4, marks: 0 })).toBe('Schematic tab, h4, the whole sheet, no marks drawn')
    expect(lookSaid({ tab: '3d', build: 4, marks: null })).toBe('3D tab, h4, from the angle the person left it at or a corner; marks are not drawn in 3D')
  })
})
