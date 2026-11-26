import { verdictWords, type BuildState } from '../../../shared/build'
import { buildSeconds, waitingWords } from '../../../shared/checks'
import type { ProjectInfo } from '../../../shared/project'
import { numbered } from '../numbered'

/** The head of the route card: `On h15` and the headline's rest, or the project's name while nothing is built. */
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
  const { rest } = verdictWords(latest)
  const failed = latest.verdict === 'failed'
  const waits = failed ? '' : waitingWords(latest.waiting)
  return (
    <header className="route-head">
      <h2 className="route-verdict" title={project.dir}>
        On <span className="num route-build">h{latest.number}</span>{' '}
        <span className="route-rest" data-verdict={latest.verdict}>
          {rest}
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
