/**
 * VIA document formats as data: for each reference format, the images it needs (render recipes), the page elements
 * and tables it prints, the arithmetic of its percent alteration, the scales it reads that figure and the viewing
 * distance against, and the sentences it is written in. `resolve.ts` fills a format from one assessment, so every
 * format comes from the same set block, stations, run and class passes.
 *
 * Formats copy a document's structure, never its branding: no company, consultant or agency name, logo or
 * title-block artwork (the logo slot is the user's). Sources are cited by reference-document number, as the figure
 * styles are (`src/lib/forestry/viaFigure/presets.ts`). See docs/forestry-visual-quality.md, "VIA documents".
 * No DOM or network access.
 */
import { ALTERATION_RULES, type AlterationRule } from '@/lib/forestry/viaFigure/alteration'
import type { ViaRole } from '@/lib/forestry/viaFigure/presets'
import type { LabelStyleId } from '@/lib/mapSheet/callouts'

import { DESIGN_ELEMENTS, SHAPE_TERMS, VISIBLENESS_TERMS, type DesignElementId } from '../via'
import { DISTANCE_SCALES, PERCENT_SCALES, type DistanceScale, type PercentScale } from './scales'

// ------------------------------------------------------------------ render recipes

/**
 * One image a format needs, as the road view and a capture would make it. Each field maps to an existing setting:
 * `lens` and `framing` to the analysis sheet's framing (`figureFraming.ts`, `scene.figureFrame`), `harvest` to the
 * drive's harvest phase, `blockGround` to *Paint blocks*, `privateLand` to step 2's *Clear private land*, `style`
 * and `labelStyle` to the figure style and label style, `passes` to the capture (display, and the class pass).
 */
export interface RenderRecipe {
  id: string
  label: string
  camera: {
    /** Lens: a 35 mm-equivalent focal length, a fixed horizontal field, or a lined-up field photo's own. */
    lens: { mm: number } | { hfovDeg: number } | 'photo'
    /** `landform`: framed on the landform the eye sees; `panorama`: frames joined across a wide span; `fixed`. */
    framing: 'landform' | 'panorama' | 'fixed'
    /** Width to height of the printed strip, when the format fixes it. */
    aspect?: number
    eye: 'observer' | 'water-level'
  }
  scene: {
    harvest: 'before' | 'after'
    /** How a proposed block's ground is drawn. `outline`: the picture as is, outlines over it. */
    blockGround: 'painted' | 'outline' | 'none'
    privateLand: 'cleared' | 'standing'
    trees: 'natural' | 'off'
  }
  /** Figure style (`presets.ts` id) and the roles it outlines; null for a plain render. */
  style: string | null
  overlays: readonly ViaRole[]
  labelStyle?: LabelStyleId
  cameraInfo?: boolean
  passes: readonly ('display' | 'class')[]
  caption: string
}

const OBSERVER_50MM = { lens: { mm: 50 }, framing: 'landform', eye: 'observer' } as const
const ANALYSIS_ROLES: readonly ViaRole[] = ['landform', 'proposedBlock', 'existingNonVeg', 'privateLand']

const plainRender = (privateLand: 'cleared' | 'standing'): RenderRecipe => ({
  id: 'perspective',
  label: 'Perspective viewpoint (unannotated render)',
  camera: OBSERVER_50MM,
  scene: { harvest: 'after', blockGround: 'painted', privateLand, trees: 'natural' },
  style: null,
  overlays: [],
  passes: ['display'],
  caption: 'Perspective Viewpoint: {viewpoint}',
})

const analysisRender = (style: string, privateLand: 'cleared' | 'standing'): RenderRecipe => ({
  id: 'analysis',
  label: 'Perspective viewpoint analysis',
  camera: OBSERVER_50MM,
  scene: { harvest: 'after', blockGround: 'painted', privateLand, trees: 'natural' },
  style,
  overlays: ANALYSIS_ROLES,
  labelStyle: 'box',
  passes: ['display', 'class'],
  caption: 'Perspective Viewpoint Analysis: {viewpoint} - {landform}',
})

