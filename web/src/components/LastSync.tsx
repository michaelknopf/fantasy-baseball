import { useEffect, useState } from 'react'
import { formatSync, isStale, syncAge } from '@/lib/sync'

/**
 * When the board was last collected.
 *
 * The data is baked in at publish time, so a reader has no other way to tell
 * whether they are looking at this morning's numbers or last week's. The age
 * re-renders on a timer: on a tab left open, a fixed string would keep claiming
 * the sync was recent long after it stopped being true.
 */
export function LastSync({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const absolute = formatSync(iso)
  if (absolute === null) return null

  const age = syncAge(iso, now)
  const stale = isStale(iso, now)

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-3">
      <span>
        synced <span className="num">{absolute}</span>
      </span>
      {age && (
        <span className={stale ? 'chyron text-[0.7rem] text-bad' : 'text-ink-3'}>
          {stale ? `${age} · may be out of date` : age}
        </span>
      )}
    </span>
  )
}
