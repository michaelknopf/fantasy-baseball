import { useState } from 'react'
import boardData from '@/data/board.json'
import { PlayoffBoard } from '@/pages/PlayoffBoard'
import { StreamingBoard } from '@/pages/StreamingBoard'
import type { Board } from '@/lib/types'

const board = boardData as Board

const PAGES = [
  { key: 'streaming', label: 'Streaming', title: 'Streaming board' },
  { key: 'playoffs', label: 'Playoffs', title: 'Playoff board' },
] as const

type PageKey = (typeof PAGES)[number]['key']

/** The shell: which page is showing, and the furniture both of them share. */
export function App() {
  const [page, setPage] = useState<PageKey>('streaming')
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0]

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="chyron text-3xl">{current.title}</h1>
          <span className="text-sm text-ink-3">snapshot {board.generated_at}</span>
        </div>
        <nav className="flex gap-1" role="tablist" aria-label="Page">
          {PAGES.map((option) => (
            <button
              key={option.key}
              role="tab"
              aria-selected={option.key === page}
              onClick={() => setPage(option.key)}
              className={`chyron rounded px-3 py-1 text-sm ${
                option.key === page
                  ? 'bg-good/15 text-good'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </nav>
      </header>

      {page === 'streaming' ? <StreamingBoard /> : <PlayoffBoard />}
    </div>
  )
}
