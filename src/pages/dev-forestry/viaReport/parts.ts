/**
 * The parts VIA reports are assembled from. The reference reports (01-07, 21-23, 26) share most of them: a cover, the
 * project and inventory tables, the regulation's criteria, the method, the viewpoint and landform tables, a
 * calculation per viewpoint, the 2001 form's four assessments or the 2022 handbook's Appendix 1, the block
 * discussion, a conclusion, limitations, sign-off and figures. Each part fills itself from one `ReportContext`; a
 * report is an ordered recipe of part ids (`recipes.ts`).
 *
 * The run fills what it measures; the reviewer's step 4 record fills judgements at the assessment station only; office
 * fields come from the FS1252 office information. Anything else prints blank and is listed as to complete. No DOM or
 * network access.
 */
import type { AlterationBreakdown } from '../types'
import type { DocumentFacts, ResolvedDocument, ResolvedViewpoint } from '../viaDocument/resolve'
import { andList, blockList, otherPlannedName } from '../viaDocument/resolve'
import { atAssessmentStation } from '../viaDocument/facts'
import {
  CLASS_NAMES,
  DISTANCE_SCALES,
  PERCENT_SCALES,
  handbookClass,
  readPercent,
  type ClassCode,
} from '../viaDocument/scales'
import { fillSentence, IMPACT_TERMS, type Sentence } from '../viaDocument/wording'
import {
  RETENTION_LEVELS,
  SCALE_TERMS,
  SHAPE_TERMS,
  VISIBLENESS_TERMS,
  type ViaAssessment,
  type ViaReview,
} from '../via'
import {
  criteriaMatrix,
  designElementsMatrix,
  distanceTable,
  effectsTable,
  extentMatrix,
  partialCutMatrix,
  type PartialCutGuide,
  clearcutGuide,
  pmmArrow,
  retentionMatrix,
  roadsMatrix,
  significanceTable,
  table2Bar,
  vocabularyTables,
} from './matrices'
import {
  field,
  fields,
  heading,
  text,
  type FieldRow,
  type ReportBlock,
  type ReportFigure,
  type ReportItemToComplete,
} from './model'

/** The FS1252 office information, as the scene keeps it (`FormMetadata`). */
export type OfficeFields = Partial<
  Record<
    | 'district'
    | 'licensee'
    | 'licence'
    | 'cuttingPermit'
    | 'blockIds'
    | 'generalLocation'
    | 'resultsOpeningId'
    | 'sampleCode'
    | 'vliPolygon'
    | 'vsc'
    | 'evc'
    | 'recommendedVqc'
    | 'sourceDocument'
    | 'evaluator'
    | 'lakeManagementZone'
    | 'inventoryDate',
    string
  >
>

export interface ReportBlockFacts {
  name: string
  areaHa: number
  system: string
  retentionPercent: number | null
  partialCut: { removedPercent: number; residualHeightM: number } | null
  /**
   * Internal retention patches (islands of timber) inside the block: the `retained` masks that lie within it. Absent
   * when not counted; 0 says the block keeps none.
   */
  islands?: number
  /** The block's planned harvest year (step 3's assessment years), when recorded. */
  plannedHarvestYear?: number | null
}

/**
 * What the scene records about a landform beyond its outline, by the name the viewpoints read it under: the
 * reviewer's description, its own EVC where it differs from the unit's, and, for a sub-landform, the landform it is
 * part of and what divides it (a draw, a creek). All optional.
 */
export interface ReportLandformNote {
  name: string
  description?: string | null
  evc?: string | null
  parent?: string | null
  divider?: string | null
}

export interface ReportContext {
  date: Date
  office: OfficeFields
  blocks: readonly ReportBlockFacts[]
  landform: { name: string; objective: ClassCode | null; vac: string | null; areaHa: number; source: string } | null
  /** Every landform and sub-landform the scene describes (`ReportLandformNote`); absent when it describes none. */
  landforms?: readonly ReportLandformNote[]
  /** The inventory unit the figures were read against, when the inventory was read and holds one. */
  inventory: { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string } | null
  /** The visual inventory was read for the area: "no unit" is then a finding, not a gap. */
  inventoryRead: boolean
  facts: DocumentFacts
  /** The VIA document format filled from the same facts (`viaDocument/resolve.ts`). */
  document: ResolvedDocument
  assessment: ViaAssessment | null
  review: ViaReview | null
  /** The run's breakdown at the assessment station: (a) proposed, (b) roads, (c) existing. */
  breakdown: AlterationBreakdown | null
  /** `drawnBy`: who drew the figures when it was not PGMaps' own map ("threejs-worldgen, final quality, 24 samples"). */
  method: { terrain: string; vegetation: string; eyeHeightM: number; drawnBy?: string | null }
  /** The reviewer's signed visual measures, one per line. */
  measures: readonly string[]
  figures: readonly ReportFigure[]
  /** The parts of the report being assembled (`assembleReport` sets it), so a part can leave out what another shows. */
  recipeParts?: readonly string[]
  /** How the recipe draws what a part can draw more than one way (`ReportRecipe.options`); set by `assembleReport`. */
  recipeOptions?: {
    partialCutGuide?: PartialCutGuide
    /** Figure pages show their before and after pictures as panoramas this many times as wide as tall (26). */
    figurePanorama?: number
  }
  /**
   * Maps and extra pictures the page captured for the report (`useVisualsExport`); all optional, a part without the
   * one it needs prints a placeholder and lists it to complete.
   */
  images?: ReportImages
}

/** Pictures beyond each view's analysis figure, by kind; keys of the per-viewpoint maps are viewpoint names. */
export interface ReportImages {
  /** The blocks, viewpoints and visual inventory on one map (01 p6 VLI map, 22 Appendix A1, 26 Figure 1). */
  overviewMap?: ReportFigure | null
  /**
   * The overview as an 11 x 17 topographic sheet (vector basemap, no imagery; 05's 1:40,000 map, 22/23's Appendix A1),
   * 17:11 so it prints on its own sheet page. Recipes that carry one print it in place of `overviewMap`.
   */
  overviewSheet?: ReportFigure | null
  /** A smaller-scale map placing the project in its region (26). */
  regionalMap?: ReportFigure | null
  /** Per viewpoint: a location map with the view's wedge (26's figure pages). */
  locationMaps?: Readonly<Record<string, ReportFigure>>
  /** Per viewpoint: the scene before the proposal, a lined-up field photo or a before-harvest render. */
  before?: Readonly<Record<string, ReportFigure & { source: 'photo' | 'render' }>>
  /** Overhead and oblique renders of the blocks (01 p7 model confirmation). */
  overhead?: readonly ReportFigure[]
  /**
   * Per viewpoint: the simulation as a plain picture (the view's framed capture, no outlines or calculation), for
   * "after" beside "before"; a part falls back to the view's analysis figure without it.
   */
  after?: Readonly<Record<string, ReportFigure>>
}

export interface PartOutput {
  blocks: ReportBlock[]
  toComplete?: string[]
}

export interface ReportPart {
  id: string
  title: string
  /** Reference documents that print it. */
  sources: readonly string[]
  build: (ctx: ReportContext) => PartOutput
}

// ------------------------------------------------------------------ helpers

export const blank = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null)
export const officeRow = (ctx: ReportContext, key: keyof OfficeFields, label: string): FieldRow =>
  field(label, blank(ctx.office[key]), 'scene')
export const missingFields = (rows: FieldRow[]) => rows.filter((row) => row.value === null).map((row) => row.label)

/**
 * Where a figure stands against the objective's range, in words: within it, over it, or below it (a figure under the
 * range's lower bound is within what the objective allows, never "within the PR 1.6-7% range").
 */
export function rangeStanding(code: ClassCode | null, objective: ClassCode, range: string | null | undefined): string {
  const name = CLASS_NAMES[objective]
  const shown = range?.trim() ? ` (${range.trim()})` : ''
  if (!code) return `against the ${name} range${shown}`
  const at = CLASS_ORDER.indexOf(code),
    limit = CLASS_ORDER.indexOf(objective)
  if (at > limit) return `over the ${name} range${shown}`
  if (at < limit) return `below the ${name} range${shown}, within what ${name} allows`
  return `within the ${name} range${shown}`
}

export const paragraph = (sentences: Sentence[]): ReportBlock[] =>
  sentences.some((s) => s.text) ? [{ kind: 'paragraph', sentences: sentences.filter((s) => s.text) }] : []

export const ha = (value: number) => value.toFixed(1)
export const objectiveOf = (ctx: ReportContext): ClassCode | null =>
  ctx.landform?.objective ?? ((ctx.inventory?.vqo as ClassCode | undefined) || null)
export const objectiveName = (ctx: ReportContext) => {
  const code = objectiveOf(ctx)
  return code ? `${CLASS_NAMES[code]} (${code})` : null
}

/** The viewpoint standing at the run's assessment station, whose figures the reviewer's record judges. */
export const assessed = (ctx: ReportContext) => ctx.facts.viewpoints.find(atAssessmentStation)
export const resolved = (ctx: ReportContext, name: string): ResolvedViewpoint | undefined =>
  ctx.document.viewpoints.find((vp) => vp.name === name)
export const figureFor = (ctx: ReportContext, name: string) =>
  ctx.figures.find((figure) => figure.view === name || figure.caption.includes(name)) ?? null

export const yesNo = (value: boolean | null) => (value === null ? null : value ? 'Yes' : 'No')

/** A scene block planned under another sale or permit (`DocumentFacts`' flag, or its name): assessed elsewhere. */
export const isOtherPlannedBlock = (ctx: ReportContext, name: string) =>
  !!otherPlannedName(name) || (ctx.document.otherPlanned?.blocks ?? []).includes(name)
/** The blocks this report assesses: the scene's blocks less those of another sale or permit. */
export const proposedBlocks = (ctx: ReportContext) =>
  ctx.blocks.filter((block) => !isOtherPlannedBlock(ctx, block.name))
