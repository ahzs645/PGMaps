/**
 * What the mass-haul diagram draws besides the cumulative balance: the road lengths whose earthwork
 * is unknown, the borrow and waste each site takes at its access station, and where on the road
 * each haul class works. No DOM: the chart, the tables and the tests read the same numbers.
 */
import type { AlignmentEngineering, HaulMovement } from './engineeringTypes'
import type { RoadAnalysis, RoadStation } from './types'

const EPS = 1e-7

export interface RoadSpan {
  start: number
  end: number
}

/**
 * Road lengths whose cut and fill are unknown, joined where they touch. An interval is unknown when
 * the section at either end is incomplete; it adds nothing to any total.
 */
export function unknownEarthworkSpans(
  stations: readonly Pick<RoadStation, 'chainage' | 'cutVolumeM3' | 'fillVolumeM3'>[],
): RoadSpan[] {
  const spans: RoadSpan[] = []
  for (let i = 1; i < stations.length; i++) {
    if (stations[i].cutVolumeM3 !== null && stations[i].fillVolumeM3 !== null) continue
    const last = spans.at(-1)
    if (last && Math.abs(last.end - stations[i - 1].chainage) < EPS) last.end = stations[i].chainage
    else spans.push({ start: stations[i - 1].chainage, end: stations[i].chainage })
  }
  return spans
}

/** Road length in `spans` that lies inside [from, to]. */
export function spanLengthWithin(spans: readonly RoadSpan[], from: number, to: number): number {
  return spans.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)), 0)
}

/** One borrow or waste site as the diagram shows it, at the station where its access meets the road. */
export interface MassHaulPit {
  siteId: string
  name: string
  kind: 'borrow' | 'waste'
  chainage: number
  /** As hauled: compacted m³ for borrow, bank m³ for waste. */
  volumeM3: number
  volumeBasis: 'compacted' | 'bank'
  /**
   * Change in the road's balance at this station, in the compacted m³ the curve is drawn in:
   * borrow adds; waste takes away the reusable cut it removes. Unusable cut was never in the curve.
   */
  stepM3: number
}

export interface HaulClassBand {
  category: HaulMovement['category']
  label: string
  /** Haul distance range of the class, metres; `toM` is null for the open-ended class. */
  fromM: number | null
  toM: number | null
  /** Cut-to-fill and borrow, compacted m³. */
  compactedM3: number
  /** Waste, bank m³. Never added to the compacted volume. */
  bankM3: number
  /** Road lengths a movement of this class travels over, joined where they overlap. */
  spans: RoadSpan[]
}

export interface MassHaulDiagram {
  /** Cumulative usable cut minus fill at each calculation station: the known earthwork so far. */
  balance: [chainage: number, massM3: number][]
  endBalanceM3: number | null
  unknown: RoadSpan[]
  unknownLengthM: number
  /** Null until haul is allocated. */
  haul: {
    pits: MassHaulPit[]
    /** The balance after each site's borrow and waste, stepping at the site's station. */
    afterSites: [chainage: number, massM3: number][]
    /** Where that line ends: zero when every surplus and deficit found a site. */
    closingM3: number
    classes: HaulClassBand[]
  } | null
}

const CLASS_ORDER = ['freehaul', 'overhaul', 'endhaul'] as const
const CLASS_LABELS: Record<HaulMovement['category'], string> = {
  freehaul: 'Free haul',
  overhaul: 'Overhaul',
  endhaul: 'End haul',
}

function joined(spans: RoadSpan[]): RoadSpan[] {
  const result: RoadSpan[] = []
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1)
    if (last && span.start <= last.end + EPS) last.end = Math.max(last.end, span.end)
    else result.push({ ...span })
  }
  return result
}

/**
 * The ordinate of a diagram line at any chainage, straight between its vertices and held past its
 * ends. At a pit's step it is the value after the step, or before it when asked.
 */
export function ordinateAt(
  line: readonly (readonly [number, number])[],
  chainage: number,
  side: 'before' | 'after' = 'after',
): number | null {
  if (!line.length) return null
  if (chainage <= line[0][0] && side === 'before') return line[0][1]
  if (chainage >= line[line.length - 1][0] && side === 'after') return line[line.length - 1][1]
  // The first vertex past the station on the wanted side of any step there.
  let i = line.findIndex((p) => (side === 'after' ? p[0] > chainage : p[0] >= chainage))
  if (i < 0) i = line.length - 1
  if (i === 0) return line[0][1]
  const [x0, y0] = line[i - 1],
    [x1, y1] = line[i]
  return x1 - x0 > EPS ? y0 + ((y1 - y0) * (chainage - x0)) / (x1 - x0) : side === 'after' ? y1 : y0
}

