// The board in 3D in the solder-mask look of the design mocks: green mask with the copper showing lighter through it,
// tinned pads, white silk on FR-4. KiCad names the board's meshes (board_soldermask, board_pad and so on); everything
// else is a part, and keeps the colours its model has. The values are the tokens' (--mask and its neighbours).

import { Color, DoubleSide, Mesh, MeshStandardMaterial, type Object3D } from 'three'

export const MATERIAL_LOOK = { mask: '#1E5B3B', maskCu: '#3F8C5F', tin: '#DCDFD8', silk: '#F2F0E8', fr4: '#C2BB9C' } as const

export type MaterialKind = 'mask' | 'copper' | 'tin' | 'silk' | 'fr4' | 'part'

const BY_MESH: ReadonlyArray<[RegExp, MaterialKind]> = [
  [/^board_soldermask/, 'mask'],
  [/^board_(copper|via|zone|track)/, 'copper'],
  [/^board_pad/, 'tin'],
  [/^board_silk/, 'silk'],
  [/^board_PCB/, 'fr4']
]

/** What a mesh's material is of: told by the mesh's name, which KiCad gives only to the board's own. */
export function classify(m: { name: string; color: [number, number, number] }): MaterialKind {
  return BY_MESH.find(([name]) => name.test(m.name))?.[1] ?? 'part'
}

const LOOKS: Record<Exclude<MaterialKind, 'part'>, { colour: string; roughness: number; metalness: number; opacity?: number }> = {
  // The mask lets the copper under it show, as a lighter green.
  mask: { colour: MATERIAL_LOOK.mask, roughness: 0.42, metalness: 0.05, opacity: 0.93 },
  copper: { colour: MATERIAL_LOOK.maskCu, roughness: 0.5, metalness: 0.25 },
  tin: { colour: MATERIAL_LOOK.tin, roughness: 0.34, metalness: 0.65 },
  silk: { colour: MATERIAL_LOOK.silk, roughness: 0.9, metalness: 0 },
  fr4: { colour: MATERIAL_LOOK.fr4, roughness: 0.85, metalness: 0 }
}

/**
 * Gives the board's meshes the solder-mask materials and leaves the parts' own. Each mesh is told its kind
 * (`userData.kind`), by which the view's switches hide it. The mesh's name in the file is `userData.meshName`.
 */
export function restyle(root: Object3D): void {
  const made = new Map<MaterialKind, MeshStandardMaterial>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const kind = classify({ name: String(object.userData.meshName ?? ''), color: [0, 0, 0] })
    object.userData.kind = kind
    if (kind === 'part') return
    let material = made.get(kind)
    if (!material) {
      const look = LOOKS[kind]
      material = new MeshStandardMaterial({ color: new Color(look.colour), roughness: look.roughness, metalness: look.metalness, side: DoubleSide })
      if (look.opacity !== undefined) {
        material.transparent = true
        material.opacity = look.opacity
        material.depthWrite = false
      }
      made.set(kind, material)
    }
    object.material = material
  })
}
