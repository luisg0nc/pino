import { describe, expect, it } from 'vitest'
import { refPieces } from './refPieces'

describe('refPieces', () => {
  it('sets the refs apart from the words', () => {
    expect(refPieces('see M3 and C7, not Mx')).toEqual([{ text: 'see ' }, { text: 'M3', ref: true }, { text: ' and ' }, { text: 'C7', ref: true }, { text: ', not Mx' }])
    expect(refPieces('plain')).toEqual([{ text: 'plain' }])
    expect(refPieces('the ESP32-C6-Touch board, C6-2')).toEqual([{ text: 'the ESP32-C6-Touch board, C6-2' }])
    // pino's refs are marks, cards and builds: S1 is no ref here.
    expect(refPieces('h3, not S1 or T2')).toEqual([{ text: 'h3', ref: true }, { text: ', not S1 or T2' }])
  })
})
