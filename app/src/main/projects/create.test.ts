import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CreateRequest } from '../../shared/bridge'
import type { CardsFile, PartReading } from '../../shared/cards'
import { DEFAULT_FAB, type PowerRow } from '../../shared/slots'
import { readCardsFile } from '../cards/file'
import { createProject, readPhoto, sweepStaleNew } from './create'
import { makeReadings, type Readings } from './readings'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 9, 9])
const READING: PartReading = { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }
const usbC: PowerRow = { source: 'USB-C', kind: '', volts: '5', amps: '0.5', note: '' }

/** What a made folder holds of the cards, beside what it was given. */
const CARDS = ['.pino/', '.pino/brief/', '.pino/brief/cards.json']

let base: string
let ws: string
let files: string

/** Every file and folder under `dir`, relative, sorted. */
function tree(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    out.push(prefix + entry.name + (entry.isDirectory() ? '/' : ''))
    if (entry.isDirectory()) out.push(...tree(join(dir, entry.name), prefix + entry.name + '/'))
  }
  return out.sort()
}

function request(over: Partial<CreateRequest> = {}): CreateRequest {
  return { name: 'cable-clip', description: 'A clip for a 6 mm cable.', photos: [], doodles: [], pdfs: [], power: [], connections: [], sizes: [], enclosure: '', edges: '', parts: [], fab: null, rules: '', links: [], ...over }
}

let readings: Readings
const make = (req: CreateRequest, hooks?: Parameters<typeof createProject>[1]['hooks']) => createProject(req, { root: ws, readings, hooks })
const cardsOf = (name = 'cable-clip'): CardsFile => JSON.parse(readFileSync(join(ws, name, '.pino', 'brief', 'cards.json'), 'utf8'))

