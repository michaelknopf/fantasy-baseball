import { useMemo, useState } from 'react'
import { PitcherTable } from '@/components/PitcherTable'
import { Timeline } from '@/components/Timeline'
import boardData from '@/data/board.json'
import { rosterDuring, simulate } from '@/lib/simulate'
import type { Move } from '@/lib/simulate'
import type { Board, WaiverPeriod } from '@/lib/types'

const board = boardData as Board

export function App() {
  const [moves, setMoves] = useState<Move[]>([])
  const [selected, setSelected] = useState<WaiverPeriod>(
    board.periods[0] ?? {
      starts_on: board.generated_at,
      ends_on: board.generated_at,
      label: 'now',
      free_agents_known: true,
    },
  )

  const plans = useMemo(() => simulate(board, moves), [moves])
  const heldNow = useMemo(
    () => rosterDuring(board, moves, selected),
    [moves, selected],
  )

  const addMove = (action: Move['action']) => (playerId: string) => {
    setMoves((current) => [
      // One decision per pitcher per period; a new one replaces the old.
      ...current.filter(
        (m) => !(m.playerId === playerId && m.period === selected.starts_on),
      ),
      { period: selected.starts_on, action, playerId },
    ])
  }

  const mine = board.pitchers.filter((p) => p.ownership === 'mine')
  const rival = board.rivals.find((r) => !r.is_mine)

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-8 px-6 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Streaming board
          </h1>
          <span className="text-sm text-ink-3">
            snapshot {board.generated_at} · probable starts through{' '}
            {board.collected_through}
          </span>
        </div>
        <dl className="flex flex-wrap gap-6">
          <Headline
            label="My starts left"
            value={String(board.starts_remaining ?? '—')}
            hint={`of ${board.starts_max ?? '—'} season cap`}
          />
          <Headline
            label="Best rival"
            value={String(rival?.starts_remaining ?? '—')}
            hint={rival?.team ?? ''}
          />
          <Headline
            label="Waiver budget"
            value={
              board.claim_budget === null
                ? '—'
                : `$${board.claim_budget.toFixed(0)}`
            }
            hint="to spend on claims"
          />
          <Headline
            label="My starting pitchers"
            value={String(mine.length)}
            hint={`${board.active_pitcher_slots} active slots`}
          />
        </dl>
      </header>

      <Timeline
        board={board}
        plans={plans}
        selected={selected}
        onSelect={setSelected}
      />

      {moves.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 rounded border border-line bg-panel p-3">
          <span className="text-sm text-ink-2">Planned moves</span>
          {moves.map((move) => {
            const pitcher = board.pitchers.find(
              (p) => p.player_id === move.playerId,
            )
            return (
              <span
                key={`${move.period}-${move.playerId}`}
                className="flex items-center gap-2 rounded bg-sunk px-2 py-1 text-xs"
              >
                <span className="text-ink-3">
                  {periodLabel(move.period)}
                </span>
                <span
                  className={
                    move.action === 'add' ? 'text-good' : 'text-bad'
                  }
                >
                  {move.action === 'add' ? 'add' : 'drop'}
                </span>
                <span>{pitcher?.name ?? move.playerId}</span>
                <button
                  type="button"
                  aria-label={`Undo ${move.action} ${pitcher?.name ?? ''}`}
                  onClick={() =>
                    setMoves((current) => current.filter((m) => m !== move))
                  }
                  className="text-ink-3 hover:text-ink"
                >
                  ×
                </button>
              </span>
            )
          })}
          <button
            type="button"
            onClick={() => setMoves([])}
            className="ml-auto text-xs text-ink-3 underline hover:text-ink"
          >
            Clear all
          </button>
        </section>
      )}

      <PitcherTable
        board={board}
        period={selected}
        moves={moves.filter((m) => m.period === selected.starts_on)}
        heldNow={heldNow}
        onAdd={addMove('add')}
        onDrop={addMove('drop')}
      />
    </div>
  )
}

function periodLabel(startsOn: string): string {
  return board.periods.find((p) => p.starts_on === startsOn)?.label ?? startsOn
}

function Headline({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="num text-2xl font-semibold">{value}</dd>
      <dd className="text-xs text-ink-3">{hint}</dd>
    </div>
  )
}
