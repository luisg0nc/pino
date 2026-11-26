import { verdictWords, type BuildState } from '../../../shared/build'
import { buildSeconds, headSaid, underHead } from '../../../shared/checks'
import type { ProjectInfo } from '../../../shared/project'
import { numbered } from '../numbered'

/** The head of the route card: `On h15` and how it stands, or the project's name while nothing is built. */
export function Head({ project, build }: { project: ProjectInfo; build: BuildState | null }) {
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
  const said = headSaid(latest, build!.route !== null)
  const failed = latest.verdict === 'failed'
  const waits = failed ? '' : underHead(latest)
  return (
    <header className="route-head">
      <h2 className="route-verdict" title={project.dir}>
        On <span className="num route-build">h{latest.number}</span>{' '}
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
