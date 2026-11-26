import { hint } from '../../../shared/keys'
import { actions, useStore } from '../../state/store'
import { TOOL_KEYS, TOOL_NAMES, type MarkTool } from './tools'

const ICONS: Record<MarkTool, React.ReactNode> = {
  select: <path d="M3.5 2.5l9 5-4 1.2-1.7 4z" fill="currentColor" stroke="none" />,
  point: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
    </>
  ),
  arrow: <path d="M3 13L12.5 3.5M7 3.5h5.5V9" />,
  stroke: (
    <>
      <path d="M2.5 12.5c2-5 4-1 6-4.5s3-5 5-5" />
      <circle cx="2.5" cy="12.5" r="1.2" fill="currentColor" />
    </>
  ),
  region: <path d="M3 4l9-1.5 1.5 8L5 13.5z" strokeDasharray="2.2 2" />
}

/** torno's reed: the marking tools at the left of the view. The one in hand is filled and grows its name and key. */
export function MarkReed({ tools, drawing = false }: { tools: readonly MarkTool[]; drawing?: boolean }) {
  const held = useStore((s) => s.tool)
  const chosen = tools.includes(held) ? held : 'select'
  return (
    <div className="toolbox" role="toolbar" aria-label="Marks" aria-orientation="vertical" data-tag-avoid="">
      <div className="toolbox-group">
        {tools.map((tool, i) => (
          <div key={tool} className="tool-tipped">
            {i === 1 && <hr className="toolbox-rule" />}
            <button
              type="button"
              className="tool-button"
              data-tool={tool}
              aria-label={`${TOOL_NAMES[tool]} (${hint(TOOL_KEYS[tool])})`}
              aria-pressed={chosen === tool}
              title={chosen === tool && tool !== 'select' ? undefined : `${TOOL_NAMES[tool]} (${hint(TOOL_KEYS[tool])})`}
              onClick={() => actions.setTool(tool)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[tool]}
              </svg>
            </button>
            {/* Not over what a line is being drawn across. */}
            {chosen === tool && tool !== 'select' && !drawing && (
              <span className="reed-pill" aria-hidden="true">
                {TOOL_NAMES[tool]}
                <span className="reed-key">{hint(TOOL_KEYS[tool])}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