/** Existing, proposed and analysed panels from one camera (05, 06, 07). */
const triptych = (style: string): RenderRecipe[] => [
  {
    id: 'existing',
    label: 'Existing condition',
    camera: OBSERVER_50MM,
    scene: { harvest: 'before', blockGround: 'none', privateLand: 'standing', trees: 'natural' },
    style: null,
    overlays: [],
    passes: ['display'],
    caption: 'Existing Condition',
  },
  {
    id: 'proposed',
    label: 'Proposed development',
    camera: OBSERVER_50MM,
    scene: { harvest: 'after', blockGround: 'painted', privateLand: 'standing', trees: 'natural' },
    style: null,
    overlays: [],
    passes: ['display'],
    caption: 'Proposed Development',
  },
  {
    id: 'analysed',
    label: 'Proposed development, analysed',
    camera: OBSERVER_50MM,
    scene: { harvest: 'after', blockGround: 'painted', privateLand: 'standing', trees: 'natural' },
    style,
    overlays: ['landform', 'rockNonVeg', 'proposedBlock', 'existingNonVeg', 'privateLand'],
    passes: ['display', 'class'],
    caption: 'Proposed Development',
  },
]

// ------------------------------------------------------------------ elements

/** A table a format prints, by its column headers; `per` says what one row is. */
export interface DocumentTable {
  id: string
  title: string
  per: 'viewpoint' | 'viewpoint-landform' | 'block' | 'document'
  columns: readonly string[]
  /** Notes printed under the table, keyed by the marks in its column headers. */
  footnotes?: readonly string[]
  spec: string
}

export type WordingSetId =
  | 'perspective-report'
  | 'form-2001'
  | 'appendix-1'
  | 'referral'
  | 'comparison-strip'
  | 'district-summary'
  | 'calculation-on-photo'

/**
 * How a consultant report picks the viewpoint it assesses blocks from: one per block, the viewpoint that sees most of
 * that block (22), or one for the blocks as a group, the viewpoint that sees most of them together (23).
 */
export type KeyViewpointMode = 'per-block' | 'group'
/**
 * What a key viewpoint is chosen by. `visibility` (22): the share of the block's ground in view. `impact` (23, "the
 * visual impact was most significant when viewed from this viewpoint"): the viewpoint's significance (Table 3, the
 * reviewer's 1-5) first, then the percent alteration of its landform, then the share in view.
 */
export type KeyViewpointRule = 'visibility' | 'impact'

export interface ViaDocumentFormat {
  id: string
  name: string
  /** Reference documents by number. */
  sources: readonly string[]
  /** What the format is for, in a line. */
  purpose: string
  recipes: readonly RenderRecipe[]
  /** The figure style of its analysis image (sheet frame, legend, calculation box). */
  style: string | null
  tables: readonly DocumentTable[]
  rule: AlterationRule
  percentScale: PercentScale
  distanceScale: DistanceScale
  wording: WordingSetId
  /** Perspective reports: one key viewpoint per block, or one for the group (`per-block` when absent). */
  keyViewpoint?: KeyViewpointMode
  /** How the key viewpoint is chosen (`visibility` when absent). */
  keyViewpointRule?: KeyViewpointRule
  /** Printed per viewpoint: a reviewer-signed form, or none. */
  form?: 'appendix-1' | 'form-2001'
  /** What the format prints that PGMaps cannot fill from an assessment. */
  gaps: readonly string[]
}

// ------------------------------------------------------------------ the consultant reports' numbered tables

/**
 * Column headers of the consultant reports' Tables 1-5 (22, 23), in their order. The superscripts are the
 * references' footnote marks, numbered through the document as they number them; each table's `footnotes` say what
 * each mark means, in PGMaps' words. Resolved rows are keyed by these headers.
 */
export const T1 = {
  vsu: 'VSU polygon',
  blocks: 'Blocks within VSU',
  vsc: 'VSC¹',
  vac: 'VAC²',
  evc: 'EVC³',
  vqo: 'VQO',
} as const

export const T2 = {
  landform: 'Visible landform',
  blocks: 'Blocks',
  vsu: 'Primary VSU',
  vsc: 'VSC',
  vac: 'VAC',
  evc: 'EVC (VSU) / (LF)',
  vqo: 'VQO',
  description: 'Landform description',
} as const

export const T3 = {
  viewpoint: 'Viewpoint',
  blocks: 'Visible proposed and non-greened-up blocks',
  description: 'Description of viewpoint and significance',
  significance: 'Significance⁴',
} as const

