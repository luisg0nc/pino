// A build's schematic, read once: KiCad's picture in pino's ink, and what is where on it.

import { sheetOf, type Sheet } from '../../shared/sheet'
import type { ViewModel } from '../state/viewModel'
import { inkSvg } from './ink'

export interface Drawing {
  hash: string
  svg: string
  sheet: Sheet | null
}

const drawings = new Map<string, Promise<Drawing>>()

export function readDrawing(model: ViewModel): Promise<Drawing> {
  const key = `${model.projectId}|${model.hash}`
  let held = drawings.get(key)
  if (!held) {
    const file = (name: 'schematic_svg' | 'sheet') => window.pino.build.file(model.projectId, model.hash, name).then(String)
    held = Promise.all([file('schematic_svg'), model.result.artifacts.sheet ? file('sheet').then((t) => sheetOf(JSON.parse(t))) : null]).then(([svg, sheet]) => ({
      hash: model.hash,
      svg: inkSvg(svg),
      sheet
    }))
    drawings.set(key, held)
    held.catch(() => drawings.delete(key))
    while (drawings.size > 4) drawings.delete(drawings.keys().next().value!)
  }
  return held
}
