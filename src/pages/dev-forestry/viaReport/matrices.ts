/**
 * The scales and matrices VIA reports print, built from the tables PGMaps already holds (`via.ts`, `vqo.ts`,
 * `viaDocument/scales.ts`) so a report never carries its own copy of a threshold. Each takes the assessment's reading
 * and marks it: the Appendix 1 bar marks X or the adjusted figure, the partial-cut table marks the nearest cell, the
 * Table 3 matrix marks each element's rating. With no reading, nothing is marked. No DOM or network access.
 */
import { CLASS_NAMES, DISTANCE_SCALES, PERCENT_SCALES, type ClassCode, type DistanceScale } from '../viaDocument/scales'
import { DESIGN_RATINGS, EXTENT_TERMS, IMPACT_TERMS } from '../viaDocument/wording'
import {
  DESIGN_ELEMENTS,
  table2Class,
  RETENTION_LEVELS,
  ROADS_VISIBILITY,
  SHAPE_TERMS,
  VIA_RATINGS,
  VISIBLENESS_TERMS,
  type DesignElementId,
  type DesignRating,
  type RetentionLevel,
  type RoadsVisibility,
  type ViaRatingId,
} from '../via'
import { classifyAlteration, DEFAULT_VISUAL_QUALITY_THRESHOLDS, PARTIAL_CUT_EQUIVALENT } from '../vqo'
import type { Provenance, ReportBlock } from './model'

const CLASS_CODES: readonly ClassCode[] = ['P', 'R', 'PR', 'M', 'MM']

/**
 * The class colours of the one-page poster "A Guide to Visual Quality Objectives" (the visual resource management
 * guide reviewed with the reference VIAs, November 2026), sampled from a 200 dpi render of its PDF as the most common
 * colour in each patch. Every scale and matrix a report prints takes its class colours from here.
 */
export const CLASS_GUIDE_COLORS: Record<ClassCode, string> = {
  /** Dark green: the Preservation title panel, left column (RGB 15 120 61). */
  P: '#0F783D',
  /** Green: the Retention panel, the clearcut guide's Retention bar and the partial-cut legend's RETENTION swatch. */
  R: '#699E3B',
  /** Olive: the Partial Retention panel, its clearcut bar and the PARTIAL RETENTION swatch. */
  PR: '#7E9535',
  /** Khaki: the Modification panel, its clearcut bar and the MODIFICATION swatch. */
  M: '#908B2E',
  /** Golden brown: the clearcut guide's Maximum Modification bar (RGB 187 137 44; its title panel reads 186 137 45). */
  MM: '#BB892C',
}

const CLASS_COLOR = CLASS_GUIDE_COLORS

/**
 * The guide's colours as a ramp from least to most altered, for the header strips of tables whose rows are not classes
 * (design ratings, roads, retention, the extent met). A strip says which end of the scale a row is; it is not a class.
 */
function colorRamp(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => CLASS_COLOR[CLASS_CODES[Math.round((index * 4) / (count - 1 || 1))]],
  )
}

/** The band of the handbook's Table 2 a figure reads as (inclusive at 1.5/7/18/30, through `table2Class`), or null. */
function table2Band(percent: number | null): number | null {
  if (percent === null) return null
  const found = table2Class(percent)
  return found ? CLASS_CODES.indexOf(found.code as ClassCode) : null
}

/** FPPR s. 1.1: each class's three requirements, as the handbook's Table 1 prints them (public regulation). */
export const FPPR_CRITERIA: Record<ClassCode, { visibility: string; scale: string; design: string }> = {
  P: {
    visibility: 'not easily distinguishable from the pre-harvest landscape',
    scale: 'very small in scale',
    design: '',
  },
  R: { visibility: 'difficult to see', scale: 'small in scale', design: 'natural in appearance' },
  PR: {
    visibility: 'easy to see',
    scale: 'small to medium in scale',
    design: 'natural and not rectilinear or geometric in shape',
  },
  M: {
    visibility: 'very easy to see',
    scale: 'large in scale and natural in its appearance, or small to medium in scale',
    design: 'with some angular characteristics (when small to medium in scale)',
  },
  MM: {
    visibility: 'very easy to see',
    scale: 'very large in scale',
    design: 'rectilinear and geometric in shape, or both',
  },
}