export const T4 = {
  viewpoint: 'Viewpoint',
  landform: 'Visible landform',
  vqo: 'VQO',
  blocks: 'Visible blocks in landform',
  visibility: 'Visibility⁶',
  percent: 'Percent alteration (%)⁷',
  size: 'Size and scale⁸',
  design: 'Design and character⁹',
  met: 'VQO met: initial assessment¹⁰',
} as const

export const T5 = {
  viewpoint: 'Viewpoint',
  block: 'Block',
  landform: 'Landform / VQO',
  impact: 'Level of impact¹¹ / Visibility¹²',
  percent: 'Percent alteration (%)¹³ / Size and scale¹⁴',
  forceLines: 'Response to visual force lines¹⁵',
  borrow: 'Borrows from the natural character of the landscape?¹⁶',
  edges: 'Edge treatments incorporated?¹⁷',
  islands: 'Islands or patches of trees kept?¹⁸',
  distance: 'Distance from the viewpoint¹⁹',
  position: 'Position on the landform²⁰',
  design: 'Overall design²¹',
  met: 'VQO met for the block: final determination²²',
} as const

const element = (id: DesignElementId) => DESIGN_ELEMENTS.find((entry) => entry.id === id)!
const rated = (id: DesignElementId) => {
  const e = element(id)
  return `${e.question} Good: ${e.good.toLowerCase()}; Moderate: ${e.moderate.toLowerCase()}; Poor: ${e.poor.toLowerCase()}.`
}
/** "Easy to see, seen without great effort: directly in sight or unobscured; …" from a vocabulary's own meanings. */
const terms = (list: ReadonlyArray<{ label: string; meaning: string }>) =>
  list
    .map((term) => {
      const meaning = term.meaning.replace(/\.$/, '').replace(/\. /g, ': ')
      return `${term.label}, ${meaning.charAt(0).toLowerCase()}${meaning.slice(1)}`
    })
    .join('; ')
const EXTENT = 'Well met, Met, Inconclusive, Not met or Clearly not met'

/** "Poor under 2 km; Moderate 2 to 5 km; Good over 5 km", from the scale the cells are read on. */
export function distanceRatings(scale: DistanceScale): string {
  return scale.bands
    .map((band, index, bands) => {
      const from = bands[index - 1]?.maxKm
      if (from === undefined) return `${band.term} under ${band.maxKm} km`
      return Number.isFinite(band.maxKm) ? `${band.term} ${from} to ${band.maxKm} km` : `${band.term} over ${from} km`
    })
    .join('; ')
}

/** 22, 23 Table 1, from the inventory read or the office fields. */
export const TABLE_1: DocumentTable = {
  id: 'vsu-attributes',
  title: 'Table 1: Summary of visual sensitivity unit attributes',
  per: 'document',
  columns: Object.values(T1),
  footnotes: [
    '¹ VSC, visual sensitivity class: the inventory’s rating of how sensitive the landscape is to visible alteration, from its biophysical character and its viewers, on a scale of 1 (very high sensitivity) to 5 (very low).',
    '² VAC, visual absorption capability: how well the landscape can take alteration and keep its visual integrity, rated High (H), Moderate (M) or Low (L).',
    '³ EVC, existing visual condition: the inventory’s class for the alteration already in the unit, in the same classes as the objectives; current only to the latest inventory.',
  ],
  spec: '22 Table 1 (p.7), 23 Table 1 (p.4); fn 1-3',
}

/** 22, 23 Table 2: one row per landform the viewpoints read, with its description. */
export const TABLE_2: DocumentTable = {
  id: 'landform-summary',
  title: 'Table 2: Landform summary',
  per: 'document',
  columns: Object.values(T2),
  spec: '22 Table 2 (p.8), 23 Table 2 (p.5)',
}

/** 22, 23 Table 3: why each viewpoint was chosen, what it is like to view from, and its significance. */
export const TABLE_3: DocumentTable = {
  id: 'viewpoint-significance',
  title: 'Table 3: Summary of viewpoints and significance',
  per: 'viewpoint',
  columns: Object.values(T3),
  footnotes: [
    '⁴ Significance, on a five-point scale set by how long and how directly the view is held: (1) Low, a glimpse under 10 seconds; (2) Low to moderate, a sustained side view; (3) Moderate, a sustained focal view while travelling toward the alteration; (4) Moderate to high, a stop such as a rest area or campsite, viewed for a short time; (5) High, a community, tourism business or other place viewed for a long time.',
  ],
  spec: '22 Table 3 (p.9-10), 23 Table 3 (p.6); fn 4',
}

