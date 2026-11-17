/**
 * Field review: a road issued to a field crew with numbered checks, and the observations the crew
 * brings back (guide `docs/forestry-road-design/field-review.md`).
 *
 * An issue keeps its own copy of the fitted centreline, its chainages and the stations it printed,
 * so an observation can be read against the road the crew walked even after the designer has moved
 * it. An observation joins a check only by the check's label or id written in the returned file, or
 * by the designer's choice; a point near the road gets every plausible station (a switchback's legs
 * are separate candidates) and never a guessed one. Accepting an observation records it and the
 * station the designer confirmed; it never edits the road, a culvert or a ground horizon.
 *
 * Pure: no DOM or network access.
 */
import { centrelineSamples, positionAt } from './engine'
import type { Alignment, Coordinate } from './types'

export const FIELD_REVIEW_LIMITS = {
  issues: 50,
  checks: 200,
  observations: 2_000,
  centrelineVertices: 5_000,
  text: 2_000,
  name: 200,
  attributes: 50,
} as const
/** The issued centreline is kept every this many metres, or coarser on a road past `centrelineVertices`. */
export const ISSUED_CENTRELINE_STEP_M = 2
/** Station ticks on the field pack, metres. */
export const FIELD_PACK_TICK_M = 100
/** A returned point this far or nearer from a centreline is given its stations there. */
export const FIELD_MATCH_RADIUS_M = 75
/** Two candidate stations closer than this along the road are one candidate. */
export const FIELD_CANDIDATE_SEPARATION_M = 30
/** Candidate stations listed at most per road. */
export const FIELD_MAX_CANDIDATES = 3
/** An issued check this near a returned point is listed as a possible match. */
export const FIELD_CHECK_NEAR_M = 50

export type FieldCheckKind = 'crossing' | 'landing' | 'rock' | 'wet-ground' | 'other'
export const FIELD_CHECK_KINDS: Record<FieldCheckKind, { label: string; prefix: string; question: string }> = {
  crossing: {
    label: 'Crossing',
    prefix: 'C',
    question: 'Is there a defined channel? Record width, depth, flow, substrate and the structure it needs.',
  },
  landing: { label: 'Landing', prefix: 'L', question: 'Is this a workable landing? Record size, grade and drainage.' },
  rock: { label: 'Rock', prefix: 'R', question: 'Where does rock start and end, and how deep is overburden?' },
  'wet-ground': {
    label: 'Wet ground',
    prefix: 'W',
    question: 'How far does the wet ground run, and what is the soil?',
  },
  other: { label: 'Check', prefix: 'X', question: 'Check this place on the ground.' },
}

export interface FieldCheck {
  /** Stable id, written into the pack beside the label. */
  id: string
  /** Short label the crew writes back: "C-03". Unique within its issue. */
  label: string
  kind: FieldCheckKind
  chainage: number
  /** A range's end; absent for a point. */
  endChainage?: number
  /** The station as the pack printed it. */
  station: string
  coordinate: Coordinate
  question: string
  /** The crossing register row it was seeded from. */
  crossingId?: string
}

export interface FieldIssue {
  id: string
  /** "FR-01": unique in the project, printed on every page and placemark. */
  label: string
  roadId: string
  roadName: string
  /** The road's active profile when issued. */
  profileId?: string
  revision: string
  /** YYYY-MM-DD. */
  issuedOn: string
  /** The fitted centreline, longitude/latitude, with each vertex's chainage. */
  centreline: Coordinate[]
  chainages: number[]
  lengthM: number
  /** Station ticks as printed. */
  ticks: { chainage: number; label: string }[]
  terrain: { name: string; verticalReference: string; epsg?: number }
  checks: FieldCheck[]
}

export type FieldObservationStatus = 'pending' | 'accepted' | 'rejected'

export interface FieldObservation {
  /** Stable key from the returned file: its placemark id, else its name, place and time. */
  id: string
  /** The issue it was read against; null when the file named none and the designer has not chosen. */
  issueId: string | null
  /** The check it answers: written in the file (`match: 'file'`) or chosen by the designer. */
  checkId: string | null
  match: 'file' | 'designer' | null
  name: string
  note: string
  coordinate: Coordinate
  recordedAt?: string
  attributes: Record<string, string>
  /** The returned file's name. */
  file: string
  status: FieldObservationStatus
  /** The station on the issued centreline the designer confirmed. */
  issuedChainage?: number
  /** The station on the road as it stands, confirmed on accepting. */
  currentChainage?: number
  decidedOn?: string
}