/** FPPR s. 1.1's criteria, one row per class; marks the objective's row. */
export function criteriaMatrix(objective: ClassCode | null): ReportBlock {
  return {
    kind: 'matrix',
    title: 'Visual quality objectives (FPPR s. 1.1)',
    rowHeader: 'Objective',
    columnHeader: 'The alteration, from a significant public viewpoint, is',
    rows: CLASS_CODES.map((code) => `${CLASS_NAMES[code]} (${code})`),
    columns: ['Visibility', 'Scale', 'Design'],
    cells: CLASS_CODES.map((code) => [
      FPPR_CRITERIA[code].visibility,
      FPPR_CRITERIA[code].scale,
      FPPR_CRITERIA[code].design,
    ]),
    marks: objective ? [{ row: CLASS_CODES.indexOf(objective), column: 0 }] : [],
    markSource: 'scene',
    rowColors: CLASS_CODES.map((code) => CLASS_COLOR[code]),
  }
}

/**
 * The 2022 handbook's Appendix 1 bar: an axis ticked 0 1.5 4 7 12 18 24 30+ at equal spacing, as the form prints it,
 * with the class letters above in their colours, a light band per class and the figure as an arrow pointing down.
 * Preservation is the point at 0. A figure past 30 sits on the arrowhead's stretch, beyond the last tick.
 */
export function table2Bar(title: string, percent: number | null, source: Provenance, label?: string): ReportBlock {
  const bands = PERCENT_SCALES.handbookTable2.bands
  let from = 0
  return {
    kind: 'scale',
    style: 'arrow-axis',
    title,
    bands: bands.map((band) => {
      const out = {
        from,
        to: band.max,
        label: band.code ?? band.term,
        color: band.code ? CLASS_COLOR[band.code] : undefined,
      }
      from = band.max
      return out
    }),
    ticks: [0, 1.5, 4, 7, 12, 18, 24, 30].map((at) => ({ at, label: at === 30 ? '30+' : String(at) })),
    axisLabel: '%alt:',
    mark: percent,
    markBand: table2Band(percent),
    markLabel: label ?? (percent === null ? undefined : `${percent.toFixed(1)}%`),
    markSource: source,
    note: PERCENT_SCALES.handbookTable2.printed,
  }
}

/**
 * The widths of the P to MM arrow's classes, in the 01 form's own proportions (R 55 : PR 92 : M 131 : MM 131, read
 * off its axis); Preservation is the point where the axis starts.
 */
const PMM_WIDTHS: Record<ClassCode, number> = { P: 0, R: 55, PR: 92, M: 131, MM: 131 }

/**
 * The P to MM arrow the 2001 forms mark by eye (01, 03, 05): an axis with an arrowhead, the class labels above it in
 * their colours, a light band per class under them, and the reading as a red arrow pointing down into its class.
 */
/** Table 2's percent range per class, for placing a numeric reading along its band. */
const TABLE_2_RANGE: Record<ClassCode, [number, number]> = {
  P: [0, 0],
  R: [0, 1.5],
  PR: [1.5, 7],
  M: [7, 18],
  MM: [18, 30],
}

/**
 * `percent`, when given, places the arrow along its class's band by Table 2's range (2.0% sits early in PR, as 01's
 * mark does); without it the arrow goes a third of the way into the class.
 */
export function pmmArrow(
  title: string,
  code: ClassCode | null,
  source: Provenance,
  percent?: number | null,
): ReportBlock {
  let from = 0
  const bands = CLASS_CODES.map((entry) => {
    const band = {
      from,
      to: from + PMM_WIDTHS[entry],
      label: entry,
      color: CLASS_COLOR[entry],
      name: CLASS_NAMES[entry],
    }
    from = band.to
    return band
  })
  const marked = code ? bands[CLASS_CODES.indexOf(code)] : null
  return {
    kind: 'scale',
    style: 'arrow-axis',
    title,
    bands,
    // The boundaries are drawn from the bands; the arrow is read by class, so it carries no numbers.
    ticks: [],
    // A third of the way into the class, beside its label as the form's mark is, never on a boundary.
    mark: marked
      ? marked.from +
        (marked.to - marked.from) *
          (percent != null && code && TABLE_2_RANGE[code][1] > TABLE_2_RANGE[code][0]
            ? Math.min(
                0.92,
                Math.max(0.08, (percent - TABLE_2_RANGE[code][0]) / (TABLE_2_RANGE[code][1] - TABLE_2_RANGE[code][0])),
              )
            : 1 / 3)
      : null,
    markBand: code ? CLASS_CODES.indexOf(code) : null,
    markLabel: code ? CLASS_NAMES[code] : undefined,
    markSource: source,
  }
}

