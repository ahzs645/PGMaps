/**
 * The "Visuals" paragraph of a block's planning note, drafted from the run.
 *
 * Planners write the same four things for every block that overlaps an
 * established visual quality objective (EVQO), in the same order:
 *
 * 1. **Overlap** — which EVQO classes the block overlaps, and how much of it:
 *    "Most of the block…", "The eastern portion…", "very minor, just around
 *    the edges of the block boundary".
 * 2. **Visibility** — from each viewpoint, graded *will be*, *may be*, *may not
 *    be … due to screening*, *likely will not be … due to relatively flat
 *    terrain*, or *is not* visible; split by class when the classes differ.
 * 3. **Recommendations** — a WTRA in the visible overlap, a windfirm screen
 *    toward a road, not expanding toward the stricter class, an internal WTRA
 *    with irregular boundaries, and completing a VIA post layout.
 * 4. **Screenshots** — captioned "View from Hwy 97 going north".
 *
 * The rules were read off eight planners' paragraphs (BCTS Prince George,
 * 2026 blocks CHU_26_1–4 and ML_26_1–6); `visualsNarrative.test.ts` pins each
 * one's facts to its wording. Every sentence carries the measurement it was
 * written from, because the reviewer signs the paragraph, not this module: the
 * page shows it as a draft the reviewer edits, and their text wins.
 *
 * Pure: no DOM, no network.
 */
import type { AnalysisResult, TargetPolygon, TargetVisibility } from './types'
import { initialAlterationPercent, table2Range } from './via'
import {
  bearingDegrees,
  haversineMeters,
  metersPerDegree,
  pointInPolygon,
  polygonAreaMeters,
  polygonBounds,
  polygonGridSamples,
  preparePolygons,
  type PolygonGeometry,
} from './visibility'
import type { VisualQualityClassId } from './vqo'

export type EvqoCode = 'P' | 'R' | 'PR' | 'M' | 'MM'

export const EVQO_NAMES: Record<EvqoCode, string> = {
  P: 'Preservation',
  R: 'Retention',
  PR: 'Partial Retention',
  M: 'Modification',
  MM: 'Maximum Modification',
}

const RESTRICTIVENESS: Record<EvqoCode, number> = { P: 0, R: 1, PR: 2, M: 3, MM: 4 }

/**
 * How the EVQO polygons are coloured when draped in the road view. Retention
 * blue and partial retention brown follow the planner's Google Earth layer.
 */
export const EVQO_COLORS: Record<EvqoCode, string> = {
  P: '#7f1d1d',
  R: '#2563eb',
  PR: '#a16207',
  // Teal, not yellow: a block is often filled yellow for a screenshot.
  M: '#0d9488',
  MM: '#64748b',
}

export const EVQO_CODE_FOR_CLASS: Record<VisualQualityClassId, EvqoCode> = {
  preservation: 'P',
  retention: 'R',
  'partial-retention': 'PR',
  modification: 'M',
  'maximum-modification': 'MM',
}

/**
 * Where the wording changes. Exported so the docs and the panel can quote them;
 * they are judgement calls fitted to the reference paragraphs, not rules from
 * the handbook, and the reviewer edits the draft regardless.
 */
export const NARRATIVE_LIMITS = {
  /** Share of the block an overlap must exceed to read as the block overlapping it outright. */
  wholeBlockShare: 0.9,
  /** "Most of the block". */
  mostShare: 0.6,
  /** Below this an overlap is "very minor". */
  minorShare: 0.1,
  /** An overlap whose ground all lies this close to the boundary is "just around the edges". */
  edgeMeters: 50,
  /** Share of the block in view at which it "will be visible" rather than "may be". */
  willBeVisibleShare: 0.15,
  /** Unknown sightlines above this share leave visibility undetermined. */
  unknownShare: 0.5,
  /** The block rises or falls less than this from the viewpoint: "relatively flat terrain". */
  flatTerrainDegrees: 2,
  /** A road this close to the block boundary gets a windfirm screen. */
  screenRoadMeters: 100,
  /** Openings this close to the block are "adjacent blocks" for the post-layout VIA. */
  adjacentMeters: 1000,
} as const

export type CompassPoint = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest'

const COMPASS: readonly CompassPoint[] = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
]

export function compassPoint(bearing: number): CompassPoint {
  const normalised = ((bearing % 360) + 360) % 360
  return COMPASS[Math.round(normalised / 45) % 8]
}

/** "eastern", for "the eastern portion of the block". */
const ADJECTIVE: Record<CompassPoint, string> = {
  north: 'northern',
  northeast: 'northeastern',
  east: 'eastern',
  southeast: 'southeastern',
  south: 'southern',
  southwest: 'southwestern',
  west: 'western',
  northwest: 'northwestern',
}

