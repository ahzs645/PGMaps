/**
 * TypeScript side of the cable-layout optimizer (`crates/cable-layout`, Rust compiled to
 * `cable_layout.wasm`): the intermediate-support search of Bont & Heinimann (2012) as described by
 * Bont et al. (2022), with Zweifel (1960) and Irvine (1981) span mechanics and Pestal (1961)
 * support angles and saddle forces. This file encodes the run, drives the module and decodes the
 * result; it has no DOM or network access, so a test hands it the wasm bytes from disk and the
 * worker (`cableLayout.worker.ts`) hands it the fetched file.
 *
 * Written from a functional specification of SEILAPLAN 3.8.2; no code from SEILAPLAN
 * (GPL-2.0-or-later) was used.
 *
 * Units: kN, kN/m and m. Stations are horizontal metres from the yarder-side end of the line.
 */

/** Layout of the f64 buffers; keep in step with `crates/cable-layout/src/codec.rs`. */
export const LAYOUT_FORMAT_VERSION = 2
const HEADER = 41
const OUT_HEADER = 34
const SUPPORT_FIELDS = 18
const SPAN_FIELDS = 17
const SAMPLE_FIELDS = 4
const ARC_FIELDS = 11

export type LayoutModel = 'catenary' | 'parity'
export type LayoutStartKind = 'yarder' | 'support' | 'anchor'
export type LayoutEndKind = 'support' | 'anchor'
export type CableSystem = 'two-cable' | 'multi-cable'

/** Everything one run needs, in the crate's units. */
export interface CableLayoutInput {
  model: LayoutModel
  startKind: LayoutStartKind
  endKind: LayoutEndKind
  towerHeightM: number
  cableSystem: CableSystem
  trafficableFromStartM: number
  trafficableBeforeEndM: number
  minClearanceM: number
  clearanceFromStartM: number
  clearanceBeforeEndM: number
  /** Clearance required inside the two end zones (the reference program: −1 m). */
  zoneClearanceM: number
  loadKN: number
  ropeKNPerM: number
  runningLinesKNPerM: number
  stiffnessKN: number
  allowableKN: number
  tensionLowKN: number
  tensionHighKN: number
  tensionStepKN: number
  minSupportSpacingM: number
  candidateSpacingM: number
  minHeightM: number
  maxHeightM: number
  heightStepM: number
  builtSupportAboveM: number
  liftOffDeg: number
  holdDownDeg: number
  maxLoadedDeg: number
  maxLoadedEndDeg: number
  anchorDistanceM: number
  /** Parity only: support height SEILAPLAN uses for the anchor rope before optimizing. */
  anchorReferenceHeightM: number
  /** Catenary only: smallest fall of the loaded path for a gravity carriage, m per m. */
  minGravityGrade: number
  lineEndM: number
  maxSpans: number
  loadPositions: number
  /** Ground every `dx` m from station `x0` (≤ 0); NaN is unknown ground. */
  profile: { x0: number; dx: number; z: ArrayLike<number> }
  fixedSupports: readonly { stationM: number; heightM?: number }[]
  noSupportSectors: readonly { fromM: number; toM: number }[]
}

export type LayoutStatus = 'complete' | 'incomplete' | 'no-layout'
export type LayoutReason =
  | 'none'
  | 'clearance'
  | 'tension'
  | 'gravity'
  | 'unknown-ground'
  | 'unsolvable'
  | 'tension-window'
  | 'lift-off'
  | 'loaded-angle'
  | 'no-candidates'
  | 'budget'
const REASONS: LayoutReason[] = [
  'none',
  'clearance',
  'tension',
  'gravity',
  'unknown-ground',
  'unsolvable',
  'tension-window',
  'lift-off',
  'loaded-angle',
  'no-candidates',
  'budget',
]
export type LayoutSupportKind = 'yarder' | 'support' | 'ground-anchor' | 'anchor'
const SUPPORT_KINDS: LayoutSupportKind[] = ['yarder', 'support', 'ground-anchor', 'anchor']