/**
 * The poster's clearcut harvesting alteration guide: one bar per objective on a 0-30% axis (Preservation 0%,
 * Retention 0-1.5%, Partial Retention 1.6-7.0%, Modification 7.1-18.0%, Maximum Modification 18.1-30.0+%), the reading
 * drawn as a line across the bars and its class's row picked out. The class is the handbook's Table 2 reading.
 */
export function clearcutGuide(percent: number | null, source: Provenance = 'run', label?: string): ReportBlock {
  const ranges: Record<ClassCode, string> = {
    P: '0%',
    R: '0 - 1.5%',
    PR: '1.6 - 7.0%',
    M: '7.1 - 18.0%',
    MM: '18.1 - 30.0+%',
  }
  let from = 0
  return {
    kind: 'scale',
    style: 'guide',
    title: 'Clearcut harvesting alteration guide',
    bands: PERCENT_SCALES.handbookTable2.bands.map((band) => {
      const code = band.code as ClassCode
      const out = {
        from,
        to: band.max,
        label: code,
        color: CLASS_COLOR[code],
        name: CLASS_NAMES[code],
        range: ranges[code],
      }
      from = band.max
      return out
    }),
    ticks: [0, 5, 10, 15, 20, 25, 30].map((at) => ({ at, label: String(at) })),
    mark: percent,
    markBand: table2Band(percent),
    markLabel: label ?? (percent === null ? undefined : `${percent.toFixed(1)}%`),
    markSource: source,
    note: 'The clearcut alteration percentages allowed for each visual quality objective, perspective view.',
  }
}

/**
 * FS1252 Table 4 / the GAR's Table 10: clearcut-equivalent percent for a partial cut, by volume removed and residual
 * tree height, drawn as the poster's partial cut harvesting alteration guide: each cell in the colour of the class its
 * number reads as (Table 2), the class letter large and PGMaps' number under it, the cut's nearest cell marked.
 */
export function partialCutMatrix(cut: { removedPercent: number; residualHeightM: number } | null): ReportBlock {
  const rows = PARTIAL_CUT_EQUIVALENT.map((_, index) => String((index + 1) * 10))
  const columns = PARTIAL_CUT_EQUIVALENT[0].map((_, index) => String((index + 1) * 5))
  const letters = PARTIAL_CUT_EQUIVALENT.map((row) =>
    row.map((value) => {
      const found = classifyAlteration(value, 'perspective', DEFAULT_VISUAL_QUALITY_THRESHOLDS)
      return found ? (found.code as ClassCode) : null
    }),
  )
  // The X goes where the prescription falls, between cells as the form marks it; the class is still read from the
  // nearest cell (`PARTIAL_CUT_EQUIVALENT`), which the run's line (a) uses.
  const point = cut
    ? {
        row: Math.min(rows.length - 1, Math.max(0, cut.removedPercent / 10 - 1)),
        column: Math.min(columns.length - 1, Math.max(0, cut.residualHeightM / 5 - 1)),
      }
    : null
  const used = CLASS_CODES.filter((code) => letters.some((row) => row.includes(code)))
  return {
    kind: 'matrix',
    style: 'class-grid',
    title: 'Partial cut harvesting alteration guide: clearcut-equivalent % alteration',
    // The axis names as the poster prints them.
    rowHeader: 'VOLUME/STEMS REMOVED (%)',
    columnHeader: 'TREE HEIGHT (m) OF RESIDUAL TREES',
    rows,
    columns,
    cells: PARTIAL_CUT_EQUIVALENT.map((row) => row.map((value) => value.toFixed(1))),
    letters,
    tint: letters.map((row) => row.map((code) => (code ? CLASS_COLOR[code] : null))),
    legend: {
      title: 'Harvest types',
      items: used.map((code) => ({ label: CLASS_NAMES[code], color: CLASS_COLOR[code] })),
    },
    marks: [],
    ...(point ? { point } : {}),
    cellValues: false,
    markSource: 'scene',
    note: point
      ? `X: ${cut!.removedPercent}% of the volume removed, residual trees ${cut!.residualHeightM} m tall (the block's record). Each cell reads as the class of its clearcut-equivalent alteration (FS1252 Table 4) on Table 2; the nearest cell's figure goes on line (a).`
      : 'Each cell reads as the class of its clearcut-equivalent alteration (FS1252 Table 4) on Table 2.',
  }
}

