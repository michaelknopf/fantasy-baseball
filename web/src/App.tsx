import { useEffect, useState } from 'react'
import { LastSync } from '@/components/LastSync'
import boardData from '@/data/board.json'
import { PlayoffBoard } from '@/pages/PlayoffBoard'
import { StreamingBoard } from '@/pages/StreamingBoard'
import type { Board } from '@/lib/types'

const board = boardData as Board

const PAGES = [
  { key: 'playoffs', label: 'Playoffs', title: 'Playoff board' },
  { key: 'streaming', label: 'Streaming', title: 'Streaming board' },
] as const

type PageKey = (typeof PAGES)[number]['key']

/**
 * The streaming board is a competitive advantage over the rest of the league,
 * so the published site only offers it behind this fragment. That is obscurity,
 * not access control — the bundle still ships the page to everyone.
 */
const PRIVATE_HASH = '#streaming'

function pageFromHash(): PageKey {
  return window.location.hash === PRIVATE_HASH ? 'streaming' : 'playoffs'
}

/** The shell: which page is showing, and the furniture both of them share. */
export function App() {
  const [page, setPage] = useState<PageKey>(pageFromHash)
  // Sticky, unlike `page`: once the fragment has been used the tabs stay up, so
  // switching back to the playoffs does not pull the navigation out from under
  // whoever is using it.
  const [unlocked, setUnlocked] = useState(() => pageFromHash() === 'streaming')
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0]

  useEffect(() => {
    const sync = () => {
      const next = pageFromHash()
      setPage(next)
      if (next === 'streaming') setUnlocked(true)
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="chyron text-3xl">{current.title}</h1>
          <LastSync iso={board.synced_at} />
        </div>
        {unlocked && (
          <nav className="flex gap-1" role="tablist" aria-label="Page">
            {PAGES.map((option) => (
              <button
                key={option.key}
                role="tab"
                aria-selected={option.key === page}
                // Route through the hash so the URL always matches what is on
                // screen, leaving a link worth copying and a working back button.
                onClick={() => {
                  if (option.key === 'streaming') {
                    window.location.hash = PRIVATE_HASH
                  } else {
                    // Assigning '' would leave a bare '#' hanging off the URL.
                    history.replaceState(null, '', window.location.pathname)
                  }
                  setPage(option.key)
                }}
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
        )}
      </header>

      {page === 'streaming' ? <StreamingBoard /> : <PlayoffBoard />}
    </div>
  )
}
