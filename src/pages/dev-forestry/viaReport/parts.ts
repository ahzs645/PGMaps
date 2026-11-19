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
import { jsonPart } from './reportEngine'
import type { AlterationBreakdown } from '../types'
import { settingLocation, type ReportSetting } from './setting'
import type { DocumentFacts, DocumentViewpoint, ResolvedDocument, ResolvedViewpoint } from '../viaDocument/resolve'
import { andList, blockId, blockList, landformParentFromName, otherPlannedName } from '../viaDocument/resolve'
import { atAssessmentStation, judgedOcular } from '../viaDocument/facts'
import { figurePageViewpoints, firstFigureNumber } from './partsFigures'
import {
  CLASS_NAMES,
  DISTANCE_SCALES,
  PERCENT_SCALES,
  handbookClass,
  readPercent,
  VIEWING_ANGLE_SCREEN,
  viewingAngleTerm,
  type ClassCode,
} from '../viaDocument/scales'
import { fillSentence, IMPACT_TERMS, toCompleteLine, type Sentence } from '../viaDocument/wording'
import {
  DESIGN_ELEMENTS,
  RETENTION_LEVELS,
  retentionLevelFor,
  SCALE_TERMS,
  SHAPE_TERMS,
  VISIBLENESS_TERMS,
  type DesignElementId,
  type RetentionLevel,
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
  type FigureSlot,
  type ReportBlock,
  type ReportFigure,
  type ReportItemToComplete,
} from './model'
import wording from './recipeJson/wording.json'

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
    | 'evaluatorDesignation'
    | 'evaluatorOrganisation'
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
  /**
   * Hectares of the block under `retained` masks (wildlife tree patches / retention: reserves), clipped to it. Absent
   * when not counted; 0 says none is mapped.
   */
  reservesHa?: number
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

/** One visual landscape inventory unit as the report prints it; codes as `DocumentViewpoint.inventory` carries them. */
export interface InventoryUnitRow {
  /** VSU number, else the VLI polygon number. */
  vsu: string
  vsc?: string
  vac?: string
  evc?: string
  vqo?: string
  /** The record's last update (UPDATE_DATE, YYYY-MM-DD): the only date the layer carries. */
  date?: string | null
  /** BC Albers hectares of each block (by `ReportBlockFacts.name`) inside the unit; absent when none falls in it. */
  blocks?: Readonly<Record<string, number>>
  /** As `blocks`, less mapped reserves, for the blocks that hold one; a block absent here has none. */
  netBlocks?: Readonly<Record<string, number>>
}

export interface ReportContext {
  date: Date
  office: OfficeFields
  blocks: readonly ReportBlockFacts[]
  landform: { name: string; objective: ClassCode | null; vac: string | null; areaHa: number; source: string } | null
  /** Every landform and sub-landform the scene describes (`ReportLandformNote`); absent when it describes none. */
  landforms?: readonly ReportLandformNote[]
  /** The inventory unit the figures were read against, when the inventory was read and holds one. */
  inventory: { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string; date?: string } | null
  /** The visual inventory was read for the area: "no unit" is then a finding, not a gap. */
  inventoryRead: boolean
  /**
   * Every visual landscape inventory unit the read found under the blocks or chosen by a viewpoint (live WFS,
   * `REC_VISUAL_LANDSCAPE_INVENTORY`). Absent: the inventory was not read; empty: it was read and holds none here.
   */
  inventoryUnits?: readonly InventoryUnitRow[]
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
    /** The viewpoint table rates each view's angle class, focal, oblique or peripheral (01's form). */
    viewingAngleClass?: boolean
    /** The inventory table lists each block's hectares in each unit it falls in (05's form). */
    inventoryByBlock?: boolean
    /** Photograph / simulation pairs are numbered figures with a caption sentence (21's Figure 2). */
    numberedPairs?: boolean
    /**
     * The consultant appendix prints each viewpoint's plain simulation as a Perspective Viewpoint sheet before its
     * analysis sheet (22, the default); false prints the analysis sheets alone (23).
     */
    plainViewSheets?: boolean
  }
  /**
   * Maps and extra pictures the page captured for the report (`useVisualsExport`); all optional, a part without the
   * one it needs lists it to complete (and, in the draft only, prints a box saying what goes there).
   */
  images?: ReportImages
  /**
   * Where the blocks are and what the land is like (`setting.ts`): named places around them, the ground's aspect and
   * slope, the inventory's stands. Absent when the page read none; a part then lists what it could not say.
   */
  setting?: ReportSetting
  /**
   * The report is Save & export's draft, the editing surface: a picture nobody has given keeps its place with a box
   * saying what goes there (`FigureSlot.placeholder`). Absent or false, as for every file: a missing picture and its own
   * caption print nothing, its figure number goes to the next picture, and only the to-complete list names it.
   */
  draft?: boolean
}

/** Whether a missing picture keeps its place with a box saying what goes there: only in the draft. */
export const showsMissing = (ctx: ReportContext) => !!ctx.draft

/** A layout's picture places as printed: every one in the draft, only those holding a picture in a file. */
export const printedSlots = (ctx: ReportContext, slots: readonly FigureSlot[]): FigureSlot[] =>
  showsMissing(ctx) ? [...slots] : slots.filter((slot) => !!slot.figure)

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
  /**
   * 26's Figure 2 maps, drawn for the figure page only (`planFigurePageMaps`): per viewpoint a location map fitted to
   * the view's teal wedge, and a readable regional road map; with several viewpoints, the regional map again for each
   * starring only its own (`regionalFor`, by name), as 26's Figures 2 and 3 do. The figure page prints these before
   * `locationMaps` and `regionalMap`, which every other part keeps.
   */
  figurePageMaps?: {
    location: Readonly<Record<string, ReportFigure>>
    regional: ReportFigure | null
    regionalFor?: Readonly<Record<string, ReportFigure>>
  } | null
  /** Per viewpoint: the scene before the proposal, a lined-up field photo or a before-harvest render. */
  before?: Readonly<
    Record<
      string,
      ReportFigure & {
        source: 'photo' | 'render'
        /** A field photograph's date (ISO, the camera's clock), when the photograph carried one. */
        takenOn?: string | null
      }
    >
  >
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
/**
 * The evaluator as a sign-off names them: "J. Smith, RPF #4521" and, with `organisation`, ", Northwood Forestry".
 * Null without a name: a designation alone names nobody.
 */
export function preparerText(office: OfficeFields, organisation = false): string | null {
  const name = blank(office.evaluator)
  if (!name) return null
  const designation = blank(office.evaluatorDesignation)
  const own = organisation ? blank(office.evaluatorOrganisation) : null
  return [designation ? `${name}, ${designation}` : name, own].filter(Boolean).join(', ')
}
/** The evaluator's row: name, designation and their own organisation, from the FS1252 office information. */
export const preparerRow = (ctx: ReportContext, label: string): FieldRow =>
  field(label, preparerText(ctx.office, true), 'scene')
/**
 * The general location: the office field as given, else the named places the page read round the blocks
 * (`settingLocation`: "Paska Lake, 11.9 km north of Logan Lake"); blank, and to complete, when neither is there.
 */
export const generalLocationRow = (ctx: ReportContext, label = 'General location'): FieldRow => {
  const given = blank(ctx.office.generalLocation)
  if (given) return field(label, given, 'scene')
  return field(label, ctx.setting ? settingLocation(ctx.setting) : null, 'run')
}
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

/**
 * The certification statements the consultant reports sign under (22, 23) and the 2001 forms (01, 02, 05): the
 * professional who did or supervised the work, and a peer who reviewed it without supervising it. PGMaps' wording,
 * naming no association.
 */
export const CERTIFICATION_STATEMENTS: Readonly<{ supervised: string; reviewed: string }> = wording.certification

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
/**
 * Each landform the viewpoints read, with the other landforms they see beside their own (`otherLandforms`, each
 * counted on its own class pass), in order of first reading: Table 2's rows and the landform count.
 */
export const seenLandformNames = (ctx: ReportContext) => [
  ...new Set(
    ctx.facts.viewpoints.flatMap((vp) => [vp.landform, ...(vp.otherLandforms ?? []).map((entry) => entry.landform)]),
  ),
]
/** Whether a viewpoint reads `name`, as its own landform or as another it sees beside it. */
export const readsLandform = (vp: DocumentFacts['viewpoints'][number], name: string) =>
  vp.landform === name || !!vp.otherLandforms?.some((entry) => entry.landform === name)