export interface FieldReviewState {
  issues: FieldIssue[]
  observations: FieldObservation[]
}

/* ---------------------------------------------------------------- geometry */

const RAD = Math.PI / 180
const METRES_PER_DEGREE = 111_194.93
const round7 = (v: number) => Math.round(v * 1e7) / 1e7
const round3 = (v: number) => Math.round(v * 1e3) / 1e3

/** A road's fitted centreline every `ISSUED_CENTRELINE_STEP_M`, with chainages; null if it does not compile. */
export function roadCentreline(
  alignment: Alignment,
): { line: Coordinate[]; chainages: number[]; length: number } | null {
  try {
    if (alignment.points.length < 2) return null
    const length = centrelineSamples(alignment, 1e9).length
    const step = Math.max(ISSUED_CENTRELINE_STEP_M, length / (FIELD_REVIEW_LIMITS.centrelineVertices - 1))
    const sampled = centrelineSamples(alignment, step)
    return {
      line: sampled.samples.map((s) => {
        const c = sampled.toCoordinate(s.x, s.y)
        return [round7(c[0]), round7(c[1])] as Coordinate
      }),
      chainages: sampled.samples.map((s) => round3(s.s)),
      length: sampled.length,
    }
  } catch {
    return null
  }
}

export interface StationCandidate {
  chainage: number
  /** Negative left of the centreline looking up-station. */
  offset: number
  distanceM: number
}

/**
 * Every place along a centreline within `radius` of a point, nearest first. Feet closer than
 * `FIELD_CANDIDATE_SEPARATION_M` along the line are one candidate, so the two legs of a switchback
 * come back as two candidates and a straight road as one.
 */
export function stationCandidates(
  line: readonly Coordinate[],
  chainages: readonly number[],
  point: Coordinate,
  radius = FIELD_MATCH_RADIUS_M,
): StationCandidate[] {
  const cos = Math.cos(point[1] * RAD)
  const local = (c: Coordinate) => [(c[0] - point[0]) * METRES_PER_DEGREE * cos, (c[1] - point[1]) * METRES_PER_DEGREE]
  const all: StationCandidate[] = []
  let previous = line.length ? local(line[0]) : null
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = previous!
    const [bx, by] = local(line[i])
    previous = [bx, by]
    const dx = bx - ax,
      dy = by - ay
    const span = dx * dx + dy * dy
    const t = span > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / span)) : 0
    const px = ax + dx * t,
      py = ay + dy * t
    const d = Math.hypot(px, py)
    // The point relative to the foot, crossed with the direction of travel: positive is to the left.
    const cross = dx * -py - dy * -px
    all.push({
      chainage: chainages[i - 1] + (chainages[i] - chainages[i - 1]) * t,
      offset: cross > 0 ? -d : d,
      distanceM: d,
    })
  }
  // Only where the road comes nearest the point: a local minimum of distance along the line.
  const feet = all
    .filter(
      (f, i) =>
        f.distanceM <= radius &&
        (i === 0 || f.distanceM <= all[i - 1].distanceM) &&
        (i === all.length - 1 || f.distanceM <= all[i + 1].distanceM),
    )
    .sort((a, b) => a.distanceM - b.distanceM)
  const picked: StationCandidate[] = []
  for (const foot of feet) {
    if (picked.some((p) => Math.abs(p.chainage - foot.chainage) < FIELD_CANDIDATE_SEPARATION_M)) continue
    picked.push({ chainage: round3(foot.chainage), offset: round3(foot.offset), distanceM: round3(foot.distanceM) })
    if (picked.length >= FIELD_MAX_CANDIDATES) break
  }
  return picked
}

/** Metres between two longitude/latitude points (equirectangular; fine at field-check distances). */
function metresBetween(a: Coordinate, b: Coordinate) {
  const cos = Math.cos(((a[1] + b[1]) / 2) * RAD)
  return Math.hypot((a[0] - b[0]) * METRES_PER_DEGREE * cos, (a[1] - b[1]) * METRES_PER_DEGREE)
}