export interface LayoutSupport {
  kind: LayoutSupportKind
  stationM: number
  groundM: number
  heightM: number
  fixed: boolean
  emptyTensionKN: number | null
  angleInDeg: number | null
  angleOutDeg: number | null
  emptyBreakDeg: number | null
  loadedBreakDeg: number | null
  loadedLimitDeg: number | null
  liftOffLimitDeg: number | null
  saddleRopeKN: number | null
  saddleCarriageOnKN: number | null
  saddleBeforeKN: number | null
  saddleAfterKN: number | null
  maxForceKN: number | null
  pullAngleDeg: number | null
}

export interface LayoutSpan {
  fromM: number
  toM: number
  chordM: number
  emptySagM: number | null
  loadedSagM: number | null
  loadedTensionKN: number | null
  peakTensionKN: number | null
  solved: boolean
  unknownGroundAtM: number | null
  minClearanceM: number | null
  minClearanceAtM: number | null
  /** Largest shortfall against the required clearance and where (≤ 0 when it clears). */
  worstShortfallM: number | null
  worstAtM: number | null
  clearanceOk: boolean
  gravityOk: boolean
  gravityFailsAtM: number | null
  tensionOk: boolean
}

export interface LayoutArc {
  fromM: number
  fromHeightM: number
  toM: number
  toHeightM: number
  feasible: boolean
  lowKN: number | null
  highKN: number | null
  reason: LayoutReason
  atM: number | null
  value: number | null
  value2: number | null
}

export interface CableLayoutResult {
  status: LayoutStatus
  reason: LayoutReason
  reasonAtM: number | null
  reasonValue: number | null
  reasonValue2: number | null
  preTensionKN: number | null
  tieLowKN: number | null
  tieHighKN: number | null
  tieCount: number
  objective: number | null
  reachM: number
  spansTotal: number
  spansEvaluated: number
  verifications: number
  ropeLengthM: number | null
  unstrainedLengthM: number | null
  maxTensionKN: number | null
  maxTensionSpan: number | null
  allowableKN: number
  tensionOk: boolean
  minClearanceM: number | null
  minClearanceAtM: number | null
  clearanceKnown: boolean
  liftOff: boolean
  maxEmptyHeightM: number | null
  supports: LayoutSupport[]
  spans: LayoutSpan[]
  /** Per profile sample from the start to the end: station, loaded path, empty rope, ground. */
  samples: { stationM: number; loadM: number | null; emptyM: number | null; groundM: number | null }[]
  peaksM: number[]
  candidateSitesM: number[]
  arcs: LayoutArc[]
}

/** Why a run is refused before it starts. */
export const INPUT_ERROR_MESSAGES: Record<number, string> = {
  1: 'The layout input is malformed.',
  2: 'The ground profile is too short or does not reach the end support.',
  3: 'Ground at the start or end support is unknown.',
  4: 'A two-cable (gravity) system needs the yarder above the end of the line.',
  5: 'The minimum clearance is above the lowest support height.',
  6: 'An anchor end needs a clearance zone longer than 0 m: the carriage cannot keep the clearance up to a ground anchor.',
  7: 'A fixed support lies outside the line, on unknown ground, has an invalid height, or shares a station with another.',
  8: 'A no-support sector must run forwards (from < to).',
  9: 'Support heights or the candidate spacing are invalid.',
  10: 'The pre-tension range is invalid.',
  11: 'The rope, load or allowable tension is invalid.',
  12: 'Too many spans to check. Widen the candidate spacing, narrow the height range or shorten the line.',
  13: 'A fixed support lies inside a no-support sector.',
}

export class CableLayoutInputError extends Error {
  readonly code: number
  constructor(code: number) {
    super(INPUT_ERROR_MESSAGES[code] ?? 'The layout input was refused.')
    this.code = code
  }
}

const enumIndex = <T extends string>(values: readonly T[], value: T, label: string) => {
  const i = values.indexOf(value)
  if (i < 0) throw new Error(`Unknown ${label}: ${value}`)
  return i
}

