import { describe, expect, it } from 'vitest'
import { Group, Mesh, MeshStandardMaterial } from 'three'
import { glbMaterials } from '../../test/glb'
import { fx, read } from '../../test/fixtures'
import { classify, MATERIAL_LOOK, restyle } from './material'

it('names the board materials of the reference GLB', () => {
  const kinds = glbMaterials(fx('board.glb')).map(classify)
  expect(kinds).toEqual(expect.arrayContaining(['mask', 'copper', 'tin', 'silk', 'fr4', 'part']))
})

it('tells the board from its parts by what KiCad calls its meshes', () => {
  const of = (name: string) => classify({ name, color: [0.5, 0.5, 0.5] })
  expect(['board_soldermask', 'board_copper', 'board_pad', 'board_silkscreen', 'board_PCB', 'board_via'].map(of)).toEqual(['mask', 'copper', 'tin', 'silk', 'fr4', 'copper'])
  expect(of('C_0402_1005Metric')).toBe('part')
  expect(of('')).toBe('part')
})

describe('restyling a loaded board', () => {
  const mesh = (name: string) => {
    const m = new Mesh(undefined, new MeshStandardMaterial({ color: 0x123456 }))
    m.userData.meshName = name
    return m
  }

  it("gives the board the solder-mask material, as the tokens have it, and leaves the parts' own", () => {
    const root = new Group()
    const [mask, tin, part] = [mesh('board_soldermask'), mesh('board_pad'), mesh('C_0402')]
    root.add(mask, tin, part)
    restyle(root)
    const colour = (m: Mesh) => `#${(m.material as MeshStandardMaterial).color.getHexString().toUpperCase()}`
    expect(colour(mask)).toBe(MATERIAL_LOOK.mask)
    expect(colour(tin)).toBe(MATERIAL_LOOK.tin)
    expect(colour(part)).toBe('#123456')
    expect([mask.userData.kind, tin.userData.kind, part.userData.kind]).toEqual(['mask', 'tin', 'part'])
  })

  it('has the colours the tokens have', () => {
    const css = read('src/renderer/styles/tokens.css')
    for (const [token, value] of [['--mask', MATERIAL_LOOK.mask], ['--mask-cu', MATERIAL_LOOK.maskCu], ['--tin', MATERIAL_LOOK.tin], ['--silk-3d', MATERIAL_LOOK.silk], ['--fr4', MATERIAL_LOOK.fr4]]) {
      expect(css).toContain(`${token}: ${value};`)
    }
  })
})
