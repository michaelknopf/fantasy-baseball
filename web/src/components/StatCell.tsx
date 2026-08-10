import { magnitude, magnitudeClass } from '@/lib/magnitude'
import type { Distribution } from '@/lib/magnitude'
import { THIN_SAMPLE } from '@/lib/rows'

/** A number, tinted by where it falls in its own column. */
export function StatCell({
  value,
  ramp,
  digits = 1,
  games,
  hint,
}: {
  value: number | null | undefined
  ramp: Distribution
  digits?: number
  /** Below `THIN_SAMPLE`, the number shows but is left unpainted. */
  games?: number
  hint?: string
}) {
  if (value === null || value === undefined) {
    return <td className="num px-3 py-2 text-right text-ink-3">—</td>
  }

  const thin = games !== undefined && games < THIN_SAMPLE
  const grade = thin ? null : magnitude(value, ramp)

  return (
    <td className="num px-2 py-2 text-right align-middle">
      <span
        className={`inline-block rounded px-1.5 py-0.5 ${magnitudeClass(grade)} ${
          thin ? 'text-ink-3' : ''
        }`}
        title={thin ? `only ${games} games — too few to grade` : undefined}
      >
        {value.toFixed(digits)}
      </span>
      {hint && <span className="block text-xs text-ink-3">{hint}</span>}
    </td>
  )
}