/** The first 36 header values: the settings shared by a layout run and a coverage batch. */
function settingsHead(input: Omit<CableLayoutInput, 'profile' | 'fixedSupports' | 'noSupportSectors'>): number[] {
  return [
    LAYOUT_FORMAT_VERSION,
    enumIndex(['catenary', 'parity'] as const, input.model, 'model'),
    enumIndex(['yarder', 'support', 'anchor'] as const, input.startKind, 'start'),
    enumIndex(['support', 'anchor'] as const, input.endKind, 'end'),
    input.towerHeightM,
    enumIndex(['two-cable', 'multi-cable'] as const, input.cableSystem, 'cable system'),
    input.trafficableFromStartM,
    input.trafficableBeforeEndM,
    input.minClearanceM,
    input.clearanceFromStartM,
    input.clearanceBeforeEndM,
    input.zoneClearanceM,
    input.loadKN,
    input.ropeKNPerM,
    input.runningLinesKNPerM,
    input.stiffnessKN,
    input.allowableKN,
    input.tensionLowKN,
    input.tensionHighKN,
    input.tensionStepKN,
    input.minSupportSpacingM,
    input.candidateSpacingM,
    input.minHeightM,
    input.maxHeightM,
    input.heightStepM,
    input.builtSupportAboveM,
    input.liftOffDeg,
    input.holdDownDeg,
    input.maxLoadedDeg,
    input.maxLoadedEndDeg,
    input.anchorDistanceM,
    input.anchorReferenceHeightM,
    input.minGravityGrade,
    input.lineEndM,
    input.maxSpans,
    input.loadPositions,
  ]
}

export function encodeLayoutInput(input: CableLayoutInput, layout?: LayoutToAnalyse): Float64Array {
  const z = Array.from(input.profile.z, (v) => (Number.isFinite(v) ? v : NaN))
  const head = [
    ...settingsHead(input),
    input.profile.x0,
    input.profile.dx,
    z.length,
    input.fixedSupports.length,
    input.noSupportSectors.length,
  ]
  if (head.length !== HEADER) throw new Error('Layout header out of step with the crate.')
  const out = [
    ...head,
    ...z,
    ...input.fixedSupports.flatMap((f) => [f.stationM, f.heightM ?? NaN]),
    ...input.noSupportSectors.flatMap((s) => [s.fromM, s.toM]),
  ]
  if (layout)
    out.push(
      layout.preTensionKN,
      layout.complete ? 1 : 0,
      layout.supports.length,
      ...layout.supports.flatMap((s) => [s.stationM, s.heightM]),
    )
  return Float64Array.from(out)
}

const opt = (v: number) => (Number.isFinite(v) ? v : null)

