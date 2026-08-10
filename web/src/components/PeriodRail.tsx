import type { PeriodPlan } from '@/lib/simulate'
import { isInjuredReserve } from '@/lib/types'
import type { WaiverPeriod } from '@/lib/types'

/** Periods you can actually claim into. Anything further out is guesswork. */
const SHOWN = 2

/**
 * The two waiver periods you can act on, one of them open.
 *
 * Only two, because free-agent starts are collected through the second period
 * and no further — a third would show our own rotation against an empty pool
 * and read as "nobody is available". The open one is what the table filters to,
 * so a move is always made against a period rather than in the abstract.
 */
export function PeriodRail({
  plans,
  selected,
  onSelect,
}: {
  plans: PeriodPlan[]
  selected: WaiverPeriod
  onSelect: (period: WaiverPeriod) => void
}) {
  const shown = plans.slice(0, SHOWN)

  return (
    <section className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((plan, i) => (
          <PeriodCard
            key={plan.period.starts_on}
            plan={plan}
            index={i}
            open={plan.period.starts_on === selected.starts_on}
            onSelect={() => onSelect(plan.period)}
          />
        ))}
      </div>
    </section>
  )
}

function PeriodCard({
  plan,
  index,
  open,
  onSelect,
}: {
  plan: PeriodPlan
  index: number
  open: boolean
  onSelect: () => void
}) {
  const over = plan.capRemaining !== null && plan.capRemaining < 0

  return (
    <div
      className={`flex flex-col rounded border transition ${
        open ? 'border-good bg-sunk' : 'border-line bg-panel'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={open}
        className="flex items-baseline justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-baseline gap-3">
          <span className="chyron text-lg">{plan.period.label}</span>
          <span className="text-xs text-ink-3">
            through {plan.period.ends_on.slice(5)}
          </span>
        </span>
        <span
          className={`chyron text-xs ${open ? 'text-good' : 'text-ink-3'}`}
        >
          {open ? 'planning' : 'next up'}
          {index === 0 && !open && ' · now'}
        </span>
      </button>

      <div className="flex gap-6 border-t border-line px-4 py-3">
        <Figure
          label="Starts"
          value={String(plan.startsUsed)}
          hint={`${plan.daysCovered} day${plan.daysCovered === 1 ? '' : 's'}`}
        />
        <Figure
          label="Projected"
          value={plan.projectedPoints.toFixed(0)}
          hint="points"
        />
        <Figure
          label="Cap left"
          value={plan.capRemaining === null ? '—' : String(plan.capRemaining)}
          hint={`${plan.startsUsedCumulative} used`}
          tone={over ? 'text-bad' : undefined}
        />
      </div>

      <ol className="flex flex-col gap-1 border-t border-line px-4 py-3">
        {plan.starts.length === 0 && (
          <li className="text-xs text-ink-3">
            Nobody we hold pitches in this period.
          </li>
        )}
        {plan.starts.map((s) => (
          <li
            key={`${s.pitcher.player_id}-${s.start.date}`}
            className="flex items-baseline gap-2 text-xs"
          >
            <span className="num w-14 shrink-0 text-ink-3">
              {s.start.label}
            </span>
            <span className={s.usable ? '' : 'text-ink-3 line-through'}>
              {s.pitcher.name}
            </span>
            <span className="text-ink-3">
              {s.start.is_away ? '@' : 'vs '}
              {s.start.opponent}
            </span>
            {isInjuredReserve(s.pitcher.roster_status) && (
              <span className="text-bad">injured reserve</span>
            )}
          </li>
        ))}
      </ol>
    </div>
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
      <span className="chyron text-xs text-ink-3">{label}</span>
      <span className={`num text-xl ${tone ?? ''}`}>{value}</span>
      <span className="text-xs text-ink-3">{hint}</span>
    </div>
  )
}
