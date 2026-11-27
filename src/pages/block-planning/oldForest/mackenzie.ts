/**
 * Objectives 2 and 3 of the Mackenzie order for one landscape unit or group of the 2010 Table 2, row
 * by row, for each schedule and projection year: old forest against the row's share of the CFLB in
 * its biogeoclimatic groups, and old interior forest against Table 3's share of that requirement.
 * The rules are the order's; the readings PGMaps makes are in docs/forestry-old-forest.md,
 * **The Mackenzie order**, each named where it acts.
 *
 * - **Old.** Each stand by its own rule (1.5, `mackenzieOldFrom`): older than 120 in SBSmk1 and
 *   SBSmk2, older than 100 in BWBS deciduous-leading stands (birch or aspen), older than 140
 *   elsewhere. Ages, resets and unknown ages are the Prince George calculation's (`ageIn`).
 * - **Rows.** A stand counts in the row that holds its Table 1 group (`standGroup`); CFLB ground no
 *   row holds (group 1, alpine, a group with no row in this unit) is counted apart and named.
 * - **CFLB.** The proxy the Prince George calculation uses, on the ground the Mackenzie order applies
 *   to (`mackenzieReads.ts`): treed on the forest management land base, less land that is not
 *   provincial Crown, woodlots and community forests of 600 ha or less. Parks stay: the CFLB names them.
 * - **Natural Forest Area** (2(a)). Old forest by age is live and dead together, split by the VRI's
 *   `STAND_PERCENTAGE_DEAD` (area × dead share; none recorded is none). The dead part is the Natural
 *   Forest Area counted, capped at the share of the area the reviewer states the epidemic affected,
 *   when one is stated. Young natural forest is not counted as Natural Forest Area.
 * - **Younger stands** (2(b)). Off unless the reviewer states the age they count from and the
 *   benefit. They count toward at most 20% of the row's target less the Natural Forest Area counted
 *   toward it (the live old forest part), never toward interior (`liveOldAllowance`).
 * - **Interior** (Guidance 4). Old forest, live or dead, less 200 m from pine- and deciduous-leading
 *   stands 60 years or younger and other stands 80 or younger, unaged land-base ground, reset ground,
 *   the primary corridors and lakes and reservoirs, kept only where wider than 200 m. It is found over
 *   all the unit's old forest, then shared out to each row by the old ground under it.
 *
 * DOM- and network-free. Geometry is measured in BC Albers (EPSG:3005).
 */
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import Envelope from 'jsts/org/locationtech/jts/geom/Envelope.js'
import STRtree from 'jsts/org/locationtech/jts/index/strtree/STRtree.js'
import {
  ageIn,
  area,
  INTERIOR_BUFFER_METRES,
  difference,
  interiorOf,
  intersection,
  intersects,
  manyUnion,
  toAlbers,
  union,
  unknownBecauseHarvestedLater,
  type PreparedStand,
  type PreparedUnit,
  type Reset,
} from './oldForest'
import {
  becLabel,
  deciduousByOrder,
  MACKENZIE_YOUNGER_MAX_SHARE,
  mackenzieOldFrom,
  rowName,
  rowOf,
  standGroup,
  type BecGroup,
  type MackenzieUnit,
} from './mackenzieUnits'

const SQ_M_PER_HA = 10_000
/** VRI `BCLCS_LEVEL_5` codes the interior treats as lakes: a lake, and a reservoir (Williston Lake is one). */
export const LAKE_COVER = ['LA', 'RE'] as const

export interface MackenzieSettings {
  /** 2(a): the share of the area the epidemic affected, as the reviewer states it. Null: not stated, no cap. */
  affectedPercent: number | null
  /** 2(b): the age younger stands count from. Null: off. */
  youngerFromAge: number | null
}

export const DEFAULT_MACKENZIE_SETTINGS: MackenzieSettings = { affectedPercent: null, youngerFromAge: null }

