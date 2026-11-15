/**
 * The design settings in a Softree RoadEng / Location design (`.dsnx`), read-only, and what of them
 * the road designer's own section, superelevation and materials can carry.
 *
 * `roadEngImport.ts` reads a design's alignment. This reads the rest of what shapes its
 * cross-section, from the same two text parts of each `LocationN`:
 *
 * - `LocationN.dsn` (INI, Latin-1). `[TemplatesSct]` holds the template table: `T<t>` a template
 *   (component count, code, name, left and right crossfall as rise over run, …, and a kind that is 0
 *   for a template and non-zero for a folder of library components); `T<t>-C<c>` a component (fragment
 *   count, class, `name!^!description` with `~` for commas, parameter count, …); `T<t>-C<c>-F<f>` its
 *   fragments, whose fourth field's lowest bit is set on a left-side fragment; `T<t>-C<c>-U<u>` its
 *   parameters, `name~description|flags|value|feature|…|max offset|`, with flag bit 1 marking a slope
 *   kept as rise over run, flag 64 a calculated value and `feature` the reference feature (0-based)
 *   the value follows, −1 for none; `-U<u>-1` the formula of a calculated one. `LTable-<n>-*` is a
 *   superelevation table, `RoadOptions` the road class (design speed in project units per second,
 *   criteria name, e max). `[LocationParms]` lists the alignment's station ranges, each ending at its
 *   first field's station (999999999 is the end of the road): ground layers (top type, then
 *   depth/type pairs, depths negative below ground, 999999 none) and the left and right template
 *   codes. `[Culvert]` holds the default culverts new ones start from.
 * - `LocationN.ds2`. `108` is a horizontal PI with its curve's design speed (project units per
 *   second), e max, the superelevation used, the side friction it demands, the transition length at
 *   the BC and at the EC, the transition fraction before the BC and two widenings; `104` a ground
 *   type: two-letter code, description, fill and cut slopes in percent, cut and fill expansion
 *   factors and the excavation and embankment costs.
 *
 * The layout was read from Softree's published sample projects (RoadEng 8, 9 and 11) against
 * Softree's online help; the report beside this module says which fields are confirmed and which
 * are inferred. Fields not named here are kept as read (`raw`) and never used.
 *
 * The mapping (`roadEngTemplateFor`, `roadEngCurveDesignFor`, `roadEngMaterialsFor`,
 * `roadEngEngineeringFor`) carries over only what PGMaps can draw the same way and lists every
 * RoadEng item it leaves behind, in plain words, in `unmapped`. Lengths go to metres; slopes kept as
 * rise over run become H:V. Nothing is classified from its name alone: a ground type is never marked
 * rock here, and a reference feature a width follows in RoadEng is not looked up. Each mapped section
 * records the RoadEng parameter every value came from (`RoadEngSideSources`), which
 * `roadEngSectionExport.ts` writes an edited section back into.
 *
 * A ditch backslope that runs on above the road edge (Ditch I `DitchBackSlpHt` past the ditch depth;
 * Softree's 27.8 km sample: 3:1 up to 10 m) becomes the side's cut batter by default, which is
 * RoadEng's section in any cut up to that height, or, with `ditchBackslope: 'component'`, a slope
 * component with the closing cut slope above it (`RoadEngBackslopeMode` says why that is not the
 * default). Slope VI benches become slope and bench components in that mode only.
 *
 * A range whose template is RoadEng's predefined Taper ({@link ROADENG_TAPER_CODE}, `TP`, which the
 * template table never holds, like the Bridge `BR`) interpolates every numeric template value
 * linearly by station between the template before it and the one after it (Softree's help); it
 * becomes a transition on the range after it (`transitionInM`), or on the range before it
 * (`transitionOutM`) where the one after is the road's base section. The code is from Softree's
 * help and knowledge base ("TP Taper" in the template list); no sample design uses one.
 *
 * Lookup tables (`LTable-<n>`, or a `.tbl` file through `parseRoadEngTbl`) are read with
 * `roadEngTableValue`: superelevation interpolated, as Softree documents; widening stepped (the row
 * at or below the radius, the nearest deflection column), inferred from every curve of Softree's
 * 27.8 km sample. The widening table becomes PGMaps' `wideningTable` when the design's curves carry
 * widening (`roadEngWideningFor`), written as steps PGMaps' interpolation reproduces
 * (`roadEngWideningRows`), and each curve's stored widening is compared with PGMaps' figure.
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, unzipSync } from 'fflate'
import { createEngineeringDesign } from './engineeringTypes'
import type {
  AlignmentEngineering,
  GroundMaterial,
  StratumAssignment,
  TemplateAssignment,
  TemplateDefinition,
} from './engineeringTypes'
import { evaluateCurveCriteria } from './roadCriteria'
import type { CurveDesign, RoadTemplate, RockCutTemplate, SectionComponent, SectionLayer } from './types'

/** A RoadEng station at or past this is "the end of the road" in `[LocationParms]`. */
export const ROADENG_END_STATION = 99_999_999
/**
 * RoadEng's predefined Taper template code: a range assigned it changes linearly from the template
 * before it to the one after it. Never in the template table (`[TemplatesSct]`).
 */
export const ROADENG_TAPER_CODE = 'TP'
/** A ground-layer depth at or past this is "no depth" in `[LocationParms]`. */
export const ROADENG_NO_DEPTH = 999_998
/** Same limits as the alignment reader. */
export const MAX_ROADENG_SETTINGS_BYTES = 50_000_000
export const MAX_ROADENG_SETTINGS_ENTRY_BYTES = 100_000_000
/** Templates and components read from one design; RoadEng's own samples hold 15 and 20. */
export const MAX_ROADENG_TEMPLATES = 200
export const MAX_ROADENG_COMPONENTS = 100
/** Station ranges read from one alignment's `[LocationParms]`. */
export const MAX_ROADENG_RANGES = 1000
/** Cubic metres in a cubic yard, for a foot design's cost per volume. */
const M3_PER_YD3 = 0.764554857984
/** Side friction values searched when fitting PGMaps' one factor to RoadEng's curves. */
const FRICTION_STEP = 0.001

// ---- What is read ---------------------------------------------------------------------------------

export interface RoadEngParameter {
  /** Its `U<n>` number in the component. */
  index: number
  name: string
  description: string
  /** The parameter's flag word as read: 1 slope (rise over run), 64 calculated, 256 horizontal offset. */
  flags: number
  /** The value as stored, in project units for lengths. */
  raw: number
  /** Metres for a length, rise over run for a slope, as read otherwise. */
  value: number
  kind: 'length' | 'slope' | 'switch' | 'other'
  /** 0-based reference feature the value follows in RoadEng; null for none. */
  featureIndex: number | null
  /** The expression of a calculated value (`-U<n>-1`); null for an entered one. */
  formula: string | null
  calculated: boolean
}

export interface RoadEngComponent {
  index: number
  /** RoadEng's component class: RDWY, DTCHS, SLPS, BRDG, … */
  className: string
  name: string
  description: string
  /** From its fragments: a component drawn on one side, or on both (`both`). */
  side: 'left' | 'right' | 'both'
  parameters: RoadEngParameter[]
}

export interface RoadEngTemplate {
  index: number
  code: string
  name: string
  /** Crossfall as rise over run, negative falling away from the centreline. */
  crossfallLeft: number
  crossfallRight: number
  /** A folder of library components in RoadEng's template editor, not a template a road uses. */
  folder: boolean
  components: RoadEngComponent[]
}

export interface RoadEngGroundLayer {
  /** Ground type code (`104`), `**` for the design's default type. */
  code: string
  topDepthM: number
  bottomDepthM: number | null
}

export interface RoadEngStationRange {
  /** RoadEng stations in metres; null is the start or the end of the road. */
  fromStation: number | null
  toStation: number | null
  leftTemplate: string
  rightTemplate: string
  ground: RoadEngGroundLayer[]
  raw: string[]
}

export interface RoadEngCurveSettings {
  /** The `108` record's index. */
  pi: number
  radiusM: number
  designSpeedKmh: number
  /** Rise over run. */
  eMax: number
  e: number
  /** Side friction the curve demands at its design speed, v²/(gR) − e. */
  sideFriction: number
  /** Unidentified: 0.1 to 0.15 in Softree's samples, possibly the largest side friction allowed. */
  field11: number
  transitionAtBcM: number
  transitionAtEcM: number
  /** Share of the transition before the BC (and after the EC). */
  transitionFraction: number
  /** Inferred: inside and outside widening, m. */
  wideningInsideM: number
  wideningOutsideM: number
  /** The PI in the design's grid, project units as written. */
  x: number
  y: number
  /**
   * Deflection at the PI, degrees, from the neighbouring PIs and the first and last calculated
   * stations (`110`); null when the design has no stations to close the ends with.
   */
  deflectionDegrees: number | null
  raw: string[]
}

export interface RoadEngMaterial {
  code: string
  description: string
  /** Percent, rise over run × 100. */
  fillSlopePercent: number
  cutSlopePercent: number
  cutExpansion: number
  fillExpansion: number
  /** Per cubic metre (metric design) or cubic yard (foot design), in the design's currency. */
  excavationCost: number
  embankmentCost: number
  /** Unidentified 0–3 class (0 overburden, 1 hard pan, 2 gravel, 3 rock in Softree's samples). */
  field15: number
  raw: string[]
}

export interface RoadEngCulvertDefault {
  kind: 'drain' | 'stream'
  /** Inferred: thousandths of a project unit (mm in a metric design). */
  diameterM: number | null
  /** Inferred: degrees clockwise from the L-line, 90 square to it. */
  skewDegrees: number | null
  raw: string[]
}

/**
 * One of RoadEng's lookup tables (`LTable-<n>` in `[TemplatesSct]`, or a `.tbl` file): radius down
 * the first column, a value heading each further column, and a body read at a radius and a column
 * value. Table 0 is superelevation (columns design speed, body e as rise over run), 2 the runoff
 * length, 3 the curve widening (columns deflection in degrees, body widening) and, where present, 1
 * the largest side friction by speed.
 */
export interface RoadEngSuperelevationTable {
  index: number
  /** Comment lines above the table, without their leading `#`; a line that was only `#` stays `#`. */
  description: string[]
  /** Values heading the columns, as written (design speed in km/h or mph, or deflection in degrees). */
  speeds: number[]
  /** Radius as written (project units) and the body value per column; null where blank. */
  rows: { radius: number; e: (number | null)[] }[]
}

export interface RoadEngSettings {
  /** Metres per project unit. */
  unitM: number
  templates: RoadEngTemplate[]
  stationRanges: RoadEngStationRange[]
  curves: RoadEngCurveSettings[]
  materials: RoadEngMaterial[]
  culvertDefaults: RoadEngCulvertDefault[]
  superelevationTables: RoadEngSuperelevationTable[]
  roadOptions: { designSpeedKmh: number | null; criteriaName: string | null; eMax: number | null } | null
  /** Per-range template parameter overrides the design counts (`[design] ParmOverrides-*`). */
  parameterOverrides: number
  warnings: string[]
}

export type RoadEngIni = Map<string, Map<string, string>>
type Ini = RoadEngIni

/** `[section] key=value` text; later keys win, keys keep their case. */
export function readRoadEngIni(text: string): Ini {
  return readIni(text)
}
function readIni(text: string): Ini {
  const sections: Ini = new Map()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = sections.get(header[1]) ?? new Map()
      sections.set(header[1], current)
    } else if (current) {
      const eq = line.indexOf('=')
      if (eq > 0) current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    }
  }
  return sections
}

const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? NaN : Number(s))
const decodeText = (s: string) => s.replace(/\^\^/g, '\n').replace(/~/g, ',').trim()

function parameterKind(name: string, flags: number): RoadEngParameter['kind'] {
  if (flags & 1) return 'slope'
  if (/^b[A-Z_]/.test(name)) return 'switch'
  if (/surf|topo|^n[A-Z]|links|cords|^_/i.test(name)) return 'other'
  return 'length'
}

