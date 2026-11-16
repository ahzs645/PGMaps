/**
 * LandXML `Superelevation` read into a road's curves and written from them.
 *
 * LandXML 1.2 gives each superelevated curve one `Superelevation` element inside its `Alignment`,
 * stations on the alignment's internal stations: `BeginRunoutSta` (normal crown, where the tangent
 * runout starts), `BeginRunoffSta` (the outside lane level, where the runoff starts), `FullSuperSta`
 * (full superelevation reached), `FullSuperelev` (the rate, %), `RunoffSta` (full superelevation
 * left), `StartofRunoutSta` (the outside lane level again), `EndofRunoutSta` (normal crown) and
 * `AdverseSE` (`adverse` slopes away from the curve's centre). Every child may be missing.
 *
 * Reading (`applyLandXmlSuperelevation`): each element goes to the curve it overlaps most (from full
 * superelevation reached to left, or its runoff where those are missing), and becomes that curve's
 * own values (`CurveSettings`): the rate as its superelevation, `FullSuperSta − BeginRunoffSta` and
 * `StartofRunoutSta − RunoffSta` as its runoff in and out, and the share of the runoff before the BC
 * (after the EC) as its transition fraction. A curve the file gives no element stays at normal
 * crown (superelevation 0), as the file has it. A runout before a runoff turns the road's tangent
 * runout on. An element on no curve, with full superelevation left before it is reached, with a rate
 * outside 0–20 %, or marked adverse (PGMaps rotates a section toward the curve's centre only) is
 * left out and said so. A rate written negative is read as its size toward the curve's centre.
 *
 * Writing (`landXmlSuperelevationXml`): one element per curve with superelevation, its stations where
 * the engine (`curveDesignAt`) puts them: the runoff ending `(1 − fraction) × runoff` inside the curve
 * (at the SC of a spiral, over the longer of runoff and spiral), the tangent runout before it at the
 * runoff's rate when the road has one, the rate positive and `AdverseSE` `non-adverse`.
 *
 * The element and its children are LandXML 1.2's; no RoadEng- or Civil 3D-written file with them was
 * available, so the reading was checked against hand-built files only (the guide says which).
 *
 * Pure: no DOM or network access.
 */
import { horizontalCurveSummary } from './engine'
import { evaluateCurveCriteria } from './roadCriteria'
import { sideValue, templateAt } from './templates'
import type { Alignment, CurveDesign, CurveSettings } from './types'

/** Superelevation elements read from one alignment. */
export const MAX_LANDXML_SUPERELEVATIONS = 2000
/** A curve's design speed when the file states none, km/h: the workspace's starting value. */
export const LANDXML_DEFAULT_SPEED_KMH = 40
/** Two runoff shares differing by more than this are reported; their mean is used. */
const FRACTION_TOLERANCE = 0.01

/** A minimal XML node (`landXmlImport.ts`'s reader). */
interface Node {
  name: string
  attributes: Record<string, string>
  children: Node[]
  text: string
}

export interface LandXmlSuperelevation {
  /** Internal stations, metres; null where the file leaves the element out. */
  beginRunout: number | null
  beginRunoff: number | null
  fullSuper: number | null
  runoff: number | null
  startOfRunout: number | null
  endOfRunout: number | null
  /** `FullSuperelev` as written, %. */
  ratePercent: number
  /** `AdverseSE`: true adverse, false non-adverse, null not stated. */
  adverse: boolean | null
}

