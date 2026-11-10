/**
 * Landing catchments: which landing each part of the block's wood leaves by, and how much ground
 * and how far each landing serves.
 *
 * Every cell within reach records the cell its logs leave by (`ExtractionCells.exit`): a truck-road
 * or landing cell, a skid-trail cell (the trail's own search records the truck cell it joins), or a
 * cable landing. A catchment is every cell whose exit resolves to the same landing. With the user's
 * landings set, the groups are those landings, listed even when they serve nothing; without them,
 * the groups are the counted roads, so a run still shows which road serves which ground.
 *
 * After Sylvaccess 3.6's exit links ("which road or trail cell each forest cell leaves by") and its
 * wood catchments per landing. Written from a functional specification; no code from Sylvaccess
 * (GPL-3.0-or-later) was used.
 *
 * Pure: no DOM or network access.
 */
import type { CableLanding } from './cableCoverage'
import { keepWithinBudget, maskPolygons, X_COVERED, type ExtractionResult } from './extractionReach'
import type { LandingStatus } from './extractionLandings'

/** One colour per landing, cycled; chosen to differ from the distance-class greens and oranges. */
export const CATCHMENT_COLORS = [
  '#2563eb',
  '#db2777',
  '#0d9488',
  '#9333ea',
  '#ca8a04',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#c2410c',
  '#4f46e5',
  '#be185d',
  '#15803d',
]
export const catchmentColor = (k: number) => CATCHMENT_COLORS[k % CATCHMENT_COLORS.length]

export interface CatchmentRow {
  /** Landing id, or the road's id without landings. */
  id: string
  name: string
  color: string
  status: LandingStatus | null
  cells: number
  ha: number
  /** Share of the ground within reach. */
  share: number
  meanM: number | null
  farthestM: number | null
}

export interface LandingCatchments {
  /** `landing` when the user's landings set the groups, `road` otherwise. */
  by: 'landing' | 'road'
  rows: CatchmentRow[]
  /** Group index per grid cell (into `rows`), -1 outside every catchment. */
  group: Int16Array
  /** Within-reach hectares whose exit resolves to no group. */
  unassignedHa: number
  coveredHa: number
}

/**
 * The catchment of each landing (or road), from a run's strict cells. `cable` is the cable run's
 * landing list when the result is a cable run: its exits are those landings' cells.
 */
export function landingCatchments(
  result: ExtractionResult,
  cable: readonly CableLanding[] | null = null,
): LandingCatchments {
  const eg = result.grid
  const sg = eg.sg
  const n = sg.grid.values.length
  const cellHa = (sg.grid.cellM * sg.grid.cellM) / 10_000
  const strict = result.state.cells[0]
  const trailExit = result.state.layers[0].trailField.exit
  const picked = eg.landings ?? []
  const by: LandingCatchments['by'] = picked.length ? 'landing' : 'road'
  // Group of each exit cell.
  const exitGroup = new Int16Array(n).fill(-1)
  const groups: { id: string; name: string; status: LandingStatus | null }[] = []
  if (by === 'landing') {
    picked.forEach((landing, k) => {
      groups.push({ id: landing.id, name: landing.name, status: landing.status })
      for (const i of landing.cells) if (exitGroup[i] < 0) exitGroup[i] = k
    })
    for (const l of cable ?? []) if (l.group !== undefined) exitGroup[l.cell] = l.group
  } else {
    sg.roads.forEach((road) => groups.push({ id: road.road.id, name: road.road.name, status: null }))
    // Truck roads only: a skid trail's cells resolve to the truck road it joins.
    for (let i = 0; i < n; i++) {
      const k = sg.sourceRoad[i]
      if (k >= 0 && sg.roads[k].road.use !== 'track') exitGroup[i] = k
    }
    for (const l of cable ?? []) if (l.roadIndex >= 0) exitGroup[l.cell] = l.roadIndex
  }
  const resolve = (exit: number) => {
    if (exit < 0) return -1
    const g = exitGroup[exit]
    if (g >= 0) return g
    const via = trailExit[exit]
    return via >= 0 ? exitGroup[via] : -1
  }
  const group = new Int16Array(n).fill(-1)
  const count = new Array(groups.length).fill(0),
    sum = new Array(groups.length).fill(0),
    far = new Array(groups.length).fill(-Infinity)
  let covered = 0,
    unassigned = 0
  for (const i of sg.blockCells) {
    if (result.state.states[i] !== X_COVERED) continue
    covered++
    const g = resolve(strict.exit[i])
    if (g < 0) {
      unassigned++
      continue
    }
    group[i] = g
    count[g]++
    const d = strict.totalM[i]
    if (Number.isFinite(d)) {
      sum[g] += d
      if (d > far[g]) far[g] = d
    }
  }
  const rows: CatchmentRow[] = groups.map((g, k) => ({
    id: g.id,
    name: g.name,
    color: catchmentColor(k),
    status: g.status,
    cells: count[k],
    ha: count[k] * cellHa,
    share: covered ? count[k] / covered : 0,
    meanM: count[k] ? sum[k] / count[k] : null,
    farthestM: Number.isFinite(far[k]) ? far[k] : null,
  }))
  return {
    by,
    // Roads that serve nothing are left out; every landing the user set is listed.
    rows: by === 'landing' ? rows : rows.filter((row) => row.cells > 0),
    group: by === 'landing' ? group : remap(group, rows),
    unassignedHa: unassigned * cellHa,
    coveredHa: covered * cellHa,
  }
}

/** Group indices after dropping empty road rows. */
function remap(group: Int16Array, rows: CatchmentRow[]): Int16Array {
  const index = new Int16Array(rows.length).fill(-1)
  let next = 0
  rows.forEach((row, k) => {
    if (row.cells > 0) index[k] = next++
  })
  const out = new Int16Array(group.length).fill(-1)
  for (let i = 0; i < group.length; i++) if (group[i] >= 0) out[i] = index[group[i]]
  return out
}

/** Plan features: each catchment filled in its landing's colour. */
export function catchmentMapFeatures(result: ExtractionResult, catchments: LandingCatchments): GeoJSON.Feature[] {
  const sg = result.grid.sg
  const out: { vertices: number; feature: GeoJSON.Feature }[] = []
  catchments.rows.forEach((row, k) => {
    if (!row.cells) return
    for (const polygon of maskPolygons(sg, (i) => catchments.group[i] === k))
      out.push({
        vertices: polygon.reduce((sum, ring) => sum + ring.length, 0),
        feature: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polygon.map((ring) => ring.map((p) => sg.toLonLat(p))) },
          properties: {
            kind: 'extraction-catchment',
            fill: true,
            color: row.color,
            label: `Catchment of ${row.name} · ${row.ha.toFixed(1)} ha`,
          },
        },
      })
  })
  return keepWithinBudget(out)
}
