import { describe, expect, it } from 'vitest'
import { formatSync, isStale, syncAge } from './sync'

describe('formatSync', () => {
  it('states the time in the league zone and names it', () => {
    // 10:35 PM Pacific on Aug 19, written with its offset.
    expect(formatSync('2026-08-19T22:35:05-07:00')).toBe('Aug 19, 10:35 PM PDT')
  })

  it('shows the league zone even for a reader elsewhere', () => {
    // 06:00 UTC is the previous evening in California, which is the day the
    // board's rounds actually turned on.
    expect(formatSync('2026-08-20T06:00:00Z')).toBe('Aug 19, 11:00 PM PDT')
  })

  it('reads a pre-zone timestamp as league-local, not UTC', () => {
    // Written before the collector stamped an offset; taken at face value as
    // UTC it would read as 3:35 PM, seven hours off.
    expect(formatSync('2026-08-19T22:35:05.505075')).toBe('Aug 19, 10:35 PM PDT')
  })

  it('uses standard time for a winter timestamp', () => {
    // A fixed -07:00 fallback would put this an hour late and label it PDT.
    expect(formatSync('2026-01-15T20:00:00')).toBe('Jan 15, 8:00 PM PST')
  })

  it('has nothing to say about an unparseable stamp', () => {
    expect(formatSync('')).toBeNull()
    expect(formatSync('not a date')).toBeNull()
  })
})

describe('syncAge', () => {
  const at = '2026-08-19T22:35:00-07:00'

  it('stays quiet while the data is fresh', () => {
    expect(syncAge(at, new Date('2026-08-19T23:30:00-07:00'))).toBeNull()
  })

  it('counts hours once it has been a while', () => {
    expect(syncAge(at, new Date('2026-08-20T03:35:00-07:00'))).toBe('5 hours ago')
  })

  it('counts a full elapsed day as one', () => {
    expect(syncAge(at, new Date('2026-08-20T23:35:00-07:00'))).toBe('1 day ago')
  })

  it('counts elapsed days, not calendar ones', () => {
    // ~40 hours: two calendar days back, but only one full day elapsed.
    expect(syncAge(at, new Date('2026-08-21T14:22:00-07:00'))).toBe('1 day ago')
  })

  it('does not report a future sync as an age', () => {
    expect(syncAge(at, new Date('2026-08-19T20:00:00-07:00'))).toBeNull()
  })
})

describe('isStale', () => {
  const at = '2026-08-19T22:35:00-07:00'

  it('is not stale within a day', () => {
    expect(isStale(at, new Date('2026-08-20T18:00:00-07:00'))).toBe(false)
  })

  it('is stale once a full day has passed', () => {
    expect(isStale(at, new Date('2026-08-20T22:35:00-07:00'))).toBe(true)
  })
})