/** The scene's facts for a block by the name a sentence or table prints. */
export const blockFacts = (ctx: ReportContext, id: string) =>
  ctx.blocks.find((block) => block.name === id || otherPlannedName(block.name)?.id === id) ?? null

/** Each landform name the viewpoints read, in order of first reading. */
export const landformNames = (ctx: ReportContext) => [...new Set(ctx.facts.viewpoints.map((vp) => vp.landform))]
export const landformNote = (ctx: ReportContext, name: string) =>
  ctx.landforms?.find((note) => note.name === name) ?? null
/**
 * The landform a sub-landform belongs to: the scene's record, else its name read the references' way ("Landform 1b"
 * and "Sub-landform 1a" belong to Landform 1). Null for a landform that is not a sub-landform.
 */
export function landformParent(ctx: ReportContext, name: string): string | null {
  const recorded = landformNote(ctx, name)?.parent
  if (recorded) return recorded
  // A trailing note in brackets ("Landform 1b (consultant, traced)") is the outline's source, not part of the name.
  const named = name.match(/^(?:sub-?\s*landform|landform)\s+(\d+)[a-z](?:\s*\(.*\))?$/i)
  return named ? `Landform ${named[1]}` : null
}

/**
 * How the landform was bounded, in words, from where the scene says it came from: the visual inventory, a terrain
 * candidate the reviewer adopted, an outline traced on the map, an imported file, or a stored sample case.
 */
export function landformBounding(ctx: ReportContext): string {
  const names = landformNames(ctx)
  if (!names.length && ctx.landform) names.push(ctx.landform.name)
  if (!names.length) return 'No landform was outlined, so no percent alteration is measured.'
  const source = (ctx.landform?.source ?? '').trim()
  const traced = /\b(traced|drawn|digiti[sz]ed|outlined|step 1)\b/i
  const inventory = /visual landscape inventory|\bVLI\b|\bVSU\b|sensitivity unit/i
  const imported = /import|file|shapefile|kml|gdb/i
  const TRACED =
    'outlined on the map as seen from each viewpoint, following the skyline, shorelines and major breaks in the terrain such as ridges, valleys and draws'
  const INVENTORY = 'taken from the visual sensitivity units of the visual landscape inventory'
  const bySource = inventory.test(source)
    ? `${INVENTORY} (${source})`
    : /terrain|candidate|skyline|ridge|visible face/i.test(source)
      ? `proposed from the terrain as seen from the viewpoints, along skylines, ridges and draws, and adopted by the reviewer (${source})`
      : traced.test(source)
        ? TRACED
        : imported.test(source)
          ? `imported from ${source}`
          : source
            ? `taken as recorded with the scene (${source})`
            : 'outlined on the map'
  // A landform's own name can say how it was made ("Landform 5a (traced)", "VSU 1083"); the scene's source says
  // the rest. Mixed sets are said in parts.
  const how = (name: string) => (/^\s*VSU\b/i.test(name) ? INVENTORY : traced.test(name) ? TRACED : bySource)
  const groups = new Map<string, string[]>()
  for (const name of names) groups.set(how(name), [...(groups.get(how(name)) ?? []), name])
  const subject = (list: string[]) =>
    list.length === names.length
      ? list.length > 1
        ? `The ${NUMBER_WORDS[list.length] ?? list.length} landforms the viewpoints read were`
        : `${list[0]} was`
      : `${andList(list)} ${list.length > 1 ? 'were' : 'was'}`
  const clauses = [...groups].map(([way, list]) => `${subject(list)} ${way}`)
  return `${clauses.join('; ')}.`
}
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** The inventory unit adopted for the landform, in a sentence; null when no unit was read. */
export function inventoryAdoption(ctx: ReportContext): Sentence | null {
  const unit = ctx.inventory
  if (!unit?.vsu) return null
  return fillSentence(
    'inventory-adopted',
    '{landform} takes visual sensitivity unit {vsu} from the visual landscape inventory: sensitivity class {vsc}, absorption capability {vac}, existing visual condition {evc} and an established objective of {vqo}.',
    {
      landform: ctx.landform?.name ?? 'The landform',
      vsu: unit.vsu,
      vsc: unit.vsc,
      vac: unit.vac,
      evc: unit.evc,
      vqo: unit.vqo,
    },
    'run',
  )
}
export const CLASS_ORDER: readonly ClassCode[] = ['P', 'R', 'PR', 'M', 'MM']

/** A compass bearing as the forms print it, three digits ("030"). */
const bearing3 = (deg: number) => String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')
/**
 * The view's direction as the 2001 forms print it, the field's left and right edges ("315°–030°"), from the camera's
 * centre line and horizontal field; the centre line alone without a field. Blank when the run has no bearing.
 */
export function viewDirection(vp: { bearingDeg?: number | null; hfovDeg?: number | null }): string {
  if (vp.bearingDeg === null || vp.bearingDeg === undefined) return ''
  const half = vp.hfovDeg ? vp.hfovDeg / 2 : 0
  return half > 0
    ? `${bearing3(vp.bearingDeg - half)}°–${bearing3(vp.bearingDeg + half)}°`
    : `${bearing3(vp.bearingDeg)}°`
}
/** The eye's elevation above sea level, metres, as printed; blank when the run does not know it. */
export const eyeElevation = (vp: { elevationM?: number | null }) =>
  vp.elevationM === null || vp.elevationM === undefined ? '' : `${Math.round(vp.elevationM)} m`

// ------------------------------------------------------------------ parts

const cover: ReportPart = {
  id: 'cover',
  title: 'Cover',
  sources: ['01', '02', '03', '05', '06', '22', '23', '26'],
  build: (ctx) => {
    const rows = [
      officeRow(ctx, 'licensee', 'Prepared for'),
      officeRow(ctx, 'evaluator', 'Prepared by'),
      officeRow(ctx, 'licence', 'Licence'),
      officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
      field(
        'Blocks',
        ctx.office.blockIds ||
          proposedBlocks(ctx)
            .map((block) => block.name)
            .join(', '),
        'scene',
      ),
      officeRow(ctx, 'district', 'Natural resource district'),
      officeRow(ctx, 'generalLocation', 'General location'),
      field('Date', ctx.date.toISOString().slice(0, 10), 'run'),
    ]
    return { blocks: [fields(rows)], toComplete: missingFields(rows) }
  },
}

const projectInformation: ReportPart = {
  id: 'project-information',
  title: 'Project information',
  sources: ['01', '05', '06'],
  build: (ctx) => ({
    blocks: [
      heading('Project information'),
      {
        kind: 'table',
        columns: ['Block', 'Gross area (ha)', 'Retention', 'Net area (ha)', 'Harvest system'],
        rows: ctx.blocks.map((block) => [
          block.name,
          ha(block.areaHa),
          block.retentionPercent === null ? '' : `${block.retentionPercent}%`,
          block.retentionPercent === null ? ha(block.areaHa) : ha(block.areaHa * (1 - block.retentionPercent / 100)),
          block.system,
        ]),
        note: 'Net area is gross less recorded retention; areas are planar BC Albers.',
        source: 'scene',
      },
    ],
  }),
}

const inventory: ReportPart = {
  id: 'inventory',
  title: 'Visual resource management',
  sources: ['01', '03', '05', '22', '23'],
  build: (ctx) => {
    const unit = ctx.inventory
    const objective = objectiveOf(ctx)
    const evc = (unit?.evc as ClassCode | undefined) ?? null
    const exceeds =
      evc && objective && CLASS_ORDER.includes(evc) ? CLASS_ORDER.indexOf(evc) > CLASS_ORDER.indexOf(objective) : null
    const rows = [
      field('Landform', ctx.landform?.name, 'scene'),
      field('VLI polygon / VSU', unit?.vsu ?? ctx.office.vliPolygon, unit?.vsu ? 'run' : 'scene'),
      field('Visual sensitivity class', unit?.vsc ?? ctx.office.vsc, unit?.vsc ? 'run' : 'scene'),
      field('Visual absorption capability', unit?.vac ?? ctx.landform?.vac, 'run'),
      field('Existing visual condition', unit?.evc ?? ctx.office.evc, unit?.evc ? 'run' : 'scene'),
      field('Established VQO', objectiveName(ctx), 'scene'),
      field('Objective source', ctx.office.sourceDocument, 'scene'),
    ]
    const blocks: ReportBlock[] = [heading('Visual resource management'), fields(rows)]
    const adopted = inventoryAdoption(ctx)
    if (adopted) blocks.push(...paragraph([adopted]))
    if (!ctx.inventoryRead)
      blocks.push(text('The visual inventory was not read for this report; its values are the office fields.', 'run'))
    blocks.push({
      kind: 'choices',
      label: 'Does the existing visual condition exceed the established VQO?',
      options: ['Yes', 'No'],
      chosen: yesNo(exceeds),
      source: 'run',
    })
    return { blocks, toComplete: missingFields(rows) }
  },
}

