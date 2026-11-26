// Claude's `look`: main asks, the window draws the tab asked for from the build on show and answers with the picture.

import { withRouteFindings } from '../shared/checks'
import { lookTab, type LookRequest, type LookResult } from '../shared/view'
import { boardLook } from './board/look'
import { sheetLook } from './sheet/look'
import { store } from './state/store'
import { loadViewModel, type ViewModel } from './state/viewModel'
import { threeLook } from './three/look'

/** The long edge of a picture when Claude names none (main/mcp/schemas.ts DEFAULT_SIZE). */
const DEFAULT_SIZE = 1280

/** The build the views show: the one chosen in the strip, else the newest that drew something. */
async function shownModel(): Promise<ViewModel> {
  const { project, build, shown } = store.getState()
  const newest = build?.lastGood
  if (!project || !build || !newest?.hash) throw new Error('there is no build to draw')
  let result = newest
  if (shown !== null && shown !== newest.number) {
    const hash = build.history.find((e) => e.number === shown)?.hash
    if (!hash) throw new Error(`h${shown} is no longer kept`)
    result = { ...(await window.pino.build.result(project.id, hash)), number: shown }
  }
  const model = await loadViewModel(project.id, result)
  return { ...model, result: withRouteFindings(result, model.routeFindings) }
}

async function picture(request: LookRequest): Promise<LookResult> {
  const model = await shownModel()
  const { tab, look, marks } = store.getState()
  const asked = lookTab(request.tab, tab)
  const size = request.size ?? DEFAULT_SIZE
  if (asked === 'schematic') return sheetLook(model, request, size, marks)
  if (asked === '3d') return threeLook(model, request, size)
  return boardLook(model, request, size, look, marks, window.matchMedia('(prefers-color-scheme: dark)').matches)
}

/** Hears main's questions for as long as the window is up. Returns what stops it. */
export function answerLooks(): () => void {
  return window.pino.view.onAsk(({ id, req }) => {
    picture(req).then(
      (result) => window.pino.view.answer(id, result),
      (e: unknown) => window.pino.view.answer(id, { error: e instanceof Error ? e.message : String(e) })
    )
  })
}
