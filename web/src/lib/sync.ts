/** How the header states when the data was last collected. */

/**
 * The league's zone, not the reader's.
 *
 * Everyone in the league keeps Pacific hours and the rounds turn over on Pacific
 * dates, so a reader elsewhere should still see the time the board actually
 * refers to rather than a shifted one.
 */
const LEAGUE_ZONE = 'America/Los_Angeles'

/** `Aug 19, 10:35 PM PDT` — the zone is named because it is not the reader's. */
export function formatSync(iso: string): string | null {
  const at = parse(iso)
  if (at === null) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: LEAGUE_ZONE,
    timeZoneName: 'short',
  }).format(at)
}

/**
 * `2 days ago`, or null when the sync is recent enough not to be worth flagging.
 *
 * The absolute time answers "when"; this answers "should I trust it", which is
 * the question a reader actually has when the numbers look wrong.
 */
export function syncAge(iso: string, now: Date): string | null {
  const at = parse(iso)
  if (at === null) return null
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (minutes < 0) return null // a clock skew should not read as the future
  if (minutes < 90) return null
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hours ago`
  // Deliberately not "yesterday": a 40-hour-old sync is a day by this count but
  // two calendar days back, and the vaguer word reads as fresher than it is.
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** True once the data is old enough that a reader should be warned. */
export function isStale(iso: string, now: Date): boolean {
  const at = parse(iso)
  if (at === null) return false
  return now.getTime() - at.getTime() >= 24 * 3_600_000
}

/**
 * A timestamp written before the collector became zone-aware carries no offset,
 * which `Date` would read as UTC and misdate by the offset. Those are league-local
 * wall-clock times, so they are shifted by the league's offset *on that date* —
 * a fixed -07:00 would be an hour out for anything collected in winter.
 */
function parse(iso: string): Date | null {
  if (!iso) return null
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) {
    const at = new Date(iso)
    return Number.isNaN(at.getTime()) ? null : at
  }
  const asUtc = new Date(`${iso}Z`)
  if (Number.isNaN(asUtc.getTime())) return null
  return new Date(asUtc.getTime() + leagueOffsetMs(asUtc))
}

/** How far the league's zone sits behind UTC at `at`, in milliseconds. */
function leagueOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEAGUE_ZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(at)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-08:00'
  const [, sign, hh, mm] = /GMT([+-])(\d{2}):(\d{2})/.exec(name) ?? [, '-', '08', '00']
  const ms = (Number(hh) * 60 + Number(mm)) * 60_000
  return sign === '-' ? ms : -ms
}
