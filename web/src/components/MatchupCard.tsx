import { ScoreBars } from '@/components/ScoreBars'
import { isLeading, marginOf, sideLabel } from '@/lib/bracket'
import type { PlayoffMatchup, PlayoffSide } from '@/lib/types'

/**
 * One matchup, as a scoreboard.
 *
 * The two teams face each other across the margin, the way every sports
 * scoreboard is laid out — left and right are unambiguous because the teams are
 * placed there. Below ~560px the card restacks onto one column; that breakpoint
 * is a container query, so a card dropped into a narrow column behaves the same
 * as one on a narrow screen.
 */
export function MatchupCard({
  matchup,
  peak,
}: {
  matchup: PlayoffMatchup
  peak: number | null
}) {
  const pending = matchup.a.matchup_points === null && matchup.b.matchup_points === null
  const margin = marginOf(matchup)

  return (
    <article
      className={`@container overflow-hidden rounded border bg-panel ${
        pending ? 'border-dashed border-line' : 'border-line'
      }`}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 px-5 py-4 @max-[560px]:grid-cols-1 @max-[560px]:gap-2">
        <Corner side={matchup.a} leading={isLeading(matchup, matchup.a)} />
        <div className="text-center @max-[560px]:order-3 @max-[560px]:flex @max-[560px]:items-baseline @max-[560px]:gap-2 @max-[560px]:border-t @max-[560px]:border-line @max-[560px]:pt-2 @max-[560px]:text-left">
          <span className="chyron block text-[0.65rem] text-ink-3">
            {verdict(matchup, pending)}
          </span>
          <span
            className={`num block text-xl ${margin === null ? 'text-ink-3' : 'text-good'}`}
          >
            {margin === null ? '—' : margin.toFixed(2)}
          </span>
        </div>
        <Corner side={matchup.b} leading={isLeading(matchup, matchup.b)} away />
      </div>

      {!matchup.is_bye && <ScoreBars matchup={matchup} peak={peak} />}
    </article>
  )
}

/**
 * The line above the margin.
 *
 * A matchup with no scores has not started, which is not the same as the two
 * sides being level — saying "level" of an unplayed round is simply wrong.
 */
function verdict(matchup: PlayoffMatchup, pending: boolean): string {
  if (matchup.is_bye) return 'Bye'
  if (pending) return 'Not started'
  return matchup.leader ? `${matchup.leader} by` : 'Level'
}

/**
 * One team's side of the card.
 *
 * Fixed line heights throughout: the leader's score is larger, and without them
 * the two corners compute different heights and every line drifts out of
 * register with its opposite number.
 */
function Corner({
  side,
  leading,
  away = false,
}: {
  side: PlayoffSide
  leading: boolean
  away?: boolean
}) {
  const unresolved = side.team === null

  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 @max-[560px]:grid @max-[560px]:grid-cols-[1fr_auto] @max-[560px]:items-center ${
        away ? 'items-end text-right @max-[560px]:items-center @max-[560px]:text-left' : ''
      }`}
    >
      <div
        className={`flex min-h-[1.4rem] min-w-0 items-baseline gap-1.5 @max-[560px]:col-start-1 ${
          away ? 'flex-row-reverse @max-[560px]:flex-row' : ''
        }`}
      >
        {side.seed !== null && (
          <span className="num shrink-0 rounded bg-sunk px-1 text-[0.68rem] text-ink-2">
            {side.seed}
          </span>
        )}
        <span
          className={`truncate ${
            unresolved
              ? 'text-sm text-ink-3 italic'
              : `font-semibold ${leading ? 'text-ink' : 'text-ink-2'}`
          }`}
        >
          {sideLabel(side)}
        </span>
        {leading && (
          <span
            className="inline-block size-[0.45rem] shrink-0 rounded-full bg-good"
            title="Leading"
          />
        )}
      </div>

      <span
        className={`num flex h-[2.1rem] items-center @max-[560px]:col-start-2 @max-[560px]:row-start-1 ${
          away ? 'justify-end @max-[560px]:justify-end' : '@max-[560px]:justify-end'
        } ${
          side.matchup_points === null
            ? 'text-xl text-ink-3'
            : leading
              ? 'text-[1.9rem] text-good'
              : 'text-[1.65rem] text-ink-2'
        }`}
      >
        {side.matchup_points === null ? '—' : side.matchup_points.toFixed(2)}
      </span>

      <span className="min-h-[1rem] text-xs text-ink-3 @max-[560px]:col-span-2">
        {side.current_points === null
          ? ''
          : `${side.current_points.toFixed(2)} season`}
      </span>
    </div>
  )
}
