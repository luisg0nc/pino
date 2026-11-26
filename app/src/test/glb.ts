// A GLB's JSON chunk read for the tests: what its meshes are called, their materials' colours and where they are.

import { readFileSync } from 'node:fs'

interface Gltf {
  meshes: Array<{ name?: string; primitives: Array<{ material?: number; attributes: { POSITION: number } }> }>
  materials: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }>
  accessors: Array<{ min: number[]; max: number[] }>
}

export function gltfOf(path: string): Gltf {
  const bytes = readFileSync(path)
  // The 12-byte header, then the JSON chunk: its length, its type, its text.
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as Gltf
}

export function glbMaterials(path: string): Array<{ name: string; color: [number, number, number] }> {
  const gltf = gltfOf(path)
  return gltf.meshes.flatMap((mesh) =>
    mesh.primitives.map((p) => {
      const color = gltf.materials[p.material ?? 0]?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1]
      return { name: mesh.name ?? '', color: [color[0], color[1], color[2]] as [number, number, number] }
    })
  )
}

/** The bounds of the meshes of this name (their nodes have no transform of their own in KiCad's export). */
export function meshBox(path: string, name: string): { min: [number, number, number]; max: [number, number, number] } {
  const gltf = gltfOf(path)
  const boxes = gltf.meshes.filter((m) => m.name === name).flatMap((m) => m.primitives.map((p) => gltf.accessors[p.attributes.POSITION]))
  const of = (pick: 'min' | 'max', by: (...v: number[]) => number) => [0, 1, 2].map((i) => by(...boxes.map((b) => b[pick][i]))) as [number, number, number]
  return { min: of('min', Math.min), max: of('max', Math.max) }
}