const TABLE_4: DocumentTable = {
  id: 'initial-assessment',
  title: 'Table 4: Assessment of visual impact for each viewpoint and landform',
  per: 'viewpoint-landform',
  columns: Object.values(T4),
  footnotes: [
    `⁶ Visibility, in the terms of FPPR s. 1.1: ${terms(VISIBLENESS_TERMS)}.`,
    '⁷ Percent alteration: the share of the landform in the view that the alteration occupies, counting the proposed blocks with existing openings not yet greened up and other planned blocks; see each viewpoint’s calculation.',
    `⁸ Size and scale, read from the percent alteration: ${PERCENT_SCALES.sizeWords.printed}.`,
    `⁹ Design, in the terms of FPPR s. 1.1: ${terms(SHAPE_TERMS)}.`,
    `¹⁰ VQO met, initial assessment: a judgement weighing the three elements of the definition together, given as ${EXTENT}.`,
  ],
  spec: '22 Table 4 (p.11-12), 23 Table 4 (p.7); fn 6-10',
}

/** 22, 23 Table 5: a block row and an overall-landform row per key viewpoint, with the design questions as notes. */
const table5 = (distance: DistanceScale): DocumentTable => ({
  id: 'detailed-assessment',
  title: 'Table 5: Detailed assessment of visual impact from the key viewpoint, by block',
  per: 'block',
  columns: Object.values(T5),
  footnotes: [
    '¹¹ Level of impact: what the alteration, with existing openings not greened up and other planned blocks, does to the view: Not visible, Not visually evident, Subordinate, Dominant or Out of scale.',
    '¹² Visibility: the terms of note 6.',
    '¹³ Percent alteration: as note 7. A block’s own share is printed only when it is the one block in view; the landform’s row carries the total.',
    '¹⁴ Size and scale: the terms of note 8.',
    `¹⁵ ${element('force-lines').label}: ${rated('force-lines')}`,
    `¹⁶ ${element('natural-character').label}: ${rated('natural-character')}`,
    `¹⁷ ${element('edge-treatment').label}: ${rated('edge-treatment')}`,
    '¹⁸ Islands or patches of trees: are retention patches placed and shaped inside the block to break up the opening and echo the terrain around it? Good, Moderate or Poor.',
    `¹⁹ Distance from the viewpoint: the nearer the opening, the more of its detail is seen and the harder it is to absorb. ${distanceRatings(distance)}.`,
    `²⁰ ${element('position').label}: ${rated('position')}`,
    '²¹ Overall design: the terms of note 9.',
    `²² VQO met for the block: a judgement weighing every factor above, given as ${EXTENT}.`,
  ],
  spec: '22 Table 5 (13 columns, block and overall-landform rows, p.13-14), 23 Table 5 (p.9); fn 11-22',
})

const VIEWPOINT_TABLE_2001: DocumentTable = {
  id: 'viewpoints',
  title: 'Viewpoints and photograph information',
  per: 'viewpoint',
  columns: ['Viewpoint', 'Importance', 'Coordinates', 'Distance', 'Duration', 'Lens', 'Direction'],
  spec: '03 p1, 05 p4 (2001 form)',
}

const ATTRIBUTES_2022: DocumentTable = {
  id: 'attributes',
  title: 'Viewpoint attributes',
  per: 'viewpoint',
  columns: ['Distance to Development', 'VLI No.', 'VSC', 'VAC', 'EVQO', 'Latitude', 'Longitude', 'View Duration'],
  spec: '06 and 07, per-viewpoint attribute table',
}

