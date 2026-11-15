/**
 * Station equations of a field traverse (RoadEng's Survey Information → Station Equations): from a
 * back station on the calculated chain (start station plus accumulated horizontal distance), the
 * field names stations from an ahead station. Kept apart from the traverse formats
 * (`softreeTraverse.ts`, which re-exports these) so the survey field book reads them without
 * loading the format readers.
 *
 * Checked by `softreeTraverse.test.ts`. Pure: no DOM or network access.
 */

/** Station equations a traverse holds at most. */
export const MAX_STATION_EQUATIONS = 100

/**
 * A station equation: from calculated station `back` on, the field calls the station `ahead` plus
 * the distance since. Both are horizontal-distance stations.
 */
export interface StationEquation {
  back: number
  ahead: number
}

/** Throws unless the equations are finite, in increasing back-station order and within range. */
export function checkStationEquations(equations: readonly StationEquation[], range?: { start: number; end: number }) {
  if (equations.length > MAX_STATION_EQUATIONS)
    throw Error(`A traverse holds at most ${MAX_STATION_EQUATIONS} station equations.`)
  let last = -Infinity
  for (const e of equations) {
    if (!Number.isFinite(e.back) || !Number.isFinite(e.ahead))
      throw Error('A station equation needs a back and an ahead station.')
    if (e.back <= last) throw Error('Station equations must be in increasing back-station order, one per station.')
    if (range && (e.back < range.start - 1e-9 || e.back > range.end + 1e-9))
      throw Error(`The station equation at back station ${e.back} is off the traverse.`)
    last = e.back
  }
}

/** The field (displayed) station of a calculated station. At a back station the ahead name wins. */
export function fieldStation(calculated: number, equations: readonly StationEquation[]): number {
  let at: StationEquation | null = null
  for (const e of equations) if (e.back <= calculated + 1e-9) at = e
  return at ? at.ahead + (calculated - at.back) : calculated
}

/** Every calculated station a field station names (an equation can make a name occur twice). */
export function calculatedStations(field: number, equations: readonly StationEquation[], start: number): number[] {
  const bounds = [{ back: start, ahead: start }, ...equations]
  const out: number[] = []
  bounds.forEach((e, i) => {
    const c = e.back + (field - e.ahead)
    const next = bounds[i + 1]
    if (c >= e.back - 1e-9 && (!next || c < next.back - 1e-9)) out.push(c)
  })
  return out
}

/**
 * Equations read from a station column: wherever a written station moves by more than rounding from
 * the previous one plus the distance between them. `written[i]` may be null (not given).
 */
export function stationEquationsFromColumn(
  written: ReadonlyArray<number | null>,
  distances: readonly number[],
  tolerance: number,
): { start: number; equations: StationEquation[] } {
  const start = written[0] ?? 0
  const equations: StationEquation[] = []
  let calc = start,
    prev = start
  for (let i = 1; i < written.length; i++) {
    calc += distances[i - 1]
    const w = written[i]
    if (w === null) {
      prev = fieldStation(calc, equations)
      continue
    }
    if (Math.abs(w - (prev + distances[i - 1])) > tolerance) equations.push({ back: calc, ahead: w })
    prev = w
  }
  return { start, equations }
}
