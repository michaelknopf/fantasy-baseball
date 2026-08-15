import { sideLabel } from '@/lib/bracket'
import type { PlayoffBracket, PlayoffMatchup, PlayoffSide } from '@/lib/types'

/**
 * The bracket as a tree, so who plays whom next is visible.
 *
 * The scored cards below stack each round independently, which shows standings
 * but not structure — a mis-wired pairing looks identical to a correct one. This
 * draws the advancement paths instead, and is deliberately score-free: it answers
 * "who do I play next", and the cards answer "who is winning".
 */
export function BracketMap({ bracket }: { bracket: PlayoffBracket }) {
  // Byes are structure, not contests; the seed reappears in the round it feeds.
  const rounds = bracket.rounds.map((round) => ({
    ...round,
    matchups: round.matchups.filter((m) => !m.is_bye),
  }))

  if (rounds.every((r) => r.matchups.length === 0)) return null

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3 pb-1">
        {rounds.map((round) => (
          <div key={round.label} className="flex min-w-[11rem] flex-1 flex-col gap-2">
            <div className="chyron truncate text-[0.6rem] text-ink-3">
              {round.label}
            </div>
            <div className="flex flex-1 flex-col justify-around gap-2">
              {round.matchups.map((matchup, index) => (
                <Pairing key={`${round.label}-${index}`} matchup={matchup} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One matchup: two stacked names, the leader marked. */
function Pairing({ matchup }: { matchup: PlayoffMatchup }) {
  return (
    <div className="overflow-hidden rounded border border-line bg-panel">
      <Slot side={matchup.a} leader={matchup.leader} />
      <div className="h-px bg-line" />
      <Slot side={matchup.b} leader={matchup.leader} />
    </div>
  )
}

function Slot({ side, leader }: { side: PlayoffSide; leader: string | null }) {
  const leading = leader !== null && side.team !== null && leader === side.team
  const pending = side.team === null

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      {side.seed !== null && (
        <span className="num shrink-0 text-[0.6rem] text-ink-3">{side.seed}</span>
      )}
      <span
        className={`truncate text-xs ${
          pending
            ? 'text-ink-3 italic'
            : leading
              ? 'font-semibold text-good'
              : 'text-ink-2'
        }`}
        title={sideLabel(side)}
      >
        {sideLabel(side)}
      </span>
    </div>
  )
}
