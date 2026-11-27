/**
 * Where a request stands, worked out from its events and its channel's time, never stored.
 *
 * A request is due its channel's days after it was first requested, plus an extension's days for
 * each extension recorded; a channel with no set time has no due date. Business days skip
 * Saturdays, Sundays and British Columbia's statutory holidays, as FOIPPA's schedule counts a day
 * (no holiday or Saturday); a holiday on a Sunday moves to the Monday. The office's own count
 * decides: this is the planner's reckoning, to know when to follow up.
 *
 * DOM- and network-free.
 */
import type { Channel } from './channels'
import { REQUEST_EVENT_LABELS, type RequestEventStatus, type RequestStatus } from './record'

export type RequestState = RequestEventStatus | 'not-requested'

export interface RequestStanding {
  state: RequestState
  label: string
  requestedOn?: string
  due?: string
  overdue: boolean
  /** The gap is no longer derived: an answer settled it. The status is kept. */
  noLongerNeeded: boolean
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))

/** Easter Sunday (Gregorian), by the anonymous algorithm. */
function easter(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return utc(year, month - 1, day)
}

/** The `n`th given weekday (0 Sunday) of a month. */
const nthWeekday = (year: number, month: number, weekday: number, n: number) => {
  const first = utc(year, month, 1).getUTCDay()
  return utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)
}

/** British Columbia's statutory holidays in a year, each a Sunday's moved to the Monday. */
export function bcHolidays(year: number): Set<string> {
  const e = easter(year)
  const victoria = (() => {
    // The Monday before May 25.
    const d = utc(year, 4, 24)
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1)
    return d
  })()
  const days = [
    utc(year, 0, 1), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Family Day
    utc(year, e.getUTCMonth(), e.getUTCDate() - 2), // Good Friday
    utc(year, e.getUTCMonth(), e.getUTCDate() + 1), // Easter Monday
    victoria, // Victoria Day
    utc(year, 6, 1), // Canada Day
    nthWeekday(year, 7, 1, 1), // British Columbia Day
    nthWeekday(year, 8, 1, 1), // Labour Day
    utc(year, 8, 30), // National Day for Truth and Reconciliation
    nthWeekday(year, 9, 1, 2), // Thanksgiving Day
    utc(year, 10, 11), // Remembrance Day
    utc(year, 11, 25), // Christmas Day
    utc(year, 11, 26), // Boxing Day
  ]
  return new Set(
    days.map((d) => (d.getUTCDay() === 0 ? utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) : d)).map(ymd),
  )
}

const isBusinessDay = (d: Date) =>
  d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !bcHolidays(d.getUTCFullYear()).has(ymd(d))

/** `start` plus `count` days, business or calendar, as YYYY-MM-DD. */
export function addDays(start: string, count: number, business: boolean): string {
  const d = new Date(start + 'T00:00:00Z')
  if (!business) {
    d.setUTCDate(d.getUTCDate() + count)
    return ymd(d)
  }
  let left = count
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isBusinessDay(d)) left--
  }
  return ymd(d)
}

/** The status of a request, its due date and whether it is overdue on `today`. */
export function requestStanding(
  status: RequestStatus | undefined,
  channel: Channel | undefined,
  today: string,
  derived: boolean,
): RequestStanding {
  if (!status || !status.events.length)
    return { state: 'not-requested', label: 'Not requested', overdue: false, noLongerNeeded: !derived && !!status }
  const events = [...status.events].sort((a, b) => a.date.localeCompare(b.date))
  const last = events[events.length - 1]
  const requestedOn = events.find((e) => e.status === 'requested')?.date
  const extensions = events.filter((e) => e.status === 'extended').length
  const days = channel?.days
  const due =
    requestedOn && days
      ? addDays(requestedOn, days.count + extensions * (days.extension ?? 0), days.business)
      : undefined
  const waiting = last.status === 'requested' || last.status === 'extended' || last.status === 'partial'
  return {
    state: last.status,
    label: REQUEST_EVENT_LABELS[last.status],
    requestedOn,
    due,
    overdue: waiting && !!due && today > due,
    noLongerNeeded: !derived,
  }
}