/** The point on an issued centreline at a chainage. */
export function issuedPositionAt(issue: Pick<FieldIssue, 'centreline' | 'chainages'>, chainage: number): Coordinate {
  const { centreline: line, chainages } = issue
  if (chainage <= chainages[0]) return line[0]
  for (let i = 1; i < line.length; i++)
    if (chainage <= chainages[i]) {
      const t = (chainage - chainages[i - 1]) / (chainages[i] - chainages[i - 1] || 1)
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]
    }
  return line[line.length - 1]
}

/* ------------------------------------------------------------------ issuing */

/** The next unused issue label: FR-01, FR-02… */
export function nextIssueLabel(state: FieldReviewState | undefined): string {
  const used = new Set((state?.issues ?? []).map((i) => i.label))
  for (let n = 1; ; n++) {
    const label = `FR-${String(n).padStart(2, '0')}`
    if (!used.has(label)) return label
  }
}

/** The next label of a kind among checks: C-01, C-02… */
export function nextCheckLabel(checks: readonly Pick<FieldCheck, 'label'>[], kind: FieldCheckKind): string {
  const prefix = FIELD_CHECK_KINDS[kind].prefix
  const used = new Set(checks.map((c) => c.label))
  for (let n = 1; ; n++) {
    const label = `${prefix}-${String(n).padStart(2, '0')}`
    if (!used.has(label)) return label
  }
}

export interface CheckDraft {
  kind: FieldCheckKind
  chainage: number
  endChainage?: number
  question?: string
  crossingId?: string
}

/** Check drafts for the crossing register's rows, in station order. */
export function crossingCheckDrafts(rows: readonly { id: string; chainage: number; name: string }[]): CheckDraft[] {
  return [...rows]
    .sort((a, b) => a.chainage - b.chainage)
    .map((row) => ({
      kind: 'crossing' as const,
      chainage: row.chainage,
      crossingId: row.id,
      question: `${row.name}: ${FIELD_CHECK_KINDS.crossing.question}`,
    }))
}

export interface IssueInput {
  alignment: Alignment
  label: string
  revision: string
  issuedOn: string
  terrain: FieldIssue['terrain']
  checks: readonly CheckDraft[]
  /** The station label of a chainage on this road, as the pack prints it. */
  station: (chainage: number) => string
  id?: () => string
}

/** An issued copy of the road and its checks. Throws when the road cannot be issued. */
export function issueRoad(input: IssueInput): FieldIssue {
  const { alignment } = input
  const id = input.id ?? (() => globalThis.crypto.randomUUID())
  const centreline = roadCentreline(alignment)
  if (!centreline) throw Error('The road needs at least two points before it can be issued.')
  if (input.checks.length > FIELD_REVIEW_LIMITS.checks)
    throw Error(`An issue takes at most ${FIELD_REVIEW_LIMITS.checks} checks.`)
  const checks: FieldCheck[] = []
  for (const draft of input.checks) {
    const chainage = Math.max(0, Math.min(centreline.length, draft.chainage))
    const end =
      draft.endChainage === undefined ? undefined : Math.max(chainage, Math.min(centreline.length, draft.endChainage))
    const label = nextCheckLabel(checks, draft.kind)
    const coordinate = positionAt(alignment, chainage).coordinate
    checks.push({
      id: id(),
      label,
      kind: draft.kind,
      chainage: round3(chainage),
      ...(end !== undefined && end > chainage ? { endChainage: round3(end) } : {}),
      station:
        end !== undefined && end > chainage
          ? `${input.station(chainage)} to ${input.station(end)}`
          : input.station(chainage),
      coordinate: [round7(coordinate[0]), round7(coordinate[1])],
      question: (draft.question ?? FIELD_CHECK_KINDS[draft.kind].question).slice(0, FIELD_REVIEW_LIMITS.text),
      ...(draft.crossingId ? { crossingId: draft.crossingId } : {}),
    })
  }
  const ticks: FieldIssue['ticks'] = []
  for (let s = 0; s <= centreline.length + 1e-6; s += FIELD_PACK_TICK_M)
    ticks.push({ chainage: s, label: input.station(s) })
  const active = alignment.verticalAlternatives?.length ? alignment.activeVerticalAlternativeId : undefined
  return {
    id: id(),
    label: input.label,
    roadId: alignment.id,
    roadName: alignment.name.slice(0, FIELD_REVIEW_LIMITS.name),
    ...(active ? { profileId: active } : {}),
    revision: input.revision.slice(0, 40),
    issuedOn: input.issuedOn,
    centreline: centreline.line,
    chainages: centreline.chainages,
    lengthM: round3(centreline.length),
    ticks,
    terrain: input.terrain,
    checks,
  }
}

