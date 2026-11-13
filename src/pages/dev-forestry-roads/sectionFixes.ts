/**
 * Why a road's sections are incomplete, stretch by stretch, and the fixes that would close them.
 * Each stretch is a run of consecutive stations whose batter missed the ground on the same side, in
 * the same way (cut or fill, past the reach or off the terrain). Its ground cross-slope is measured
 * from the section beyond the formation and set against the template batter, because that comparison
 * decides every fix: a batter steeper than the ground meets it eventually, so a longer reach finds the
 * catch point; one no steeper never does, so the reach cannot help and the section has to change.
 *
 * A fix is a proposal. Only `steepFillPlan` builds an edit, and the page applies it on the reader's
 * click, as one undo step. No DOM.
 */
import { MAX_SECTION_REACH_M } from './sectionLimits'
import { batterMisses, planSectionRange, type SectionRangePlan } from './sectionRangeApply'
import { sideValue, templateAt, validateTemplate } from './templates'
import type { Alignment, RoadStation } from './types'

/** Ground within this many percentage points of the batter is treated as running parallel to it. */
export const PARALLEL_MARGIN_PERCENT = 3
/** Extra reach past the estimated catch point, so the section closes with room to spare. */
export const REACH_SPARE_M = 3
/** The steepest fill batter offered (H:V): 1:1, a rock fill's slope. */
export const STEEP_FILL_HV = 1
/**
 * Side slope from which a fill stretch leads with full bench and end haul. A screen, not a BC rule:
 * forest road manuals put loose sidecast fill near its limit at about 60 % (NZ Forest Road
 * Engineering Manual; FAO Watershed Management Field Manual recommends end haul above 60 %), and
 * some guidance considers full bench from 50–55 %. A steeper fill there closes the section for
 * quantities but is not a design until someone signs that the material holds.
 */
export const FULL_BENCH_SIDESLOPE_PERCENT = 60
/**
 * Fill ranges whose gap is at most this are joined, so the fill toe does not step between the
 * template batter and 1:1 every few stations.
 */
export const STEEP_FILL_JOIN_GAP_M = 50

type Station = Pick<
  RoadStation,
  'index' | 'chainage' | 'flags' | 'section' | 'leftWidth' | 'rightWidth' | 'complete' | 'incompleteReasons'
>

export interface IncompleteStretch {
  from: number
  to: number
  stations: number
  side: 'left' | 'right'
  batter: 'cut' | 'fill' | 'unknown'
  cause: 'reach' | 'terrain'
  /**
   * The ground's slope beyond the formation, in the batter's own direction: how fast it falls away
   * under a fill or rises above a cut. Median over the stretch; null where no section measured it.
   */
  groundPercent: number | null
  /** The template batter on that side, as a percentage (100 / H:V). */
  batterPercent: number | null
  /** The reach that would find the catch point at every station, when the batter converges everywhere. */
  reachNeededM: number | null
  /**
   * The stations either side of the stretch (its own ends at the road's ends). A section given to the
   * stretch runs to them: the engine calculates a range's ends as stations of their own, and the one
   * just outside keeps the old section, so a range ending on the stretch's last station leaves it open.
   */
  rangeFrom: number
  rangeTo: number
}

export type StretchFix =
  /** The batter meets the ground a little farther out. */
  | { kind: 'reach'; reachM: number }
  /** A 1:1 fill (rock fill) is steeper than the ground, so it catches. */
  | { kind: 'steep-fill'; slopePercent: number }
  /** The ground is too steep for any fill: full bench (formation into cut) or end haul. */
  | { kind: 'full-bench' }
  /** The ground rises at least as steeply as the cut batter: a steeper rock cut or a wall. */
  | { kind: 'steeper-cut' }
  /** The ground ran out before the batter met it. */
  | { kind: 'terrain' }

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Least-squares slope of ground against distance out from the centreline, beyond the formation. */
function outwardGroundSlope(station: Station, side: 'left' | 'right'): number | null {
  const half = side === 'left' ? station.leftWidth : station.rightWidth
  const points = station.section
    .filter((p) => p.ground !== null && Number.isFinite(p.ground) && (side === 'left' ? -p.offset : p.offset) > half)
    .map((p) => ({ d: Math.abs(p.offset), z: p.ground! }))
  if (points.length < 2) return null
  const md = points.reduce((s, p) => s + p.d, 0) / points.length,
    mz = points.reduce((s, p) => s + p.z, 0) / points.length
  const sxx = points.reduce((s, p) => s + (p.d - md) ** 2, 0)
  if (sxx <= 0) return null
  return points.reduce((s, p) => s + (p.d - md) * (p.z - mz), 0) / sxx
}

