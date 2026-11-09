/** Why sections are incomplete, counted along the road. No DOM, network or engine dependencies. */

export interface IncompleteReason {
  reason: string
  /** Calculation stations whose section this reason leaves incomplete. */
  stations: number
  firstChainage: number
}

/**
 * The reasons the incomplete sections give, most frequent first. Each reason is a section
 * builder flag (unresolved daylight, missing terrain, a key or reference that does not fit), so a
 * coverage figure below 100 % can always be traced to what has to change.
 */
export function incompleteReasonSummary(
  stations: readonly { chainage: number; complete: boolean; incompleteReasons?: readonly string[] }[],
): IncompleteReason[] {
  const reasons = new Map<string, IncompleteReason>()
  for (const station of stations) {
    if (station.complete) continue
    for (const reason of station.incompleteReasons?.length ? station.incompleteReasons : ['Reason not recorded']) {
      const entry = reasons.get(reason)
      if (entry) entry.stations++
      else reasons.set(reason, { reason, stations: 1, firstChainage: station.chainage })
    }
  }
  return [...reasons.values()].sort((a, b) => b.stations - a.stations || a.firstChainage - b.firstChainage)
}

/** One sentence naming up to `limit` reasons with their station counts, for a warning or tooltip. */
export function incompleteReasonText(reasons: readonly IncompleteReason[], limit = 3): string {
  if (!reasons.length) return ''
  const shown = reasons
    .slice(0, limit)
    .map(
      (r) =>
        `${r.reason} (${r.stations} station${r.stations === 1 ? '' : 's'}, first at ${r.firstChainage.toFixed(1)} m)`,
    )
  const more = reasons.length - shown.length
  return `${shown.join('; ')}${more > 0 ? `; and ${more} other reason${more === 1 ? '' : 's'}` : ''}.`
}
