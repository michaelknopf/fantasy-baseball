import { useState } from 'react'
import type { CandidateGroup, DropCandidate } from '@/lib/roster'

/**
 * Names the player a move gives up, before the move is allowed to land.
 *
 * The roster is full, so this is not a confirmation step — it is the other half
 * of the transaction. It blocks rather than warns because a plan that quietly
 * exceeded 27 spots would be a plan you cannot execute.
 */
export function DropPicker({
  title,
  groups,
  onPick,
  onCancel,
}: {
  title: string
  groups: CandidateGroup[]
  onPick: (playerId: string) => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ground/80 p-6">
      <div className="w-full max-w-3xl rounded border border-line bg-panel">
        <header className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex flex-col">
            <h2 className="chyron text-lg">{title}</h2>
            <p className="text-xs text-ink-3">
              Your roster is full, so this move has to give a spot back.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-ink-3 underline hover:text-ink"
          >
            Cancel
          </button>
        </header>

        <div className="flex flex-col">
          {groups.map((group) => (
            <Group key={group.role} group={group} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Group({
  group,
  onPick,
}: {
  group: CandidateGroup
  onPick: (playerId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const collapsed = group.collapsible && !expanded
  const shown = collapsed ? group.candidates.slice(0, 3) : group.candidates

  return (
    <section className="border-b border-line last:border-0">
      <h3 className="chyron px-5 pt-4 pb-2 text-xs text-ink-3">
        {group.label}
        <span className="ml-2 normal-case tracking-normal">
          ({group.candidates.length})
        </span>
      </h3>
      <ul className="flex flex-col">
        {shown.map((c) => (
          <li key={c.playerId}>
            <button
              type="button"
              onClick={() => onPick(c.playerId)}
              className="flex w-full items-baseline gap-3 px-5 py-2 text-left text-sm hover:bg-sunk"
            >
              <span className="w-44 shrink-0">
                {c.name}
                <span className="ml-2 text-xs text-ink-3">{c.mlbTeam}</span>
              </span>
              <span className="num w-20 shrink-0 text-right">
                {c.perGame === null ? '—' : c.perGame.toFixed(2)}
              </span>
              <span className="w-24 shrink-0 text-xs text-ink-3">
                {c.perGame === null ? `${c.games} games` : 'per game'}
              </span>
              <Forfeit count={c.forfeits} />
              {c.injured && (
                <span className="ml-auto text-xs text-bad">injured reserve</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {collapsed && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-5 pb-4 text-xs text-ink-3 underline hover:text-ink"
        >
          Show all {group.candidates.length}
        </button>
      )}
    </section>
  )
}

function Forfeit({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-ink-3">no starts lost</span>
  return (
    <span className="text-xs text-bad">
      forfeits {count} start{count === 1 ? '' : 's'}
    </span>
  )
}

export type { DropCandidate }