/** One row's figures in one year. Absent younger fields: 2(b) was off. */
export interface MackenzieRowYear {
  row: string
  cflbHa: number
  requiredOldHa: number
  /** Old by age, live and dead, less resets. */
  oldHa: number
  /** Of `oldHa`, the VRI's dead share: the Natural Forest Area before any cap. */
  deadOldHa: number
  /** The Natural Forest Area counted toward the target (2(a)): `deadOldHa`, capped when an affected share is stated. */
  nfaHa: number
  /** CFLB ground harvested after the year and before the VRI projection: its age then is unknown. */
  unknownAgeHa: number
  /** Null where Table 3 leaves the row's share open. */
  requiredInteriorHa: number | null
  /** Null in a year whose interior was not calculated. */
  interiorHa: number | null
  youngerSupplyHa?: number
  youngerHa?: number
}

export interface MackenzieYear {
  year: number
  rows: MackenzieRowYear[]
}

/** CFLB in the unit no row of the unit holds, by BEC label, with the group Table 1 puts it in. */
export interface OutsideRows {
  label: string
  group: BecGroup | null
  cflbHa: number
}

/**
 * Objective 2's arithmetic on one row: the Natural Forest Area counted (capped by 2(a) when the
 * affected share is stated), the live part of the target that leaves, and what younger stands may
 * add toward it (2(b), at most 20% of that live part).
 */
export function liveOldAllowance({
  requiredOldHa,
  deadOldHa,
  affectedPercent,
  youngerSupplyHa,
}: {
  requiredOldHa: number
  deadOldHa: number
  affectedPercent: number | null
  youngerSupplyHa: number | null
}): { nfaHa: number; liveTargetHa: number; youngerHa: number | null } {
  const nfaHa = affectedPercent === null ? deadOldHa : Math.min(deadOldHa, (requiredOldHa * affectedPercent) / 100)
  const liveTargetHa = Math.max(0, requiredOldHa - nfaHa)
  const youngerHa =
    youngerSupplyHa === null ? null : Math.min(youngerSupplyHa, MACKENZIE_YOUNGER_MAX_SHARE * liveTargetHa)
  return { nfaHa, liveTargetHa, youngerHa }
}

/** Old forest held toward a row's target: live old, Natural Forest Area counted, and younger stands counted. */
export const heldOld = (r: MackenzieRowYear) => r.oldHa - r.deadOldHa + r.nfaHa + (r.youngerHa ?? 0)

/** A neighbour that makes an interior edge (Guidance 4's table, plus lakes); non-forest makes none. */
function makesEdge(p: PreparedStand, year: number): boolean {
  if (p.stand.cover5 && (LAKE_COVER as readonly string[]).includes(p.stand.cover5)) return true
  if (!p.stand.treed && !p.stand.forestLandBase) return false
  const age = ageIn(p.stand, year)
  if (age === null) return p.stand.forestLandBase && !unknownBecauseHarvestedLater(p.stand, year)
  const pineOrDeciduous = p.stand.leading?.startsWith('P') || deciduousByOrder(p.stand.leading)
  return pineOrDeciduous ? age <= 60 : age <= 80
}

/** The polygons or lines a geometry holds, one by one. */
function partsOf(g: Geometry | null): Geometry[] {
  if (!g) return []
  const n = g.getNumGeometries()
  if (n === 1 && g.getGeometryN(0) === g) return [g]
  const out: Geometry[] = []
  for (let i = 0; i < n; i++) out.push(...partsOf(g.getGeometryN(i)))
  return out
}

/**
 * Interior patch by patch: each connected piece of old forest against only the edges within 200 m of
 * it. The same ground as one overlay of all old forest against all edges, since an edge farther away
 * takes nothing from a patch; but a Mackenzie unit is several times the largest Prince George one,
 * and one buffer of every young stand in it ran a 14 GB heap for many minutes.
 */
