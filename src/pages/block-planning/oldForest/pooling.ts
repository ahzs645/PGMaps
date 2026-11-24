/**
 * D.2 of the 2004 order: "where a forest licensee has similar mBECs in multiple forest districts,
 * licensees and BC Timber Sales, may meet the combined requirement of those objectives over the
 * combined area of the mBECs."
 *
 * Pooling is the reviewer's choice and never the default (docs/forestry-old-forest.md, decision 5).
 * Each pooled unit is read and calculated exactly as one unit alone, with its own old age, its own
 * percentages and its own CFLB (stated or proxy). The pool's requirement is the sum of each unit's
 * CFLB × its own percentage, and what it holds the sum across units. Units that overlap on the
 * ground are refused (`poolOverlaps`), so no hectare is counted twice. D.4's ceiling is applied
 * again to the pool's sums (`withYoungerCap`).
 *
 * DOM- and network-free.
 */
import type { Position } from 'geojson'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import { lngLatToAlbers } from '../../dev-avast/projection'
import type { Shape } from '../plan'
import { MAX_STANDS } from './reads'
import type { YearFigures } from './oldForest'
import { withYoungerCap } from './youngerStands'

/**
 * Overlap between two pooled units' Map 2 polygons at or above this (100 m²) is refused. Map 2's
 * units share their boundaries exactly (A5 and A10, and A6 and A10, touch with 0 m² in common), so
 * this only allows for arithmetic noise; any real ground in two units is refused.
 */
export const POOL_OVERLAP_TOLERANCE_HA = 0.01

const SQ_M_PER_HA = 10_000
const factory = new GeometryFactory()
const reader = new GeoJSONReader(factory)

function albers(shape: Shape): Geometry {
  const ring = (r: Position[]) => r.map(([x, y]) => lngLatToAlbers(x, y))
  const coordinates =
    shape.type === 'Polygon' ? shape.coordinates.map(ring) : shape.coordinates.map((poly) => poly.map(ring))
  let g = reader.read({ type: shape.type, coordinates })
  if (!IsValidOp.isValid(g)) g = BufferOp.bufferOp(g, 0)
  return g
}

export interface PoolOverlap {
  a: string
  b: string
  ha: number
}

/** Every pair of pooled units whose ground overlaps by `POOL_OVERLAP_TOLERANCE_HA` or more. */
export function poolOverlaps(units: { label: string; shape: Shape }[]): PoolOverlap[] {
  const geoms = units.map((u) => ({ label: u.label, g: albers(u.shape) }))
  const out: PoolOverlap[] = []
  for (let i = 0; i < geoms.length; i++)
    for (let j = i + 1; j < geoms.length; j++) {
      const a = geoms[i].g,
        b = geoms[j].g
      if (!a.getEnvelopeInternal().intersects(b.getEnvelopeInternal())) continue
      const ha = OverlayOp.intersection(a, b).getArea() / SQ_M_PER_HA
      if (ha >= POOL_OVERLAP_TOLERANCE_HA) out.push({ a: geoms[i].label, b: geoms[j].label, ha })
    }
  return out
}

/** The refusal for overlapping pooled units: no figures, because ground would be counted twice. */
export function overlapRefusal(overlaps: PoolOverlap[]): string {
  const pairs = overlaps
    .map((o) => `${o.a} and ${o.b} (${o.ha < 1 ? o.ha.toFixed(2) : Math.round(o.ha).toLocaleString()} ha)`)
    .join('; ')
  return `The pooled units overlap on the ground: ${pairs}. D.2 pools separate units; ground in two of them would be counted twice, so nothing was calculated.`
}

/** The refusal for a unit too large to read live (A13, the large E and D units), alone or pooled. */
export function tooLargeRefusal(unit: string, pooled: boolean): string {
  return `${unit} has more than ${MAX_STANDS.toLocaleString()} VRI stands, too many to read live. ${pooled ? 'Pooling' : 'Assessing'} it needs the prepared tables (docs/research/block-planning-prepared-tables-2026-11-24.md), which are not built yet.`
}

/** True when a read stopped at its record cap (`reads.ts`): the unit is too large to read live. */
export const isTooLarge = (error: unknown) =>
  error instanceof Error && /^More than [\d,.\s]+ (records|VRI stands)/.test(error.message)

/**
 * The pool's figures, year by year: each requirement and holding summed across units. Every unit
 * must carry the same years, and interior in the same years. The non-pine minimum is summed over the
 * units that state one, and set against those units' non-pine old forest only.
 */
export function poolFigures(units: YearFigures[][]): YearFigures[] {
  if (!units.length) throw Error('A pool needs at least one unit.')
  const [first] = units
  return first.map((_, i) => {
    const years = units.map((u) => {
      const y = u[i]
      if (!y || y.year !== first[i].year) throw Error('Pooled units were calculated for different years.')
      return y
    })
    const sum = (pick: (y: YearFigures) => number) => years.reduce((s, y) => s + pick(y), 0)
    const sumOrNull = (pick: (y: YearFigures) => number | null | undefined) =>
      years.some((y) => pick(y) === null || pick(y) === undefined) ? null : sum((y) => pick(y)!)
    const stated = years.filter((y) => y.requiredNonPineHa !== null)
    const pooled: YearFigures = {
      year: first[i].year,
      cflbHa: sum((y) => y.cflbHa),
      requiredOldHa: sum((y) => y.requiredOldHa),
      oldHa: sum((y) => y.oldHa),
      countedNotOldHa: sum((y) => y.countedNotOldHa),
      requiredNonPineHa: stated.length ? stated.reduce((s, y) => s + y.requiredNonPineHa!, 0) : null,
      nonPineOldHa: (stated.length ? stated : years).reduce((s, y) => s + y.nonPineOldHa, 0),
      unknownAgeHa: sum((y) => y.unknownAgeHa),
      requiredInteriorHa: sum((y) => y.requiredInteriorHa),
      interiorHa: sumOrNull((y) => y.interiorHa),
    }
    if (years.every((y) => y.d4OldSupplyHa === undefined)) return pooled
    return withYoungerCap({
      ...pooled,
      d4OldSupplyHa: sum((y) => y.d4OldSupplyHa ?? 0),
      d4InteriorSupplyHa: sumOrNull((y) => y.d4InteriorSupplyHa ?? null),
    })
  })
}