const currentEvc: ReportPart = {
  id: 'current-evc',
  title: 'Current existing visual condition',
  sources: ['01'],
  // 01's footnote: the current EVC is "determined by the site photography and simulations completed as part of this
  // assessment", so the arrow reads the class pass's existing openings short of green-up, at the viewpoint showing
  // the most. The reviewer confirms it.
  build: (ctx) => {
    const readings = ctx.facts.viewpoints
      .map((vp) => ({
        name: vp.name,
        percent: vp.areas && vp.areas.landform > 0 ? (100 * vp.areas.nonVeg) / vp.areas.landform : null,
      }))
      .filter((entry): entry is { name: string; percent: number } => entry.percent !== null)
    const most = readings.reduce<(typeof readings)[number] | null>(
      (a, b) => (!a || b.percent > a.percent ? b : a),
      null,
    )
    const code = most ? handbookClass(most.percent) : null
    return {
      blocks: [
        pmmArrow('Current (non-inventory) existing visual condition', code, 'run', most?.percent ?? null),
        ...(!most
          ? []
          : [
              text(
                most.percent > 0
                  ? `Marked from the simulation: existing openings short of visual green-up cover ${most.percent.toFixed(2)}% of the landform seen from ${most.name}${readings.length > 1 ? ', the most of any viewpoint' : ''}. The reviewer confirms the class.`
                  : `Marked from the simulation: no existing opening short of visual green-up is seen from ${readings.length > 1 ? 'any viewpoint' : most.name}. The reviewer confirms the class.`,
                'run',
              ),
            ]),
      ],
      toComplete: most ? ['Current existing visual condition: confirm the class marked from the simulation'] : [],
    }
  },
}

const regulatoryFrame: ReportPart = {
  id: 'regulatory-frame',
  title: 'Regulatory frame',
  sources: ['06', '21', '22', '23'],
  build: (ctx) => ({
    blocks: [
      heading('Visual quality objectives'),
      text(
        `The visual quality objective for the landform is ${objectiveName(ctx) ?? 'not recorded'}${
          ctx.office.sourceDocument ? `, established by ${ctx.office.sourceDocument}` : ''
        }. FPPR s. 1.1 defines each objective by how visible, how large and how designed an alteration may be when assessed from a significant public viewpoint.`,
        'scene',
      ),
      criteriaMatrix(objectiveOf(ctx)),
    ],
    toComplete: ctx.office.sourceDocument ? [] : ['Objective source document'],
  }),
}

const threeElements: ReportPart = {
  id: 'three-elements',
  title: 'The three elements of the definition',
  sources: ['22', '23'],
  build: () => ({
    blocks: [
      heading('Assessing the definition'),
      {
        kind: 'list',
        items: [
          'Visibility: how easy the alteration is to see, given where it sits, where the viewpoints are, its size, how distinct it is from the landscape around it, screening in front of it, and how long and how directly it is viewed.',
          'Size and scale: the alteration against the visible area of the landform, judged by eye and measured as the percent of the landform altered in perspective view.',
          'Design: the shape and position of the alteration on the landform, its response to the lines of force of the terrain, and whether it borrows from the natural character of the landscape.',
        ],
        source: 'fixed',
      },
      text(
        'The three are considered together, and the extent the objective is met is a judgement on all three; the percent alteration is a measure of one of them.',
      ),
    ],
  }),
}

const extentScale: ReportPart = {
  id: 'extent-scale',
  title: 'Extent the objective is met',
  sources: ['06', '07', '22', '23'],
  build: (ctx) => ({ blocks: [extentMatrix(ctx.assessment?.rating?.id ?? null)] }),
}

const vocabulary: ReportPart = {
  id: 'vocabulary',
  title: 'Terms',
  sources: ['22', '23'],
  build: () => ({ blocks: [heading('Terms used', 3), ...vocabularyTables(), significanceTable()] }),
}

const methodology: ReportPart = {
  id: 'methodology',
  title: 'Methods',
  sources: ['05', '06', '22', '23'],
  build: (ctx) => {
    const format = ctx.document.format
    const lens = ctx.facts.viewpoints.find((vp) => vp.lensMm)?.lensMm
    return {
      blocks: [
        heading('Methods'),
        text(
          `Each viewpoint was simulated in PGMaps from ${ctx.method.terrain}, with timber drawn from ${ctx.method.vegetation}, at an eye height of ${ctx.method.eyeHeightM.toFixed(1)} m${
            ctx.method.drawnBy ? `; the figures were drawn by ${ctx.method.drawnBy} from the same scene and camera` : ''
          }${lens ? ` and a ${Math.round(lens)} mm (35 mm equivalent) lens` : ''}. ${landformBounding(ctx)}`,
          'run',
        ),
        text(
          `Percent alteration is measured two ways. The sightline figure is the share of the landform's ground the viewpoint sees that is altered, traced along terrain sightlines; it is the assessment's figure. The pixel figure counts the same classes on a flat-colour pass of the simulation's own camera, as ${format.rule.formula} (${format.rule.basis}), so it measures what that picture shows.`,
          'run',
        ),
        text(
          'A landform is a distinct topographic feature, a sub-unit of the broader landscape, three-dimensional in form and delineated in perspective view from a significant public viewpoint: the part of the view the alteration is measured against.',
          'fixed',
        ),
        text(
          'Existing openings count until they are visually greened up (handbook 3.4.2); proposed blocks count less their mapped retention.',
          'fixed',
        ),
        text(
          'The assessment follows the Visual Impact Assessment Handbook (2022) and the visual quality objective definitions of FPPR s. 1.1: visibility, scale and design are judged together, and the percent alteration measures scale.',
          'fixed',
        ),
        text(
          [
            format.rule.deduct.includes('privateLand')
              ? 'Private land inside the landform is left out of the percent alteration’s denominator: the objective does not govern it, and its cover may change without notice.'
              : 'Private land inside the landform is counted as part of it.',
            format.rule.deduct.includes('rock')
              ? 'Rock and other non-vegetated ground is left out of the denominator too.'
              : '',
          ]
            .filter(Boolean)
            .join(' '),
          'run',
        ),
      ],
    }
  },
}

/** The 2001 form's viewpoint table, one column per viewpoint (01, 03, 05). */
const viewpointsColumns: ReportPart = {
  id: 'viewpoints-columns',
  title: 'Viewpoints and photograph information',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const vps = ctx.facts.viewpoints
    const row = (label: string, value: (vp: (typeof vps)[number]) => string) => [label, ...vps.map(value)]
    return {
      blocks: [
        heading('Viewpoints and photograph information'),
        {
          kind: 'table',
          columns: ['', ...vps.map((vp, i) => `VP ${vp.n ?? i + 1}`)],
          rows: [
            row('Viewpoint', (vp) => vp.name),
            row('Importance', (vp) => vp.review?.importance ?? ''),
            row('Location (lat, long)', (vp) =>
              vp.lngLat ? `${vp.lngLat[1].toFixed(5)}, ${vp.lngLat[0].toFixed(5)}` : '',
            ),
            row('Distance', (vp) => {
              if (vp.distanceKm === null) return ''
              const zone = resolved(ctx, vp.name)?.distance?.term
              return `${vp.distanceKm.toFixed(1)} km${zone ? ` (${zone})` : ''}`
            }),
            row('Duration', (vp) => vp.review?.duration ?? ''),
            row('Viewpoint elevation', eyeElevation),
            row('Lens', (vp) => (vp.lensMm ? `${Math.round(vp.lensMm)} mm` : '')),
            row('Direction of view', viewDirection),
            row('Viewing angle (horizontal field)', (vp) => (vp.hfovDeg ? `${vp.hfovDeg.toFixed(0)}°` : '')),
          ],
          note: 'Importance and duration are the reviewer’s; elevation, direction and angle the simulation camera’s.',
          source: 'run',
        },
      ],
      toComplete: vps.some((vp) => !vp.review?.importance) ? ['Viewpoint importance and duration'] : [],
    }
  },
}

const documentTables: ReportPart = {
  id: 'assessment-tables',
  title: 'Assessment tables',
  sources: ['02', '04', '09', '22', '23'],
  build: (ctx) => {
    const others = ctx.document.otherPlanned?.blocks ?? []
    const group = ctx.document.keyViewpoints?.choice.group
    return {
      blocks: ctx.document.format.tables.map((table) => {
        // Islands are the reviewer's to rate: a scene that maps no retention patch says nothing about what is kept.
        const rows = ctx.document.viewpoints.flatMap((vp) => vp.rows[table.id] ?? [])
        const lead =
          table.id === 'detailed-assessment'
            ? group
              ? [
                  `${blockList(group.blocks)} at their shared key viewpoint${
                    ctx.document.keyViewpoints!.choice.byBlock.size > group.blocks.length
                      ? ', any other block at its own'
                      : ''
                  }, each above its landform’s row.`,
                ]
              : ['Each block at its key viewpoint, above its landform’s row.']
            : []
        const marked = table.id === 'initial-assessment' && others.length
        const notes = [
          ...lead,
          ...(table.footnotes ?? []),
          ...(marked ? ['* Planned under another sale or cutting permit and assessed in its own VIA.'] : []),
        ]
        return {
          kind: 'table' as const,
          title: table.title,
          columns: [...table.columns],
          rows: rows.map((row) => table.columns.map((c) => row[c] ?? '')),
          ...(notes.length ? { note: notes.join(' ') } : {}),
          source: 'run' as const,
        }
      }),
    }
  },
}

/** One calculation per viewpoint: the format's rule on the class pass, beside the sightline figure. */
const calculations: ReportPart = {
  id: 'calculations',
  title: 'Calculations',
  sources: ['03', '05', '06', '07', '09', '22', '23'],
  build: (ctx) => {
    const blocks: ReportBlock[] = [heading('Calculations')]
    const rule = ctx.document.format.rule
    for (const vp of ctx.facts.viewpoints) {
      const out = resolved(ctx, vp.name)
      const a = vp.areas
      const result = out?.alteration
      blocks.push(heading(vp.name, 3))
      const figure = figureFor(ctx, vp.name)
      if (figure) blocks.push({ kind: 'figure', figure, caption: figure.caption })
      blocks.push(
        fields([
          field('Landform', a ? `${a.landform} px` : null, 'run'),
          ...(rule.deduct.length && a
            ? [
                field(
                  `Less ${rule.deduct.map((d) => (d === 'rock' ? 'rock' : 'private land')).join(' and ')}`,
                  `${result ? a.landform - result.denominator : 0} px`,
                  'run' as const,
                ),
              ]
            : []),
          field('Net landform', result ? `${result.denominator} px` : null, 'run'),
          field('Proposed blocks', a ? `${a.proposed} px` : null, 'run'),
          field('Existing openings not greened up', a ? `${a.nonVeg} px` : null, 'run'),
          field(
            `Alteration, ${rule.formula}`,
            out?.printed
              ? `${out.printed.percent}% (${out.printed.classCode ? CLASS_NAMES[out.printed.classCode] : out.printed.term})`
              : null,
            'run',
          ),
          // The second pixel figure, with the drawn timber in front, beside the first; never instead of it.
          ...(out?.withTimber
            ? [
                field(
                  'Pixel figure, with drawn timber',
                  'percent' in out.withTimber ? `${out.withTimber.percent}%` : `Not measured: ${out.withTimber.absent}`,
                  'run' as const,
                ),
              ]
            : []),
          field(
            'Sightline figure (the assessment’s)',
            vp.sightlinePercent === null ? null : `${vp.sightlinePercent.toFixed(2)}%`,
            'run',
          ),
        ]),
      )
    }
    return { blocks }
  },
}

