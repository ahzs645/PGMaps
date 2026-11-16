/**
 * How a RoadEng template component builds its section: its parameter expressions evaluated, its
 * fragments and legs read, and the roadway's subgrade edge and course boundaries worked out the way
 * the component's own construction places them.
 *
 * The layout below was read from Softree's native component library (`WebTemplateComponents.tpl`,
 * 124 component definitions) and checked against every roadway component the sample designs use
 * (Rural I in three versions, Rural Paved, Resource I, the guard-rail Roadway):
 *
 * - `T<t>-C<c>-U<u>-1` is a calculated parameter's expression: numbers, parameter names, `+ - * /`,
 *   brackets, the comparisons `> < =` (also `>= <= <> !=`), `&` and `|` (1 true, 0 false), and the
 *   functions `if(c, a, b)`, `abs`, `sqrt`, `floor`, `max`, `min`, `sin`, `cos`, `tan`, `atan`
 *   (radians: the library writes `sin(3.1415926/NumCords)` and `tan(deg × 3.141592653 / 180)`).
 *   Inside an expression a slope parameter is in percent: `S_THICK_ADJ1 = AcpThick +
 *   ((SHLDS_GRAVEL_SLP / 100) × ShoulderGravWidth) + …` and the stored results (`NETLANE_SLOPE`
 *   −2 for a −0.02 `_SUPER`) say so. An entered slope is stored as rise over run; a calculated one
 *   is stored as the expression gave it, in percent. Names starting `_FRAG_` or `_CLZ` are values
 *   RoadEng has only while it builds a section; an expression using one keeps its stored value.
 * - `T<t>-C<c>-F<f>` is a fragment: leg count, surface type (`SGL` a layer surface, `-?-` the
 *   finished surface, `DL` a ditch line, `SLPL` a slope, …), name, a flag word whose lowest bit marks
 *   a left fragment, its surface number (1 the subgrade), …, and in field 12 the parameter that sets
 *   its height at the attachment point.
 * - `T<t>-C<c>-F<f>-L<l>` is a leg: horizontal distance and slope (rise over run; 999999 vertical) as
 *   last calculated, a flag word, −1, a point code (`RE-` the road edge), the number of added terms, four fields per term, then three fields: an
 *   option word, the parameter giving its slope and the parameter giving its distance (−1 none).
 *   Each term adds `numerator ÷ denominator` to the leg's distance: a course thickness over its
 *   fill slope (`BaseThick / BaseFillSlope`), the horizontal run of the course edge below.
 *   In the flag word, bit 7 marks a distance measured vertically, bit 6 one measured along the leg,
 *   neither a horizontal one, and bit 53 a leg that falls. Read from the library's 1,740 legs (1,391 with a distance parameter) by
 *   what their distance parameters say they are: of the legs whose distance is a height, depth or
 *   thickness, 263 of 274 carry bit 6 or 7 against 6 of 421 whose distance is a width or offset;
 *   every parameter described as a "slope distance" or "slope length" (`DaylightDist`,
 *   `ArmorTopLength`, `CurbRiserLen`, `Dist` of Link Offset IV) carries bit 6; and bit 53 follows
 *   the direction, not the measure: Slope VI's fill faces (`BenchHeight`, down) carry 7 and 53, its
 *   cut faces (up) 7 alone, Ditch I's backslope height (up) 7 alone, and Rural VIII's subgrade width
 *   (`SubgradeWidth`, a horizontal distance at the falling crossfall) 53 alone.
 * - A parameter is named in a fragment or a term by one bit of a word: bit 15 + its `U` number.
 *   In field 12 the lowest bit set means the parameter is a depth below the attachment point; clear,
 *   a height above it (Rural Paved's `SG_DEPTH = −(CSTC_THICK + BASE_THICK)`).
 *
 * What this settles: a roadway's lane width is its running surface, and its subgrade edge, where
 * the ditch and the batters hang, lies further out by each course's thickness over its fill slope,
 * as its construction adds them (Rural I: `ROAD_WIDTH + S_THICK_ADJ1/BaseFillSlope +
 * BaseThick/BaseFillSlope + SubbaseThick/SubbaseFillSlope`; Rural Paved: `ROAD_WIDTHL +
 * CSTC_THICK_ADJ/CSTC_SLOPE + BASE_THICK/BASE_SLOPE`; the library's Lane: the lane width alone,
 * square-edged). The subgrade lies the fragment's own depth below the attachment point: Rural Paved
 * insets its pavement in the crushed top course, so its subgrade is `CSTC_THICK + BASE_THICK` down,
 * not the three thicknesses summed; Resource I puts its subgrade at the attachment point with the
 * surfacing above it.
 *
 * Pure: no DOM or network access.
 */