export function decodeLayoutResult(b: Float64Array): CableLayoutResult {
  if (b[0] !== LAYOUT_FORMAT_VERSION) throw new Error('The cable-layout module answered in an unknown format.')
  if (b[1] === 1) throw new CableLayoutInputError(b[2])
  const count = (i: number) => b[i] | 0
  const [nSupports, nSpans, nSamples, nPeaks, nSites, nArcs] = [16, 17, 18, 19, 20, 21].map(count)
  let at = OUT_HEADER
  const supports: LayoutSupport[] = []
  for (let i = 0; i < nSupports; i++, at += SUPPORT_FIELDS) {
    const r = b.subarray(at, at + SUPPORT_FIELDS)
    supports.push({
      kind: SUPPORT_KINDS[r[0]] ?? 'support',
      stationM: r[1],
      groundM: r[2],
      heightM: r[3],
      fixed: r[4] === 1,
      emptyTensionKN: opt(r[5]),
      angleInDeg: opt(r[6]),
      angleOutDeg: opt(r[7]),
      emptyBreakDeg: opt(r[8]),
      loadedBreakDeg: opt(r[9]),
      loadedLimitDeg: opt(r[10]),
      liftOffLimitDeg: opt(r[11]),
      saddleRopeKN: opt(r[12]),
      saddleCarriageOnKN: opt(r[13]),
      saddleBeforeKN: opt(r[14]),
      saddleAfterKN: opt(r[15]),
      maxForceKN: opt(r[16]),
      pullAngleDeg: opt(r[17]),
    })
  }
  const spans: LayoutSpan[] = []
  for (let i = 0; i < nSpans; i++, at += SPAN_FIELDS) {
    const r = b.subarray(at, at + SPAN_FIELDS)
    spans.push({
      fromM: r[0],
      toM: r[1],
      chordM: r[2],
      emptySagM: opt(r[3]),
      loadedSagM: opt(r[4]),
      loadedTensionKN: opt(r[5]),
      peakTensionKN: opt(r[6]),
      solved: r[7] === 1,
      unknownGroundAtM: opt(r[8]),
      minClearanceM: opt(r[9]),
      minClearanceAtM: opt(r[10]),
      worstShortfallM: opt(r[11]),
      worstAtM: opt(r[12]),
      clearanceOk: r[13] === 1,
      gravityOk: r[14] === 1,
      gravityFailsAtM: opt(r[15]),
      tensionOk: r[16] === 1,
    })
  }
  const samples: CableLayoutResult['samples'] = []
  for (let i = 0; i < nSamples; i++, at += SAMPLE_FIELDS)
    samples.push({ stationM: b[at], loadM: opt(b[at + 1]), emptyM: opt(b[at + 2]), groundM: opt(b[at + 3]) })
  const peaksM = Array.from(b.subarray(at, at + nPeaks))
  at += nPeaks
  const candidateSitesM = Array.from(b.subarray(at, at + nSites))
  at += nSites
  const arcs: LayoutArc[] = []
  for (let i = 0; i < nArcs; i++, at += ARC_FIELDS) {
    const r = b.subarray(at, at + ARC_FIELDS)
    arcs.push({
      fromM: r[0],
      fromHeightM: r[1],
      toM: r[2],
      toHeightM: r[3],
      feasible: r[4] === 1,
      lowKN: opt(r[5]),
      highKN: opt(r[6]),
      reason: REASONS[r[7]] ?? 'none',
      atM: opt(r[8]),
      value: opt(r[9]),
      value2: opt(r[10]),
    })
  }
  return {
    status: (['complete', 'incomplete', 'no-layout'] as const)[b[2]] ?? 'no-layout',
    reason: REASONS[b[3]] ?? 'none',
    reasonAtM: opt(b[4]),
    reasonValue: opt(b[5]),
    reasonValue2: opt(b[6]),
    preTensionKN: opt(b[7]),
    tieLowKN: opt(b[8]),
    tieHighKN: opt(b[9]),
    tieCount: count(10),
    objective: opt(b[11]),
    reachM: b[12],
    spansTotal: count(13),
    spansEvaluated: count(14),
    verifications: count(15),
    ropeLengthM: opt(b[22]),
    unstrainedLengthM: opt(b[23]),
    maxTensionKN: opt(b[24]),
    maxTensionSpan: opt(b[25]),
    tensionOk: b[26] === 1,
    minClearanceM: opt(b[27]),
    minClearanceAtM: opt(b[28]),
    clearanceKnown: b[29] === 1,
    liftOff: b[30] === 1,
    maxEmptyHeightM: opt(b[31]),
    allowableKN: b[32],
    supports,
    spans,
    samples,
    peaksM,
    candidateSitesM,
    arcs,
  }
}

/** A layout to analyse without searching (a saved or hand-edited line). */
export interface LayoutToAnalyse {
  preTensionKN: number
  complete: boolean
  /** Supports from the yarder end, including both ends. */
  supports: readonly { stationM: number; heightM: number }[]
}

// --- Coverage screen (`crates/cable-layout/src/coverage.rs`) -----------------------------------

const COVER_HEADER = 42
const LINE_HEAD = 4
/** Most intermediate supports per coverage line; keep in step with the crate's `MAX_COVER_SUPPORTS`. */
export const COVER_MAX_SUPPORTS = 10
const COVER_FIELDS = 8 + 2 * (COVER_MAX_SUPPORTS + 2)

/**
 * A batch of candidate lines for the coverage screen: the shared settings (a yarder start, one
 * support height as `minHeightM` = `maxHeightM`, a tension grid of at most 64 levels) and, per
 * line, its ground from the yarder every `dx` m and the farthest tail to try.
 */
export interface CableCoverInput {
  settings: Omit<CableLayoutInput, 'profile' | 'fixedSupports' | 'noSupportSectors' | 'lineEndM'>
  tailHeightM: number
  maxSupports: number
  /** Distance between tails tried, m. */
  tailStepM: number
  /** Shortest line kept, m (horizontal). */
  minLengthM: number
  /** Spans one line may evaluate before it is reported at its budget. */
  maxSpansPerLine: number
  lines: readonly { dx: number; z: ArrayLike<number>; maxTailM: number }[]
}