const DESIGN_COLUMN: Record<DesignRating, number> = { [-1]: 0, 0: 1, 1: 2 }

/** Table 3: each design element's Good / Moderate / Poor criteria, the rating used marked on its row. */
export function designElementsMatrix(
  ratings: Partial<Record<DesignElementId, DesignRating | null>> | null,
  source: Provenance,
): ReportBlock {
  return {
    kind: 'matrix',
    title: 'Table 3: visual design elements',
    rowHeader: 'Element',
    columnHeader: 'Rating',
    rows: DESIGN_ELEMENTS.map((element) => element.label),
    columns: DESIGN_RATINGS.map((rating, index) => `${rating} (${['-1', '0', '+1'][index]})`),
    cells: DESIGN_ELEMENTS.map((element) => [element.good, element.moderate, element.poor]),
    marks: DESIGN_ELEMENTS.flatMap((element, row) => {
      const rating = ratings?.[element.id]
      return rating === null || rating === undefined ? [] : [{ row, column: DESIGN_COLUMN[rating] }]
    }),
    markSource: source,
    columnColors: colorRamp(DESIGN_RATINGS.length),
  }
}

/** Table 4: roads, landings and sidecast, the factor beside each; the reviewer's choice marked. */
export function roadsMatrix(roads: RoadsVisibility | null): ReportBlock {
  return {
    kind: 'matrix',
    title: 'Table 4: roads, landings and sidecast',
    rowHeader: 'Visibility',
    columnHeader: 'Factor',
    rows: ROADS_VISIBILITY.map((entry) => entry.label),
    columns: ['Factor'],
    cells: ROADS_VISIBILITY.map((entry) => [`+${entry.value}`]),
    marks: roads === null ? [] : [{ row: ROADS_VISIBILITY.findIndex((entry) => entry.value === roads), column: 0 }],
    markSource: 'reviewer',
    rowColors: colorRamp(ROADS_VISIBILITY.length),
  }
}

/** Table 5: tree retention, the factor beside each level; the level used marked. */
export function retentionMatrix(level: RetentionLevel | null, source: Provenance): ReportBlock {
  return {
    kind: 'matrix',
    title: 'Table 5: tree retention',
    rowHeader: 'Retention',
    columnHeader: 'Factor',
    rows: RETENTION_LEVELS.map((entry) => entry.label),
    columns: ['Factor'],
    cells: RETENTION_LEVELS.map((entry) => [entry.factor === 0 ? '0' : String(entry.factor)]),
    marks: level ? [{ row: RETENTION_LEVELS.findIndex((entry) => entry.id === level), column: 0 }] : [],
    markSource: source,
    // Low retention leaves the most altered: the ramp runs the other way down this table.
    rowColors: colorRamp(RETENTION_LEVELS.length).reverse(),
  }
}

const RATING_ORDER: readonly ViaRatingId[] = ['well-met', 'met', 'inconclusive', 'not-met', 'clearly-not-met']

/** Table 7's five ratings with their meanings; the rating reached marked. */
export function extentMatrix(rating: ViaRatingId | null): ReportBlock {
  return {
    kind: 'matrix',
    title: 'Extent the objective is met (handbook Table 7)',
    rowHeader: 'Rating',
    columnHeader: 'Meaning',
    rows: RATING_ORDER.map((id) => VIA_RATINGS[id].label),
    columns: ['Meaning'],
    cells: RATING_ORDER.map((id) => [VIA_RATINGS[id].meaning]),
    marks: rating ? [{ row: RATING_ORDER.indexOf(rating), column: 0 }] : [],
    markSource: 'reviewer',
    rowColors: colorRamp(RATING_ORDER.length),
  }
}