import type { RoadEngComponent, RoadEngParameter } from './roadEngDesignSettings'

/** RoadEng's first parameter bit: a parameter `U<n>` is bit `n + this` of a parameter word. */
export const ROADENG_PARAMETER_BIT = 15
/** Leg flag bits: the leg's distance is measured vertically, or along the leg; the leg falls. */
export const ROADENG_VERTICAL_LEG_BIT = 7
export const ROADENG_SLOPE_DISTANCE_LEG_BIT = 6
export const ROADENG_FALLING_LEG_BIT = 53
/** A slope at or past this rise over run is vertical (`999999`, the library's `9999.99`). */
export const ROADENG_VERTICAL_SLOPE = 9000
/** A leg with no distance parameter and a stated distance at least this long runs to what it meets. */
export const ROADENG_OPEN_LEG = 100
/** Characters of one expression evaluated, and parameters resolved through one another, at most. */
export const MAX_EXPRESSION_LENGTH = 2000
export const MAX_EXPRESSION_DEPTH = 32

// ---- Expressions ---------------------------------------------------------------------------------

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  IF: ([c, a, b]) => (c !== 0 ? a : b),
  ABS: ([x]) => Math.abs(x),
  SQRT: ([x]) => Math.sqrt(x),
  FLOOR: ([x]) => Math.floor(x),
  MAX: (xs) => Math.max(...xs),
  MIN: (xs) => Math.min(...xs),
  SIN: ([x]) => Math.sin(x),
  COS: ([x]) => Math.cos(x),
  TAN: ([x]) => Math.tan(x),
  ATAN: ([x]) => Math.atan(x),
}
const ARITY: Record<string, [number, number]> = {
  IF: [3, 3],
  MAX: [1, 20],
  MIN: [1, 20],
}

/**
 * Evaluates a RoadEng parameter expression. `lookup` gives a name's value (in expression units:
 * slopes in percent), undefined for one it does not know. Null for anything it cannot evaluate: an
 * unknown name or function, a syntax it does not read, or a result that is not a finite number.
 */
