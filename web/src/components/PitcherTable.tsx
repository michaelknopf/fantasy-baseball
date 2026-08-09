import { useMemo, useState } from 'react'
import { expectedPoints, formBasis } from '@/lib/simulate'
import type { Move } from '@/lib/simulate'
import type { Board, Pitcher, WaiverPeriod } from '@/lib/types'

type SortKey = 'form' | 'season' | 'name' | 'next'

/**
 * Everyone who could start for us: our own arms and every claimable free agent,
 * in one list so they compare directly. Ownership is a column, not a separate
 * table — the question is always "who should hold this slot", and splitting the
 * two apart is what makes that hard to answer.
 */
export function PitcherTable({
  board,
  period,
  moves,
  heldNow,
  onAdd,
  onDrop,
}: {
  board: Board
  period: WaiverPeriod
  moves: Move[]
  heldNow: Set<string>
  onAdd: (playerId: string) => void
  onDrop: (playerId: string) => void
}) {
  const [sort, setSort] = useState<SortKey>('form')
  const [query, setQuery] = useState('')
  const [onlyStarting, setOnlyStarting] = useState(true)

  const rows = useMemo(() => {
    const startsInPeriod = (p: Pitcher) =>
      p.starts.filter(
        (s) => s.date >= period.starts_on && s.date <= period.ends_on,
      )

    return board.pitchers
      .filter((p) => {
        if (query && !p.name.toLowerCase().includes(query.toLowerCase()))
          return false
        if (onlyStarting && startsInPeriod(p).length === 0) return false
        return true
      })
      .map((p) => ({
        pitcher: p,
        periodStarts: startsInPeriod(p),
        form: expectedPoints(p),
      }))
      .sort((a, b) => {
        if (sort === 'name') return a.pitcher.name.localeCompare(b.pitcher.name)
        if (sort === 'season')
          return (b.pitcher.season?.per_game ?? 0) - (a.pitcher.season?.per_game ?? 0)
        if (sort === 'next')
          return (a.periodStarts[0]?.date ?? '9').localeCompare(
            b.periodStarts[0]?.date ?? '9',
          )
        return b.form - a.form
      })
  }, [board.pitchers, period, sort, query, onlyStarting])

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Who can start</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a pitcher"
          className="rounded border border-line bg-sunk px-2 py-1 text-sm outline-none focus:border-free"
        />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={onlyStarting}
            onChange={(e) => setOnlyStarting(e.target.checked)}
          />
          Only pitchers starting in {period.label}
        </label>
        <div className="ml-auto flex items-center gap-1 text-sm">
          <span className="text-ink-3">Sort</span>
          {(['form', 'season', 'next', 'name'] as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`rounded px-2 py-1 ${
                sort === key
                  ? 'bg-free/20 text-free'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              {key === 'form'
                ? 'Recent form'
                : key === 'season'
                  ? 'Season'
                  : key === 'next'
                    ? 'Start date'
                    : 'Name'}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-sunk text-left text-xs text-ink-2">
              <th className="px-3 py-2 font-medium">Pitcher</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">
                Starts in {period.label}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Recent form
                <span className="block text-[10px] text-ink-3">
                  points per start
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Season
                <span className="block text-[10px] text-ink-3">
                  points per start
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">ERA</th>
              <th className="px-3 py-2 text-right font-medium">
                Owned
                <span className="block text-[10px] text-ink-3">
                  other leagues
                </span>
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pitcher, periodStarts, form }) => {
              const held = heldNow.has(pitcher.player_id)
              const pending = moves.some(
                (m) => m.playerId === pitcher.player_id,
              )
              return (
                <tr
                  key={pitcher.player_id}
                  className="border-b border-line/60 last:border-0 hover:bg-sunk/60"
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{pitcher.name}</span>
                    <span className="ml-2 text-xs text-ink-3">
                      {pitcher.mlb_team}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <OwnershipChip pitcher={pitcher} held={held} />
                  </td>
                  <td className="px-3 py-2">
                    {periodStarts.length === 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {periodStarts.map((s) => (
                          <span key={s.date} className="tnum text-xs">
                            {s.label}{' '}
                            <span className="text-ink-2">
                              {s.is_away ? '@' : 'vs '}
                              {s.opponent}
                            </span>
                            {s.opposing_pitcher && (
                              <span className="text-ink-3">
                                {' '}
                                · opp {s.opposing_pitcher}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {form.toFixed(1)}
                    <span className="block text-[10px] text-ink-3">
                      {formBasis(pitcher)}
                    </span>
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {pitcher.season ? pitcher.season.per_game.toFixed(1) : '—'}
                    <span className="block text-[10px] text-ink-3">
                      {pitcher.season?.games ?? 0} starts
                    </span>
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {pitcher.stats.ERA ?? '—'}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-ink-2">
                    {pitcher.stats.Ros ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {held ? (
                      <button
                        type="button"
                        onClick={() => onDrop(pitcher.player_id)}
                        className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:border-bad hover:text-bad"
                      >
                        Drop
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAdd(pitcher.player_id)}
                        className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:border-good hover:text-good"
                      >
                        Add
                      </button>
                    )}
                    {pending && (
                      <span className="ml-2 text-[10px] text-free">planned</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-ink-2">
          No pitchers match. Clear the search, or untick the filter to see
          everyone.
        </p>
      )}
    </section>
  )
}

function OwnershipChip({
  pitcher,
  held,
}: {
  pitcher: Pitcher
  held: boolean
}) {
  if (pitcher.roster_status === 'injured_reserve') {
    return (
      <span className="rounded bg-bad/15 px-2 py-0.5 text-xs text-bad">
        injured reserve
      </span>
    )
  }
  if (held) {
    return (
      <span className="rounded bg-mine/15 px-2 py-0.5 text-xs text-mine">
        {pitcher.ownership === 'mine'
          ? (pitcher.roster_status ?? 'on my roster')
          : 'added'}
      </span>
    )
  }
  return (
    <span className="rounded bg-free/15 px-2 py-0.5 text-xs text-free">
      free agent
    </span>
  )
}