/* -------------------------------------------------------------- field pack */

const xml = (value: string) =>
  value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
const coords = (line: readonly Coordinate[]) => line.map(([x, y]) => `${x},${y}`).join(' ')
const data = (fields: Record<string, string | number>) =>
  `<ExtendedData>${Object.entries(fields)
    .map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(String(v))}</value></Data>`)
    .join('')}</ExtendedData>`

/** The stretch of an issued centreline between two chainages. */
function issuedStretch(issue: FieldIssue, start: number, end: number): Coordinate[] {
  const inside = issue.centreline.filter((_, i) => issue.chainages[i] > start && issue.chainages[i] < end)
  return [issuedPositionAt(issue, start), ...inside, issuedPositionAt(issue, end)]
}

/**
 * The pack's KML: the issued centreline, its station ticks and one placemark per check. The issue and
 * check labels are in each placemark's name, where a crew sees them, and in its ExtendedData, where a
 * returned file keeps them. Observations go on a layer of their own with the check's label in the
 * name or a `check` attribute.
 */
export function fieldPackKml(issue: FieldIssue): string {
  const head = `${issue.label} · ${issue.roadName} · Rev ${issue.revision || 'not recorded'} · ${issue.issuedOn}`
  const road = `<Placemark id="${xml(issue.label)}-centreline"><name>${xml(`${issue.label} ${issue.roadName}`)}</name><description>${xml(`Issued centreline. ${head}. Preliminary planning geometry, not for construction.`)}</description><styleUrl>#road</styleUrl>${data({ issue_id: issue.id, issue_label: issue.label, road: issue.roadName, revision: issue.revision, issued_on: issue.issuedOn })}<LineString><tessellate>1</tessellate><coordinates>${coords(issue.centreline)}</coordinates></LineString></Placemark>`
  const ticks = issue.ticks
    .map((t) => {
      const [x, y] = issuedPositionAt(issue, t.chainage)
      return `<Placemark><name>${xml(t.label)}</name><styleUrl>#tick</styleUrl><Point><coordinates>${x},${y}</coordinates></Point></Placemark>`
    })
    .join('')
  const checks = issue.checks
    .map((c) => {
      const fields = {
        issue_id: issue.id,
        issue_label: issue.label,
        check_id: c.id,
        check: c.label,
        kind: FIELD_CHECK_KINDS[c.kind].label,
        station: c.station,
        chainage_m: c.chainage,
        ...(c.endChainage !== undefined ? { end_chainage_m: c.endChainage } : {}),
      }
      const geometry =
        c.endChainage !== undefined
          ? `<LineString><tessellate>1</tessellate><coordinates>${coords(issuedStretch(issue, c.chainage, c.endChainage))}</coordinates></LineString>`
          : `<Point><coordinates>${c.coordinate[0]},${c.coordinate[1]}</coordinates></Point>`
      return `<Placemark id="${xml(`${issue.label}-${c.label}`)}"><name>${xml(`${c.label} ${FIELD_CHECK_KINDS[c.kind].label}`)}</name><description>${xml(`${c.station}. ${c.question} Record observations on your own layer with "${c.label}" in the name.`)}</description><styleUrl>#${c.endChainage !== undefined ? 'range' : 'check'}</styleUrl>${data(fields)}${geometry}</Placemark>`
    })
    .join('')
  const styles =
    '<Style id="road"><LineStyle><color>ff1f2fd8</color><width>4</width></LineStyle></Style>' +
    '<Style id="range"><LineStyle><color>ff00c8ff</color><width>8</width></LineStyle></Style>' +
    '<Style id="check"><IconStyle><color>ff00c8ff</color><scale>1.1</scale></IconStyle><LabelStyle><scale>1</scale></LabelStyle></Style>' +
    '<Style id="tick"><IconStyle><scale>0.5</scale></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>'
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(head)}</name><description>${xml('Field review pack from PGMaps road design. Preliminary planning geometry, not for construction.')}</description>${styles}<Folder><name>Road</name>${road}</Folder><Folder><name>Stations</name>${ticks}</Folder><Folder><name>Checks</name>${checks}</Folder></Document></kml>\n`
}

/* ------------------------------------------------------------ observations */

/** FNV-1a, 32-bit, as hex: a short stable key, not a security hash. */
function hash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const CHECK_KEYS = /^(check|check_?label|check_?id|label|site|site_?id|field_?check)$/i
const ISSUE_KEYS = /^(issue|issue_?id|issue_?label)$/i
const NOTE_KEYS = /^(note|notes|comment|comments|remarks|result|observation)$/i
const OWN_KEYS = new Set(['name', 'description', 'source', 'kmlId', 'timestamp'])

/** The issue and check a returned feature names in its attributes, then its name, then its note. */
export function namedCheck(
  state: Pick<FieldReviewState, 'issues'>,
  texts: { attributes: Record<string, string>; name: string; note: string },
): { issue: FieldIssue; check: FieldCheck } | { issue: FieldIssue; check: null } | null {
  const issueText = Object.entries(texts.attributes)
    .filter(([k]) => ISSUE_KEYS.test(k))
    .map(([, v]) => v.trim())
  const named = state.issues.filter((i) =>
    [...issueText, texts.name, texts.note].some((t) => t === i.id || new RegExp(`\\b${i.label}\\b`, 'i').test(t)),
  )
  const pool = named.length ? named : state.issues
  const checkTexts = [
    ...Object.entries(texts.attributes)
      .filter(([k]) => CHECK_KEYS.test(k))
      .map(([, v]) => v.trim()),
    texts.name,
    texts.note,
  ]
  for (const text of checkTexts) {
    const found: { issue: FieldIssue; check: FieldCheck }[] = []
    for (const issue of pool)
      for (const check of issue.checks)
        if (text === check.id || new RegExp(`(^|[^A-Z0-9-])${check.label}(?![0-9])`, 'i').test(text))
          found.push({ issue, check })
    // A label two issues share is no match until an issue is named.
    if (found.length === 1) return found[0]
    if (found.length > 1) {
      const latest = found.filter((f) => f.issue === pool.at(-1))
      if (named.length === 1 && latest.length === 1) return latest[0]
      return null
    }
  }
  return named.length === 1 ? { issue: named[0], check: null } : null
}

/** The stable key of a returned feature, so a file read twice adds nothing the second time. */
export function observationKey(feature: GeoJSON.Feature<GeoJSON.Point>, name: string): string {
  const p = (feature.properties ?? {}) as Record<string, unknown>
  if (typeof p.kmlId === 'string' && p.kmlId) return `kml:${p.kmlId}`
  const [x, y] = feature.geometry.coordinates
  return `obs:${hash(`${name}|${round7(x)}|${round7(y)}|${typeof p.timestamp === 'string' ? p.timestamp : ''}`)}`
}

export interface ReadObservations {
  /** New observations, pending review. */
  added: FieldObservation[]
  /** Points already in the project (same key). */
  duplicates: number
  /** Lines and polygons, which this release does not read as observations. */
  skipped: number
}

/** Points of a returned KML/KMZ, as pending observations. Features already held are counted, not added. */
export function readObservations(
  state: FieldReviewState | undefined,
  collection: GeoJSON.FeatureCollection,
  file: string,
): ReadObservations {
  const current = state ?? { issues: [], observations: [] }
  const held = new Set(current.observations.map((o) => o.id))
  const added: FieldObservation[] = []
  let duplicates = 0,
    skipped = 0
  for (const feature of collection.features) {
    if (feature.geometry?.type !== 'Point') {
      skipped++
      continue
    }
    const p = (feature.properties ?? {}) as Record<string, unknown>
    const name = (typeof p.name === 'string' ? p.name : '').slice(0, FIELD_REVIEW_LIMITS.name)
    const attributes: Record<string, string> = {}
    for (const [k, v] of Object.entries(p))
      if (!OWN_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'))
        if (Object.keys(attributes).length < FIELD_REVIEW_LIMITS.attributes)
          attributes[k.slice(0, 100)] = String(v).slice(0, FIELD_REVIEW_LIMITS.text)
    const noteParts = [
      typeof p.description === 'string' ? p.description : '',
      ...Object.entries(attributes)
        .filter(([k]) => NOTE_KEYS.test(k))
        .map(([, v]) => v),
    ].filter(Boolean)
    const note = [...new Set(noteParts)].join(' · ').slice(0, FIELD_REVIEW_LIMITS.text)
    const key = observationKey(feature as GeoJSON.Feature<GeoJSON.Point>, name)
    if (held.has(key)) {
      duplicates++
      continue
    }
    held.add(key)
    const named = namedCheck(current, { attributes, name, note })
    const [x, y] = (feature.geometry as GeoJSON.Point).coordinates
    added.push({
      id: key,
      issueId: named?.issue.id ?? (current.issues.length === 1 ? current.issues[0].id : null),
      checkId: named?.check?.id ?? null,
      match: named?.check ? 'file' : null,
      name,
      note,
      coordinate: [round7(x), round7(y)],
      ...(typeof p.timestamp === 'string' ? { recordedAt: p.timestamp } : {}),
      attributes,
      file: file.slice(0, FIELD_REVIEW_LIMITS.name),
      status: 'pending',
    })
  }
  if (current.observations.length + added.length > FIELD_REVIEW_LIMITS.observations)
    throw Error(`A project keeps at most ${FIELD_REVIEW_LIMITS.observations} field observations.`)
  return { added, duplicates, skipped }
}

export interface ObservationReading {
  issue: FieldIssue | null
  check: FieldCheck | null
  /** Stations on the issued centreline, nearest first. */
  issued: StationCandidate[]
  /** Stations on the road as it stands, nearest first; empty when the road is gone or too far. */
  current: StationCandidate[]
  /** Issued checks near the point, nearest first, when none is matched. */
  nearChecks: { check: FieldCheck; distanceM: number }[]
  /** How far the point is from its matched check, metres. */
  fromCheckM: number | null
}

/** How an observation reads against its issue and the road as it stands. */
export function readObservation(
  state: FieldReviewState,
  observation: FieldObservation,
  road: { line: Coordinate[]; chainages: number[] } | null,
): ObservationReading {
  const issue = state.issues.find((i) => i.id === observation.issueId) ?? null
  const check = issue?.checks.find((c) => c.id === observation.checkId) ?? null
  const issued = issue ? stationCandidates(issue.centreline, issue.chainages, observation.coordinate) : []
  // With a matched check, the leg nearest the check's own station comes first.
  if (check) issued.sort((a, b) => Math.abs(a.chainage - check.chainage) - Math.abs(b.chainage - check.chainage))
  const current = road ? stationCandidates(road.line, road.chainages, observation.coordinate) : []
  const nearChecks = check
    ? []
    : (issue?.checks ?? [])
        .map((c) => ({ check: c, distanceM: round3(metresBetween(c.coordinate, observation.coordinate)) }))
        .filter((c) => c.distanceM <= FIELD_CHECK_NEAR_M)
        .sort((a, b) => a.distanceM - b.distanceM)
  return {
    issue,
    check,
    issued,
    current,
    nearChecks,
    fromCheckM: check ? round3(metresBetween(check.coordinate, observation.coordinate)) : null,
  }
}

/** The state with one observation changed; the rest and every issue kept as they are. */
export function withObservation(
  state: FieldReviewState,
  id: string,
  change: (o: FieldObservation) => FieldObservation,
): FieldReviewState {
  return { ...state, observations: state.observations.map((o) => (o.id === id ? change(o) : o)) }
}

/** Counts for a section summary. */
export function fieldReviewSummary(state: FieldReviewState | undefined) {
  const observations = state?.observations ?? []
  return {
    issues: state?.issues.length ?? 0,
    pending: observations.filter((o) => o.status === 'pending').length,
    accepted: observations.filter((o) => o.status === 'accepted').length,
    rejected: observations.filter((o) => o.status === 'rejected').length,
  }
}

/* ------------------------------------------------------------------ parsing */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const lonLat = (v: unknown): v is Coordinate =>
  Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) < 85
const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkIssue(i: FieldIssue): boolean {
  if (
    !i ||
    !text(i.id, 100) ||
    !i.id ||
    !text(i.label, 20) ||
    !i.label ||
    !text(i.roadId, 200) ||
    !text(i.roadName, FIELD_REVIEW_LIMITS.name) ||
    (i.profileId !== undefined && !text(i.profileId, 200)) ||
    !text(i.revision, 40) ||
    !text(i.issuedOn, 10) ||
    !DATE.test(i.issuedOn) ||
    !Array.isArray(i.centreline) ||
    i.centreline.length < 2 ||
    i.centreline.length > FIELD_REVIEW_LIMITS.centrelineVertices ||
    !i.centreline.every(lonLat) ||
    !Array.isArray(i.chainages) ||
    i.chainages.length !== i.centreline.length ||
    !i.chainages.every((c, k) => finite(c) && (k === 0 || c >= i.chainages[k - 1])) ||
    !finite(i.lengthM) ||
    !Array.isArray(i.ticks) ||
    i.ticks.length > 2_000 ||
    !i.ticks.every((t) => t && finite(t.chainage) && text(t.label, 40)) ||
    !i.terrain ||
    !text(i.terrain.name, 300) ||
    !text(i.terrain.verticalReference, 300) ||
    (i.terrain.epsg !== undefined && !Number.isInteger(i.terrain.epsg)) ||
    !Array.isArray(i.checks) ||
    i.checks.length > FIELD_REVIEW_LIMITS.checks
  )
    return false
  const ids = new Set<string>(),
    labels = new Set<string>()
  for (const c of i.checks) {
    if (
      !c ||
      !text(c.id, 100) ||
      !c.id ||
      ids.has(c.id) ||
      !text(c.label, 20) ||
      labels.has(c.label) ||
      !(c.kind in FIELD_CHECK_KINDS) ||
      !finite(c.chainage) ||
      (c.endChainage !== undefined && (!finite(c.endChainage) || c.endChainage < c.chainage)) ||
      !text(c.station, 100) ||
      !lonLat(c.coordinate) ||
      !text(c.question, FIELD_REVIEW_LIMITS.text) ||
      (c.crossingId !== undefined && !text(c.crossingId, 200))
    )
      return false
    ids.add(c.id)
    labels.add(c.label)
  }
  return true
}

function checkObservation(o: FieldObservation): boolean {
  return (
    !!o &&
    text(o.id, 200) &&
    !!o.id &&
    (o.issueId === null || text(o.issueId, 100)) &&
    (o.checkId === null || text(o.checkId, 100)) &&
    (o.match === null || o.match === 'file' || o.match === 'designer') &&
    text(o.name, FIELD_REVIEW_LIMITS.name) &&
    text(o.note, FIELD_REVIEW_LIMITS.text) &&
    lonLat(o.coordinate) &&
    (o.recordedAt === undefined || text(o.recordedAt, 40)) &&
    !!o.attributes &&
    typeof o.attributes === 'object' &&
    !Array.isArray(o.attributes) &&
    Object.keys(o.attributes).length <= FIELD_REVIEW_LIMITS.attributes &&
    Object.entries(o.attributes).every(([k, v]) => k.length <= 100 && text(v, FIELD_REVIEW_LIMITS.text)) &&
    text(o.file, FIELD_REVIEW_LIMITS.name) &&
    (o.status === 'pending' || o.status === 'accepted' || o.status === 'rejected') &&
    (o.issuedChainage === undefined || finite(o.issuedChainage)) &&
    (o.currentChainage === undefined || finite(o.currentChainage)) &&
    (o.decidedOn === undefined || (text(o.decidedOn, 10) && DATE.test(o.decidedOn)))
  )
}

export function parseFieldReview(raw: unknown): FieldReviewState {
  const r = raw as FieldReviewState
  if (!r || typeof r !== 'object' || !Array.isArray(r.issues) || !Array.isArray(r.observations))
    throw Error('Field review must list issues and observations.')
  if (r.issues.length > FIELD_REVIEW_LIMITS.issues)
    throw Error(`A project keeps at most ${FIELD_REVIEW_LIMITS.issues} field issues.`)
  if (r.observations.length > FIELD_REVIEW_LIMITS.observations)
    throw Error(`A project keeps at most ${FIELD_REVIEW_LIMITS.observations} field observations.`)
  const issueIds = new Set<string>(),
    labels = new Set<string>()
  for (const issue of r.issues) {
    if (!checkIssue(issue) || issueIds.has(issue.id) || labels.has(issue.label))
      throw Error('Invalid field review issue.')
    issueIds.add(issue.id)
    labels.add(issue.label)
  }
  const ids = new Set<string>()
  for (const o of r.observations) {
    if (!checkObservation(o) || ids.has(o.id)) throw Error('Invalid field observation.')
    ids.add(o.id)
  }
  return structuredClone({ issues: r.issues, observations: r.observations })
}