export function evaluateRoadEngExpression(text: string, lookup: (name: string) => number | undefined): number | null {
  if (!text.trim() || text.length > MAX_EXPRESSION_LENGTH) return null
  const tokens =
    text.match(
      /\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|>=|<=|<>|!=|==|[-+*/()<>=&|,]|\S/gi,
    ) ?? []
  let k = 0
  const fail = Symbol('fail')
  const peek = () => tokens[k]
  const expect = (t: string) => {
    if (tokens[k++] !== t) throw fail
  }
  const primary = (): number => {
    const t = tokens[k++]
    if (t === undefined) throw fail
    if (t === '(') {
      const v = or()
      expect(')')
      return v
    }
    if (t === '-') return -primary()
    if (t === '+') return primary()
    if (/^[\d.]/.test(t)) {
      const v = Number(t)
      if (!Number.isFinite(v)) throw fail
      return v
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        const fn = FUNCTIONS[t.toUpperCase()]
        if (!fn) throw fail
        k++
        const args: number[] = []
        if (peek() !== ')')
          for (;;) {
            args.push(or())
            if (peek() === ',') k++
            else break
          }
        expect(')')
        const [low, high] = ARITY[t.toUpperCase()] ?? [1, 1]
        if (args.length < low || args.length > high) throw fail
        return fn(args)
      }
      const v = lookup(t)
      if (v === undefined || !Number.isFinite(v)) throw fail
      return v
    }
    throw fail
  }
  const product = (): number => {
    let v = primary()
    while (peek() === '*' || peek() === '/') {
      const op = tokens[k++]
      const r = primary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[k++]
      const r = product()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const comparison = (): number => {
    let v = sum()
    for (;;) {
      const op = peek()
      if (!op || !['>', '<', '>=', '<=', '=', '==', '<>', '!='].includes(op)) return v
      k++
      const r = sum()
      const truth =
        op === '>'
          ? v > r
          : op === '<'
            ? v < r
            : op === '>='
              ? v >= r
              : op === '<='
                ? v <= r
                : op === '=' || op === '=='
                  ? v === r
                  : v !== r
      v = truth ? 1 : 0
    }
  }
  const and = (): number => {
    let v = comparison()
    while (peek() === '&') {
      k++
      const r = comparison()
      v = v !== 0 && r !== 0 ? 1 : 0
    }
    return v
  }
  const or = (): number => {
    let v = and()
    while (peek() === '|') {
      k++
      const r = and()
      v = v !== 0 || r !== 0 ? 1 : 0
    }
    return v
  }
  try {
    if (!tokens.length) return null
    const v = or()
    return k === tokens.length && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

// ---- Parameter values ---------------------------------------------------------------------------

/** A parameter's value as its construction uses it. */
export interface RoadEngParameterValue {
  /** In expression units: project units for a length, percent for a slope. */
  expression: number
  /** True when the parameter is calculated and its expression could not be evaluated: the stored value is used. */
  stored: boolean
}

const isSlope = (p: RoadEngParameter) => (p.flags & 1) !== 0

/**
 * Every parameter of a component in expression units, each calculated one from its expression
 * (evaluated through the others, the stored value where it cannot be). Keyed by upper-case name.
 */
export function roadEngParameterValues(c: Pick<RoadEngComponent, 'parameters'>): Map<string, RoadEngParameterValue> {
  const byName = new Map(c.parameters.map((p) => [p.name.toUpperCase(), p]))
  const out = new Map<string, RoadEngParameterValue>()
  const busy = new Set<string>()
  const resolve = (name: string, depth: number): RoadEngParameterValue | undefined => {
    const key = name.toUpperCase()
    const done = out.get(key)
    if (done) return done
    const p = byName.get(key)
    if (!p) return undefined
    const own = isSlope(p) && !p.formula ? p.raw * 100 : p.raw
    let value: RoadEngParameterValue = { expression: own, stored: false }
    if (p.formula) {
      let v: number | null = null
      if (!busy.has(key) && depth < MAX_EXPRESSION_DEPTH) {
        busy.add(key)
        v = evaluateRoadEngExpression(p.formula, (n) => resolve(n, depth + 1)?.expression)
        busy.delete(key)
      }
      value = v === null ? { expression: p.raw, stored: true } : { expression: v, stored: false }
    }
    out.set(key, value)
    return value
  }
  for (const p of c.parameters) resolve(p.name, 0)
  return out
}

// ---- Fragments and legs -------------------------------------------------------------------------

/** A parameter named by one bit of a parameter word, and the word's lowest bit. */
export interface RoadEngParameterRef {
  index: number
  /** The word's lowest bit: in a fragment's field 12, a depth below the attachment point. */
  low: boolean
}

/** Decodes a parameter word (`2^(15 + n)`, plus 1 for the low bit); null for 0 or a word naming no single parameter. */
export function roadEngParameterRef(word: string | undefined): RoadEngParameterRef | null {
  if (word === undefined || !/^\d+$/.test(word.trim())) return null
  let w = BigInt(word.trim())
  const low = (w & 1n) === 1n
  w &= ~1n
  if (w === 0n || (w & (w - 1n)) !== 0n) return null
  const bit = w.toString(2).length - 1
  return bit >= ROADENG_PARAMETER_BIT ? { index: bit - ROADENG_PARAMETER_BIT, low } : null
}

export interface RoadEngLegTerm {
  numerator: number
  denominator: number
}
export interface RoadEngLeg {
  index: number
  /** Distance and slope as last calculated (the slope rise over run, 999999 vertical). */
  distance: number
  slope: number
  /** The distance is measured vertically. */
  vertical: boolean
  /** The distance is measured along the leg (a slope distance). */
  alongSlope: boolean
  /** The leg falls (runs down) from its start. */
  falls: boolean
  code: string
  /** The parameters giving the slope and the distance (`U` numbers); null where the stated value holds. */
  slopeParameter: number | null
  distanceParameter: number | null
  terms: RoadEngLegTerm[]
}
export interface RoadEngFragment {
  index: number
  surfaceType: string
  name: string
  side: 'left' | 'right'
  /** Its surface number: 1 is the subgrade. */
  surface: number
  /** The parameter setting its height at the attachment point; null where it starts there. */
  height: RoadEngParameterRef | null
  /** Point code it attaches at; '-' for the component's attachment point. */
  attach: string
  legs: RoadEngLeg[]
}

const field = (f: string[], k: number) => (f[k] ?? '').trim()
const int = (s: string) => (/^-?\d+$/.test(s) ? Number(s) : NaN)

/**
 * The fragments of one component (`T<t>-C<c>-F<f>` and their legs) from its template section;
 * `prefix` is `T<t>-C<c>-`. A record that does not read as a fragment or a leg is skipped.
 */
export function readRoadEngFragments(section: ReadonlyMap<string, string>, prefix: string): RoadEngFragment[] {
  const fragments = new Map<number, RoadEngFragment>()
  const legs = new Map<number, RoadEngLeg[]>()
  for (const [key, value] of section) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    const fm = /^F(\d+)$/.exec(rest)
    if (fm) {
      const f = value.split(',')
      const bits = int(field(f, 3))
      const surface = int(field(f, 4))
      if (!Number.isFinite(bits) || !Number.isFinite(surface)) continue
      fragments.set(Number(fm[1]), {
        index: Number(fm[1]),
        surfaceType: field(f, 1),
        name: field(f, 2),
        side: bits % 2 === 1 ? 'left' : 'right',
        surface,
        height: roadEngParameterRef(f[12]),
        attach: field(f, 7) || '-',
        legs: [],
      })
      continue
    }
    const lm = /^F(\d+)-L(\d+)$/.exec(rest)
    if (!lm) continue
    const f = value.split(',')
    const count = int(field(f, 5))
    if (!(count >= 0) || f.length < 9 + 4 * count) continue
    const terms: RoadEngLegTerm[] = []
    for (let t = 0; t < count; t++) {
      const a = roadEngParameterRef(f[8 + 4 * t]),
        b = roadEngParameterRef(f[9 + 4 * t])
      // A term whose words name no parameter adds nothing.
      if (a && b) terms.push({ numerator: a.index, denominator: b.index })
    }
    const tail = 6 + 4 * count
    const flags = /^\d+$/.test(field(f, 2)) ? BigInt(field(f, 2)) : 0n
    const slopeP = int(field(f, tail + 1)),
      distP = int(field(f, tail + 2))
    const leg: RoadEngLeg = {
      index: Number(lm[2]),
      distance: Number(field(f, 0)),
      slope: Number(field(f, 1)),
      vertical: ((flags >> BigInt(ROADENG_VERTICAL_LEG_BIT)) & 1n) === 1n,
      alongSlope: ((flags >> BigInt(ROADENG_SLOPE_DISTANCE_LEG_BIT)) & 1n) === 1n,
      falls: ((flags >> BigInt(ROADENG_FALLING_LEG_BIT)) & 1n) === 1n,
      code: field(f, 4),
      slopeParameter: slopeP >= 0 ? slopeP : null,
      distanceParameter: distP >= 0 ? distP : null,
      terms,
    }
    const list = legs.get(Number(lm[1])) ?? []
    list.push(leg)
    legs.set(Number(lm[1]), list)
  }
  for (const [index, list] of legs) {
    const fragment = fragments.get(index)
    if (fragment) fragment.legs = list.sort((a, b) => a.index - b.index)
  }
  return [...fragments.values()].sort((a, b) => a.index - b.index)
}

// ---- The roadway --------------------------------------------------------------------------------

/** A course run its construction adds to the subgrade edge: a thickness over its fill slope. */
export interface RoadEngCourseRun {
  thickness: string
  slope: string
  /** Horizontal run, m. */
  runM: number
}

export interface RoadEngRoadwayConstruction {
  /** Centreline to the subgrade edge (the end of the subgrade fragment's road-edge leg), m. */
  subgradeEdgeM: number
  /** The parameter whose value the subgrade leg starts from (the lane or road width), and that value, m. */
  width: { parameter: string; valueM: number; calculated: boolean }
  /** The course runs the subgrade leg adds past that width. */
  runs: RoadEngCourseRun[]
  /** Depth of the subgrade below the attachment point (RoadEng's profile), m; negative above it. */
  subgradeDepthM: number
  /**
   * Each layer surface's depth below the attachment point at the centreline, m, from the top down,
   * the subgrade last; the courses are the gaps between them.
   */
  surfaceDepthsM: number[]
  /** Calculated parameters the construction used whose stored value stood in for their expression. */
  stored: string[]
  /**
   * A sub-cut the roadway builds under its own subgrade: a layer surface below the subgrade whose
   * fragment runs out level and closes back up (Softree's V9 As-Built tutorial's `Rural w. Sub-cut`:
   * `SC-Bot` at `CZ_DEPTH`, 0.5 m under the subgrade, out `CZ_WIDTH` plus the courses' runs, up a
   * vertical `CZ_EXT_SLOPE`). Null where the roadway has none or one that does not read that way.
   */
  subCut: RoadEngRoadwaySubCut | null
  /** Layer surfaces below the subgrade that do not read as a sub-cut, by fragment name. */
  deeperSurfaces: string[]
}

export interface RoadEngRoadwaySubCut {
  /** The fragment that draws its bottom. */
  fragment: string
  /** Its bottom below the subgrade at the centreline, m. */
  depthM: number
  /** Centreline to the outside of its bottom, m. */
  widthM: number
  /** Its outside face, H:V; 0 vertical. */
  outsideSlope: number
  /** The bottom leg's distance parameter where it alone sets the width (no added runs). */
  widthParameter: string | null
}

/**
 * Where one side of a roadway component puts its subgrade edge and its layer surfaces, read from
 * the subgrade fragment's construction: the leg's distance parameter (evaluated) plus each term's
 * thickness over slope. `unitM` is metres per project unit. Null when the side has no subgrade
 * fragment, or its edge is not a closed sum (a leg that runs to what it meets, a parameter that
 * cannot be found).
 */
export function roadEngRoadwayConstruction(
  c: Pick<RoadEngComponent, 'parameters' | 'fragments'>,
  side: 'left' | 'right',
  unitM: number,
): RoadEngRoadwayConstruction | null {
  const fragments = (c.fragments ?? []).filter((f) => f.side === side)
  const subgrade =
    fragments.find((f) => f.surface === 1 && f.surfaceType === 'SGL' && /subgrade/i.test(f.name)) ??
    fragments.find((f) => f.surface === 1 && f.surfaceType === 'SGL')
  if (!subgrade?.legs.length) return null
  const values = roadEngParameterValues(c)
  const byIndex = new Map(c.parameters.map((p) => [p.index, p]))
  const stored = new Set<string>()
  const valueOf = (index: number) => {
    const p = byIndex.get(index)
    if (!p) return null
    const v = values.get(p.name.toUpperCase())!
    if (v.stored) stored.add(p.name)
    return { p, v: v.expression }
  }
  const length = (index: number) => {
    const x = valueOf(index)
    return x && !isSlope(x.p) ? x.v * unitM : null
  }
  // A slope as rise over run: entered ones are stored that way, calculated ones in percent.
  const slope = (index: number) => {
    const x = valueOf(index)
    return x && isSlope(x.p) ? x.v / 100 : null
  }
  const runOf = (thickness: number, riseOverRun: number) =>
    !(Math.abs(riseOverRun) > 0) || Math.abs(riseOverRun) >= ROADENG_VERTICAL_SLOPE
      ? 0
      : thickness / Math.abs(riseOverRun)

  const edge = subgrade.legs.findIndex((l) => /^RE/i.test(l.code))
  const legs = edge >= 0 ? subgrade.legs.slice(0, edge + 1) : subgrade.legs
  let total = 0
  let width: RoadEngRoadwayConstruction['width'] | null = null
  const runs: RoadEngCourseRun[] = []
  for (const leg of legs) {
    let d: number | null
    if (leg.distanceParameter !== null) d = length(leg.distanceParameter)
    else d = leg.distance >= ROADENG_OPEN_LEG ? null : leg.distance * unitM
    if (d === null || !Number.isFinite(d)) return null
    const s =
      leg.slopeParameter !== null
        ? slope(leg.slopeParameter)
        : Math.abs(leg.slope) >= ROADENG_VERTICAL_SLOPE
          ? Infinity
          : leg.slope
    if (s === null) return null
    const horizontal = leg.vertical
      ? runOf(d, s)
      : leg.alongSlope
        ? Math.abs(s) >= ROADENG_VERTICAL_SLOPE
          ? 0
          : d / Math.sqrt(1 + s * s)
        : d
    total += horizontal
    if (!width && leg.distanceParameter !== null && !leg.vertical && !leg.alongSlope) {
      const p = byIndex.get(leg.distanceParameter)!
      width = { parameter: p.name, valueM: d, calculated: p.calculated }
    }
    for (const term of leg.terms) {
      const t = length(term.numerator),
        r = slope(term.denominator)
      if (t === null || r === null) return null
      const run = runOf(t, r)
      total += run
      if (run !== 0)
        runs.push({
          thickness: byIndex.get(term.numerator)!.name,
          slope: byIndex.get(term.denominator)!.name,
          runM: run,
        })
    }
  }
  if (!width || !Number.isFinite(total)) return null

  // Each layer surface's depth at the attachment point: its field-12 parameter, else 0.
  const depthOf = (f: RoadEngFragment): number | null => {
    if (!f.height) return 0
    const v = length(f.height.index)
    return v === null ? null : f.height.low ? v : -v
  }
  const subgradeDepthM = depthOf(subgrade)
  if (subgradeDepthM === null) return null
  const surfaces = new Map<number, number>()
  for (const f of fragments) {
    if (!(f.surfaceType === 'SGL' || f.surfaceType === '-?-') || surfaces.has(f.surface)) continue
    const d = depthOf(f)
    if (d !== null) surfaces.set(f.surface, d)
  }
  surfaces.set(1, subgradeDepthM)
  const depths = [...new Set([...surfaces.values()].map((d) => Math.round(d * 1e6) / 1e6))]
    .filter((d) => d <= subgradeDepthM + 1e-9)
    .sort((a, b) => a - b)
  // A surface below the subgrade: a sub-cut when its fragment runs out level (its one horizontal
  // leg, with the courses' runs its construction adds) and closes back up its next leg.
  let subCut: RoadEngRoadwaySubCut | null = null
  const deeperSurfaces: string[] = []
  for (const f of fragments) {
    if (f === subgrade || f.surfaceType !== 'SGL' || f.surface === subgrade.surface) continue
    const d = depthOf(f)
    if (d === null || !(d > subgradeDepthM + 1e-6)) continue
    const [out, up, ...rest] = f.legs
    const reach = (leg: RoadEngLeg | undefined) => {
      if (!leg || leg.vertical || leg.alongSlope || leg.falls) return null
      const s = leg.slopeParameter !== null ? slope(leg.slopeParameter) : leg.slope
      if (s === null || Math.abs(s) > 1e-9) return null
      let x = leg.distanceParameter !== null ? length(leg.distanceParameter) : null
      if (x === null) return null
      for (const term of leg.terms) {
        const t = length(term.numerator),
          r = slope(term.denominator)
        if (t === null || r === null) return null
        x += runOf(t, r)
      }
      return x
    }
    const widthM = reach(out)
    const rise =
      up && !up.falls && !rest.length
        ? up.slopeParameter !== null
          ? slope(up.slopeParameter)
          : Math.abs(up.slope) >= ROADENG_VERTICAL_SLOPE
            ? Infinity
            : up.slope
        : null
    if (subCut || widthM === null || !(widthM > 0) || rise === null || !(Math.abs(rise) >= 1)) {
      deeperSurfaces.push(f.name)
      continue
    }
    subCut = {
      fragment: f.name,
      depthM: d - subgradeDepthM,
      widthM,
      outsideSlope: Math.abs(rise) >= ROADENG_VERTICAL_SLOPE ? 0 : 1 / Math.abs(rise),
      widthParameter:
        out.distanceParameter !== null && !out.terms.length ? byIndex.get(out.distanceParameter)!.name : null,
    }
  }
  return {
    subgradeEdgeM: total,
    width,
    runs,
    subgradeDepthM,
    surfaceDepthsM: depths,
    stored: [...stored],
    subCut,
    deeperSurfaces,
  }
}