function readTemplates(section: Map<string, string> | undefined, unitM: number, warnings: string[]): RoadEngTemplate[] {
  if (!section) return []
  const templates: RoadEngTemplate[] = []
  const indices = [...section.keys()]
    .map((k) => /^T(\d+)$/.exec(k)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number)
    .sort((a, b) => a - b)
  if (indices.length > MAX_ROADENG_TEMPLATES) {
    warnings.push(`The design holds ${indices.length} templates; the first ${MAX_ROADENG_TEMPLATES} are read.`)
    indices.length = MAX_ROADENG_TEMPLATES
  }
  for (const t of indices) {
    const f = section.get(`T${t}`)!.split(',')
    const components: RoadEngComponent[] = []
    const componentIndices = [...section.keys()]
      .map((k) => new RegExp(`^T${t}-C(\\d+)$`).exec(k)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(0, MAX_ROADENG_COMPONENTS)
    for (const c of componentIndices) {
      const head = section.get(`T${t}-C${c}`)!.split(',')
      const [name, description = ''] = (head[2] ?? '').split('!^!')
      const prefix = `T${t}-C${c}-`
      const sides = new Set<'left' | 'right'>()
      const indexed: { index: number; parameter: RoadEngParameter }[] = []
      for (const [key, value] of section) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        if (/^F\d+$/.test(rest)) {
          const bits = num(value.split(',')[3])
          if (Number.isFinite(bits)) sides.add(bits % 2 === 1 ? 'left' : 'right')
        }
        const u = /^U(\d+)$/.exec(rest)
        if (!u) continue
        const fields = value.split('|')
        const tilde = fields[0].indexOf('~')
        const pName = (tilde >= 0 ? fields[0].slice(0, tilde) : fields[0]).trim()
        const flags = num(fields[1]),
          raw = num(fields[2]),
          feature = num(fields[3])
        if (!pName || !Number.isFinite(flags) || !Number.isFinite(raw)) continue
        const kind = parameterKind(pName, flags)
        const formula = section.get(`${key}-1`)?.trim() || null
        indexed.push({
          index: Number(u[1]),
          parameter: {
            index: Number(u[1]),
            name: pName,
            description: tilde >= 0 ? fields[0].slice(tilde + 1).trim() : '',
            flags,
            raw,
            value: kind === 'length' ? raw * unitM : raw,
            kind,
            featureIndex: Number.isFinite(feature) && feature >= 0 ? feature : null,
            formula,
            calculated: (flags & 64) !== 0 || formula !== null,
          },
        })
      }
      const parameters = indexed.sort((a, b) => a.index - b.index).map((p) => p.parameter)
      components.push({
        index: c,
        className: (head[1] ?? '').trim(),
        name: decodeText(name),
        description: decodeText(description),
        side: sides.size === 1 ? [...sides][0] : 'both',
        parameters,
      })
    }
    templates.push({
      index: t,
      code: (f[1] ?? '').trim(),
      name: decodeText(f[2] ?? ''),
      crossfallLeft: num(f[3]),
      crossfallRight: num(f[4]),
      folder: num(f[6]) !== 0,
      components,
    })
  }
  return templates
}

function readRanges(
  section: Map<string, string> | undefined,
  unitM: number,
  warnings: string[],
): RoadEngStationRange[] {
  if (!section) return []
  const rows = [...section.entries()]
    .filter(([k]) => /^\d+$/.test(k))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v.split(',').map((s) => s.trim()))
  if (rows.length > MAX_ROADENG_RANGES) {
    warnings.push(`The alignment has ${rows.length} station ranges; the first ${MAX_ROADENG_RANGES} are read.`)
    rows.length = MAX_ROADENG_RANGES
  }
  const ranges: RoadEngStationRange[] = []
  let from: number | null = null
  for (const f of rows) {
    const to = num(f[0])
    if (!Number.isFinite(to)) {
      warnings.push(`A station range could not be read and is left out: ${f.slice(0, 20).join(',')}`)
      continue
    }
    const depth = (s: string | undefined) => {
      const v = num(s)
      return Number.isFinite(v) && Math.abs(v) < ROADENG_NO_DEPTH ? Math.abs(v) * unitM : null
    }
    const type = (s: string | undefined) => (s && s !== '-' ? s : null)
    const ground: RoadEngGroundLayer[] = []
    const d1 = depth(f[12]),
      d2 = depth(f[14])
    const t1 = type(f[16]),
      t2 = d1 !== null ? type(f[13]) : null,
      t3 = d1 !== null && d2 !== null ? type(f[15]) : null
    if (t1) ground.push({ code: t1, topDepthM: 0, bottomDepthM: t2 ? d1 : null })
    if (t2) ground.push({ code: t2, topDepthM: d1!, bottomDepthM: t3 ? d2 : null })
    if (t3) ground.push({ code: t3, topDepthM: d2!, bottomDepthM: null })
    const toStation = to >= ROADENG_END_STATION ? null : to * unitM
    ranges.push({
      fromStation: from,
      toStation,
      leftTemplate: f[17] ?? '',
      rightTemplate: f[18] ?? '',
      ground,
      raw: f,
    })
    from = toStation
    if (toStation === null) break
  }
  return ranges
}

function readTables(section: Map<string, string> | undefined): RoadEngSuperelevationTable[] {
  if (!section) return []
  const tables = new Map<number, RoadEngSuperelevationTable>()
  const keys = [...section.keys()].filter((k) => /^LTable-\d+-(Desc|Row)-\d+$/.test(k)).sort()
  for (const key of keys) {
    const [, n, kind] = /^LTable-(\d+)-(Desc|Row)-\d+$/.exec(key)!
    const table = tables.get(Number(n)) ?? { index: Number(n), description: [], speeds: [], rows: [] }
    tables.set(Number(n), table)
    const value = section.get(key)!
    if (kind === 'Desc') {
      if (value.trim() !== '#') table.description.push(value.trim())
      continue
    }
    const cells = value.split(',')
    // The first row heads the columns, whatever its first cell holds (blank, or 0 in older designs).
    if (/-Row-0+$/.test(key) || cells[0].trim() === '') table.speeds = cells.slice(1).map(num)
    else
      table.rows.push({
        radius: num(cells[0]),
        e: cells.slice(1).map((c) => (Number.isFinite(num(c)) ? num(c) : null)),
      })
  }
  return [...tables.values()]
}

function readCulverts(section: Map<string, string> | undefined, unitM: number): RoadEngCulvertDefault[] {
  if (!section) return []
  const out: RoadEngCulvertDefault[] = []
  for (const key of ['DefDrainCulvert', 'DefStreamCulvert']) {
    const value = section.get(key)
    if (!value) continue
    const f = value
      .slice(value.indexOf('|') + 1)
      .split(',')
      .map((s) => s.trim())
    const diameter = num(f[3]),
      skew = num(f[4])
    out.push({
      kind: num(f[0]) === 1 ? 'stream' : 'drain',
      diameterM: Number.isFinite(diameter) && diameter < 1e30 ? (diameter / 1000) * unitM : null,
      skewDegrees: Number.isFinite(skew) && skew <= 180 ? skew : null,
      raw: f,
    })
  }
  return out
}

/**
 * Reads one alignment's design settings: `dsnText` and `ds2Text` are its `LocationN.dsn` and
 * `LocationN.ds2`, `unitM` the design's metres per project unit (`[design] units` ÷ 10,000).
 * Templates are kept once per design, in the first alignment's `.dsn`; pass that file as
 * `projectDsnText` when reading a later alignment whose own `.dsn` has none.
 */
export function parseRoadEngSettings(
  dsnText: string,
  ds2Text: string,
  unitM: number,
  options: { projectDsnText?: string } = {},
): RoadEngSettings {
  if (!(unitM > 0)) throw Error('The design units must be a positive number of metres per project unit.')
  const warnings: string[] = []
  const ini = readIni(dsnText)
  const project = options.projectDsnText !== undefined ? readIni(options.projectDsnText) : ini
  const templateSection = ini.get('TemplatesSct')?.size ? ini.get('TemplatesSct') : project.get('TemplatesSct')
  const templates = readTemplates(templateSection, unitM, warnings)
  const stationRanges = readRanges(ini.get('LocationParms'), unitM, warnings)
  const culvertDefaults = readCulverts(ini.get('Culvert') ?? project.get('Culvert'), unitM)
  const superelevationTables = readTables(templateSection)
  const options111 = templateSection?.get('RoadOptions')?.split(',')
  const roadOptions = options111
    ? {
        designSpeedKmh: Number.isFinite(num(options111[1])) ? num(options111[1]) * unitM * 3.6 : null,
        criteriaName: options111[12]?.trim() || null,
        eMax: Number.isFinite(num(options111[13])) ? num(options111[13]) : null,
      }
    : null
  let parameterOverrides = 0
  for (const [key, value] of ini.get('design') ?? [])
    if (/^ParmOverrides/.test(key) && Number.isFinite(num(value))) parameterOverrides += num(value)

  const curves: RoadEngCurveSettings[] = []
  const materials: RoadEngMaterial[] = []
  // Every PI in order, angle points included, to find each curve's deflection.
  const pis: { x: number; y: number; curve: RoadEngCurveSettings | null }[] = []
  let first: { station: number; x: number; y: number } | null = null,
    last: { station: number; x: number; y: number } | null = null
  for (const line of ds2Text.split(/\r?\n/)) {
    const f = line.split(',')
    if (f[0] === '110') {
      const at = { x: num(f[2]), y: num(f[3]), station: num(f[5]) }
      if (![at.x, at.y, at.station].every(Number.isFinite)) continue
      if (!first || at.station < first.station) first = at
      if (!last || at.station > last.station) last = at
    } else if (f[0] === '108') {
      const radius = num(f[3]),
        speed = num(f[8])
      const pi = { x: num(f[4]), y: num(f[5]), curve: null as RoadEngCurveSettings | null }
      if (Number.isFinite(pi.x) && Number.isFinite(pi.y)) pis.push(pi)
      if (!Number.isFinite(radius) || radius === 0 || !Number.isFinite(speed)) continue
      curves.push({
        pi: num(f[1]),
        radiusM: Math.abs(radius) * unitM,
        designSpeedKmh: Math.round(speed * unitM * 3.6 * 1e6) / 1e6,
        eMax: num(f[10]),
        e: num(f[15]),
        sideFriction: num(f[16]),
        field11: num(f[11]),
        transitionAtBcM: num(f[12]) * unitM,
        transitionAtEcM: num(f[13]) * unitM,
        transitionFraction: num(f[14]),
        wideningInsideM: (num(f[17]) || 0) * unitM,
        wideningOutsideM: (num(f[18]) || 0) * unitM,
        x: num(f[4]),
        y: num(f[5]),
        deflectionDegrees: null,
        raw: f,
      })
      if (pis.at(-1) === pi) pi.curve = curves.at(-1)!
    } else if (f[0] === '104') {
      const values = [3, 4, 5, 6, 7, 8, 15].map((i) => num(f[i]))
      if (!f[1]?.trim() || !values.every(Number.isFinite)) {
        warnings.push(`A ground type record could not be read and is left out: ${line.slice(0, 80)}`)
        continue
      }
      materials.push({
        code: f[1].trim(),
        description: f[2]?.trim() || f[1].trim(),
        fillSlopePercent: values[0],
        cutSlopePercent: values[1],
        cutExpansion: values[2],
        fillExpansion: values[3],
        excavationCost: values[4],
        embankmentCost: values[5],
        field15: values[6],
        raw: f,
      })
    }
  }
  // Deflection at each PI, with the road's first and last stations closing the two ends.
  if (first && last)
    pis.forEach((c, k) => {
      if (!c.curve) return
      const back = k > 0 ? pis[k - 1] : first!,
        ahead = k < pis.length - 1 ? pis[k + 1] : last!
      const a = Math.atan2(c.y - back.y, c.x - back.x),
        b = Math.atan2(ahead.y - c.y, ahead.x - c.x)
      const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * (180 / Math.PI)
      if (Number.isFinite(turn)) c.curve.deflectionDegrees = r6(turn)
    })
  return {
    unitM,
    templates,
    stationRanges,
    curves,
    materials,
    culvertDefaults,
    superelevationTables,
    roadOptions,
    parameterOverrides,
    warnings,
  }
}

const UNITS: Record<string, number> = { '10000': 1, '3048': 0.3048 }