function interiorByPatch(
  old: Geometry | null,
  edges: Geometry[],
  notCounted: ((g: Geometry) => Geometry | null) | null,
): Geometry[] {
  const tree = new STRtree()
  const pieces = edges.flatMap(partsOf)
  pieces.forEach((g, i) => tree.insert(g.getEnvelopeInternal(), i))
  const kept: Geometry[] = []
  for (const patch of partsOf(old)) {
    const env = new Envelope(patch.getEnvelopeInternal())
    env.expandBy(INTERIOR_BUFFER_METRES)
    const found = tree.query(env) as unknown as number[] | { toArray(): number[] }
    const local = (Array.isArray(found) ? found : found.toArray()).map((i) => pieces[i])
    kept.push(...interiorOf(patch, local, notCounted, true).kept)
  }
  return kept
}

/** The stand's row index in the unit, or -1; and its old age. Computed once per prepared unit. */
function standRows(prepared: PreparedUnit<MackenzieUnit>) {
  const { unit } = prepared
  return prepared.stands.map((p) => {
    const row = rowOf(unit, standGroup(p.stand))
    return { row: row ? unit.rows.indexOf(row) : -1, oldFrom: mackenzieOldFrom(p.stand) }
  })
}

/** CFLB in the unit that no row holds, by label: Table 2 sets it no target. */
export function outsideRows(prepared: PreparedUnit<MackenzieUnit>): OutsideRows[] {
  const rows = standRows(prepared)
  const by = new Map<string, OutsideRows>()
  prepared.stands.forEach((p, i) => {
    if (rows[i].row >= 0 || !p.inside || !p.cflb) return
    const label = becLabel(p.stand.bec) ?? 'No BEC label'
    const group = standGroup(p.stand)
    const key = `${label}|${group ?? ''}`
    const entry = by.get(key) ?? { label: group === '6&7' ? `${label} deciduous-leading` : label, group, cflbHa: 0 }
    entry.cflbHa += p.insideM2 / SQ_M_PER_HA
    by.set(key, entry)
  })
  return [...by.values()].sort((a, b) => b.cflbHa - a.cflbHa)
}