/** An alignment's `Superelevation` elements and its first `DesignSpeed` (km/h), in metres. */
export function readLandXmlSuperelevation(
  alignment: Node,
  unitM: number,
  warnings: string[],
): { items: LandXmlSuperelevation[]; designSpeedKmh: number | null } {
  const items: LandXmlSuperelevation[] = []
  const nodes = alignment.children.filter((c) => c.name === 'Superelevation')
  if (nodes.length > MAX_LANDXML_SUPERELEVATIONS)
    throw Error(`An alignment has more than ${MAX_LANDXML_SUPERELEVATIONS} superelevation elements.`)
  for (const node of nodes) {
    const value = (name: string) => {
      const c = node.children.find((n) => n.name === name)
      const v = c ? Number(c.text.trim()) : NaN
      return c && c.text.trim() !== '' && Number.isFinite(v) ? v : null
    }
    const station = (name: string) => {
      const v = value(name)
      return v === null ? null : v * unitM
    }
    const rate = value('FullSuperelev')
    if (rate === null) {
      warnings.push('A superelevation element without a FullSuperelev rate is left out.')
      continue
    }
    const adverse = node.children.find((n) => n.name === 'AdverseSE')?.text.trim()
    items.push({
      beginRunout: station('BeginRunoutSta'),
      beginRunoff: station('BeginRunoffSta'),
      fullSuper: station('FullSuperSta'),
      runoff: station('RunoffSta'),
      startOfRunout: station('StartofRunoutSta'),
      endOfRunout: station('EndofRunoutSta'),
      ratePercent: rate,
      adverse: adverse === 'adverse' ? true : adverse === 'non-adverse' ? false : null,
    })
  }
  // LandXML gives a speed in the file's distance unit per hour: km/h, or mph in a foot file.
  const speedNode = alignment.children.find((c) => c.name === 'DesignSpeed')
  const speed = speedNode ? Number(speedNode.text.trim()) : NaN
  const designSpeedKmh =
    Number.isFinite(speed) && speed > 0 ? Math.round(speed * (unitM === 1 ? 1 : 1.609344) * 1e6) / 1e6 : null
  return { items, designSpeedKmh }
}

const fmt = (v: number, digits = 3) => String(Math.round(v * 10 ** digits) / 10 ** digits)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * A road with the file's superelevation as each curve's own values and a curve rule to carry them
 * (the road's own, else one from the file: its design speed or {@link LANDXML_DEFAULT_SPEED_KMH},
 * e max the largest rate it states). Stations are moved to the road's chainage: minus the start
 * station, times `stationScale`. Unchanged when the file has no superelevation.
 */