export const VIA_DOCUMENT_FORMATS: readonly ViaDocumentFormat[] = [
  {
    id: 'perspective-report-net-private',
    name: 'Perspective report, landform net of private land',
    sources: ['22'],
    purpose:
      'A consultant VIA: tables of viewpoints and landforms, a discussion per block, and an analysis sheet per viewpoint with private land treated as cleared.',
    recipes: [plainRender('cleared'), analysisRender('analysis-sheet-orange', 'cleared')],
    style: 'analysis-sheet-orange',
    tables: [TABLE_4, table5(DISTANCE_SCALES.designDistance)],
    rule: ALTERATION_RULES.netOfPrivatePixels,
    percentScale: PERCENT_SCALES.sizeWords,
    distanceScale: DISTANCE_SCALES.designDistance,
    wording: 'perspective-report',
    keyViewpoint: 'per-block',
    gaps: [
      'Viewpoint significance (1-5) and view duration are the reviewer’s.',
      'Lines of force, borrowing, edges, islands, position and design character are the reviewer’s judgements.',
    ],
  },
  {
    id: 'perspective-report-gross',
    name: 'Perspective report, gross landform',
    sources: ['23'],
    purpose: 'As the net-of-private report, with private land left standing and the gross landform as denominator.',
    recipes: [plainRender('standing'), analysisRender('analysis-sheet-purple', 'standing')],
    style: 'analysis-sheet-purple',
    tables: [TABLE_4, table5(DISTANCE_SCALES.designDistance)],
    rule: ALTERATION_RULES.grossPixelsSumOfParts,
    percentScale: PERCENT_SCALES.sizeWords,
    distanceScale: DISTANCE_SCALES.designDistance,
    wording: 'perspective-report',
    keyViewpoint: 'group',
    keyViewpointRule: 'impact',
    gaps: ['Sub-landform boxes repeat per sub-landform; PGMaps prints one landform per sheet.'],
  },
  {
    id: 'form-2001-analysis-sheets',
    name: '2001 guidebook form with analysis sheets',
    sources: ['03'],
    purpose: 'The 2001 VIA form, one analysis sheet per viewpoint with a pixel calculation box.',
    recipes: [analysisRender('analysis-sheet-magenta', 'standing')],
    style: 'analysis-sheet-magenta',
    tables: [VIEWPOINT_TABLE_2001],
    rule: ALTERATION_RULES.grossPixels,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'form-2001',
    form: 'form-2001',
    gaps: ['Importance (major / minor) and duration are the reviewer’s; the ocular term is the reviewer’s.'],
  },
  {
    id: 'form-2001-analysed-photos',
    name: '2001 guidebook form with analysed photos',
    sources: ['05'],
    purpose: 'Existing, proposed and analysed panels per viewpoint, with the landform net of rock and private land.',
    recipes: triptych('analysed-photo-rock-outline'),
    style: 'analysed-photo-rock-outline',
    tables: [VIEWPOINT_TABLE_2001],
    rule: ALTERATION_RULES.netOfRockAndPrivateCm2,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.report05,
    wording: 'form-2001',
    form: 'form-2001',
    gaps: ['The originals are photo-montages measured in cm²; PGMaps renders the terrain model and measures pixels.'],
  },
  {
    id: 'appendix-1-net-private-rock',
    name: '2022 handbook Appendix 1, net of rock and private land',
    sources: ['06'],
    purpose: 'Attribute table, rationale, existing / proposed / analysed panels and the Appendix 1 form per viewpoint.',
    recipes: triptych('analysed-photo-private-land'),
    style: 'analysed-photo-private-land',
    tables: [ATTRIBUTES_2022],
    rule: ALTERATION_RULES.netOfRockAndPrivateCm2,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'appendix-1',
    form: 'appendix-1',
    gaps: ['The ocular class, Table 3 design ratings, roads and the rationale are the reviewer’s (step 4).'],
  },
  {
    id: 'appendix-1-net-rock',
    name: '2022 handbook Appendix 1, net of rock',
    sources: ['07'],
    purpose: 'As the Appendix 1 format, with only rock leaving the landform.',
    recipes: triptych('analysed-photo-hatched-rock'),
    style: 'analysed-photo-hatched-rock',
    tables: [ATTRIBUTES_2022],
    rule: ALTERATION_RULES.netOfRockCm2,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'appendix-1',
    form: 'appendix-1',
    gaps: ['The ocular class, Table 3 design ratings, roads and the rationale are the reviewer’s (step 4).'],
  },
  {
    id: 'calculation-on-photo',
    name: 'Calculation on the photo',
    sources: ['09'],
    purpose: 'A simulation per viewpoint and a numbered-polygon area table over the gross landform.',
    recipes: [
      {
        ...analysisRender('calculation-on-photo', 'standing'),
        id: 'calculation',
        label: 'Numbered areas',
        labelStyle: 'numbered',
      },
    ],
    style: 'calculation-on-photo',
    tables: [
      {
        id: 'areas',
        title: 'Areas',
        per: 'viewpoint',
        columns: ['VLU', 'Proposed Alteration', 'Non Veg State', 'Rock', 'Net VLU', 'Alteration', '%'],
        spec: '09 calculation pages',
      },
    ],
    rule: ALTERATION_RULES.grossCm2,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'calculation-on-photo',
    gaps: ['The original prints no class or rating; the class shown is Table 2’s reading.'],
  },
  {
    id: 'referral-panoramas',
    name: 'Public referral panoramas',
    sources: ['11', '12', '13', '14', '15'],
    purpose:
      'Plain-language referral: the objective paragraph, very wide painted panoramas per viewpoint, and a verdict.',
    recipes: [
      {
        id: 'panorama',
        label: 'Referral panorama',
        camera: { lens: { mm: 50 }, framing: 'panorama', aspect: 8, eye: 'observer' },
        scene: { harvest: 'after', blockGround: 'painted', privateLand: 'standing', trees: 'natural' },
        style: 'referral-montage',
        overlays: [],
        passes: ['display', 'class'],
        caption: 'Viewpoint #{n}: {viewpoint}',
      },
    ],
    style: 'referral-montage',
    tables: [],
    rule: ALTERATION_RULES.grossPixels,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'referral',
    gaps: ['The originals print no measured figure; PGMaps adds its own beside the verdict.'],
  },
  {
    id: 'district-comparison',
    name: 'District comparison package',
    sources: ['04'],
    purpose: 'Every viewpoint at one lens, terrain-only drapes and lines of force, scaled to viewing distance.',
    recipes: [
      {
        id: 'strip',
        label: 'Comparison strip row',
        camera: { lens: { hfovDeg: 45 }, framing: 'fixed', eye: 'observer' },
        scene: { harvest: 'after', blockGround: 'outline', privateLand: 'standing', trees: 'natural' },
        style: 'district-greyscale',
        overlays: ['landform', 'proposedBlock', 'forceConvex', 'forceConcave'],
        passes: ['display', 'class'],
        caption: '{km} km viewing distance to centre of block',
      },
    ],
    style: 'district-greyscale',
    tables: [
      {
        id: 'summary',
        title: 'Percent alteration by viewpoint',
        per: 'viewpoint',
        columns: ['Viewpoint', 'Distance', 'Landform', '% Alteration'],
        spec: '04 summary table',
      },
    ],
    rule: ALTERATION_RULES.grossPixels,
    percentScale: PERCENT_SCALES.handbookTable2,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'comparison-strip',
    gaps: ['VSUs are combined into one landform under the stricter objective by the reviewer.'],
  },
  {
    id: 'district-summary',
    name: 'District summary table',
    sources: ['02'],
    purpose: 'A narrative rationale with a twelve-row summary: existing plus proposed against strict % guidelines.',
    recipes: [plainRender('standing')],
    style: null,
    tables: [
      {
        id: 'summary',
        title: 'Visual landscape summary',
        per: 'viewpoint',
        columns: [
          'Viewpoint',
          'VLU',
          'VSR',
          'VAC',
          'EVC',
          'VQO',
          'Existing %',
          'Proposed %',
          'Total %',
          'Within guidelines',
          'Meets definition',
        ],
        spec: '02 summary table',
      },
    ],
    rule: ALTERATION_RULES.grossCm2,
    percentScale: PERCENT_SCALES.guidebookStrict,
    distanceScale: DISTANCE_SCALES.vli,
    wording: 'district-summary',
    gaps: ['"Meets definition" and the field comments are the reviewer’s.'],
  },
]

export const findDocumentFormat = (id: string | null | undefined) =>
  VIA_DOCUMENT_FORMATS.find((format) => format.id === id) ?? null

/** The format a reference document number is written in. */
export const formatForSource = (doc: string) =>
  VIA_DOCUMENT_FORMATS.find((format) => format.sources.includes(doc)) ?? null