export const landformNote = (ctx: ReportContext, name: string) =>
  ctx.landforms?.find((note) => note.name === name) ?? null
/**
 * The landform a sub-landform belongs to: the scene's record, else its name read the references' way ("Landform 1b"
 * and "Sub-landform 1a" belong to Landform 1). Null for a landform that is not a sub-landform.
 */
export function landformParent(ctx: ReportContext, name: string): string | null {
  return landformNote(ctx, name)?.parent || landformParentFromName(name)
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

/** The number a viewpoint's name carries ("VP1", "VPT3", "VP03", "OV2", "Viewpoint 4"), or null when it carries none. */
export function viewpointNumber(name: string): number | null {
  const found = name.match(/\b(?:VPT?|OV|Viewpoint)\s*#?\s*0*(\d+)\b/i)
  return found ? Number(found[1]) : null
}

/** A viewpoint's name without the number it carries in brackets or in front ("Duncan Dam (VP2)" is Duncan Dam). */
export const viewpointPlaceName = (name: string) =>
  name
    .replace(/\s*\((?:VPT?|OV)\s*#?\s*\d+\)\s*$/i, '')
    // An alternation, not a bracket class of the three: Tailwind reads that bracket in a source file as an arbitrary CSS
    // property, and the production build then fails on the CSS it writes.
    .replace(/^(?:VPT?|OV)\s*#?\s*\d+\s*(?:-|:|–)\s*/i, '')
    .trim() || name

/**
 * The report's viewpoints in the order of the numbers their names carry (06 prints VP1 to VP7, whatever order the views
 * were saved in), each numbered by its name; a viewpoint whose name carries none follows, in saved order. The facts and
 * the resolved document are reordered together, so a part that pairs them by index still pairs the same viewpoint.
 * Unchanged when no name carries a number.
 */
export function inViewpointOrder(ctx: ReportContext): ReportContext {
  const vps = ctx.facts.viewpoints
  const numbers = vps.map((vp) => viewpointNumber(vp.name))
  if (numbers.every((n) => n === null)) return ctx
  const order = vps
    .map((_, index) => index)
    .sort((i, j) => (numbers[i] ?? Infinity) - (numbers[j] ?? Infinity) || i - j)
  const aligned = ctx.document.viewpoints.length === vps.length
  return {
    ...ctx,
    facts: {
      ...ctx.facts,
      viewpoints: order.map((i) => (numbers[i] === null ? vps[i] : { ...vps[i], n: String(numbers[i]) })),
    },
    document: aligned ? { ...ctx.document, viewpoints: order.map((i) => ctx.document.viewpoints[i]) } : ctx.document,
  }
}

/**
 * Whether the viewpoint's picture shows proposed ground: its class pass counts proposed (or partial-cut) pixels on the
 * landform. A picture that shows the proposal sees a block, whatever the callouts' sample counts say.
 */
export const pictureShowsProposal = (vp: { areas: { proposed: number; partialCut?: number } | null }) =>
  !!vp.areas && vp.areas.proposed + (vp.areas.partialCut ?? 0) > 0

/** The blocks a viewpoint's callouts find in view: visible, or seen only in glimpses. */
export const seenBlocks = <T extends { status: string }>(blocks: readonly T[]) =>
  blocks.filter((block) => block.status === 'visible' || block.status === 'possible glimpses')

/** Whether a viewpoint sees any of the proposal: a block in view by the run's samples, or proposed ground in its picture. */
export const seesProposal = (vp: {
  blocks: ReadonlyArray<{ status: string }>
  areas: { proposed: number; partialCut?: number } | null
}) => seenBlocks(vp.blocks).length > 0 || pictureShowsProposal(vp)

/**
 * Why the blocks' ground a viewpoint does not see is out of sight, from the run's visibility codes: hidden by the
 * terrain, screened by standing timber (code 3, `screenedPercent`), or both. Null when a block carries no screening
 * figure (an older run), since then the run cannot say.
 */
export function hiddenCause(
  blocks: ReadonlyArray<{ visiblePercent: number; screenedPercent?: number }>,
): string | null {
  if (!blocks.length || blocks.some((b) => b.screenedPercent === undefined)) return null
  const timber = blocks.some((b) => b.screenedPercent! >= 0.5)
  const terrain = blocks.some((b) => 100 - b.visiblePercent - b.screenedPercent! >= 0.5)
  return terrain && timber
    ? 'hidden by the terrain and standing timber'
    : terrain
      ? 'hidden by the terrain'
      : timber
        ? 'screened by standing timber'
        : null
}

/**
 * A viewpoint's inventory codes: its own read when it has one, else the inventory units the read found whose VSU
 * numbers its landform's name carries ("VSU 24 + 27 + 655" reads units 24, 27 and 655), each code joined across them
 * as the forms print a landform over two units ("24/27"). Null when neither gives one.
 */
export function viewpointInventory(
  ctx: ReportContext,
  vp: { landform: string; inventory?: DocumentViewpoint['inventory'] },
): { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string } | null {
  if (vp.inventory) return vp.inventory
  const named = vp.landform.match(/\bVSU\s*((?:\d+[\s+/,&]*(?:and\s+)?)+)/i)
  if (!named || !ctx.inventoryUnits?.length) return null
  const numbers = named[1].match(/\d+/g) ?? []
  const units = numbers.flatMap((n) => ctx.inventoryUnits!.filter((unit) => unit.vsu === n))
  if (!units.length) return null
  const join = (key: 'vsu' | 'vsc' | 'vac' | 'evc' | 'vqo') => {
    const values = [...new Set(units.map((unit) => unit[key]).filter((v): v is string => !!v))]
    return values.length ? values.join('/') : undefined
  }
  return { vsu: join('vsu'), vsc: join('vsc'), vac: join('vac'), evc: join('evc'), vqo: join('vqo') }
}

// ------------------------------------------------------------------ parts

/** cover: defined once in JSON (`recipeJson/components/cover.json`), read by `kitBlocks.ts`. */
const cover = jsonPart('cover')

/**
 * A block's net area, hectares, for `grossHa` of it (the whole block, or its part in one inventory unit): less its
 * mapped reserves (`ofReserves`, the part's own net when the caller split it, else the block's reserve share), then
 * less recorded dispersed retention. Never below 0.
 */
export function blockNetHa(block: ReportBlockFacts, grossHa = block.areaHa, ofReserves?: number): number {
  const reserveShare = block.areaHa > 0 ? (block.reservesHa ?? 0) / block.areaHa : 0
  const net = ofReserves ?? grossHa * (1 - reserveShare)
  const dispersed = block.retentionPercent === null ? 0 : (grossHa * block.retentionPercent) / 100
  return Math.max(0, net - dispersed)
}

/** What a block (or its part) keeps standing, as the Retention column prints it: mapped reserves, dispersed share. */
function retentionCell(block: ReportBlockFacts, reservesHa: number): string {
  return [
    reservesHa >= 0.05 ? `${ha(reservesHa)} ha reserves` : '',
    block.retentionPercent === null ? '' : `${block.retentionPercent}%`,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The project table's note on net area. */
const NET_AREA_NOTE =
  'net area is gross less mapped reserves (wildlife tree patches / retention) and recorded dispersed retention'

const projectInformation: ReportPart = {
  id: 'project-information',
  title: 'Project information',
  sources: ['01', '05', '06'],
  build: (ctx) => {
    const units = ctx.inventoryUnits
    // With the inventory read, each block is split by the units it falls in, with the unit and its objective (06's
    // cover table); a block in no unit says so.
    if (units) {
      const rows = ctx.blocks.flatMap((block) => {
        const inUnits = units.filter((unit) => (unit.blocks?.[block.name] ?? 0) >= 0.05)
        return inUnits.length
          ? inUnits.map((unit) => {
              const area = unit.blocks![block.name]
              const ofReserves = unit.netBlocks?.[block.name]
              const reserves =
                ofReserves === undefined
                  ? area - blockNetHa({ ...block, retentionPercent: null }, area)
                  : area - ofReserves
              return [
                block.name,
                ha(area),
                unit.vsu,
                unit.vqo ?? '',
                retentionCell(block, reserves),
                ha(blockNetHa(block, area, ofReserves)),
                block.system,
              ]
            })
          : [
              [
                block.name,
                ha(block.areaHa),
                'None',
                '',
                retentionCell(block, block.reservesHa ?? 0),
                ha(blockNetHa(block)),
                block.system,
              ],
            ]
      })
      return {
        blocks: [
          heading('Project information'),
          {
            kind: 'table',
            columns: [
              'Block',
              'Gross area (ha)',
              'VLI polygon',
              'EVQO',
              'Retention',
              'Net area (ha)',
              'Harvest system',
            ],
            rows,
            note: `Each block’s area in each visual landscape inventory unit it falls in, read live from DataBC; ${NET_AREA_NOTE}; areas are planar BC Albers.`,
            source: 'run',
          },
        ],
      }
    }
    return {
      blocks: [
        heading('Project information'),
        {
          kind: 'table',
          columns: ['Block', 'Gross area (ha)', 'Retention', 'Net area (ha)', 'Harvest system'],
          rows: ctx.blocks.map((block) => [
            block.name,
            ha(block.areaHa),
            retentionCell(block, block.reservesHa ?? 0),
            ha(blockNetHa(block)),
            block.system,
          ]),
          note: `${NET_AREA_NOTE[0].toUpperCase()}${NET_AREA_NOTE.slice(1)}; areas are planar BC Albers.`,
          source: 'scene',
        },
      ],
    }
  },
}

const inventory: ReportPart = {
  id: 'inventory',
  title: 'Visual resource management',
  sources: ['01', '03', '05', '22', '23'],
  build: (ctx) => {
    const units = ctx.inventoryUnits ?? null
    // The units the inventory read, one row each (01's polygon table, 03's label rows, 05's per-block rows).
    if (units?.length) {
      const date = inventoryDateField(ctx)
      const rows = [
        field('Landform', ctx.landform?.name, 'scene'),
        field('Established VQO', objectiveName(ctx), 'scene'),
        field('Objective source', ctx.office.sourceDocument, 'scene'),
        date,
      ]
      const blocks: ReportBlock[] = [
        heading('Visual resource management'),
        {
          kind: 'table',
          title: 'Visual landscape inventory',
          columns: ['VSU / polygon', 'VSC', 'VAC', 'EVC', 'VQO'],
          rows: units.map((unit) => [unit.vsu, unit.vsc ?? '', unit.vac ?? '', unit.evc ?? '', unit.vqo ?? '']),
          note: 'Read live from the visual landscape inventory (REC_VISUAL_LANDSCAPE_INVENTORY): every unit under the blocks or chosen for a viewpoint.',
          source: 'run',
        },
        ...(ctx.recipeOptions?.inventoryByBlock ? inventoryByBlock(ctx, units) : []),
        fields(rows),
      ]
      const adopted = inventoryAdoption(ctx)
      if (adopted) blocks.push(...paragraph([adopted]))
      blocks.push(evcExceeds(unitsExceed(units)))
      return {
        blocks,
        toComplete: [
          ...missingFields(rows),
          ...(units.some((unit) => !unit.vsc || !unit.vac || !unit.evc || !unit.vqo)
            ? ['Inventory values the record leaves blank']
            : []),
        ],
      }
    }
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
    if (units)
      blocks.push(
        text(
          'The visual landscape inventory was read: no unit lies under the blocks or was chosen for a viewpoint.',
          'run',
        ),
      )
    else if (!ctx.inventoryRead)
      blocks.push(text('The visual inventory was not read for this report; its values are the office fields.', 'run'))
    blocks.push(evcExceeds(exceeds))
    return { blocks, toComplete: missingFields(rows) }
  },
}

const evcExceeds = (exceeds: boolean | null): ReportBlock => ({
  kind: 'choices',
  label: 'Does the existing visual condition exceed the established VQO?',
  options: ['Yes', 'No'],
  chosen: yesNo(exceeds),
  source: 'run',
})

const isClassCode = (value: string | undefined): value is ClassCode =>
  !!value && (CLASS_ORDER as readonly string[]).includes(value)

/**
 * Whether any unit's existing visual condition is more altered than its own established objective: Yes when one is,
 * No when every unit can be read and none is, else null.
 */
export function unitsExceed(units: readonly InventoryUnitRow[]): boolean | null {
  if (!units.length) return null
  let unknown = false
  for (const unit of units) {
    if (!isClassCode(unit.evc) || !isClassCode(unit.vqo)) {
      unknown = true
      continue
    }
    if (CLASS_ORDER.indexOf(unit.evc) > CLASS_ORDER.indexOf(unit.vqo)) return true
  }
  return unknown ? null : false
}

/**
 * The inventory's date as the forms print it: the reviewer's office field when given, else the units' record dates
 * (the layer's last update, the only date it carries), said as such.
 */
export function inventoryDateField(ctx: ReportContext, label = 'Date of inventory'): FieldRow {
  const given = blank(ctx.office.inventoryDate)
  if (given) return field(label, given, 'scene')
  const dates = [...new Set((ctx.inventoryUnits ?? []).map((unit) => blank(unit.date)).filter((d) => d !== null))]
  return field(label, dates.length ? `${dates.sort().join(', ')} (inventory record last updated)` : null, 'run')
}

/**
 * 05's per-block rows: each block's hectares in each unit it falls in, split by area. 05 prints them net of reserves
 * ("Block Area ha (No WTRAs/Reserves)"), so a block holding mapped reserves prints its net hectares, and the note says so.
 */
function inventoryByBlock(ctx: ReportContext, units: readonly InventoryUnitRow[]): ReportBlock[] {
  const rows: string[][] = []
  const outside: string[] = []
  const netted: string[] = []
  for (const block of ctx.blocks) {
    const inUnits = units.filter((unit) => (unit.blocks?.[block.name] ?? 0) >= 0.05)
    if (!inUnits.length) outside.push(block.name)
    if (inUnits.some((unit) => unit.netBlocks?.[block.name] !== undefined)) netted.push(block.name)
    for (const unit of inUnits) {
      // A part of the block that is all reserve leaves nothing to harvest in that unit.
      if ((unit.netBlocks?.[block.name] ?? 1) < 0.05) continue
      rows.push([
        `Block ${blockId(block.name)}: ${ha(unit.netBlocks?.[block.name] ?? unit.blocks![block.name])} ha`,
        unit.vsu,
        unit.vsc ?? '',
        unit.vac ?? '',
        unit.evc ?? '',
        unit.vqo ?? '',
      ])
    }
  }
  if (!rows.length) return []
  return [
    {
      kind: 'table',
      title: 'Visual resource management by block',
      columns: ['Block', 'VLI', 'VSC', 'VAC', 'EVC', 'EVQO'],
      rows,
      note: `A block in more than one unit is split by its area in each (BC Albers hectares).${
        netted.length
          ? ` Areas of ${blockList(netted)} are net of mapped reserves (wildlife tree patches / retention).`
          : ''
      }${outside.length ? ` No unit lies under ${andList(outside)}.` : ''}`,
      source: 'run',
    },
  ]
}

/** The form's two footnotes under the current EVC: form wording, not a judgement. */
export const CURRENT_EVC_NOTES = [
  '¹ The current EVC does not include the proposed alteration. It assesses the actual EVC, determined by the site photography and simulations completed for this assessment.',
  '² If No, there may be opportunity to add alteration. If Yes, a detailed assessment by a qualified forest professional and a visual specialist is required to determine the next steps; provide a comment.',
] as const

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
    const objective = objectiveOf(ctx)
    // Meets or exceeds: the marked class is at least as altered as the objective's.
    const meets = code && objective ? CLASS_ORDER.indexOf(code) >= CLASS_ORDER.indexOf(objective) : null
    const comments = field('Comments', null, 'reviewer')
    return {
      blocks: [
        pmmArrow('Current (non-inventory) existing visual condition ¹', code, 'run', most?.percent ?? null),
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
        {
          kind: 'choices',
          label: 'Does the current, non-inventory EVC meet or exceed the established VQO? ²',
          options: ['Yes', 'No'],
          chosen: yesNo(meets),
          source: 'run',
        },
        fields([comments]),
        text(CURRENT_EVC_NOTES[0], 'fixed'),
        text(CURRENT_EVC_NOTES[1], 'fixed'),
      ],
      toComplete: [
        ...(most ? ['Current existing visual condition: confirm the class marked from the simulation'] : []),
        ...(meets === null ? ['Current existing visual condition: does it meet or exceed the established VQO?'] : []),
        'Current existing visual condition: comments',
      ],
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

/** three-elements: defined once in JSON (`recipeJson/components/three-elements.json`), read by `kitBlocks.ts`. */
const threeElements = jsonPart('three-elements')

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

/**
 * The numbered viewpoint list a report's methods print when no table lists the viewpoints (06's "Viewpoint 1: ..."),
 * with the sentence naming which were simulated (21); null when a viewpoint table or the memo's own list prints them.
 */
function methodViewpoints(ctx: ReportContext): ReportBlock[] {
  const listed = ['table-3-viewpoints', 'viewpoints-columns', 'ea-visual-memo']
  if (!ctx.facts.viewpoints.length || listed.some((id) => ctx.recipeParts?.includes(id))) return []
  return [
    heading('Viewpoints', 3),
    {
      kind: 'list',
      items: ctx.facts.viewpoints.map(
        (vp, i) => `Viewpoint ${viewpointNumber(vp.name) ?? vp.n ?? i + 1}: ${viewpointPlaceName(vp.name)}`,
      ),
      source: 'run',
    },
    ...paragraph([simulatedViewpointsSentence(ctx)]),
  ]
}

/** How the format's arithmetic treats private land and rock, said once for the methods and the 2001 design notes. */
export const PRIVATE_LAND_NETTED =
  'Private land inside the landform is left out of the percent alteration’s denominator: the objective does not govern it, and its cover may change without notice.'
export const ROCK_NETTED = 'Rock and other non-vegetated ground is left out of the denominator too.'

const methodology: ReportPart = {
  id: 'methodology',
  title: 'Methods',
  sources: ['05', '06', '21', '22', '23'],
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
          'A landform is a distinct topographic feature, a sub-unit of the broader landscape, three-dimensional in form and delineated in perspective view from a significant public viewpoint: the part of the view the alteration is measured against. It is generally bounded by ridges, drainage channels, valleys, shorelines and skylines.',
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
              ? PRIVATE_LAND_NETTED
              : 'Private land inside the landform is counted as part of it.',
            format.rule.deduct.includes('rock') ? ROCK_NETTED : '',
          ]
            .filter(Boolean)
            .join(' '),
          'run',
        ),
        ...methodViewpoints(ctx),
      ],
    }
  },
}

/**
 * A view's viewing angle class (01's form): the seen block nearest the view's centre line, read on
 * `VIEWING_ANGLE_SCREEN`. Null when no seen block carries where it lies in the picture.
 */
export function viewingAngleOf(vp: DocumentViewpoint): string | null {
  const offsets = vp.blocks
    .filter((block) => block.status === 'visible' || block.status === 'possible glimpses')
    .flatMap((block) => (block.offAxisDeg === undefined ? [] : [Math.abs(block.offAxisDeg)]))
  return offsets.length ? viewingAngleTerm(Math.min(...offsets)) : null
}

/** The 2001 form's viewpoint table, one column per viewpoint (01, 03, 05). */
const viewpointsColumns: ReportPart = {
  id: 'viewpoints-columns',
  title: 'Viewpoints and photograph information',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const vps = ctx.facts.viewpoints
    const row = (label: string, value: (vp: (typeof vps)[number]) => string) => [label, ...vps.map(value)]
    const angleClass = !!ctx.recipeOptions?.viewingAngleClass
    const unrated = angleClass ? vps.filter((vp) => viewingAngleOf(vp) === null).map((vp) => vp.name) : []
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
            ...(angleClass
              ? [
                  row('Viewing angle (focal, oblique, peripheral)', (vp) => viewingAngleOf(vp) ?? ''),
                  row('Field of view (horizontal)', (vp) => (vp.hfovDeg ? `${vp.hfovDeg.toFixed(0)}°` : '')),
                ]
              : [row('Viewing angle (horizontal field)', (vp) => (vp.hfovDeg ? `${vp.hfovDeg.toFixed(0)}°` : ''))]),
          ],
          note: `Importance and duration are the reviewer’s; elevation, direction and angle the simulation camera’s.${
            angleClass
              ? ` The viewing angle is read from the seen block nearest the view’s centre line on the ${VIEWING_ANGLE_SCREEN.name.charAt(0).toLowerCase()}${VIEWING_ANGLE_SCREEN.name.slice(1)}, for the reviewer to confirm.`
              : ''
          }`,
          source: 'run',
        },
      ],
      toComplete: [
        ...(vps.some((vp) => !vp.review?.importance) ? ['Viewpoint importance and duration'] : []),
        ...(angleClass && vps.length
          ? unrated.length
            ? [`Viewing angle (focal, oblique, peripheral): ${andList(unrated)}`]
            : ['Viewing angle: confirm the class read from where the blocks lie in each view']
          : []),
      ],
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
    for (const vp of ctx.facts.viewpoints) {
      blocks.push(heading(vp.name, 3))
      const figure = figureFor(ctx, vp.name)
      if (figure) blocks.push({ kind: 'figure', figure, caption: figure.caption })
      blocks.push(calculationFields(ctx, vp))
    }
    return { blocks }
  },
}

