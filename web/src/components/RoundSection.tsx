import { MatchupCard } from '@/components/MatchupCard'
import { roundTiming } from '@/lib/bracket'
import type { PlayoffRound } from '@/lib/types'

/** A round's header and its matchups. */
export function RoundSection({
  round,
  today,
}: {
  round: PlayoffRound
  today: string
}) {
  const timing = roundTiming(round, today)

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="chyron text-lg">{round.label}</h2>
        <span className="num text-xs text-ink-3">
          {short(round.starts_on)} → {short(round.ends_on)}
        </span>
        {round.state !== 'upcoming' && (
          <span
            className={`chyron rounded-full border px-2 text-[0.65rem] ${
              round.state === 'live'
                ? 'border-good text-good'
                : 'border-line text-ink-3'
            }`}
          >
            {round.state === 'live' ? 'Live' : 'Final'}
          </span>
        )}
        {timing && <span className="num ml-auto text-xs text-mine">{timing}</span>}
      </header>

      <div className="flex flex-col gap-2">
        {round.matchups.map((matchup, index) => (
          <MatchupCard
            key={`${round.label}-${index}`}
            matchup={matchup}
            peak={round.peak_points}
          />
        ))}
      </div>
    </section>
  )
}

/** `2026-08-10` reads as `8/10`; the year is never in question here. */
function short(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${Number(month)}/${Number(day)}`
}