/**
 * `inputs` are the road's entered haul settings and sites. They only label what the allocation
 * already decided: the class bands get their distance limits and the pits their names.
 */
export function massHaulDiagram(
  analysis: RoadAnalysis,
  inputs?: Pick<AlignmentEngineering, 'haul' | 'sites'>,
): MassHaulDiagram {
  const balance = analysis.stations.flatMap((s): [number, number][] =>
    s.massM3 === null ? [] : [[s.chainage, s.massM3]],
  )
  const unknown = unknownEarthworkSpans(analysis.stations)
  const result: MassHaulDiagram = {
    balance,
    endBalanceM3: balance.at(-1)?.[1] ?? null,
    unknown,
    unknownLengthM: unknown.reduce((sum, s) => sum + s.end - s.start, 0),
    haul: null,
  }
  const engineering = analysis.engineering
  if (!engineering?.haul.enabled || !balance.length) return result

  // Every borrow and waste movement changes the balance where it joins or leaves the road. Sidecast
  // leaves at its own interval; only real sites are named as pits. A site between two stations
  // steps on the straight line the curve draws there; one registered a hair past the last station
  // (an exact road-end site) steps at the end.
  const first = balance[0][0],
    last = balance[balance.length - 1][0]
  const stepAt = new Map<number, number>()
  const pits = new Map<string, MassHaulPit>()
  for (const m of engineering.movements) {
    if (m.kind === 'cut-to-fill' || m.externalUnresolved) continue
    const borrow = m.kind === 'borrow'
    const chainage = Math.max(first, Math.min(last, borrow ? m.fromChainage : m.toChainage))
    const stepM3 = borrow ? m.transportedVolumeM3 : -(m.compactedVolumeM3 ?? 0)
    stepAt.set(chainage, (stepAt.get(chainage) ?? 0) + stepM3)
    if (m.disposalMethod === 'sidecast') continue
    const siteId = borrow ? m.sourceId : m.targetId
    const pit = pits.get(siteId)
    if (pit) {
      pit.volumeM3 += m.transportedVolumeM3
      pit.stepM3 += stepM3
    } else
      pits.set(siteId, {
        siteId,
        name: inputs?.sites.find((site) => site.id === siteId)?.name ?? (borrow ? 'Borrow site' : 'Waste site'),
        kind: m.kind,
        chainage,
        volumeM3: m.transportedVolumeM3,
        volumeBasis: m.volumeBasis,
        stepM3,
      })
  }
  const afterSites: [number, number][] = []
  let offset = 0,
    segment = 1
  for (const chainage of [...new Set([...balance.map((p) => p[0]), ...stepAt.keys()])].sort((a, b) => a - b)) {
    while (segment < balance.length - 1 && balance[segment][0] < chainage) segment++
    const [x0, y0] = balance[segment - 1],
      [x1, y1] = balance[Math.min(segment, balance.length - 1)]
    const base = x1 - x0 > EPS ? y0 + ((y1 - y0) * (chainage - x0)) / (x1 - x0) : y1
    afterSites.push([chainage, base + offset])
    const step = stepAt.get(chainage) ?? 0
    if (Math.abs(step) <= EPS) continue
    offset += step
    afterSites.push([chainage, base + offset])
  }

  const classes = CLASS_ORDER.map((category): HaulClassBand => {
    const movements = engineering.movements.filter(
      (m) => m.category === category && !m.externalUnresolved && m.disposalMethod !== 'sidecast',
    )
    const h = inputs?.haul
    const limits: [number | null, number | null] = !h
      ? [null, null]
      : category === 'freehaul'
        ? [0, h.freeHaulDistanceM]
        : category === 'overhaul'
          ? [h.freeHaulDistanceM, h.overhaulDistanceM]
          : [h.overhaulDistanceM, null]
    return {
      category,
      label: CLASS_LABELS[category],
      fromM: limits[0],
      toM: limits[1],
      compactedM3: movements
        .filter((m) => m.volumeBasis === 'compacted')
        .reduce((sum, m) => sum + m.transportedVolumeM3, 0),
      bankM3: movements.filter((m) => m.volumeBasis === 'bank').reduce((sum, m) => sum + m.transportedVolumeM3, 0),
      spans: joined(
        movements
          .map((m) => ({
            start: Math.min(m.fromChainage, m.toChainage),
            end: Math.max(m.fromChainage, m.toChainage),
          }))
          .filter((span) => span.end - span.start > EPS),
      ),
    }
  })
  result.haul = {
    pits: [...pits.values()].sort((a, b) => a.chainage - b.chainage),
    afterSites,
    closingM3: afterSites.at(-1)?.[1] ?? 0,
    classes,
  }
  return result
}