/** One viewpoint's calculation: the format's rule on the class pass, beside the sightline figure. */
export function calculationFields(ctx: ReportContext, vp: DocumentFacts['viewpoints'][number]): ReportBlock {
  const rule = ctx.document.format.rule
  const out = resolved(ctx, vp.name)
  const a = vp.areas
  const result = out?.alteration
  return fields([
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
    // What decided which openings count: the green-up age, a supplied estimate or a field check, as the run names it.
    ...(vp.greenUp ? [field('Green-up of existing openings', vp.greenUp, 'run' as const)] : []),
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
    // Why the two figures can part, when the picture drew the blocks' ground far coarser than the run walked it.
    ...(vp.terrainNote ? [field('Terrain detail', vp.terrainNote, 'run' as const)] : []),
  ])
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
    // Each viewpoint's terms are its group's step 4 (`judgedOcular`).
    const ocularOf = (vp: (typeof vps)[number]) => judgedOcular(vp, ctx)
    const hidden = (vp: (typeof vps)[number]) =>
      vp.blocks.length > 0 && vp.blocks.every((block) => block.status === 'not visible')
    const term = (vp: (typeof vps)[number], value: (at: (typeof vps)[number]) => string | undefined) =>
      hidden(vp) ? 'Not visible' : atAssessmentStation(vp) ? (value(vp) ?? '') : ''
    const line = (label: string, value: (vp: (typeof vps)[number]) => string) => [label, ...vps.map(value)]
    const rows = [
      line(`Level of impact (${IMPACT_TERMS.join(', ')})`, (vp) => term(vp, (at) => at.review?.impact)),
      line('Visibility', (vp) =>
        term(vp, () => VISIBLENESS_TERMS.find((t) => t.id === ocularOf(vp)?.visibleness)?.label),
      ),
      line('Scale', (vp) =>
        hidden(vp) ? 'N/A' : term(vp, () => SCALE_TERMS.find((t) => t.id === ocularOf(vp)?.scale)?.label),
      ),
      line('Design', (vp) =>
        hidden(vp) ? 'N/A' : term(vp, () => SHAPE_TERMS.find((t) => t.id === ocularOf(vp)?.shape)?.label),
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

const RETENTION_GRADE: Record<RetentionLevel, string> = { low: 'Poor', moderate: 'Moderate', high: 'Good' }

/**
 * The share of the seen blocks' ground left standing, area-weighted, from each block's record: a dispersed
 * retention's retained share, a partial cut's volume not removed, a clearcut's none. Null unless a seen block records
 * retention or a partial cut: a clearcut's patches are not in its record.
 */
export function seenRetention(ctx: ReportContext, vp: DocumentViewpoint): { percent: number; grade: string } | null {
  let area = 0,
    kept = 0,
    recorded = false
  for (const seen of vp.blocks.filter((b) => b.status === 'visible' || b.status === 'possible glimpses')) {
    const block = blockFacts(ctx, seen.id)
    if (!block || !(block.areaHa > 0)) continue
    const retained = block.partialCut
      ? 100 - block.partialCut.removedPercent
      : block.system === 'Dispersed retention'
        ? block.retentionPercent
        : 0
    if (retained === null) return null
    if (block.partialCut || block.system === 'Dispersed retention') recorded = true
    area += block.areaHa
    kept += block.areaHa * retained
  }
  if (!recorded || !(area > 0)) return null
  const percent = kept / area
  const level = retentionLevelFor(percent)
  return level ? { percent, grade: RETENTION_GRADE[level] } : null
}

/**
 * 2001 form section 3, as 01 prints it: each visual design factor rated per viewpoint. Force lines, natural
 * character, edges and position are step 4's ratings at the assessment station; tree retention is read from the seen
 * blocks' records on Table 5's bands; the category is the class by eye at the assessment station.
 */
const visualDesign: ReportPart = {
  id: 'visual-design',
  title: 'Assessing visual design',
  sources: ['01'],
  build: (ctx) => {
    const vps = ctx.facts.viewpoints
    const options = (id: DesignElementId) => {
      const element = DESIGN_ELEMENTS.find((entry) => entry.id === id)!
      return `${element.good} (Good), ${element.moderate} (Moderate), ${element.poor} (Poor)`
    }
    const judged =
      (pick: (review: NonNullable<DocumentViewpoint['review']>) => string | undefined) => (vp: DocumentViewpoint) =>
        atAssessmentStation(vp) && vp.review ? (pick(vp.review) ?? '') : ''
    const retentionBands = RETENTION_LEVELS.map(
      (level) => `${level.label.replace(/\s*retention\s*\(\w+\)$/, '')} (${RETENTION_GRADE[level.id]})`,
    ).join(', ')
    const ocularCode = (vp: DocumentViewpoint) => {
      const id = judgedOcular(vp, ctx)?.classId
      return id ? (CLASS_CODES_BY_ID[id as keyof typeof CLASS_CODES_BY_ID] ?? null) : null
    }
    const rows: Array<{ label: string; value: (vp: DocumentViewpoint) => string }> = [
      { label: `Response to visual force lines? ${options('force-lines')}`, value: judged((r) => r.forceLines) },
      { label: `Borrows from natural character? ${options('natural-character')}`, value: judged((r) => r.borrow) },
      { label: `Incorporates edge treatments? ${options('edge-treatment')}`, value: judged((r) => r.edges) },
      {
        label: `Tree retention, “islands,” or patches of trees? ${retentionBands}`,
        value: (vp) => {
          const kept = seenRetention(ctx, vp)
          return kept ? `${kept.grade} (${Math.round(kept.percent)}%)` : ''
        },
      },
      { label: `Position on the landform? ${options('position')}`, value: judged((r) => r.position) },
      {
        label: `Category of visually altered landform: ${CLASS_ORDER.map((code) => CLASS_NAMES[code]).join(', ')}`,
        value: (vp) => {
          const code = atAssessmentStation(vp) ? ocularCode(vp) : null
          return code ? CLASS_NAMES[code] : ''
        },
      },
    ]
    const cells = rows.map((row) => vps.map(row.value))
    const toComplete = rows.flatMap((row, r) => {
      const missing = vps.filter((_, i) => !cells[r][i]).map((vp) => vp.name)
      return missing.length
        ? [`Section 3, ${row.label.split('?')[0].split(':')[0].toLowerCase()}: ${andList(missing)}`]
        : []
    })
    return {
      blocks: [
        heading('3. Assessing visual design'),
        {
          kind: 'table',
          columns: ['Visual design factors', ...vps.map((vp, i) => `VP ${vp.n ?? i + 1}: ${vp.name}`)],
          rows: rows.map((row, r) => [row.label, ...cells[r]]),
          note: 'Tree retention is the seen blocks’ recorded share left standing, area-weighted, on Table 5’s bands; the other ratings are the reviewer’s, at the assessment station.',
          source: 'reviewer',
        },
      ],
      toComplete,
    }
  },
}

/** 2001 form section 3: the numerical worksheet, per viewpoint, with the partial-cut table when a block is cut so. */
const numericalData: ReportPart = {
  id: 'numerical-data',
  title: 'Assessing numerical data',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    // 01's form numbers it 4, after its own section 3 on visual design; the summary forms (03, 05) number it 3.
    const blocks: ReportBlock[] = [
      heading(`${ctx.recipeParts?.includes('visual-design') ? 4 : 3}. Assessing numerical data`),
    ]
    const toComplete: string[] = []
    // The summary forms' instructions above the worksheet: form wording.
    if (ctx.recipeParts?.includes('notes-2001')) blocks.push(text(NUMERICAL_INSTRUCTIONS_2001.join(' '), 'fixed'))
    // The clearcut worksheet as the 2001 forms print it: its four lines down the side, a column per viewpoint.
    const vps = ctx.facts.viewpoints
    // Each viewpoint's class on the format's own scale, and the class met from them all (the most altered).
    const classes = vps.map((vp) => resolved(ctx, vp.name)?.printed?.classCode ?? null)
    const read = classes.filter((code): code is ClassCode => code !== null)
    const fromAll =
      read.length && read.length === vps.length
        ? read.reduce((a, b) => (CLASS_ORDER.indexOf(b) > CLASS_ORDER.indexOf(a) ? b : a))
        : null
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
          line(`VQO achieved on percent alteration (${ctx.document.format.percentScale.name})`, (vp) => {
            const printed = resolved(ctx, vp.name)?.printed
            return printed ? (printed.classCode ?? printed.term) : ''
          }),
        ],
        note: 'Pixels of each view’s class pass, on the format’s arithmetic; each figure read on the format’s scale.',
        source: 'run',
      })
    }
    // The summary forms ask which class the figures alone meet (03, 05); 01's partial-cut form reads the cut instead.
    if (vps.length && ctx.recipeParts?.includes('notes-2001')) {
      blocks.push({
        kind: 'choices',
        label:
          'Which VQO would the proposed alteration, in combination with any existing non-VEG alterations, meet from all the selected viewpoints based on percent alteration only?',
        options: [...CLASS_ORDER],
        chosen: fromAll,
        source: 'run',
      })
      if (!fromAll)
        toComplete.push(
          read.length
            ? 'The VQO met on percent alteration only: a viewpoint’s figure reads past the scale (Other)'
            : 'The VQO met on percent alteration only (no viewpoint has a class pass)',
        )
    }
    // The poster's clearcut guide beside its partial-cut table, read at the highest viewpoint's alteration.
    if (ctx.blocks.some((block) => block.system.startsWith('Clearcut'))) {
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
    return { blocks, toComplete }
  },
}

