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
 *   fragments, whose fourth field's lowest bit is set on a left-side fragment, and their legs (read
 *   in `roadEngConstruction.ts`, which places a roadway's subgrade edge from them); `T<t>-C<c>-U<u>` its
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
 * Superelevation is read curve by curve (`roadEngCurveDesignFor`, `roadEngCurveSettings`,
 * `withRoadEngCurveSettings`): the superelevation, runoff and side friction tables become the road's
 * table mode (`CurveDesign.superelevationMode`), or its side friction mode where the curves' Auto
 * uses RoadEng's side friction method, and each `108` record gives its curve its own design speed,
 * e max, f max (field 11, in the side friction method), transitions, transition fraction and radius
 * in the design's grid where the rule would give another, and its own e where RoadEng's Auto
 * superelevation is off; a curve with RoadEng's Use Minimum Radius (bit 1 of field 9,
 * {@link ROADENG_MINIMUM_RADIUS_BIT}) is held at its e max, and bit 8
 * ({@link ROADENG_TABLE_SUPERELEVATION_BIT}) says which Auto method a curve uses, both read from
 * Softree's files; the tangent runout's own setting was not found and is taken as RoadEng's automatic one,
 * at the runoff's rate.
 *
 * Lookup tables (`LTable-<n>`, or a `.tbl` file through `parseRoadEngTbl`) are read with
 * `roadEngTableValue`: superelevation interpolated, as Softree documents; widening stepped (the row
 * at or below the radius, the nearest deflection column), inferred from every curve of Softree's
 * 27.8 km sample. The widening table becomes PGMaps' `wideningTable`, on each side its curves carry
 * it (`roadEngWideningFor`), written as steps PGMaps' interpolation reproduces
 * (`roadEngWideningRows`); a curve whose stored widening (`108` fields 17 and 18, inside and
 * outside) the table does not give, or whose inside Auto widening is off
 * ({@link ROADENG_AUTO_WIDENING_INSIDE_BIT}, bit 7 of field 9, read from Softree's samples), keeps
 * its own on that side (`CurveSettings.insideWideningM`/`outsideWideningM`).
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, unzipSync } from 'fflate'
import { createEngineeringDesign } from './engineeringTypes'
import { ROADENG_UNITS, ROADENG_UNITS_READ } from './roadEngUnits'
import type {
  AlignmentEngineering,
  FillRequirement,
  GroundMaterial,
  SitePreparationRange,
  StratumAssignment,
  TemplateAssignment,
  TemplateDefinition,
} from './engineeringTypes'
import { horizontalCurveFits } from './engine'
import { pLineStrataPieces, ROADENG_PLINE_STRATUM_PREFIX, type PLineGround } from './roadEngPLine'
import { evaluateCurveCriteria, MAX_CURVE_WIDENING_M, TABLE_SPEED_SNAP_KMH } from './roadCriteria'
import {
  readRoadEngFragments,
  roadEngParameterValues,
  roadEngRoadwayConstruction,
  type RoadEngFragment,
  type RoadEngRoadwayConstruction,
} from './roadEngConstruction'
import type { RoadEngAlignment, RoadEngCurveFields } from './roadEngImport'
import {
  MAX_PARAMETER_OVERRIDES,
  OVERRIDE_FIELD_NAMES,
  OVERRIDE_FIELDS,
  overrideFieldValue,
  type OverrideField,
  type OverridePoint,
  type TemplateParameterOverride,
} from './templateParameterOverrides'
import type {
  Alignment,
  BatterSource,
  CurveDesign,
  CurveLookupTable,
  CurveSettings,
  RoadTemplate,
  RockCutTemplate,
  SectionComponent,
  SectionLayer,
} from './types'
import {
  DEFAULT_BENCH_COUNT,
  MAX_DITCH_DEPTH_M,
  MAX_DITCH_WIDTH_M,
  STRUCTURE_LIMITS,
  type BenchedSlope,
  type SectionBarrier,
  type SectionWall,
  type SubCut,
} from './sectionStructures'

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
  /**
   * A slope set to AUTO in RoadEng (flag 2 beside the slope flag): it takes the ground type's slope
   * (`groundBatters.ts`). Read from Softree's LandXML tutorial design, whose Rural template (`RUR`,
   * slopes on AUTO by its tutorial) is the only one with this flag on its closing slopes. Omitted
   * is false.
   */
  auto?: boolean
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
  /** Its fragments and legs (`roadEngConstruction.ts`); omitted where none were read. */
  fragments?: RoadEngFragment[]
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
  /** Metres per project unit, for the lengths its expressions give; omitted is metres. */
  unitM?: number
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
  /**
   * The subgrade fill material (Fill Types Assignments): a ground type code, or `*1`/`*2` for the
   * ground type of the range's first or second stratum layer (RoadEng's default is `*1`). Field 12 of
   * the row (index 11), read from Softree's samples: Hart Rd holds SR over 346.214–445.132 m and `*2`
   * either side, Align stage 8 RR over 1300–1500 ft, Location 18 CO on every range, the sample's own
   * tutorials naming those materials and ranges. A range with Replaceable (quality based) ticked is
   * this plain row: Softree's V11 RoadEng Resource tutorial ticks it for CO over the whole road
   * (Location 13_2 → 13_3, which differ only in this field, `*1` → `CO`) and states CO and SI
   * replaceable in Location 25_x, rows like every other sample's. So PGMaps reads every range as
   * quality based; where RoadEng marks an unticked (exact) range is not shown by any sample.
   */
  fillMaterial: string
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
  /** The curve's f max, its largest side friction (0.1 to 0.17 in Softree's samples); the side friction method's. */
  field11: number
  transitionAtBcM: number
  transitionAtEcM: number
  /** Share of the transition before the BC (and after the EC). */
  transitionFraction: number
  /** Inside and outside widening, m (fields 17 and 18; checked against Softree's samples). */
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
  /** Thousandths of a project unit (mm in a metric design), as placed culverts hold it (`roadEngPlacedCulverts.ts`). */
  diameterM: number | null
  /** Degrees clockwise from the L-line ahead, 90 square to it (`roadEngPlacedCulverts.ts`). */
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
  /** Per-range template parameter overrides the design counts (`[design] ParmOverrides-1`). */
  parameterOverrides: number
  /** The overrides themselves (`[design] ParmOverrides-2…`), in file order. */
  parameterOverrideEntries: RoadEngParameterOverrideEntry[]
  /**
   * Template layers given a fill material (RoadEng's Template Materials, which the Fill Types tab's
   * Other Materials button opens): `[TemplatesSct] RoadSurfaceCodes-<n>=<code>|<description>,<ground
   * type>`, n 0 the subgrade and 1–16 the layers above it. Read from Softree's V11 RoadEng Resource
   * tutorial (chapter 25, step 9): Location 25_4 holds `Srf4|Layer 4 above subgrade,FR` after Srf4
   * is given FR Fractured Rock with Replaceable unticked; an unassigned layer ends in a bare comma.
   * Where a ticked Replaceable box is kept is not shown (no sample has one).
   */
  templateLayerMaterials?: { layer: number; code: string; description: string; material: string }[]
  warnings: string[]
}

/**
 * One entry of RoadEng's Parameter Overrides (`[design] ParmOverrides-<n>`, n from 2):
 * `station|code|parameter|value|description`. Read from Softree's samples (Hart Rd's turning lane,
 * Location 18's two pullouts, Widening only's 43 entries over ten parameters): the station in
 * project units, ±3.40282346639e+38 (±FLT_MAX) for the start and the end of the alignment; the
 * value in the parameter's own units with `**` for the template's value; and the row's description,
 * free text (`Alignment Start`, `turning lane`, `Taper Start`, `Pullout End`), which RoadEng's
 * Duplicate button copies to the new row.
 *
 * The code is the side the parameter is overridden on ({@link ROADENG_OVERRIDE_LEFT} 4096,
 * {@link ROADENG_OVERRIDE_RIGHT} 8192), not the parameter's place in the template: Hart Rd's 4096
 * overrides `AcpWidth` of the left lane component (C0) and Location 18's 8192 `Width` of the right
 * one (C1), which Softree's own articles on those designs name "ACP_WIDTH (left)" and
 * "Width (Right)"; Widening only holds `OverlayThick` under both codes as two separate series, and
 * its parameters at indices 0 to 15 of one component all carry 4096. No sample sets a lower bit.
 *
 * Entries at one station follow each other in key order (Duplicate makes them): the earlier one's
 * value holds up to the station and the later one's after it.
 */
export interface RoadEngParameterOverrideEntry {
  /** Its `ParmOverrides-<n>` number. */
  key: number
  /** Design station, metres; −Infinity and Infinity for RoadEng's alignment start and end (±FLT_MAX). */
  station: number
  code: number
  parameter: string
  /** The value as stored (project units for a length, rise over run for a slope); null for `**`. */
  raw: number | null
  /** The row's description as entered in RoadEng. */
  description: string
  text: string
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
            auto: kind === 'slope' && (flags & 2) !== 0,
          },
        })
      }
      const parameters = indexed.sort((a, b) => a.index - b.index).map((p) => p.parameter)
      const fragments = readRoadEngFragments(section, prefix)
      components.push({
        index: c,
        className: (head[1] ?? '').trim(),
        name: decodeText(name),
        description: decodeText(description),
        side: sides.size === 1 ? [...sides][0] : 'both',
        parameters,
        ...(fragments.length ? { fragments } : {}),
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
      ...(unitM !== 1 ? { unitM } : {}),
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
      fillMaterial: f[11] ?? '',
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
 * A design's default drain and stream culverts (`[Culvert] DefDrainCulvert`/`DefStreamCulvert`):
 * the values RoadEng starts a new culvert from. `dsnText` is the alignment's `.dsn` (or the first
 * alignment's, which holds them for the design), `unitM` metres per project unit.
 */
export function readRoadEngCulvertDefaults(dsnText: string, unitM: number): RoadEngCulvertDefault[] {
  return readCulverts(readIni(dsnText).get('Culvert'), unitM)
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
  const parameterOverrideEntries: RoadEngParameterOverrideEntry[] = []
  for (const [key, value] of ini.get('design') ?? []) {
    const n = /^ParmOverrides-(\d+)$/.exec(key)
    if (!n) continue
    if (n[1] === '1') {
      if (Number.isFinite(num(value))) parameterOverrides += num(value)
      continue
    }
    const f = value.split('|')
    const station = num(f[0]),
      code = num(f[1])
    const v = (f[3] ?? '').trim()
    if (
      !Number.isFinite(station) ||
      !Number.isFinite(code) ||
      !f[2]?.trim() ||
      (v !== '**' && !Number.isFinite(num(v)))
    ) {
      warnings.push(`A parameter override could not be read and is left out: ${value.slice(0, 80)}`)
      continue
    }
    parameterOverrideEntries.push({
      key: Number(n[1]),
      station: Math.abs(station) >= ROADENG_OVERRIDE_BEYOND ? Math.sign(station) * Infinity : station * unitM,
      code,
      parameter: f[2].trim(),
      raw: v === '**' ? null : num(v),
      description: (f[4] ?? '').trim(),
      text: value,
    })
  }
  parameterOverrideEntries.sort((a, b) => a.key - b.key)

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
    parameterOverrideEntries,
    templateLayerMaterials: readTemplateLayerMaterials(templateSection),
    warnings,
  }
}

/** `RoadSurfaceCodes-<n>` entries that name a fill material (`templateLayerMaterials`). */
function readTemplateLayerMaterials(
  section: Map<string, string> | undefined,
): NonNullable<RoadEngSettings['templateLayerMaterials']> {
  const out: NonNullable<RoadEngSettings['templateLayerMaterials']> = []
  for (const [key, text] of section ?? []) {
    const k = /^RoadSurfaceCodes-(\d+)$/.exec(key)
    if (!k) continue
    const comma = text.lastIndexOf(',')
    const material = comma >= 0 ? text.slice(comma + 1).trim() : ''
    if (!material) continue
    const label = text.slice(0, comma)
    const bar = label.indexOf('|')
    out.push({
      layer: Number(k[1]),
      code: bar >= 0 ? label.slice(0, bar).trim() : '',
      description: (bar >= 0 ? label.slice(bar + 1) : label).trim(),
      material,
    })
  }
  return out.sort((a, b) => a.layer - b.layer).slice(0, 32)
}

const UNITS = ROADENG_UNITS

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
    throw Error(`The RoadEng design's units code ${unitsText} is not one this import reads (${ROADENG_UNITS_READ}).`)
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
  // Resource I: surface 2 lies on surface 1.
  ['SRF2THICK', 'Surface 2'],
  ['SRF1THICK', 'Surface 1'],
]
const WIDTH_PARTS = ['ACPWIDTH', 'SHOULDERWIDTH', 'SHOULDERPAVEWIDTH', 'SHOULDERGRAVWIDTH']
/** One side's width parts where the roadway keeps a value per side (the guard-rail sample's Roadway). */
const SIDE_WIDTH_PARTS = {
  left: ['ACPWIDTHL', 'SHOULDERWIDTHL'],
  right: ['ACPWIDTHR', 'SHOULDERWIDTHR'],
}
/**
 * Each course's side-slope parameter (rise over run), by its thickness parameter: Rural I's
 * `BaseFillSlope`, `SubbaseFillSlope`, `SubLayer4FillSlp`; Rural Paved's `CSTC_SLOPE`, `BASE_SLOPE`.
 */
const LAYER_SLOPES: Record<string, string[]> = {
  CSTCTHICK: ['CSTCFILLSLOPE', 'CSTCSLOPE'],
  BASETHICK: ['BASEFILLSLOPE', 'BASESLOPE'],
  SUBBASETHICK: ['SUBBASEFILLSLOPE', 'SUBBASESLOPE'],
  SUBLAYER4THICK: ['SUBLAYER4FILLSLP', 'SUBLAYER4SLOPE'],
  SRF1THICK: ['SRF1FILLSLOPE'],
  SRF2THICK: ['SRF2FILLSLOPE'],
}
/** A slope at or past this rise over run is vertical in RoadEng's library (`9999.99`). */
const ROADENG_VERTICAL = 9000