export function applyLandXmlSuperelevation(
  alignment: Alignment,
  read: { items: LandXmlSuperelevation[]; designSpeedKmh: number | null },
  options: {
    startStation: number
    stationScale: number
    /**
     * Each curve's (or curve run's) BC and EC on the file's own stations, in the road's curve order.
     * Given for every curve, items are placed and their shares measured on them, exactly as the
     * file states; else on the road's chainage, where its sphere moves the BC by a few centimetres.
     */
    curveStations?: { start: number; end: number }[]
  },
): { alignment: Alignment; warnings: string[]; notes: string[] } {
  const warnings: string[] = []
  const notes: string[] = []
  if (!read.items.length) return { alignment, warnings, notes }
  let curves: ReturnType<typeof horizontalCurveSummary>
  try {
    curves = horizontalCurveSummary(alignment)
  } catch {
    return { alignment, warnings: ['The superelevation is left out: the road’s curves could not be fitted.'], notes }
  }
  // Stations to measure on: the file's own where it gives every curve's, else the road's chainage.
  const fileStations = options.curveStations?.length === curves.length ? options.curveStations : null
  const at = (station: number | null) =>
    station === null ? null : fileStations ? station : (station - options.startStation) * options.stationScale
  const span = (k: number) =>
    fileStations
      ? {
          start: fileStations[k].start,
          end: fileStations[k].end,
          fullStart: fileStations[k].start,
          fullEnd: fileStations[k].end,
        }
      : curves[k]
  const length = (v: number) => (fileStations ? v * options.stationScale : v)
  const own = new Map<string, CurveSettings>()
  let runout = false
  for (const item of read.items) {
    const where = `The superelevation of ${fmt(item.ratePercent, 2)} % from station ${fmt(item.fullSuper ?? item.beginRunoff ?? NaN)}`
    if (item.adverse) {
      warnings.push(`${where} is adverse (sloping away from the curve's centre) and is left out.`)
      continue
    }
    const rate = Math.abs(item.ratePercent)
    if (rate > 20) {
      warnings.push(`${where} is over 20 % and is left out.`)
      continue
    }
    const a = at(item.fullSuper ?? item.beginRunoff),
      b = at(item.runoff ?? item.startOfRunout)
    if (a === null || b === null || b < a - 1e-6) {
      warnings.push(
        `${where} ${a === null || b === null ? 'gives no stations' : 'leaves full superelevation before reaching it'} and is left out.`,
      )
      continue
    }
    // The curve it overlaps most, else the one around its middle.
    let best: { k: number; overlap: number } | null = null
    for (let k = 0; k < curves.length; k++) {
      const s = span(k)
      const overlap = Math.min(b, s.fullEnd) - Math.max(a, s.fullStart)
      const mid = (a + b) / 2
      const around = mid >= s.fullStart - 1e-6 && mid <= s.fullEnd + 1e-6
      if ((overlap > 1e-6 || around) && (!best || overlap > best.overlap)) best = { k, overlap }
    }
    if (!best) {
      warnings.push(`${where} lies on no curve of the road and is left out.`)
      continue
    }
    const curve = curves[best.k],
      bounds = span(best.k)
    if (own.has(curve.pointId)) {
      warnings.push(`${where} is a second one on the curve at ${fmt(curve.start, 1)} m and is left out.`)
      continue
    }
    if (item.ratePercent < 0)
      notes.push(`${where} is written negative; it is read as ${fmt(rate, 2)} % toward the curve's centre.`)
    const settings: CurveSettings = { superelevationPercent: rate }
    const beginRunoff = at(item.beginRunoff),
      startOfRunout = at(item.startOfRunout)
    const runoffIn = beginRunoff !== null ? a - beginRunoff : null
    const runoffOut = startOfRunout !== null ? startOfRunout - b : null
    if (runoffIn !== null && runoffIn >= 0 && length(runoffIn) <= 1000)
      settings.runoffInM = Math.round(length(runoffIn) * 1000) / 1000
    if (runoffOut !== null && runoffOut >= 0 && length(runoffOut) <= 1000)
      settings.runoffOutM = Math.round(length(runoffOut) * 1000) / 1000
    // The share of each runoff outside a simple curve; a spiral's runoff ends at its SC.
    if (!curve.spiralInLengthM && !curve.spiralOutLengthM) {
      const shares: number[] = []
      if (settings.runoffInM) shares.push((bounds.start - beginRunoff!) / runoffIn!)
      if (settings.runoffOutM) shares.push((startOfRunout! - bounds.end) / runoffOut!)
      if (!shares.length && Math.abs(a - bounds.start) <= 0.01 && Math.abs(b - bounds.end) <= 0.01) shares.push(1)
      if (shares.length) {
        if (shares.some((s) => s < -FRACTION_TOLERANCE || s > 1 + FRACTION_TOLERANCE))
          warnings.push(`${where} runs its runoff outside the tangent next to the curve; the share is held to 0–100 %.`)
        if (shares.length === 2 && Math.abs(shares[0] - shares[1]) > FRACTION_TOLERANCE)
          notes.push(
            `${where} has ${fmt(100 * shares[0], 1)} % of its runoff before the curve and ${fmt(100 * shares[1], 1)} % after; the curve takes their mean.`,
          )
        settings.transitionFraction =
          Math.round(clamp(shares.reduce((x, y) => x + y, 0) / shares.length, 0, 1) * 1e6) / 1e6
      }
    }
    if (item.beginRunout !== null && item.beginRunoff !== null && item.beginRunout < item.beginRunoff - 1e-6)
      runout = true
    own.set(curve.pointId, settings)
  }
  const used = [...own.values()]
  if (!used.length) return { alignment, warnings, notes }
  const largest = Math.max(...used.map((s) => s.superelevationPercent ?? 0))
  const runoffs = used.flatMap((s) => [s.runoffInM, s.runoffOutM]).filter((v): v is number => v !== undefined)
  const counts = new Map<number, number>()
  for (const r of runoffs) counts.set(r, (counts.get(r) ?? 0) + 1)
  const commonRunoff = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0]?.[0] ?? 0
  const design: CurveDesign = alignment.curveDesign ?? {
    criteriaName: 'LandXML superelevation',
    criteriaSource: `Read from the LandXML file: each curve's superelevation and runoff as the file states them${read.designSpeedKmh ? ', and its design speed' : ''}; e max is the largest rate it states.`,
    designSpeedKmh: clamp(read.designSpeedKmh ?? LANDXML_DEFAULT_SPEED_KMH, 1, 150),
    maxSuperelevationPercent: largest,
    sideFrictionFactor: 0.15,
    runoffLengthM: clamp(commonRunoff, 0, 1000),
    wideningVehicleLengthM: null,
  }
  if (!alignment.curveDesign)
    notes.push(
      read.designSpeedKmh
        ? `The road's curve rule takes the file's design speed, ${fmt(read.designSpeedKmh, 1)} km/h, and e max ${fmt(largest, 2)} %, the largest rate it states.`
        : `The file states no design speed: the road's curve rule starts at ${LANDXML_DEFAULT_SPEED_KMH} km/h with e max ${fmt(largest, 2)} %, the largest rate it states. Set the road's design speed under Curves.`,
    )
  const withRunout = runout && !design.tangentRunout ? { ...design, tangentRunout: true } : design
  // A curve the file gives no superelevation stays at normal crown.
  const points = alignment.points.map((p) => {
    const read = own.get(p.id)
    if (read) return { ...p, curve: { ...p.curve, ...read } }
    if (!curves.some((c) => c.pointId === p.id)) return p
    return { ...p, curve: { ...p.curve, superelevationPercent: 0 } }
  })
  const flat = curves.length - own.size
  notes.push(
    `Superelevation read for ${own.size} of ${curves.length} curve${curves.length === 1 ? '' : 's'}${flat ? `; ${flat} without one in the file stay${flat === 1 ? 's' : ''} at normal crown` : ''}${runout ? '; the file has tangent runouts, so the road turns its outside lane first' : ''}.`,
  )
  return { alignment: { ...alignment, points, curveDesign: withRunout }, warnings, notes }
}

