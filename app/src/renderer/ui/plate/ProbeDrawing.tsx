import { DIMENSIONS, PART, SCRIBE_BOX, SCRIBE_PATHS } from '../probe'

/**
 * The probe scribed on the first screen's dye, with its dimensions. It is drawn once as the screen comes up: the lines
 * first, then the dimensions, then the board's section fills (plate.css). With less motion asked for it stands drawn.
 */
export function ProbeDrawing() {
  const board = { x: PART.x, y: PART.y, width: PART.width, height: PART.height, rx: PART.radius }
  return (
    <svg className="probe-drawing" viewBox={SCRIBE_BOX} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <clipPath id="probe-board">
        <rect {...board} />
      </clipPath>
      <g className="probe-part">
        <rect {...board} />
        <path d={PART.hatches.join('')} clipPath="url(#probe-board)" />
      </g>
      {SCRIBE_PATHS.map((d) => (
        <path key={d} className="probe-line" d={d} pathLength={1} />
      ))}
      <g className="probe-dims">
        {DIMENSIONS.map((dim) => (
          <g key={dim.text}>
            <path d={dim.lines} />
            <text x={dim.x} y={dim.y} textAnchor={dim.middle ? 'middle' : undefined}>
              {dim.text}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}
