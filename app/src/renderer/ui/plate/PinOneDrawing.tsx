import { DIMENSIONS, PART, SCRIBE_BOX, SCRIBE_PATHS } from '../pinOne'

/**
 * The chip scribed on the first screen's dye, with its dimensions. It is drawn once as the screen comes up: the lines
 * first, then the dimensions, then pin 1's leg fills (plate.css). With less motion asked for it stands drawn.
 */
export function PinOneDrawing() {
  return (
    <svg className="pin-drawing" viewBox={SCRIBE_BOX} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="pin-part" d={PART} />
      {SCRIBE_PATHS.map((d) => (
        <path key={d} className="pin-line" d={d} pathLength={1} />
      ))}
      <g className="pin-dims">
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