/**
 * The road's superelevation as LandXML `Superelevation` elements, one per curve with superelevation,
 * stations on the file's internal stations (`offset` plus chainage). Empty without a curve rule.
 */
export function landXmlSuperelevationXml(alignment: Alignment, offset = 0): string[] {
  const design = alignment.curveDesign
  if (!design || !(design.designSpeedKmh > 0)) return []
  let curves: ReturnType<typeof horizontalCurveSummary>
  try {
    curves = horizontalCurveSummary(alignment)
  } catch {
    return []
  }
  const n = (v: number) => (Math.round((offset + v) * 1e6) / 1e6).toFixed(6)
  const out: string[] = []
  for (const curve of curves) {
    const point = alignment.points.find((p) => p.id === curve.pointId)
    let c: ReturnType<typeof evaluateCurveCriteria>
    try {
      c = evaluateCurveCriteria(design, curve.radius, curve.deflectionDegrees, point?.curve)
    } catch {
      continue
    }
    const e = c.appliedSuperelevationPercent
    if (!(e > 0)) continue
    const side = (which: 'in' | 'out') => {
      const spiral = which === 'in' ? curve.spiralInLengthM : curve.spiralOutLengthM
      const runoff = Math.max(0, which === 'in' ? c.runoffInM : c.runoffOutM)
      const length = spiral > 0 ? Math.max(runoff, spiral) : runoff
      const intoArc = (1 - (spiral > 0 ? 1 : clamp(c.transitionFraction, 0, 1))) * length
      const full = which === 'in' ? curve.start + intoArc : curve.end - intoArc
      const level = which === 'in' ? full - length : full + length
      let runout = 0
      if (design.tangentRunout) {
        const template = templateAt(alignment, which === 'in' ? curve.start : curve.end).template
        const insideSide = curve.direction
        const outsideCrown = sideValue(template, insideSide === 'left' ? 'right' : 'left', 'CrossfallPercent')
        const target = Math.max(e, sideValue(template, insideSide, 'CrossfallPercent'))
        runout = target > 0 && outsideCrown > 0 ? (length * outsideCrown) / target : 0
      }
      const crown = which === 'in' ? level - runout : level + runout
      return { full, level, crown }
    }
    const into = side('in'),
      away = side('out')
    out.push(
      `<Superelevation staStart="${n(into.crown)}" staEnd="${n(away.crown)}">` +
        `<BeginRunoutSta>${n(into.crown)}</BeginRunoutSta>` +
        `<BeginRunoffSta>${n(into.level)}</BeginRunoffSta>` +
        `<FullSuperSta>${n(into.full)}</FullSuperSta>` +
        `<FullSuperelev>${(Math.round(e * 1e6) / 1e6).toFixed(6)}</FullSuperelev>` +
        `<RunoffSta>${n(away.full)}</RunoffSta>` +
        `<StartofRunoutSta>${n(away.level)}</StartofRunoutSta>` +
        `<EndofRunoutSta>${n(away.crown)}</EndofRunoutSta>` +
        `<AdverseSE>non-adverse</AdverseSE>` +
        `</Superelevation>`,
    )
  }
  return out
}