interface SideSection {
  width: number | null
  layers: { key: string; name: string; depthM: number; sideSlope?: number }[]
  crossfallPercent: number | null
  cutSlope: number | null
  fillSlope: number | null
  /** Whether the slope each came from is AUTO in RoadEng (the ground type's slope applies). */
  cutAuto: boolean
  fillAuto: boolean
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
  /** Ordered slope components (`component` mode only). */
  components: SectionComponent[]
  benches: { cut?: BenchedSlope; fill?: BenchedSlope }
  walls: SectionWall[]
  /** A fill wall's face, m from the centreline, where RoadEng places it there: its setback once the width is known. */
  wallFaces: Map<string, number>
  barriers: SectionBarrier[]
  subCut: SubCut | null
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
  /** Course side slopes by the same keys; the road width includes their runs. */
  layerSlopes?: Record<string, RoadEngSource>
  rockCutSlope?: RoadEngSource
  rockLedge?: RoadEngSource
  /** Benched batters: face height, bench width, face slope and bench slope. */
  benches?: Partial<
    Record<
      'cut' | 'fill',
      { height?: RoadEngSource; width?: RoadEngSource; face?: RoadEngSource; fall?: RoadEngSource }
    >
  >
  /** Walls by id: height, thickness, face batter, setback. */
  walls?: Record<
    string,
    {
      height?: RoadEngSource
      thickness?: RoadEngSource
      face?: RoadEngSource
      setback?: RoadEngSource
      cover?: RoadEngSource
    }
  >
  /** Barriers by id: offset from the centreline, width, height. */
  barriers?: Record<string, { offset?: RoadEngSource; width?: RoadEngSource; height?: RoadEngSource }>
  subCut?: {
    depth?: RoadEngSource
    width?: RoadEngSource
    outside?: RoadEngSource
    bottom?: RoadEngSource
    inside?: RoadEngSource
    follows?: RoadEngSource
  }
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
  const roadwaySaid: Partial<Record<'left' | 'right', SidedNotes>> = {}
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
      // Roadway. Its subgrade edge and depth come from the component's own construction where it
      // reads as a closed sum (`roadEngConstruction.ts`); else from its width and course parameters.
      const built =
        s.roadwayKind === null && isClass(c, 'RDWY') ? roadEngRoadwayConstruction(c, side, t.unitM ?? 1) : null
      if (s.roadwayKind === null && (param(c, 'ACPWIDTH') || built)) {
        s.roadwayKind = 'layered'
        used.add(c)
        roadwayFound()
        const parts = [...WIDTH_PARTS, ...SIDE_WIDTH_PARTS[side]]
        const laneP = param(c, 'ACPWIDTH', SIDE_WIDTH_PARTS[side][0])
        s.width = r6(parts.reduce((sum, name) => sum + (value(c, name) ?? 0), 0))
        src.width = parts.map((name) => from(c, param(c, name))).filter((v): v is RoadEngSource => !!v)
        if (built) {
          const widthP = param(c, built.width.parameter)
          if (widthP && !widthP.calculated) src.width = [from(c, widthP)!]
          else if (!src.width.length) src.width = enteredSumOf(c, widthP).map((p) => from(c, p)!)
        }
        const follows = laneP?.featureIndex ?? null
        if (laneP && follows !== null)
          once(
            notes,
            `${label}: RoadEng runs the ${c.name} lane width along reference feature ${follows + 1}; its stated ${fmt(laneP.value)} m is used as a fixed width.`,
          )
        for (const [name, title] of LAYER_ORDER) {
          const p = param(c, name)
          if (p && !p.calculated) (src.layers ??= {})[name.toLowerCase()] = from(c, p)!
          // A course's side slope: its edges run out and down from the course above (`sectionStructures.ts`).
          const slopeP = param(c, ...(LAYER_SLOPES[name] ?? []))
          if (slopeP && !slopeP.calculated) (src.layerSlopes ??= {})[name.toLowerCase()] = from(c, slopeP)!
          const sideSlope =
            slopeP && !slopeP.calculated && slopeP.raw !== 0 && Math.abs(slopeP.raw) < ROADENG_VERTICAL
              ? r6(Math.min(STRUCTURE_LIMITS.courseSideSlope[1], 1 / Math.abs(slopeP.raw)))
              : undefined
          // Listed from the subgrade up, as PGMaps' course stack is: each course goes under the ones read.
          if (p && !p.calculated && p.value > 0)
            s.layers.unshift({
              key: name.toLowerCase(),
              name: title,
              depthM: r6(p.value),
              ...(sideSlope ? { sideSlope } : {}),
            })
        }
        const shoulder = WIDTH_PARTS.slice(1)
          .concat(SIDE_WIDTH_PARTS[side].slice(1))
          .reduce((sum, name) => sum + (value(c, name) ?? 0), 0)
        if (shoulder > 0)
          once(
            unmapped,
            `${label}: the ${fmt(shoulder)} m shoulder's own slope and thickness; it is taken as part of the road width at the road's crossfall.`,
          )
        if (built) roadwaySaid[side] = roadwayFromConstruction(c, built, s)
        else {
          const flare = s.layers.reduce((sum, l) => sum + l.depthM * (l.sideSlope ?? 0), 0)
          if (flare > 0) {
            // RoadEng's lane width is the running surface; its courses spread out and down to the subgrade.
            once(
              notes,
              `${label}: the courses' side slopes (${s.layers
                .filter((l) => l.sideSlope)
                .map((l) => `${l.name} ${fmt(l.sideSlope!)}:1`)
                .join(
                  ', ',
                )}) spread the subgrade ${fmt(flare)} m past the running surface on the ${side}; the subgrade edge is the road's formation edge, where the ditch and batters start.`,
            )
            s.width = r6(s.width + flare)
          }
        }
        // A sub-cut the roadway builds under its own subgrade becomes the side's sub-cut.
        const cut = built?.subCut
        if (cut && s.subCut === null) {
          const L = STRUCTURE_LIMITS
          if (
            cut.depthM >= L.subCutDepthM[0] &&
            cut.depthM <= L.subCutDepthM[1] &&
            cut.widthM <= L.subCutWidthM[1] &&
            cut.outsideSlope <= L.subCutOutsideSlope[1]
          ) {
            s.subCut = {
              id: `roadeng-${safeId(t.code)}-subcut-roadway`,
              name: `${c.name} ${cut.fragment}`,
              reference: 'subgrade',
              depthM: r6(cut.depthM),
              widthM: r6(cut.widthM),
              ...(cut.outsideSlope > 0 ? { outsideSlope: r6(cut.outsideSlope) } : {}),
            }
            const widthP = cut.widthParameter ? param(c, cut.widthParameter) : undefined
            src.subCut = widthP && !widthP.calculated ? { width: from(c, widthP) } : {}
            once(
              notes,
              `${label}: ${c.name} builds a sub-cut under its subgrade (${cut.fragment}): ${fmt(cut.depthM)} m deep, out to ${fmt(cut.widthM)} m from the centreline, its outside face ${cut.outsideSlope > 0 ? `${fmt(cut.outsideSlope)}:1` : 'vertical'}; it is dug and refilled under the road.`,
            )
          } else
            once(
              unmapped,
              `${label}: ${c.name}'s sub-cut under its subgrade (${cut.fragment}, ${fmt(cut.depthM)} m deep, ${fmt(cut.widthM)} m wide) is past PGMaps' sub-cut limits.`,
            )
        }
        for (const name of built?.deeperSurfaces ?? [])
          once(
            unmapped,
            `${label}: ${c.name}'s ${name} surface below its subgrade; it does not run out level and close back up as a sub-cut does.`,
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
          s.cutAuto = !!param(c, 'FINALCUTSLP')?.auto
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
        // Slope VI – Benches: faces BenchHeight high at BenchSlope, benches BenchBaseWidth wide.
        // Slope VI makes up to MaxNumberBenches (the library's: at most 6), and never more than its
        // construction draws: one `Cut Slope` or `Fill Slope` fragment per bench. Softree's Road6
        // tutorial designs (V9 and V10, LOWV) hold an older version with five cut fragments and four
        // fill fragments and no MaxNumberBenches. A count, not a length: its stored value, whatever
        // the design's units.
        const most = param(c, 'MAXNUMBERBENCHES')?.raw
        const drawn = (kind: 'cut' | 'fill') =>
          (c.fragments ?? []).filter(
            (f) => f.side === side && new RegExp(`^${kind === 'cut' ? 'Cut' : 'Fill'} Slope`, 'i').test(f.name),
          ).length
        const countOf = (kind: 'cut' | 'fill') => {
          let n = most !== undefined && Number.isFinite(most) ? Math.round(most) : DEFAULT_BENCH_COUNT
          if (drawn(kind) > 0) n = Math.min(n, drawn(kind))
          return Math.max(STRUCTURE_LIMITS.benchCount[0], Math.min(STRUCTURE_LIMITS.benchCount[1], n))
        }
        const benches = param(c, 'BENCHHEIGHT') && param(c, 'BENCHBASEWIDTH')
        const sourcesOf = {
          height: from(c, param(c, 'BENCHHEIGHT')),
          width: from(c, param(c, 'BENCHBASEWIDTH')),
          face: from(c, param(c, 'BENCHSLOPE')),
          fall: from(c, param(c, 'BENCHBASESLOPE')),
        }
        for (const kind of ['cut', 'fill'] as const) {
          const bench = benches ? benchOf(c, countOf(kind)) : null
          if (!bench || !(kind === 'cut' ? inCut : inFill) || s.benches[kind]) continue
          s.benches[kind] = bench
          ;(src.benches ??= {})[kind] = sourcesOf
          once(
            notes,
            `${label}: ${c.name} benches the ${kind} batter: ${fmt(bench.heightM)} m faces${bench.faceSlope ? ` at ${fmt(bench.faceSlope)}:1` : ''} and ${fmt(bench.widthM)} m benches, up to ${bench.count}, then the closing slope to ground.`,
          )
        }
        if (inCut && s.cutSlope === null && cut !== null) {
          s.cutSlope = cut
          s.cutAuto = !!param(c, 'FINALCUTSLP')?.auto
          src.cutSlope = from(c, param(c, 'FINALCUTSLP'))
        }
        if (inFill && s.fillSlope === null && fill !== null) {
          s.fillSlope = fill
          s.fillAuto = !!param(c, 'FINALFILLSLP')?.auto
          src.fillSlope = from(c, param(c, 'FINALFILLSLP'))
        }
      } else if (finalSide) {
        used.add(c)
        const both = toHv(finalSide.value)
        if (both !== null) {
          if (s.cutSlope === null && s.fillSlope === null) src.sharedSlope = true
          if (s.cutSlope === null) {
            s.cutSlope = both
            s.cutAuto = !!finalSide.auto
            src.cutSlope = from(c, finalSide)
          }
          if (s.fillSlope === null) {
            s.fillSlope = both
            s.fillAuto = !!finalSide.auto
            src.fillSlope = from(c, finalSide)
          }
        }
      }
      // Structures: benches by height, walls, barriers and sub-cuts (`sectionStructures.ts`).
      if (
        structureFrom(
          c,
          side,
          s,
          src,
          from,
          label,
          t.code,
          (list, text) => once(list === 'notes' ? notes : unmapped, text),
          t.unitM ?? 1,
        )
      )
        used.add(c)
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
        const autoDitch = [param(c, 'DITCHINSLP', 'DITCHSLP', pick('DITCHSLPL', 'DITCHSLPR')), back].filter(
          (p) => p?.auto,
        )
        if (autoDitch.length)
          once(
            unmapped,
            `${label}: ${c.name}'s ${autoDitch.map((p) => p!.name).join(' and ')} on AUTO, which RoadEng takes from the ground type; the stated ${autoDitch.map((p) => `${hv(p!.raw)}:1`).join(' and ')} is used, because PGMaps' ditch slopes are the template's.`,
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
        s.cutAuto = false
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
  // The roadway's construction, said once where both sides are built alike.
  const sameRoadway = roadwaySaid.left && roadwaySaid.right && roadwaySaid.left.key === roadwaySaid.right.key
  for (const side of sameRoadway ? (['left'] as const) : (['left', 'right'] as const)) {
    const said = roadwaySaid[side]
    if (!said) continue
    const where = sameRoadway ? 'on each side' : `on the ${side}`
    for (const text of said.notes) once(notes, `${label}: ${text(where)}`)
    for (const text of said.unmapped) once(unmapped, `${label}: ${text(where)}`)
  }
  for (const c of t.components)
    if (!used.has(c))
      once(unmapped, `${label}: component ${c.name} (${c.className}, ${c.side}) is not one PGMaps' section can draw.`)

  const usedFallback: string[] = []
  // Each batter's AUTO, from wherever `take` finds its slope (the road's current section's: stated).
  const auto = { left: { cut: false, fill: false }, right: { cut: false, fill: false } }
  const autoOf = (side: 'left' | 'right', what: 'width' | 'cutSlope' | 'fillSlope') => {
    if (what === 'width') return
    const kind = what === 'cutSlope' ? 'cut' : 'fill'
    const flag = what === 'cutSlope' ? 'cutAuto' : 'fillAuto'
    const own = sides[side],
      other = sides[side === 'left' ? 'right' : 'left']
    auto[side][kind] = own[what] !== null ? own[flag] : other[what] !== null ? other[flag] : false
  }
  const take = (side: 'left' | 'right', what: 'width' | 'cutSlope' | 'fillSlope'): number => {
    autoOf(side, what)
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
    if (!d || d.depth <= 0)
      return { width: 0, depth: 0, bottom: 0 } as { width: number; depth: number; bottom: number; inslope?: number }
    const back = d.backslope ?? (per[side].cut > 0 ? 1 / per[side].cut : d.inslope)
    if (d.backslope === null)
      ditchSaid[side].notes.push(`ditch's backslope is RoadEng's cut slope (${fmt(per[side].cut)}:1).`)
    const width = r6(d.bottom + d.depth / d.inslope + d.depth / back)
    // A ditch whose inslope and backslope differ keeps both (`ditchInslope`).
    const inslope = Math.abs(d.inslope - back) > 1e-9 ? r6(1 / d.inslope) : undefined
    if (inslope !== undefined)
      ditchSaid[side].notes.push(`ditch keeps its ${hv(d.inslope)}:1 inslope and ${hv(back)}:1 backslope.`)
    if (width > MAX_DITCH_WIDTH_M || d.depth > MAX_DITCH_DEPTH_M) {
      ditchSaid[side].unmapped.push(
        `ditch (${fmt(width)} m wide, ${fmt(d.depth)} m deep) is past PGMaps' ${MAX_DITCH_WIDTH_M} m by ${MAX_DITCH_DEPTH_M} m ditch; it is left out.`,
      )
      return { width: 0, depth: 0, bottom: 0 }
    }
    if (inslope !== undefined && inslope > STRUCTURE_LIMITS.ditchInslope[1]) {
      ditchSaid[side].unmapped.push(
        `ditch's ${fmt(inslope)}:1 inslope is past PGMaps' ${STRUCTURE_LIMITS.ditchInslope[1]}:1; it is left out.`,
      )
      return { width: 0, depth: 0, bottom: 0 }
    }
    return {
      width,
      depth: r6(d.depth),
      bottom: r6(Math.min(d.bottom, width)),
      ...(inslope !== undefined ? { inslope } : {}),
    }
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
  // RoadEng's AUTO slopes take the ground types' slopes; every other slope is the template's own.
  for (const [kind, Kind] of [
    ['cut', 'Cut'],
    ['fill', 'Fill'],
  ] as const) {
    const source = (side: 'left' | 'right') => (auto[side][kind] ? 'material' : 'template') as BatterSource
    if (source('left') === source('right')) template[`${kind}SlopeFrom`] = source('left')
    else {
      template[`left${Kind}SlopeFrom`] = source('left')
      template[`right${Kind}SlopeFrom`] = source('right')
    }
  }
  const autoSides = (['left', 'right'] as const).flatMap((side) =>
    (['cut', 'fill'] as const).filter((kind) => auto[side][kind]).map((kind) => `${side} ${kind}`),
  )
  if (autoSides.length)
    notes.push(
      `${label}: the ${autoSides.join(', ')} slope${autoSides.length === 1 ? ' is' : 's are'} AUTO in RoadEng, so ${autoSides.length === 1 ? 'it takes' : 'they take'} the ground types' slopes: in cut each stratum layer's ground type, bending where the cut crosses a layer; in fill the range's fill material, else stratum layer 1's ground type. Where no ground type is given, the stated slope applies.`,
    )
  if (per.right.cut !== per.left.cut) template.rightCutSlope = per.right.cut
  if (per.right.fill !== per.left.fill) template.rightFillSlope = per.right.fill
  if (ditch.right.width !== ditch.left.width) template.rightDitchWidth = ditch.right.width
  if (ditch.right.depth !== ditch.left.depth) template.rightDitchDepth = ditch.right.depth
  if (ditch.right.bottom !== ditch.left.bottom) template.rightDitchBottomWidth = ditch.right.bottom
  if (ditch.left.inslope !== undefined) template.ditchInslope = ditch.left.inslope
  if (ditch.right.inslope !== ditch.left.inslope) {
    if (ditch.right.inslope === undefined) {
      // The right ditch's slopes match: its own inslope is half what the bottom leaves.
      if (ditch.right.depth > 0)
        template.rightDitchInslope = r6((ditch.right.width - ditch.right.bottom) / 2 / ditch.right.depth)
    } else template.rightDitchInslope = ditch.right.inslope
  }
  // Benches, walls, barriers and sub-cuts, side by side.
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const benchOn = (side: 'left' | 'right') =>
    Object.keys(sides[side].benches).length ? sides[side].benches : undefined
  if (same(benchOn('left'), benchOn('right'))) {
    if (benchOn('left')) template.benches = benchOn('left')
  } else {
    if (benchOn('left')) template.leftBenches = benchOn('left')
    if (benchOn('right')) template.rightBenches = benchOn('right')
  }
  // A fill wall whose face RoadEng places from the centreline stands that far past the formation edge.
  for (const side of ['left', 'right'] as const)
    for (const w of sides[side].walls) {
      const face = sides[side].wallFaces.get(w.id)
      if (face === undefined) continue
      const setback = r6(face - template[`${side}Width`])
      if (setback > 1e-6) w.setbackM = Math.min(STRUCTURE_LIMITS.wallSetbackM[1], setback)
      else if (setback < -1e-6)
        notes.push(
          `${label}: ${w.name}'s face stands inside the ${side} formation edge in RoadEng; it is placed at the edge.`,
        )
    }
  const walls = [...sides.left.walls, ...sides.right.walls]
  if (walls.length) template.walls = walls.slice(0, 8)
  const barriers = [...sides.left.barriers, ...sides.right.barriers]
  if (barriers.length) template.barriers = barriers.slice(0, 8)
  const subLeft = sides.left.subCut,
    subRight = sides.right.subCut
  if (subLeft && subRight && same(subLeft, subRight)) template.subCut = subLeft
  else {
    if (subLeft) template.leftSubCut = subLeft
    if (subRight) template.rightSubCut = subRight
  }
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

/** The entered lengths a calculated width adds up (`ROAD_WIDTHL = ACP_WIDTHL+SHOULDER_WIDTHL`); none for any other formula. */
function enteredSumOf(c: RoadEngComponent, p: RoadEngParameter | undefined): RoadEngParameter[] {
  if (!p?.formula || !/^\s*[A-Za-z_]\w*(\s*\+\s*[A-Za-z_]\w*)*\s*$/.test(p.formula)) return []
  const parts = p.formula.split('+').map((name) => param(c, name.trim()))
  return parts.every((x) => x && !x.calculated && x.kind === 'length') ? (parts as RoadEngParameter[]) : []
}

/** Notes worded for one side (`where`: "on the left", "on each side"), and a key to tell two sides apart. */
interface SidedNotes {
  key: string
  notes: ((where: string) => string)[]
  unmapped: ((where: string) => string)[]
}

/**
 * One side of a roadway from its construction: the subgrade edge as the formation width, and the
 * course thicknesses at the centreline as the gaps between its layer surfaces, so the courses add up
 * to the subgrade's depth below RoadEng's profile. Courses RoadEng puts above its profile (Resource
 * I's surfacing on a profile at the subgrade) are not drawn: PGMaps' profile is the subgrade too.
 */
function roadwayFromConstruction(c: RoadEngComponent, b: RoadEngRoadwayConstruction, s: SideSection): SidedNotes {
  const out: SidedNotes = { key: '', notes: [], unmapped: [] }
  s.width = r6(b.subgradeEdgeM)
  const named = [...s.layers].reverse()
  const depth = b.subgradeDepthM
  const changed: string[] = []
  if (depth <= 1e-9) {
    if (named.length) {
      const list = named.map((l) => `${fmt(l.depthM, 3)} m ${l.name.toLowerCase()}`).join(', ')
      out.notes.push(
        (where) =>
          `${c.name} puts its ${list} above RoadEng's profile ${where}, which is the subgrade, as PGMaps' profile is; the courses are not drawn and the profile is not lowered.`,
      )
    }
    s.layers = []
  } else {
    const surfaces = b.surfaceDepthsM.filter((d) => d >= -1e-9 && d <= depth + 1e-9)
    if (!(surfaces[0] <= 1e-9)) surfaces.unshift(0)
    const gaps = surfaces
      .slice(1)
      .map((d, i) => r6(d - surfaces[i]))
      .filter((g) => g > 1e-9)
    const sum = named.reduce((total, l) => total + l.depthM, 0)
    if (gaps.length === named.length && gaps.length)
      named.forEach((l, i) => {
        if (Math.abs(l.depthM - gaps[i]) > 1e-6) {
          const was = l.depthM
          changed.push(`${l.key}:${gaps[i]}`)
          out.notes.push(
            (where) =>
              `the ${l.name.toLowerCase()} is ${fmt(gaps[i], 3)} m thick at the centreline ${where}, between the surfaces ${c.name} builds; its ${fmt(was, 3)} m thickness includes the course set into it.`,
          )
        }
        l.depthM = gaps[i]
      })
    else if (Math.abs(sum - depth) > 1e-6)
      out.unmapped.push(
        (where) =>
          `${c.name} puts the subgrade ${fmt(depth, 3)} m below RoadEng's profile ${where}; PGMaps' courses add up to ${fmt(sum, 3)} m, which is used.`,
      )
    // What the construction adds past the courses' own runs (Rural I's S_THICK_ADJ1: the pavement
    // and the shoulder's own fall) goes on a top course with no slope of its own, so the courses
    // narrow back to RoadEng's running surface.
    const top = named[0]
    const residual = b.subgradeEdgeM - b.width.valueM - named.reduce((t, l) => t + l.depthM * (l.sideSlope ?? 0), 0)
    if (top && top.sideSlope === undefined && top.depthM > 1e-9 && residual > 1e-6) {
      const slope = r6(Math.min(STRUCTURE_LIMITS.courseSideSlope[1], residual / top.depthM))
      top.sideSlope = slope
      changed.push(`${top.key}~${slope}`)
      out.notes.push(
        (where) =>
          `the ${top.name.toLowerCase()}'s edges slope ${fmt(slope)}:1 ${where}, taking the ${fmt(residual, 3)} m ${c.name} adds past the courses' own slopes, so the running surface is RoadEng's ${fmt(b.width.valueM, 3)} m.`,
      )
    }
  }
  const runs = b.runs.filter((r) => r.runM > 1e-9)
  const sumText = `${b.width.parameter} ${fmt(b.width.valueM, 3)} m${runs.map((r) => ` + ${r.thickness} ÷ ${r.slope} ${fmt(r.runM, 3)} m`).join('')}`
  out.notes.push(
    (where) =>
      `the subgrade edge, where the ditch and the batters start, is ${fmt(b.subgradeEdgeM, 3)} m from the centreline ${where}, as ${c.name} builds it: ${sumText}.`,
  )
  if (b.stored.length)
    out.notes.push(
      () =>
        `${b.stored.join(', ')} in ${c.name} keep the value stored in the design; their expressions use values RoadEng has only while it builds a section.`,
    )
  out.key = JSON.stringify([c.name, b.subgradeEdgeM, depth, sumText, changed, b.stored, named.length])
  return out
}

function blankSide(): SideSection {
  return {
    width: null,
    layers: [],
    crossfallPercent: null,
    cutSlope: null,
    fillSlope: null,
    cutAuto: false,
    fillAuto: false,
    ditch: null,
    rockCut: null,
    roadwayKind: null,
    components: [],
    benches: {},
    walls: [],
    wallFaces: new Map(),
    barriers: [],
    subCut: null,
  }
}

/**
 * A benched batter from Slope VI (`BenchHeight`, `BenchBaseWidth`, `BenchSlope`, `BenchBaseSlope`)
 * or a bench by height (`MaxCutHeight`/`FillHeight`, `BenchWidth`, `CutSlope`/`FillSlope1`,
 * `BenchSlope`). RoadEng's bench slope is positive downward, which is PGMaps' fall away from the
 * road. Null where its values are past PGMaps' limits.
 */
function benchOf(c: RoadEngComponent, count: number): BenchedSlope | null {
  const L = STRUCTURE_LIMITS
  const heightM = value(c, 'BENCHHEIGHT', 'MAXCUTHEIGHT', 'FILLHEIGHT') ?? 0,
    widthM = value(c, 'BENCHBASEWIDTH', 'BENCHWIDTH') ?? 0
  const slopeVI = !!param(c, 'BENCHBASEWIDTH')
  const face = toHv(slopeVI ? value(c, 'BENCHSLOPE') : value(c, 'CUTSLOPE', 'FILLSLOPE1'))
  const benchSlope = slopeVI ? value(c, 'BENCHBASESLOPE') : value(c, 'BENCHSLOPE')
  if (!(heightM >= L.benchHeightM[0] && heightM <= L.benchHeightM[1]) || !(widthM >= 0 && widthM <= L.benchWidthM[1]))
    return null
  const fall = r6(100 * (benchSlope ?? 0))
  return {
    heightM: r6(heightM),
    widthM: r6(widthM),
    ...(face !== null ? { faceSlope: face } : {}),
    ...(fall && Math.abs(fall) <= L.benchFallPercent[1] ? { benchFallPercent: fall } : {}),
    count,
  }
}

const isClass = (c: RoadEngComponent, ...names: string[]) =>
  names.some((n) => c.className.toUpperCase().replace(/\s+/g, '') === n)

/**
 * RoadEng's walls, barriers, sub-cuts and benches by height as PGMaps' section structures, for one
 * side; true when the component was one of them. Which parameter means what is read from Softree's
 * native component library (`WebTemplateComponents.tpl`: each definition's parameters, expressions
 * and fragments; none of the sample designs' roads uses one):
 *
 * - Wall I SG Fill Wall (`WallOffsetX`, `WallTopWidth`, `WallOutsideSlope`, `bHasFlatBase`,
 *   `WallBaseCutDepth`) → a fill wall whose face stands `WallOffsetX + WallTopWidth` from the
 *   centreline, `WallTopWidth` thick, embedded `WallBaseCutDepth` on a flat base, its top
 *   `WallCoverHt` below the formation edge where `bWallIncludeSG` puts subgrade fill over it.
 * - Wall II Gabion Fill Wall (`BlockWidth`, `BlockHeight`, `BlockOffset`, `WallOffsetX`) → a fill wall
 *   one block thick whose face steps `BlockOffset` per block.
 * - Wall III Gabion Cut Wall (`WallSetback`, `BlockWidth`, `BlockHeight`, and `WallSlope` in the
 *   library or `BlockOverlapPct` in older versions) → a cut wall one block thick, its face stepping
 *   `BlockHeight ÷ WallSlope` (or `BlockWidth × (1 − overlap)`) per block.
 * - Wall IV Retaining Wall (`WallThick`, `WallHeight`) → a vertical cut wall, its backfill dug
 *   `WallBFillOffset` (`WallHeight × WallFactor`) from its heel, up `WallBackSlope`, refilled to the
 *   cut (`bBackFillToTopo`) or at `WallBackfillSlope` from its top.
 * - Barrier I–III (`BarrierCL_Offset`/`POST_OFFSET`/`CL_OFFSET`, post and rail or base sizes).
 * - SubCut I (`SCS`, into the merged surface) and SubCut II (`SC`, below subgrade): `SubCutDepth`,
 *   `SubCutWidthL/R`, `SubCutSlopeOut` and `SubCutSlopeIn` (≥ 9000 vertical), the bottom at
 *   `SubCutBotSlope` plus the crossfall where `bApplySuper` is on.
 * - Bench by Cut Height / Bench by Fill Height: one bench where the cut or fill passes the height.
 */
function structureFrom(
  c: RoadEngComponent,
  side: 'left' | 'right',
  s: SideSection,
  src: RoadEngSideSources,
  from: (c: RoadEngComponent, p: RoadEngParameter | undefined) => RoadEngSource | undefined,
  label: string,
  code: string,
  say: (list: 'notes' | 'unmapped', text: string) => void,
  unitM = 1,
): boolean {
  const L = STRUCTURE_LIMITS
  const id = `roadeng-${safeId(code)}-${side}-${c.index}`
  const within = (v: number | undefined, [low, high]: readonly [number, number]) =>
    v !== undefined && Number.isFinite(v) && v >= low && v <= high
  const clampTo = (v: number, [low, high]: readonly [number, number]) => r6(Math.max(low, Math.min(high, v)))
  // Benches by height.
  if (param(c, 'MAXCUTHEIGHT') && param(c, 'BENCHWIDTH')) {
    const bench = benchOf(c, 1)
    if (bench && !s.benches.cut) {
      s.benches.cut = bench
      ;(src.benches ??= {}).cut = {
        height: from(c, param(c, 'MAXCUTHEIGHT')),
        width: from(c, param(c, 'BENCHWIDTH')),
        face: from(c, param(c, 'CUTSLOPE')),
        fall: from(c, param(c, 'BENCHSLOPE')),
      }
      say(
        'notes',
        `${label}: ${c.name} puts one ${fmt(bench.widthM)} m bench in a cut higher than ${fmt(bench.heightM)} m.`,
      )
      // Its cut slope is the slope above the bench too.
      if (bench.faceSlope !== undefined && s.cutSlope === null) {
        s.cutSlope = bench.faceSlope
        src.cutSlope = from(c, param(c, 'CUTSLOPE'))
      }
    }
    return true
  }
  if (param(c, 'FILLHEIGHT') && param(c, 'BENCHWIDTH') && param(c, 'FILLSLOPE1')) {
    const bench = benchOf(c, 1)
    if (bench && !s.benches.fill) {
      s.benches.fill = bench
      ;(src.benches ??= {}).fill = {
        height: from(c, param(c, 'FILLHEIGHT')),
        width: from(c, param(c, 'BENCHWIDTH')),
        face: from(c, param(c, 'FILLSLOPE1')),
        fall: from(c, param(c, 'BENCHSLOPE')),
      }
      const closing = toHv(value(c, 'FILLSLOPE2'))
      if (closing !== null && s.fillSlope === null) {
        s.fillSlope = closing
        src.fillSlope = from(c, param(c, 'FILLSLOPE2'))
      }
      if ((value(c, 'MINFILLHEIGHT') ?? 0) > 0)
        say(
          'unmapped',
          `${label}: ${c.name}'s ${fmt(value(c, 'MINFILLHEIGHT')!)} m least fill height; the bench applies in any fill past its height.`,
        )
    }
    return true
  }
  // Walls.
  if (param(c, 'WALLTOPWIDTH') && param(c, 'WALLOFFSETX')) {
    const thick = value(c, 'WALLTOPWIDTH')!,
      faceSlope = toHv(value(c, 'WALLOUTSIDESLOPE'))
    const wall: SectionWall = {
      id,
      name: c.name,
      side,
      kind: 'fill',
      heightM: L.wallHeightM[1],
      thicknessM: clampTo(thick, L.wallThicknessM),
      ...(faceSlope !== null && faceSlope <= L.wallFaceSlope[1] ? { faceSlope } : {}),
      ...((value(c, 'BHASFLATBASE') ?? 1) !== 0 && within(value(c, 'WALLBASECUTDEPTH'), L.wallEmbedM)
        ? { embedM: r6(value(c, 'WALLBASECUTDEPTH')!) }
        : {}),
      // Wall I's subgrade fill over the wall: `WallCoverHt` under `bWallIncludeSG`.
      ...((value(c, 'BWALLINCLUDESG') ?? 0) !== 0 && within(value(c, 'WALLCOVERHT'), L.wallCoverHeightM)
        ? { coverHeightM: r6(value(c, 'WALLCOVERHT')!) }
        : {}),
    }
    const faceOffset = (value(c, 'WALLOFFSETX') ?? 0) + thick
    s.walls.push(wall)
    s.wallFaces.set(id, faceOffset)
    ;(src.walls ??= {})[id] = {
      thickness: from(c, param(c, 'WALLTOPWIDTH')),
      face: from(c, param(c, 'WALLOUTSIDESLOPE')),
      setback: from(c, param(c, 'WALLOFFSETX')),
      ...(wall.coverHeightM !== undefined ? { cover: from(c, param(c, 'WALLCOVERHT')) } : {}),
    }
    say(
      'notes',
      `${label}: ${c.name} becomes a ${fmt(wall.thicknessM)} m fill wall on the ${side} whose face stands ${fmt(faceOffset)} m from the centreline, down to the ground${wall.coverHeightM ? `, its top ${fmt(wall.coverHeightM)} m below the formation edge under the road's fill` : ''}.`,
    )
    if (wall.coverHeightM && (value(c, 'WALLCOVERWIDTH') ?? 0) > 0)
      say(
        'unmapped',
        `${label}: ${c.name}'s cover runs ${fmt(value(c, 'WALLCOVERWIDTH')!)} m out from the wall at its ${hv(value(c, 'WALLCOVERFILLSLOPE') ?? 1)}:1 fill slope; PGMaps keeps the fill face at the wall's face.`,
      )
    if ((value(c, 'BWALLBASEBACKFILL') ?? 0) !== 0)
      say(
        'unmapped',
        `${label}: ${c.name}'s backfill at its toe (${(value(c, 'BACKFILLSLOPE') ?? 0) === 0 ? 'level' : `${fmt(100 * value(c, 'BACKFILLSLOPE')!, 1)} %`}) and its MSE layers; they are not drawn.`,
      )
    return true
  }
  // A roadway that draws blocks is a bridge (the library's Bridge IV, RDWY: `BlockHeight`,
  // `BlockWidth` for the blocks under its deck; the V10 tutorials' BR5 template), never a wall.
  if (
    !isClass(c, 'RDWY') &&
    (isClass(c, 'GABION') ||
      (param(c, 'BLOCKWIDTH') &&
        param(c, 'BLOCKHEIGHT') &&
        (param(c, 'WALLSETBACK') || param(c, 'WALLOFFSETX') || param(c, 'BLOCKOFFSET'))))
  ) {
    const block = value(c, 'BLOCKWIDTH') ?? 0,
      height = value(c, 'BLOCKHEIGHT') ?? 0
    if (!(block > 0)) return true
    const cutWall = !!param(c, 'WALLSETBACK')
    // The library's Wall III steps each block back BlockHeight ÷ WallSlope (`STEP_WIDTH`); older
    // versions step it by BlockWidth less BlockOverlapPct.
    const wallSlope = cutWall ? value(c, 'WALLSLOPE') : undefined
    const step =
      wallSlope !== undefined
        ? Math.abs(wallSlope) >= ROADENG_VERTICAL || wallSlope === 0
          ? 0
          : height / Math.abs(wallSlope)
        : cutWall
          ? block * (1 - (value(c, 'BLOCKOVERLAPPCT') ?? 0) / 100)
          : (value(c, 'BLOCKOFFSET') ?? 0)
    const faceSlope = height > 0 ? r6(step / height) : 0
    const wall: SectionWall = {
      id,
      name: c.name,
      side,
      kind: cutWall ? 'cut' : 'fill',
      heightM: L.wallHeightM[1],
      thicknessM: clampTo(block, L.wallThicknessM),
      ...(faceSlope > 0 && faceSlope <= L.wallFaceSlope[1] ? { faceSlope } : {}),
      ...(cutWall && within(value(c, 'WALLSETBACK'), L.wallSetbackM) ? { setbackM: r6(value(c, 'WALLSETBACK')!) } : {}),
    }
    s.walls.push(wall)
    if (!cutWall && param(c, 'WALLOFFSETX')) s.wallFaces.set(id, (value(c, 'WALLOFFSETX') ?? 0) + block)
    ;(src.walls ??= {})[id] = {
      thickness: from(c, param(c, 'BLOCKWIDTH')),
      ...(cutWall ? { setback: from(c, param(c, 'WALLSETBACK')) } : {}),
    }
    say(
      'notes',
      `${label}: ${c.name} becomes a ${cutWall ? 'cut' : 'fill'} wall on the ${side}, ${fmt(block)} m thick, its face battered ${fmt(faceSlope)}:1 for the ${fmt(height)} m blocks; it runs to the ground and is drawn as one body.`,
    )
    return true
  }
  if (param(c, 'WALLTHICK') && param(c, 'WALLHEIGHT')) {
    // Wall IV: the backfill dug behind it, level for WallBFillOffset (WallHeight × WallFactor), up at
    // WallBackSlope, refilled to the cut (bBackFillToTopo) or at WallBackfillSlope from its top.
    const values = roadEngParameterValues(c)
    const offset = param(c, 'WALLBFILLOFFSET'),
      offsetM = offset ? (values.get(offset.name.toUpperCase())?.expression ?? offset.raw) * unitM : null
    const backRaw = value(c, 'WALLBACKSLOPE')
    const baseSlope =
      backRaw === undefined || !Number.isFinite(backRaw) || Math.abs(backRaw) >= ROADENG_VERTICAL || backRaw === 0
        ? 0
        : r6(1 / Math.abs(backRaw))
    const toGround = (value(c, 'BBACKFILLTOTOPO') ?? 1) !== 0
    const topRaw = value(c, 'WALLBACKFILLSLOPE')
    const backfill =
      offsetM !== null && within(offsetM, L.wallBackfillOffsetM) && within(baseSlope, L.wallBackfillBaseSlope)
        ? {
            offsetM: r6(offsetM),
            baseSlope,
            toGround,
            ...(!toGround && topRaw !== undefined && within(100 * topRaw, L.wallBackfillTopSlopePercent)
              ? { topSlopePercent: r6(100 * topRaw) }
              : {}),
          }
        : undefined
    const wall: SectionWall = {
      id,
      name: c.name,
      side,
      kind: 'cut',
      heightM: clampTo(value(c, 'WALLHEIGHT')!, L.wallHeightM),
      thicknessM: clampTo(value(c, 'WALLTHICK')!, L.wallThicknessM),
      ...(backfill ? { backfill } : {}),
    }
    s.walls.push(wall)
    ;(src.walls ??= {})[id] = { height: from(c, param(c, 'WALLHEIGHT')), thickness: from(c, param(c, 'WALLTHICK')) }
    say(
      'notes',
      `${label}: ${c.name} becomes a ${fmt(wall.heightM)} m cut wall on the ${side}, ${fmt(wall.thicknessM)} m thick${
        backfill
          ? `; the ground behind it is dug ${fmt(backfill.offsetM)} m back from its heel, then up at ${backfill.baseSlope ? `${fmt(backfill.baseSlope)}:1` : 'a vertical face'}, and refilled ${backfill.toGround ? 'to the cut surface' : `to a ${fmt(backfill.topSlopePercent ?? 0, 1)} % slope from its top`}`
          : '; the backfill wedge behind it is not drawn'
      }.`,
    )
    return true
  }
  // Barriers.
  const offsetP = param(c, 'BARRIERCLOFFSET', 'POSTOFFSET', 'CLOFFSET')
  if (
    isClass(c, 'GUARDRAIL', 'BARRIER', 'RAILING') ||
    (offsetP && (param(c, 'POSTHEIGHT') || param(c, 'TOTALHEIGHT')))
  ) {
    if ((value(c, 'BINCLUDEBARRIER') ?? 1) === 0) return true
    const kind: SectionBarrier['kind'] = param(c, 'TOTALHEIGHT')
      ? 'concrete'
      : param(c, 'BASEOFFSET') || isClass(c, 'RAILING')
        ? 'railing'
        : 'guard-rail'
    // The offset is from the centreline, whatever its description says, unless the component draws
    // its posts from the road edge's point code. Softree's guard-rail article (GuardRail.dsnx,
    // "Overrides: Controlling a Guardrail") describes POST_OFFSET as "offset from edge of shoulder"
    // in its parameter list but as "the distance from C/L to the inside of the guardrail" in its
    // text, and its section at 36+50 (POST_OFFSET overridden from 17 at 36+15 to 16 at 36+99.5,
    // 16.6 there) draws the posts 16.7 ft either side of the centreline, inside the 22 ft shoulder
    // edge; that component draws from its attachment point (`-`). The Guard Rail in the V10
    // tutorials' BR5 bridge template draws its posts from `RE-`.
    const fromEdge = !!offsetP && (c.fragments ?? []).some((f) => f.side === side && /^RE-?$/i.test(f.attach))
    if (fromEdge && s.width === null) {
      say('unmapped', `${label}: ${c.name} on the ${side}: it stands from the road edge, and the section has none.`)
      return true
    }
    const offset = (offsetP?.value ?? 0) + (fromEdge ? (s.width ?? 0) : 0)
    const widthM =
      kind === 'concrete'
        ? (value(c, 'BASEWIDTH') ?? 0.6)
        : kind === 'railing'
          ? Math.max(value(c, 'BASEWIDTH') ?? 0, (value(c, 'POSTTHICKNESS') ?? 0.2) + (value(c, 'RAILTHICKNESS') ?? 0))
          : (value(c, 'POSTTHICKNESS') ?? 0.2) + (value(c, 'RAILTHICKNESS') ?? 0)
    const heightM =
      kind === 'concrete'
        ? (value(c, 'TOTALHEIGHT') ?? 0.8)
        : (value(c, 'POSTHEIGHT') ?? 0.8) + (kind === 'railing' ? (value(c, 'BASEHEIGHT') ?? 0) : 0)
    const barrier: SectionBarrier = {
      id,
      name: c.name,
      side,
      kind,
      offsetM: clampTo(offset, L.barrierOffsetM),
      widthM: clampTo(widthM, L.barrierWidthM),
      heightM: clampTo(heightM, L.barrierHeightM),
    }
    s.barriers.push(barrier)
    ;(src.barriers ??= {})[id] = {
      ...(fromEdge ? {} : { offset: from(c, offsetP) }),
      height: from(c, param(c, kind === 'concrete' ? 'TOTALHEIGHT' : 'POSTHEIGHT')),
      ...(kind === 'concrete' ? { width: from(c, param(c, 'BASEWIDTH')) } : {}),
    }
    say(
      'notes',
      `${label}: ${c.name} stands ${fmt(barrier.offsetM)} m from the centreline on the ${side}${fromEdge ? `, ${fmt(offsetP?.value ?? 0)} m past the road edge` : ''}, ${fmt(barrier.heightM)} m high; it is drawn and measured by length, with no earthwork.`,
    )
    return true
  }
  // Sub-cuts.
  if (param(c, 'SUBCUTDEPTH')) {
    const depth = value(c, 'SUBCUTDEPTH') ?? 0
    const widthP = param(c, side === 'left' ? 'SUBCUTWIDTHL' : 'SUBCUTWIDTHR')
    const width = widthP?.value ?? 0
    if (!(width > 0) || !within(depth, L.subCutDepthM)) return true
    const out = value(c, 'SUBCUTSLOPEOUT')
    const outsideSlope = out === undefined || Math.abs(out) >= ROADENG_VERTICAL || out === 0 ? 0 : r6(1 / Math.abs(out))
    // SubCut I/II: the bottom at SubCutBotSlope plus the crossfall where bApplySuper is on, reached
    // down SubCutSlopeIn (the library's 9999.99: vertical).
    const inRaw = value(c, 'SUBCUTSLOPEIN')
    const insideSlope =
      inRaw === undefined || Math.abs(inRaw) >= ROADENG_VERTICAL || inRaw === 0 ? undefined : r6(1 / Math.abs(inRaw))
    const botRaw = value(c, 'SUBCUTBOTSLOPE')
    const bottomSlopePercent = botRaw !== undefined && botRaw !== 0 ? r6(100 * botRaw) : undefined
    const followsCrossfall = param(c, 'BAPPLYSUPER') ? (value(c, 'BAPPLYSUPER') ?? 0) !== 0 : undefined
    s.subCut = {
      id: `roadeng-${safeId(code)}-subcut-${c.index}`,
      name: c.name,
      reference: isClass(c, 'SCS') ? 'merged' : 'subgrade',
      depthM: r6(depth),
      widthM: clampTo(width, L.subCutWidthM),
      ...(outsideSlope > 0 ? { outsideSlope: Math.min(L.subCutOutsideSlope[1], outsideSlope) } : {}),
      ...(bottomSlopePercent !== undefined && within(bottomSlopePercent, L.subCutBottomSlopePercent)
        ? { bottomSlopePercent }
        : {}),
      ...(followsCrossfall === false ? { followsCrossfall } : {}),
      ...(insideSlope !== undefined && within(insideSlope, L.subCutInsideSlope) ? { insideSlope } : {}),
    }
    src.subCut = {
      depth: from(c, param(c, 'SUBCUTDEPTH')),
      width: from(c, widthP),
      outside: from(c, param(c, 'SUBCUTSLOPEOUT')),
      bottom: from(c, param(c, 'SUBCUTBOTSLOPE')),
      inside: from(c, param(c, 'SUBCUTSLOPEIN')),
      follows: from(c, param(c, 'BAPPLYSUPER')),
    }
    say(
      'notes',
      `${label}: ${c.name} digs ${fmt(depth)} m below the ${s.subCut.reference === 'merged' ? 'lower of subgrade and ground' : 'subgrade'} out to ${fmt(width)} m on the ${side} and refills it.`,
    )
    if (s.subCut.bottomSlopePercent !== undefined || s.subCut.followsCrossfall === false || s.subCut.insideSlope)
      say(
        'notes',
        `${label}: ${c.name}'s bottom is straight from ${fmt(depth)} m below the centreline at ${fmt(s.subCut.bottomSlopePercent ?? 0, 1)} %${s.subCut.followsCrossfall === false ? '' : " plus the road's crossfall"}${s.subCut.insideSlope ? `, reached down a ${fmt(s.subCut.insideSlope)}:1 inside slope` : ''}.`,
      )
    if ((value(c, 'SUBCUTMAXDAYLIGHT') ?? 0) > 0)
      say('unmapped', `${label}: ${c.name}'s ${fmt(value(c, 'SUBCUTMAXDAYLIGHT')!)} m limit past its width.`)
    return true
  }
  return false
}
const clampWidth = (w: number) => Math.max(0.1, Math.min(50, w))
const sameRock = (a: RockCutTemplate, b: RockCutTemplate) =>
  a.cutSlope === b.cutSlope && a.ledgeWidthM === b.ledgeWidthM

function sectionLayers(left: SideSection['layers'], right: SideSection['layers']): SectionLayer[] | undefined {
  if (!left.length && !right.length) return undefined
  const same =
    left.length === right.length &&
    left.every((l, i) => l.key === right[i].key && l.depthM === right[i].depthM && l.sideSlope === right[i].sideSlope)
  const make = (l: SideSection['layers'][number], side: SectionLayer['side']): SectionLayer => ({
    id: side === 'both' ? `roadeng-${l.key}` : `roadeng-${l.key}-${side}`,
    name: l.name,
    side,
    depthM: Math.min(2, l.depthM),
    ...(l.sideSlope ? { sideSlope: l.sideSlope } : {}),
  })
  const layers = same
    ? left.map((l) => make(l, 'both'))
    : [...left.map((l) => make(l, 'left')), ...right.map((l) => make(l, 'right'))]
  // A stack is at most 5 m a side; keep courses from the top down until it is full.
  const kept: SectionLayer[] = []
  const depth = { left: 0, right: 0 }
  for (const l of [...layers].reverse()) {
    const sides = l.side === 'both' ? (['left', 'right'] as const) : ([l.side] as const)
    if (sides.some((s) => depth[s] + l.depthM > 5)) continue
    for (const s of sides) depth[s] += l.depthM
    kept.unshift(l)
  }
  return kept.slice(-20)
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
    : [
        {
          fromStation: null,
          toStation: null,
          leftTemplate: '',
          rightTemplate: '',
          ground: [],
          fillMaterial: '',
          raw: [],
        } satisfies RoadEngStationRange,
      ]
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
export const ROADENG_SIDE_FRICTION_TABLE = 1
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
    /** RoadEng's Auto widening on the inside ({@link ROADENG_AUTO_WIDENING_INSIDE_BIT}); null without a flag word. */
    autoInside: boolean | null
    /** RoadEng's Auto widening on the outside ({@link roadEngAutoWideningOutside}); null where the flag word does not say. */
    autoOutside: boolean | null
    /** The widening the curve keeps as its own (`CurveSettings`), by side; absent where the rule gives RoadEng's. */
    own: Pick<CurveSettings, 'insideWideningM' | 'outsideWideningM'> | null
  }[]
  unmapped: string[]
  notes: string[]
}

/**
 * RoadEng's `108` flag word (field 9) bit set on a curve whose inside widening RoadEng reads from its
 * widening table (the inside Auto box of the curve panel). Read from Softree's samples: every curve
 * with the bit (Location 18, RoadEng 11, 1521: seven curves whose inside widening is the table's
 * step value at their radius and deflection; LongRoad 5585/5587/5590: five) holds the table's value,
 * and every curve without it holds its own: the bluff road (113) 1 ft on five curves of a design
 * with no widening table, the cul-de-sac design (1393) 0 on three curves the table gives 2–2.5 m.
 * Softree's V10 and V11 tutorial packages and knowledge-base designs (1,700 curves in 150
 * designs, `roadEngHuntSamples.test.ts` under `ROADENG_HUNT`) hold the same: a curve's inside is the
 * table's value exactly where bit 7 is set: where the table gives widening, 287 curves with it set
 * hold the table's value and 72 with it clear hold their own; the V10 forest-road designs, which
 * have no table, hold 592 typed values with it clear.
 */
export const ROADENG_AUTO_WIDENING_INSIDE_BIT = 128
/**
 * The two `108` field 9 bits one of which is the outside Auto widening box: bit 12 (4096) set and
 * bit 5 (32) clear on every curve whose outside widening is the table's (LongRoad and its four V10
 * siblings, 5585/5587/5590), bit 12 clear and bit 5 set on every curve that keeps its own outside
 * value against a table that gives one (Location 18 and the V11 designs, 1521; the cul-de-sac,
 * 1393). No curve of Softree's 150 public designs has the two bits set together or clear together,
 * so which one RoadEng reads is not shown; the third candidate, bit 1, is the panel's Use Minimum
 * Radius (every curve with it holds e = e max, as the curve panel's help says). Read as Auto only
 * where the two agree. Never written: an edited outside widening goes back in fields 17/18 with both
 * bits as read, and the export says where RoadEng recalculates it (`roadEngOutsideAutoNote`).
 */
export const ROADENG_AUTO_WIDENING_OUTSIDE_BITS = { on: 4096, off: 32 } as const
/** A curve's stored widening this close to the rule's is the rule's, m (rounding in the file). */
const SAME_WIDENING_M = 0.0005

/** RoadEng's outside Auto widening from a `108` flag word; null where it is unreadable or its two bits disagree. */
export function roadEngAutoWideningOutside(flags: number | undefined): boolean | null {
  if (flags === undefined || !Number.isInteger(flags) || flags < 0) return null
  const on = (flags & ROADENG_AUTO_WIDENING_OUTSIDE_BITS.on) !== 0,
    off = (flags & ROADENG_AUTO_WIDENING_OUTSIDE_BITS.off) !== 0
  return on === off ? null : on
}

/** RoadEng's inside Auto widening from a `108` flag word; null without a readable one. */
export function roadEngAutoWideningInside(flags: number | undefined): boolean | null {
  return flags !== undefined && Number.isInteger(flags) && flags >= 0
    ? (flags & ROADENG_AUTO_WIDENING_INSIDE_BIT) !== 0
    : null
}

/**
 * A curve's own widening from its `108` record against what the road's rule gives it: a side keeps
 * its stored value where the rule gives another, and also where RoadEng's Auto widening on that
 * side is off and the rule follows a table or vehicle (RoadEng then keeps the typed value whatever
 * the curve's radius becomes). Null when the rule gives both stored values.
 */
export function roadEngCurveWidening(
  stored: { insideM: number; outsideM: number },
  rule: { insideM: number; outsideM: number },
  options: { autoInside: boolean | null; autoOutside?: boolean | null; ruleVaries: boolean },
): Pick<CurveSettings, 'insideWideningM' | 'outsideWideningM'> | null {
  const own: Pick<CurveSettings, 'insideWideningM' | 'outsideWideningM'> = {}
  const ok = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_CURVE_WIDENING_M
  const differs = (a: number, b: number) => !(Math.abs(a - b) <= SAME_WIDENING_M)
  if (
    ok(stored.insideM) &&
    (differs(stored.insideM, rule.insideM) || (options.autoInside === false && options.ruleVaries))
  )
    own.insideWideningM = r6(stored.insideM)
  if (
    ok(stored.outsideM) &&
    (differs(stored.outsideM, rule.outsideM) || (options.autoOutside === false && options.ruleVaries))
  )
    own.outsideWideningM = r6(stored.outsideM)
  return Object.keys(own).length ? own : null
}

/**
 * The design's curve widening as PGMaps' widening table and each curve's own widening. RoadEng
 * applies its widening only where a template has curve widening built in, and stores what each
 * curve got (`108` fields 17 and 18, inside and outside). The table is taken, on a side, only when
 * a curve carries that side's table value (Location 18 widens the inside only, LongRoad both); a
 * curve whose stored widening the table does not give (Auto off, a value typed in the curve panel,
 * or a design without a widening table, like the bluff road) keeps its own on that side
 * ({@link roadEngCurveWidening}), so PGMaps' figure is RoadEng's on every curve.
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
    autoInside: roadEngAutoWideningInside(Number(c.raw[9])),
    autoOutside: roadEngAutoWideningOutside(Number(c.raw[9])),
    own: null,
  }))
  const name = table
    ? (table.description.find((d) => d.trim() && d.trim() !== '#')?.trim() ?? `table ${table.index}`)
    : ''
  // A side takes the table where a curve carries that side's (non-zero) table value.
  const matches = (stored: number, tableM: number | null) =>
    tableM !== null && stored > 0 && Math.abs(stored - tableM) <= 0.005
  // The inside also where a curve has RoadEng's inside Auto widening on (its stored value may be stale).
  const insideFromTable =
    comparison.some((c) => matches(c.roadEngInsideM, c.tableM)) ||
    (widened.length > 0 && comparison.some((c) => c.autoInside === true))
  const outsideFromTable = comparison.some((c) => matches(c.roadEngOutsideM, c.tableM))
  let wideningTable: WideningRow[] | null = null
  if (table && !widened.length)
    unmapped.push(
      `RoadEng's widening table (${name}): none of the design's curves carries widening, so its templates have no curve widening built in and the table is not applied.`,
    )
  else if (table && (insideFromTable || outsideFromTable)) {
    const written = roadEngWideningRows(table, settings.unitM)
    if (!written) unmapped.push(`RoadEng's widening table (${name}): it does not fit PGMaps' 400-entry widening table.`)
    else {
      wideningTable = written.rows.map((row) => ({
        ...row,
        insideM: insideFromTable ? row.insideM : 0,
        outsideM: outsideFromTable ? row.outsideM : 0,
      }))
      const sides = insideFromTable && outsideFromTable ? 'both sides' : insideFromTable ? 'the inside' : 'the outside'
      const stepped = written.rows.length !== table.rows.length * table.speeds.length
      notes.push(
        stepped
          ? `Curve widening comes from RoadEng's widening table (${name}), on ${sides} of each curve as its curves carry it. RoadEng takes the row at or below a curve's radius and the column nearest its deflection; PGMaps interpolates, so each row and column is written twice, ${ROADENG_STEP_EPSILON} apart, to give the same steps.`
          : `Curve widening comes from RoadEng's widening table (${name}), on ${sides} of each curve; it is too large to write as steps in 400 entries, so PGMaps interpolates between its rows and columns where RoadEng steps.`,
      )
      if (written.heldRadius)
        notes.push(`The widening table's radii past 10,000 m are held at 10,000 m, PGMaps' largest.`)
      if (written.blankCells) notes.push(`Blank cells in the widening table are taken as no widening.`)
    }
  }
  const design: CurveDesign = {
    designSpeedKmh: 50,
    maxSuperelevationPercent: 0,
    sideFrictionFactor: 0,
    runoffLengthM: 0,
    wideningVehicleLengthM: null,
    ...(wideningTable ? { wideningTable } : {}),
  }
  for (const c of comparison) {
    const rule =
      c.deflectionDegrees === null
        ? { insideM: 0, outsideM: 0 }
        : (() => {
            const v = evaluateCurveCriteria(design, c.radiusM, c.deflectionDegrees)
            return { insideM: v.insideWideningM, outsideM: v.outsideWideningM }
          })()
    c.own = roadEngCurveWidening({ insideM: c.roadEngInsideM, outsideM: c.roadEngOutsideM }, rule, {
      autoInside: c.autoInside,
      // The outside varies with the table only where the table is applied on the outside.
      autoOutside: outsideFromTable ? c.autoOutside : null,
      ruleVaries: !!wideningTable,
    })
    c.pgmapsInsideM = r6(c.own?.insideWideningM ?? rule.insideM)
    c.pgmapsOutsideM = r6(c.own?.outsideWideningM ?? rule.outsideM)
  }
  const own = comparison.filter((c) => c.own)
  const typed = own.filter((c) => c.own!.insideWideningM !== undefined && c.autoInside !== true)
  const autoKept = own.filter((c) => c.own!.insideWideningM !== undefined && c.autoInside === true)
  const list = (items: typeof comparison) =>
    items
      .slice(0, 10)
      .map(
        (c) =>
          `PI ${c.pi} ${fmt(c.own?.insideWideningM ?? c.pgmapsInsideM!, 4)}/${fmt(c.own?.outsideWideningM ?? c.pgmapsOutsideM!, 4)} m`,
      )
      .join(', ') + (items.length > 10 ? ', …' : '')
  if (own.length)
    notes.push(
      `${plural(own.length, 'curve keeps its', 'curves keep their')} own widening, inside/outside (${list(own)})${typed.length ? `: ${plural(typed.length, 'curve has', 'curves have')} Auto widening off on the inside, a value typed in RoadEng's curve panel` : ''}${!table ? '; the design has no widening table' : ''}.`,
    )
  if (autoKept.length)
    notes.push(
      `${plural(autoKept.length, 'curve has', 'curves have')} Auto widening on with a stored value the table does not give at its radius and deflection here (${list(autoKept)}); the stored value is kept.`,
    )
  if (comparison.length && !own.length && wideningTable)
    notes.push(`Every curve's widening matches what RoadEng stored for it.`)
  return { wideningTable, comparison, unmapped, notes }
}

// ---- Superelevation --------------------------------------------------------------------------------

export interface RoadEngCurveDesignMapping {
  curveDesign: CurveDesign | null
  /**
   * Each curve's superelevation in RoadEng and as PGMaps calculates it with `curveDesign` and the
   * curve's own settings (`roadEngCurveSettings`), %, at RoadEng's radius; `from` says where PGMaps'
   * value comes from.
   */
  comparison: {
    pi: number
    radiusM: number
    designSpeedKmh: number
    roadEngPercent: number
    pgmapsPercent: number
    from?: 'formula' | 'table' | 'sideFriction' | 'minimumRadius' | 'stated'
  }[]
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
 * RoadEng's `108` flag word (field 9) bit set on a curve with Use Minimum Radius ticked in its curve
 * panel, which holds its superelevation at e max (Softree's help, "Horizontal Curves": with the box
 * ticked the superelevation is the maximum and cannot be edited). Read from Softree's files: the V10
 * RoadEng Civil tutorial ticks the box in chapter 14 and saves "Align stage 4" with it (1395, e
 * 0.06 = e max where the table gives 0.059); chapter 18 unticks it before stage 7 (1393, the table's
 * 0.059); all 124 curves with the bit among 1,690 in Softree's 116 sample and tutorial designs hold
 * e = e max. Never set to keep a typed e: RoadEng would force e max and may solve the radius or
 * speed again. Which bit is the superelevation's own Auto box is not known: no public sample has
 * it unticked with a typed e.
 */
export const ROADENG_MINIMUM_RADIUS_BIT = 2
/**
 * RoadEng's `108` flag word bit set where the curve's Auto superelevation comes from the
 * superelevation table ("Use table"), clear where it comes from the side friction method ("Use side
 * friction factor", e / e max = f / f max). Read from Softree's samples: the bluff road designs'
 * curves are the only ones without it (113) and hold the side friction method's e to twelve digits
 * (500 ft and 300 ft radius curves at 30 mph, e max 0.1, f max 0.16: 0.0462709009645 and
 * 0.0771181682741), where their own table gives 0.051 and 0.06; every curve with it holds its
 * table's value.
 */
export const ROADENG_TABLE_SUPERELEVATION_BIT = 256
/** Differences below these are rounding: a curve takes its own value only past them. */
const SAME_PERCENT = 1e-6
/** A new `108` record's e is written to six decimals (`roadEngExport.ts`), within 5 × 10⁻⁵ %. */
const WRITTEN_E_PERCENT = 1e-4
const SAME_M = 1e-6
const r9 = (v: number) => Math.round(v * 1e9) / 1e9

/** km/h per unit of a RoadEng table's speed headings: km/h in a metric design, mph in a foot design. */
export const roadEngSpeedUnitKmh = (unitM: number) => (unitM === 1 ? 1 : 1.609344)

/**
 * A RoadEng lookup table (radius in project units down, design speed across) as PGMaps' table in
 * metres and km/h, its body multiplied by `scale` (100 for superelevation as a percentage, the unit
 * for a runoff length).
 */
export function roadEngTableToPgmaps(
  table: RoadEngSuperelevationTable,
  unitM: number,
  scale: number,
): CurveLookupTable {
  const speed = roadEngSpeedUnitKmh(unitM)
  const columns = table.speeds.map((v, k) => ({ v, k })).filter((c) => Number.isFinite(c.v) && c.v > 0)
  const rows = table.rows.filter((r) => Number.isFinite(r.radius) && r.radius > 0)
  const seen = new Set<number>()
  return {
    ...(table.description.length ? { description: [...table.description] } : {}),
    speedsKmh: columns.map((c) => r9(c.v * speed)),
    rows: rows
      .map((r) => ({
        radiusM: r9(r.radius * unitM),
        values: columns.map((c) => {
          const v = r.e[c.k]
          return v === null || v === undefined || !Number.isFinite(v) || v < 0 ? null : r9(v * scale)
        }),
      }))
      .filter((r) => (seen.has(r.radiusM) ? false : (seen.add(r.radiusM), true))),
  }
}

/** PGMaps' table back in RoadEng's units: the inverse of {@link roadEngTableToPgmaps}. */
export function roadEngTableFromPgmaps(
  table: CurveLookupTable,
  index: number,
  unitM: number,
  scale: number,
  description: string[] = table.description ?? [],
): RoadEngSuperelevationTable {
  const speed = roadEngSpeedUnitKmh(unitM)
  const n = (v: number) => Number(v.toPrecision(12))
  return {
    index,
    description,
    speeds: table.speedsKmh.map((v) => n(v / speed)),
    rows: table.rows.map((row) => ({
      radius: n(row.radiusM / unitM),
      e: row.values.map((v) => (v === null ? null : n(v / scale))),
    })),
  }
}

/**
 * The old reading of a design's curves, kept so a project opened before table mode writes back as it
 * did: one rule for the road whose side friction is fitted to RoadEng's per-curve superelevation.
 * The speed and runoff used most, the largest e max, and the side friction that brings PGMaps' e
 * closest to RoadEng's at every curve; `comparison` gives both figures for each curve.
 */
export function roadEngFittedCurveDesignFor(settings: RoadEngSettings): RoadEngCurveDesignMapping {
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

/**
 * One curve's own settings from its `108` design, against the road's rule: the design speed, e max
 * and transition fraction where they differ from the road's, the runoff at each end where the rule
 * (its runoff table, or the road's one length) gives another, and the superelevation where the rule
 * gives another (RoadEng's Auto superelevation off, or a value set by hand), and the widening on
 * each side as {@link roadEngCurveWidening} keeps it. `tableRadiusScale` makes the tables read at
 * RoadEng's own radius. Undefined when the rule already gives every value.
 */
export function roadEngCurveSettings(
  design: CurveDesign,
  curve: RoadEngCurveFields,
  options: { gridRadiusM: number; modelRadiusM: number; deflectionDegrees?: number; spiralM?: number },
): CurveSettings | undefined {
  const settings: CurveSettings = {}
  if (curve.designSpeedMs !== undefined) {
    const speed = Math.round(curve.designSpeedMs * 3.6 * 1e6) / 1e6
    if (Math.abs(speed - design.designSpeedKmh) > TABLE_SPEED_SNAP_KMH && speed >= 1 && speed <= 150)
      settings.designSpeedKmh = speed
  }
  if (curve.emax !== undefined) {
    const emax = r9(100 * curve.emax)
    if (Math.abs(emax - design.maxSuperelevationPercent) > SAME_PERCENT && emax >= 0 && emax <= 20)
      settings.maxSuperelevationPercent = emax
  }
  if (curve.transitionFraction !== undefined) {
    const fraction = curve.transitionFraction
    if (Math.abs(fraction - (design.transitionFraction ?? 1)) > 1e-9 && fraction >= 0 && fraction <= 1)
      settings.transitionFraction = fraction
  }
  const scale = options.modelRadiusM > 0 ? options.gridRadiusM / options.modelRadiusM : 1
  const roadEngMethod = design.superelevationMode === 'table' || design.superelevationMode === 'sideFriction'
  if (roadEngMethod && Math.abs(scale - 1) > 1e-9 && scale > 0.5 && scale < 2) settings.tableRadiusScale = scale
  // The side friction method's f max is field 11: the curve's own where the road's gives another.
  if (design.superelevationMode === 'sideFriction' && curve.fLimit !== undefined && curve.fLimit >= 0) {
    const ruleLimit = evaluateCurveCriteria(
      design,
      options.modelRadiusM,
      options.deflectionDegrees ?? 0,
      settings,
    ).sideFrictionLimit
    if (curve.fLimit <= 1 && !(ruleLimit !== null && Math.abs(curve.fLimit - ruleLimit) <= 1e-9))
      settings.maxSideFriction = curve.fLimit
  }
  const resolved = evaluateCurveCriteria(design, options.modelRadiusM, options.deflectionDegrees ?? 0, settings)
  if (curve.e !== undefined) {
    const e = r9(100 * curve.e)
    // Use Minimum Radius (`ROADENG_MINIMUM_RADIUS_BIT`) holds the curve at its e max. With RoadEng's
    // method the table bit (`ROADENG_TABLE_SUPERELEVATION_BIT`) says which method the curve's Auto
    // uses: by the other than the road's, the curve keeps its e. Otherwise the curve keeps its e
    // where the rule gives another: typed with its superelevation Auto off (a bit not identified),
    // or stored before RoadEng last calculated it.
    const flags = curve.flags !== undefined && Number.isInteger(curve.flags) ? curve.flags : null
    const minimumRadius =
      flags !== null &&
      (flags & ROADENG_MINIMUM_RADIUS_BIT) !== 0 &&
      Math.abs(e - resolved.maxSuperelevationPercent) <= SAME_PERCENT
    if (minimumRadius) settings.useMinimumRadius = true
    else {
      const sameMethod =
        roadEngMethod && flags !== null
          ? ((flags & ROADENG_TABLE_SUPERELEVATION_BIT) !== 0) === (design.superelevationMode === 'table')
          : null
      // A record written here holds e to six decimals: within that it is the method's own value.
      const own =
        sameMethod === false ||
        Math.abs(e - resolved.appliedSuperelevationPercent) > (sameMethod ? WRITTEN_E_PERCENT : SAME_PERCENT)
      if (own && e >= 0 && e <= 20) settings.superelevationPercent = e
    }
  }
  // A spiral curve's transition is its spiral: PGMaps takes the longer of runoff and spiral.
  const spiral = options.spiralM ?? 0
  for (const [key, read, rule] of [
    ['runoffInM', curve.runoffIn, resolved.runoffInM],
    ['runoffOutM', curve.runoffOut, resolved.runoffOutM],
  ] as const) {
    if (read === undefined || !(read >= 0) || read > 1000) continue
    if (spiral > 0 ? rule > spiral + SAME_M : Math.abs(read - rule) > SAME_M) settings[key] = spiral > 0 ? 0 : r9(read)
  }
  // Widening, side by side: the stored value where the rule gives another or Auto is off (`roadEngCurveWidening`).
  if (curve.widening) {
    const own = roadEngCurveWidening(
      curve.widening,
      { insideM: resolved.insideWideningM, outsideM: resolved.outsideWideningM },
      {
        autoInside: roadEngAutoWideningInside(curve.flags),
        ruleVaries: !!design.wideningTable?.length || !!design.wideningVehicleLengthM,
      },
    )
    if (own) Object.assign(settings, own)
  }
  return Object.keys(settings).length ? settings : undefined
}

/**
 * The road's curve rule from a RoadEng design. With a superelevation table (RoadEng's table 0) the
 * rule is table mode: that table, the runoff table (2) and the side friction table (1) in metres and
 * km/h, read as RoadEng reads them (`curveTableValue`), the transition fraction most curves use and
 * a tangent runout at the runoff's rate. The design speed and transition length most curves use and
 * the largest e max are the road's; each curve's own values come from `roadEngCurveSettings`.
 * Without a table it is the fitted formula ({@link roadEngFittedCurveDesignFor}) with the same
 * transition fraction and tangent runout. `comparison` gives RoadEng's and PGMaps' e for each curve.
 */
export function roadEngCurveDesignFor(settings: RoadEngSettings): RoadEngCurveDesignMapping {
  const fitted = roadEngFittedCurveDesignFor(settings)
  if (!fitted.curveDesign) return fitted
  const curves = settings.curves.filter((c) => c.radiusM > 0 && c.designSpeedKmh > 0 && Number.isFinite(c.e))
  const fraction = mode(curves.map((c) => c.transitionFraction).filter((f) => Number.isFinite(f) && f >= 0 && f <= 1))
  const unitM = settings.unitM
  const find = (index: number) => settings.superelevationTables.find((t) => t.index === index && t.rows.length)
  const superTable = find(ROADENG_SUPERELEVATION_TABLE)
  const runoffTable = find(ROADENG_RUNOFF_TABLE)
  const frictionTable = find(ROADENG_SIDE_FRICTION_TABLE)
  // The speed most curves use, as read: rounded to 0.01 km/h a foot design's 40 mph curves would
  // each carry their own 64.37376 km/h.
  const speed = mode(curves.map((c) => Math.round(c.designSpeedKmh * 1e6) / 1e6))
  const curveDesign: CurveDesign = {
    ...fitted.curveDesign,
    ...(speed !== undefined && speed >= 1 && speed <= 150 ? { designSpeedKmh: speed } : {}),
    ...(fraction !== undefined ? { transitionFraction: fraction } : {}),
    tangentRunout: true,
  }
  const unmapped = fitted.unmapped.filter(
    (u) =>
      !u.startsWith("Each curve's own design speed") &&
      !u.startsWith("Each curve's own transition lengths") &&
      !u.startsWith('Curves with different e max') &&
      !u.startsWith("RoadEng's lookup table"),
  )
  const notes = fitted.notes.filter((n) => !n.startsWith('RoadEng takes each curve') && !n.startsWith('RoadEng puts'))
  const table = superTable ? roadEngTableToPgmaps(superTable, unitM, 100) : null
  // RoadEng's Auto method: the side friction method where every curve not on Use Minimum Radius
  // uses it, with the f max (field 11) most of them use; else the table.
  const flagsOf = (c: RoadEngCurveSettings) => Number(c.raw[9])
  const autoCurves = curves.filter(
    (c) => Number.isInteger(flagsOf(c)) && (flagsOf(c) & ROADENG_MINIMUM_RADIUS_BIT) === 0,
  )
  const sideFrictionMethod =
    autoCurves.length > 0 && autoCurves.every((c) => (flagsOf(c) & ROADENG_TABLE_SUPERELEVATION_BIT) === 0)
  const fMax = sideFrictionMethod
    ? mode(autoCurves.map((c) => c.field11).filter((f) => Number.isFinite(f) && f >= 0 && f <= 1))
    : undefined
  if (sideFrictionMethod) {
    curveDesign.superelevationMode = 'sideFriction'
    if (fMax !== undefined) curveDesign.sideFrictionFactor = fMax
    curveDesign.criteriaSource =
      "Read from the RoadEng design: its side friction method (e / e max = f / f max), the design speed, transition length and f max most of its curves use, and its largest e max; each curve's own values where they differ."
  }
  if (table && table.rows.length && table.speedsKmh.length) {
    if (!sideFrictionMethod) {
      curveDesign.superelevationMode = 'table'
      curveDesign.criteriaSource =
        "Read from the RoadEng design: its superelevation and runoff tables, the design speed and transition length most of its curves use, and its largest e max; each curve's own values where they differ."
    }
    curveDesign.superelevationTable = table
    const runoff = runoffTable ? roadEngTableToPgmaps(runoffTable, unitM, unitM) : null
    if (runoff && runoff.rows.length && runoff.speedsKmh.length) curveDesign.runoffTable = runoff
    // Table 1 is one row of largest side friction by speed; its first column is unused.
    const frictionRow = frictionTable?.rows[0]
    if (frictionTable && frictionRow) {
      const columns = frictionTable.speeds.map((v, k) => ({ v, k })).filter((c) => Number.isFinite(c.v) && c.v > 0)
      const values = columns.map((c) => {
        const v = frictionRow.e[c.k]
        return v === null || v === undefined || !(v >= 0) || v > 2 ? null : v
      })
      if (columns.length && values.some((v) => v !== null))
        curveDesign.sideFrictionTable = {
          speedsKmh: columns.map((c) => r9(c.v * roadEngSpeedUnitKmh(unitM))),
          values,
        }
    }
  }
  const comparison = curves.map((c) => {
    const own = roadEngCurveSettings(
      curveDesign,
      {
        designSpeedMs: c.designSpeedKmh / 3.6,
        flags: Number(c.raw[9]),
        emax: c.eMax,
        fLimit: c.field11,
        e: c.e,
        transitionFraction: c.transitionFraction,
        runoffIn: c.transitionAtBcM,
        runoffOut: c.transitionAtEcM,
      },
      { gridRadiusM: c.radiusM, modelRadiusM: c.radiusM, deflectionDegrees: c.deflectionDegrees ?? 0 },
    )
    const resolved = evaluateCurveCriteria(curveDesign, c.radiusM, c.deflectionDegrees ?? 0, own)
    return {
      pi: c.pi,
      radiusM: c.radiusM,
      designSpeedKmh: c.designSpeedKmh,
      roadEngPercent: 100 * c.e,
      pgmapsPercent: resolved.appliedSuperelevationPercent,
      from: resolved.superelevationSource,
      own,
    }
  })
  const list = (items: typeof comparison) =>
    items
      .slice(0, 10)
      .map((c) => `PI ${c.pi}`)
      .join(', ') + (items.length > 10 ? ', …' : '')
  const stated = comparison.filter((c) => c.from === 'stated')
  const ownSpeed = comparison.filter((c) => c.own?.designSpeedKmh !== undefined)
  const ownRunoff = comparison.filter((c) => c.own?.runoffInM !== undefined || c.own?.runoffOutM !== undefined)
  const ownEmax = comparison.filter((c) => c.own?.maxSuperelevationPercent !== undefined)
  if (curveDesign.superelevationMode === 'sideFriction')
    notes.push(
      `Superelevation comes from RoadEng's side friction method at each curve's radius and design speed: e / e max = f / f max with e + f = V²/(9.81 R), f max ${curveDesign.sideFrictionFactor}${comparison.some((c) => c.own?.maxSideFriction !== undefined) ? ' unless a curve has its own' : ''}; ${comparison.length - stated.length} of ${comparison.length} curves take the method's value.`,
    )
  else if (curveDesign.superelevationMode === 'table') {
    const name = superTable!.description.find((d) => d.trim() && d.trim() !== '#')?.trim() ?? 'table 0'
    notes.push(
      `Superelevation comes from RoadEng's table (${name}) at each curve's radius and design speed, linear between its entries${curveDesign.runoffTable ? ', and each runoff from its runoff table' : ''}; ${comparison.length - stated.length} of ${comparison.length} curves take the table's value.`,
    )
  } else
    notes.push(
      `The design has no superelevation table: PGMaps calculates e = V²/(127 R) − ${curveDesign.sideFrictionFactor}, a side friction fitted to its curves; ${comparison.length - stated.length} of ${comparison.length} curves come within 0.0001 % of RoadEng's e.`,
    )
  if (stated.length)
    notes.push(
      `${plural(stated.length, 'curve keeps its', 'curves keep their')} own superelevation (${list(stated)}), where the rule gives another value: RoadEng keeps a typed e only with the curve's superelevation Auto unticked.`,
    )
  const minimumRadius = comparison.filter((c) => c.from === 'minimumRadius')
  if (minimumRadius.length)
    notes.push(
      `${plural(minimumRadius.length, 'curve has', 'curves have')} RoadEng's Use Minimum Radius (${list(minimumRadius)}): e = e max.`,
    )
  const ownFriction = comparison.filter((c) => c.own?.maxSideFriction !== undefined)
  if (ownFriction.length)
    notes.push(`${plural(ownFriction.length, 'curve has its', 'curves have their')} own f max (${list(ownFriction)}).`)
  if (ownSpeed.length)
    notes.push(`${plural(ownSpeed.length, 'curve has its', 'curves have their')} own design speed (${list(ownSpeed)}).`)
  if (ownEmax.length)
    notes.push(`${plural(ownEmax.length, 'curve has its', 'curves have their')} own e max (${list(ownEmax)}).`)
  if (ownRunoff.length)
    notes.push(
      `${plural(ownRunoff.length, 'curve has its', 'curves have their')} own transition lengths (${list(ownRunoff)}).`,
    )
  if (fraction !== undefined)
    notes.push(
      `Each runoff has ${fmt(100 * fraction, 1)} % outside the curve, after a tangent runout from normal crown at the same rate, as RoadEng applies it.`,
    )
  return {
    curveDesign,
    comparison: comparison.map(({ own: _own, ...c }) => {
      void _own
      return c
    }),
    unmapped,
    notes,
    widening: fitted.widening,
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * A road read from RoadEng with each curve's own settings (`RoadPoint.curve`) from its `108` record,
 * against the road's rule: the inverse of what `roadEngCurveInputs` writes. Only a road built from
 * its PIs (one road point per PI, between the two ends); a road fitted to its stations is returned
 * unchanged, as are points whose curve the rule already reproduces.
 */
export function withRoadEngCurveSettings(
  alignment: Alignment,
  source: Pick<RoadEngAlignment, 'pis' | 'followsStations'>,
): Alignment {
  const design = alignment.curveDesign
  const { points } = alignment
  if (!design || source.followsStations.plan || points.length !== source.pis.length + 2) return alignment
  let fits: ReturnType<typeof horizontalCurveFits>
  try {
    fits = horizontalCurveFits(alignment)
  } catch {
    return alignment
  }
  let changed = false
  const next = points.map((point, k) => {
    const pi = source.pis[k - 1]
    const fit = fits.find((f) => f.pointId === point.id)
    const { curve: _old, ...rest } = point
    void _old
    if (!pi?.curve || !fit || fit.status !== 'fitted' || !(point.radiusM > 0) || !(pi.radiusM > 0)) {
      if (_old) changed = true
      return rest
    }
    let own: CurveSettings | undefined
    try {
      own = roadEngCurveSettings(design, pi.curve, {
        gridRadiusM: pi.radiusM,
        modelRadiusM: point.radiusM,
        deflectionDegrees: fit.deflectionDegrees,
        spiralM: point.spiralM ?? 0,
      })
    } catch {
      own = undefined
    }
    if (!own) {
      if (_old) changed = true
      return rest
    }
    changed = true
    return { ...rest, curve: own }
  })
  return changed ? { ...alignment, points: next } : alignment
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
   * Give each material its ground type's cut and fill slopes (default true). The templates read from
   * RoadEng say which batters take them (`cutSlopeFrom`, `fillSlopeFrom`: `material` for a slope on
   * AUTO, `template` for a stated one), as RoadEng uses a ground type's slopes only for an AUTO slope.
   * False leaves the materials without batters and lists the ground types' slopes in the notes.
   */
  materialBatters?: boolean
  /**
   * The P-line the design names (`roadEngPLine.ts`): ground given as `**` takes its survey's layers
   * (`ground`), or, when the named P-line was not given (`ground` null), is left unclassified.
   * Absent: the design names none, and `**` is RoadEng's default ground type, OB.
   */
  pLine?: { name: string; ground: PLineGround | null }
}

export interface RoadEngMaterialMapping {
  materials: GroundMaterial[]
  strata: StratumAssignment[]
  /** A range's subgrade fill material other than its first stratum layer's (`fillMaterial`). */
  fillRequirements: FillRequirement[]
  /** RoadEng's Site Prep stripping by range (`roadEngSitePreparation`). */
  sitePreparation: SitePreparationRange[]
  unmapped: string[]
  notes: string[]
}

/** The Site Prep outside control RoadEng's tutorials use: the offset is measured from the slope stake at the base. */
export const ROADENG_SITE_PREP_SLOPE_STAKE = 1

/**
 * RoadEng's Site Prep (Overburden Removal) on a station range, from `[LocationParms]` fields 2–10
 * (indices 1–9): the depth from topo (project units), the left and right outside offsets past the
 * slope stakes, their controls (1, slope stake – base), then four zeros in every sample. Read from
 * Softree's samples against their tutorials: the V9/V10 RoadEng Resource tutorial sets 2 ft from
 * topo, 3 ft outside on both sides from the slope stake – base, 0 inside, and Road6 - 8 onwards hold
 * `2,3,3,1,1,0,0,0,0`; Align stage 8 the same; Hart Rd `10,2,2,1,1`; Location 18 `0.2,0.3,0.3,1,1`
 * (0 on its first range). Which of the two offsets is the left is not shown by any sample (they are
 * equal in all of them); the first is taken as the left. The tutorial: "The depth stripped will be
 * the value assigned in the Site Prep dialogue or the top surface layer thickness, whichever is
 * least", and "Stripped material is excluded from the mass haul – it is assumed to be unsuitable for
 * fill". Null where the range strips nothing.
 */
export function roadEngSitePreparation(
  range: Pick<RoadEngStationRange, 'raw'>,
  unitM: number,
): { depthM: number; leftOutsideM: number; rightOutsideM: number; controls: number[]; inside: number[] } | null {
  const v = (k: number) => Number(range.raw[k])
  const depth = v(1)
  if (!(depth > 0) || !Number.isFinite(depth)) return null
  const offset = (k: number) => (Number.isFinite(v(k)) && v(k) > 0 ? v(k) * unitM : 0)
  return {
    depthM: depth * unitM,
    leftOutsideM: offset(2),
    rightOutsideM: offset(3),
    controls: [v(4), v(5)],
    inside: [v(6), v(7), v(8), v(9)],
  }
}

/** Room beside the road for stripped ground, bank m³ per m: PGMaps' largest, so it never binds. */
export const ROADENG_STRIPPING_DISPOSAL_M3_PER_M = 10_000

/** The stripping material made for a ground type's stripped top layer. */
export const roadEngStrippingMaterialId = (code: string) => `roadeng-${safeId(code)}-stripping`

/**
 * The ground type a range's subgrade fill material names, as written (`**` unresolved): a code, the
 * second stratum layer's type for `*2`, and null for `*1` (the first layer's type, RoadEng's
 * default), a blank, `-`, or `*2` on a range with one layer.
 */
export function roadEngFillMaterialCode(range: Pick<RoadEngStationRange, 'fillMaterial' | 'ground'>): string | null {
  const named = range.fillMaterial.trim()
  if (named === '*2') return range.ground[1]?.code ?? null
  return named && named !== '*1' && named !== '-' ? named : null
}

/** RoadEng's default ground type: OB, else the one described as the default, else the first. */
export function roadEngDefaultGroundType(materials: readonly RoadEngMaterial[]): RoadEngMaterial | null {
  return (
    materials.find((m) => m.code === 'OB') ??
    materials.find((m) => /\(default\)/i.test(m.description)) ??
    materials[0] ??
    null
  )
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
      `The materials carry no batter, so every template slope is its stated one. The ground types' slopes: ${settings.materials.map((m) => `${m.code} cut ${m.cutSlopePercent > 0 ? fmt(100 / m.cutSlopePercent) : '–'}:1, fill ${m.fillSlopePercent > 0 ? fmt(100 / m.fillSlopePercent) : '–'}:1`).join('; ')}.`,
    )
  if (materials.length)
    notes.push(
      `Ground types: ${batters ? "the cut and fill slopes RoadEng uses for an AUTO template slope become each material's batters, applied only where a template's slope is AUTO; " : ''}its excavation cost becomes the material's rate per bank m³${settings.unitM === 1 ? '' : ' (converted from per yd³)'}, in the currency entered in RoadEng, not converted. RoadEng has no reusable share, so each material is taken as fully reusable. No material is marked rock: mark rock materials yourself for the rock cut to apply.`,
    )
  const codes = new Map(settings.materials.map((m) => [m.code, `roadeng-${safeId(m.code)}`]))
  // `**` is the design's default ground type: the layers of the P-line the design names (`pLine`),
  // else, with no P-line, OB (Softree help, *Sub Horizons Assignments*).
  const fallbackType = roadEngDefaultGroundType(settings.materials)
  const defaultCode = (code: string) => (code === '**' && fallbackType ? fallbackType.code : code)
  const usesDefault = settings.stationRanges.some((r) => r.ground.some((l) => l.code === '**'))
  const pLine = options.pLine
  if (usesDefault && !pLine && fallbackType && materials.some((m) => m.id === codes.get(fallbackType.code)))
    notes.push(
      `Ground given as the design's default ground type (**) is ${fallbackType.code} · ${fallbackType.description}, RoadEng's default where the design names no P-line.`,
    )
  const strata: StratumAssignment[] = []
  const pieces = chainageRanges(
    settings.stationRanges,
    options,
    (r) => r.ground,
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  const missing = new Set<string>()
  let pLineStrata = 0,
    pLineUnread = false
  const add = (
    layer: { code: string; topDepthM: number; bottomDepthM: number | null },
    start: number,
    end: number,
    fromPLine: boolean,
  ) => {
    const materialId = codes.get(defaultCode(layer.code))
    if (!materialId || !materials.some((m) => m.id === materialId)) {
      missing.add(layer.code)
      return
    }
    if (strata.length >= 200) return
    strata.push({
      id: fromPLine ? `${ROADENG_PLINE_STRATUM_PREFIX}${++pLineStrata}` : `roadeng-horizon-${strata.length + 1}`,
      start,
      end,
      materialId,
      topDepthM: Math.min(1000, layer.topDepthM),
      bottomDepthM: layer.bottomDepthM === null ? null : Math.min(1000, layer.bottomDepthM),
    })
  }
  for (const p of pieces) {
    if (!pLine || !p.value.some((l) => l.code === '**')) {
      for (const layer of p.value) add(layer, p.start, p.end, false)
      continue
    }
    if (!pLine.ground) {
      // The named P-line was not given: `**` is never read as OB then.
      pLineUnread = true
      for (const layer of p.value) if (layer.code !== '**') add(layer, p.start, p.end, false)
      continue
    }
    // A range given wholly as `**` takes the survey's layers; a `**` among named layers is the
    // survey's surface layer at the range's depths.
    for (const sub of pLineStrataPieces(pLine.ground, p, options)) {
      const layers =
        p.value.length === 1
          ? sub.layers
          : p.value.map((l) => (l.code === '**' ? { ...l, code: sub.layers[0].code } : l))
      for (const layer of layers) add(layer, sub.start, sub.end, true)
    }
  }
  if (pLine && usesDefault)
    if (pLineUnread)
      unmapped.push(
        `Ground given as the design's default ground type (**), which RoadEng takes from the design's P-line ${pLine.name}; it was not opened with the design, so that ground is left unclassified. Open the design together with ${pLine.name}.`,
      )
    else if (pLine.ground)
      notes.push(
        `Ground given as the design's default ground type (**) takes the ground layers of its P-line ${pLine.name} (${pLine.ground.stations.length} surveyed stations), applied ${pLine.ground.apply === 'ahead' ? 'from each surveyed station up to the next (Ahead)' : 'to the cross sections nearest each surveyed station (Between)'}${pLineStrata ? `: ${pLineStrata} horizons` : ''}.`,
      )
  for (const code of missing)
    unmapped.push(
      code === '**'
        ? "Ground layers given as the design's default ground type (**), and the design holds no ground types to take it from; that ground is left unclassified."
        : `Ground layers of type ${code}, which the design's ground types do not hold; that ground is left unclassified.`,
    )
  if (strata.length)
    notes.push(
      'Ground layers by station range become horizons at the same depths below original ground, in road chainage.',
    )
  // A range's subgrade fill material: `*1` (RoadEng's default, stratum layer 1) is the AUTO fill rule
  // itself; `*2` or a ground type code becomes a fill requirement for that material
  // (`roadEngFillMaterialCode`; `roadEngFillMaterials.ts` writes it back).
  const fillRequirements: FillRequirement[] = []
  const fills = chainageRanges(
    settings.stationRanges,
    options,
    (r) => {
      const code = roadEngFillMaterialCode(r)
      return code === null ? null : defaultCode(code)
    },
    (a, b) => a === b,
  )
  const noSecond = chainageRanges(
    settings.stationRanges,
    options,
    (r) => r.fillMaterial.trim() === '*2' && !r.ground[1],
    (a, b) => a === b,
  ).filter((f) => f.value)
  for (const f of noSecond)
    unmapped.push(
      `Fill material *2 (the second ground layer) from station ${fmt(f.from, 3)} to ${fmt(f.to, 3)} m, where the range has one ground layer; that fill takes no required material.`,
    )
  const read: string[] = []
  for (const f of fills) {
    if (f.value === null) continue
    const materialId = codes.get(f.value)
    if (!materialId || !materials.some((m) => m.id === materialId)) {
      unmapped.push(
        `Fill material ${f.value} from station ${fmt(f.from, 3)} to ${fmt(f.to, 3)} m, which the design's ground types do not hold.`,
      )
      continue
    }
    if (fillRequirements.length >= 100) continue
    fillRequirements.push({
      id: `roadeng-fill-${fillRequirements.length + 1}`,
      start: f.start,
      end: f.end,
      layer: 'subgrade',
      materialId,
      // Softree's Optimal manual (Cost Parameters, Quality Factor): any material of the same or
      // higher quality can be used where a fill type is specified.
      replaceable: true,
    })
    read.push(`${f.value} ${fmt(f.from, 3)}–${fmt(f.to, 3)} m`)
  }
  if (fillRequirements.length)
    notes.push(
      `Subgrade fill material by range (RoadEng's Fill Types), each a fill requirement for that material or any of the same or higher quality, as RoadEng's costing allows: ${read.join(', ')}${settings.stationRanges.some((r) => r.fillMaterial.trim() === '*2') ? ' (*2 is the range’s second ground layer)' : ''}. Ranges on *1, the first ground layer's type, take the template's fill rule.`,
    )
  for (const layer of settings.templateLayerMaterials ?? [])
    unmapped.push(
      `Template layer ${layer.code || layer.layer}${layer.description ? ` (${layer.description})` : ''} is built of ${layer.material} in RoadEng's Template Materials: PGMaps costs and hauls only the subgrade by ground type, so that layer's material is not applied; it goes back to RoadEng as read.`,
    )
  // Site Prep: the top layer stripped under the footprint and past the slope stakes, to the Site Prep
  // depth or the top layer's bottom, whichever is less; a stripping material, never reused as fill.
  const sitePreparation: SitePreparationRange[] = []
  const stripped: string[] = []
  const preps = chainageRanges(
    settings.stationRanges,
    options,
    (r) => {
      const prep = roadEngSitePreparation(r, settings.unitM)
      return prep && { ...prep, top: r.ground[0] ?? null }
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b),
  )
  for (const p of preps) {
    if (!p.value) continue
    const { depthM, leftOutsideM, rightOutsideM, controls, inside, top } = p.value
    const where = `from station ${fmt(p.from, 3)} to ${fmt(p.to, 3)} m`
    if (!top || (top.code === '**' && pLine)) {
      unmapped.push(
        `RoadEng's Site Prep ${where} strips ${fmt(depthM, 3)} m of the ${top ? "P-line's top layer" : 'top layer'}; ${top ? 'its material varies along the P-line, so the stripping is not applied' : 'the range has no ground layer to strip, so the stripping is not applied'}.`,
      )
      continue
    }
    const code = defaultCode(top.code)
    const ground = materials.find((m) => m.id === codes.get(code))
    if (!ground) continue
    const id = roadEngStrippingMaterialId(code)
    if (!materials.some((m) => m.id === id)) {
      if (materials.length >= 32) {
        unmapped.push(`Stripping of ${code}: past PGMaps' 32 materials.`)
        continue
      }
      // Stripped ground is never a batter or fill: no slopes of its own.
      const rest: GroundMaterial = { ...ground }
      delete rest.cutSlope
      delete rest.fillSlope
      materials.push({
        ...rest,
        id,
        name: `${ground.name} · stripped`.slice(0, 200),
        purpose: 'stripping',
        reusableFraction: 0,
      })
    }
    const depth = Math.min(depthM, top.bottomDepthM ?? Infinity)
    if (sitePreparation.length >= 100 || !(depth > 0)) continue
    sitePreparation.push({
      id: `roadeng-site-prep-${sitePreparation.length + 1}`,
      start: p.start,
      end: p.end,
      depthM: r6(Math.min(10, depth)),
      leftInsideM: 0,
      rightInsideM: 0,
      leftOutsideM: r6(Math.min(50, leftOutsideM)),
      rightOutsideM: r6(Math.min(50, rightOutsideM)),
      materialId: id,
    })
    stripped.push(
      `${code} ${fmt(depth, 3)} m deep ${where}, ${fmt(leftOutsideM, 3)} m / ${fmt(rightOutsideM, 3)} m past the slope stakes`,
    )
    if (controls.some((c) => c !== ROADENG_SITE_PREP_SLOPE_STAKE))
      unmapped.push(
        `RoadEng's Site Prep ${where} measures an outside offset from a control other than the slope stake; PGMaps measures it from the slope stake.`,
      )
    if (inside.some((x) => x !== 0))
      unmapped.push(`RoadEng's Site Prep ${where} has inside settings (${inside.join(', ')}) that are not applied.`)
  }
  if (stripped.length)
    notes.push(
      `RoadEng's Site Prep becomes stripping of the top ground layer, to its depth or the layer's bottom, whichever is less, under the road and past its slope stakes: ${stripped.join('; ')}. Stripped ground is costed at its ground type's excavation cost, never used as fill, and left beside the road with no haul, as RoadEng leaves it out of the mass haul.`,
    )
  return { materials, strata, fillRequirements, sitePreparation, unmapped: dedupe(unmapped), notes }
}

// ---- Parameter overrides ----------------------------------------------------------------------------

/** A parameter override's code bit for the left side (`RoadEngParameterOverrideEntry`). */
export const ROADENG_OVERRIDE_LEFT = 4096
/** A parameter override's code bit for the right side. */
export const ROADENG_OVERRIDE_RIGHT = 8192
/** A station at or past this size is RoadEng's ±FLT_MAX: the alignment's start or end. */
export const ROADENG_OVERRIDE_BEYOND = 1e38
/**
 * A step (two entries at one station) becomes two PGMaps stations this far apart, m: PGMaps'
 * stations increase strictly.
 */
export const ROADENG_OVERRIDE_STEP_M = 0.001

/** The sides an override's code names; empty when it names neither (then any side's parameter). */
export function roadEngOverrideSides(code: number): ('left' | 'right')[] {
  return [
    ...(code & ROADENG_OVERRIDE_LEFT ? (['left'] as const) : []),
    ...(code & ROADENG_OVERRIDE_RIGHT ? (['right'] as const) : []),
  ]
}

/** The code RoadEng stores for an override on one side. */
export const roadEngOverrideCode = (side: 'left' | 'right') =>
  side === 'left' ? ROADENG_OVERRIDE_LEFT : ROADENG_OVERRIDE_RIGHT

/**
 * The template parameter an override names, in one template: the parameter of that name in a
 * component on the side the code names (or on both sides); null where the template has none there.
 */
export function roadEngOverrideParameter(
  t: RoadEngTemplate,
  parameter: string,
  code: number,
): { component: RoadEngComponent; parameter: RoadEngParameter } | null {
  const sides = roadEngOverrideSides(code)
  const candidates = t.components.flatMap((c) =>
    c.parameters.filter((p) => key(p.name) === key(parameter)).map((p) => ({ component: c, parameter: p })),
  )
  if (!sides.length) return candidates[0] ?? null
  return (
    candidates.find((x) => x.component.side !== 'both' && sides.includes(x.component.side)) ??
    candidates.find((x) => x.component.side === 'both') ??
    null
  )
}

/** A copy of a template with one parameter set to `raw` (as RoadEng stores it). */
export function roadEngTemplateWithParameter(
  t: RoadEngTemplate,
  component: number,
  parameter: number,
  raw: number,
  unitM: number,
): RoadEngTemplate {
  return {
    ...t,
    components: t.components.map((c) =>
      c.index !== component
        ? c
        : {
            ...c,
            parameters: c.parameters.map((p) =>
              p.index !== parameter ? p : { ...p, raw, value: p.kind === 'length' ? raw * unitM : raw },
            ),
          },
    ),
  }
}

/** The template in force on one side at a design station (m), or null on a Taper or past the ranges. */
export function roadEngTemplateCodeAt(
  ranges: readonly RoadEngStationRange[],
  station: number,
  side: 'left' | 'right',
): string | null {
  const range =
    ranges.find(
      (r) =>
        (r.fromStation === null || station >= r.fromStation - 1e-9) &&
        (r.toStation === null || station < r.toStation - 1e-9),
    ) ?? ranges.at(-1)
  const code = range ? (side === 'left' ? range.leftTemplate : range.rightTemplate) : null
  return code && code !== ROADENG_TAPER_CODE ? code : null
}

export interface RoadEngOverrideMapping {
  overrides: TemplateParameterOverride[]
  unmapped: string[]
  notes: string[]
}

/**
 * RoadEng's parameter overrides as PGMaps station values (`templateParameterOverrides.ts`). Each
 * parameter's entries form one series; the template sections are mapped again with the parameter at
 * each entered value, and every side value that moves (a width, a batter, a ditch depth and the top
 * width it makes) becomes an override of that value, at the same stations, with `**` as a blank.
 * RoadEng interpolates the parameter; PGMaps interpolates the side value, which is the same for
 * lengths and differs between two entered slopes (the notes give the largest difference).
 */
export function roadEngParameterOverridesFor(
  settings: RoadEngSettings,
  options: RoadEngRangeOptions & RoadEngTemplateOptions & { fallback: RoadTemplate },
): RoadEngOverrideMapping {
  const unmapped: string[] = []
  const notes: string[] = []
  const overrides: TemplateParameterOverride[] = []
  const entries = settings.parameterOverrideEntries
  if (!entries.length) return { overrides, unmapped, notes }
  const byCode = new Map<string, RoadEngTemplate>()
  for (const t of settings.templates) if (!t.folder && t.code && !byCode.has(t.code)) byCode.set(t.code, t)
  const mapped = new Map<string, RoadTemplate | null>()
  const mapOf = (t: RoadEngTemplate, cacheKey: string) => {
    if (!mapped.has(cacheKey)) mapped.set(cacheKey, roadEngTemplateToPgmaps(t, options.fallback, options).template)
    return mapped.get(cacheKey)!
  }
  const scale = options.stationScale ?? 1
  const length = (options.endStation - options.startStation) * scale
  const series = new Map<string, RoadEngParameterOverrideEntry[]>()
  for (const e of entries) {
    const k = `${e.parameter}\u0000${e.code}`
    series.set(k, [...(series.get(k) ?? []), e])
  }
  const sides = ['left', 'right'] as const
  const valueOf = (t: RoadTemplate, side: 'left' | 'right', field: OverrideField) => overrideFieldValue(t, side, field)
  let n = 0
  for (const list of series.values()) {
    n++
    const { parameter, code } = list[0]
    // In station order; entries at one station keep their key order (a step).
    const points = [...list].sort((a, b) => (a.station === b.station ? 0 : a.station - b.station))
    const named = roadEngOverrideSides(code)
    const label = `The parameter override of ${parameter}${named.length === 1 ? `, ${named[0]} side` : ''} (${points.length} station${points.length === 1 ? '' : 's'})`
    // The section each template in use makes with the parameter at a value.
    const remap = (templateCode: string, raw: number): RoadTemplate | null => {
      const t = byCode.get(templateCode)
      const found = t && roadEngOverrideParameter(t, parameter, code)
      if (!t || !found) return null
      return mapOf(
        roadEngTemplateWithParameter(t, found.component.index, found.parameter.index, raw, settings.unitM),
        `${templateCode}\u0000${found.component.index}\u0000${found.parameter.index}\u0000${raw}`,
      )
    }
    const baseOf = (templateCode: string) => {
      const t = byCode.get(templateCode)
      return t ? mapOf(t, templateCode) : null
    }
    // Which side values the parameter moves, in any template that holds it.
    const fields = new Set<string>()
    let other = false
    const codes = new Set(settings.stationRanges.flatMap((r) => [r.leftTemplate, r.rightTemplate]))
    const held = [...codes].filter((c) => byCode.has(c) && roadEngOverrideParameter(byCode.get(c)!, parameter, code))
    for (const c of held) {
      const base = baseOf(c)
      if (!base) continue
      for (const e of points) {
        if (e.raw === null) continue
        const next = remap(c, e.raw)
        if (!next) continue
        // Only the side the code names: RoadEng overrides the parameter there.
        for (const side of sides)
          if (!named.length || named.includes(side))
            for (const field of OVERRIDE_FIELD_NAMES)
              if (Math.abs(valueOf(next, side, field) - valueOf(base, side, field)) > 1e-9)
                fields.add(`${side}:${field}`)
        for (const part of ['layers', 'components', 'rockCut', 'leftRockCut', 'rightRockCut'] as const)
          if (JSON.stringify(next[part]) !== JSON.stringify(base[part])) other = true
      }
    }
    if (!held.length) {
      unmapped.push(`${label}: no template in use holds a parameter of that name, so it changes nothing here.`)
      continue
    }
    if (!fields.size) {
      unmapped.push(
        points.every((e) => e.raw === null)
          ? `${label}: every station takes the template's own value.`
          : `${label}: ${parameter} is not a value PGMaps' section reads; the template's own value is used.`,
      )
      continue
    }
    if (other)
      unmapped.push(
        `${label}: the part of ${parameter} that changes surfacing courses, components or the rock cut; only the side values it moves are carried.`,
      )
    let worstSlope = 0
    for (const f of [...fields].sort()) {
      const [side, field] = f.split(':') as ['left' | 'right', OverrideField]
      const { min, max } = OVERRIDE_FIELDS[field]
      const out: OverridePoint[] = []
      let clamped = false
      const valueAt = (e: RoadEngParameterOverrideEntry) => {
        const templateCode = roadEngTemplateCodeAt(settings.stationRanges, e.station, side)
        const next = e.raw === null || templateCode === null ? null : remap(templateCode, e.raw)
        let value = next ? valueOf(next, side, field) : null
        if (value !== null && (value < min || value > max)) {
          clamped = true
          value = Math.max(min, Math.min(max, value))
        }
        return value === null ? null : r6(value)
      }
      // Entries at one chainage (a step, or the alignment's start or end as ±FLT_MAX): the first
      // one's value holds up to it and the last one's after it, so only the last counts at the
      // road's start and only the first at its end.
      const groups: { chainage: number; entries: RoadEngParameterOverrideEntry[] }[] = []
      for (const e of points) {
        const chainage = Math.max(0, Math.min(length, (e.station - options.startStation) * scale))
        const last = groups.at(-1)
        if (last && Math.abs(chainage - last.chainage) <= 1e-6) last.entries.push(e)
        else groups.push({ chainage, entries: [e] })
      }
      groups.forEach((g, k) => {
        const first = valueAt(g.entries[0]),
          after = valueAt(g.entries[g.entries.length - 1])
        const nextChainage = groups[k + 1]?.chainage ?? length
        if (g.chainage <= 1e-6) out.push({ station: 0, value: after })
        else if (g.chainage >= length - 1e-6) out.push({ station: r6(length), value: first })
        else {
          out.push({ station: r6(g.chainage), value: first })
          if (after !== first && g.chainage + ROADENG_OVERRIDE_STEP_M < nextChainage - 1e-6)
            out.push({ station: r6(g.chainage + ROADENG_OVERRIDE_STEP_M), value: after })
        }
      })
      if (clamped)
        unmapped.push(
          `${label}: values past PGMaps' ${OVERRIDE_FIELDS[field].label} limits (${min}–${max}), held at the limit.`,
        )
      // A slope interpolated as H:V here and as a grade in RoadEng differs between two entered values.
      if (field === 'CutSlope' || field === 'FillSlope')
        for (let k = 1; k < out.length; k++) {
          const a = out[k - 1].value,
            b = out[k].value
          if (a !== null && b !== null && a > 0 && b > 0)
            worstSlope = Math.max(worstSlope, Math.abs((a + b) / 2 - 1 / ((1 / a + 1 / b) / 2)))
        }
      if (overrides.length >= MAX_PARAMETER_OVERRIDES) {
        unmapped.push(`${label}: past PGMaps' ${MAX_PARAMETER_OVERRIDES} overrides.`)
        continue
      }
      overrides.push({
        id: `roadeng-override-${n}-${side}-${field}`,
        name: `${parameter} (${side})`.slice(0, 200),
        side,
        field,
        points: out,
        roadEng: { parameter, code, entries: list.map((e) => e.text) },
      })
    }
    const made = overrides.filter((o) => o.id.startsWith(`roadeng-override-${n}-`))
    if (made.length)
      notes.push(
        `${label} becomes station values of the ${made.map((o) => `${o.side} ${OVERRIDE_FIELDS[o.field].label.replace(/ \(.*\)$/, '').toLowerCase()}`).join(', ')}, interpolated between its stations as in RoadEng; a ** station takes the template's own value.`,
      )
    if (worstSlope > 0.005)
      notes.push(
        `${label}: RoadEng interpolates a slope as a grade and PGMaps as H:V; midway between two entered slopes they differ by up to ${fmt(worstSlope, 2)}:1.`,
      )
  }
  return { overrides, unmapped: dedupe(unmapped), notes }
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
  const overrides = roadEngParameterOverridesFor(settings, options)
  const engineering = createEngineeringDesign()
  engineering.templates = section.templates
  engineering.assignments = section.assignments
  engineering.materials = ground.materials
  engineering.strata = ground.strata
  if (ground.fillRequirements.length) engineering.fillRequirements = ground.fillRequirements
  if (ground.sitePreparation.length) {
    engineering.sitePreparation = ground.sitePreparation
    // RoadEng leaves stripped ground out of the mass haul: it is disposed of where it is stripped,
    // with no haul (V9/V10 RoadEng Resource tutorial, Stripping).
    engineering.haul = {
      ...engineering.haul,
      sidecastRanges: ground.sitePreparation.map((p) => ({
        id: `${p.id}-disposal`,
        start: p.start,
        end: p.end,
        capacityBankM3PerM: ROADENG_STRIPPING_DISPOSAL_M3_PER_M,
        unitRate: 0,
        materialIds: [p.materialId],
      })),
    }
  }
  if (overrides.overrides.length) engineering.parameterOverrides = overrides.overrides
  return {
    template: section.template,
    curveDesign: curves.curveDesign,
    engineering,
    subgradeDepthM: section.subgradeDepthM,
    unmapped: dedupe([...section.unmapped, ...curves.unmapped, ...ground.unmapped, ...overrides.unmapped]),
    notes: dedupe([...section.notes, ...curves.notes, ...ground.notes, ...overrides.notes]),
  }
}
