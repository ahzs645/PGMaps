/**
 * Compare a run with a pinned earlier one: the ground each run has within reach, the cells gained
 * and lost, distances that grew or fell, and the area by state and distance class side by side.
 * It answers "what did this change of machine, limits or landings do" for any two runs on one
 * grid, where the designed-roads comparison (`compareExtraction`) answers it for roads only.
 *
 * After Sylvaccess 3.6's comparison of two runs (difference raster, class-change polygons). Written
 * from a functional specification; no code from Sylvaccess (GPL-3.0-or-later) was used.
 *
 * Pure: no DOM or network access.
 */
import {
  EXTRACTION_STATES,
  keepWithinBudget,
  maskPolygons,
  MIN_SHORTENED_M,
  X_COVERED,
  X_UNKNOWN,
  type ExtractionMachine,
  type ExtractionResult,
  type ExtractionState,
} from './extractionReach'
import { sameExtractionGrid } from './harvestSystems'

/** Per-cell change codes. */
export const PIN_SAME = 0,
  PIN_GAINED = 1,
  PIN_LOST = 2,
  PIN_SHORTER = 3,
  PIN_LONGER = 4,
  PIN_UNKNOWN = 5

export const PIN_CHANGE_COLORS = {
  gained: '#16a34a',
  lost: '#dc2626',
  shorter: '#0d9488',
  longer: '#ea580c',
  unknown: '#64748b',
} as const

export interface PinnedStateRow {
  state: ExtractionState
  pinnedHa: number
  currentHa: number
}
export interface PinnedClassRow {
  label: string
  pinnedHa: number
  currentHa: number
}

export interface PinnedRunComparison {
  pinnedMachine: ExtractionMachine
  currentMachine: ExtractionMachine
  /** Within reach now, not in the pinned run. */
  gainedHa: number
  /** Within reach in the pinned run, not now. */
  lostHa: number
  /** Within reach in both, at least `MIN_SHORTENED_M` shorter or longer now. */
  shorterHa: number
  longerHa: number
  /** Mean change of distance over cells within reach in both, m (negative is shorter). */
  meanChangeM: number | null
  /** Known in one run and unknown in the other. */
  unknownChangedHa: number
  states: PinnedStateRow[]
  /** Within-reach area by the current run's distance classes, both runs. */
  classes: PinnedClassRow[]
  /** Per cell: `PIN_*` codes. */
  change: Uint8Array
}

/** Compares `current` with `pinned`. Throws when the two runs are not on the same grid. */
export function comparePinnedRun(pinned: ExtractionResult, current: ExtractionResult): PinnedRunComparison {
  if (!sameExtractionGrid(pinned, current))
    throw Error('The pinned run used another block, grid cell or travel band. Pin this run to compare from it.')
  const sg = current.grid.sg
  const cellHa = (sg.grid.cellM * sg.grid.cellM) / 10_000
  const bounds = current.grid.settings.classBoundsM
  const classOf = (m: number) => {
    let k = bounds.length - 1
    while (k > 0 && m < bounds[k]) k--
    return k
  }
  const change = new Uint8Array(sg.grid.values.length)
  const stateCount = [new Array(EXTRACTION_STATES.length).fill(0), new Array(EXTRACTION_STATES.length).fill(0)]
  const classCount = [bounds.map(() => 0), bounds.map(() => 0)]
  let gained = 0,
    lost = 0,
    shorter = 0,
    longer = 0,
    unknown = 0,
    both = 0,
    sum = 0
  const p = pinned.state,
    c = current.state
  for (const i of sg.blockCells) {
    stateCount[0][p.states[i]]++
    stateCount[1][c.states[i]]++
    const was = p.states[i] === X_COVERED,
      is = c.states[i] === X_COVERED
    if (was) classCount[0][classOf(p.cells[0].totalM[i])]++
    if (is) classCount[1][classOf(c.cells[0].totalM[i])]++
    if ((p.states[i] === X_UNKNOWN) !== (c.states[i] === X_UNKNOWN)) {
      change[i] = PIN_UNKNOWN
      unknown++
      continue
    }
    if (is && !was) {
      change[i] = PIN_GAINED
      gained++
    } else if (was && !is) {
      change[i] = PIN_LOST
      lost++
    } else if (was && is) {
      const by = c.cells[0].totalM[i] - p.cells[0].totalM[i]
      if (!Number.isFinite(by)) continue
      both++
      sum += by
      if (by <= -MIN_SHORTENED_M) {
        change[i] = PIN_SHORTER
        shorter++
      } else if (by >= MIN_SHORTENED_M) {
        change[i] = PIN_LONGER
        longer++
      }
    }
  }
  return {
    pinnedMachine: pinned.summary.machine,
    currentMachine: current.summary.machine,
    gainedHa: gained * cellHa,
    lostHa: lost * cellHa,
    shorterHa: shorter * cellHa,
    longerHa: longer * cellHa,
    meanChangeM: both ? sum / both : null,
    unknownChangedHa: unknown * cellHa,
    states: EXTRACTION_STATES.filter((s) => s !== 'outside').map((state) => {
      const k = EXTRACTION_STATES.indexOf(state)
      return { state, pinnedHa: stateCount[0][k] * cellHa, currentHa: stateCount[1][k] * cellHa }
    }),
    classes: bounds.map((from, k) => ({
      label: k + 1 < bounds.length ? `${from}–${bounds[k + 1]} m` : `${from} m and over`,
      pinnedHa: classCount[0][k] * cellHa,
      currentHa: classCount[1][k] * cellHa,
    })),
    change,
  }
}

/** Plan features: ground gained, lost, shorter, longer and newly (un)known against the pinned run. */
export function pinnedChangeFeatures(current: ExtractionResult, comparison: PinnedRunComparison): GeoJSON.Feature[] {
  const sg = current.grid.sg
  const out: { vertices: number; feature: GeoJSON.Feature }[] = []
  for (const [code, role, label] of [
    [PIN_GAINED, 'gained', 'Within reach now, not in the pinned run'],
    [PIN_LOST, 'lost', 'Within reach in the pinned run, not now'],
    [PIN_SHORTER, 'shorter', 'Shorter than in the pinned run'],
    [PIN_LONGER, 'longer', 'Longer than in the pinned run'],
    [PIN_UNKNOWN, 'unknown', 'Unknown in one run only'],
  ] as const)
    for (const polygon of maskPolygons(sg, (i) => comparison.change[i] === code))
      out.push({
        vertices: polygon.reduce((sum, ring) => sum + ring.length, 0),
        feature: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polygon.map((ring) => ring.map((p) => sg.toLonLat(p))) },
          properties: { kind: 'extraction-pinned', fill: true, role, color: PIN_CHANGE_COLORS[role], label },
        },
      })
  return keepWithinBudget(out)
}