/** The 2001 summary form's instructions above its numerical worksheet (03, 05): form wording. */
export const NUMERICAL_INSTRUCTIONS_2001 = [
  'Complete either the clearcut or partial-cutting section below depending on the silviculture system used.',
  'Use photograph or computer simulation output from each viewpoint for the calculations; see Appendix 8 of the Visual Impact Assessment Guidebook (2nd edition, 2001) for an example of the calculation.',
] as const

/** The 2001 form's four VIA summary questions, as every 2001 form prints them (01, 03, 05). */
export const SUMMARY_QUESTIONS_2001 = {
  definition:
    'Does the proposal, in combination with any existing non-VEG alterations, achieve the basic definition for the established VQO?',
  design: 'Have visual design concepts and principles been incorporated into block/road design?',
  numerical:
    'Does the proposal, in combination with any existing non-VEG alterations, fall within the numerical ranges for the established VQO?',
  met: 'Given the three criteria listed above, does the proposal meet the established VQO from all the selected viewpoint(s)?',
} as const

/** 2001 form's summary: four questions, answered where the run or the reviewer answers them. */
const summary2001: ReportPart = {
  id: 'summary-2001',
  title: 'VIA summary',
  sources: ['01', '03', '05'],
  build: (ctx) => {
    const objective = objectiveOf(ctx)
    // Within only when every viewpoint is: VQOs must be achieved from all selected viewpoints (note 4). A figure past
    // the scale's last class is over every range.
    const readings = ctx.document.viewpoints.flatMap((vp) =>
      vp.printed && objective
        ? [vp.printed.classCode ? CLASS_ORDER.indexOf(vp.printed.classCode) <= CLASS_ORDER.indexOf(objective) : false]
        : [],
    )
    const within = readings.length ? readings.every(Boolean) : null
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
        label: SUMMARY_QUESTIONS_2001.definition,
        options: ['Yes', 'No'],
        chosen: yesNo(definition),
        source: 'reviewer',
      },
      {
        kind: 'choices',
        label: SUMMARY_QUESTIONS_2001.design,
        options: ['Yes', 'No'],
        chosen: yesNo(design),
        source: 'reviewer',
      },
      {
        kind: 'choices',
        label: SUMMARY_QUESTIONS_2001.numerical,
        options: ['Yes', 'No'],
        chosen: yesNo(within),
        source: 'run',
      },
      {
        kind: 'choices',
        label: SUMMARY_QUESTIONS_2001.met,
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

type FactsViewpoint = ReportContext['facts']['viewpoints'][number]

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
/** A bearing as an eight-point compass word ("west"), as Appendix 1's viewing direction reads. */
const compassWord = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const latLng = (vp: FactsViewpoint) => (vp.lngLat ? `${vp.lngLat[1].toFixed(5)}, ${vp.lngLat[0].toFixed(5)}` : null)

/**
 * Appendix 1's 3.1.1 site and 3.1.3 objective lines for one viewpoint's form: the office fields, the blocks it sees,
 * and the inventory unit of the landform it reads (its own read, else the scene's when it reads the scene's landform,
 * else the office fields for that landform). Date established and source document are office fields.
 */
function appendixSite(ctx: ReportContext, vp: FactsViewpoint | null) {
  const seen = vp ? seenBlocks(vp.blocks).filter((b) => b.proposed !== false) : []
  const own = vp ? vp.blocks.filter((b) => b.proposed !== false) : []
  const ids = (seen.length ? seen : own).map((b) => b.id)
  const site = [
    officeRow(ctx, 'district', 'Natural resource district'),
    officeRow(ctx, 'licensee', 'Licensee'),
    generalLocationRow(ctx),
    officeRow(ctx, 'licence', 'Licence'),
    officeRow(ctx, 'cuttingPermit', 'Cutting permit'),
    field(
      'Blocks',
      ids.length
        ? ids.join(', ')
        : proposedBlocks(ctx)
            .map((b) => b.name)
            .join(', '),
      'scene',
    ),
  ]
  const sameLandform = !vp || !ctx.landform || vp.landform === ctx.landform.name || landformNames(ctx).length <= 1
  const unit = (vp ? viewpointInventory(ctx, vp) : null) ?? (sameLandform ? ctx.inventory : null)
  const office = (key: keyof OfficeFields) => (sameLandform ? blank(ctx.office[key]) : null)
  const from = (value: string | undefined) => (value ? 'run' : 'scene') as 'run' | 'scene'
  const objective = [
    field('VLI polygon no.', unit?.vsu ?? office('vliPolygon'), from(unit?.vsu)),
    field('EVC', unit?.evc ?? office('evc'), from(unit?.evc)),
    field('VAC', unit?.vac ?? (sameLandform ? ctx.landform?.vac : null), 'run'),
    field('VSC', unit?.vsc ?? office('vsc'), from(unit?.vsc)),
    field('EVQO', unit?.vqo ?? vp?.objective ?? objectiveOf(ctx), from(unit?.vqo)),
    inventoryDateField(ctx, 'Date established'),
    officeRow(ctx, 'sourceDocument', 'Source document'),
  ]
  return { site, objective }
}

/** Appendix 1's 3.2.1 viewpoint and 3.2.2 photography lines: the simulation camera's, and the viewpoint's Table 3 importance. */
function appendixViewpoint(vp: FactsViewpoint | null) {
  if (!vp)
    return {
      viewpoint: [
        'Viewpoint description',
        'Latitude, longitude',
        'Elevation',
        'Viewing direction',
        'Viewing distance',
      ].map((label) => field(label, null, 'reviewer')),
      photography: [field('Lens focal length', null, 'reviewer')],
    }
  const direction = viewDirection(vp)
  return {
    viewpoint: [
      field('Viewpoint description', viewpointPlaceName(vp.name), 'run'),
      field('Latitude, longitude', latLng(vp), 'run'),
      field('Elevation', eyeElevation(vp) || null, 'run'),
      field(
        'Viewing direction',
        direction ? `${compassWord(vp.bearingDeg!).replace(/^./, (c) => c.toUpperCase())} (${direction})` : null,
        'run',
      ),
      field('Viewing distance', vp.distanceKm === null ? null : `${vp.distanceKm.toFixed(1)} km`, 'run'),
      field('Viewpoint importance', vp.review?.importance, 'reviewer'),
    ],
    photography: [
      field(
        'Lens focal length',
        vp.lensMm
          ? `${Math.round(vp.lensMm)} mm (35 mm equivalent)${vp.hfovDeg ? `, ${vp.hfovDeg.toFixed(1)}° across` : ''}`
          : null,
        'run',
      ),
    ],
  }
}

/** 3.4.4 for a viewpoint that sees a partial cut: the scene's prescription on the partial-cut table (the form titles it). */
function appendixPartialCut(ctx: ReportContext, vp: FactsViewpoint | null): ReportBlock[] {
  const cut = ctx.blocks.find(
    (b) => b.partialCut && (!vp || vp.blocks.some((seen) => blockId(seen.id) === blockId(b.name))),
  )
  return cut ? [partialCutMatrix(cut.partialCut, ctx.recipeOptions?.partialCutGuide)] : []
}

/** What one viewpoint's Appendix 1 holds, section by section, before it is laid out. */
interface AppendixFormSections {
  site: FieldRow[]
  objective: FieldRow[]
  viewpoint: FieldRow[]
  photography: FieldRow[]
  photographyTitle: string
  ocular: ReportBlock
  numerical: ReportBlock[]
  partialCut: ReportBlock[]
  design: ReportBlock
  roads: ReportBlock
  retention: ReportBlock
  adjusted: ReportBlock[]
  rating: ReportBlock[]
}

/**
 * One viewpoint's Appendix 1 laid out as the handbook prints it, one form to a page: the office and field sections
 * side by side (3.1.1 beside 3.1.3, 3.2.1 beside 3.2.2), the scales and Table 3 across the page, Tables 4 and 5 side by
 * side, and the rating beside the sign-off.
 */
function appendixForm(sections: AppendixFormSections): ReportBlock {
  const s = sections
  return {
    kind: 'form',
    rows: [
      [
        { title: '3.1.1 Site information', blocks: [fields(s.site)] },
        { title: '3.1.3 FSP and objective information', blocks: [fields(s.objective)] },
      ],
      [
        { title: '3.2.1 Viewpoint', blocks: [fields(s.viewpoint)] },
        { title: s.photographyTitle, blocks: [fields(s.photography)] },
      ],
      [{ title: '3.4.1 Ocular assessment: class by eye', blocks: [s.ocular] }],
      [{ title: '3.4.2 Numerical assessment', blocks: s.numerical }],
      ...(s.partialCut.length ? [[{ title: '3.4.4 Partial cuts', blocks: s.partialCut }]] : []),
      [{ title: '3.4.3 Adjustment, Table 3: visual design elements', blocks: [s.design] }],
      [
        { title: '3.4.3 Table 4: roads, landings and sidecast', blocks: [s.roads] },
        { title: '3.4.3 Table 5: tree retention', blocks: [s.retention] },
      ],
      [{ title: '3.4.3 Adjusted percent alteration, X (1 + 0.14 Y)', blocks: s.adjusted }],
      [
        { title: '3.5 Rating and rationale', blocks: s.rating },
        { title: 'Sign-off', blocks: [{ kind: 'signature', lines: ['Evaluated by', 'Signature', 'Date'] }] },
      ],
    ],
  }
}

/**
 * The run's own lines of one viewpoint's form (06 fills a form per viewpoint that sees a block): 3.1 from the office
 * fields and the inventory, 3.2 from the simulation camera, and 3.4.2's a, c and X from the viewpoint's picture on the
 * format's rule. Line b (roads outside openings) is not a class of the picture's pass, and the ocular class, the
 * adjustments, the rating and the rationale are the reviewer's: blank, and listed. Never a judgement from another view.
 */
function appendixRunForm(ctx: ReportContext, vp: FactsViewpoint, tableSevenFollows: boolean) {
  const out = resolved(ctx, vp.name)
  const result = out?.alteration ?? null
  const part = (id: 'proposed' | 'nonVeg') => {
    const found = result?.parts.find((entry) => entry.part === id)
    return found ? `${found.printed}%` : result ? '0%' : null
  }
  const { site, objective } = appendixSite(ctx, vp)
  const { viewpoint, photography } = appendixViewpoint(vp)
  const reading = out?.printed
    ? `${out.printed.percent}% (${out.printed.classCode ? CLASS_NAMES[out.printed.classCode] : out.printed.term})`
    : null
  const numerical = [
    field('a) % of landform altered by proposed openings', part('proposed'), 'run'),
    field('b) % of landform in access roads (outside openings)', null, 'reviewer'),
    field('c) % non-VEG contribution of existing openings', part('nonVeg'), 'run'),
    field('X, the picture’s percent alteration (a + c)', reading, 'run'),
  ]
  const blocks: ReportBlock[] = [
    { kind: 'pageBreak' },
    heading(`Appendix 1: Visual impact assessment summary form, ${vp.name}`),
    appendixForm({
      site,
      objective,
      viewpoint,
      photography,
      photographyTitle: '3.2.2 Photography (simulation camera)',
      ocular: pmmArrow('Class by eye', null, 'reviewer'),
      numerical: [
        fields(numerical),
        text(
          `X is measured on the simulation from ${vp.name}, as ${ctx.document.format.rule.formula}; access roads outside the openings (b) are not a class of its picture and are added by the reviewer.`,
          'run',
        ),
        table2Bar('Initial percent alteration (X)', result?.printedValue ?? null, 'run'),
      ],
      partialCut: appendixPartialCut(ctx, vp),
      design: designElementsMatrix(null, 'reviewer'),
      roads: roadsMatrix(null),
      retention: retentionMatrix(null, 'reviewer'),
      adjusted: [table2Bar('Adjusted percent alteration, X (1 + 0.14 Y)', null, 'reviewer')],
      rating: [
        ...(tableSevenFollows ? [] : [extentMatrix(null)]),
        fields([field('3.5.2 Rationale', null, 'reviewer')]),
      ],
    }),
  ]
  const runMissing = missingFields([...viewpoint.filter((row) => row.source === 'run'), ...photography, numerical[0]])
  const toComplete = [
    ...missingFields([...site, ...objective]),
    ...runMissing.map((label) => `${vp.name}: ${label}`),
    `${vp.name}: class by eye (3.4.1), line b, the design, roads and retention adjustments (3.4.3), the rating and the rationale (3.5)`,
    ...(vp.review?.importance ? [] : [`${vp.name}: viewpoint importance`]),
  ]
  return { blocks, toComplete }
}

/** The form at the assessment station, with the reviewer's step 4 record: the only form a judgement is printed on. */
function appendixJudgedForm(ctx: ReportContext, vp: FactsViewpoint, a: ViaAssessment, tableSevenFollows: boolean) {
  const a1 = vp.appendix1
  const level = ctx.review?.retention ?? a.retentionMeasured?.level ?? null
  const out = resolved(ctx, vp.name)
  const x = a1?.x ?? null
  const { site, objective } = appendixSite(ctx, vp)
  const { viewpoint, photography } = appendixViewpoint(vp)
  const blocks: ReportBlock[] = [
    { kind: 'pageBreak' },
    heading(`Appendix 1: Visual impact assessment summary form, ${vp.name}`),
    appendixForm({
      site,
      objective,
      viewpoint,
      photography,
      photographyTitle: '3.2.2 Photography (simulation camera)',
      ocular: pmmArrow('Class by eye', a.ocular ? CLASS_CODES_BY_ID[a.ocular.classId] : null, 'reviewer'),
      numerical: [
        ...(a1
          ? [
              fields([
                field('a) % of landform altered by proposed openings', `${a1.a.toFixed(1)}%`, 'run'),
                field('b) % of landform in access roads (outside openings)', `${a1.b.toFixed(1)}%`, 'run'),
                field('c) % non-VEG contribution of existing openings', `${a1.c.toFixed(1)}%`, 'run'),
              ]),
            ]
          : []),
        ...paragraph(out?.sentences.filter((s) => s.id === 'x') ?? []),
        table2Bar('Initial percent alteration (X)', x, 'run'),
      ],
      partialCut: appendixPartialCut(ctx, vp),
      design: designElementsMatrix(
        Object.fromEntries(Object.entries(a.design).map(([id, entry]) => [id, entry.rating])),
        'reviewer',
      ),
      roads: roadsMatrix(a.roads),
      retention: retentionMatrix(level, ctx.review?.retention ? 'reviewer' : 'scene'),
      adjusted: [
        ...paragraph(out?.sentences.filter((s) => s.id === 'y') ?? []),
        table2Bar('Adjusted percent alteration, X (1 + 0.14 Y)', a1?.adjusted ?? null, 'reviewer'),
      ],
      rating: [
        ...(tableSevenFollows ? [] : [extentMatrix(a.rating?.id ?? null)]),
        ...(ctx.review?.rationale ? [text(ctx.review.rationale, 'reviewer')] : []),
      ],
    }),
  ]
  return { blocks, toComplete: [...missingFields([...site, ...objective]), ...a.missing] }
}

/**
 * The 2022 handbook's Appendix 1: one form per viewpoint that sees the proposal (06), each with the run's own lines;
 * the step 4 judgements only on the form at the assessment station, from the reviewer's record. With no viewpoint
 * seeing anything and no record, one blank form for the reviewer.
 */
const appendix1: ReportPart = {
  id: 'appendix-1',
  title: 'Appendix 1: VIA summary form',
  sources: ['06', '07'],
  build: (ctx) => {
    const station = assessed(ctx)
    const a = ctx.assessment
    const judged = station && a ? station : null
    // The recipe's own Table 7 part prints the extent scale (marked from the same rating): it is not printed twice.
    const tableSevenFollows = !!ctx.recipeParts?.includes('extent-scale')
    const forms = ctx.facts.viewpoints.filter((vp) => vp === judged || seesProposal(vp))
    if (!forms.length) {
      // The form still prints, as the handbook lays it out: the office and scene facts filled, every judgement and
      // the viewpoint's own lines blank for the reviewer.
      const { site, objective } = appendixSite(ctx, null)
      const { viewpoint, photography } = appendixViewpoint(null)
      return {
        blocks: [
          heading('Appendix 1: Visual impact assessment summary form'),
          text(
            'No viewpoint stands at the run’s assessment station with a step 4 record, and none sees the proposal, so the form is not filled: it is printed for the reviewer to complete at the key viewpoint.',
            'run',
          ),
          appendixForm({
            site,
            objective,
            viewpoint,
            photography,
            photographyTitle: '3.2.2 Photography',
            ocular: pmmArrow('Class by eye', null, 'reviewer'),
            numerical: [
              fields([
                field('a) % of landform altered by proposed openings', null, 'run'),
                field('b) % of landform in access roads (outside openings)', null, 'run'),
                field('c) % non-VEG contribution of existing openings', null, 'run'),
              ]),
              table2Bar('Initial percent alteration (X)', null, 'run'),
            ],
            partialCut: [],
            design: designElementsMatrix(null, 'reviewer'),
            roads: roadsMatrix(null),
            retention: retentionMatrix(null, 'reviewer'),
            adjusted: [table2Bar('Adjusted percent alteration, X (1 + 0.14 Y)', null, 'reviewer')],
            rating: [
              ...(tableSevenFollows ? [] : [extentMatrix(null)]),
              fields([field('3.5.2 Rationale', null, 'reviewer')]),
            ],
          }),
        ],
        toComplete: ['Step 4 at the assessment station', ...missingFields([...site, ...objective])],
      }
    }
    const blocks: ReportBlock[] = []
    const toComplete: string[] = []
    if (!judged) {
      // The note runs on after the part before it: each form keeps a page of its own, as the handbook prints it.
      blocks.push(
        heading('Appendix 1: Visual impact assessment summary forms'),
        text(
          `Step 4 has not been recorded at the assessment station, so the forms’ judgements are not filled: each of the ${forms.length === 1 ? 'one form' : `${NUMBER_WORDS[forms.length] ?? forms.length} forms`}, one per viewpoint that sees the proposal, carries only what the run measured from its viewpoint, for the reviewer to complete.`,
          'run',
        ),
      )
      toComplete.push('Step 4 at the assessment station')
    } else if (forms.length > 1)
      blocks.push(
        heading('Appendix 1: Visual impact assessment summary forms'),
        text(
          `The judgements on the form for ${judged.name} are the reviewer’s step 4 record at the assessment station; the other forms carry only what the run measured from their viewpoints, their judgements blank for the reviewer.`,
          'run',
        ),
      )
    for (const vp of forms) {
      const form =
        vp === judged ? appendixJudgedForm(ctx, vp, a!, tableSevenFollows) : appendixRunForm(ctx, vp, tableSevenFollows)
      // Each form starts a page of its own, which it fills (`appendixForm`).
      blocks.push(...form.blocks)
      toComplete.push(...form.toComplete)
    }
    return { blocks, toComplete: [...new Set(toComplete)] }
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
      {
        ...fillSentence(
          'rating',
          'The assessment rates the {objective} objective {rating} at the assessment station.',
          { objective: objectiveName(ctx), rating: rating?.label.toLowerCase() },
          'reviewer',
        ),
        label: 'The rating at the assessment station (step 4)',
      },
    ]
    const written = paragraph(sentences)
    return {
      blocks: [
        heading('Conclusion'),
        ...(written.length
          ? written
          : [text('The conclusion is written once the extent the objective is met is rated (step 4).', 'reviewer')]),
      ],
      toComplete: sentences.filter((s) => !s.text).map(toCompleteLine),
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
  // A viewpoint whose picture shows proposed ground sees the proposal, whatever its callouts' samples say.
  const seeing = vps.filter(
    (vp) =>
      vp.blocks.some((b) => proposed(b) && (b.status === 'visible' || b.status === 'possible glimpses')) ||
      pictureShowsProposal(vp),
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
            figures.map(
              (f) => `${f.percent}% from ${f.name} (${f.code ? CLASS_NAMES[f.code] : scale.beyond.toLowerCase()})`,
            ),
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
  // A picture showing proposed ground its callouts do not place leaves none of its blocks unseen.
  const unplaced = (vp: (typeof vps)[number]) => pictureShowsProposal(vp) && !seenBlocks(vp.blocks).length
  const unseen = ids.filter(
    (id) =>
      vps.every((vp) => vp.blocks.some((b) => b.id === id)) &&
      vps.every((vp) => vp.blocks.every((b) => b.id !== id || b.status === 'not visible')) &&
      !vps.some((vp) => unplaced(vp) && vp.blocks.some((b) => b.id === id)),
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

/** limitations: defined once in JSON (`recipeJson/components/limitations.json`), read by `kitBlocks.ts`. */
const limitations = jsonPart('limitations')

/** sign-off: defined once in JSON (`recipeJson/components/sign-off.json`), read by `kitBlocks.ts`. */
const signOff = jsonPart('sign-off')

/** references: defined once in JSON (`recipeJson/components/references.json`), read by `kitBlocks.ts`. */
const references = jsonPart('references')

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
          field('VLI no.', viewpointInventory(ctx, vp)?.vsu, 'run'),
          field('VSC', viewpointInventory(ctx, vp)?.vsc, 'run'),
          field('VAC', viewpointInventory(ctx, vp)?.vac, 'run'),
          field('EVQO', viewpointInventory(ctx, vp)?.vqo ?? vp.objective, 'run'),
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
              seen:
                !vp.blocks.length && !pictureShowsProposal(vp)
                  ? 'no proposed block lies in the view'
                  : seen.length
                    ? glimpsesOnly(seen, resolvedVp?.printed?.percent ?? null)
                      ? `${blockList(seen.map((block) => block.id))} may be seen only in glimpses (${resolvedVp?.printed?.percent ?? '?'}% of the landform in the picture)`
                      : `${blockList(seen.map((block) => block.id))} ${seen.length === 1 ? 'is' : 'are'} in view (${resolvedVp?.printed?.percent ?? '?'}% of the landform in the picture)`
                    : // The picture shows proposed ground the callouts' samples miss: a block is seen, at its figure.
                      pictureShowsProposal(vp)
                      ? resolvedVp?.printed && Number(resolvedVp.printed.percent) < GLIMPSE_LANDFORM_PERCENT
                        ? `the proposed blocks may be seen only in glimpses (${resolvedVp?.printed?.percent ?? '?'}% of the landform in the picture)`
                        : `part of the proposed blocks is in view (${resolvedVp?.printed?.percent ?? '?'}% of the landform in the picture)`
                      : `no proposed block is expected to be visible${hiddenCause(vp.blocks) ? `, ${hiddenCause(vp.blocks)}` : ''}`,
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
  blocks: ReadonlyArray<{ status: string; visiblePercent: number; screenedPercent?: number }>,
  percent: string | null,
  /** The picture's class pass counts proposed ground (`pictureShowsProposal`): then a block is seen, whatever else. */
  pictureShows = false,
): string | null {
  if (blocks.some((b) => b.status === 'unknown')) return null
  const seen = seenBlocks(blocks)
  const cause = hiddenCause(blocks)
  if (!seen.length && !pictureShows) return `is not expected to be visible${cause ? `, ${cause}` : ''}`
  // The picture shows proposed ground the callouts' samples miss: part of it is seen, at the picture's figure.
  if (!seen.length)
    return percent !== null && Number(percent) < GLIMPSE_LANDFORM_PERCENT
      ? `may be seen only in glimpses (${percent}% of the landform in this picture)`
      : `is expected to be partly visible (${percent ?? '?'}% of the landform in this picture)`
  if (glimpsesOnly(seen, percent))
    return `may be seen only in glimpses (${percent ?? '?'}% of the landform in this picture)${
      cause ? `; the rest of the blocks’ ground is ${cause}` : ''
    }`
  return seen.length < blocks.length
    ? `is expected to be partly visible: ${seen.length} of ${blocks.length} blocks in view, ${percent ?? '?'}% of the landform in this picture`
    : `is expected to be visible (${percent ?? '?'}% of the landform in this picture)`
}

/**
 * Which viewpoints were simulated and why, from the run: those that see the proposal (a line of sight to a block, or
 * proposed ground in the picture), named, and those that see none (26's memo, 21's and 06's methods).
 */
export function simulatedViewpointsSentence(ctx: ReportContext): Sentence {
  const seenFrom = ctx.facts.viewpoints.filter(seesProposal)
  const blind = ctx.facts.viewpoints.filter((vp) => !seenFrom.includes(vp))
  // A viewpoint seen only through its picture (the samples miss what the class pass shows) is not a line of sight.
  const why = seenFrom.every((vp) => seenBlocks(vp.blocks).length)
    ? 'the run finds a line of sight from {seenEach} to the proposed blocks'
    : 'the proposed blocks are in view from {seenEach}'
  return fillSentence(
    'ea-modelled',
    seenFrom.length && blind.length
      ? `{seen} {seenVerb} simulated because ${why}; {blind} {blindVerb} none and {blindIs} shown with the blocks’ position marked.`
      : seenFrom.length
        ? `{seen} {seenVerb} simulated because ${why}.`
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
}

/** "Figure 2", "Figures 2 and 3". */
const figureNumbers = (numbers: readonly number[]) =>
  `Figure${numbers.length === 1 ? '' : 's'} ${andList(numbers.map(String))}`

/**
 * Where the simulations are, by the figure numbers their pages print (26: "The simulations are Figures 2 and 3."),
 * and which figures show a viewpoint that sees none of the proposal. Null when the recipe prints no figure pages.
 */
export function simulationFiguresSentence(ctx: ReportContext): Sentence | null {
  if (!ctx.recipeParts?.includes('ea-figure-pages')) return null
  // Only the pages the report prints are numbered: in a file, a viewpoint with no picture before or after has none.
  const paged = new Set(figurePageViewpoints(ctx))
  const printed = ctx.facts.viewpoints.filter((vp) => paged.has(vp.name))
  if (!printed.length) return null
  const first = firstFigureNumber(ctx, 'ea-figure-pages')
  const numbered = printed.map((vp, i) => ({ vp, n: first + i }))
  const seen = numbered.filter((entry) => seesProposal(entry.vp)).map((entry) => entry.n)
  const blind = numbered.filter((entry) => !seesProposal(entry.vp))
  return fillSentence(
    'ea-figures',
    seen.length && blind.length
      ? 'The simulations are {seen}; {blind} {shows} the view from {blindNames}.'
      : seen.length
        ? 'The simulations are {seen}.'
        : '{blind} {shows} the view from {blindNames}.',
    {
      seen: seen.length ? figureNumbers(seen) : null,
      blind: blind.length ? figureNumbers(blind.map((entry) => entry.n)) : null,
      shows: blind.length === 1 ? 'shows' : 'show',
      blindNames: andList(blind.map((entry) => entry.vp.name)),
    },
    'run',
  )
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
      const visibility = visibilityPhrase(facts.blocks, vp.printed?.percent ?? null, pictureShowsProposal(facts))
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
    const modelled = simulatedViewpointsSentence(ctx)
    const pointer = simulationFiguresSentence(ctx)
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
          preparerRow(ctx, 'Prepared by'),
          field('Date', ctx.date.toISOString().slice(0, 10), 'run'),
        ]),
        ...purpose.build(ctx).blocks.slice(1),
        heading('Existing visual conditions', 3),
        text(existing, 'run'),
        heading('Potential landscape changes', 3),
        ...paragraph([proposal, mapNote].filter((entry): entry is Sentence => !!entry)),
        { kind: 'list', items: ctx.facts.viewpoints.map((vp, i) => `OV${i + 1}: ${vp.name}`), source: 'run' },
        ...paragraph([modelled, ...(pointer ? [pointer] : []), ...reasons]),
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
