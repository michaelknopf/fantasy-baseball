import { useMemo, useState } from 'react'
import { DropPicker } from '@/components/DropPicker'
import { MoveLedger } from '@/components/MoveLedger'
import { PeriodRail } from '@/components/PeriodRail'
import { PitcherTable } from '@/components/PitcherTable'
import { Timeline } from '@/components/Timeline'
import boardData from '@/data/board.json'
import { burn as projectBurn } from '@/lib/burn'
import { pitcherRows, ramps as buildRamps } from '@/lib/rows'
import type { SortKey } from '@/lib/rows'
import {
  blockedReason,
  dropCandidates,
  rosterStateDuring,
  validateLedger,
} from '@/lib/roster'
import { activatedBy, rosterDuring, simulate } from '@/lib/simulate'
import type { Move } from '@/lib/simulate'
import type { Board } from '@/lib/types'

const board = boardData as Board
const ramps = buildRamps(board)

/**
 * The last day of our playoff run.
 *
 * Fantrax reports the start cap but never the date it has to last until, and
 * every projection scales with it — so it lives here, as the one number the
 * league office told us and the API did not.
 */
const FINAL_ON = '2026-09-20'

const burn = projectBurn(board, FINAL_ON)

/** A move waiting on a drop to pay for it. */
interface Pending {
  action: 'add' | 'activate'
  playerId: string
}

export function App() {
  const [moves, setMoves] = useState<Move[]>([])
  const [periodIndex, setPeriodIndex] = useState(0)
  const [sort, setSort] = useState<SortKey>('last30')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)

  const period = board.periods[periodIndex] ?? board.periods[0]!
  const plans = useMemo(() => simulate(board, moves), [moves])
  const held = useMemo(() => rosterDuring(board, moves, period), [moves, period])
  const activated = useMemo(() => activatedBy(moves, period), [moves, period])
  const state = useMemo(
    () => rosterStateDuring(board, moves, period),
    [moves, period],
  )
  const ledger = useMemo(() => validateLedger(board, moves), [moves])

  const mine = useMemo(
    () => pitcherRows(board, period, { ownership: 'mine', sort }),
    [period, sort],
  )
  const pool = useMemo(
    () => pitcherRows(board, period, { ownership: 'free_agent', sort, query }),
    [period, sort, query],
  )

  const record = (move: Move) =>
    setMoves((current) => [
      // One decision per player per period; a new one replaces the old.
      ...current.filter(
        (m) => !(m.playerId === move.playerId && m.period === move.period),
      ),
      move,
    ])

  /** An add or activation only lands once a drop has paid for it. */
  const request = (action: Pending['action']) => (playerId: string) => {
    if (blockedReason(state, action)) {
      setPending({ action, playerId })
      return
    }
    record({ period: period.starts_on, action, playerId })
  }

  const payWith = (droppedId: string) => {
    if (!pending) return
    setMoves((current) => [
      ...current.filter(
        (m) =>
          !(
            (m.playerId === droppedId || m.playerId === pending.playerId) &&
            m.period === period.starts_on
          ),
      ),
      { period: period.starts_on, action: 'drop', playerId: droppedId },
      {
        period: period.starts_on,
        action: pending.action,
        playerId: pending.playerId,
        pairedWith: droppedId,
      },
    ])
    setPending(null)
  }

  const pendingIds = new Set(
    moves.filter((m) => m.period === period.starts_on).map((m) => m.playerId),
  )

  const selectPeriod = (startsOn: string) =>
    setPeriodIndex(board.periods.findIndex((p) => p.starts_on === startsOn))

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-6 py-8">
      <Header />

      <Timeline
        plans={plans}
        burn={burn}
        finalOn={FINAL_ON}
        selected={period.starts_on}
        onSelect={selectPeriod}
      />

      <PeriodRail
        plans={plans}
        selected={period}
        onSelect={(p) => selectPeriod(p.starts_on)}
      />

      <MoveLedger
        entries={ledger}
        nameOf={nameOf}
        periodLabel={periodLabel}
        onUndo={(move) => setMoves((c) => c.filter((m) => m !== move))}
        onClear={() => setMoves([])}
      />

      <PitcherTable
        title="My rotation"
        rows={mine}
        ramps={ramps}
        period={period}
        held={held}
        activated={activated}
        sort={sort}
        onSort={setSort}
        onAdd={request('add')}
        onDrop={(id) => record({ period: period.starts_on, action: 'drop', playerId: id })}
        onActivate={request('activate')}
        pendingIds={pendingIds}
        empty="None of my pitchers start in this period."
      />

      <div className="flex flex-col gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a pitcher"
          className="w-64 rounded border border-line bg-sunk px-3 py-1.5 text-sm outline-none focus:border-good"
        />
        <PitcherTable
          title="Available to claim"
          rows={pool}
          ramps={ramps}
          period={period}
          held={held}
          activated={activated}
          sort={sort}
          onSort={setSort}
          onAdd={request('add')}
          onDrop={(id) =>
            record({ period: period.starts_on, action: 'drop', playerId: id })
          }
          onActivate={request('activate')}
          pendingIds={pendingIds}
          empty={
            period.free_agents_known
              ? 'Nobody matches. Clear the search to see the pool.'
              : 'This period runs past the probable-start horizon, so the pool is not known yet.'
          }
        />
      </div>

      {pending && (
        <DropPicker
          title={`${pending.action === 'add' ? 'Adding' : 'Activating'} ${nameOf(pending.playerId)} — who comes off?`}
          groups={dropCandidates(board, state, period)}
          onPick={payWith}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}

function Header() {
  const rival = board.rivals.find((r) => !r.is_mine)
  const edge =
    board.starts_remaining !== null && rival?.starts_remaining
      ? board.starts_remaining - rival.starts_remaining
      : null

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="chyron text-3xl">Streaming board</h1>
        <span className="text-sm text-ink-3">
          snapshot {board.generated_at} · probable starts through{' '}
          {board.collected_through}
        </span>
      </div>
      <dl className="flex flex-wrap gap-8">
        <Figure
          label="Best rival"
          value={String(rival?.starts_remaining ?? '—')}
          hint={`starts left · ${rival?.team ?? ''}`}
        />
        <Figure
          label="My edge"
          value={edge === null ? '—' : `+${edge}`}
          hint="starts over the field"
          tone="text-good"
        />
        <Figure
          label="Waiver budget"
          value={board.claim_budget === null ? '—' : `$${board.claim_budget.toFixed(0)}`}
          hint="to spend on claims"
        />
        <Figure
          label="Roster"
          value={
            board.slots
              ? `${board.slots.active + board.slots.reserve}/${board.slots.active + board.slots.reserve}`
              : '—'
          }
          hint={`full · ${board.slots?.injured_reserve ?? 0} on IR`}
        />
      </dl>
    </header>
  )
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone?: string
}) {
  return (
    <div className="flex flex-col">
      <dt className="chyron text-xs text-ink-3">{label}</dt>
      <dd className={`num text-3xl ${tone ?? ''}`}>{value}</dd>
      <dd className="text-xs text-ink-3">{hint}</dd>
    </div>
  )
}

function nameOf(playerId: string): string {
  return (
    board.pitchers.find((p) => p.player_id === playerId)?.name ??
    board.roster.find((e) => e.player_id === playerId)?.name ??
    playerId
  )
}

function periodLabel(startsOn: string): string {
  return board.periods.find((p) => p.starts_on === startsOn)?.label ?? startsOn
}
