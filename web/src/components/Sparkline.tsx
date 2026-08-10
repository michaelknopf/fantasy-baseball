import type { GameLogEntry } from '@/lib/types'

const COUNT = 6
const WIDTH = 76
const HEIGHT = 20

/**
 * The last few starts as bars, oldest to newest.
 *
 * A rate says where a pitcher sits; this says whether he is arriving there
 * steadily or on the back of one outlier, which the rate alone hides. Bars are
 * scaled against a fixed ceiling rather than each pitcher's own best, so height
 * compares across rows.
 */
export function Sparkline({
  games,
  ceiling = 60,
}: {
  games: GameLogEntry[]
  ceiling?: number
}) {
  // Stored newest-first; read left to right as time.
  const recent = games.slice(0, COUNT).reverse()
  if (recent.length === 0) {
    return <span className="text-ink-3">—</span>
  }

  const slot = WIDTH / COUNT
  const label = recent
    .map((g) => `${g.date ?? '?'}: ${g.fantasy_points ?? 0}`)
    .join(', ')

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Last ${recent.length} starts — ${label}`}
      className="overflow-visible"
    >
      {recent.map((game, i) => {
        const points = game.fantasy_points ?? 0
        const height = Math.max(1, Math.min(points / ceiling, 1) * HEIGHT)
        return (
          <rect
            key={`${game.date ?? i}`}
            x={i * slot}
            y={HEIGHT - height}
            width={slot - 2}
            height={height}
            rx={1}
            className={points >= ceiling / 2 ? 'fill-good' : 'fill-ink-3'}
          />
        )
      })}
    </svg>
  )
}