/** Every alignment's settings in a `.dsnx` archive, in part order. */
export function readRoadEngSettings(bytes: Uint8Array): {
  unitM: number
  parts: { part: string; settings: RoadEngSettings }[]
} {
  if (bytes.length > MAX_ROADENG_SETTINGS_BYTES) throw Error('The RoadEng design is over 50 MB.')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (file) =>
        /^Location\d+\.ds[n2]$/i.test(file.name) && file.originalSize <= MAX_ROADENG_SETTINGS_ENTRY_BYTES,
    })
  } catch {
    throw Error('This RoadEng design could not be unpacked: the archive is damaged or not a .dsnx.')
  }
  const parts = new Map<number, { dsn?: string; ds2?: string }>()
  for (const [name, data] of Object.entries(entries)) {
    const match = /^Location(\d+)\.(ds[n2])$/i.exec(name)
    if (!match) continue
    const part = parts.get(Number(match[1])) ?? {}
    part[match[2].toLowerCase() as 'dsn' | 'ds2'] = strFromU8(data, true)
    parts.set(Number(match[1]), part)
  }
  const numbers = [...parts.keys()].filter((n) => parts.get(n)!.ds2 !== undefined).sort((a, b) => a - b)
  if (!numbers.length) throw Error('The RoadEng design holds no alignment (no LocationN.ds2 inside).')
  const first = parts.get(numbers[0])!.dsn ?? ''
  const unitsText = numbers
    .map((n) =>
      readIni(parts.get(n)!.dsn ?? '')
        .get('design')
        ?.get('units'),
    )
    .find(Boolean)
  if (unitsText === undefined) throw Error('The RoadEng design does not state its units ([design] units).')
  const unitM = UNITS[unitsText]
  if (unitM === undefined)
    throw Error(`The RoadEng design's units code ${unitsText} is not one this import reads (10000 metres, 3048 feet).`)
  return {
    unitM,
    parts: numbers.map((n) => ({
      part: `Location${n}`,
      settings: parseRoadEngSettings(parts.get(n)!.dsn ?? '', parts.get(n)!.ds2!, unitM, { projectDsnText: first }),
    })),
  }
}

// ---- To PGMaps' section ---------------------------------------------------------------------------

const fmt = (v: number, digits = 2) => (Math.round(v * 10 ** digits) / 10 ** digits).toString()
const hv = (riseOverRun: number) => fmt(1 / Math.abs(riseOverRun), 2)
const key = (name: string) => name.toUpperCase().replace(/_/g, '')
const param = (c: RoadEngComponent, ...names: string[]) => {
  const wanted = names.map(key)
  return c.parameters.find((p) => wanted.includes(key(p.name)))
}
const value = (c: RoadEngComponent, ...names: string[]) => param(c, ...names)?.value
/** Rounded to the micrometre, which clears float noise and keeps every figure RoadEng stores. */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
/** H:V from a slope kept as rise over run; null where PGMaps cannot take it (0.1–10 H:V). */
const toHv = (riseOverRun: number | undefined) => {
  if (riseOverRun === undefined || !Number.isFinite(riseOverRun) || riseOverRun === 0) return null
  const h = r6(1 / Math.abs(riseOverRun))
  return h >= 0.1 && h <= 10 ? h : null
}

/** Layer thickness parameters, top down, as RoadEng's roadway components name them. */
const LAYER_ORDER: [string, string][] = [
  ['ACPTHICK', 'Pavement'],
  ['ACPTHICK2', 'Pavement 2'],
  ['CSTCTHICK', 'Crushed top course'],
  ['BASETHICK', 'Base'],
  ['SUBBASETHICK', 'Sub-base'],
  ['SUBLAYER4THICK', 'Layer 4'],
]
const WIDTH_PARTS = ['ACPWIDTH', 'SHOULDERWIDTH', 'SHOULDERPAVEWIDTH', 'SHOULDERGRAVWIDTH']

interface SideSection {
  width: number | null
  layers: { key: string; name: string; depthM: number }[]
  crossfallPercent: number | null
  cutSlope: number | null
  fillSlope: number | null
  /**
   * Slopes as rise over run; a null backslope is the side's cut slope. `backslopeHeight` is how far
   * above the ditch bottom the backslope runs before the closing cut slope (`DitchBackSlpHt`).
   */
  ditch: {
    depth: number
    bottom: number
    inslope: number
    backslope: number | null
    backslopeHeight: number
  } | null
  rockCut: RockCutTemplate | null
  roadwayKind: 'layered' | 'subgrade' | 'bridge' | null
  /** Ordered slope and bench components (`component` mode only). */
  components: SectionComponent[]
}

/** Where a value in RoadEng's template table lives: a template header field or a parameter. */
export type RoadEngSource =
  | { kind: 'header'; template: number; field: 3 | 4 }
  | { kind: 'parameter'; template: number; component: number; parameter: number; name: string }

/**
 * The RoadEng values each part of one side of a mapped section came from, so a writer can put an
 * edited section back into the same parameters (`roadEngSectionExport.ts`). A part with no entry
 * came from elsewhere (the other side, the road's current section) and has no RoadEng home.
 */
export interface RoadEngSideSources {
  /** The width parts summed into the road width; the first is the one an edit changes. */
  width?: RoadEngSource[]
  /** The header crossfall, then the roadway's `_SUPER` where it held the same value. */
  crossfall?: RoadEngSource[]
  cutSlope?: RoadEngSource
  fillSlope?: RoadEngSource
  /** One closing slope (`FinalSlpL/R`) gives both batters. */
  sharedSlope?: boolean
  ditch?: {
    include?: RoadEngSource
    depth?: RoadEngSource
    bottom?: RoadEngSource
    inslope?: RoadEngSource
    backslope?: RoadEngSource
    backslopeHeight?: RoadEngSource
  }
  /**
   * How a ditch backslope that runs above the road edge was carried: as the side's cut batter
   * (`batter`, the cut slope above `heightM` lost) or as a slope component (`component`).
   */
  backslope?: { mode: RoadEngBackslopeMode; componentId?: string; heightM: number; depthM: number }
  /** Course thickness parameters by layer key (`acpthick`, `basethick`, …). */
  layers?: Record<string, RoadEngSource>
  rockCutSlope?: RoadEngSource
  rockLedge?: RoadEngSource
}

/**
 * How a ditch backslope that runs above the road edge (Ditch I `DitchBackSlpHt` past its depth) is
 * carried. `batter`: the backslope becomes the side's cut batter, so the section is RoadEng's up to
 * that height and keeps the backslope above it. `component`: it becomes a cut-side slope component
 * of that height after the ditch, with RoadEng's closing cut slope above it; this is exact only
 * where the section engine ends a component at the ground it meets, which `assembledSection.ts` does
 * not do today (a component standing above a low cut leaves the section unresolved).
 */
export type RoadEngBackslopeMode = 'batter' | 'component'

export interface RoadEngTemplateOptions {
  /** Default `batter`. */
  ditchBackslope?: RoadEngBackslopeMode
}

export interface RoadEngTemplateMapping {
  template: RoadTemplate | null
  /** Depth of the subgrade below the template's attachment (RoadEng's profile) on each side, m. */
  subgradeDepthM: { left: number; right: number }
  /** RoadEng items not carried over, in plain words. */
  unmapped: string[]
  /** Carried over with a stated difference or assumption. */
  notes: string[]
  /** Which RoadEng values each side's section came from. */
  sources: { left: RoadEngSideSources; right: RoadEngSideSources }
}

/**
 * One RoadEng template as a PGMaps section. Values RoadEng does not give (a side with no slope
 * component, say) come from `fallback`, and each is listed in `unmapped`.
 */
