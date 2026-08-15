import { barSegments, isLeading, sideLabel } from '@/lib/bracket'
import type { PlayoffMatchup, PlayoffSide } from '@/lib/types'

/**
 * The two teams' scores as bars on a shared axis.
 *
 * The gap between the bar ends is the margin, which saves the reader the
 * subtraction the spreadsheet made them do. The seed spot is a lighter segment
 * at the head of the bar it belongs to, so a head start reads as territory
 * already held rather than as a number to reconcile.
 */
export function ScoreBars({
  matchup,
  peak,
}: {
  matchup: PlayoffMatchup
  peak: number | null
}) {
  if (barSegments(matchup.a, peak) === null && barSegments(matchup.b, peak) === null) {
    return null
  }

  return (
    <div className="flex flex-col gap-1 px-5 pb-4">
      <Bar side={matchup.a} peak={peak} leading={isLeading(matchup, matchup.a)} />
      <Bar side={matchup.b} peak={peak} leading={isLeading(matchup, matchup.b)} />
    </div>
  )
}

function Bar({
  side,
  peak,
  leading,
}: {
  side: PlayoffSide
  peak: number | null
  leading: boolean
}) {
  const segments = barSegments(side, peak)

  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
      <span
        className={`truncate text-right text-xs ${leading ? 'text-ink-2' : 'text-ink-3'}`}
      >
        {sideLabel(side)}
      </span>
      <div
        className="relative h-2.5 overflow-hidden rounded-sm bg-sunk"
        role="img"
        aria-label={describe(side)}
      >
        {segments && (
          <>
            {segments.spot > 0 && (
              <span
                className={`absolute inset-y-0 left-0 ${leading ? 'bg-good/40' : 'bg-ink-2/25'}`}
                style={{ width: `${segments.spot}%` }}
              />
            )}
            <span
              className={`absolute inset-y-0 ${leading ? 'bg-good/85' : 'bg-ink-2/50'}`}
              style={{ left: `${segments.spot}%`, width: `${segments.earned}%` }}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** Spells out the split the two-tone bar shows, for anyone not seeing it. */
function describe(side: PlayoffSide): string {
  const name = sideLabel(side)
  if (side.matchup_points === null) return `${name} has not scored yet`
  const earned = `${(side.earned ?? 0).toFixed(2)} earned`
  const spot = side.advantage ? ` plus a ${side.advantage.toFixed(2)} seed spot` : ''
  return `${name} ${side.matchup_points.toFixed(2)}: ${earned}${spot}`
}
