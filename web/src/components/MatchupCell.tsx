import { matchupTier } from '@/lib/matchup'
import type { MatchupTier } from '@/lib/matchup'
import type { StartSlot } from '@/lib/types'

const TONE: Record<MatchupTier, string> = {
  tough: 'text-bad',
  even: 'text-ink-2',
  soft: 'text-good',
  unknown: 'text-ink-3',
}

/** Each start in the period, with the offense it draws. */
export function MatchupCell({ starts }: { starts: StartSlot[] }) {
  if (starts.length === 0) {
    return <td className="px-3 py-2 text-ink-3">—</td>
  }
  return (
    <td className="px-3 py-2">
      <div className="flex flex-col gap-1">
        {starts.map((s) => (
          <Matchup key={s.date} start={s} />
        ))}
      </div>
    </td>
  )
}

function Matchup({ start }: { start: StartSlot }) {
  const tier = matchupTier(start)
  return (
    <div className="flex items-baseline gap-2 text-xs whitespace-nowrap">
      <span className="num w-14 shrink-0 text-ink-3">{start.label}</span>
      <span className="w-14 shrink-0">
        {start.is_away ? '@' : 'vs '}
        {start.opponent}
      </span>
      <span className={`w-10 shrink-0 ${TONE[tier]}`}>
        {tier === 'unknown' ? '' : tier}
      </span>
      {/* Both axes, because the tier reads both: an offense can be quiet and
          still be a bad draw by never striking out. */}
      {start.opponent_runs_per_game !== null && (
        <span className="num text-ink-3">
          {start.opponent_runs_per_game.toFixed(2)} r/g
          {start.opponent_runs_rank !== null && ` · ${ordinal(start.opponent_runs_rank)}`}
        </span>
      )}
      {start.opponent_strikeouts_rank !== null && (
        <span
          className="num text-ink-3"
          title={`${ordinal(start.opponent_strikeouts_rank)} in strikeouts drawn — rank 1 whiffs most`}
        >
          K {start.opponent_strikeouts_rank}/30
        </span>
      )}
    </div>
  )
}

function ordinal(rank: number): string {
  const rest = rank % 100
  if (rest >= 11 && rest <= 13) return `${rank}th`
  return `${rank}${['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th'}`
}