export function roadEngTemplateToPgmaps(
  t: RoadEngTemplate,
  fallback: RoadTemplate,
  options: RoadEngTemplateOptions = {},
): RoadEngTemplateMapping {
  const unmapped: string[] = []
  const notes: string[] = []
  const backslopeMode = options.ditchBackslope ?? 'batter'
  const sources: { left: RoadEngSideSources; right: RoadEngSideSources } = { left: {}, right: {} }
  const from = (c: RoadEngComponent, p: RoadEngParameter | undefined): RoadEngSource | undefined =>
    p && { kind: 'parameter', template: t.index, component: c.index, parameter: p.index, name: p.name }
  const label = `${t.code} (${t.name})`
  const said = new Set<string>()
  const once = (list: string[], text: string) => {
    if (!said.has(text)) {
      said.add(text)
      list.push(text)
    }
  }
  const sides: Record<'left' | 'right', SideSection> = {
    left: blankSide(),
    right: blankSide(),
  }
  const used = new Set<RoadEngComponent>()
  for (const side of ['left', 'right'] as const) {
    const s = sides[side]
    const src = sources[side]
    const fall = side === 'left' ? t.crossfallLeft : t.crossfallRight
    if (Number.isFinite(fall)) {
      s.crossfallPercent = -100 * fall
      src.crossfall = [{ kind: 'header', template: t.index, field: side === 'left' ? 3 : 4 }]
    }
    const here = t.components.filter((c) => c.side === side || c.side === 'both')
    for (const c of here) {
      const pick = <T>(left: T, right: T) => (side === 'left' ? left : right)
      // The roadway's own crown parameter moves with the header crossfall it repeats.
      const superP = param(c, '_SUPER')
      const roadwayFound = () => {
        if (superP && src.crossfall && Math.abs(superP.raw - fall) < 1e-9) src.crossfall.push(from(c, superP)!)
      }
      // Roadway
      if (s.roadwayKind === null && param(c, 'ACPWIDTH')) {
        s.roadwayKind = 'layered'
        used.add(c)
        roadwayFound()
        s.width = r6(WIDTH_PARTS.reduce((sum, name) => sum + (value(c, name) ?? 0), 0))
        src.width = WIDTH_PARTS.map((name) => from(c, param(c, name))).filter((v): v is RoadEngSource => !!v)
        const follows = param(c, 'ACPWIDTH')!.featureIndex
        if (follows !== null)
          once(
            notes,
            `${label}: RoadEng runs the ${c.name} lane width along reference feature ${follows + 1}; its stated ${fmt(value(c, 'ACPWIDTH')!)} m is used as a fixed width.`,
          )
        for (const [name, title] of LAYER_ORDER) {
          const p = param(c, name)
          if (p && !p.calculated) (src.layers ??= {})[name.toLowerCase()] = from(c, p)!
          if (p && !p.calculated && p.value > 0)
            s.layers.push({ key: name.toLowerCase(), name: title, depthM: r6(p.value) })
        }
        const shoulder = WIDTH_PARTS.slice(1).reduce((sum, name) => sum + (value(c, name) ?? 0), 0)
        if (shoulder > 0)
          once(
            unmapped,
            `${label}: the ${fmt(shoulder)} m shoulder's own slope and thickness; it is taken as part of the road width at the road's crossfall.`,
          )
        const flare = c.parameters.filter(
          (p) => p.kind === 'slope' && /fill ?slo?pe?$|FILLSLP$|^(BASE|CSTC)_?SLOPE$/i.test(p.name) && !p.calculated,
        )
        if (flare.length && s.layers.length)
          once(
            unmapped,
            `${label}: the side slopes of the surfacing layers beyond the road edge (${flare
              .map((p) => `${p.name} ${p.raw ? hv(p.raw) : '∞'}:1`)
              .join(', ')}); PGMaps draws each course the road's width, square-edged.`,
          )
      } else if (s.roadwayKind === null && param(c, pick('SUBGRADEWIDTHL', 'SUBGRADEWIDTHR'))) {
        s.roadwayKind = 'subgrade'
        used.add(c)
        roadwayFound()
        s.width = r6(value(c, pick('SUBGRADEWIDTHL', 'SUBGRADEWIDTHR'))!)
        src.width = [from(c, param(c, pick('SUBGRADEWIDTHL', 'SUBGRADEWIDTHR')))!]
      } else if (s.roadwayKind === null && param(c, 'DECKWIDTH')) {
        s.roadwayKind = 'bridge'
        used.add(c)
        roadwayFound()
        s.width = r6(value(c, 'DECKWIDTH')!)
        src.width = [from(c, param(c, 'DECKWIDTH'))!]
        once(
          unmapped,
          `${label}: ${c.name} is a bridge deck (${fmt(value(c, 'DECKDEPTH') ?? 0)} m deep); PGMaps has no bridge and calculates earthwork under it as for any section, so the deck width is used as the road width only.`,
        )
      }
      // Slopes
      const finalSide = param(c, pick('FINALSLPL', 'FINALSLPR'))
      if (param(c, 'SLOPEBELOWSUBSURF')) {
        used.add(c)
        const rock = toHv(value(c, 'SLOPEBELOWSUBSURF')),
          above = toHv(value(c, 'FINALCUTSLP'))
        if (s.cutSlope === null && above !== null) {
          s.cutSlope = above
          src.cutSlope = from(c, param(c, 'FINALCUTSLP'))
        }
        if (s.rockCut === null && rock !== null) {
          s.rockCut = { cutSlope: rock, ledgeWidthM: Math.min(10, Math.max(0, value(c, 'BENCHWIDTH') ?? 0)) }
          src.rockCutSlope = from(c, param(c, 'SLOPEBELOWSUBSURF'))
          src.rockLedge = from(c, param(c, 'BENCHWIDTH'))
          once(
            notes,
            `${label}: ${c.name} becomes the rock cut (${fmt(rock)}:1 below the rock, a ${fmt(s.rockCut.ledgeWidthM ?? 0)} m ledge, ${above === null ? 'the cut batter' : `${fmt(above)}:1`} above); PGMaps applies it only where a ground material marked rock lies in the cut, and no RoadEng ground type is marked rock on import.`,
          )
        }
        if ((value(c, 'BENCHSLOPE') ?? 0) !== 0)
          once(
            unmapped,
            `${label}: the ${c.name} bench's ${fmt(100 * value(c, 'BENCHSLOPE')!, 1)} % slope; the ledge is level.`,
          )
      } else if (param(c, 'FINALCUTSLP') || param(c, 'FINALFILLSLP')) {
        used.add(c)
        const inCut = (value(c, 'BAPPLYINCUT') ?? 1) !== 0,
          inFill = (value(c, 'BAPPLYINFILL') ?? 1) !== 0
        const cut = toHv(value(c, 'FINALCUTSLP')),
          fill = toHv(value(c, 'FINALFILLSLP'))
        const benches = param(c, 'BENCHHEIGHT') && param(c, 'BENCHBASEWIDTH') ? benchesOf(c) : null
        if (benches && backslopeMode === 'component' && s.components.length === 0) {
          for (const b of benches.components)
            s.components.push({ ...b, id: `roadeng-${safeId(t.code)}-${side}-${b.id}`, side })
          once(
            notes,
            `${label}: ${c.name} becomes ${benches.count} benches (${fmt(benches.heightM)} m slopes at ${fmt(benches.slopeHv)}:1, ${fmt(benches.widthM)} m benches) before the closing slopes; they hold where the section engine ends a component at the ground it meets.`,
          )
        } else if (benches)
          once(
            unmapped,
            `${label}: the benches of ${c.name} (${fmt(benches.heightM)} m slopes at ${fmt(benches.slopeHv)}:1 with ${fmt(benches.widthM)} m benches); PGMaps' components do not stop where they meet the ground, so only its closing slopes are used.`,
          )
        if (inCut && s.cutSlope === null && cut !== null) {
          s.cutSlope = cut
          src.cutSlope = from(c, param(c, 'FINALCUTSLP'))
        }
        if (inFill && s.fillSlope === null && fill !== null) {
          s.fillSlope = fill
          src.fillSlope = from(c, param(c, 'FINALFILLSLP'))
        }
      } else if (finalSide) {
        used.add(c)
        const both = toHv(finalSide.value)
        if (both !== null) {
          if (s.cutSlope === null && s.fillSlope === null) src.sharedSlope = true
          if (s.cutSlope === null) {
            s.cutSlope = both
            src.cutSlope = from(c, finalSide)
          }
          if (s.fillSlope === null) {
            s.fillSlope = both
            src.fillSlope = from(c, finalSide)
          }
        }
        if (finalSide.flags & 2)
          once(
            notes,
            `${label}: ${c.name}'s closing slope (${hv(finalSide.raw)}:1, cut and fill) is one RoadEng can set to AUTO, taking the ground type's slope; whether AUTO was chosen is not read, so the stated slope is used.`,
          )
      }
      // Ditch
      if (s.ditch === null && param(c, 'DITCHDEPTH', pick('DITCHDEPTHL', 'DITCHDEPTHR'))) {
        used.add(c)
        const include = value(c, 'BDITCHINCLUDE') ?? 1
        const depth = value(c, 'DITCHDEPTH', pick('DITCHDEPTHL', 'DITCHDEPTHR')) ?? 0
        const inslope = value(c, 'DITCHINSLP', 'DITCHSLP', pick('DITCHSLPL', 'DITCHSLPR')) ?? 0
        const bottom = value(c, 'DITCHBOTWD', pick('DITCHBOTWDL', 'DITCHBOTWDR')) ?? 0
        const back = param(c, 'DITCHBACKSLP')
        src.ditch = {
          include: from(c, param(c, 'BDITCHINCLUDE')),
          depth: from(c, param(c, 'DITCHDEPTH', pick('DITCHDEPTHL', 'DITCHDEPTHR'))),
          bottom: from(c, param(c, 'DITCHBOTWD', pick('DITCHBOTWDL', 'DITCHBOTWDR'))),
          inslope: from(c, param(c, 'DITCHINSLP', 'DITCHSLP', pick('DITCHSLPL', 'DITCHSLPR'))),
          backslope: from(c, back),
          backslopeHeight: from(c, param(c, 'DITCHBACKSLPHT')),
        }
        const height = value(c, 'DITCHBACKSLPHT') ?? 0
        if (include === 0) {
          s.ditch = { depth: 0, bottom: 0, inslope: 1, backslope: 1, backslopeHeight: 0 }
          continue
        }
        if (!(inslope > 0)) {
          once(unmapped, `${label}: ${c.name} on the ${side} has no inslope PGMaps can draw; the ditch is left out.`)
          s.ditch = { depth: 0, bottom: 0, inslope: 1, backslope: 1, backslopeHeight: 0 }
          continue
        }
        s.ditch = { depth, bottom, inslope, backslope: back ? Math.abs(back.value) : null, backslopeHeight: height }
        if ((value(c, 'DITCHBERMWD') ?? 0) > 0)
          once(
            unmapped,
            `${label}: the ${fmt(value(c, 'DITCHBERMWD')!)} m bench at the top of the ${c.name} backslope.`,
          )
        if ((value(c, 'DITCHBOTSLP') ?? 0) !== 0)
          once(
            unmapped,
            `${label}: the ${fmt(100 * value(c, 'DITCHBOTSLP')!, 1)} % cross slope of the ${c.name} bottom; PGMaps' ditch bottom is level.`,
          )
        if ((value(c, 'DITCHFIRSTDPTH') ?? 0) > 0)
          once(unmapped, `${label}: the ${c.name} clear-zone slope break ${fmt(value(c, 'DITCHFIRSTDPTH')!)} m down.`)
        if ((value(c, 'BDEPTHFROMCL') ?? 0) !== 0)
          once(
            unmapped,
            `${label}: ${c.name} measures its depth from the centreline; PGMaps measures it from the road edge.`,
          )
        if ((value(c, 'BBOTINFILLFLAG') ?? 0) !== 0 || (value(c, 'BALLOWABOVETOPO') ?? 0) !== 0)
          once(
            unmapped,
            `${label}: ${c.name} is allowed above ground; PGMaps builds a ditch only where the road edge is in cut.`,
          )
        // RoadEng's own convention: a probe of 99 project units or more means "ditch always".
        const probe = param(c, 'DITCHPROBEDEPTH')
        if (probe && probe.raw < 98.9)
          once(
            notes,
            `${label}: RoadEng forms the ${c.name} only where its ${fmt(probe.value)} m probe ends below ground; PGMaps forms it wherever the road edge is in cut.`,
          )
      }
    }
    // A ditch backslope that runs on above the road edge before the closing cut slope.
    const d = s.ditch
    const backHv = d && d.depth > 0 && d.backslope !== null ? toHv(d.backslope) : null
    if (d && backHv !== null && d.backslopeHeight > d.depth + 1e-9) {
      const rise = r6(d.backslopeHeight - d.depth)
      const closing = s.cutSlope
      if (backslopeMode === 'component' && rise * backHv <= 50 && rise <= 30) {
        const id = `roadeng-${safeId(t.code)}-${side}-backslope`
        s.components.unshift({
          id,
          name: 'Ditch backslope',
          side,
          kind: 'slope',
          condition: 'cut',
          widthM: r6(rise * backHv),
          riseM: rise,
        })
        src.backslope = { mode: 'component', componentId: id, heightM: d.backslopeHeight, depthM: d.depth }
        once(
          notes,
          `${label}: the ditch backslope runs at ${fmt(backHv)}:1 for ${fmt(rise)} m above the road edge as a slope component, then ${closing === null ? 'the cut batter' : `the ${fmt(closing)}:1 closing cut slope`}; it holds where the section engine ends a component at the ground it meets.`,
        )
      } else {
        s.cutSlope = backHv
        src.cutSlope = src.ditch?.backslope
        src.backslope = { mode: 'batter', heightM: d.backslopeHeight, depthM: d.depth }
        delete src.sharedSlope
        once(
          unmapped,
          `${label}: above ${fmt(rise)} m over the road edge RoadEng turns its ditch backslope (${fmt(backHv)}:1) into ${closing === null ? 'its closing cut slope' : `a ${fmt(closing)}:1 closing cut slope`}; PGMaps continues the backslope as the cut batter, so the section is RoadEng's in any cut up to that height.`,
        )
      }
    }
  }
  for (const c of t.components)
    if (!used.has(c))
      once(unmapped, `${label}: component ${c.name} (${c.className}, ${c.side}) is not one PGMaps' section can draw.`)

  const usedFallback: string[] = []
  const take = (side: 'left' | 'right', what: 'width' | 'cutSlope' | 'fillSlope'): number => {
    const own = sides[side][what],
      other = sides[side === 'left' ? 'right' : 'left'][what]
    if (own !== null) return own
    if (other !== null) {
      usedFallback.push(
        `the ${side} ${what === 'width' ? 'road width' : what === 'cutSlope' ? 'cut batter' : 'fill batter'} (taken from the other side)`,
      )
      return other
    }
    const base = what === 'width' ? (side === 'left' ? fallback.leftWidth : fallback.rightWidth) : fallback[what]
    usedFallback.push(
      `the ${side} ${what === 'width' ? 'road width' : what === 'cutSlope' ? 'cut batter' : 'fill batter'} (kept from the road's current section)`,
    )
    return base
  }
  if (sides.left.width === null && sides.right.width === null) {
    unmapped.push(
      `${label}: no roadway component PGMaps reads (a lane width, subgrade width or deck width), so no section is made from it.`,
    )
    return { template: null, subgradeDepthM: { left: 0, right: 0 }, unmapped, notes, sources }
  }
  const per = {
    left: { width: take('left', 'width'), cut: take('left', 'cutSlope'), fill: take('left', 'fillSlope') },
    right: { width: take('right', 'width'), cut: take('right', 'cutSlope'), fill: take('right', 'fillSlope') },
  }
  // Ditch wording is written for one side and said once for "each ditch" when both sides agree.
  const ditchSaid = {
    left: { notes: [] as string[], unmapped: [] as string[] },
    right: { notes: [] as string[], unmapped: [] as string[] },
  }
  const ditchOf = (side: 'left' | 'right') => {
    const d = sides[side].ditch
    if (!d || d.depth <= 0) return { width: 0, depth: 0, bottom: 0 }
    const back = d.backslope ?? (per[side].cut > 0 ? 1 / per[side].cut : d.inslope)
    if (d.backslope === null)
      ditchSaid[side].notes.push(`ditch's backslope is RoadEng's cut slope (${fmt(per[side].cut)}:1).`)
    const width = r6(d.bottom + d.depth / d.inslope + d.depth / back)
    if (Math.abs(d.inslope - back) > 1e-9)
      ditchSaid[side].notes.push(
        `ditch's ${hv(d.inslope)}:1 inslope and ${hv(back)}:1 backslope become one ${fmt((width - d.bottom) / 2 / d.depth)}:1 slope each side (PGMaps' ditch is symmetric), with the same top width (${fmt(width)} m) and cross-section area.`,
      )
    if (width > 10 || d.depth > 5) {
      ditchSaid[side].unmapped.push(
        `ditch (${fmt(width)} m wide, ${fmt(d.depth)} m deep) is past PGMaps' 10 m by 5 m ditch; it is left out.`,
      )
      return { width: 0, depth: 0, bottom: 0 }
    }
    return { width, depth: r6(d.depth), bottom: r6(Math.min(d.bottom, width)) }
  }
  const ditch = { left: ditchOf('left'), right: ditchOf('right') }
  for (const kind of ['notes', 'unmapped'] as const) {
    const list = kind === 'notes' ? notes : unmapped
    const l = ditchSaid.left[kind],
      r = ditchSaid.right[kind]
    if (l.join() === r.join()) for (const text of l) once(list, `${label}: each ${text}`)
    else {
      for (const text of l) once(list, `${label}: the left ${text}`)
      for (const text of r) once(list, `${label}: the right ${text}`)
    }
  }
  const noDitch = (['left', 'right'] as const).filter(
    (side) => sides[side].ditch === null && sides[side].roadwayKind !== 'bridge',
  )
  if (noDitch.length)
    once(
      notes,
      `${label}: no ditch component on the ${noDitch.length === 2 ? 'either side' : noDitch[0]}; the section has no ditch there.`,
    )

  const crossfall = (side: 'left' | 'right') => {
    const c = sides[side].crossfallPercent
    if (c === null) {
      usedFallback.push(`the ${side} crossfall (kept from the road's current section)`)
      return fallback.crossfallPercent
    }
    return Math.max(-20, Math.min(20, c))
  }
  const fallL = r6(crossfall('left')),
    fallR = r6(crossfall('right'))

  const template: RoadTemplate = {
    leftWidth: clampWidth(per.left.width),
    rightWidth: clampWidth(per.right.width),
    crossfallPercent: Math.max(0, Math.min(20, fallL)),
    cutSlope: per.left.cut,
    fillSlope: per.left.fill,
    ditchWidth: ditch.left.width,
    ditchDepth: ditch.left.depth,
    surfaceDepth: 0,
    ditchBottomWidth: ditch.left.bottom,
  }
  if (fallL < 0) template.leftCrossfallPercent = fallL
  if (fallR !== template.crossfallPercent) template.rightCrossfallPercent = fallR
  if (per.right.cut !== per.left.cut) template.rightCutSlope = per.right.cut
  if (per.right.fill !== per.left.fill) template.rightFillSlope = per.right.fill
  if (ditch.right.width !== ditch.left.width) template.rightDitchWidth = ditch.right.width
  if (ditch.right.depth !== ditch.left.depth) template.rightDitchDepth = ditch.right.depth
  if (ditch.right.bottom !== ditch.left.bottom) template.rightDitchBottomWidth = ditch.right.bottom
  const layers = sectionLayers(sides.left.layers, sides.right.layers)
  if (layers) template.layers = layers
  const components = [...sides.left.components, ...sides.right.components].slice(0, 40)
  if (components.length) template.components = components
  if (sides.left.rockCut && sides.right.rockCut && sameRock(sides.left.rockCut, sides.right.rockCut))
    template.rockCut = sides.left.rockCut
  else {
    if (sides.left.rockCut) template.leftRockCut = sides.left.rockCut
    if (sides.right.rockCut) template.rightRockCut = sides.right.rockCut
  }
  if (per.left.width !== template.leftWidth || per.right.width !== template.rightWidth)
    unmapped.push(`${label}: a road width outside PGMaps' 0.1–50 m half-width, held at the limit.`)
  if (usedFallback.length)
    unmapped.push(`${label}: RoadEng gives no value PGMaps reads for ${usedFallback.join(', ')}.`)

  const depthOf = (list: SideSection['layers']) =>
    Math.min(
      5,
      list.reduce((sum, l) => sum + Math.min(2, l.depthM), 0),
    )
  const subgradeDepthM = { left: depthOf(sides.left.layers), right: depthOf(sides.right.layers) }
  if (subgradeDepthM.left > 0 || subgradeDepthM.right > 0)
    notes.push(
      `${label}: RoadEng hangs this section from the finished surface at the centreline and puts the subgrade ${fmt(subgradeDepthM.left)} m (left) and ${fmt(subgradeDepthM.right)} m (right) below it; PGMaps' profile is the subgrade, with the courses above it. Lower the imported profile by that depth to keep RoadEng's subgrade and earthwork.`,
    )
  return { template, subgradeDepthM, unmapped, notes, sources }
}