/**
 * 2001 form section 1 (03, 05): the level of impact and the FPPR terms by eye, a column per viewpoint; then the one
 * class the alteration meets from all the viewpoints, and a line for the reasons it falls short. The terms are the
 * reviewer's at the assessment station; a viewpoint that sees none of the blocks reads "Not visible" from the run.
 */
const basicDefinition: ReportPart = {
  id: 'basic-definition',
  title: 'Assessing the basic VQO definition',
  sources: ['03', '05'],
  build: (ctx) => {
    const vps = ctx.facts.viewpoints
    const ocular = ctx.review?.ocular ?? null
    const hidden = (vp: (typeof vps)[number]) =>
      vp.blocks.length > 0 && vp.blocks.every((block) => block.status === 'not visible')
    const term = (vp: (typeof vps)[number], value: (at: (typeof vps)[number]) => string | undefined) =>
      hidden(vp) ? 'Not visible' : atAssessmentStation(vp) ? (value(vp) ?? '') : ''
    const line = (label: string, value: (vp: (typeof vps)[number]) => string) => [label, ...vps.map(value)]
    const rows = [
      line(`Level of impact (${IMPACT_TERMS.join(', ')})`, (vp) => term(vp, (at) => at.review?.impact)),
      line('Visibility', (vp) => term(vp, () => VISIBLENESS_TERMS.find((t) => t.id === ocular?.visibleness)?.label)),
      line('Scale', (vp) =>
        hidden(vp) ? 'N/A' : term(vp, () => SCALE_TERMS.find((t) => t.id === ocular?.scale)?.label),
      ),
      line('Design', (vp) =>
        hidden(vp) ? 'N/A' : term(vp, () => SHAPE_TERMS.find((t) => t.id === ocular?.shape)?.label),
      ),
    ]
    const code = ctx.assessment?.ocular ? (CLASS_CODES_BY_ID[ctx.assessment.ocular.classId] ?? null) : null
    const missing = vps.filter((_, i) => rows.some((row) => !row[i + 1])).map((vp) => vp.name)
    return {
      blocks: [
        heading('1. Assessing the basic VQO definition'),
        {
          kind: 'table',
          columns: ['Describe the level of impact from each viewpoint', ...vps.map((vp, i) => `VP ${vp.n ?? i + 1}`)],
          rows,
          note: 'Terms by eye are the reviewer’s (step 4, at the assessment station); Not visible is the run’s.',
          source: 'reviewer',
        },
        {
          kind: 'choices',
          label:
            'Which basic VQO definition would the proposed alteration, in combination with any existing non-VEG alterations, meet from all the selected viewpoints, taking into account viewpoint importance, viewing distance and viewing duration?',
          options: [...CLASS_ORDER],
          chosen: code,
          source: 'reviewer',
        },
        fields([
          field(
            'If applicable, state reasons why the proposed alteration(s) does not achieve the basic definition of the established VQO from any of the selected viewpoints',
            null,
            'reviewer',
          ),
        ]),
      ],
      toComplete: [
        ...(missing.length ? [`Level of impact and FPPR terms by eye: ${andList(missing)}`] : []),
        ...(code ? [] : ['Basic VQO definition met from all viewpoints (class by eye, step 4)']),
      ],
    }
  },
}

export const CLASS_CODES_BY_ID: Record<string, ClassCode> = {
  preservation: 'P',
  retention: 'R',
  'partial-retention': 'PR',
  modification: 'M',
  'maximum-modification': 'MM',
}

/** 2001 form section 2 / the 2022 Table 3: visual design. */
const visualDesign: ReportPart = {
  id: 'visual-design',
  title: 'Assessing visual design',
  sources: ['01', '03', '05', '06', '07'],
  build: (ctx) => {
    const ratings = ctx.assessment
      ? Object.fromEntries(Object.entries(ctx.assessment.design).map(([id, entry]) => [id, entry.rating]))
      : (ctx.review?.design ?? null)
    return {
      blocks: [heading('2. Assessing visual design'), designElementsMatrix(ratings, 'reviewer')],
      toComplete: ctx.assessment?.designTotal === null || !ctx.assessment ? ['Design element ratings (step 4)'] : [],
    }
  },
}

/** 2001 form section 3: the numerical worksheet, per viewpoint, with the partial-cut table when a block is cut so. */
const numericalData: ReportPart = {
  id: 'numerical-data',
  title: 'Assessing numerical data',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const blocks: ReportBlock[] = [heading('3. Assessing numerical data')]
    // The clearcut worksheet as the 2001 forms print it: its four lines down the side, a column per viewpoint.
    const vps = ctx.facts.viewpoints
    if (vps.length) {
      const line = (label: string, value: (vp: (typeof vps)[number]) => string) => [label, ...vps.map(value)]
      const px = (value: number | undefined) => (value === undefined ? '' : `${value} px`)
      blocks.push({
        kind: 'table',
        title: 'Percent alteration worksheet',
        columns: ['', ...vps.map((vp, i) => `VP ${vp.n ?? i + 1}: ${vp.name}`)],
        rows: [
          line(`1. Area of landform (${ctx.document.format.rule.basis})`, (vp) =>
            px(vp.areas ? (resolved(ctx, vp.name)?.alteration?.denominator ?? vp.areas.landform) : undefined),
          ),
          line('2. Proposed alteration', (vp) => px(vp.areas?.proposed)),
          line('3. Existing alteration not greened up', (vp) => px(vp.areas?.nonVeg)),
          line('4. Percent alteration ((2 + 3) / 1)', (vp) => {
            const printed = resolved(ctx, vp.name)?.printed
            return printed ? `${printed.percent}%` : ''
          }),
        ],
        note: 'Pixels of each view’s class pass, on the format’s arithmetic.',
        source: 'run',
      })
    }
    // The poster's clearcut guide beside its partial-cut table, read at the highest viewpoint's alteration.
    if (ctx.blocks.some((block) => block.system === 'Clearcut')) {
      const readings = ctx.document.viewpoints
        .map((vp) => (vp.printed ? Number(vp.printed.percent) : NaN))
        .filter((value) => Number.isFinite(value))
      const highest = readings.length ? Math.max(...readings) : null
      blocks.push(
        heading('Clearcut harvesting', 3),
        clearcutGuide(highest, 'run', readings.length > 1 ? 'Highest viewpoint alteration' : undefined),
      )
    }
    const cut = ctx.blocks.find((block) => block.partialCut)?.partialCut ?? null
    // The partial-cut table only when a block is cut so; otherwise the form's evaluation lines, answered from the scene.
    blocks.push(
      heading('Partial cutting', 3),
      cut
        ? partialCutMatrix(cut, ctx.recipeOptions?.partialCutGuide)
        : fields([
            field(
              'What percent volume or stems retention is proposed?',
              'Not applicable: no block is recorded as a partial cut',
              'scene',
            ),
          ]),
    )
    return { blocks }
  },
}

