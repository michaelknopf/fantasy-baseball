import { MatchupCell } from '@/components/MatchupCell'
import { ScoreCell } from '@/components/ScoreCell'
import { Sparkline } from '@/components/Sparkline'
import { StatCell } from '@/components/StatCell'
import { numeric } from '@/lib/rows'
import type { PitcherRow, Ramps, SortKey } from '@/lib/rows'
import { isInjuredReserve } from '@/lib/types'
import type { Pitcher, WaiverPeriod } from '@/lib/types'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'last30', label: '30d' },
  { key: 'last60', label: '60d' },
  { key: 'season', label: 'Season' },
  { key: 'starts', label: 'Starts' },
  { key: 'name', label: 'Name' },
]

/**
 * The pitchers who start inside the open period, ours and claimable together.
 *
 * One table rather than two, because the question is always "who should hold
 * this slot" — splitting our arms from the pool is what makes that hard to
 * answer. Ownership is a column and an action, not a separate list.
 */
export function PitcherTable({
  title,
  rows,
  ramps,
  period,
  held,
  activated,
  sort,
  onSort,
  onAdd,
  onDrop,
  onActivate,
  pendingIds,
  empty,
}: {
  title: string
  rows: PitcherRow[]
  ramps: Ramps
  period: WaiverPeriod
  held: Set<string>
  /** Planned off injured reserve, so the row reads as usable already. */
  activated: Set<string>
  sort: SortKey
  onSort: (key: SortKey) => void
  onAdd: (playerId: string) => void
  onDrop: (playerId: string) => void
  onActivate: (playerId: string) => void
  pendingIds: Set<string>
  empty: string
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <h2 className="chyron text-lg">{title}</h2>
        <span className="text-xs text-ink-3">
          {rows.length} pitching in {period.label}
        </span>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="chyron text-ink-3">Sort</span>
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => onSort(key)}
              aria-pressed={sort === key}
              className={`rounded px-2 py-1 ${
                sort === key ? 'bg-good/15 text-good' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="chyron border-b border-line bg-sunk text-left text-sm text-ink-2">
              <th className="px-3 py-2">Pitcher</th>
              <th className="px-2 py-2 text-right">Score</th>
              <th className="px-3 py-2">Matchup</th>
              <th className="px-2 py-2 text-right">30d</th>
              <th className="px-2 py-2 text-right">60d</th>
              <th className="px-2 py-2 text-right">Season</th>
              <th className="px-2 py-2 text-right">ERA</th>
              <th className="px-2 py-2 text-right">WHIP</th>
              <th className="px-2 py-2 text-right">K</th>
              <th className="px-2 py-2 text-right">Own</th>
              <th className="px-3 py-2">Last 6</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pitcher, starts, score }) => (
              <Row
                key={pitcher.player_id}
                pitcher={pitcher}
                starts={starts}
                score={score}
                ramps={ramps}
                held={held.has(pitcher.player_id)}
                activated={activated.has(pitcher.player_id)}
                pending={pendingIds.has(pitcher.player_id)}
                onAdd={onAdd}
                onDrop={onDrop}
                onActivate={onActivate}
              />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="text-sm text-ink-3">{empty}</p>}
    </section>
  )
}

function Row({
  pitcher,
  starts,
  score,
  ramps,
  held,
  activated,
  pending,
  onAdd,
  onDrop,
  onActivate,
}: {
  pitcher: Pitcher
  starts: PitcherRow['starts']
  score: PitcherRow['score']
  ramps: Ramps
  held: boolean
  activated: boolean
  pending: boolean
  onAdd: (playerId: string) => void
  onDrop: (playerId: string) => void
  onActivate: (playerId: string) => void
}) {
  const injured = isInjuredReserve(pitcher.roster_status) && !activated

  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-sunk/50">
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="flex items-baseline gap-2">
            <span className="font-medium">{pitcher.name}</span>
            <span className="text-xs text-ink-3">{pitcher.mlb_team}</span>
          </span>
          <span className="text-xs">
            {injured ? (
              <span className="text-bad">injured reserve</span>
            ) : activated ? (
              <span className="text-free">activated</span>
            ) : held ? (
              <span className="text-mine">on my roster</span>
            ) : (
              <span className="text-free">free agent</span>
            )}
            <span className="ml-2 text-ink-3">
              {starts.length} start{starts.length === 1 ? '' : 's'}
            </span>
          </span>
        </div>
      </td>

      <ScoreCell score={score} ramp={ramps.score} />

      <MatchupCell starts={starts} />

      <StatCell
        value={pitcher.windows?.last30?.per_game}
        games={pitcher.windows?.last30?.games}
        ramp={ramps.last30}
      />
      <StatCell
        value={pitcher.windows?.last60?.per_game}
        games={pitcher.windows?.last60?.games}
        ramp={ramps.last60}
      />
      <StatCell
        value={pitcher.season?.per_game}
        games={pitcher.season?.games}
        ramp={ramps.season}
        hint={`${pitcher.season?.games ?? 0} g`}
      />
      {/* Rate stats rest on the same games the season line does, so they are
          held to the same sample floor — a 12.00 ERA off one start is noise. */}
      <StatCell
        value={numeric(pitcher.stats.ERA)}
        games={pitcher.season?.games}
        ramp={ramps.era}
        digits={2}
      />
      <StatCell
        value={numeric(pitcher.stats.WHIP)}
        games={pitcher.season?.games}
        ramp={ramps.whip}
        digits={2}
      />

      <td className="num px-2 py-2 text-right text-ink-2">
        {pitcher.stats.K ?? '—'}
      </td>
      <td className="num px-2 py-2 text-right text-ink-3">
        {pitcher.rostered_pct ?? '—'}
      </td>
      <td className="px-3 py-2">
        <Sparkline games={pitcher.recent_games} />
      </td>

      <td className="px-3 py-2 text-right whitespace-nowrap">
        {injured ? (
          <Action label="Activate" tone="free" onClick={() => onActivate(pitcher.player_id)} />
        ) : held ? (
          <Action label="Drop" tone="bad" onClick={() => onDrop(pitcher.player_id)} />
        ) : (
          <Action label="Add" tone="good" onClick={() => onAdd(pitcher.player_id)} />
        )}
        {pending && <span className="ml-2 text-xs text-free">planned</span>}
      </td>
    </tr>
  )
}

function Action({
  label,
  tone,
  onClick,
}: {
  label: string
  tone: 'good' | 'bad' | 'free'
  onClick: () => void
}) {
  const hover = {
    good: 'hover:border-good hover:text-good',
    bad: 'hover:border-bad hover:text-bad',
    free: 'hover:border-free hover:text-free',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border border-line px-2 py-1 text-xs text-ink-2 ${hover}`}
    >
      {label}
    </button>
  )
}