/** The vocabulary tables the consultant reports print in their method (22, 23). */
export function vocabularyTables(): ReportBlock[] {
  return [
    {
      kind: 'table',
      title: 'Visibility (FPPR s. 1.1)',
      columns: ['Term', 'Meaning'],
      rows: VISIBLENESS_TERMS.map((term) => [term.label, term.meaning]),
      source: 'table',
    },
    {
      kind: 'table',
      title: 'Size and scale',
      columns: ['Term', '% alteration'],
      rows: PERCENT_SCALES.sizeWords.bands.map((band, index, all) => [
        band.term,
        index === 0 ? '0' : `${all[index - 1].max}-${band.max}`,
      ]),
      source: 'table',
    },
    {
      kind: 'table',
      title: 'Design',
      columns: ['Term', 'Meaning'],
      rows: SHAPE_TERMS.map((term) => [term.label, term.meaning]),
      source: 'table',
    },
    {
      kind: 'table',
      title: 'Level of impact',
      columns: ['Term'],
      rows: IMPACT_TERMS.map((term) => [term]),
      source: 'table',
    },
    {
      kind: 'table',
      title: 'Extent the objective is met',
      columns: ['Term'],
      rows: EXTENT_TERMS.map((term) => [term]),
      source: 'table',
    },
  ]
}

/** Viewpoint significance, 1 to 5 (22, 23 Table 3 footnote; the handbook's viewpoint types). */
export const SIGNIFICANCE_LEVELS = [
  ['1', 'Low', 'Glimpse view, under 10 seconds'],
  ['2', 'Low to moderate', 'Sustained side view'],
  ['3', 'Moderate', 'Sustained focal view, travelling toward the alteration'],
  ['4', 'Moderate to high', 'Stationary view from a significant viewpoint'],
  ['5', 'High', 'Stationary, sustained view from a highly significant viewpoint'],
] as const

export function significanceTable(): ReportBlock {
  return {
    kind: 'table',
    title: 'Viewpoint significance',
    columns: ['Level', 'Name', 'Viewing experience'],
    rows: SIGNIFICANCE_LEVELS.map((row) => [...row]),
    source: 'table',
  }
}

/** A distance scale as a table: the report's own zones (05) or the inventory's. */
export function distanceTable(scale: DistanceScale = DISTANCE_SCALES.vli): ReportBlock {
  let from = 0
  return {
    kind: 'table',
    title: `Distance: ${scale.name}`,
    columns: ['Zone', 'From', 'To'],
    rows: scale.bands.map((band) => {
      const row = [band.term, `${from} km`, Number.isFinite(band.maxKm) ? `${band.maxKm} km` : 'beyond']
      from = band.maxKm
      return row
    }),
    source: 'table',
  }
}

/**
 * An environmental assessment's residual-effect characterization (26): the criteria and the ratings each may take.
 * Every rating is the assessor's; none is marked from a run.
 */
export const EFFECT_CRITERIA = [
  ['Spatial boundary', 'Local study area / Regional study area'],
  ['Duration', 'Short-term / Medium-term / Long-term'],
  ['Frequency', 'Isolated / Periodic / Continuous'],
  ['Reversibility', 'Immediate / Medium to long-term / Irreversible'],
  ['Magnitude', 'Low / Medium / High'],
  ['Probability of occurrence', 'Low / Moderate / High'],
  ['Confidence', 'Low / Moderate / High'],
  ['Significance', 'Not significant / Significant'],
] as const

export function effectsTable(ratings: Partial<Record<string, string>> = {}): ReportBlock {
  return {
    kind: 'table',
    title: 'Residual effect characterization: visual aesthetics',
    columns: ['Criterion', 'Rating', 'Ratings available', 'Rationale'],
    rows: EFFECT_CRITERIA.map(([criterion, options]) => [criterion, ratings[criterion] ?? '', options, '']),
    note: 'Ratings and rationale are the assessor’s; the terms follow the application’s significance criteria.',
    source: 'reviewer',
  }
}