function blankSide(): SideSection {
  return {
    width: null,
    layers: [],
    crossfallPercent: null,
    cutSlope: null,
    fillSlope: null,
    ditch: null,
    rockCut: null,
    roadwayKind: null,
    components: [],
  }
}

/** RoadEng's Slope VI makes up to this many benches. */
const ROADENG_MAX_BENCHES = 5

/**
 * Slope VI – Benches as PGMaps components: a slope `BenchHeight` high at `BenchSlope`, then a bench
 * `BenchBaseWidth` wide at `BenchBaseSlope`, repeated. Null where its values give no slope or bench
 * PGMaps' component limits take.
 */
function benchesOf(
  c: RoadEngComponent,
): { components: SectionComponent[]; count: number; heightM: number; widthM: number; slopeHv: number } | null {
  const heightM = value(c, 'BENCHHEIGHT') ?? 0,
    widthM = value(c, 'BENCHBASEWIDTH') ?? 0
  const slopeHv = toHv(value(c, 'BENCHSLOPE'))
  if (!(heightM > 0) || !(widthM > 0) || slopeHv === null || heightM > 30 || heightM * slopeHv > 50 || widthM > 50)
    return null
  const baseRise = -(value(c, 'BENCHBASESLOPE') ?? 0) * widthM
  const inCut = (value(c, 'BAPPLYINCUT') ?? 1) !== 0,
    inFill = (value(c, 'BAPPLYINFILL') ?? 1) !== 0
  if (!inCut && !inFill) return null
  const condition = inCut && inFill ? 'always' : inCut ? 'cut' : 'fill'
  // In fill the benches step down to the toe.
  const sign = condition === 'fill' ? -1 : 1
  const components: SectionComponent[] = []
  for (let k = 1; k <= ROADENG_MAX_BENCHES; k++) {
    const base = { name: `Bench ${k}`, side: 'left' as const, condition: condition as SectionComponent['condition'] }
    components.push({
      ...base,
      id: `bench-${k}-slope`,
      kind: 'slope',
      widthM: r6(heightM * slopeHv),
      riseM: sign * r6(heightM),
    })
    components.push({
      ...base,
      id: `bench-${k}`,
      kind: 'bench',
      widthM: r6(widthM),
      riseM: r6(Math.max(-30, Math.min(30, baseRise))) || 0,
    })
  }
  return { components, count: ROADENG_MAX_BENCHES, heightM, widthM, slopeHv }
}
const clampWidth = (w: number) => Math.max(0.1, Math.min(50, w))
const sameRock = (a: RockCutTemplate, b: RockCutTemplate) =>
  a.cutSlope === b.cutSlope && a.ledgeWidthM === b.ledgeWidthM

function sectionLayers(left: SideSection['layers'], right: SideSection['layers']): SectionLayer[] | undefined {
  if (!left.length && !right.length) return undefined
  const same =
    left.length === right.length && left.every((l, i) => l.key === right[i].key && l.depthM === right[i].depthM)
  const make = (l: SideSection['layers'][number], side: SectionLayer['side']): SectionLayer => ({
    id: side === 'both' ? `roadeng-${l.key}` : `roadeng-${l.key}-${side}`,
    name: l.name,
    side,
    depthM: Math.min(2, l.depthM),
  })
  const layers = same
    ? left.map((l) => make(l, 'both'))
    : [...left.map((l) => make(l, 'left')), ...right.map((l) => make(l, 'right'))]
  // A stack is at most 5 m a side; keep courses from the top down until it is full.
  const kept: SectionLayer[] = []
  const depth = { left: 0, right: 0 }
  for (const l of layers) {
    const sides = l.side === 'both' ? (['left', 'right'] as const) : ([l.side] as const)
    if (sides.some((s) => depth[s] + l.depthM > 5)) continue
    for (const s of sides) depth[s] += l.depthM
    kept.push(l)
  }
  return kept.slice(0, 20)
}

export interface RoadEngRangeOptions {
  /** The alignment's first and last RoadEng stations, m (`RoadEngAlignment.startStation`, `endStation`). */
  startStation: number
  endStation: number
  /** Road chainage ÷ design stations (`RoadEngRoad.stationScale`); 1 when omitted. */
  stationScale?: number
}

/** RoadEng station ranges as PGMaps chainage ranges, joined where they repeat, within the road. */
function chainageRanges<T>(
  ranges: readonly RoadEngStationRange[],
  options: RoadEngRangeOptions,
  keyOf: (r: RoadEngStationRange) => T,
  same: (a: T, b: T) => boolean,
): { start: number; end: number; value: T; from: number; to: number }[] {
  const scale = options.stationScale ?? 1
  const length = (options.endStation - options.startStation) * scale
  const out: { start: number; end: number; value: T; from: number; to: number }[] = []
  for (const r of ranges) {
    const from = r.fromStation ?? options.startStation,
      to = r.toStation ?? options.endStation
    const start = Math.max(0, (from - options.startStation) * scale),
      end = Math.min(length, (to - options.startStation) * scale)
    if (!(end > start + 1e-6)) continue
    const value = keyOf(r)
    const last = out[out.length - 1]
    if (last && same(last.value, value) && Math.abs(last.end - start) < 1e-6) {
      last.end = end
      last.to = to
    } else out.push({ start, end, value, from, to })
  }
  return out
}

const safeId = (code: string) => code.replace(/[^a-zA-Z0-9_.:-]/g, '_') || 'template'
/** The id a RoadEng template code takes in the road's template library. */
export const roadEngTemplateId = (code: string) => `roadeng-${safeId(code)}`

export interface RoadEngSectionMapping {
  /** The section used over most of the road; null when no template in use can be read. */
  template: RoadTemplate | null
  baseCode: string | null
  /** The other templates in use, for the road's template library. */
  templates: TemplateDefinition[]
  /**
   * Where they apply, in road chainage: step changes, except where a Taper range lies between two
   * ranges (`transitionInM`/`transitionOutM`).
   */
  assignments: TemplateAssignment[]
  /** Subgrade below RoadEng's profile in the base section, m (see the notes). */
  subgradeDepthM: { left: number; right: number }
  unmapped: string[]
  notes: string[]
}

/**
 * The road's section from the templates its station ranges name. The template over most of the
 * road becomes `template`; the others become library templates assigned to their ranges and sides.
 * A range whose template the design does not hold, or cannot be read, keeps the base section and
 * is listed in `unmapped`.
 */
