import type { ProjectInfo } from '../../shared/project'

/**
 * The route card at the left of an open project: the project read top to bottom. It has the project's name and its
 * brief, which Claude keeps in `brief.md`; the Brief page, the checks and the fab limits come with later stages.
 */
export function RouteCard({ project }: { project: ProjectInfo }) {
  return (
    <div className="route-card">
      <header className="route-head">
        <h2 className="route-name" title={project.dir}>
          {project.name}
        </h2>
      </header>
      <section className="route-section" aria-labelledby="route-brief">
        <h3 id="route-brief" className="route-title">
          Brief
        </h3>
        <p>No brief yet.</p>
        <p className="muted">
          Tell Claude what the board is for. It keeps the brief in <span className="num">brief.md</span>.
        </p>
      </section>
    </div>
  )
}
