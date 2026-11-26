import { describe, expect, it } from 'vitest'
import { MAX_PDF_BYTES, MAX_PHOTO_BYTES, PDF_FORMATS, projectNameProblem, referenceFiles } from './projectName'

describe('projectNameProblem', () => {
  it('accepts letters, digits, dash and underscore', () => {
    for (const name of ['blinky', 'usb-c-breakout', 'Sensor_Node_v2', '3d-probe', 'a', 'x'.repeat(64)]) {
      expect(projectNameProblem(name, [])).toBeNull()
    }
  })

  it('refuses a dot anywhere in a name', () => {
    for (const name of ['sensor.v2', 'a.b', 'clip.']) expect(projectNameProblem(name, []), name).toMatch(/letters, digits, `-` and `_`/)
  })

  it('refuses an empty name, one that is too long, and one that starts with a dot, dash or underscore', () => {
    expect(projectNameProblem('', [])).toMatch(/name/i)
    expect(projectNameProblem('x'.repeat(65), [])).toMatch(/64/)
    for (const name of ['.hidden', '-x', '_x', '..']) expect(projectNameProblem(name, [])).not.toBeNull()
  })

  it('refuses a slash, a backslash, a space, `..` inside a path, unicode lookalikes and control characters', () => {
    for (const name of ['a/b', 'a\\b', '../x', 'a b', 'a/../b', 'café', 'аpple', 'a\u0000b', 'a\nb', ' a', 'a ']) {
      expect(projectNameProblem(name, []), JSON.stringify(name)).not.toBeNull()
    }
  })

  it('refuses a folder that is there, in any case', () => {
    expect(projectNameProblem('clip', ['clip'])).toBe('A folder `clip` is there already.')
    expect(projectNameProblem('blinky', ['Blinky'])).toBe('A folder `Blinky` is there already.')
    expect(projectNameProblem('other', ['clip'])).toBeNull()
    expect(projectNameProblem('usb-c', ['usb_c'])).toBeNull()
  })
})

it('has one cap for a photo, which main and the window both hold a file to', () => {
  expect(MAX_PHOTO_BYTES).toBe(25 * 1024 * 1024)
})

describe('referenceFiles', () => {
  it('keeps each file its own name, safe, lower-case ending, and numbers a name taken in any case', () => {
    expect(referenceFiles(['/a/Data Sheet.PDF', '/b/data sheet.pdf', '/c/DATA_SHEET.pdf', '/d/noending'], PDF_FORMATS)).toEqual([
      'reference/Data_Sheet.pdf',
      'reference/data_sheet-2.pdf',
      'reference/DATA_SHEET-3.pdf',
      'reference/noending.pdf'
    ])
  })

  it('holds a PDF to 25 MB', () => {
    expect(MAX_PDF_BYTES).toBe(25 * 1024 * 1024)
  })
})