export type CoverLineStatus = 'feasible' | 'none' | 'budget'
export interface CoverLineResult {
  status: CoverLineStatus
  /** Horizontal length of the line found, m (0 when none). */
  lengthM: number
  /** Intermediate supports. */
  supportCount: number
  preTensionKN: number | null
  /** Why the farthest tail tried did not work, and where. */
  reason: LayoutReason
  reasonAtM: number | null
  spansEvaluated: number
  analyses: number
  /** Yarder, supports and tail: station from the yarder and skyline height above the ground. */
  points: { stationM: number; heightM: number }[]
}

export function encodeCoverInput(input: CableCoverInput): Float64Array {
  const head = [
    ...settingsHead({ ...input.settings, lineEndM: 0 }),
    input.tailHeightM,
    input.maxSupports,
    input.tailStepM,
    input.minLengthM,
    input.maxSpansPerLine,
    input.lines.length,
  ]
  if (head.length !== COVER_HEADER) throw new Error('Coverage header out of step with the crate.')
  let size = head.length
  for (const line of input.lines) size += LINE_HEAD + line.z.length
  const out = new Float64Array(size)
  out.set(head)
  let at = head.length
  for (const line of input.lines) {
    out[at++] = 0
    out[at++] = line.dx
    out[at++] = line.z.length
    out[at++] = line.maxTailM
    for (let i = 0; i < line.z.length; i++) out[at++] = Number.isFinite(line.z[i]) ? line.z[i] : NaN
  }
  return out
}

export function decodeCoverResult(b: Float64Array): CoverLineResult[] {
  if (b[0] !== LAYOUT_FORMAT_VERSION) throw new Error('The cable-layout module answered in an unknown format.')
  if (b[1] === 1) throw new CableLayoutInputError(b[2])
  const n = b[2] | 0
  const out: CoverLineResult[] = []
  for (let k = 0, at = 3; k < n; k++, at += COVER_FIELDS) {
    const r = b.subarray(at, at + COVER_FIELDS)
    const points: CoverLineResult['points'] = []
    for (let j = 0; j < COVER_MAX_SUPPORTS + 2; j++)
      if (Number.isFinite(r[8 + 2 * j])) points.push({ stationM: r[8 + 2 * j], heightM: r[9 + 2 * j] })
    out.push({
      status: (['feasible', 'none', 'budget'] as const)[r[0]] ?? 'none',
      lengthM: r[1],
      supportCount: r[2] | 0,
      preTensionKN: opt(r[3]),
      reason: REASONS[r[4]] ?? 'none',
      reasonAtM: opt(r[5]),
      spansEvaluated: r[6] | 0,
      analyses: r[7] | 0,
      points,
    })
  }
  return out
}

interface Exports {
  memory: WebAssembly.Memory
  cl_alloc(len: number): number
  cl_free(ptr: number, len: number): void
  cl_begin(ptr: number, len: number): number
  cl_step(budget: number): number
  cl_finish(): number
  cl_analyze(ptr: number, len: number): number
  cl_cover(ptr: number, len: number): number
  cl_result_ptr(): number
  cl_result_len(): number
}