export function roadEngTemplateFor(
  settings: RoadEngSettings,
  options: RoadEngRangeOptions & RoadEngTemplateOptions & { fallback: RoadTemplate },
): RoadEngSectionMapping {
  const unmapped: string[] = []
  const notes: string[] = []
  const byCode = new Map<string, RoadEngTemplate>()
  for (const t of settings.templates)
    if (!t.folder && t.code && !byCode.has(t.code)) byCode.set(t.code, t)
    else if (!t.folder && byCode.has(t.code))
      notes.push(`Template code ${t.code} appears twice; the first (${byCode.get(t.code)!.name}) is used.`)
  const mapped = new Map<string, RoadEngTemplateMapping>()
  const mapOf = (code: string) => {
    if (!mapped.has(code)) {
      const t = byCode.get(code)
      mapped.set(
        code,
        t
          ? roadEngTemplateToPgmaps(t, options.fallback, options)
          : {
              template: null,
              subgradeDepthM: { left: 0, right: 0 },
              unmapped: [],
              notes: [],
              sources: { left: {}, right: {} },
            },
      )
    }
    return mapped.get(code)!
  }
  const ranges = settings.stationRanges.length
    ? settings.stationRanges
    : [{ fromStation: null, toStation: null, leftTemplate: '', rightTemplate: '', ground: [], raw: [] }]
  if (!settings.stationRanges.length)
    unmapped.push('The alignment names no templates by station range ([LocationParms]).')
  const sideRanges = (['left', 'right'] as const).map((side) =>
    chainageRanges(
      ranges,
      options,
      (r) => (side === 'left' ? r.leftTemplate : r.rightTemplate),
      (a, b) => a === b,
    ).map((r) => ({ ...r, side })),
  )
  const covered = new Map<string, number>()
  for (const list of sideRanges)
    for (const r of list)
      if (mapOf(r.value).template) covered.set(r.value, (covered.get(r.value) ?? 0) + (r.end - r.start))
  for (const list of sideRanges)
    for (const r of list)
      if (r.value !== ROADENG_TAPER_CODE && !mapOf(r.value).template) {
        const why = byCode.has(r.value)
          ? 'which this import cannot make a section from'
          : r.value
            ? 'which the design does not hold'
            : 'which is blank'
        unmapped.push(
          `Template ${r.value || '(none)'} on the ${r.side} from station ${fmt(r.from, 3)} to ${fmt(r.to, 3)} m, ${why}; the base section applies there.`,
        )
      }
  const baseCode = [...covered.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  if (baseCode === null)
    return {
      template: null,
      baseCode: null,
      templates: [],
      assignments: [],
      subgradeDepthM: { left: 0, right: 0 },
      unmapped: [...unmapped, ...[...mapped.values()].flatMap((m) => m.unmapped)],
      notes,
    }
  const templates: TemplateDefinition[] = []
  const assignments: TemplateAssignment[] = []
  type Piece = { start: number; end: number; code: string; side: 'left' | 'right'; into: number; out: number }
  // A Taper range becomes a transition on the range after it, else on the one before it.
  const tapered = sideRanges.map((list) => {
    const seq: (Piece & { from: number; to: number; gone?: boolean })[] = list.map((r) => ({
      start: r.start,
      end: r.end,
      code: r.value,
      side: r.side,
      into: 0,
      out: 0,
      from: r.from,
      to: r.to,
    }))
    seq.forEach((tp, k) => {
      if (tp.code !== ROADENG_TAPER_CODE) return
      tp.gone = true
      const length = tp.end - tp.start
      const touching = (x: (typeof seq)[number] | undefined, at: number) =>
        x && !x.gone && Math.abs(at) < 1e-6 && x.code !== ROADENG_TAPER_CODE ? x : undefined
      const before = touching(seq[k - 1], seq[k - 1] ? seq[k - 1].end - tp.start : 1),
        after = touching(seq[k + 1], seq[k + 1] ? seq[k + 1].start - tp.end : 1)
      const named = (x: typeof before) => !!x && x.code !== baseCode && !!mapOf(x.code).template
      const where = `on the ${tp.side} from station ${fmt(tp.from, 3)} to ${fmt(tp.to, 3)} m`
      if (named(after)) {
        after!.start = tp.start
        after!.into = length
      } else if (named(before)) {
        before!.end = tp.end
        before!.out = length
      } else if (before && after && before.code === baseCode && after.code === baseCode) {
        // Between the base section and itself a taper changes nothing.
        before.end = tp.end
      } else
        unmapped.push(
          `The Taper ${where}: the templates either side of it are not both ones this import reads, so the base section applies there.`,
        )
    })
    return seq.filter((x) => !x.gone)
  })
  const taperCount = sideRanges.flat().filter((r) => r.value === ROADENG_TAPER_CODE).length
  const pieces: Piece[] = tapered
    .flat()
    .filter((r) => r.code !== baseCode && mapOf(r.code).template)
    .map(({ start, end, code, side, into, out }) => ({ start, end, code, side, into, out }))
  // A range with the same template on both sides is one `both` assignment.
  const both: typeof pieces = []
  const single: typeof pieces = []
  for (const p of pieces) {
    const twin = (q: Piece) =>
      q.code === p.code && q.start === p.start && q.end === p.end && q.into === p.into && q.out === p.out
    if (p.side === 'right' && pieces.some((q) => q.side === 'left' && twin(q))) continue
    if (p.side === 'left' && pieces.some((q) => q.side === 'right' && twin(q))) both.push(p)
    else single.push(p)
  }
  const sorted = [...both.map((p) => ({ ...p, side: 'both' as const })), ...single].sort((a, b) => a.start - b.start)
  if (sorted.length > 200) {
    unmapped.push(
      `${sorted.length - 200} template ranges past PGMaps' 200 assignments; the base section applies there.`,
    )
    sorted.length = 200
  }
  for (const p of sorted) {
    const id = `roadeng-${safeId(p.code)}`
    if (!templates.some((t) => t.id === id)) {
      const t = byCode.get(p.code)!
      templates.push({ id, name: `${t.code} · ${t.name}`.slice(0, 200), template: mapOf(p.code).template! })
    }
    assignments.push({
      id: `roadeng-range-${assignments.length + 1}`,
      start: p.start,
      end: p.end,
      templateId: id,
      side: p.side,
      transitionM: 0,
      ...(p.into > 0 ? { transitionInM: p.into } : {}),
      ...(p.out > 0 ? { transitionOutM: p.out } : {}),
    })
  }
  if (templates.length > 50) unmapped.push('More than 50 templates in use; PGMaps keeps 50 in a road library.')
  if (assignments.length)
    notes.push(
      taperCount
        ? `Template ranges are assigned in road chainage from the alignment start; ${taperCount} Taper range${taperCount === 1 ? ' is' : 's are'} a transition between the ranges either side, every other boundary a step.`
        : 'RoadEng switches template at a range boundary; each range is assigned as a step (no transition), in road chainage from the alignment start.',
    )
  for (const [code, m] of mapped)
    if (m.template && (code === baseCode || templates.some((t) => t.id === `roadeng-${safeId(code)}`))) {
      unmapped.push(...m.unmapped)
      notes.push(...m.notes)
    }
  if (settings.parameterOverrides > 0)
    unmapped.push(
      `${settings.parameterOverrides} per-range template parameter overrides; the templates' own values are used.`,
    )
  for (const c of settings.culvertDefaults)
    unmapped.push(
      `The default ${c.kind} culvert (${c.diameterM === null ? 'size not read' : `${fmt(c.diameterM * 1000, 0)} mm`}); it is a starting value for new culverts, not a culvert on the road.`,
    )
  return {
    template: mapOf(baseCode).template,
    baseCode,
    templates: templates.slice(0, 50),
    assignments: assignments.filter((a) => templates.slice(0, 50).some((t) => t.id === a.templateId)),
    subgradeDepthM: mapOf(baseCode).subgradeDepthM,
    unmapped: dedupe(unmapped),
    notes: dedupe(notes),
  }
}

const dedupe = (list: string[]) => [...new Set(list)]

// ---- Lookup tables and curve widening ---------------------------------------------------------------

/** RoadEng's lookup tables by their `LTable` number. */
export const ROADENG_SUPERELEVATION_TABLE = 0
export const ROADENG_RUNOFF_TABLE = 2
export const ROADENG_WIDENING_TABLE = 3
/** Lines and columns read from a `.tbl` file. */
export const MAX_ROADENG_TBL_ROWS = 2000
export const MAX_ROADENG_TBL_COLUMNS = 100
/**
 * Width, in metres and degrees, of the step a stepped widening table is written with in PGMaps'
 * interpolated table: each RoadEng row and column becomes two entries this far apart.
 */
export const ROADENG_STEP_EPSILON = 0.001
/** PGMaps' widening table limits (`roadCriteria.ts`). */
const PGMAPS_WIDENING_MAX_RADIUS_M = 10_000
const PGMAPS_WIDENING_MAX_ENTRIES = 400

/**
 * Reads a RoadEng lookup table saved as text (`.tbl`): lines starting with `#` are comments (kept
 * as the description when above the table), the first other line heads the columns (its first cell
 * blank or ignored), and each further line is a radius and one value per column, comma or tab
 * delimited; a blank cell is a combination the table does not allow. Format from Softree's
 * published description of superelevation tables; the `#` lines match the descriptions designs
 * keep (`LTable-<n>-Desc-*`, a leading space where the `#` was).
 */
export function parseRoadEngTbl(text: string, index = ROADENG_SUPERELEVATION_TABLE): RoadEngSuperelevationTable {
  const table: RoadEngSuperelevationTable = { index, description: [], speeds: [], rows: [] }
  let header = false
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') continue
    if (line.startsWith('#')) {
      if (!header) table.description.push(line === '#' ? '#' : line.slice(1))
      continue
    }
    const cells = line.split(line.includes('\t') ? '\t' : ',').map((c) => c.trim())
    if (cells.length > MAX_ROADENG_TBL_COLUMNS + 1)
      throw Error(`Line ${n + 1} of the table has more than ${MAX_ROADENG_TBL_COLUMNS} columns.`)
    if (!header) {
      table.speeds = cells.slice(1).map(num)
      if (!table.speeds.length || !table.speeds.every(Number.isFinite))
        throw Error(`Line ${n + 1} of the table should head its columns with numbers.`)
      header = true
      continue
    }
    const radius = num(cells[0])
    if (!Number.isFinite(radius)) throw Error(`Line ${n + 1} of the table has no radius in its first column.`)
    const e = table.speeds.map((_, k) => {
      const v = num(cells[k + 1])
      return Number.isFinite(v) ? v : null
    })
    if (cells.slice(1).some((c) => c !== '' && !Number.isFinite(num(c))))
      throw Error(`Line ${n + 1} of the table has a value that is not a number.`)
    table.rows.push({ radius, e })
    if (table.rows.length > MAX_ROADENG_TBL_ROWS) throw Error(`The table has more than ${MAX_ROADENG_TBL_ROWS} rows.`)
  }
  if (!header || !table.rows.length) throw Error('The file holds no table: no column headings and radius rows.')
  return table
}

/**
 * A table's value at a radius and column value (design speed, or deflection for widening).
 *
 * - `interpolate` is RoadEng's superelevation lookup (Softree's help): linear between the rows and
 *   columns around the point. A radius above the largest row takes that row; a radius below the
 *   smallest row, a column value outside the headings, or a blank cell among the four gives null
 *   (RoadEng treats a blank as an unsafe combination).
 * - `step` is how RoadEng read its widening table in Softree's 27.8 km sample (inferred: every
 *   curve's stored widening is the row at or below its radius and the column nearest its
 *   deflection, the larger one on a tie); a radius below every row takes the smallest row, and a
 *   blank cell is 0.
 */
export function roadEngTableValue(
  table: RoadEngSuperelevationTable,
  radius: number,
  column: number,
  lookup: 'interpolate' | 'step',
): number | null {
  const rows = [...table.rows].filter((r) => Number.isFinite(r.radius)).sort((a, b) => a.radius - b.radius)
  const columns = table.speeds.map((v, k) => ({ v, k })).filter((c) => Number.isFinite(c.v))
  columns.sort((a, b) => a.v - b.v)
  if (!rows.length || !columns.length || !Number.isFinite(radius) || !Number.isFinite(column)) return null
  if (lookup === 'step') {
    const row = [...rows].reverse().find((r) => r.radius <= radius) ?? rows[0]
    let best = columns[0]
    for (const c of columns) if (Math.abs(c.v - column) <= Math.abs(best.v - column)) best = c
    return row.e[best.k] ?? 0
  }
  if (radius < rows[0].radius - 1e-9 || column < columns[0].v - 1e-9 || column > columns.at(-1)!.v + 1e-9) return null
  const r = Math.min(radius, rows.at(-1)!.radius)
  const hiRow = rows.findIndex((row) => row.radius >= r - 1e-9)
  const loRow = rows[hiRow].radius <= r + 1e-9 ? hiRow : hiRow - 1
  const hiCol = columns.findIndex((c) => c.v >= column - 1e-9)
  const loCol = columns[hiCol].v <= column + 1e-9 ? hiCol : hiCol - 1
  const cell = (i: number, j: number) => rows[i].e[columns[j].k] ?? null
  const corners = [cell(loRow, loCol), cell(loRow, hiCol), cell(hiRow, loCol), cell(hiRow, hiCol)]
  if (corners.some((v) => v === null)) return null
  const [a, b, c, d] = corners as number[]
  const tr = hiRow === loRow ? 0 : (r - rows[loRow].radius) / (rows[hiRow].radius - rows[loRow].radius)
  const tc = hiCol === loCol ? 0 : (column - columns[loCol].v) / (columns[hiCol].v - columns[loCol].v)
  const low = a + (b - a) * tc,
    high = c + (d - c) * tc
  return low + (high - low) * tr
}

