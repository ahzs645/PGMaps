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
 * rock here, and a reference feature a width follows in RoadEng is not looked up.
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
import type { CurveDesign, RoadTemplate, RockCutTemplate, SectionLayer } from './types'

/** A RoadEng station at or past this is "the end of the road" in `[LocationParms]`. */
export const ROADENG_END_STATION = 99_999_999
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

export interface RoadEngSuperelevationTable {
  index: number
  description: string[]
  /** Design speeds heading the columns, as written (km/h in a metric design). */
  speeds: number[]
  /** Radius as written (project units) and e per speed, rise over run; null where blank. */
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

type Ini = Map<string, Map<string, string>>

/** `[section] key=value` text; later keys win, keys keep their case. */
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
    if (cells[0].trim() === '') table.speeds = cells.slice(1).map(num)
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
  for (const line of ds2Text.split(/\r?\n/)) {
    const f = line.split(',')
    if (f[0] === '108') {
      const radius = num(f[3]),
        speed = num(f[8])
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
        raw: f,
      })
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
  /** Slopes as rise over run; a null backslope is the side's cut slope. */
  ditch: { depth: number; bottom: number; inslope: number; backslope: number | null } | null
  rockCut: RockCutTemplate | null
  roadwayKind: 'layered' | 'subgrade' | 'bridge' | null
}

export interface RoadEngTemplateMapping {
  template: RoadTemplate | null
  /** Depth of the subgrade below the template's attachment (RoadEng's profile) on each side, m. */
  subgradeDepthM: { left: number; right: number }
  /** RoadEng items not carried over, in plain words. */
  unmapped: string[]
  /** Carried over with a stated difference or assumption. */
  notes: string[]
}

/**
 * One RoadEng template as a PGMaps section. Values RoadEng does not give (a side with no slope
 * component, say) come from `fallback`, and each is listed in `unmapped`.
 */
