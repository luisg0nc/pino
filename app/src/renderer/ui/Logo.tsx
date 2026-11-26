import { APP } from '../../shared/app'
import { ICON16_SHAPES, TILE_SHAPES, type MarkShape } from './pinOne'

/**
 * pino's mark, pin one, with no tile under it. The chip's body is drawn with the even-odd rule, so its pin-1 dot is a
 * hole and the mark sits on any background. At 16 and 20 px it is the drawing made for 16, one unit to a pixel (at 20
 * with two of room round it), so that every edge stands on a whole pixel.
 */
export function Logo({ size, tone = 'ink' }: { size: 16 | 20 | 64; tone?: 'ink' | 'on-dye' }) {
  const small = size < 64
  const shapes: readonly MarkShape[] = small ? ICON16_SHAPES : TILE_SHAPES
  const room = (size - 16) / 2
  return (
    <svg className="logo" data-tone={tone} width={size} height={size} viewBox={small ? `${-room} ${-room} ${size} ${size}` : '0 0 64 64'} shapeRendering={small ? 'crispEdges' : undefined} role="img" aria-label={APP.name}>
      {shapes.map((s, i) =>
        'd' in s ? <path key={i} data-fill={s.fill} d={s.d} fillRule="evenodd" /> : <rect key={i} data-fill={s.fill} x={s.rect[0]} y={s.rect[1]} width={s.rect[2]} height={s.rect[3]} rx={s.rect[4]} />
      )}
    </svg>
  )
}