/** 2001 form's summary: four questions, answered where the run or the reviewer answers them. */
const summary2001: ReportPart = {
  id: 'summary-2001',
  title: 'VIA summary',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const vp = assessed(ctx) ?? ctx.facts.viewpoints[0]
    const out = vp ? resolved(ctx, vp.name) : undefined
    const objective = objectiveOf(ctx)
    const within =
      out?.printed?.classCode && objective
        ? CLASS_ORDER.indexOf(out.printed.classCode) <= CLASS_ORDER.indexOf(objective)
        : null
    const rating = ctx.assessment?.rating ?? null
    const ocular = ctx.assessment?.ocular ?? null
    const definition =
      ocular && objective
        ? CLASS_ORDER.indexOf(CLASS_CODES_BY_ID[ocular.classId]) <= CLASS_ORDER.indexOf(objective)
        : null
    const design = ctx.assessment?.designTotal == null ? null : ctx.assessment.designTotal <= 0
    const choices: ReportBlock[] = [
      {
        kind: 'choices',
        label: 'Does the alteration meet the basic definition of the VQO?',
        options: ['Yes', 'No'],
        chosen: yesNo(definition),
        source: 'reviewer',
      },
      {
        kind: 'choices',
        label: 'Is the visual design acceptable?',
        options: ['Yes', 'No'],
        chosen: yesNo(design),
        source: 'reviewer',
      },
      {
        kind: 'choices',
        label: 'Is the alteration within the numerical ranges of the VQO?',
        options: ['Yes', 'No'],
        chosen: yesNo(within),
        source: 'run',
      },
      {
        kind: 'choices',
        label: 'Is the VQO met?',
        options: ['Yes', 'No'],
        chosen: rating ? yesNo(rating.definitionAchieved) : null,
        source: 'reviewer',
      },
    ]
    // The question the run answers is answered in a sentence too, per viewpoint (05's one-line statements); a
    // figure over the range asks for the reasons, which are the reviewer's.
    const range = objective
      ? PERCENT_SCALES.handbookTable2.printed.split(';').find((part) => part.trim().startsWith(objective + ' '))
      : null
    const statements = ctx.document.viewpoints.flatMap((vp) => {
      if (!vp.printed || !objective) return []
      const over = vp.printed.classCode
        ? CLASS_ORDER.indexOf(vp.printed.classCode) > CLASS_ORDER.indexOf(objective)
        : false
      return [
        fillSentence(
          'numeric-statement',
          'From {viewpoint}, the alteration is {percent}% of the {basis}, {standing}.',
          {
            viewpoint: vp.name,
            percent: vp.printed.percent,
            basis: ctx.document.format.rule.basis,
            standing: rangeStanding(vp.printed.classCode, objective, range),
          },
          'run',
        ),
        ...(over
          ? [
              {
                ...fillSentence(
                  'reasons-not-met',
                  'Reasons the alteration exceeds the range from {viewpoint}: {reasons}',
                  { viewpoint: vp.name, reasons: ctx.review?.rationale },
                  'reviewer',
                ),
                about: vp.name,
              },
            ]
          : []),
      ]
    })
    // An over-range viewpoint's reasons are the reviewer's: a line to write them on, named by its viewpoint.
    const reasons = statements.flatMap((sentence) =>
      sentence.id === 'reasons-not-met' && !sentence.text ? [String(sentence.about)] : [],
    )
    return {
      blocks: [
        heading('VIA summary'),
        ...choices,
        ...paragraph(statements),
        ...(reasons.length
          ? [
              fields(
                reasons.map((name) => field(`Reasons the alteration exceeds the range from ${name}`, null, 'reviewer')),
              ),
            ]
          : []),
      ],
      toComplete: [
        ...choices
          .filter((c) => c.kind === 'choices' && c.chosen === null)
          .map((c) => (c.kind === 'choices' ? c.label : '')),
        ...(reasons.length ? [`Reasons the alteration exceeds the numerical range from ${andList(reasons)}`] : []),
      ],
    }
  },
}

/** The 2022 handbook's Appendix 1, for the viewpoint at the assessment station. */
const appendix1: ReportPart = {
  id: 'appendix-1',
  title: 'Appendix 1: VIA summary form',
  sources: ['06', '07'],
  build: (ctx) => {
    const vp = assessed(ctx)
    const a = ctx.assessment
    // The recipe's own Table 7 part prints the extent scale (marked from the same rating): it is not printed twice.
    const tableSevenFollows = !!ctx.recipeParts?.includes('extent-scale')
    if (!vp || !a) {
      // The form still prints, as the handbook lays it out: the office and scene facts filled, every judgement and
      // the viewpoint's own lines blank for the reviewer.
      const site = [
        officeRow(ctx, 'licence', 'Licence'),
        officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
        field(
          'Blocks',
          proposedBlocks(ctx)
            .map((b) => b.name)
            .join(', '),
          'scene',
        ),
        field('Established VQO', objectiveName(ctx), 'scene'),
        officeRow(ctx, 'sourceDocument', 'FSP / objective source'),
      ]
      return {
        blocks: [
          heading('Appendix 1: Visual impact assessment summary form'),
          text(
            'No viewpoint stands at the run’s assessment station with a step 4 record, so the form is not filled: it is printed for the reviewer to complete at the key viewpoint.',
            'run',
          ),
          fields(site, '3.1 Site and objective'),
          fields(
            ['Viewpoint', 'Location', 'Elevation', 'Viewing direction', 'Distance to the alteration', 'Lens'].map(
              (label) => field(label, null, 'reviewer'),
            ),
            '3.2 Viewpoint and simulation',
          ),
          heading('3.4.1 Ocular assessment', 3),
          pmmArrow('Class by eye', null, 'reviewer'),
          heading('3.4.2 Numerical assessment', 3),
          fields([
            field('a) % of landform altered by proposed openings', null, 'run'),
            field('b) % of landform in access roads (outside openings)', null, 'run'),
            field('c) % non-VEG contribution of existing openings', null, 'run'),
          ]),
          table2Bar('Initial percent alteration (X)', null, 'run'),
          heading('3.4.3 Adjustment', 3),
          designElementsMatrix(null, 'reviewer'),
          roadsMatrix(null),
          retentionMatrix(null, 'reviewer'),
          table2Bar('Adjusted percent alteration, X (1 + 0.14 Y)', null, 'reviewer'),
          heading('3.5 Rating and rationale', 3),
          ...(tableSevenFollows ? [] : [extentMatrix(null)]),
          fields([field('3.5.2 Rationale', null, 'reviewer')]),
          { kind: 'signature', lines: ['Evaluated by', 'Signature', 'Date'] },
        ],
        toComplete: ['Step 4 at the assessment station', ...missingFields(site)],
      }
    }
    const a1 = vp.appendix1
    const level = ctx.review?.retention ?? a.retentionMeasured?.level ?? null
    const out = resolved(ctx, vp.name)
    const x = a1?.x ?? null
    const rows = [
      officeRow(ctx, 'licence', 'Licence'),
      officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
      field('Blocks', ctx.blocks.map((b) => b.name).join(', '), 'scene'),
      field('Established VQO', objectiveName(ctx), 'scene'),
      officeRow(ctx, 'sourceDocument', 'FSP / objective source'),
    ]
    const blocks: ReportBlock[] = [
      { kind: 'pageBreak' },
      heading('Appendix 1: Visual impact assessment summary form'),
      fields(rows, '3.1 Site and objective'),
      fields(
        [
          field('Viewpoint', vp.name, 'run'),
          field('Location', vp.lngLat ? `${vp.lngLat[1].toFixed(5)}, ${vp.lngLat[0].toFixed(5)}` : null, 'run'),
          field('Elevation', eyeElevation(vp) || null, 'run'),
          field('Viewing direction', viewDirection(vp) || null, 'run'),
          field('Distance to the alteration', vp.distanceKm === null ? null : `${vp.distanceKm.toFixed(1)} km`, 'run'),
          field('Lens', vp.lensMm ? `${Math.round(vp.lensMm)} mm, ${vp.hfovDeg?.toFixed(1)}° across` : null, 'run'),
          field('Viewpoint importance', vp.review?.importance, 'reviewer'),
        ],
        '3.2 Viewpoint and simulation',
      ),
      heading('3.4.1 Ocular assessment', 3),
      pmmArrow('Class by eye', a.ocular ? CLASS_CODES_BY_ID[a.ocular.classId] : null, 'reviewer'),
      heading('3.4.2 Numerical assessment', 3),
      ...paragraph(out?.sentences.filter((s) => s.id === 'x') ?? []),
      table2Bar('Initial percent alteration (X)', x, 'run'),
      ...(ctx.blocks.some((block) => block.partialCut)
        ? [
            heading('3.4.4 Partial cuts', 3),
            partialCutMatrix(ctx.blocks.find((b) => b.partialCut)!.partialCut, ctx.recipeOptions?.partialCutGuide),
          ]
        : []),
      heading('3.4.3 Adjustment', 3),
      designElementsMatrix(
        Object.fromEntries(Object.entries(a.design).map(([id, entry]) => [id, entry.rating])),
        'reviewer',
      ),
      roadsMatrix(a.roads),
      retentionMatrix(level, ctx.review?.retention ? 'reviewer' : 'scene'),
      ...paragraph(out?.sentences.filter((s) => s.id === 'y') ?? []),
      table2Bar('Adjusted percent alteration, X (1 + 0.14 Y)', a1?.adjusted ?? null, 'reviewer'),
      heading('3.5 Rating and rationale', 3),
      ...(tableSevenFollows ? [] : [extentMatrix(a.rating?.id ?? null)]),
      ...(ctx.review?.rationale ? [text(ctx.review.rationale, 'reviewer')] : []),
      { kind: 'signature', lines: ['Evaluated by', 'Signature', 'Date'] },
    ]
    const toComplete = [...missingFields(rows), ...a.missing]
    return { blocks, toComplete }
  },
}

/** The run's sentence on a block's islands (internal retention patches), and the reviewer's rating of them. */
function islandSentences(ctx: ReportContext, id: string, rating: string | undefined): Sentence[] {
  const count = blockFacts(ctx, id)?.islands
  if (count === undefined) return []
  // The scene maps no retention patch inside the block: it says so, and whether any are kept is the reviewer's.
  if (count === 0)
    return [
      fillSentence(
        'islands-none-recorded',
        'The scene records no islands or patches of timber inside Block {block}; any kept there are the reviewer’s to describe.',
        { block: id },
        'scene',
      ),
    ]
  return [
    fillSentence(
      'islands',
      'Block {block} keeps {count} internal retention patch{es}, islands of timber inside the opening.',
      { block: id, count, es: count === 1 ? '' : 'es' },
      'scene',
    ),
    fillSentence(
      'islands-rating',
      'Their effect in breaking up the opening is rated {rating}.',
      { rating: rating?.toLowerCase() },
      'reviewer',
    ),
  ]
}

/** A sub-landform's place in its landform, said where a block on it is discussed. */
function subLandformSentence(ctx: ReportContext, landform: string | null): Sentence[] {
  const note = landform ? landformNote(ctx, landform) : null
  if (!note?.parent) return []
  return [
    fillSentence(
      'sub-landform',
      note.divider
        ? '{landform} is a sub-landform of {parent}, divided from the rest of it at {divider}; the figure here is the sub-landform’s.'
        : '{landform} is a sub-landform of {parent}; the figure here is the sub-landform’s.',
      { landform: note.name, parent: note.parent, divider: note.divider },
      'scene',
    ),
  ]
}