export function roadEngTemplateToPgmaps(t: RoadEngTemplate, fallback: RoadTemplate): RoadEngTemplateMapping {
  const unmapped: string[] = []
  const notes: string[] = []
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
    const fall = side === 'left' ? t.crossfallLeft : t.crossfallRight
    if (Number.isFinite(fall)) s.crossfallPercent = -100 * fall
    const here = t.components.filter((c) => c.side === side || c.side === 'both')
    for (const c of here) {
      const pick = <T>(left: T, right: T) => (side === 'left' ? left : right)
      // Roadway
      if (s.roadwayKind === null && param(c, 'ACPWIDTH')) {
        s.roadwayKind = 'layered'
        used.add(c)
        s.width = r6(WIDTH_PARTS.reduce((sum, name) => sum + (value(c, name) ?? 0), 0))
        const follows = param(c, 'ACPWIDTH')!.featureIndex
        if (follows !== null)
          once(
            notes,
            `${label}: RoadEng runs the ${c.name} lane width along reference feature ${follows + 1}; its stated ${fmt(value(c, 'ACPWIDTH')!)} m is used as a fixed width.`,
          )
        for (const [name, title] of LAYER_ORDER) {
          const p = param(c, name)
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
        s.width = r6(value(c, pick('SUBGRADEWIDTHL', 'SUBGRADEWIDTHR'))!)
      } else if (s.roadwayKind === null && param(c, 'DECKWIDTH')) {
        s.roadwayKind = 'bridge'
        used.add(c)
        s.width = r6(value(c, 'DECKWIDTH')!)
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
        if (s.cutSlope === null && above !== null) s.cutSlope = above
        if (s.rockCut === null && rock !== null) {
          s.rockCut = { cutSlope: rock, ledgeWidthM: Math.min(10, Math.max(0, value(c, 'BENCHWIDTH') ?? 0)) }
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
        if (inCut && s.cutSlope === null && cut !== null) s.cutSlope = cut
        if (inFill && s.fillSlope === null && fill !== null) s.fillSlope = fill
      } else if (finalSide) {
        used.add(c)
        const both = toHv(finalSide.value)
        if (both !== null) {
          if (s.cutSlope === null) s.cutSlope = both
          if (s.fillSlope === null) s.fillSlope = both
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
        if (include === 0) {
          s.ditch = { depth: 0, bottom: 0, inslope: 1, backslope: 1 }
          continue
        }
        if (!(inslope > 0)) {
          once(unmapped, `${label}: ${c.name} on the ${side} has no inslope PGMaps can draw; the ditch is left out.`)
          s.ditch = { depth: 0, bottom: 0, inslope: 1, backslope: 1 }
          continue
        }
        s.ditch = { depth, bottom, inslope, backslope: back ? Math.abs(back.value) : null }
        const height = value(c, 'DITCHBACKSLPHT') ?? 0
        if (back && height > depth + 1e-9)
          once(
            unmapped,
            `${label}: RoadEng runs the ${c.name} backslope at ${hv(back.value)}:1 up to ${fmt(height)} m above the ditch bottom before its final cut slope; PGMaps starts the cut batter at the ditch's top, so a cut up to ${fmt(height - depth)} m above the road edge takes the cut batter instead.`,
          )
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
    return { template: null, subgradeDepthM: { left: 0, right: 0 }, unmapped, notes }
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
  return { template, subgradeDepthM, unmapped, notes }
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
  }
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

export interface RoadEngSectionMapping {
  /** The section used over most of the road; null when no template in use can be read. */
  template: RoadTemplate | null
  baseCode: string | null
  /** The other templates in use, for the road's template library. */
  templates: TemplateDefinition[]
  /** Where they apply, in road chainage, as step changes (transition 0). */
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
  options: RoadEngRangeOptions & { fallback: RoadTemplate },
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
          ? roadEngTemplateToPgmaps(t, options.fallback)
          : { template: null, subgradeDepthM: { left: 0, right: 0 }, unmapped: [], notes: [] },
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
      if (!mapOf(r.value).template) {
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
  const pieces: { start: number; end: number; code: string; side: 'left' | 'right' }[] = sideRanges
    .flat()
    .filter((r) => r.value !== baseCode && mapOf(r.value).template)
    .map((r) => ({ start: r.start, end: r.end, code: r.value, side: r.side }))
  // A range with the same template on both sides is one `both` assignment.
  const both: typeof pieces = []
  const single: typeof pieces = []
  for (const p of pieces) {
    if (
      p.side === 'right' &&
      pieces.some((q) => q.side === 'left' && q.code === p.code && q.start === p.start && q.end === p.end)
    )
      continue
    if (
      p.side === 'left' &&
      pieces.some((q) => q.side === 'right' && q.code === p.code && q.start === p.start && q.end === p.end)
    )
      both.push(p)
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
    })
  }
  if (templates.length > 50) unmapped.push('More than 50 templates in use; PGMaps keeps 50 in a road library.')
  if (assignments.length)
    notes.push(
      'RoadEng switches template at a range boundary; each range is assigned as a step (no transition), in road chainage from the alignment start.',
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

// ---- Superelevation --------------------------------------------------------------------------------

export interface RoadEngCurveDesignMapping {
  curveDesign: CurveDesign | null
  /** Each curve's superelevation in RoadEng and as PGMaps calculates it with `curveDesign`, %. */
  comparison: { pi: number; radiusM: number; designSpeedKmh: number; roadEngPercent: number; pgmapsPercent: number }[]
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
  const widened = curves.filter((c) => c.wideningInsideM > 0 || c.wideningOutsideM > 0)
  if (widened.length)
    unmapped.push(
      `Curve widening read as ${widened.map((c) => `PI ${c.pi} ${fmt(c.wideningInsideM)}/${fmt(c.wideningOutsideM)} m`).join(', ')} (inside/outside, field position inferred); PGMaps' widening is one rule for the road and is left off.`,
    )
  if (eMax !== Math.min(...curves.map((c) => c.eMax)))
    unmapped.push(`Curves with different e max; PGMaps uses the largest, ${fmt(100 * eMax, 1)} %.`)
  if (settings.superelevationTables.length)
    unmapped.push(
      `RoadEng's superelevation table${settings.superelevationTables.length > 1 ? 's' : ''} (${settings.superelevationTables.map((t) => t.description[0] ?? `table ${t.index}`).join('; ')}); PGMaps calculates e instead.`,
    )
  return { curveDesign, comparison, unmapped, notes }
}

// ---- Materials -------------------------------------------------------------------------------------

const MATERIAL_COLORS = ['#8d6e63', '#c9a227', '#7b8794', '#5d5d6b', '#a1887f', '#6d8b74', '#b07a52', '#4f6d7a']

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
export function roadEngMaterialsFor(settings: RoadEngSettings, options: RoadEngRangeOptions): RoadEngMaterialMapping {
  const unmapped: string[] = []
  const notes: string[] = []
  const materials: GroundMaterial[] = []
  const volume = settings.unitM === 1 ? 'm³' : 'yd³'
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
      color: MATERIAL_COLORS[i % MATERIAL_COLORS.length],
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
    if (cut >= 0.1 && cut <= 10) material.cutSlope = cut
    else unmapped.push(`Ground type ${m.code}: its ${m.cutSlopePercent} % cut slope, outside PGMaps' 0.1–10 H:V.`)
    if (fill >= 0.1 && fill <= 10) material.fillSlope = fill
    else unmapped.push(`Ground type ${m.code}: its ${m.fillSlopePercent} % fill slope, outside PGMaps' 0.1–10 H:V.`)
    materials.push(material)
  }
  if (materials.length) {
    notes.push(
      `Ground types: the cut and fill slopes RoadEng uses for an AUTO template slope become each material's batters, and its excavation cost becomes the material's rate per bank m³${settings.unitM === 1 ? '' : ' (converted from per yd³)'}, in the currency entered in RoadEng, not converted. RoadEng has no reusable share, so each material is taken as fully reusable.`,
    )
    unmapped.push(
      `Each ground type's embankment cost (per ${volume}), hauling and loading costs, quality and Bedrock designation: the fields that hold them are not identified, so no material is marked rock — mark rock materials yourself for the rock cut to apply.`,
    )
  }
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
  options: RoadEngRangeOptions & { fallback: RoadTemplate },
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
