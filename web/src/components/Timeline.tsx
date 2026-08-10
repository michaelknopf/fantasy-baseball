import { affordableStarters, burnWith } from '@/lib/burn'
import type { Burn } from '@/lib/burn'
import type { PeriodPlan } from '@/lib/simulate'

/**
 * The whole playoff run against the start cap.
 *
 * The period rail answers "what do I do Monday"; this answers "do I have enough
 * starts to get to the final at all". Scheduled starts only run a week out, so
 * the bar past that horizon is the rotation's own burn rate — carrying eight
 * arms costs about 58 starts whether or not anyone has posted a probable.
 */
export function Timeline({
  plans,
  burn,
  finalOn,
  selected,
  onSelect,
}: {
  plans: PeriodPlan[]
  burn: Burn
  finalOn: string
  selected: string
  onSelect: (startsOn: string) => void
}) {
  const cap = plans[0]?.capRemaining !== null ? capOf(plans) : null
  const scheduled = plans.reduce((sum, p) => sum + p.startsUsed, 0)
  const horizon = plans.filter((p) => p.period.free_agents_known).length

  return (
    <section className="flex flex-col gap-4 rounded border border-line bg-panel p-5">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="chyron text-lg">Season</h2>
        <span className="text-sm text-ink-3">
          {burn.days} days to the final on {pretty(finalOn)}
        </span>
      </header>

      <CapBar burn={burn} cap={cap} scheduled={scheduled} />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {plans.map((plan, i) => (
          <PeriodTick
            key={plan.period.starts_on}
            plan={plan}
            first={i === 0}
            beyondHorizon={i >= horizon}
            open={plan.period.starts_on === selected}
            onSelect={() => onSelect(plan.period.starts_on)}
          />
        ))}
        <BeyondTick
          burn={burn}
          scheduled={scheduled}
          after={plans[plans.length - 1]?.period.ends_on ?? finalOn}
        />
      </div>
    </section>
  )
}

/**
 * The cap as one bar: what the rotation costs, and what is left to stream with.
 *
 * Shown against the rotation's burn rather than the scheduled starts, because
 * the scheduled figure only covers the next two weeks and would read as though
 * there were fifty starts spare.
 */
function CapBar({
  burn,
  cap,
  scheduled,
}: {
  burn: Burn
  cap: number | null
  scheduled: number
}) {
  if (cap === null) {
    return <p className="text-sm text-ink-3">This league does not cap starts.</p>
  }

  const over = burn.capRemaining !== null && burn.capRemaining < 0
  const used = Math.min(burn.projected, cap)
  const rotationPct = (used / cap) * 100
  const scheduledPct = (Math.min(scheduled, cap) / cap) * 100

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Figure
          label="Starts left"
          value={String(cap)}
          hint="to spend before the final"
        />
        <Figure
          label="Rotation burns"
          value={String(burn.projected)}
          hint={`${burn.starters} starters × ${burn.startsPerStarter} turns`}
        />
        <Figure
          label={over ? 'Over cap' : 'Free to stream'}
          value={
            burn.capRemaining === null
              ? '—'
              : String(Math.abs(burn.capRemaining))
          }
          hint={over ? 'must sit my own arms' : 'extra starts to claim with'}
          tone={over ? 'text-bad' : 'text-good'}
        />
        <Figure
          label="Room for"
          value={String(affordableStarters(burn, cap) ?? '—')}
          hint="starters at this pace"
        />
      </div>

      <div>
        <div className="relative h-6 w-full overflow-hidden rounded bg-sunk">
          <div
            className="absolute inset-y-0 left-0 bg-mine/30"
            style={{ width: `${rotationPct}%` }}
            title={`${burn.projected} starts from the rotation I already hold`}
          />
          <div
            className="absolute inset-y-0 left-0 bg-good/50"
            style={{ width: `${scheduledPct}%` }}
            title={`${scheduled} starts already on the schedule`}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
          <Key className="bg-good/50" label={`${scheduled} scheduled`} />
          <Key
            className="bg-mine/30"
            label={`${burn.projected} projected, if I never stream`}
          />
          <Key className="bg-sunk" label={`${Math.max(cap - burn.projected, 0)} spare`} />
        </div>
      </div>

      {burn.shelved > 0 && (
        <p className="text-xs text-ink-3">
          {burn.shelved} more starter{burn.shelved === 1 ? '' : 's'} on injured
          reserve — activating {burn.shelved === 1 ? 'him' : 'them'} costs{' '}
          {burnWith(burn, burn.starters + burn.shelved) - burn.projected} further
          starts.
        </p>
      )}
    </div>
  )
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  )
}

/**
 * One waiver period, sized by the starts it actually holds.
 *
 * Past the probable-start horizon the count covers only pitchers we already
 * hold, so it is dimmed rather than captioned — a caption on every tick repeats
 * itself five times to say what the dimming says once.
 */
function PeriodTick({
  plan,
  first,
  beyondHorizon,
  open,
  onSelect,
}: {
  plan: PeriodPlan
  first: boolean
  beyondHorizon: boolean
  open: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={open}
      title={
        beyondHorizon
          ? 'Past the probable-start horizon — counts only pitchers I already hold'
          : undefined
      }
      className={`flex min-w-[5.5rem] flex-1 flex-col gap-1 rounded border px-3 py-2 text-left transition ${
        open
          ? 'border-good bg-sunk'
          : 'border-line bg-ground hover:border-ink-3'
      }`}
    >
      <span className="chyron text-xs text-ink-3">
        {plan.period.label}
        {first && ' · now'}
      </span>
      <span
        className={`num text-xl ${
          plan.startsUsed === 0 || beyondHorizon ? 'text-ink-3' : ''
        }`}
      >
        {plan.startsUsed}
      </span>
    </button>
  )
}

/**
 * Everything past the last waiver period we model, as one block.
 *
 * Deliberately estimated rather than counted: the periods to its left stop
 * about two weeks out, and most of the playoff run happens after them. Marked
 * `≈` and dashed so it never reads as another period with a real number in it.
 */
function BeyondTick({
  burn,
  scheduled,
  after,
}: {
  burn: Burn
  scheduled: number
  after: string
}) {
  const remaining = Math.max(burn.projected - scheduled, 0)
  return (
    <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded border border-dashed border-line px-3 py-2">
      <span className="chyron text-xs text-ink-3">After {pretty(after)}</span>
      <span className="num text-xl text-ink-3">≈{remaining}</span>
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
      <span className={`num text-3xl ${tone ?? ''}`}>{value}</span>
      <span className="text-xs text-ink-3">{hint}</span>
    </div>
  )
}

function capOf(plans: PeriodPlan[]): number | null {
  const first = plans[0]
  if (!first || first.capRemaining === null) return null
  return first.capRemaining + first.startsUsed
}

function pretty(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${Number(month)}/${Number(day)}`
}