type WideningRow = NonNullable<CurveDesign['wideningTable']>[number]

/**
 * A RoadEng widening table (radius in project units down, deflection in degrees across, widening
 * in project units) as PGMaps' table, in metres. PGMaps interpolates between entries; to keep
 * RoadEng's stepped reading each row is written twice, at its radius and just short of the next
 * row's, and each column twice, spanning the deflections nearest it, {@link ROADENG_STEP_EPSILON}
 * apart. `lookup: 'interpolate'` writes the table as it stands instead. The value goes on both
 * sides, as RoadEng's curves carry it (`108` inside and outside widening equal). Radii past PGMaps'
 * 10,000 m are held at it. Null when the table cannot be written within PGMaps' 400 entries.
 */
export function roadEngWideningRows(
  table: RoadEngSuperelevationTable,
  unitM: number,
  lookup: 'step' | 'interpolate' = 'step',
): { rows: WideningRow[]; heldRadius: boolean; blankCells: number } | null {
  const rows = table.rows
    .filter((r) => Number.isFinite(r.radius) && r.radius > 0)
    .map((r) => ({ radius: r6(r.radius * unitM), e: r.e }))
    .sort((a, b) => a.radius - b.radius)
  const columns = table.speeds
    .map((v, k) => ({ v, k }))
    .filter((c) => Number.isFinite(c.v) && c.v >= 0 && c.v <= 180)
    .sort((a, b) => a.v - b.v)
  if (!rows.length || !columns.length) return null
  let blankCells = 0
  const cell = (row: (typeof rows)[number], k: number) => {
    const v = row.e[k]
    if (v === null || v === undefined || !Number.isFinite(v)) {
      blankCells++
      return 0
    }
    return r6(Math.max(0, Math.min(50, v * unitM)))
  }
  const eps = ROADENG_STEP_EPSILON
  // Each row's radius span, held to PGMaps' largest radius.
  let heldRadius = false
  const radii: { at: number; row: (typeof rows)[number] }[] = []
  for (let i = 0; i < rows.length; i++) {
    const start = rows[i].radius
    if (start >= PGMAPS_WIDENING_MAX_RADIUS_M) {
      heldRadius = heldRadius || i < rows.length - 1 || start > PGMAPS_WIDENING_MAX_RADIUS_M
      radii.push({ at: PGMAPS_WIDENING_MAX_RADIUS_M, row: rows[i] })
      break
    }
    radii.push({ at: start, row: rows[i] })
    if (lookup === 'interpolate' || i === rows.length - 1) continue
    const end = r6(Math.min(rows[i + 1].radius, PGMAPS_WIDENING_MAX_RADIUS_M) - eps)
    if (end > start + 1e-9) radii.push({ at: end, row: rows[i] })
  }
  const angles: { at: number; k: number }[] = []
  for (let j = 0; j < columns.length; j++) {
    if (lookup === 'interpolate') {
      angles.push({ at: columns[j].v, k: columns[j].k })
      continue
    }
    const lo = j === 0 ? columns[0].v : r6((columns[j - 1].v + columns[j].v) / 2)
    const hi = j === columns.length - 1 ? columns[j].v : r6((columns[j].v + columns[j + 1].v) / 2 - eps)
    angles.push({ at: lo, k: columns[j].k })
    if (hi > lo + 1e-9) angles.push({ at: hi, k: columns[j].k })
  }
  if (radii.length * angles.length > PGMAPS_WIDENING_MAX_ENTRIES) {
    if (lookup === 'step') return roadEngWideningRows(table, unitM, 'interpolate')
    return null
  }
  const out: WideningRow[] = []
  for (const r of radii)
    for (const a of angles) {
      const v = cell(r.row, a.k)
      out.push({ radiusM: r.at, deflectionDegrees: a.at, insideM: v, outsideM: v })
    }
  return {
    rows: out,
    heldRadius,
    blankCells: blankCells / Math.max(1, radii.length * angles.length) > 0 ? blankCells : 0,
  }
}

export interface RoadEngWideningMapping {
  /** PGMaps' widening table, or null when the design's curves carry no widening from it. */
  wideningTable: WideningRow[] | null
  /** Each curve's widening in RoadEng (`108`), from the table read RoadEng's way, and in PGMaps. */
  comparison: {
    pi: number
    radiusM: number
    deflectionDegrees: number | null
    roadEngInsideM: number
    roadEngOutsideM: number
    tableM: number | null
    pgmapsInsideM: number | null
    pgmapsOutsideM: number | null
  }[]
  unmapped: string[]
  notes: string[]
}

/**
 * The design's curve widening as PGMaps' widening table. RoadEng applies its widening only where a
 * template has curve widening built in, and stores what each curve got (`108`); the table is taken
 * only when at least one curve carries widening, and each curve's stored widening is compared with
 * what PGMaps then calculates.
 */
export function roadEngWideningFor(settings: RoadEngSettings): RoadEngWideningMapping {
  const unmapped: string[] = []
  const notes: string[] = []
  const table = settings.superelevationTables.find((t) => t.index === ROADENG_WIDENING_TABLE && t.rows.length)
  const widened = settings.curves.filter((c) => c.wideningInsideM > 0 || c.wideningOutsideM > 0)
  const comparison: RoadEngWideningMapping['comparison'] = settings.curves.map((c) => ({
    pi: c.pi,
    radiusM: c.radiusM,
    deflectionDegrees: c.deflectionDegrees,
    roadEngInsideM: c.wideningInsideM,
    roadEngOutsideM: c.wideningOutsideM,
    tableM:
      table && c.deflectionDegrees !== null
        ? r6(roadEngTableValue(table, c.radiusM / settings.unitM, c.deflectionDegrees, 'step')! * settings.unitM)
        : null,
    pgmapsInsideM: null,
    pgmapsOutsideM: null,
  }))
  if (!table) {
    if (widened.length)
      unmapped.push(
        `Curve widening on ${widened.length} curve${widened.length === 1 ? '' : 's'} (${widened.map((c) => `PI ${c.pi} ${fmt(c.wideningInsideM)}/${fmt(c.wideningOutsideM)} m`).join(', ')}, inside/outside) with no widening table to take it from; PGMaps' widening is a rule for the whole road and is left off.`,
      )
    return { wideningTable: null, comparison, unmapped, notes }
  }
  const name = table.description.find((d) => d.trim() && d.trim() !== '#')?.trim() ?? `table ${table.index}`
  if (!widened.length) {
    unmapped.push(
      `RoadEng's widening table (${name}): none of the design's curves carries widening, so its templates have no curve widening built in and the table is not applied.`,
    )
    return { wideningTable: null, comparison, unmapped, notes }
  }
  const written = roadEngWideningRows(table, settings.unitM)
  if (!written) {
    unmapped.push(`RoadEng's widening table (${name}): it does not fit PGMaps' 400-entry widening table.`)
    return { wideningTable: null, comparison, unmapped, notes }
  }
  const stepped = written.rows.length !== table.rows.length * table.speeds.length
  notes.push(
    stepped
      ? `Curve widening comes from RoadEng's widening table (${name}), on both sides of each curve as RoadEng stores it. RoadEng takes the row at or below a curve's radius and the column nearest its deflection; PGMaps interpolates, so each row and column is written twice, ${ROADENG_STEP_EPSILON} apart, to give the same steps.`
      : `Curve widening comes from RoadEng's widening table (${name}), on both sides of each curve; it is too large to write as steps in 400 entries, so PGMaps interpolates between its rows and columns where RoadEng steps.`,
  )
  if (written.heldRadius) notes.push(`The widening table's radii past 10,000 m are held at 10,000 m, PGMaps' largest.`)
  if (written.blankCells) notes.push(`Blank cells in the widening table are taken as no widening.`)
  const design: CurveDesign = {
    designSpeedKmh: 50,
    maxSuperelevationPercent: 0,
    sideFrictionFactor: 0,
    runoffLengthM: 0,
    wideningVehicleLengthM: null,
    wideningTable: written.rows,
  }
  for (const c of comparison) {
    if (c.deflectionDegrees === null) continue
    const v = evaluateCurveCriteria(design, c.radiusM, c.deflectionDegrees)
    c.pgmapsInsideM = r6(v.insideWideningM)
    c.pgmapsOutsideM = r6(v.outsideWideningM)
  }
  const differ = comparison.filter(
    (c) =>
      c.pgmapsInsideM !== null &&
      (Math.abs(c.pgmapsInsideM - c.roadEngInsideM) > 0.005 || Math.abs(c.pgmapsOutsideM! - c.roadEngOutsideM) > 0.005),
  )
  if (differ.length)
    unmapped.push(
      `Curve widening that differs from the table on ${differ.length} curve${differ.length === 1 ? '' : 's'} (${differ
        .slice(0, 10)
        .map(
          (c) =>
            `PI ${c.pi}: ${fmt(c.roadEngInsideM)}/${fmt(c.roadEngOutsideM)} m in RoadEng, ${fmt(c.pgmapsInsideM!)}/${fmt(c.pgmapsOutsideM!)} m here`,
        )
        .join('; ')}${differ.length > 10 ? '; …' : ''}); PGMaps' widening is the table for every curve.`,
    )
  else notes.push(`Every curve's widening matches what RoadEng stored for it.`)
  return { wideningTable: written.rows, comparison, unmapped, notes }
}

// ---- Superelevation --------------------------------------------------------------------------------

export interface RoadEngCurveDesignMapping {
  curveDesign: CurveDesign | null
  /** Each curve's superelevation in RoadEng and as PGMaps calculates it with `curveDesign`, %. */
  comparison: { pi: number; radiusM: number; designSpeedKmh: number; roadEngPercent: number; pgmapsPercent: number }[]
  /** Each curve's widening in RoadEng and in PGMaps (`roadEngWideningFor`). */
  widening: RoadEngWideningMapping['comparison']
  unmapped: string[]
  notes: string[]
}

const mode = (values: number[]) => {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0]
}

/**
 * PGMaps' one curve rule for the road from RoadEng's per-curve superelevation. RoadEng keeps a
 * design speed, e and transition per curve (looked up in its table); PGMaps takes one speed,
 * e max, side friction and runoff, and calculates e = V²/(127 R) − f. The speed and runoff used
 * most, the largest e max, and the side friction that brings PGMaps' e closest to RoadEng's at
 * every curve are used; `comparison` gives both figures for each curve.
 */
