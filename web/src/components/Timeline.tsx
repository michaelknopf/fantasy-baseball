import type { PeriodPlan } from '@/lib/simulate'
import type { Board, WaiverPeriod } from '@/lib/types'

/**
 * The plan as a run of waiver periods, each showing the starts it produces.
 *
 * Periods are the unit because a claim commits you until the next waiver run:
 * seeing them side by side is what shows a pickup covering one day and then
 * sitting idle, or a week where nobody we hold pitches at all.
 */
export function Timeline({
  board,
  plans,
  selected,
  onSelect,
}: {
  board: Board
  plans: PeriodPlan[]
  selected: WaiverPeriod
  onSelect: (period: WaiverPeriod) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">Projected schedule</h2>
        <span className="text-sm text-ink-2">
          Click a period to plan moves for it
        </span>
      </header>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const isSelected = plan.period.starts_on === selected.starts_on
          const over =
            plan.capRemaining !== null && plan.capRemaining < 0
          return (
            <button
              key={plan.period.starts_on}
              type="button"
              onClick={() => onSelect(plan.period)}
              className={`flex flex-col gap-2 rounded border p-3 text-left transition ${
                isSelected
                  ? 'border-free bg-sunk'
                  : 'border-line bg-panel hover:border-ink-3'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{plan.period.label}</span>
                <span className="text-xs text-ink-3">
                  through {shortDate(plan.period.ends_on)}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <Stat
                  label="starts"
                  value={String(plan.startsUsed)}
                  hint={`${plan.daysCovered} day${plan.daysCovered === 1 ? '' : 's'} covered`}
                />
                <Stat
                  label="projected"
                  value={plan.projectedPoints.toFixed(0)}
                  hint="points"
                />
                <Stat
                  label="cap left"
                  value={
                    plan.capRemaining === null
                      ? '—'
                      : String(plan.capRemaining)
                  }
                  hint={`${plan.startsUsedCumulative} used so far`}
                  tone={over ? 'bad' : undefined}
                />
              </div>

              {!plan.period.free_agents_known && (
                <p className="text-[11px] text-ink-3">
                  Beyond the probable-start horizon — shows only pitchers we
                  hold. Re-collect closer to the date to see who is claimable.
                </p>
              )}

              <ol className="flex flex-col gap-1">
                {plan.starts.length === 0 && (
                  <li className="text-xs text-ink-3">
                    Nobody we hold pitches in this period.
                  </li>
                )}
                {plan.starts.map(({ pitcher, start, usable }) => (
                  <li
                    key={`${pitcher.player_id}-${start.date}`}
                    className="flex items-baseline gap-2 text-xs"
                  >
                    <span className="tnum w-14 shrink-0 text-ink-3">
                      {start.label}
                    </span>
                    <span
                      className={
                        usable ? 'font-medium' : 'text-ink-3 line-through'
                      }
                    >
                      {pitcher.name}
                    </span>
                    <span className="text-ink-2">
                      {start.is_away ? '@' : 'vs '}
                      {start.opponent}
                    </span>
                    {!usable && (
                      <span className="text-bad">injured reserve</span>
                    )}
                  </li>
                ))}
              </ol>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-ink-3">
        Season cap: {board.starts_remaining ?? '—'} starts left of{' '}
        {board.starts_max ?? '—'}. Projected points use each pitcher&rsquo;s
        recent form, falling back to the season rate when he has started fewer
        than three times lately.
      </p>
    </section>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'bad'
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-ink-3">
        {label}
      </span>
      <span
        className={`tnum text-base ${tone === 'bad' ? 'text-bad' : ''}`}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-ink-3">{hint}</span>}
    </span>
  )
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${Number(month)}/${Number(day)}`
}