const blockDiscussion: ReportPart = {
  id: 'block-discussion',
  title: 'Discussion',
  sources: ['22', '23'],
  build: (ctx) => {
    const sections = ctx.document.discussion ?? []
    if (!sections.length)
      return {
        blocks: [
          heading('Discussion'),
          // A viewpoint that is no block's key viewpoint has nothing to discuss: no empty heading for it.
          ...ctx.document.viewpoints.flatMap((vp) => {
            const written = paragraph(vp.sentences)
            return written.length ? [heading(vp.name, 3), ...written] : []
          }),
        ],
      }
    const toComplete: string[] = []
    const blocks: ReportBlock[] = [heading('Discussion')]
    for (const section of sections) {
      const review = ctx.facts.viewpoints.find((vp) => vp.name === section.viewpoint)?.review
      const written = section.paragraphs.flatMap((part, index) => {
        let sentences = [...part.sentences]
        // Islands follow the edge treatments, as the references write them; a sub-landform opens the discussion.
        const edges = sentences.findIndex((s) => s.id === 'edges')
        if (edges >= 0) {
          const islands = section.blocks.flatMap((id) => islandSentences(ctx, id, review?.islands))
          sentences.splice(edges + 1, 0, ...islands)
          toComplete.push(
            ...islands.filter((s) => !s.text).map(() => `${section.heading}: islands rating`),
            ...islands
              .filter((s) => s.id === 'islands-none-recorded')
              .map(() => `${section.heading}: islands or patches of timber kept, if any (none recorded in the scene)`),
          )
        }
        if (index === 0) sentences = [...sentences, ...subLandformSentence(ctx, section.landform)]
        const filled = sentences.filter((s) => s.text)
        if (!filled.length) return []
        const label: Sentence[] = part.label
          ? [{ id: 'label', text: `${part.label} –`, source: 'run', missing: [], template: part.label }]
          : []
        return paragraph([...label, ...filled])
      })
      // A section with nothing written gets no heading.
      if (written.length) blocks.push(heading(section.heading, 3), ...written)
    }
    return { blocks, toComplete }
  },
}

const recommendations: ReportPart = {
  id: 'recommendations',
  title: 'Recommendations',
  sources: ['02', '05', '22'],
  build: (ctx) =>
    ctx.measures.length
      ? {
          blocks: [
            heading('Recommendations'),
            { kind: 'list', items: [...ctx.measures], ordered: true, source: 'reviewer' },
          ],
        }
      : {
          blocks: [heading('Recommendations'), text('No visual measures are signed yet (step 5).', 'reviewer')],
          toComplete: ['Visual measures (step 5)'],
        },
}

const conclusion: ReportPart = {
  id: 'conclusion',
  title: 'Conclusion',
  sources: ['02', '05', '06', '21', '22', '23'],
  build: (ctx) => {
    const rating = ctx.assessment?.rating
    // A format with no conclusion wording of its own (06's Appendix 1 report) concludes on the run's facts.
    const own = ctx.document.summary.filter((s) => s.text)
    const sentences: Sentence[] = [
      ...(own.length ? ctx.document.summary : runConclusion(ctx)),
      fillSentence(
        'rating',
        'The assessment rates the {objective} objective {rating} at the assessment station.',
        { objective: objectiveName(ctx), rating: rating?.label.toLowerCase() },
        'reviewer',
      ),
    ]
    const written = paragraph(sentences)
    return {
      blocks: [
        heading('Conclusion'),
        ...(written.length
          ? written
          : [text('The conclusion is written once the extent the objective is met is rated (step 4).', 'reviewer')]),
      ],
      toComplete: sentences.filter((s) => !s.text).map((s) => `Conclusion: ${s.id}`),
    }
  },
}

/**
 * A conclusion from what the run measured: which viewpoints see the proposal, each viewpoint's percent alteration on the
 * format's scale against the objective's range, and the blocks no viewpoint sees. No judgement: whether the objective
 * is met stays the reviewer's sentence.
 */
export function runConclusion(ctx: ReportContext): Sentence[] {
  const vps = ctx.facts.viewpoints
  if (!vps.length) return []
  const scale = ctx.document.format.percentScale
  const objective = objectiveOf(ctx)
  const ids = proposedBlocks(ctx).map((block) => block.name)
  const proposed = (block: { id: string; proposed?: boolean }) =>
    block.proposed !== false && !isOtherPlannedBlock(ctx, block.id)
  const seeing = vps.filter((vp) =>
    vp.blocks.some((b) => proposed(b) && (b.status === 'visible' || b.status === 'possible glimpses')),
  )
  const blocks = ids.length ? blockList(ids) : 'the proposed blocks'
  const out: Sentence[] = [
    vps.length === 1
      ? fillSentence(
          'conclusion-seen',
          '{viewpoint} {sees} {blocks}.',
          { viewpoint: vps[0].name, sees: seeing.length ? 'sees part of' : 'sees none of', blocks },
          'run',
        )
      : fillSentence(
          'conclusion-seen',
          '{seen} of the {count} viewpoints simulated {verb} part of {blocks}.',
          {
            seen: seeing.length === vps.length ? 'All' : seeing.length ? String(seeing.length) : 'None',
            count: NUMBER_WORDS[vps.length] ?? vps.length,
            verb: seeing.length === 1 ? 'sees' : 'see',
            blocks,
          },
          'run',
        ),
  ]
  const figures = ctx.document.viewpoints.flatMap((vp) => {
    if (!vp.printed || !vp.alteration) return []
    const band = readPercent(scale, vp.alteration.printedValue)
    return [{ name: vp.name, percent: vp.printed.percent, value: vp.alteration.printedValue, code: band?.code ?? null }]
  })
  if (figures.length)
    out.push(
      fillSentence(
        'conclusion-figures',
        'Measured on the simulations, the percent alteration of the landform is {figures}.',
        {
          figures: andList(
            figures.map((f) => `${f.percent}% from ${f.name}${f.code ? ` (${CLASS_NAMES[f.code]})` : ''}`),
          ),
        },
        'run',
      ),
    )
  if (figures.length && objective) {
    const range = scale.printed
      .split(';')
      .map((part) => part.trim())
      .find((part) => new RegExp(`^${objective}(?=[\\s=<])`).test(part))
    const over = figures.filter((f) => !f.code || CLASS_ORDER.indexOf(f.code) > CLASS_ORDER.indexOf(objective))
    out.push(
      over.length
        ? fillSentence(
            'conclusion-range',
            '{over} {isAre} over the {objective} range{range}; the other measures of the objective decide whether it is met.',
            {
              over:
                over.length === figures.length
                  ? figures.length === 1
                    ? 'The figure'
                    : 'Every figure'
                  : `The figure${over.length === 1 ? '' : 's'} from ${andList(over.map((f) => f.name))}`,
              isAre: over.length === 1 ? 'is' : 'are',
              objective: CLASS_NAMES[objective],
              range: range ? ` (${range})` : '',
            },
            'run',
          )
        : fillSentence(
            'conclusion-range',
            '{all} within the {objective} range{range}.',
            {
              all: figures.length === 1 ? 'The figure is' : 'Every figure is',
              objective: CLASS_NAMES[objective],
              range: range ? ` (${range})` : '',
            },
            'run',
          ),
    )
  }
  const unseen = ids.filter(
    (id) =>
      vps.every((vp) => vp.blocks.some((b) => b.id === id)) &&
      vps.every((vp) => vp.blocks.every((b) => b.id !== id || b.status === 'not visible')),
  )
  if (unseen.length)
    out.push(
      fillSentence(
        'conclusion-unseen',
        '{blocks} {isAre} not expected to be visible from any viewpoint assessed.',
        { blocks: blockList(unseen), isAre: unseen.length === 1 ? 'is' : 'are' },
        'run',
      ),
    )
  return out
}

const limitations: ReportPart = {
  id: 'limitations',
  title: 'Limitations',
  sources: ['02', '22', '23'],
  build: (ctx) => ({
    blocks: [
      heading('Limitations'),
      text(
        `The simulations are drawn on ${ctx.method.terrain}; timber is drawn from the inventory, not surveyed. Operational changes to the harvest area or retention, and windthrow after harvest, are not modelled. Pixel figures count what each picture shows at its lens; the sightline figure is the assessment's. A field visit confirms the viewpoints and the figures.`,
        'run',
      ),
    ],
  }),
}

const signOff: ReportPart = {
  id: 'sign-off',
  title: 'Sign-off',
  sources: ['01', '02', '03', '05', '22', '23'],
  build: (ctx) => ({
    blocks: [
      heading('Sign-off'),
      fields([officeRow(ctx, 'evaluator', 'Prepared by')]),
      {
        kind: 'choices',
        label: 'Certification:',
        options: [
          'I carried out or directly supervised this assessment',
          'I reviewed this assessment and judge it to meet the standard of my profession',
        ],
        chosen: null,
        source: 'reviewer',
      },
      { kind: 'signature', lines: ['Signature', 'Professional designation and seal', 'Date'] },
    ],
  }),
}

const references: ReportPart = {
  id: 'references',
  title: 'References',
  sources: ['22', '23', '26'],
  build: (ctx) => ({
    blocks: [
      heading('References'),
      {
        kind: 'list',
        items: [
          'BC Ministry of Forests. Visual Impact Assessment Handbook (May 2022).',
          'Forest Planning and Practices Regulation, s. 1.1 (visual quality objective definitions).',
          ctx.inventoryRead
            ? 'BC Geographic Warehouse: Visual Landscape Inventory (REC_VISUAL_LANDSCAPE_INVENTORY), read live from DataBC for this report.'
            : 'BC Geographic Warehouse: Visual Landscape Inventory (REC_VISUAL_LANDSCAPE_INVENTORY): not read for this report; inventory values are the office fields.',
          `Terrain: ${ctx.method.terrain}. Timber: ${ctx.method.vegetation}.`,
        ],
        source: 'fixed',
      },
    ],
  }),
}

