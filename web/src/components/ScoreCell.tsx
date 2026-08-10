import { magnitude, magnitudeClass } from '@/lib/magnitude'
import type { Distribution } from '@/lib/magnitude'
import type { Score } from '@/lib/score'

/**
 * The composite score, with the matchup's contribution shown beneath it.
 *
 * The adjustment is spelled out rather than folded in silently: the score is a
 * judgement call about weighting, and a reader deciding a claim on it should be
 * able to see how much of the number came from the draw rather than the arm.
 */
export function ScoreCell({ score, ramp }: { score: Score | null; ramp: Distribution }) {
  if (!score) {
    return (
      <td
        className="num px-2 py-2 text-right text-ink-3"
        title="Too few games to score"
      >
        —
      </td>
    )
  }

  const delta = score.value - score.form
  return (
    <td className="num px-2 py-2 text-right align-middle">
      <span
        className={`inline-block rounded px-1.5 py-0.5 text-base ${magnitudeClass(
          magnitude(score.form, ramp),
        )}`}
        title={`${score.form.toFixed(1)} form, ${
          delta >= 0 ? 'helped' : 'hurt'
        } ${Math.abs(delta).toFixed(1)} by the matchup`}
      >
        {score.value.toFixed(1)}
      </span>
      {/* Named rather than signed: a bare "−1.2" under a number reads as
          arithmetic on it. The word says which way the matchup cut. */}
      <span className="block text-xs text-ink-3">
        {Math.abs(delta) < 0.05 ? (
          'even draw'
        ) : (
          <span className={delta > 0 ? 'text-good' : 'text-bad'}>
            {delta > 0 ? 'soft' : 'tough'} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </span>
    </td>
  )
}