export function roadEngCurveDesignFor(settings: RoadEngSettings): RoadEngCurveDesignMapping {
  const unmapped: string[] = []
  const notes: string[] = []
  const curves = settings.curves.filter((c) => c.radiusM > 0 && c.designSpeedKmh > 0 && Number.isFinite(c.e))
  if (!curves.length)
    return {
      curveDesign: null,
      comparison: [],
      widening: [],
      unmapped: ['No curve states a design speed and superelevation.'],
      notes,
    }
  const speed = mode(curves.map((c) => Math.round(c.designSpeedKmh * 100) / 100))!
  const eMax = Math.max(...curves.map((c) => (Number.isFinite(c.eMax) ? c.eMax : c.e)))
  const runoff =
    mode(
      curves
        .flatMap((c) => [c.transitionAtBcM, c.transitionAtEcM])
        .filter(Number.isFinite)
        .map((v) => Math.round(v * 1000) / 1000),
    ) ?? 0
  const eFor = (V: number, R: number, f: number) => Math.max(0, Math.min(eMax, (V * V) / (127 * R) - f))
  let best = { f: 0, worst: Infinity }
  for (let f = 0; f <= 0.5 + 1e-9; f += FRICTION_STEP) {
    const worst = Math.max(...curves.map((c) => Math.abs(eFor(speed, c.radiusM, f) - c.e)))
    if (worst < best.worst - 1e-12) best = { f: Math.round(f * 1000) / 1000, worst }
  }
  const comparison = curves.map((c) => ({
    pi: c.pi,
    radiusM: c.radiusM,
    designSpeedKmh: c.designSpeedKmh,
    roadEngPercent: 100 * c.e,
    pgmapsPercent: 100 * eFor(speed, c.radiusM, best.f),
  }))
  const curveDesign: CurveDesign = {
    criteriaName: settings.roadOptions?.criteriaName
      ? `RoadEng: ${settings.roadOptions.criteriaName}`.slice(0, 200)
      : 'RoadEng design',
    criteriaSource:
      'Read from the RoadEng design: the design speed and transition length most of its curves use, its largest e max, and a side friction fitted to its curves’ superelevation.',
    designSpeedKmh: Math.max(1, Math.min(150, speed)),
    maxSuperelevationPercent: Math.max(0, Math.min(20, 100 * eMax)),
    sideFrictionFactor: best.f,
    runoffLengthM: Math.max(0, Math.min(1000, runoff)),
    wideningVehicleLengthM: null,
  }
  const speeds = [...new Set(curves.map((c) => Math.round(c.designSpeedKmh * 100) / 100))]
  if (speeds.length > 1)
    unmapped.push(
      `Each curve's own design speed (${speeds
        .sort((a, b) => a - b)
        .map((s) => fmt(s, 1))
        .join(', ')} km/h); PGMaps uses one, ${fmt(speed, 1)} km/h, the one most curves use.`,
    )
  const worst = comparison.reduce((a, b) =>
    Math.abs(b.pgmapsPercent - b.roadEngPercent) > Math.abs(a.pgmapsPercent - a.roadEngPercent) ? b : a,
  )
  notes.push(
    `RoadEng takes each curve's superelevation from its own table; PGMaps calculates e = V²/(127 R) − f. With f = ${best.f} the two agree within ${fmt(100 * best.worst, 2)} % on all ${curves.length} curves (the largest difference at PI ${worst.pi}, R ${fmt(worst.radiusM, 1)} m: ${fmt(worst.roadEngPercent, 2)} % in RoadEng, ${fmt(worst.pgmapsPercent, 2)} % here). This f is fitted, not a stated side friction.`,
  )
  const runoffs = [...new Set(curves.flatMap((c) => [c.transitionAtBcM, c.transitionAtEcM]).map((v) => fmt(v, 2)))]
  if (runoffs.length > 1)
    unmapped.push(
      `Each curve's own transition lengths (${runoffs.join(', ')} m); PGMaps uses one runoff, ${fmt(runoff)} m.`,
    )
  const fractions = [...new Set(curves.map((c) => c.transitionFraction))]
  notes.push(
    `RoadEng puts ${fractions.map((f) => `${fmt(100 * f, 1)} %`).join(' or ')} of each transition before the curve, and adds a tangent runout from normal crown outside it; PGMaps runs its whole runoff from normal crown to full superelevation before the curve, ending at its start.`,
  )
  const widening = roadEngWideningFor(settings)
  if (widening.wideningTable) curveDesign.wideningTable = widening.wideningTable
  unmapped.push(...widening.unmapped)
  notes.push(...widening.notes)
  if (eMax !== Math.min(...curves.map((c) => c.eMax)))
    unmapped.push(`Curves with different e max; PGMaps uses the largest, ${fmt(100 * eMax, 1)} %.`)
  const others = settings.superelevationTables.filter((t) => t.index !== ROADENG_WIDENING_TABLE && t.rows.length)
  if (others.length)
    unmapped.push(
      `RoadEng's lookup table${others.length > 1 ? 's' : ''} (${others.map((t) => t.description.find((d) => d.trim() && d.trim() !== '#')?.trim() ?? `table ${t.index}`).join('; ')}); PGMaps calculates e and uses one runoff instead.`,
    )
  return { curveDesign, comparison, unmapped, notes, widening: widening.comparison }
}

// ---- Materials -------------------------------------------------------------------------------------

/** The colours ground types take on import, in their order; `roadEngHaul.ts` compares against them. */
export const ROADENG_MATERIAL_COLORS = [
  '#8d6e63',
  '#c9a227',
  '#7b8794',
  '#5d5d6b',
  '#a1887f',
  '#6d8b74',
  '#b07a52',
  '#4f6d7a',
]

export interface RoadEngMaterialOptions {
  /**
   * Give each material its ground type's cut and fill slopes (default true). PGMaps cuts and fills a
   * material at its own batter wherever its horizon lies (`assembledSection.ts`), so with every range
   * naming a top ground type (Softree's 27.8 km sample: OB at 0.25:1 cut) the template's batters
   * never apply; RoadEng uses these slopes only for a template slope set to AUTO. False keeps the
   * templates' batters and lists the ground types' slopes in the notes.
   */
  materialBatters?: boolean
}

export interface RoadEngMaterialMapping {
  materials: GroundMaterial[]
  strata: StratumAssignment[]
  unmapped: string[]
  notes: string[]
}

/**
 * RoadEng's ground types as PGMaps ground materials, and the ground layers its station ranges give
 * as horizons. A ground type keeps its code (as `roadeng-<code>`), description, cut and fill
 * slopes, its excavation cost and a compacted/bank factor from its two expansion factors. RoadEng
 * has no reusable share, so every material is taken as reusable; none is marked rock.
 */
export function roadEngMaterialsFor(
  settings: RoadEngSettings,
  options: RoadEngRangeOptions & RoadEngMaterialOptions,
): RoadEngMaterialMapping {
  const batters = options.materialBatters ?? true
  const unmapped: string[] = []
  const notes: string[] = []
  const materials: GroundMaterial[] = []
  for (const [i, m] of settings.materials.entries()) {
    if (materials.length >= 32) {
      unmapped.push(`Ground type ${m.code} past PGMaps' 32 materials.`)
      continue
    }
    const factor = m.fillExpansion > 0 ? m.cutExpansion / m.fillExpansion : NaN
    if (!(factor >= 0.1 && factor <= 2)) {
      unmapped.push(
        `Ground type ${m.code}: its expansion factors (cut ${m.cutExpansion}, fill ${m.fillExpansion}) give no compacted/bank factor PGMaps takes (0.1–2).`,
      )
      continue
    }
    const perM3 = settings.unitM === 1 ? m.excavationCost : m.excavationCost / M3_PER_YD3
    const material: GroundMaterial = {
      id: `roadeng-${safeId(m.code)}`,
      name: `${m.code} · ${m.description}`.slice(0, 200),
      color: ROADENG_MATERIAL_COLORS[i % ROADENG_MATERIAL_COLORS.length],
      cutRate: Math.max(0, Math.min(10000, perM3)),
      reusableFraction: 1,
      compactionFactor: factor,
      volumeFactorProvenance:
        m.cutExpansion === 1
          ? {
              convention: 'bank-per-compacted',
              enteredFactor: m.fillExpansion,
              canonicalFactor: factor,
              source: `RoadEng ground type ${m.code}: fill expansion factor ${m.fillExpansion} (cut 1).`,
            }
          : {
              convention: 'compacted-per-bank',
              enteredFactor: factor,
              canonicalFactor: factor,
              source: `RoadEng ground type ${m.code}: cut expansion ${m.cutExpansion} ÷ fill expansion ${m.fillExpansion}.`,
            },
    }
    const cut = m.cutSlopePercent > 0 ? r6(100 / m.cutSlopePercent) : NaN,
      fill = m.fillSlopePercent > 0 ? r6(100 / m.fillSlopePercent) : NaN
    // Without batters a material leaves the template's in place (see `materialBatters`).
    if (batters) {
      if (cut >= 0.1 && cut <= 10) material.cutSlope = cut
      else unmapped.push(`Ground type ${m.code}: its ${m.cutSlopePercent} % cut slope, outside PGMaps' 0.1–10 H:V.`)
      if (fill >= 0.1 && fill <= 10) material.fillSlope = fill
      else unmapped.push(`Ground type ${m.code}: its ${m.fillSlopePercent} % fill slope, outside PGMaps' 0.1–10 H:V.`)
    }
    materials.push(material)
  }
  if (materials.length && !batters)
    notes.push(
      `RoadEng uses a ground type's cut and fill slopes only for a template slope set to AUTO, and the templates' stated slopes are used here; the materials carry no batter, because a material's batter replaces the template's wherever its horizon lies. The ground types' slopes: ${settings.materials.map((m) => `${m.code} cut ${m.cutSlopePercent > 0 ? fmt(100 / m.cutSlopePercent) : '–'}:1, fill ${m.fillSlopePercent > 0 ? fmt(100 / m.fillSlopePercent) : '–'}:1`).join('; ')}.`,
    )
  if (materials.length)
    notes.push(
      `Ground types: ${batters ? "the cut and fill slopes RoadEng uses for an AUTO template slope become each material's batters, and " : ''}its excavation cost becomes the material's rate per bank m³${settings.unitM === 1 ? '' : ' (converted from per yd³)'}, in the currency entered in RoadEng, not converted. RoadEng has no reusable share, so each material is taken as fully reusable. No material is marked rock: mark rock materials yourself for the rock cut to apply.`,
    )
  const codes = new Map(settings.materials.map((m) => [m.code, `roadeng-${safeId(m.code)}`]))
  const strata: StratumAssignment[] = []
  const pieces = chainageRanges(
    settings.stationRanges,
    options,
    (r) => r.ground,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const missing = new Set<string>()
  for (const p of pieces)
    for (const layer of p.value) {
      const materialId = codes.get(layer.code)
      if (!materialId || !materials.some((m) => m.id === materialId)) {
        missing.add(layer.code)
        continue
      }
      if (strata.length >= 200) continue
      strata.push({
        id: `roadeng-horizon-${strata.length + 1}`,
        start: p.start,
        end: p.end,
        materialId,
        topDepthM: Math.min(1000, layer.topDepthM),
        bottomDepthM: layer.bottomDepthM === null ? null : Math.min(1000, layer.bottomDepthM),
      })
    }
  for (const code of missing)
    unmapped.push(
      code === '**'
        ? "Ground layers given as the design's default ground type (**); which type that is is not read, so that ground is left unclassified."
        : `Ground layers of type ${code}, which the design's ground types do not hold; that ground is left unclassified.`,
    )
  if (strata.length)
    notes.push(
      'Ground layers by station range become horizons at the same depths below original ground, in road chainage.',
    )
  return { materials, strata, unmapped: dedupe(unmapped), notes }
}

// ---- Together ----------------------------------------------------------------------------------------

/**
 * The road's section, curve rule and engineering library from one alignment's RoadEng settings:
 * `template` for the road, `curveDesign` for its curves, and `engineering` holding the other
 * templates, their ranges, the ground materials and horizons (with PGMaps' empty defaults for the
 * rest).
 */
export function roadEngEngineeringFor(
  settings: RoadEngSettings,
  options: RoadEngRangeOptions & RoadEngTemplateOptions & RoadEngMaterialOptions & { fallback: RoadTemplate },
): {
  template: RoadTemplate | null
  curveDesign: CurveDesign | null
  engineering: AlignmentEngineering
  subgradeDepthM: { left: number; right: number }
  unmapped: string[]
  notes: string[]
} {
  const section = roadEngTemplateFor(settings, options)
  const curves = roadEngCurveDesignFor(settings)
  const ground = roadEngMaterialsFor(settings, options)
  const engineering = createEngineeringDesign()
  engineering.templates = section.templates
  engineering.assignments = section.assignments
  engineering.materials = ground.materials
  engineering.strata = ground.strata
  return {
    template: section.template,
    curveDesign: curves.curveDesign,
    engineering,
    subgradeDepthM: section.subgradeDepthM,
    unmapped: dedupe([...section.unmapped, ...curves.unmapped, ...ground.unmapped]),
    notes: dedupe([...section.notes, ...curves.notes, ...ground.notes]),
  }
}