const figuresAppendix: ReportPart = {
  id: 'figures',
  title: 'Figures',
  sources: ['01', '02', '05', '06', '21', '22', '23', '26'],
  build: (ctx) => {
    // A report with a calculations part shows each analysis figure there, once; it is not printed twice.
    if (ctx.recipeParts?.includes('calculations')) return { blocks: [] }
    return {
      blocks: [
        { kind: 'pageBreak' },
        heading('Figures'),
        ...(ctx.figures.length
          ? ctx.figures.map((figure): ReportBlock => ({ kind: 'figure', figure, caption: figure.caption }))
          : [text('No saved view has a figure yet: save a viewpoint in the road view.', 'run')]),
      ],
      toComplete: ctx.figures.length ? [] : ['Figures: save a viewpoint'],
    }
  },
}

/** What the run says each viewpoint sees of each block, in words (02's field comments, 06's rationales). */
export function blockVisibilitySentences(ctx: ReportContext): Sentence[] {
  return ctx.facts.viewpoints.flatMap((vp) =>
    vp.blocks.map((block) =>
      fillSentence(
        'block-visibility',
        'From {viewpoint}, Block {block} {seen}.',
        {
          viewpoint: vp.name,
          block: block.id,
          seen:
            block.status === 'unknown'
              ? null
              : block.status === 'not visible'
                ? 'is not expected to be visible'
                : block.status === 'possible glimpses'
                  ? 'may be seen only in glimpses'
                  : `is visible, with ${Math.round(block.visiblePercent)}% of its ground in view`,
        },
        'run',
      ),
    ),
  )
}

/** The report's purpose (06's objective paragraph, 26's purpose line). */
const purpose: ReportPart = {
  id: 'purpose',
  title: 'Purpose',
  sources: ['06', '26'],
  build: (ctx) => ({
    blocks: [
      heading('Purpose'),
      ...paragraph([
        fillSentence(
          'purpose',
          ctx.recipeParts?.includes('ea-visual-memo') || !objectiveOf(ctx)
            ? 'This memo reports how visible {blocks} would be from {viewpoints}, from simulations drawn on the terrain and the recorded timber.'
            : 'This assessment tests whether {blocks} meet the {objective} objective established for {landform}, as seen from {viewpoints}.',
          {
            blocks: proposedBlocks(ctx).length
              ? blockList(proposedBlocks(ctx).map((block) => block.name))
              : 'the proposed development',
            objective: objectiveName(ctx),
            landform: ctx.landform?.name ?? 'the landform',
            viewpoints: `${ctx.facts.viewpoints.length} viewpoint${ctx.facts.viewpoints.length === 1 ? '' : 's'}`,
          },
          'scene',
        ),
      ]),
    ],
  }),
}

/** A page per viewpoint (06): its attributes, what it sees, and the reviewer's rationale. */
const viewpointPages: ReportPart = {
  id: 'viewpoint-pages',
  title: 'Viewpoints',
  sources: ['05', '06', '07'],
  build: (ctx) => {
    const blocks: ReportBlock[] = [heading('Simulations and photography')]
    const toComplete: string[] = []
    for (const vp of ctx.facts.viewpoints) {
      const seen = vp.blocks.filter((block) => block.status === 'visible' || block.status === 'possible glimpses')
      const resolvedVp = resolved(ctx, vp.name)
      blocks.push(
        heading(vp.name, 3),
        fields([
          field('Distance to development', vp.distanceKm === null ? null : `${vp.distanceKm.toFixed(1)} km`, 'run'),
          field('VLI no.', vp.inventory?.vsu, 'run'),
          field('VSC', vp.inventory?.vsc, 'run'),
          field('VAC', vp.inventory?.vac, 'run'),
          field('EVQO', vp.inventory?.vqo ?? vp.objective, 'run'),
          field(
            'Latitude, longitude',
            vp.lngLat ? `${vp.lngLat[1].toFixed(4)}, ${vp.lngLat[0].toFixed(4)}` : null,
            'run',
          ),
          field('Elevation', eyeElevation(vp) || null, 'run'),
          field('Viewing direction', viewDirection(vp) || null, 'run'),
          field('Viewing angle', vp.hfovDeg ? `${vp.hfovDeg.toFixed(0)}° horizontal` : null, 'run'),
          field('View duration', vp.review?.duration, 'reviewer'),
        ]),
        ...paragraph([
          fillSentence(
            'viewpoint-rationale',
            '{viewpoint} looks toward {landform}, {distance}; {seen}.',
            {
              viewpoint: vp.name,
              landform: vp.landform,
              distance:
                vp.distanceKm === null
                  ? 'at a distance the run could not measure'
                  : `${vp.distanceKm.toFixed(1)} km from the nearest block it sees`,
              seen: !vp.blocks.length
                ? 'no proposed block lies in the view'
                : seen.length
                  ? glimpsesOnly(seen, resolvedVp?.printed?.percent ?? null)
                    ? `${blockList(seen.map((block) => block.id))} may be seen only in glimpses (${resolvedVp?.printed?.percent ?? '?'}% of the landform in the picture)`
                    : `${blockList(seen.map((block) => block.id))} ${seen.length === 1 ? 'is' : 'are'} in view (${resolvedVp?.printed?.percent ?? '?'}% of the landform in the picture)`
                  : 'no proposed block is expected to be visible',
            },
            'run',
          ),
        ]),
        ...insetMap(ctx, vp.name),
      )
      if (!vp.review?.duration) toComplete.push(`${vp.name}: view duration and use`)
    }
    return { blocks, toComplete }
  },
}

/** A viewpoint's location map as a half-width inset (06's and 21's per-viewpoint maps); nothing when none was captured. */
export function insetMap(ctx: ReportContext, viewpoint: string): ReportBlock[] {
  const figure = ctx.images?.locationMaps?.[viewpoint]
  if (!figure) return []
  return [
    {
      kind: 'figureGrid',
      columns: 2,
      slots: [{ label: `${viewpoint}: location`, figure, placeholder: 'Location map' }],
      caption: figure.caption,
    },
  ]
}

/** 05's distance zones, printed as the report states them. */
const distanceZones: ReportPart = {
  id: 'distance-zones',
  title: 'Distance zones',
  sources: ['05'],
  build: (ctx) => ({ blocks: [distanceTable(ctx.document.format.distanceScale ?? DISTANCE_SCALES.vli)] }),
}

/** 02's narrative rationale: proposal, plans, legislative frame, field observations, recommendations. */
const designRationale: ReportPart = {
  id: 'design-rationale',
  title: 'Visual landscape design rationale',
  sources: ['02'],
  build: (ctx) => {
    const blocks = ctx.blocks
    return {
      blocks: [
        heading('Visual landscape design rationale'),
        heading('Proposal', 3),
        text(
          `${blocks.length} block${blocks.length === 1 ? '' : 's'} totalling ${ha(blocks.reduce((sum, b) => sum + b.areaHa, 0))} ha: ${blocks
            .map((b) => `${b.name} (${ha(b.areaHa)} ha, ${b.system})`)
            .join('; ')}.`,
          'scene',
        ),
        heading('Higher level plans', 3),
        text(ctx.office.sourceDocument ? `The objective is established by ${ctx.office.sourceDocument}.` : '', 'scene'),
        heading('Legislative framework', 3),
        text(`The landform's objective is ${objectiveName(ctx) ?? 'not recorded'}; FPPR s. 1.1 defines it.`, 'scene'),
        heading('Field observations and comments', 3),
        ...paragraph(blockVisibilitySentences(ctx)),
        text(ctx.review?.rationale ?? '', 'reviewer'),
      ],
      toComplete: [
        ...(ctx.office.sourceDocument ? [] : ['Higher level plans: objective source document']),
        ...(ctx.review?.rationale ? [] : ['Field observations (step 4 rationale)']),
      ],
    }
  },
}

/** 21's comparison: the established objective, the simulation's class and the class after harvest, per viewpoint. */
const boardComparison: ReportPart = {
  id: 'board-comparison',
  title: 'Viewpoint comparison',
  sources: ['21'],
  build: (ctx) => ({
    blocks: [
      heading('Viewpoint comparison'),
      {
        kind: 'table',
        columns: ['Viewpoint', 'Established VQO', 'Simulated class (VIA)', 'Post-harvest class'],
        rows: ctx.document.viewpoints.map((vp) => [
          vp.name,
          objectiveOf(ctx) ?? '',
          vp.printed?.classCode ?? vp.printed?.term ?? '',
          '',
        ]),
        note: 'The simulated class is the pixel figure read on Table 2; the post-harvest class is read in the field after harvest.',
        source: 'run',
      },
      ...(ctx.facts.viewpoints.some((vp) => ctx.images?.locationMaps?.[vp.name])
        ? [
            heading('Viewpoint locations', 3),
            {
              kind: 'figureGrid' as const,
              columns: 2 as const,
              slots: ctx.facts.viewpoints
                .filter((vp) => ctx.images?.locationMaps?.[vp.name])
                .map((vp) => ({
                  label: vp.name,
                  figure: ctx.images!.locationMaps![vp.name],
                  placeholder: 'Location map',
                })),
              caption: 'Each viewpoint, the direction it faces and the blocks in its view.',
            },
          ]
        : []),
      heading('Findings', 3),
      text(ctx.review?.rationale ?? '', 'reviewer'),
    ],
    toComplete: ['Post-harvest class per viewpoint', ...(ctx.review?.rationale ? [] : ['Findings'])],
  }),
}

/** Below this share of the landform in the picture, percent, an alteration reads as at most glimpses. */
export const GLIMPSE_LANDFORM_PERCENT = 0.1

/**
 * How visible the proposal is from one viewpoint, in words, from the run's block statuses and the picture's figure:
 * no block seen, glimpses only (or a few pixels of the landform), partly or wholly visible; null where terrain is
 * missing, since then the run cannot say.
 */
