import { useState } from 'react'
import { BracketMap } from '@/components/BracketMap'
import { RoundSection } from '@/components/RoundSection'
import boardData from '@/data/board.json'
import type { Board } from '@/lib/types'

const board = boardData as Board
const brackets = board.playoffs ?? []

/**
 * The playoff bracket, replacing the spreadsheet the league kept by hand.
 *
 * Fantrax serves no bracket, so the pairings come from `playoffs.yaml`; the
 * scores are live from the latest collect.
 */
export function PlayoffBoard() {
  const [bracketKey, setBracketKey] = useState(brackets[0]?.key ?? '')
  const bracket =
    brackets.find((b) => b.key === bracketKey) ?? brackets[0]

  if (!bracket) {
    return (
      <p className="text-sm text-ink-3">
        No bracket configured. Add one to <span className="num">playoffs.yaml</span>.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {brackets.length > 1 && (
        <div className="flex gap-1" role="tablist" aria-label="Bracket">
          {brackets.map((option) => (
            <button
              key={option.key}
              role="tab"
              aria-selected={option.key === bracket.key}
              onClick={() => setBracketKey(option.key)}
              className={`chyron rounded px-3 py-1 text-sm ${
                option.key === bracket.key
                  ? 'bg-good/15 text-good'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <BracketMap bracket={bracket} />

      {bracket.rounds.map((round) => (
        <RoundSection key={round.label} round={round} today={board.generated_at} />
      ))}
    </div>
  )
}
