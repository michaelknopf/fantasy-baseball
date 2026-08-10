import type { LedgerEntry } from '@/lib/roster'
import type { Move } from '@/lib/simulate'

const VERB: Record<Move['action'], string> = {
  add: 'add',
  drop: 'drop',
  activate: 'activate',
}

const TONE: Record<Move['action'], string> = {
  add: 'text-good',
  drop: 'text-bad',
  activate: 'text-free',
}

/**
 * The plan so far, in the order the waiver runs apply it.
 *
 * A move that stops being legal — because the drop paying for it was undone —
 * is struck through and given its reason rather than removed, so the plan does
 * not silently lose a decision you made.
 */
export function MoveLedger({
  entries,
  nameOf,
  periodLabel,
  onUndo,
  onClear,
}: {
  entries: LedgerEntry[]
  nameOf: (playerId: string) => string
  periodLabel: (startsOn: string) => string
  onUndo: (move: Move) => void
  onClear: () => void
}) {
  if (entries.length === 0) return null

  return (
    <section className="flex flex-col gap-2 rounded border border-line bg-panel px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 className="chyron text-xs text-ink-3">Planned moves</h2>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-ink-3 underline hover:text-ink"
        >
          Clear all
        </button>
      </div>

      <ol className="flex flex-col gap-1">
        {entries.map(({ move, blocked }) => (
          <li
            key={`${move.period}-${move.action}-${move.playerId}`}
            className="flex flex-wrap items-baseline gap-2 text-sm"
          >
            <span className="num w-20 shrink-0 text-xs text-ink-3">
              {periodLabel(move.period)}
            </span>
            <span className={`w-16 shrink-0 ${TONE[move.action]}`}>
              {VERB[move.action]}
            </span>
            <span className={blocked ? 'text-ink-3 line-through' : ''}>
              {nameOf(move.playerId)}
            </span>
            {blocked && (
              <span className="text-xs text-bad">{blocked.message}</span>
            )}
            <button
              type="button"
              aria-label={`Undo ${VERB[move.action]} ${nameOf(move.playerId)}`}
              onClick={() => onUndo(move)}
              className="ml-auto text-ink-3 hover:text-ink"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