/** Seen only in glimpses: every block a possible glimpse, or under `GLIMPSE_LANDFORM_PERCENT` of the landform. */
const glimpsesOnly = (seen: ReadonlyArray<{ status: string }>, percent: string | null) =>
  seen.every((b) => b.status === 'possible glimpses') ||
  (percent !== null && Number(percent) < GLIMPSE_LANDFORM_PERCENT)

export function visibilityPhrase(
  blocks: ReadonlyArray<{ status: string; visiblePercent: number }>,
  percent: string | null,
): string | null {
  if (blocks.some((b) => b.status === 'unknown')) return null
  const seen = blocks.filter((b) => b.status === 'visible' || b.status === 'possible glimpses')
  if (!seen.length) return 'is not expected to be visible, screened by terrain and standing timber'
  if (glimpsesOnly(seen, percent))
    return `may be seen only in glimpses (${percent ?? '?'}% of the landform in this picture)`
  return seen.length < blocks.length
    ? `is expected to be partly visible: ${seen.length} of ${blocks.length} blocks in view, ${percent ?? '?'}% of the landform in this picture`
    : `is expected to be visible (${percent ?? '?'}% of the landform in this picture)`
}

/** 26's visual aesthetics memo: no VQO, observer viewpoints, visibility per viewpoint, effects characterization. */
const eaMemo: ReportPart = {
  id: 'ea-visual-memo',
  title: 'Visual aesthetics',
  sources: ['26'],
  build: (ctx) => {
    const objective = objectiveOf(ctx)
    const existing = !ctx.inventoryRead
      ? 'The visual landscape inventory was not read, so whether an objective is established here is not stated.'
      : objective
        ? `The project area lies in a visual sensitivity unit with an established ${CLASS_NAMES[objective]} objective.`
        : 'The project area is not in an area with an established visual quality objective; the land use plan’s visual guidance applies instead.'
    const seen = ctx.document.viewpoints.map((vp, index) => {
      const facts = ctx.facts.viewpoints[index]
      const visibility = visibilityPhrase(facts.blocks, vp.printed?.percent ?? null)
      // The with-timber pixel figure beside the ground one: what the picture shows with the drawn timber in front.
      const timber = vp.withTimber
      return timber && visibility
        ? fillSentence(
            'visibility',
            'percent' in timber
              ? '{viewpoint}: the development {visibility}; with the drawn timber in front, {timber}% of the landform in the picture shows it.'
              : '{viewpoint}: the development {visibility}; the figure with the drawn timber in front was not measured ({reason}).',
            {
              viewpoint: vp.name,
              visibility,
              ...('percent' in timber ? { timber: timber.percent } : { reason: timber.absent }),
            },
            'run',
          )
        : fillSentence(
            'visibility',
            '{viewpoint}: the development {visibility}.',
            { viewpoint: vp.name, visibility },
            'run',
          )
    })
    // What the proposal is and how big, from the scene; where the map is; and that the run measures at harvest.
    const proposed = proposedBlocks(ctx)
    const systems = [...new Set(proposed.map((block) => block.system.toLowerCase()))]
    const proposal = proposed.length
      ? fillSentence(
          'ea-proposal',
          'The proposal is {system} of {blocks}, {area} ha in all.',
          {
            system: andList(systems.map((system) => (system === 'clearcut' ? 'clearcut harvest' : system))),
            blocks: blockList(proposed.map((block) => block.name)),
            area: ha(proposed.reduce((sum, block) => sum + block.areaHa, 0)),
          },
          'scene',
        )
      : null
    const mapNote = ctx.recipeParts?.includes('overview-map')
      ? fillSentence(
          'ea-map',
          'Figure 1 shows the {count} observer viewpoint{s} and the proposed blocks.',
          { count: ctx.facts.viewpoints.length, s: ctx.facts.viewpoints.length === 1 ? '' : 's' },
          'run',
        )
      : null
    // Why each viewpoint was modelled: the reviewer's reason where given, else what the run found from it.
    const seenFrom = ctx.facts.viewpoints.filter((vp) =>
      vp.blocks.some((b) => b.status === 'visible' || b.status === 'possible glimpses'),
    )
    const blind = ctx.facts.viewpoints.filter((vp) => !seenFrom.includes(vp))
    const reasons: Sentence[] = ctx.facts.viewpoints
      .filter((vp) => vp.review?.selectionReason)
      .map((vp) =>
        fillSentence(
          'ea-viewpoint-reason',
          '{viewpoint} was chosen {reason}.',
          { viewpoint: vp.name, reason: vp.review!.selectionReason },
          'reviewer',
        ),
      )
    const modelled = fillSentence(
      'ea-modelled',
      seenFrom.length && blind.length
        ? '{seen} {seenVerb} simulated because the run finds a line of sight from {seenEach} to the proposed blocks; {blind} {blindVerb} none and {blindIs} shown with the blocks’ position marked.'
        : seenFrom.length
          ? '{seen} {seenVerb} simulated because the run finds a line of sight from {seenEach} to the proposed blocks.'
          : 'The run finds no line of sight from {blind} to the proposed blocks; {blindIs2} shown with the blocks’ position marked.',
      {
        seen: andList(seenFrom.map((vp) => vp.name)),
        seenVerb: seenFrom.length === 1 ? 'is' : 'are',
        seenEach: seenFrom.length === 1 ? 'it' : 'each',
        blind: andList(blind.map((vp) => vp.name)),
        blindVerb: blind.length === 1 ? 'has' : 'have',
        blindIs: blind.length === 1 ? 'is' : 'are',
        blindIs2: blind.length === 1 ? 'it is' : 'they are',
      },
      'run',
    )
    // Timber screening per viewpoint: the blocks' ground hidden only by standing timber, area-weighted by block.
    const screening = ctx.facts.viewpoints.flatMap((vp) => {
      const own = vp.blocks.filter((b) => b.proposed !== false && b.screenedPercent !== undefined)
      if (!own.length || own.length < vp.blocks.filter((b) => b.proposed !== false).length) return []
      const weight = (id: string) => blockFacts(ctx, id)?.areaHa ?? 1
      const total = own.reduce((sum, b) => sum + weight(b.id), 0)
      const screened = own.reduce((sum, b) => sum + weight(b.id) * b.screenedPercent!, 0) / total
      const visible = own.reduce((sum, b) => sum + weight(b.id) * b.visiblePercent, 0) / total
      if (screened < 0.5) return []
      return [
        fillSentence(
          'ea-screening',
          'From {viewpoint}, standing timber between the viewer and the blocks hides {screened}% of their ground; {visible}% is in line of sight.',
          { viewpoint: vp.name, screened: Math.round(screened), visible: Math.round(visible) },
          'run',
        ),
      ]
    })
    const bareGround =
      ctx.facts.screeningModelled === false
        ? [
            fillSentence(
              'ea-screening',
              'The run’s sightlines read bare ground: standing timber was not counted as screening, so the blocks may be less visible than these figures say.',
              {},
              'run',
            ),
          ]
        : []
    const regrowth = fillSentence(
      'ea-regrowth',
      'The simulations show the openings as harvested; their visibility lessens as the regenerating stands grow, which the simulations do not model.',
      {},
      'run',
    )
    return {
      blocks: [
        heading('Visual aesthetics memo'),
        fields([
          officeRow(ctx, 'licensee', 'Prepared for'),
          officeRow(ctx, 'evaluator', 'Prepared by'),
          field('Date', ctx.date.toISOString().slice(0, 10), 'run'),
        ]),
        ...purpose.build(ctx).blocks.slice(1),
        heading('Existing visual conditions', 3),
        text(existing, 'run'),
        heading('Potential landscape changes', 3),
        ...paragraph([proposal, mapNote].filter((entry): entry is Sentence => !!entry)),
        { kind: 'list', items: ctx.facts.viewpoints.map((vp, i) => `OV${i + 1}: ${vp.name}`), source: 'run' },
        ...paragraph([modelled, ...reasons]),
        ...paragraph([...seen, ...screening, ...bareGround, regrowth]),
        heading('Discussion', 3),
        text(ctx.review?.rationale ?? '', 'reviewer'),
        effectsTable(),
      ],
      toComplete: ['Effect characterization ratings and rationale', ...(ctx.review?.rationale ? [] : ['Discussion'])],
    }
  },
}

/** Table 5's retention levels by block, when retention is recorded. */
const retention: ReportPart = {
  id: 'retention',
  title: 'Retention',
  sources: ['01', '06'],
  build: (ctx) => {
    const recorded = ctx.blocks.filter((block) => block.retentionPercent !== null)
    if (!recorded.length) return { blocks: [] }
    return {
      blocks: [
        {
          kind: 'table',
          title: 'Retention by block',
          columns: ['Block', 'Retention', 'Table 5 level'],
          rows: recorded.map((block) => {
            const level = RETENTION_LEVELS.find(
              (entry) =>
                entry.id ===
                (block.retentionPercent! < 15 ? 'low' : block.retentionPercent! <= 22 ? 'moderate' : 'high'),
            )
            return [block.name, `${block.retentionPercent}%`, level?.label ?? '']
          }),
          source: 'scene',
        },
      ],
    }
  },
}

/** The core parts; `registry.ts` adds the other modules' parts to them. */
export const CORE_PARTS: readonly ReportPart[] = [
  cover,
  purpose,
  viewpointPages,
  viewpointsColumns,
  projectInformation,
  inventory,
  currentEvc,
  regulatoryFrame,
  threeElements,
  extentScale,
  vocabulary,
  methodology,
  distanceZones,
  documentTables,
  calculations,
  basicDefinition,
  visualDesign,
  numericalData,
  summary2001,
  appendix1,
  blockDiscussion,
  recommendations,
  conclusion,
  limitations,
  signOff,
  references,
  figuresAppendix,
  designRationale,
  boardComparison,
  eaMemo,
  retention,
]

export type { ReportItemToComplete }