/** The outermost designed point on a side: where a batter that missed the ground was stopped. */
function batterEnd(station: Station, side: 'left' | 'right') {
  return station.section.reduce<(typeof station.section)[number] | undefined>(
    (outer, p) =>
      p.design !== null &&
      (side === 'left' ? p.offset < 0 : p.offset > 0) &&
      (!outer || Math.abs(p.offset) > Math.abs(outer.offset))
        ? p
        : outer,
    undefined,
  )
}

/** The incomplete stations of a road grouped into stretches, in station order. */
export function incompleteStretches(
  stations: readonly Station[],
  alignment: Pick<Alignment, 'template' | 'engineering'>,
): IncompleteStretch[] {
  type Open = {
    key: string
    lastIndex: number
    rows: {
      station: Station
      position: number
      ground: number | null
      need: number | null
      batter: number | null
    }[]
  } & Pick<IncompleteStretch, 'side' | 'batter' | 'cause'>
  const open = new Map<string, Open>()
  const done: Open[] = []
  for (const [position, station] of stations.entries()) {
    const misses = batterMisses([station], station.chainage, station.chainage)
    const seen = new Set<string>()
    for (const miss of misses) {
      const key = `${miss.side}|${miss.batter}|${miss.cause}`
      seen.add(key)
      const template = templateAt(alignment as Alignment, station.chainage).template
      const slopeHV =
        miss.batter === 'cut'
          ? sideValue(template, miss.side, 'CutSlope')
          : miss.batter === 'fill'
            ? sideValue(template, miss.side, 'FillSlope')
            : 0
      const batter = slopeHV > 0 ? 100 / slopeHV : null
      const slope = outwardGroundSlope(station, miss.side)
      const ground = slope === null ? null : (miss.batter === 'cut' ? slope : -slope) * 100
      // Where the batter was stopped, the gap still to close and how fast the two lines meet.
      let need: number | null = null
      const end = batterEnd(station, miss.side)
      if (
        miss.cause === 'reach' &&
        end &&
        end.ground !== null &&
        end.design !== null &&
        batter !== null &&
        ground !== null
      ) {
        const closing = (batter - ground) / 100
        if (closing * 100 > PARALLEL_MARGIN_PERCENT)
          need = Math.abs(end.offset) + Math.abs(end.ground - end.design) / closing + REACH_SPARE_M
      }
      let run = open.get(key)
      if (!run || run.lastIndex !== station.index - 1) {
        if (run) done.push(run)
        run = { key, lastIndex: station.index, rows: [], side: miss.side, batter: miss.batter, cause: miss.cause }
        open.set(key, run)
      }
      run.lastIndex = station.index
      run.rows.push({ station, position, ground, need, batter })
    }
    for (const [key, run] of open)
      if (!seen.has(key) && run.lastIndex !== station.index) {
        done.push(run)
        open.delete(key)
      }
  }
  done.push(...open.values())
  return done
    .map((run) => {
      const needs = run.rows.map((r) => r.need)
      return {
        from: run.rows[0].station.chainage,
        to: run.rows.at(-1)!.station.chainage,
        stations: run.rows.length,
        side: run.side,
        batter: run.batter,
        cause: run.cause,
        groundPercent: median(run.rows.flatMap((r) => (r.ground === null ? [] : [r.ground]))),
        batterPercent: median(run.rows.flatMap((r) => (r.batter === null ? [] : [r.batter]))),
        reachNeededM: needs.every((n) => n !== null) ? Math.max(...(needs as number[])) : null,
        rangeFrom: (stations[run.rows[0].position - 1] ?? run.rows[0].station).chainage,
        rangeTo: (stations[run.rows.at(-1)!.position + 1] ?? run.rows.at(-1)!.station).chainage,
      }
    })
    .sort((a, b) => a.from - b.from || a.side.localeCompare(b.side))
}

