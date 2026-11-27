import { verdictWords, type BuildState } from '../../../shared/build'
import { buildSeconds, headSaid, underHead } from '../../../shared/checks'
import type { ProjectInfo } from '../../../shared/project'
import { actions, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { buildNamed } from '../strip/strip'
import { useStripNodes } from '../strip/useStripNodes'

/**
 * The head of the route card (pino's On block, torno #335): the newest build named in the builds timeline's words
 * (`Latest build · prompt 5`, `buildNamed`) and how it stands in pino's word for it (`routed`, `copper stale`,
 * `checks pass`); an older build on show as `Prompt 3 · older build` with Back to latest; the project's name while
 * nothing is built.
 */
export function Head({ project, build }: { project: ProjectInfo; build: BuildState | null }) {
  const { nodes } = useStripNodes()
  const shown = useStore((s) => s.shown)
  if (build?.engine.state === 'failed') {
    const [what, ...why] = build.engine.reason.split(': ')
    return (
      <header className="route-head" data-engine="failed">
        <h2 className="route-verdict">{what}</h2>
        <p className="route-sub selectable">{numbered(why.join(': '))}</p>
      </header>
    )
  }
  const latest = build?.latest
  if (!latest) {
    return (
      <header className="route-head">
        <h2 className="route-name" title={project.dir}>
          {project.name}
        </h2>
        {build?.building && <p className="route-sub">Building the board.</p>}
        {build?.problem && <p className="route-sub selectable">{build.problem}</p>}
      </header>
    )
  }
  // An older build on show is named as older, with the way back; the word and the line under it are the latest's, so they wait.
  const older = shown === null ? null : buildNamed(nodes, shown)
  if (older && !older.latest) {
    return (
      <header className="route-head" data-older="">
        <h2 className="route-verdict" title={older.id}>
          <span className="route-build">{numbered(older.head)}</span>
          <button type="button" className="link-button route-back" onClick={() => actions.showBuild(null)}>
            Back to latest
          </button>
        </h2>
        {build!.building && <p className="route-sub">Building again.</p>}
      </header>
    )
  }
  const named = buildNamed(nodes, latest.number)
  const said = headSaid(latest, build!.route !== null)
  const failed = latest.verdict === 'failed'
  const waits = failed ? '' : underHead(latest)
  return (
    <header className="route-head">
      {/* The build in the builds timeline's words; its history id is the title only. */}
      <h2 className="route-verdict" title={`h${latest.number}, ${project.dir}`}>
        <span className="route-build">{numbered(named?.head ?? 'Latest build')}</span>
        {/* The engine's headline in full is the title: the word is all that has to be read here. */}
        <span className="route-rest" data-tone={said.tone} title={verdictWords(latest).rest}>
          {numbered(said.word)}
        </span>
      </h2>
      <p className="route-sub">
        {!failed && numbered(`Fast build ${buildSeconds(latest)} s. `)}
        {numbered(waits)}
        {build!.building && ' Building again.'}
      </p>
    </header>
  )
}