/** One instance of the module. It holds one search at a time. */
export class CableLayoutEngine {
  private readonly x: Exports
  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as Exports
  }

  private withInput<T>(data: Float64Array, call: (ptr: number, len: number) => T): T {
    const ptr = this.x.cl_alloc(data.length)
    new Float64Array(this.x.memory.buffer, ptr, data.length).set(data)
    try {
      return call(ptr, data.length)
    } finally {
      this.x.cl_free(ptr, data.length)
    }
  }

  private result(): Float64Array {
    const len = this.x.cl_result_len()
    return new Float64Array(this.x.memory.buffer, this.x.cl_result_ptr(), len).slice()
  }

  /** Starts a search; returns the number of spans it will check. Throws on refused input. */
  begin(input: CableLayoutInput): number {
    const spans = this.withInput(encodeLayoutInput(input), (ptr, len) => this.x.cl_begin(ptr, len))
    if (spans < 0) throw new CableLayoutInputError(-spans)
    return spans
  }

  /** Checks up to `budget` more spans; returns the share done (1 when every span is checked). */
  step(budget: number): number {
    return this.x.cl_step(budget)
  }

  finish(): CableLayoutResult {
    this.x.cl_finish()
    return decodeLayoutResult(this.result())
  }

  /** Raw result buffer of the last finish or analysis (for transfer out of a worker). */
  finishRaw(): Float64Array {
    this.x.cl_finish()
    return this.result()
  }

  analyzeRaw(input: CableLayoutInput, layout: LayoutToAnalyse): Float64Array {
    this.withInput(encodeLayoutInput(input, layout), (ptr, len) => this.x.cl_analyze(ptr, len))
    return this.result()
  }

  analyze(input: CableLayoutInput, layout: LayoutToAnalyse): CableLayoutResult {
    return decodeLayoutResult(this.analyzeRaw(input, layout))
  }

  /** Screens a batch of coverage lines; the raw result buffer. */
  coverRaw(input: CableCoverInput): Float64Array {
    this.withInput(encodeCoverInput(input), (ptr, len) => this.x.cl_cover(ptr, len))
    return this.result()
  }

  cover(input: CableCoverInput): CoverLineResult[] {
    return decodeCoverResult(this.coverRaw(input))
  }
}

export async function instantiateCableLayout(source: BufferSource | WebAssembly.Module): Promise<CableLayoutEngine> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
  return new CableLayoutEngine(await WebAssembly.instantiate(module, {}))
}

/**
 * The search as a generator for `cooperative.ts`: each step checks `budget` spans and reports the
 * share done; the return value is the result.
 */
export function* layoutSteps(
  engine: CableLayoutEngine,
  input: CableLayoutInput,
  budget = 64,
): Generator<number, CableLayoutResult> {
  engine.begin(input)
  let done = 0
  while (done < 1) {
    done = engine.step(budget)
    yield done
  }
  return engine.finish()
}

/** The supports between the ends (the last one reached too, when the line stops short). */
export function intermediateSupports(result: Pick<CableLayoutResult, 'status' | 'supports'>): LayoutSupport[] {
  const line = result.supports.filter((s) => s.kind !== 'anchor')
  return result.status === 'complete' ? line.slice(1, -1) : line.slice(1)
}

const m = (v: number | null) => (v === null ? '?' : `${Math.round(v)} m`)
const kN = (v: number | null) => (v === null ? '?' : `${Math.round(v)} kN`)

/** The run's limiting reason in words, naming the limit and the place. */
export function layoutReasonText(r: Pick<CableLayoutResult, 'reason' | 'reasonAtM' | 'reasonValue' | 'reasonValue2'>) {
  switch (r.reason) {
    case 'none':
      return ''
    case 'clearance':
      return `The loaded carriage would not clear the ground at ${m(r.reasonAtM)}${r.reasonValue !== null ? ` (short by ${r.reasonValue.toFixed(1)} m)` : ''}.`
    case 'tension':
      return `The skyline would exceed its allowable tension (${kN(r.reasonValue)} at the lowest pre-tension).`
    case 'gravity':
      return `A gravity carriage would stop at ${m(r.reasonAtM)}: the loaded path does not fall away from the yarder there.`
    case 'unknown-ground':
      return `Ground is unknown at ${m(r.reasonAtM)}, so no span over it can be shown to clear.`
    case 'unsolvable':
      return 'The rope cannot hold the load on the next span at any pre-tension searched.'
    case 'tension-window':
      return `The next span (to ${m(r.reasonAtM)}) needs a pre-tension of ${kN(r.reasonValue)}–${kN(r.reasonValue2)}, which the rest of the line cannot share.`
    case 'lift-off':
      return `The empty skyline would lift off the support at ${m(r.reasonAtM)} (break angle ${r.reasonValue?.toFixed(1) ?? '?'}°).`
    case 'loaded-angle':
      return `The loaded break angle at ${m(r.reasonAtM)} would be ${r.reasonValue?.toFixed(1) ?? '?'}°, over the limit.`
    case 'no-candidates':
      return 'There is no candidate support site beyond the last support.'
    case 'budget':
      return 'The search stopped at its repair budget before finding a layout that passes the final check.'
  }
}