/** The fixes that would close a stretch, most direct first. */
export function stretchFixes(stretch: IncompleteStretch): StretchFix[] {
  if (stretch.cause === 'terrain') return [{ kind: 'terrain' }]
  const fixes: StretchFix[] = []
  const steepPercent = 100 / STEEP_FILL_HV
  const ground = stretch.groundPercent
  if (stretch.batter === 'fill' && ground !== null) {
    const steepFits =
      ground < steepPercent - PARALLEL_MARGIN_PERCENT &&
      (stretch.batterPercent === null || stretch.batterPercent < steepPercent)
    // On steep sidehill the design answer is a full bench; a 1:1 fill stays offered after it.
    if (ground >= FULL_BENCH_SIDESLOPE_PERCENT || !steepFits) fixes.push({ kind: 'full-bench' })
    if (steepFits) fixes.push({ kind: 'steep-fill', slopePercent: steepPercent })
  }
  if (stretch.reachNeededM !== null && stretch.reachNeededM <= MAX_SECTION_REACH_M)
    fixes.push({ kind: 'reach', reachM: Math.ceil(stretch.reachNeededM / 5) * 5 })
  if (stretch.batter === 'cut' && stretch.reachNeededM === null) fixes.push({ kind: 'steeper-cut' })
  return fixes
}

/**
 * The road with a 1:1 fill (`STEEP_FILL_HV`) on the failing side of each stretch, given through its
 * template station assignments from the station before the stretch to the station after it
 * (`rangeFrom`–`rangeTo`). Stretches whose ranges overlap share one range with each failing side
 * steepened; ranges built on the same section and sides share one new template. Every other part of
 * the section is the one already there. No key is added: a key wider than a shallow fill leaves the
 * section open. Returns the reason instead when a range already holds template ranges, which the
 * reader changes through **Use this section for…**, where that is asked first.
 */
export function steepFillPlan(
  alignment: Alignment,
  stretches: readonly Pick<IncompleteStretch, 'from' | 'side' | 'rangeFrom' | 'rangeTo'>[],
  roadLength: number,
  options: { id: () => string; stationLabel: (chainage: number) => string },
): { alignment: Alignment; templates: number } | { error: string } {
  // Overlapping or nearby stretches (left and right at once, or runs a few stations apart) become one
  // range, so the toe does not step back and forth between the two batters.
  const ranges: { from: number; to: number; sides: Set<'left' | 'right'>; first: number }[] = []
  for (const stretch of [...stretches].sort((a, b) => a.rangeFrom - b.rangeFrom)) {
    const last = ranges.at(-1)
    if (last && stretch.rangeFrom - last.to <= STEEP_FILL_JOIN_GAP_M) {
      last.to = Math.max(last.to, stretch.rangeTo)
      last.sides.add(stretch.side)
    } else
      ranges.push({ from: stretch.rangeFrom, to: stretch.rangeTo, sides: new Set([stretch.side]), first: stretch.from })
  }
  let current = alignment
  const made = new Map<string, string>()
  for (const range of ranges) {
    const base = templateAt(current, (range.from + range.to) / 2).template
    const sides = [...range.sides].sort()
    const key = JSON.stringify([base, sides])
    const existing = made.get(key)
    const from = Math.max(0, range.from),
      to = Math.min(roadLength, Math.max(range.to, from + 1))
    let source: Parameters<typeof planSectionRange>[4]['source']
    if (existing) source = { kind: 'named', templateId: existing, name: '1:1 fill' }
    else {
      const template = { ...base }
      for (const side of sides) template[`${side}FillSlope`] = STEEP_FILL_HV
      validateTemplate(template)
      source = {
        kind: 'snapshot',
        template,
        name: uniqueName(current, `1:1 fill ${sides.join(' and ')} ${options.stationLabel(range.first)}`),
      }
    }
    const result = planSectionRange(current, from, [from, to], roadLength, { ...options, source })
    if ('error' in result) return result
    const plan: SectionRangePlan = result.plan
    if (plan.affected.length)
      return {
        error: `${options.stationLabel(from)}–${options.stationLabel(to)} already has template ranges. Give it the steeper fill with Use this section for…, which asks before changing them.`,
      }
    if (!existing) made.set(key, plan.engineering.templates.at(-1)!.id)
    current = { ...current, engineering: plan.engineering }
  }
  return { alignment: current, templates: made.size }
}

function uniqueName(alignment: Alignment, base: string) {
  const taken = new Set(alignment.engineering?.templates.map((t) => t.name) ?? [])
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`
  return name
}
