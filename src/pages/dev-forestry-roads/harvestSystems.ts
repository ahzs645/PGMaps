/**
 * A suggested harvest system for each part of a block, from the skidder, forwarder and cable
 * yarder runs on one grid: ground-based where a skidder or forwarder reaches, cable where only a
 * skyline does, none where no machine does. It is a screen of the three reach results under a
 * stated rule, not a prescription: it weighs no cost, soil, season or volume.
 *
 * Sylvaccess 3.6 offers an operation-systems map per parcel built from the same three results; its
 * processing was not described, so the rule here is PGMaps' own. Written from a functional
 * specification; no code from Sylvaccess (GPL-3.0-or-later) was used.
 *
 * Pure: no DOM or network access.
 */
import {
  keepWithinBudget,
  maskPolygons,
  X_COVERED,
  X_EXCLUDED,
  X_UNFELLABLE,
  X_UNKNOWN,
  type ExtractionResult,
} from './extractionReach'

/** Systems by code, in table order. */
export const HARVEST_SYSTEMS = [
  'skidder',
  'forwarder',
  'skidder-or-forwarder',
  'cable',
  'none',
  'not-extracted',
  'unknown',
] as const
export type HarvestSystem = (typeof HARVEST_SYSTEMS)[number]

export const HARVEST_SYSTEM_LABELS: Record<HarvestSystem, string> = {
  skidder: 'Ground-based: skidder',
  forwarder: 'Ground-based: forwarder',
  'skidder-or-forwarder': 'Ground-based: skidder or forwarder',
  cable: 'Cable: only a skyline reaches',
  none: 'No machine reaches',
  'not-extracted': 'Too steep to fell or no extraction',
  unknown: 'Unknown',
}
export const HARVEST_SYSTEM_COLORS: Record<HarvestSystem, string> = {
  skidder: '#16a34a',
  forwarder: '#65a30d',
  'skidder-or-forwarder': '#15803d',
  cable: '#0e7490',
  none: '#dc2626',
  'not-extracted': '#4c1d95',
  unknown: '#64748b',
}

export interface HarvestSystemRow {
  system: HarvestSystem
  label: string
  color: string
  ha: number
  share: number
}

export interface HarvestSystemMap {
  /** System code per grid cell (index into `HARVEST_SYSTEMS`), 255 outside the block. */
  system: Uint8Array
  rows: HarvestSystemRow[]
  blockHa: number
  /** Which machines' runs went in. */
  machines: { skidder: boolean; forwarder: boolean; cable: boolean }
}

export interface HarvestSystemInputs {
  skidder?: ExtractionResult | null
  forwarder?: ExtractionResult | null
  cable?: ExtractionResult | null
}

/** Whether two runs lie on the same grid: origin, cell size, extent and block. */
export function sameExtractionGrid(a: ExtractionResult, b: ExtractionResult): boolean {
  const p = a.grid.sg,
    q = b.grid.sg
  if (p.grid === q.grid) return true
  return (
    p.grid.width === q.grid.width &&
    p.grid.height === q.grid.height &&
    Math.abs(p.grid.cellM - q.grid.cellM) < 1e-9 &&
    Math.abs(p.grid.origin[0] - q.grid.origin[0]) < 1e-6 &&
    Math.abs(p.grid.origin[1] - q.grid.origin[1]) < 1e-6 &&
    p.blockCells.length === q.blockCells.length &&
    p.blockCells.every((cell, k) => q.blockCells[k] === cell)
  )
}

/**
 * The rule, per block cell, in order: **ground-based** when the skidder or the forwarder has it
 * within reach (both: "skidder or forwarder"); **cable** when only the cable yarder does; **unknown**
 * when any run reports it unknown; **too steep to fell or no extraction** when the runs say so;
 * otherwise **no machine reaches**. A machine not run counts as reaching nothing.
 */
export function harvestSystemMap(inputs: HarvestSystemInputs): HarvestSystemMap {
  const runs = [inputs.skidder, inputs.forwarder, inputs.cable].filter((r): r is ExtractionResult => !!r)
  if (!runs.length) throw Error('Run at least one machine first.')
  const base = runs[0]
  for (const run of runs.slice(1))
    if (!sameExtractionGrid(base, run)) throw Error('Run every machine on the same block, grid cell and travel band.')
  const sg = base.grid.sg
  const n = sg.grid.values.length
  const cellHa = (sg.grid.cellM * sg.grid.cellM) / 10_000
  const system = new Uint8Array(n).fill(255)
  const counts = new Array(HARVEST_SYSTEMS.length).fill(0)
  const covered = (run: ExtractionResult | null | undefined, i: number) => !!run && run.state.states[i] === X_COVERED
  const code = (s: HarvestSystem) => HARVEST_SYSTEMS.indexOf(s)
  for (const i of sg.blockCells) {
    const skid = covered(inputs.skidder, i),
      fwd = covered(inputs.forwarder, i)
    let s: HarvestSystem
    if (skid && fwd) s = 'skidder-or-forwarder'
    else if (skid) s = 'skidder'
    else if (fwd) s = 'forwarder'
    else if (covered(inputs.cable, i)) s = 'cable'
    else if (runs.some((run) => run.state.states[i] === X_UNKNOWN)) s = 'unknown'
    else if (runs.every((run) => run.state.states[i] === X_UNFELLABLE || run.state.states[i] === X_EXCLUDED))
      s = 'not-extracted'
    else s = 'none'
    system[i] = code(s)
    counts[code(s)]++
  }
  const block = sg.blockCells.length
  return {
    system,
    rows: HARVEST_SYSTEMS.map((s, k) => ({
      system: s,
      label: HARVEST_SYSTEM_LABELS[s],
      color: HARVEST_SYSTEM_COLORS[s],
      ha: counts[k] * cellHa,
      share: block ? counts[k] / block : 0,
    })),
    blockHa: block * cellHa,
    machines: { skidder: !!inputs.skidder, forwarder: !!inputs.forwarder, cable: !!inputs.cable },
  }
}

/** Plan features: each system's ground filled in its colour. */
export function harvestSystemFeatures(result: ExtractionResult, map: HarvestSystemMap): GeoJSON.Feature[] {
  const sg = result.grid.sg
  const out: { vertices: number; feature: GeoJSON.Feature }[] = []
  HARVEST_SYSTEMS.forEach((s, k) => {
    if (!map.rows[k].ha) return
    for (const polygon of maskPolygons(sg, (i) => map.system[i] === k))
      out.push({
        vertices: polygon.reduce((sum, ring) => sum + ring.length, 0),
        feature: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: polygon.map((ring) => ring.map((p) => sg.toLonLat(p))) },
          properties: {
            kind: 'harvest-system',
            fill: true,
            color: HARVEST_SYSTEM_COLORS[s],
            label: `Suggested: ${HARVEST_SYSTEM_LABELS[s]}`,
          },
        },
      })
  })
  return keepWithinBudget(out)
}