/** "north or east", the way a note tells a layout crew which way not to go. */
const EXPANSION: Record<CompassPoint, string> = {
  north: 'north',
  northeast: 'north or east',
  east: 'east',
  southeast: 'south or east',
  south: 'south',
  southwest: 'south or west',
  west: 'west',
  northwest: 'north or west',
}

// ---------------------------------------------------------------------------
// Facts

export type EvqoUnit = { code: EvqoCode; geometry: PolygonGeometry }

export type ClassOverlap = {
  code: EvqoCode
  /** Share of the block's area, 0–1. */
  share: number
  areaHectares: number
  /** Which side of the block the overlap lies on, when it covers only part of it. */
  side: CompassPoint | null
  /** Every overlapping sample lies within `edgeMeters` of the block boundary. */
  edgeOnly: boolean
}

function ringsOf(geometry: PolygonGeometry): GeoJSON.Position[][] {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
}

/** Shortest distance from a point to the polygon's boundary, metres. */
export function distanceToBoundaryMeters(geometry: PolygonGeometry, lng: number, lat: number): number {
  const scale = metersPerDegree(lat)
  let best = Infinity
  for (const ring of ringsOf(geometry)) {
    for (let i = 1; i < ring.length; i += 1) {
      const ax = (ring[i - 1][0] - lng) * scale.lng,
        ay = (ring[i - 1][1] - lat) * scale.lat
      const bx = (ring[i][0] - lng) * scale.lng,
        by = (ring[i][1] - lat) * scale.lat
      const dx = bx - ax,
        dy = by - ay
      const length = dx * dx + dy * dy
      const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

/** Shortest distance between a line and a polygon's boundary, metres; 0 when the line enters it. */
export function lineToPolygonMeters(geometry: PolygonGeometry, coordinates: ReadonlyArray<[number, number]>): number {
  let best = Infinity
  for (let i = 0; i < coordinates.length; i += 1) {
    const [lng, lat] = coordinates[i]
    if (pointInPolygon(geometry, lng, lat)) return 0
    best = Math.min(best, distanceToBoundaryMeters(geometry, lng, lat))
    // A long segment can pass the block between its vertices: test its midpoints too.
    if (i > 0) {
      const [plng, plat] = coordinates[i - 1]
      const span = haversineMeters({ lng, lat }, { lng: plng, lat: plat })
      const parts = Math.min(50, Math.floor(span / 25))
      for (let k = 1; k < parts; k += 1) {
        const f = k / parts
        const x = plng + (lng - plng) * f,
          y = plat + (lat - plat) * f
        if (pointInPolygon(geometry, x, y)) return 0
        best = Math.min(best, distanceToBoundaryMeters(geometry, x, y))
      }
    }
  }
  return best
}

/**
 * How the block sits over the EVQO polygons, sampled on a grid fine enough
 * that a 1% sliver along the edge still lands samples (about 2,500 per block).
 * A sample in two units counts toward the stricter one.
 */
export function evqoOverlaps(block: PolygonGeometry, units: ReadonlyArray<EvqoUnit>): ClassOverlap[] {
  const area = polygonAreaMeters(block)
  if (!(area > 0)) return []
  const samples = polygonGridSamples(block, Math.max(5, Math.sqrt(area / 2500)))
  if (!samples.length) return []
  const [west, south, east, north] = polygonBounds(block)
  // Strictest first, each unit prepared once (parts clipped to the block's box, rings banded): the first
  // unit containing a sample is then its stricter one. A `pointInPolygon` per sample per unit was about
  // 100–150 ms on every scene change.
  const relevant = units
    .filter((unit) => {
      const b = polygonBounds(unit.geometry)
      return b[0] <= east && b[2] >= west && b[1] <= north && b[3] >= south
    })
    .sort((a, b) => RESTRICTIVENESS[a.code] - RESTRICTIVENESS[b.code])
    .map((unit) => ({ code: unit.code, prepared: preparePolygons([unit.geometry], [west, south, east, north]) }))
  const total = samples.reduce((sum, sample) => sum + sample.areaMeters, 0)
  const centre = samples.reduce(
    (sum, sample) => ({ lng: sum.lng + sample.lng / samples.length, lat: sum.lat + sample.lat / samples.length }),
    { lng: 0, lat: 0 },
  )
  const tally = new Map<EvqoCode, { area: number; lng: number; lat: number; count: number; edge: boolean }>()
  for (const sample of samples) {
    const code = relevant.find((unit) => unit.prepared.contains(sample.lng, sample.lat))?.code ?? null
    if (!code) continue
    const entry = tally.get(code) ?? { area: 0, lng: 0, lat: 0, count: 0, edge: true }
    entry.area += sample.areaMeters
    entry.lng += sample.lng
    entry.lat += sample.lat
    entry.count += 1
    if (entry.edge && distanceToBoundaryMeters(block, sample.lng, sample.lat) > NARRATIVE_LIMITS.edgeMeters)
      entry.edge = false
    tally.set(code, entry)
  }
  return [...tally]
    .map(([code, entry]): ClassOverlap => {
      const share = entry.area / total
      const middle = { lng: entry.lng / entry.count, lat: entry.lat / entry.count }
      const offset = haversineMeters(centre, middle)
      return {
        code,
        share,
        areaHectares: (share * area) / 10_000,
        // A part of the block has a side; the whole of it does not.
        side: share < NARRATIVE_LIMITS.mostShare && offset > 1 ? compassPoint(bearingDegrees(centre, middle)) : null,
        edgeOnly: entry.edge,
      }
    })
    .sort((a, b) => b.share - a.share || RESTRICTIVENESS[a.code] - RESTRICTIVENESS[b.code])
}

/** Shares of a block's sampled ground, 0–1, which sum to 1. */
export type VisibilityShares = {
  /** In view from at least one station. */
  visible: number
  /** Hidden only by timber screening the sightline: the bare ground is in view. */
  screened: number
  /** Behind the ground itself, or out of range. */
  hidden: number
  /** Sightlines over terrain that did not load. */
  unknown: number
}

const EMPTY_SHARES: VisibilityShares = { visible: 0, screened: 0, hidden: 0, unknown: 0 }

/**
 * The run's per-sample answer, whole block and split by the EVQO class each
 * sample falls in. Samples are equal-area, so a count is an area share.
 */
export function visibilityShares(
  target: Pick<TargetVisibility, 'positions' | 'anyVisible' | 'anyBareEarthVisible' | 'sampleCount'>,
  units: ReadonlyArray<EvqoUnit> = [],
): { overall: VisibilityShares; byCode: Partial<Record<EvqoCode, VisibilityShares>> } {
  const counts = new Map<EvqoCode | 'all', [number, number, number, number]>()
  const add = (key: EvqoCode | 'all', slot: number) => {
    const row = counts.get(key) ?? [0, 0, 0, 0]
    row[slot] += 1
    counts.set(key, row)
  }
  // Strictest unit first, each prepared once within the samples' box: the first that contains a sample
  // is its stricter class, the same answer as testing every unit with `pointInPolygon`.
  let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < target.sampleCount; i += 1) {
    const lng = target.positions[i * 2],
      lat = target.positions[i * 2 + 1]
    box = [Math.min(box[0], lng), Math.min(box[1], lat), Math.max(box[2], lng), Math.max(box[3], lat)]
  }
  const prepared = units.length
    ? [...units]
        .sort((a, b) => RESTRICTIVENESS[a.code] - RESTRICTIVENESS[b.code])
        .map((unit) => ({ code: unit.code, polygons: preparePolygons([unit.geometry], box) }))
        .filter((unit) => unit.polygons.partCount > 0)
    : []
  for (let i = 0; i < target.sampleCount; i += 1) {
    const status = target.anyVisible[i]
    const slot = status === 1 ? 0 : status === 2 ? 3 : target.anyBareEarthVisible?.[i] === 1 ? 1 : 2
    add('all', slot)
    if (!units.length) continue
    const lng = target.positions[i * 2],
      lat = target.positions[i * 2 + 1]
    const code = prepared.find((unit) => unit.polygons.contains(lng, lat))?.code
    if (code) add(code, slot)
  }
  const shares = (row: [number, number, number, number] | undefined): VisibilityShares => {
    const total = row ? row[0] + row[1] + row[2] + row[3] : 0
    if (!row || !total) return EMPTY_SHARES
    return { visible: row[0] / total, screened: row[1] / total, hidden: row[2] / total, unknown: row[3] / total }
  }
  const byCode: Partial<Record<EvqoCode, VisibilityShares>> = {}
  for (const [key, row] of counts) if (key !== 'all') byCode[key] = shares(row)
  return { overall: shares(counts.get('all')), byCode }
}

// ---------------------------------------------------------------------------
// Grading

export type VisibilityGrade = 'will' | 'may' | 'screened' | 'screened-flat' | 'not' | 'not-flat' | 'unknown'

/** Grades that put the block, or part of it, in view. */
export const SEEN_GRADES: ReadonlySet<VisibilityGrade> = new Set(['will', 'may'])

export function gradeVisibility(
  shares: VisibilityShares,
  {
    flatTerrain = false,
    screeningModelled = true,
  }: {
    /** The block sits within `flatTerrainDegrees` of the viewer's eye level. */
    flatTerrain?: boolean
    /** Timber was in the run; otherwise "visible" is bare ground only. */
    screeningModelled?: boolean
  } = {},
): VisibilityGrade {
  if (shares.unknown > NARRATIVE_LIMITS.unknownShare) return 'unknown'
  if (shares.visible >= NARRATIVE_LIMITS.willBeVisibleShare)
    // Bare ground in view across flat country is what roadside timber hides
    // best; without timber in the run, that is a "may".
    return !screeningModelled && flatTerrain ? 'may' : 'will'
  if (shares.visible > 0) return 'may'
  if (shares.screened > 0) return flatTerrain ? 'screened-flat' : 'screened'
  return flatTerrain ? 'not-flat' : 'not'
}

// ---------------------------------------------------------------------------
// Wording

export type ViewpointKind = 'highway' | 'road' | 'rec-site' | 'community' | 'viewpoint'

export type ViewpointFinding = {
  /** As written in the note: "Hwy 97", "Davie Lake South Rec Site". */
  name: string
  kind: ViewpointKind
  shares: VisibilityShares
  /** Per-class shares, when the run sampled this viewpoint at the block's samples. */
  byCode?: Partial<Record<EvqoCode, VisibilityShares>>
  /** Elevation angle from the eye to the block's ground, degrees; positive looks up. */
  elevationAngleDegrees?: number | null
  screeningModelled?: boolean
}

/** "Highway 97" and "BC-97" read "Hwy 97", as notes write it; a road name is kept as given. */
export function viewpointLabel(name: string): string {
  const trimmed = name.trim()
  const highway = /\b(?:highway|hwy|bc|route)[\s-]*(\d+[a-z]?)\b/i.exec(trimmed)
  if (highway) return `Hwy ${highway[1].toUpperCase()}`
  return trimmed
}

/** Classify a viewpoint's kind from its name when nothing better is known. */
export function viewpointKindFromName(name: string): ViewpointKind {
  if (/\b(?:highway|hwy)\b|\bbc[\s-]?\d+\b|\broute\s*\d+\b/i.test(name)) return 'highway'
  if (/\brec(?:reation)?\b.*\bsite\b|\brec site\b|\bcampground\b/i.test(name)) return 'rec-site'
  if (/\btown\b|\bcommunity\b|\bvillage\b/i.test(name)) return 'community'
  if (/\b(?:fsr|road|rd|street|st|drive|dr|trail)\b/i.test(name)) return 'road'
  return 'viewpoint'
}

function isLinear(kind: ViewpointKind): boolean {
  return kind === 'highway' || kind === 'road'
}

/** The verb phrase, and what follows the viewpoint's name. */
function predicate(grade: VisibilityGrade, finding: ViewpointFinding): { verb: string; tail: string } {
  const along = isLinear(finding.kind) ? `along ${finding.name}` : `between the block and ${finding.name}`
  switch (grade) {
    case 'will':
      return { verb: 'will be visible', tail: '' }
    case 'may':
      return { verb: 'may be visible', tail: '' }
    case 'screened':
      return { verb: 'may not be visible directly', tail: ` due to screening ${along}` }
    case 'screened-flat':
      return { verb: 'likely will not be visible', tail: ` due to relatively flat terrain and screening ${along}` }
    case 'not':
      return { verb: 'is not visible', tail: '' }
    case 'not-flat':
      return { verb: 'likely will not be visible', tail: ' due to relatively flat terrain' }
    case 'unknown':
      return { verb: 'could not be assessed', tail: ' because terrain along the sightlines did not load' }
  }
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function quoted(code: EvqoCode): string {
  return `${EVQO_NAMES[code]} '${code}'`
}

function percent(share: number): string {
  const value = share * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

export type NarrativeSentence = {
  id: string
  text: string
  /** What the sentence was written from, for the reviewer. */
  basis: string
}

export type NarrativeInput = {
  blockName: string
  overlaps: ReadonlyArray<ClassOverlap>
  /** The run's viewpoint first; others (rec sites, VLI viewpoints) after it. */
  viewpoints: ReadonlyArray<ViewpointFinding>
  /** Roads near the block, nearest first, for the windfirm screen. */
  nearbyRoads?: ReadonlyArray<{ name: string; distanceMeters: number }>
  /** Existing or proposed openings within `adjacentMeters`, by name. */
  adjacentBlocks?: ReadonlyArray<string>
  /**
   * The landform's percent alteration (initial X, perspective) and the
   * objective it is judged against. Absent before a run with a landform.
   */
  alteration?: { percent: number; objective: EvqoCode; maxPercent: number; rangeLabel: string } | null
  /** Saved or downloaded views to point the reader to. */
  screenshotCount?: number
}

export type Narrative = {
  /** The block overlaps an EVQO polygon, so the note carries a Visuals paragraph. */
  applies: boolean
  sentences: NarrativeSentence[]
  paragraph: string
}

function overlapSentences(overlaps: ReadonlyArray<ClassOverlap>): NarrativeSentence[] {
  if (!overlaps.length)
    return [
      { id: 'overlap', text: 'Block does not overlap any EVQO polygon.', basis: 'No EVQO polygon under the block.' },
    ]
  const basis = overlaps
    .map((o) => `${o.code} ${percent(o.share)} of the block (${o.areaHectares.toFixed(1)} ha)`)
    .join('; ')
  const minor = overlaps.filter((o) => o.share < NARRATIVE_LIMITS.minorShare)
  if (overlaps.length === 1) {
    const [only] = overlaps
    const name = `EVQO ${quoted(only.code)} polygon`
    if (only.share >= NARRATIVE_LIMITS.wholeBlockShare)
      return [{ id: 'overlap', text: `Block overlaps ${name}.`, basis }]
    if (only.share >= NARRATIVE_LIMITS.mostShare)
      return [{ id: 'overlap', text: `Most of the block overlaps ${name}.`, basis }]
    if (only.share >= NARRATIVE_LIMITS.minorShare)
      return [
        {
          id: 'overlap',
          text: only.side
            ? `The ${ADJECTIVE[only.side]} portion of the block overlaps ${name}.`
            : `Part of the block overlaps ${name}.`,
          basis,
        },
      ]
    return [
      {
        id: 'overlap',
        text:
          `There are small overlaps with ${name}. The overlap is very minor` +
          (only.edgeOnly ? ', just around the edges of the block boundary.' : '.'),
        basis,
      },
    ]
  }
  const names = overlaps.map((o) => quoted(o.code))
  // Together the classes may still cover only part of the block.
  const total = overlaps.reduce((sum, o) => sum + o.share, 0)
  const side = overlaps[0].side
  const subject =
    total >= NARRATIVE_LIMITS.wholeBlockShare
      ? 'Block overlaps'
      : total >= NARRATIVE_LIMITS.mostShare
        ? 'Most of the block overlaps'
        : side
          ? `The ${ADJECTIVE[side]} portion of the block overlaps`
          : 'Part of the block overlaps'
  const sentences: NarrativeSentence[] = [{ id: 'overlap', text: `${subject} EVQO ${joinAnd(names)} polygons.`, basis }]
  if (minor.length && minor.length < overlaps.length)
    sentences.push({
      id: 'overlap-minor',
      text:
        `The overlap with ${joinAnd(minor.map((o) => `'${o.code}'`))} is very minor` +
        (minor.every((o) => o.edgeOnly) ? ', just around the edges of the block boundary.' : '.'),
      basis: minor.map((o) => `${o.code} ${percent(o.share)}`).join('; '),
    })
  return sentences
}

function findingGrade(finding: ViewpointFinding, shares = finding.shares): VisibilityGrade {
  const angle = finding.elevationAngleDegrees
  return gradeVisibility(shares, {
    flatTerrain: angle !== null && angle !== undefined && Math.abs(angle) < NARRATIVE_LIMITS.flatTerrainDegrees,
    screeningModelled: finding.screeningModelled !== false,
  })
}

function sharesBasis(name: string, shares: VisibilityShares, finding: ViewpointFinding): string {
  const parts = [`in view ${percent(shares.visible)}`]
  if (shares.screened > 0) parts.push(`screened by timber ${percent(shares.screened)}`)
  parts.push(`hidden by terrain ${percent(shares.hidden)}`)
  if (shares.unknown > 0) parts.push(`unknown ${percent(shares.unknown)}`)
  if (Number.isFinite(finding.elevationAngleDegrees))
    parts.push(
      `${Math.abs(finding.elevationAngleDegrees!).toFixed(1)}° ${finding.elevationAngleDegrees! >= 0 ? 'above' : 'below'} eye level`,
    )
  if (finding.screeningModelled === false) parts.push('roadside timber not in the run')
  return `${name}: ${parts.join(', ')}.`
}

/** Splitting by class reads only when the classes are seen differently from the run's viewpoint. */
function classSplit(overlaps: ReadonlyArray<ClassOverlap>, primary: ViewpointFinding | undefined) {
  if (!primary?.byCode || overlaps.length < 2) return null
  const rows = overlaps
    .filter((o) => primary.byCode![o.code])
    .map((o) => ({ code: o.code, grade: findingGrade(primary, primary.byCode![o.code]!) }))
  if (rows.length < 2 || new Set(rows.map((row) => row.grade)).size < 2) return null
  return rows
}

function visibilitySentences(input: NarrativeInput): NarrativeSentence[] {
  const [primary, ...others] = input.viewpoints
  if (!primary) return []
  const sentences: NarrativeSentence[] = []
  const split = classSplit(input.overlaps, primary)
  let remaining = input.viewpoints
  if (split) {
    // Least visible first, then "however" the part that shows, as planners write it.
    const order: VisibilityGrade[] = ['not', 'not-flat', 'screened-flat', 'screened', 'unknown', 'may', 'will']
    const rows = [...split].sort((a, b) => order.indexOf(a.grade) - order.indexOf(b.grade))
    const clauses = rows.map((row, i) => {
      const { verb, tail } = predicate(row.grade, primary)
      const subject =
        i === 0
          ? `The area within the block that overlaps the '${row.code}' polygon`
          : `the area that overlaps the '${row.code}'`
      return `${subject} ${verb} from ${primary.name}${tail}`
    })
    sentences.push({
      id: 'visibility-by-class',
      text:
        clauses[0] +
        clauses
          .slice(1)
          .map((clause) => `, however ${clause}`)
          .join('') +
        '.',
      basis: rows
        .map((row) => sharesBasis(`'${row.code}' part from ${primary.name}`, primary.byCode![row.code]!, primary))
        .join(' '),
    })
    remaining = others
  }
  if (!remaining.length) return sentences
  // Group viewpoints that read the same; a contrast joins with "but".
  const graded = remaining.map((finding) => ({ finding, grade: findingGrade(finding) }))
  const groups: Array<{ grade: VisibilityGrade; findings: ViewpointFinding[] }> = []
  for (const row of graded) {
    const group = groups.find((entry) => entry.grade === row.grade)
    if (group) group.findings.push(row.finding)
    else groups.push({ grade: row.grade, findings: [row.finding] })
  }
  const clause = (group: (typeof groups)[number]) => {
    const tails = group.findings.map((finding) => {
      const { tail } = predicate(group.grade, finding)
      return `from ${finding.name}${tail}`
    })
    return `${predicate(group.grade, group.findings[0]).verb} ${joinAnd(tails)}`
  }
  const subject = split ? 'The block' : 'Block'
  const basis = graded.map((row) => sharesBasis(row.finding.name, row.finding.shares, row.finding)).join(' ')
  if (groups.length === 2) {
    const hidden = groups.find((group) => !SEEN_GRADES.has(group.grade))
    const seen = groups.find((group) => SEEN_GRADES.has(group.grade))
    if (hidden && seen) {
      sentences.push({ id: 'visibility', text: `${subject} ${clause(hidden)}, but ${clause(seen)}.`, basis })
      return sentences
    }
  }
  sentences.push({
    id: 'visibility',
    text: groups.map((group, i) => `${i === 0 ? subject : 'It'} ${clause(group)}.`).join(' '),
    basis,
  })
  return sentences
}

function recommendationSentences(input: NarrativeInput): NarrativeSentence[] {
  const sentences: NarrativeSentence[] = []
  const [primary] = input.viewpoints
  const grades = input.viewpoints.map((finding) => findingGrade(finding))
  const anyOpen = grades.some((grade) => grade !== 'not' && grade !== 'not-flat')
  const overlaps = input.overlaps

  if (input.alteration && overlaps.length) {
    const { percent: x, objective, maxPercent, rangeLabel } = input.alteration
    const meets = x <= maxPercent
    sentences.push({
      id: 'desktop-review',
      text: meets
        ? `Based on desktop review, block should meet the requirements for EVQO ${objective}.`
        : `Based on desktop review, block may not meet the requirements for EVQO ${objective}; redesign before layout.`,
      basis: `${x.toFixed(1)}% perspective alteration of the landform (initial X) against the ${objective} range of ${rangeLabel}.`,
    })
  }

  // A stricter class the viewpoint sees part of: break it up there.
  const split = classSplit(overlaps, primary)
  const seenStrict = overlaps.filter((o) => {
    if (RESTRICTIVENESS[o.code] > RESTRICTIVENESS.PR) return false
    // A sliver gets "do not expand into it", not a reserve inside it.
    if (o.share < NARRATIVE_LIMITS.minorShare) return false
    const grade = split?.find((row) => row.code === o.code)?.grade ?? (primary ? findingGrade(primary) : null)
    return grade !== null && SEEN_GRADES.has(grade)
  })
  const road = input.nearbyRoads?.find((entry) => entry.distanceMeters <= NARRATIVE_LIMITS.screenRoadMeters)
  const screenClause = road ? `leaving a windfirm screen between the block edge and the ${road.name}` : null
  if (seenStrict.length) {
    const names = joinAnd(seenStrict.map((o) => `'${o.code}'`))
    sentences.push({
      id: 'wtra',
      text:
        `It would be a good idea to strategically place a WTRA within the ${names} overlap` +
        (screenClause ? ` as well as pulling back the boundary from the ${road!.name}, ${screenClause}.` : '.'),
      basis:
        `The ${names} part of the block is in view from ${primary?.name ?? 'the viewpoint'}.` +
        (road ? ` ${road.name} is ${Math.round(road.distanceMeters)} m from the boundary.` : ''),
    })
  } else if (road && anyOpen && overlaps.length) {
    sentences.push({
      id: 'screen',
      text: `Leave a windfirm buffer between the block boundary and the ${road.name} for screening.`,
      basis: `${road.name} is ${Math.round(road.distanceMeters)} m from the boundary, and the block is not hidden from every viewpoint.`,
    })
  }

  // A sliver of a stricter class along the edge: keep the boundary off it.
  const main = overlaps[0]
  for (const o of overlaps) {
    if (o.share >= NARRATIVE_LIMITS.minorShare || !o.side) continue
    if (overlaps.length > 1 && RESTRICTIVENESS[o.code] >= RESTRICTIVENESS[main.code]) continue
    if (seenStrict.some((entry) => entry.code === o.code)) continue
    sentences.push({
      id: `no-expand-${o.code}`,
      text: `Do not expand the boundary ${EXPANSION[o.side]} into the '${o.code}' polygon.`,
      basis: `The ${o.code} overlap (${percent(o.share)}) lies on the ${o.side} side of the block.`,
    })
  }

  // A large opening in plain view under Modification.
  if (primary && main && (main.code === 'M' || main.code === 'MM') && findingGrade(primary) === 'will')
    sentences.push({
      id: 'internal-wtra',
      text: 'Recommend having an internal WTRA within the block to break up the opening. Avoid laying out straight/angular boundaries.',
      basis: `${percent(primary.shares.visible)} of the block is in view from ${primary.name}.`,
    })

  // In view, undetermined, or hidden only by timber that may not stay: a field VIA settles it.
  if (
    overlaps.length &&
    grades.some((grade) => SEEN_GRADES.has(grade) || grade === 'unknown' || grade === 'screened')
  ) {
    const adjacent = input.adjacentBlocks?.filter(Boolean) ?? []
    sentences.push({
      id: 'post-layout-via',
      text:
        'Complete VIA post layout' +
        (adjacent.length ? ` taking into account adjacent blocks (${adjacent.join(', ')}).` : '.'),
      basis: adjacent.length
        ? `Openings within ${NARRATIVE_LIMITS.adjacentMeters / 1000} km: ${adjacent.join(', ')}.`
        : 'Part of the block is in view, or could not be assessed.',
    })
  }

  if (input.screenshotCount && input.screenshotCount > 0 && overlaps.length)
    sentences.push({
      id: 'screenshots',
      text: 'See screenshots below.',
      basis: `${input.screenshotCount} saved view${input.screenshotCount === 1 ? '' : 's'}.`,
    })
  return sentences
}

export function visualsNarrative(input: NarrativeInput): Narrative {
  const sentences = [
    ...overlapSentences(input.overlaps),
    ...visibilitySentences(input),
    ...recommendationSentences(input),
  ]
  return {
    applies: input.overlaps.length > 0,
    sentences,
    paragraph: sentences.map((sentence) => sentence.text).join(' '),
  }
}

// ---------------------------------------------------------------------------
// Captions

/**
 * A screenshot caption as notes write them: "View from Hwy 97 going north.",
 * "View from Hwy 97 looking east toward ML_26_4 and ML_26_5.", "View of the
 * block from Davie Lake South Rec Site."
 */
export function viewCaption({
  viewpointName,
  linear,
  travelBearing,
  lookBearing,
  targetNames = [],
}: {
  viewpointName: string
  /** A road driven along, rather than one spot. */
  linear: boolean
  travelBearing?: number | null
  lookBearing?: number | null
  targetNames?: readonly string[]
}): string {
  const from = viewpointLabel(viewpointName)
  const toward = targetNames.length ? ` toward ${joinAnd(targetNames)}` : ''
  if (!linear) return `View of ${targetNames.length ? joinAnd(targetNames) : 'the block'} from ${from}.`
  const travel = Number.isFinite(travelBearing) ? (travelBearing as number) : null
  const look = Number.isFinite(lookBearing) ? (lookBearing as number) : null
  if (look !== null && (travel === null || Math.abs(((look - travel + 540) % 360) - 180) > 45))
    return `View from ${from} looking ${compassPoint(look)}${toward}.`
  if (travel !== null) return `View from ${from} going ${compassPoint(travel)}${toward}.`
  return `View from ${from}${toward}.`
}

// ---------------------------------------------------------------------------
// From the page's state

/**
 * The narrative's facts gathered from the scene and the run. Pure, so the
 * panel only renders: the block and every other polygon from the scene, the
 * run (null when stale or absent), the EVQO units under the block, and what
 * the viewpoint inventory found.
 */
export function narrativeInputFromScene({
  block,
  targets,
  result,
  viewpoint,
  units,
  nearbyRoads = [],
  otherViewpoints = [],
  landform,
  screenshotCount = 0,
}: {
  block: TargetPolygon
  targets: ReadonlyArray<TargetPolygon>
  result: AnalysisResult | null
  viewpoint: { name: string; mode: 'spot' | 'corridor' }
  units: ReadonlyArray<EvqoUnit>
  nearbyRoads?: ReadonlyArray<{ name: string; distanceMeters: number }>
  otherViewpoints?: ReadonlyArray<ViewpointFinding>
  landform: TargetPolygon | null
  screenshotCount?: number
}): NarrativeInput {
  const overlaps = evqoOverlaps(block.geometry, units)
  const viewpoints: ViewpointFinding[] = []
  const target = result?.targets.find((entry) => entry.targetId === block.id && entry.role === 'block')
  if (result && target) {
    const { overall, byCode } = visibilityShares(target, units)
    const station = result.stations[result.assessmentStationIndex]
    let sum = 0,
      count = 0,
      lng = 0,
      lat = 0
    for (let i = 0; i < target.sampleCount; i += 1) {
      const z = target.elevations[i]
      if (!Number.isFinite(z)) continue
      sum += z
      lng += target.positions[i * 2]
      lat += target.positions[i * 2 + 1]
      count += 1
    }
    let angle: number | null = null
    if (station && count) {
      const centre = { lng: lng / count, lat: lat / count }
      const distance = haversineMeters(station, centre)
      const eye = station.groundElevationMeters + result.settings.observerHeightMeters
      if (distance > 1 && Number.isFinite(eye)) angle = (Math.atan2(sum / count - eye, distance) * 180) / Math.PI
    }
    const name = viewpointLabel(viewpoint.name || (viewpoint.mode === 'corridor' ? 'the road' : 'the viewpoint'))
    const kind = viewpointKindFromName(viewpoint.name)
    viewpoints.push({
      name,
      kind: viewpoint.mode === 'corridor' && kind === 'viewpoint' ? 'road' : kind,
      shares: overall,
      byCode,
      elevationAngleDegrees: angle,
      screeningModelled: result.settings.screeningEnabled,
    })
  }
  viewpoints.push(...otherViewpoints.filter((finding) => finding.name !== viewpoints[0]?.name))

  const adjacentBlocks = targets
    .filter((entry) => entry.id !== block.id && (entry.role === 'block' || entry.role === 'harvested'))
    .map((entry) => ({ entry, distance: polygonGap(block.geometry, entry.geometry) }))
    .filter(({ distance }) => distance <= NARRATIVE_LIMITS.adjacentMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 6)
    .map(({ entry }) => entry.name)

  const breakdown = result?.perspectiveAlteration ?? null
  const x = initialAlterationPercent(breakdown)
  const alteration =
    landform && x !== null && result?.activeLandformId === landform.id
      ? (() => {
          const range = table2Range(landform.objectiveId)
          return {
            percent: x,
            objective: EVQO_CODE_FOR_CLASS[landform.objectiveId],
            maxPercent: range.max,
            rangeLabel: range.label,
          }
        })()
      : null

  return {
    blockName: block.name,
    overlaps,
    viewpoints,
    nearbyRoads,
    adjacentBlocks,
    alteration,
    screenshotCount,
  }
}

/** Gap between two polygons' boundaries, metres; 0 when they touch or overlap. */
function polygonGap(a: PolygonGeometry, b: PolygonGeometry): number {
  const ring = (b.type === 'Polygon' ? b.coordinates[0] : b.coordinates[0]?.[0]) ?? []
  const coordinates = ring.map((p): [number, number] => [p[0], p[1]])
  if (!coordinates.length) return Infinity
  const other = (a.type === 'Polygon' ? a.coordinates[0] : a.coordinates[0]?.[0]) ?? []
  if (other.some((p) => pointInPolygon(b, p[0], p[1]))) return 0
  return lineToPolygonMeters(a, coordinates)
}