/** The unit's rows for one set of resets at each year; interior only for `interiorYears`. */
export function mackenzieYears(
  prepared: PreparedUnit<MackenzieUnit>,
  resets: Reset[],
  years: number[],
  interiorYears: number[],
  settings: MackenzieSettings,
): MackenzieYear[] {
  const { unit } = prepared
  const rows = standRows(prepared)
  const resetGeoms = resets.map((r) => ({ year: r.year, geometry: toAlbers(r.geometry) }))
  const cflbM2 = unit.rows.map(() => 0)
  prepared.stands.forEach((p, i) => {
    if (p.inside && p.cflb && rows[i].row >= 0) cflbM2[rows[i].row] += p.insideM2
  })
  return years.map((year) => {
    const active = union(
      resetGeoms.filter((r) => r.year <= year && r.year > prepared.projectedYear).map((r) => r.geometry),
    )
    const withInterior = interiorYears.includes(year)
    const sums = unit.rows.map(() => ({ old: 0, dead: 0, unknown: 0, younger: 0 }))
    /** Each stand's counted old ground with its row: stands do not overlap, so interior is shared out piece by piece. */
    const rowOld: { row: number; part: Geometry }[] = []
    const allOld: Geometry[] = []
    const edges: Geometry[] = []
    prepared.stands.forEach((p, i) => {
      const { row, oldFrom } = rows[i]
      const near = active && intersects(p.whole, active) ? active : null
      const age = ageIn(p.stand, year)
      if (p.inside && p.cflb) {
        const old = age !== null && age >= oldFrom
        const younger =
          !old && settings.youngerFromAge !== null && age !== null && age >= settings.youngerFromAge && row >= 0
        if (old || younger) {
          let part: Geometry | null = p.inside
          const lost = near ? intersection(part, near) : null
          if (lost) part = difference(part, lost)
          const m2 = area(part)
          if (old) {
            if (row >= 0) {
              sums[row].old += m2
              sums[row].dead += (m2 * Math.min(100, Math.max(0, p.stand.deadPercent ?? 0))) / 100
            }
            if (withInterior && part) {
              allOld.push(part)
              if (row >= 0) rowOld.push({ row, part })
            }
          } else sums[row].younger += m2
        } else if (row >= 0 && unknownBecauseHarvestedLater(p.stand, year)) sums[row].unknown += p.insideM2
      }
      if (!withInterior) return
      // Old forest on ground the order does not apply to shapes interior (one patch across a tenure
      // boundary) but is never counted, as in the Prince George calculation.
      if (p.excludedPart && p.cflb && age !== null && age >= oldFrom) {
        const lost = near ? intersection(p.excludedPart, near) : null
        const shaping = lost ? difference(p.excludedPart, lost) : p.excludedPart
        if (shaping) allOld.push(shaping)
      }
      if (makesEdge(p, year)) edges.push(p.whole)
    })
    let interiorByRow: (number | null)[] = unit.rows.map(() => null)
    if (withInterior) {
      edges.push(
        ...(active ? [active] : []),
        ...(prepared.corridors ? [prepared.corridors] : []),
        ...(prepared.corridorAreas ? [prepared.corridorAreas] : []),
      )
      const kept = interiorByPatch(manyUnion(allOld), edges, prepared.excludedClip ?? null)
      const m2 = unit.rows.map(() => 0)
      const tree = new STRtree()
      rowOld.forEach((o, i) => tree.insert(o.part.getEnvelopeInternal(), i))
      for (const part of kept) {
        const found = tree.query(part.getEnvelopeInternal()) as unknown as number[] | { toArray(): number[] }
        for (const i of Array.isArray(found) ? found : found.toArray())
          m2[rowOld[i].row] += area(intersection(part, rowOld[i].part))
      }
      interiorByRow = m2.map((x) => x / SQ_M_PER_HA)
    }
    return {
      year,
      rows: unit.rows.map((r, j): MackenzieRowYear => {
        const cflbHa = cflbM2[j] / SQ_M_PER_HA
        const requiredOldHa = (cflbHa * r.oldPercent) / 100
        const deadOldHa = sums[j].dead / SQ_M_PER_HA
        const allowance = liveOldAllowance({
          requiredOldHa,
          deadOldHa,
          affectedPercent: settings.affectedPercent,
          youngerSupplyHa: settings.youngerFromAge === null ? null : sums[j].younger / SQ_M_PER_HA,
        })
        const out: MackenzieRowYear = {
          row: r.id,
          cflbHa,
          requiredOldHa,
          oldHa: sums[j].old / SQ_M_PER_HA,
          deadOldHa,
          nfaHa: allowance.nfaHa,
          unknownAgeHa: sums[j].unknown / SQ_M_PER_HA,
          requiredInteriorHa: r.interiorPercent === null ? null : (requiredOldHa * r.interiorPercent) / 100,
          interiorHa: interiorByRow[j],
        }
        if (allowance.youngerHa !== null) {
          out.youngerSupplyHa = sums[j].younger / SQ_M_PER_HA
          out.youngerHa = allowance.youngerHa
        }
        return out
      }),
    }
  })
}

export interface MackenzieShortfall {
  year: number
  what: string[]
}

/** The first year a row falls short of old or old interior forest, or null. */
export function mackenzieShortfall(years: MackenzieYear[], unit: MackenzieUnit): MackenzieShortfall | null {
  for (const y of years) {
    const what: string[] = []
    y.rows.forEach((r) => {
      const row = unit.rows.find((x) => x.id === r.row)
      const name = row ? rowName(row) : r.row
      if (heldOld(r) < r.requiredOldHa) what.push(`old (${name})`)
      if (r.interiorHa !== null && r.requiredInteriorHa !== null && r.interiorHa < r.requiredInteriorHa)
        what.push(`old interior (${name})`)
    })
    if (what.length) return { year: y.year, what }
  }
  return null
}

/** The one wording of a schedule's outcome, for the panel, the record and the review's evidence. */
export function mackenzieShortfallText(years: MackenzieYear[], unit: MackenzieUnit): string {
  const short = mackenzieShortfall(years, unit)
  return short ? `short of ${short.what.join(', ')} from ${short.year}` : 'no shortfall over the projection'
}