beforeEach(() => {
  readings = makeReadings()
  base = mkdtempSync(join(realpathSync(tmpdir()), 'pino-create-'))
  ws = join(base, 'ws')
  files = join(base, 'files')
  mkdirSync(ws)
  mkdirSync(files)
  mkdirSync(join(ws, 'lid'))
  writeFileSync(join(ws, 'lid', 'lid.py'), '# lid\n')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('creating a project', () => {
  it('makes brief.md, reference/ and the cards, and nothing else', async () => {
    expect(await make(request({ name: 'blinky', description: 'Blinks an LED.', power: [usbC], parts: [{ what: 'C25804', note: 'pull-up' }], fab: DEFAULT_FAB }))).toEqual({ name: 'blinky' })
    expect(tree(join(ws, 'blinky'))).toEqual([...CARDS, 'brief.md'])
    expect(readFileSync(join(ws, 'blinky', 'brief.md'), 'utf8')).toBe('# blinky\n\nBlinks an LED.\n')
    expect(readdirSync(ws).sort()).toEqual(['blinky', 'lid'])
    expect(readCardsFile(cardsOf('blinky'))?.dropped).toBe(0)
    expect(cardsOf('blinky').cards.filter((c) => c.kind === 'frame').map((c) => c.name)).toEqual(['Power', 'Parts I have', 'Fab and assembly'])
  })

  it('a part has the reading main gave this run, never one from the request', async () => {
    readings.put('C25804', READING)
    const forged = { ...READING, stock: 9 }
    await make(request({ parts: [{ what: 'c25804', note: '', reading: forged } as never, { what: 'C51118', note: '', reading: forged } as never] }))
    expect(cardsOf().cards.filter((c) => c.kind === 'part').map((c) => c.part)).toEqual([{ lcsc: 'C25804', reading: READING }, { lcsc: 'C51118' }])
  })

  it('copies photos and doodles in the order given and lists every item in the brief, in order', async () => {
    writeFileSync(join(files, 'a.PNG'), PNG)
    writeFileSync(join(files, 'b.jpeg'), JPG)
    await make(
      request({
        description: '  A clip.\n\nSecond paragraph.  ',
        photos: [
          { path: join(files, 'b.jpeg'), note: 'the desk edge' },
          { path: join(files, 'a.PNG'), note: '' }
        ],
        doodles: [{ png: PNG, note: 'the shape,\nroughly' }]
      })
    )
    const dir = join(ws, 'cable-clip')
    expect(tree(dir)).toEqual([...CARDS, 'brief.md', 'reference/', 'reference/doodle-1.png', 'reference/photo-1.jpeg', 'reference/photo-2.png'])
    expect([...readFileSync(join(dir, 'reference', 'photo-1.jpeg'))]).toEqual([...JPG])
    expect([...readFileSync(join(dir, 'reference', 'photo-2.png'))]).toEqual([...PNG])
    expect([...readFileSync(join(dir, 'reference', 'doodle-1.png'))]).toEqual([...PNG])
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toBe(
      [
        '# cable-clip',
        '',
        'A clip.\n\nSecond paragraph.',
        '',
        '## References',
        '',
        '- reference/photo-1.jpeg: the desk edge',
        '- reference/photo-2.png',
        '- reference/doodle-1.png: the shape, roughly',
        ''
      ].join('\n')
    )
  })

  it('leaves no temp folder, and the workspace lists nothing before the rename', async () => {
    let seen: string[] = []
    await make(request(), {
      beforeRename: (temp) => {
        seen = readdirSync(ws)
        expect(tree(temp)).toEqual([...CARDS, 'brief.md'])
      }
    })
    expect(seen.filter((n) => !n.startsWith('.'))).toEqual(['lid'])
    expect(seen.some((n) => /^\.cable-clip\.pino-new-[0-9a-f]{12}$/.test(n))).toBe(true)
    expect(readdirSync(ws).sort()).toEqual(['cable-clip', 'lid'])
  })

  it('refuses a name that is no good, and writes nothing', async () => {
    for (const name of ['', '../x', 'a/b', '.x', 'LID']) {
      await expect(make(request({ name }))).rejects.toThrow()
    }
    expect(readdirSync(ws)).toEqual(['lid'])
    expect(readFileSync(join(ws, 'lid', 'lid.py'), 'utf8')).toBe('# lid\n')
  })

  it('refuses a name another folder has in any case', async () => {
    mkdirSync(join(ws, 'Blinky'))
    await expect(make(request({ name: 'blinky' }))).rejects.toThrow('A folder `Blinky` is there already.')
    expect(readdirSync(ws).sort()).toEqual(['Blinky', 'lid'])
    expect(readdirSync(join(ws, 'Blinky'))).toEqual([])
  })

  it('a second Start for the same name is refused and leaves the first whole', async () => {
    const [a, b] = await Promise.allSettled([make(request({ name: 'blinky' })), make(request({ name: 'blinky' }))])
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect(readdirSync(ws).sort()).toEqual(['blinky', 'lid'])
    expect(tree(join(ws, 'blinky'))).toEqual([...CARDS, 'brief.md'])
    await expect(make(request({ name: 'blinky' }))).rejects.toThrow('A folder `blinky` is there already.')
  })

  it('refuses a folder with something in it, or a plain file, of the same name', async () => {
    mkdirSync(join(ws, 'full'))
    writeFileSync(join(ws, 'full', 'x.txt'), 'x')
    writeFileSync(join(ws, 'notes'), 'x')
    await expect(make(request({ name: 'full' }))).rejects.toThrow(/there already/)
    await expect(make(request({ name: 'Notes' }))).rejects.toThrow(/there already/)
    expect(readdirSync(ws).sort()).toEqual(['full', 'lid', 'notes'])
  })

  it('never writes into or replaces a folder that is there, an empty one or a link to one included', async () => {
    mkdirSync(join(ws, 'cable-clip'))
    await expect(make(request())).rejects.toThrow('A folder `cable-clip` is there already.')
    expect(readdirSync(join(ws, 'cable-clip'))).toEqual([])
    mkdirSync(join(base, 'elsewhere'))
    symlinkSync(join(base, 'elsewhere'), join(ws, 'linked'))
    await expect(make(request({ name: 'linked' }))).rejects.toThrow(/there already/)
    expect(readdirSync(join(base, 'elsewhere'))).toEqual([])
    expect(readdirSync(ws).sort()).toEqual(['cable-clip', 'lid', 'linked'])
  })

  it('refuses a description that is empty, and items beyond the caps', async () => {
    await expect(make(request({ description: '  \n' }))).rejects.toThrow(/what it does/i)
    const photo = (i: number) => ({ path: join(files, `p${i}.png`), note: '' })
    await expect(make(request({ photos: Array.from({ length: 13 }, (_, i) => photo(i)) }))).rejects.toThrow(/photos/)
    await expect(make(request({ doodles: Array.from({ length: 7 }, () => ({ png: PNG, note: '' })) }))).rejects.toThrow(/doodles/)
    await expect(make(request({ power: Array.from({ length: 5 }, () => usbC) }))).rejects.toThrow('At most 4 power rows.')
    await expect(make(request({ connections: Array.from({ length: 25 }, () => ({ what: 'LED', bus: 'GPIO' as const, connector: '' })) }))).rejects.toThrow('At most 24 connections.')
    await expect(make(request({ parts: Array.from({ length: 25 }, (_, i) => ({ what: `C${i + 1}`, note: '' })) }))).rejects.toThrow('At most 24 parts.')
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  it('refuses a slot that is not what it may be, before anything is made', async () => {
    const bad: Array<[Partial<CreateRequest>, RegExp]> = [
      [{ power: [{ ...usbC, source: 'mains' as never }] }, /Power comes from/],
      [{ connections: [{ what: '', bus: 'I2C', connector: '' }] }, /Say what plugs in/],
      [{ parts: [{ what: '', note: '' }] }, /LCSC number or name a module/],
      [{ fab: { ...DEFAULT_FAB, layers: 3 as never } }, /2 or 4 layers/],
      [{ enclosure: 'x'.repeat(301) }, /enclosure is at most 300/],
      [{ edges: 7 as never }, /edges/]
    ]
    for (const [over, why] of bad) await expect(make(request(over))).rejects.toThrow(why)
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  it('checks every note and refuses a file given twice before it makes anything, the photos last of all', async () => {
    writeFileSync(join(files, 'a.png'), PNG)
    const a = { path: join(files, 'a.png'), note: '' }
    const seen: string[] = []
    const hooks = { beforeRename: (t: string) => void seen.push(t) }
    const long = 'x'.repeat(2001)
    await expect(make(request({ photos: [a, { ...a }] }), hooks)).rejects.toThrow(/twice/)
    await expect(make(request({ photos: [{ ...a, note: long }] }), hooks)).rejects.toThrow(/note/)
    await expect(make(request({ doodles: [{ png: PNG, note: long }] }), hooks)).rejects.toThrow(/note/)
    expect(seen).toEqual([])
    // A note is 2,000 characters after it is folded to one line: this one is longer before, not after.
    await make(request({ photos: [{ ...a, note: `${'x '.repeat(900)}\n\n\n    ${'y'.repeat(100)}` }] }), hooks)
    expect(seen).toHaveLength(1)
  })

  describe('reading a photo for the window (its thumbnail, its scaled copy)', () => {
    it('gives the bytes of a plain image file', async () => {
      writeFileSync(join(files, 'a.PNG'), PNG)
      expect(new Uint8Array(await readPhoto(join(files, 'a.PNG')))).toEqual(PNG)
    })
    it('refuses a link, a folder, a file that is no image by its name, a relative path, one over 25 MB', async () => {
      writeFileSync(join(files, 'real.png'), PNG)
      symlinkSync(join(files, 'real.png'), join(files, 'link.png'))
      mkdirSync(join(files, 'dir.png'))
      writeFileSync(join(files, 'notes.txt'), 'x')
      writeFileSync(join(files, 'big.png'), PNG)
      truncateSync(join(files, 'big.png'), 25 * 1024 * 1024 + 1)
      for (const path of [join(files, 'link.png'), join(files, 'dir.png'), join(files, 'notes.txt'), 'real.png', join(files, 'big.png'), join(files, 'none.png')]) await expect(readPhoto(path)).rejects.toThrow()
    })
  })

  describe('a photo that cannot be taken', () => {
    const attempt = async (path: string) => {
      writeFileSync(join(files, 'good.png'), PNG)
      await expect(make(request({ photos: [{ path: join(files, 'good.png'), note: '' }, { path, note: '' }] }))).rejects.toThrow()
      // The first photo was copied into the temp folder before the second was found wanting: all of it is gone.
      expect(readdirSync(ws)).toEqual(['lid'])
    }

    it('is missing', () => attempt(join(files, 'missing.png')))
    it('is a link', async () => {
      writeFileSync(join(files, 'real.png'), PNG)
      symlinkSync(join(files, 'real.png'), join(files, 'link.png'))
      await attempt(join(files, 'link.png'))
    })
    it('is a folder', async () => {
      mkdirSync(join(files, 'dir.png'))
      await attempt(join(files, 'dir.png'))
    })
    it('is a FIFO', async () => {
      execFileSync('mkfifo', [join(files, 'pipe.png')])
      await attempt(join(files, 'pipe.png'))
    })
    it('is over 25 MB (not read whole)', async () => {
      const big = join(files, 'big.png')
      writeFileSync(big, PNG)
      truncateSync(big, 25 * 1024 * 1024 + 1)
      await attempt(big)
    })
    it('has a name that is no image', async () => {
      writeFileSync(join(files, 'doc.pdf'), PNG)
      await attempt(join(files, 'doc.pdf'))
    })
    it('is not an absolute path', () => attempt('photo.png'))
  })

  it('writes a pasted picture, given as bytes, as photo-<n>.png among the photos from files, with the checks of a doodle', async () => {
    const desk = join(files, 'desk.jpeg')
    writeFileSync(desk, JPG)
    const dir = join(ws, 'cable-clip')
    await make(request({ photos: [{ path: desk, note: 'the desk' }, { png: PNG, note: 'a screenshot' }], doodles: [{ png: PNG, note: 'on it', over: 1 }] }))
    expect(tree(dir)).toEqual([...CARDS, 'brief.md', 'reference/', 'reference/doodle-1.png', 'reference/photo-1.jpeg', 'reference/photo-2.png'])
    expect([...readFileSync(join(dir, 'reference', 'photo-2.png'))]).toEqual([...PNG])
    const brief = readFileSync(join(dir, 'brief.md'), 'utf8')
    expect(brief).toContain('- reference/photo-2.png: a screenshot\n')
    expect(brief).toContain('- reference/doodle-1.png: on it (drawn over reference/photo-2.png)\n')
    // Two pasted pictures are two photos, not the same one twice.
    await make(request({ name: 'two', photos: [{ png: PNG, note: '' }, { png: PNG, note: '' }] }))
    expect(tree(join(ws, 'two')).filter((f) => f.startsWith('reference/photo'))).toEqual(['reference/photo-1.png', 'reference/photo-2.png'])
    await expect(make(request({ name: 'bad', photos: [{ png: JPG, note: '' }] }))).rejects.toThrow(/PNG/)
    await expect(make(request({ name: 'big', photos: [{ png: new Uint8Array(8 * 1024 * 1024 + 1).fill(1), note: '' }] }))).rejects.toThrow(/8 MB/)
    await expect(make(request({ name: 'both', photos: [{ png: PNG, path: desk, note: '' } as never] }))).rejects.toThrow()
    expect(existsSync(join(ws, 'bad'))).toBe(false)
  })

  it('refuses a doodle that is not a PNG, or too big, and removes what was copied', async () => {
    writeFileSync(join(files, 'good.png'), PNG)
    const photos = [{ path: join(files, 'good.png'), note: '' }]
    await expect(make(request({ photos, doodles: [{ png: JPG, note: '' }] }))).rejects.toThrow(/PNG/)
    await expect(make(request({ photos, doodles: [{ png: new Uint8Array(8 * 1024 * 1024 + 1).fill(1), note: '' }] }))).rejects.toThrow(/8 MB/)
    await expect(make(request({ photos, doodles: [{ png: 'x' as unknown as Uint8Array, note: '' }] }))).rejects.toThrow()
    expect(readdirSync(ws)).toEqual(['lid'])
  })

  it('does not replace a folder that appeared while it worked, and removes its own', async () => {
    await expect(
      make(request(), {
        beforeRename: () => {
          mkdirSync(join(ws, 'cable-clip'))
          writeFileSync(join(ws, 'cable-clip', 'mine.txt'), 'theirs')
        }
      })
    ).rejects.toThrow(/there already/)
    expect(readdirSync(ws).sort()).toEqual(['cable-clip', 'lid'])
    expect(readFileSync(join(ws, 'cable-clip', 'mine.txt'), 'utf8')).toBe('theirs')
  })

  it('does not replace an empty folder that appeared while it worked either', async () => {
    await expect(make(request(), { beforeRename: () => mkdirSync(join(ws, 'cable-clip')) })).rejects.toThrow(/there already/)
    expect(existsSync(join(ws, 'cable-clip', 'brief.md'))).toBe(false)
    expect(readdirSync(ws).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it('makes nothing at all when it fails after the claim', async () => {
    await expect(make(request(), { beforeRename: () => { throw new Error('disk full') } })).rejects.toThrow(/disk full/)
    expect(readdirSync(ws)).toEqual(['lid'])
  })
})

describe('what a new project is made with', () => {
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n')
  const pdf = (name: string, bytes: Buffer | string = PDF) => {
    writeFileSync(join(files, name), bytes)
    return join(files, name)
  }
  const size = (what: string) => ({ what, value: '186 x 128', unit: 'mm' as const, source: 'measured' as const })
  const names = () => cardsOf().cards.filter((c) => c.kind === 'frame').map((c) => c.name)

  it('writes a cards file with no card, and nothing else of .pino, for a bare request', async () => {
    await make(request())
    expect(tree(join(ws, 'cable-clip'))).toEqual([...CARDS, 'brief.md'])
    expect(cardsOf()).toEqual({ next: 1, cards: [] })
  })

  it('puts the pictures and PDFs in reference/ and brief.md, and the other slots in cards only', async () => {
    writeFileSync(join(files, 'desk.png'), PNG)
    await make(
      request({
        photos: [{ path: join(files, 'desk.png'), note: 'the desk edge' }],
        doodles: [{ png: PNG, note: 'the shape', over: 0 }],
        pdfs: [{ path: pdf('Data Sheet.PDF'), note: 'the connector' }],
        sizes: [size('battery tray')],
        rules: 'Hand-solderable.',
        links: [{ url: 'https://example.com/a', note: 'vendor' }]
      })
    )
    const dir = join(ws, 'cable-clip')
    expect([...readFileSync(join(dir, 'reference', 'Data_Sheet.pdf'))]).toEqual([...PDF])
    expect(readCardsFile(cardsOf())?.dropped).toBe(0)
    expect(names()).toEqual(['Size and shape', 'Rules', 'Links'])
    const brief = readFileSync(join(dir, 'brief.md'), 'utf8')
    expect(brief).toContain('- reference/photo-1.png: the desk edge\n')
    expect(brief).toContain('- reference/doodle-1.png: the shape (drawn over reference/photo-1.png)\n')
    expect(brief).toContain('- reference/Data_Sheet.pdf: the connector\n')
    for (const absent of ['battery tray', 'Hand-solderable', 'example.com']) expect(brief).not.toContain(absent)
  })

  it('says a doodle whose photo was taken away is drawn over a photo, naming no file', async () => {
    await make(request({ doodles: [{ png: PNG, note: 'the shape', onPhoto: true }, { png: PNG, note: '', onPhoto: true }] }))
    const brief = readFileSync(join(ws, 'cable-clip', 'brief.md'), 'utf8')
    expect(brief).toContain('- reference/doodle-1.png: the shape (drawn over a photo)\n')
    expect(brief).toContain('- reference/doodle-2.png: drawn over a photo\n')
  })

  it('names a doodle drawn over a photo by the photo as it is copied, with its own ending', async () => {
    writeFileSync(join(files, 'a.PNG'), PNG)
    writeFileSync(join(files, 'b.jpeg'), JPG)
    await make(request({ photos: [{ path: join(files, 'a.PNG'), note: '' }, { path: join(files, 'b.jpeg'), note: '' }], doodles: [{ png: PNG, note: '', over: 1 }] }))
    expect(readFileSync(join(ws, 'cable-clip', 'brief.md'), 'utf8')).toContain('- reference/doodle-1.png: drawn over reference/photo-2.jpeg\n')
  })

  describe('is refused, and nothing is made, for', () => {
    // Refused before the hidden folder is made: no hook of the work in it is reached.
    const refused = async (req: CreateRequest, why?: RegExp) => {
      const reached: string[] = []
      const error = await make(req, { afterTemp: () => void reached.push('temp'), beforeCards: () => void reached.push('cards'), beforeRename: () => void reached.push('rename') }).then(
        () => null,
        (e: Error) => e
      )
      expect(error).not.toBeNull()
      if (why) expect(error?.message).toMatch(why)
      expect(reached).toEqual([])
      expect(readdirSync(ws)).toEqual(['lid'])
    }

    it('a PDF that is a link, a folder or not there', async () => {
      const real = pdf('real.pdf')
      symlinkSync(real, join(files, 'link.pdf'))
      mkdirSync(join(files, 'dir.pdf'))
      for (const path of [join(files, 'link.pdf'), join(files, 'dir.pdf'), join(files, 'missing.pdf'), 'relative.pdf', join(files, 'x.txt')]) {
        await refused(request({ pdfs: [{ path: real, note: '' }, { path, note: '' }] }))
      }
    })

    it('a PDF over 25 MB, and one that does not start %PDF-', async () => {
      const big = pdf('big.pdf')
      truncateSync(big, 25 * 1024 * 1024 + 1)
      await refused(request({ pdfs: [{ path: big, note: '' }] }), /25 MB/)
      await refused(request({ pdfs: [{ path: pdf('fake.pdf', 'PK\x03\x04 not a pdf'), note: '' }] }), /PDF/)
      const ok = pdf('ok.pdf')
      truncateSync(ok, 25 * 1024 * 1024)
      expect(await make(request({ pdfs: [{ path: ok, note: '' }] }))).toEqual({ name: 'cable-clip' })
    })

    it('a 7th PDF, and the same PDF twice', async () => {
      await refused(request({ pdfs: Array.from({ length: 7 }, (_, i) => ({ path: pdf(`${i}.pdf`), note: '' })) }), /At most 6 PDFs/)
      const one = pdf('one.pdf')
      await refused(request({ pdfs: [{ path: one, note: '' }, { path: one, note: '' }] }), /twice/)
    })

    it('a link that is not http or https, has a space or a control character, or is too long, and a 21st link', async () => {
      for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.org/a', 'example.com', 'https://', 'https://a b.com', 'https://a.com/\n', 'https://a.com/\u0007', `https://a.com/${'x'.repeat(2000)}`, 'HTTP:/x']) {
        await refused(request({ links: [{ url, note: '' }] }))
      }
      await refused(request({ links: [{ url: 'https://a.com', note: 'x'.repeat(301) }] }), /300/)
      await refused(request({ links: Array.from({ length: 21 }, (_, i) => ({ url: `https://a.com/${i}`, note: '' })) }), /At most 20 links/)
      const fine = [{ url: 'HTTPS://Example.com/a?b=1', note: 'x'.repeat(300) }, { url: `https://a.com/${'x'.repeat(1985)}`, note: '' }]
      expect(await make(request({ links: fine }))).toEqual({ name: 'cable-clip' })
      expect(cardsOf().cards.filter((c) => c.kind === 'link').map((c) => c.text?.split('\n')[0])).toEqual([fine[0].url, fine[1].url])
    })

    it('a 41st size, a size that is not whole, and rules of 4001 characters', async () => {
      await refused(request({ sizes: Array.from({ length: 41 }, (_, i) => size(`s${i}`)) }), /At most 40 sizes/)
      await refused(request({ sizes: [{ ...size('x'), value: '' }] }))
      await refused(request({ sizes: [{ ...size('x'), source: 'from Claude' }] }))
      await refused(request({ sizes: [{ ...size('x'), what: 'x'.repeat(201) }] }))
      await refused(request({ sizes: [{ ...size('x'), value: 'v'.repeat(61) }] }))
      await refused(request({ rules: 'r'.repeat(4001) }), /4000/)
      await refused(request({ rules: 7 as unknown as string }))
      const fine = await make(request({ sizes: Array.from({ length: 40 }, (_, i) => size(`s${i}`)), rules: 'r'.repeat(4000) }))
      expect(fine).toEqual({ name: 'cable-clip' })
      expect(cardsOf().cards.filter((c) => c.kind === 'size')).toHaveLength(40)
    })

    it('a doodle drawn over a photo that is not there', async () => {
      writeFileSync(join(files, 'a.png'), PNG)
      const photos = [{ path: join(files, 'a.png'), note: '' }]
      for (const over of [1, -1, 0.5, Number.NaN, '0' as unknown as number]) await refused(request({ photos, doodles: [{ png: PNG, note: '', over }] }))
      await refused(request({ doodles: [{ png: PNG, note: '', over: 0 }] }))
    })

    it('lists that are not lists', async () => {
      for (const key of ['sizes', 'links', 'pdfs', 'power', 'connections', 'parts'] as const) await refused({ ...request(), [key]: undefined } as unknown as CreateRequest, /not a list/)
    })
  })

  it('removes the temp folder when the cards cannot be written', async () => {
    await expect(make(request(), { beforeCards: (temp) => writeFileSync(join(temp, '.pino'), 'in the way') })).rejects.toThrow()
    expect(readdirSync(ws)).toEqual(['lid'])
  })
})

describe('sweeping what a crash left', () => {
  const stale = '.cable-clip.pino-new-0123456789ab'

  it('sweeps only its own temp folders, older than ten minutes', () => {
    const old = new Date(Date.now() - 11 * 60_000)
    const folders = ['.x.pino-new-0123456789ab', '.y.pino-new-0123456789ab', '.x.pino-new-zz']
    for (const name of folders) mkdirSync(join(ws, name))
    writeFileSync(join(ws, '.f.pino-new-0123456789ab'), '')
    for (const name of ['.x.pino-new-0123456789ab', '.x.pino-new-zz', '.f.pino-new-0123456789ab']) utimesSync(join(ws, name), old, old)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws).sort()).toEqual(['.f.pino-new-0123456789ab', '.x.pino-new-zz', '.y.pino-new-0123456789ab', 'lid'])
  })

  it('removes the hidden folders older than this run, with what is in them, and nothing else', () => {
    mkdirSync(join(ws, stale, 'reference'), { recursive: true })
    mkdirSync(join(ws, '.fresh.pino-new-0123456789ab'))
    mkdirSync(join(ws, '.odd.pino-new-xyz'))
    mkdirSync(join(ws, 'visible.pino-new-0123456789ab'))
    mkdirSync(join(ws, '.hidden'))
    for (const name of ['.odd.pino-new-xyz', 'visible.pino-new-0123456789ab', '.hidden']) utimesSync(join(ws, name), new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000))
    const hourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(join(ws, stale), hourAgo, hourAgo)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws).sort()).toEqual(['.fresh.pino-new-0123456789ab', '.hidden', '.odd.pino-new-xyz', 'lid', 'visible.pino-new-0123456789ab'])
  })

  it('leaves a folder that holds files in reference/ (doodles that exist nowhere else), and removes one with none', () => {
    const kept = '.kept.pino-new-0123456789ab'
    mkdirSync(join(ws, kept, 'reference'), { recursive: true })
    writeFileSync(join(ws, kept, 'reference', 'doodle-1.png'), PNG)
    mkdirSync(join(ws, stale, 'reference'), { recursive: true })
    writeFileSync(join(ws, stale, 'brief.md'), 'x')
    const hourAgo = new Date(Date.now() - 3_600_000)
    for (const name of [kept, stale]) utimesSync(join(ws, name), hourAgo, hourAgo)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws).sort()).toEqual([kept, 'lid'])
    expect(existsSync(join(ws, kept, 'reference', 'doodle-1.png'))).toBe(true)
  })

  it('removes none that is under 10 minutes old, whenever this run began', () => {
    mkdirSync(join(ws, stale))
    const young = new Date(Date.now() - 9 * 60_000)
    utimesSync(join(ws, stale), young, young)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws)).toContain(stale)
    const old = new Date(Date.now() - 11 * 60_000)
    utimesSync(join(ws, stale), old, old)
    sweepStaleNew(ws, Date.now())
    expect(readdirSync(ws)).not.toContain(stale)
  })

  it('never follows a link: one named like a folder of ours is left alone, and so is what it leads to', () => {
    mkdirSync(join(base, 'precious'))
    writeFileSync(join(base, 'precious', 'keep.txt'), 'keep')
    symlinkSync(join(base, 'precious'), join(ws, stale))
    sweepStaleNew(ws, Date.now())
    expect(readFileSync(join(base, 'precious', 'keep.txt'), 'utf8')).toBe('keep')
    expect(readdirSync(ws)).toContain(stale)
  })

  it('does not fail on a workspace that is not there', () => {
    expect(() => sweepStaleNew(join(base, 'nowhere'), Date.now())).not.toThrow()
  })
})
