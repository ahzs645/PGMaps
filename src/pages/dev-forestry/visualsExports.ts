/**
 * What the visual-quality Save & export dialog offers: each output's group, formats and one-line
 * description, why one is unavailable, and what goes into it — the landform, the viewpoints and
 * saved views with their settings, the blocks, the run and the review — read from the same state
 * the file is written from. No DOM or network access.
 */

import type { ContentsPart } from '@/lib/documentContents/contents'
import { formatBytes } from '@/lib/format'
import { CASTOR_DENOMINATOR_NOTE, castorConstraintProblem, castorVqoConstraint } from './castorConstraint'
import { layoutStageLabel, layoutStageOf } from './fieldChecklist'
import type { SavedDriveView } from './previewState'
import type { ForestryScene } from './scene'
import { sceneGisPlan, sceneGisUnavailable, type SceneGisPlanEntry } from './sceneGis'
import { findSceneLandform } from './sceneInput'
import { landformAssignments } from './viewLandform'
import {
  ROAD_VIDEO_FORMAT,
  roadVideoContents,
  roadVideoUnavailable,
  type RoadVideoPlan,
  type RoadVideoScene,
  type RoadVideoTakeFacts,
} from './roadVideo'
import { DIAGNOSTIC_LABEL, runFigures, withheldText } from './runFigures'
import { runExistingBasis } from './existingBasis'
import type { AnalysisResult, HarvestSystem, RunGap, TargetPolygon } from './types'
import type { ViaAssessment, ViaStepId } from './via'
import { recipeContents, type PartFacts, type RecipeContentsSource } from './viaReport/recipeContents'
import { lineLengthMeters, polygonAreaMeters } from './visibility'
import { EVQO_CODE_FOR_CLASS, EVQO_NAMES } from './visualsNarrative'
import {
  isIncluded,
  lensLabel,
  viewCaptureKey,
  viewCaptureState,
  type ViewCaptureState,
  type ViewOfInterest,
} from './viewsOfInterest'
import type { VisualQualityClassId } from './vqo'

export type VisualsExport =
  | 'block-note'
  | 'route-card'
  | 'fs1252'
  | 'analysis-sheet'
  | 'via-document'
  | 'via-report'
  | 'field-brief'
  | 'block-sheet'
  | 'worksheet'
  | 'evidence'
  | 'project'
  | 'scene'
  | 'views'
  | 'workspace'
  | 'scene-package'
  | 'scene-gis'
  | 'castor-constraint'
  | 'stand-trees'
  | 'sightline-archive'
  | 'road-video'

export type VisualsExportGroup = 'documents' | 'files' | 'exchange'

export const VISUALS_EXPORT_GROUP_LABELS: Record<VisualsExportGroup, string> = {
  documents: 'Assessment documents',
  files: 'Save and reopen',
  exchange: 'For other tools',
}

export type ExportFormat = { id: string; label: string; extension: string }

export interface VisualsExportItem {
  kind: VisualsExport
  group: VisualsExportGroup
  label: string
  description: string
  /** The first is the default. */
  formats: readonly ExportFormat[]
}

const PDF: ExportFormat = { id: 'pdf', label: 'PDF', extension: '.pdf' }
const JSON_FILE: ExportFormat = { id: 'json', label: 'JSON', extension: '.json' }

export const VISUALS_EXPORTS: readonly VisualsExportItem[] = [
  {
    kind: 'block-note',
    group: 'documents',
    label: 'Block note',
    description:
      "The planning note's Visuals row: the block, the paragraph, the visual measures, the landform's alteration, the package's views of this block and a plan map.",
    formats: [{ id: 'xlsx', label: 'Excel', extension: '.xlsx' }, PDF],
  },
  {
    kind: 'route-card',
    group: 'documents',
    label: 'Route card',
    description:
      "The block's Route Card Tool Assessment read live from public BC layers, with the rows you entered, and the Other Considerations paragraphs drafted from it: the planners' workbook layout, or a Word document from the same parts.",
    formats: [
      { id: 'xlsx', label: 'Excel', extension: '.xlsx' },
      { id: 'docx', label: 'Word', extension: '.docx' },
    ],
  },
  {
    kind: 'fs1252',
    group: 'documents',
    label: 'FS1252 form',
    description:
      'The FS1252 simulation draft, one form per chosen station, with the step 4 record. The signature and final decision stay blank.',
    formats: [PDF],
  },
  {
    kind: 'analysis-sheet',
    group: 'documents',
    label: 'Analysis sheet',
    description:
      'A saved view drawn as a perspective viewpoint analysis: outlines from its class pass, block callouts, a legend, and the pixel percent beside the sightline percent.',
    formats: [PDF, { id: 'png', label: 'PNG', extension: '.png' }],
  },
  {
    kind: 'via-document',
    group: 'documents',
    label: 'VIA document',
    description:
      "A reference VIA format filled from the saved views: each view's figure on the format's own arithmetic and scale beside the sightline figure, its tables and wording, the images it needs, and what the reviewer still has to complete.",
    formats: [
      { id: 'md', label: 'Markdown', extension: '.md' },
      { id: 'json', label: 'JSON', extension: '.json' },
    ],
  },
  {
    kind: 'via-report',
    group: 'documents',
    label: 'VIA report',
    description:
      'A whole report in a reference VIA’s structure, assembled from shared parts: cover, inventory, criteria, method, the scales and matrices with their readings marked, tables, calculations, the form or Appendix 1, discussion, sign-off and figures, with your logo.',
    formats: [
      PDF,
      { id: 'docx', label: 'Word', extension: '.docx' },
      { id: 'docx-pdf', label: 'PDF from the Word layout', extension: '.pdf' },
      { id: 'html', label: 'Printable HTML', extension: '.html' },
      { id: 'md', label: 'Markdown', extension: '.md' },
    ],
  },
  {
    kind: 'field-brief',
    group: 'documents',
    label: 'Field brief',
    description:
      'One page for the layout crew: the block, landform and objective, where to stand and which way to face, up to three screenshots and the checklist.',
    formats: [PDF],
  },
  {
    kind: 'block-sheet',
    group: 'documents',
    label: 'Block map sheet',
    description:
      'A printed map of a block at a stated scale, in the road designer’s sheet types: field layout, slope and hillshade, 1:50,000 access, imagery and the operating plan. The landform, openings, masks and viewpoints are drawn on it, in PGMaps’ sheet symbols or a figure style. One sheet, or one sheet per block as one PDF or a ZIP; the map can be dimmed outside the block.',
    // PDF first and unchanged. The chips write the format kept with the sheet's other settings in this browser.
    formats: [PDF, { id: 'svg', label: 'SVG', extension: '.svg' }, { id: 'png', label: 'PNG', extension: '.png' }],
  },
  {
    kind: 'worksheet',
    group: 'documents',
    label: 'Worksheet',
    description: 'The worked figures of the current run, station by station, as Markdown.',
    formats: [{ id: 'md', label: 'Markdown', extension: '.md' }],
  },
  {
    kind: 'evidence',
    group: 'documents',
    label: 'VIA evidence package',
    description:
      'The recorded assessments, viewpoints and field records with the evidence checklist, separate from the FS1252.',
    formats: [PDF, { id: 'html', label: 'Printable HTML', extension: '.html' }],
  },
  {
    kind: 'project',
    group: 'files',
    label: 'Project',
    description:
      'A ZIP you can reopen in step 1. Keeps the scene, review, workspace, photos, saved captures and project attachments together.',
    formats: [{ id: 'zip', label: 'Project ZIP', extension: '.pgvq.zip' }],
  },
  {
    kind: 'sightline-archive',
    group: 'files',
    label: 'Sightline replay archive',
    description:
      'The last run retained in Reference measurements: its inputs, the terrain cells and inventory geometry it read, its figures and their checksums, to replay without a data service. Kept apart from the project, which never holds terrain or inventory.',
    formats: [{ id: 'zip', label: 'Sightline ZIP', extension: '.sightline.zip' }],
  },
  {
    kind: 'scene',
    group: 'files',
    label: 'Scene',
    description:
      'The road, landforms, blocks, openings, masks, settings and review, to reopen here. Terrain and inventory are read again.',
    formats: [JSON_FILE],
  },
  {
    kind: 'views',
    group: 'files',
    label: 'Saved views',
    description:
      'The scene with every saved view, to reopen with step 1’s Open a project…. Screenshots are not kept in the file; the Project keeps them.',
    formats: [JSON_FILE],
  },
  {
    kind: 'workspace',
    group: 'files',
    label: 'Assessment workspace',
    description:
      'Recorded runs, design options, viewpoints, field records and the current scene: the backup of what this browser stores.',
    formats: [JSON_FILE],
  },
  {
    kind: 'scene-package',
    group: 'files',
    label: '3D scene',
    description:
      'The road view as a file for other renderers: the ground, every tree drawn within 600 m, the cut ground and where the eye stands. Or the same scene as a 3D model (glTF, OBJ or STL) to look at in Blender or SketchUp: a simplified drawing with generated low-polygon trees. Display only.',
    // JSON first: other renderers read it, and it stays as it was.
    formats: [
      JSON_FILE,
      { id: 'glb', label: 'glTF', extension: '.glb' },
      { id: 'obj', label: 'OBJ', extension: '.zip' },
      { id: 'stl', label: 'STL', extension: '.stl' },
    ],
  },
  {
    kind: 'scene-gis',
    group: 'exchange',
    label: 'Scene for GIS',
    description:
      'The scene’s shapes for QGIS, ArcGIS or Google Earth, one layer per kind: blocks, landforms, existing openings, masks, tree-free areas, the viewpoint and the views of interest with the way each faces, in the plan map’s colours. No run figures.',
    formats: [
      { id: 'gpkg', label: 'GeoPackage', extension: '.gpkg' },
      { id: 'kmz', label: 'KMZ', extension: '.kmz' },
      { id: 'shp', label: 'Shapefiles', extension: '.zip' },
      { id: 'geojson', label: 'GeoJSON', extension: '.geojson' },
    ],
  },
  {
    kind: 'castor-constraint',
    group: 'exchange',
    label: 'Castor constraint',
    description:
      "The landform's objective as a Castor cover constraint (no more than the planimetric allowance below green-up height), with the landform as its zone, for a timber supply scenario.",
    formats: [
      { id: 'csv', label: 'constraints.csv', extension: '.csv' },
      { id: 'geojson', label: 'Zone GeoJSON', extension: '.geojson' },
    ],
  },
  {
    kind: 'stand-trees',
    group: 'exchange',
    label: 'Prescribed trees',
    description:
      'Every tree of the blocks with a stand prescription, the same tree before and after harvest: species, diameter, height, crown, and whether it stands or is cut. Display only.',
    formats: [
      { id: 'csv', label: 'CSV', extension: '.csv' },
      { id: 'geojson', label: 'GeoJSON points', extension: '.geojson' },
    ],
  },
  {
    kind: 'road-video',
    group: 'exchange',
    label: 'Road view video',
    description:
      'The road view as a video: the drive along the road at a chosen speed, or each view of interest in turn, as PGMaps draws it. A drawing of the scene with timber drawn to the inventory, not a photo simulation, with no figures. Recorded in real time as MP4, or WebM where the browser cannot write MP4. Display only.',
    // One format: the extension is the browser's (`formatControls` in `useVisualsExport`).
    formats: [ROAD_VIDEO_FORMAT],
  },
]

export const findVisualsExport = (kind: VisualsExport) =>
  VISUALS_EXPORTS.find((item) => item.kind === kind) ?? VISUALS_EXPORTS[0]

/** Media types by the extension a format writes, for *Save as…*'s dialog. */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  html: 'text/html',
  json: 'application/json',
  csv: 'text/csv',
  geojson: 'application/geo+json',
  zip: 'application/zip',
  gpkg: 'application/geopackage+sqlite3',
  kmz: 'application/vnd.google-earth.kmz',
  glb: 'model/gltf-binary',
  stl: 'model/stl',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

/** The file type *Save as…* offers for an output in a format: its media type, extension and a description. */
export function exportFileType(item: VisualsExportItem, format: ExportFormat) {
  const last = format.extension.split('.').at(-1) ?? ''
  return {
    mime: MIME_BY_EXTENSION[last] ?? 'application/octet-stream',
    extension: format.extension,
    description: item.formats.length > 1 ? `${item.label} (${format.label})` : item.label,
  }
}

/**
 * The name *Save as…* suggests when the file has not been written yet (the preview's file names it once it has): the
 * save dialog opens inside the click, before the file exists.
 */
export function suggestedExportName(item: VisualsExportItem, format: ExportFormat): string {
  return `forestry-visual-quality-${item.kind}${format.extension}`
}

export type Row = { label: string; value: string }

/** A saved view as the dialog lists it: where it was taken and what produced it. */
export type ExportView = {
  id: string
  name: string
  /** The road or viewpoint it was saved on. */
  place: string
  /** Saved on the viewpoint the scene has now, rather than one stood at earlier. */
  here: boolean
  positionMeters: number
  harvestPhase: 'before' | 'after'
  design: string | null
  hasScreenshot: boolean
  hasClassPass: boolean
  /**
   * In the package: the outputs that draw saved views (`USES_PACKAGE_VIEWS`) use it. Every view is, until left out
   * under *Package*; a capture of a view of interest goes in only while it is that view's current capture.
   */
  inReport: boolean
  /** Captured for a view of interest still planned: listed with that view, not on its own. Absent: false. */
  planned?: boolean
  /** The settings recorded when it was saved (position, facing, eye, lens, timber…). */
  settings: Row[]
}

/** An inventory viewpoint or rec site near the note's block, as the dialog lists it. */
export type ExportInventoryViewpoint = {
  key: string
  name: string
  kind: 'vli' | 'rec-site'
  distanceMeters: number
  /** One of its arrows points at the block. */
  aims: boolean
}

/** A planned view of interest (`viewsOfInterest.ts`) as the package lists it. */
export type ExportPlannedView = {
  id: string
  /** Its `viewCaptureKey`: a capture or a failure under another key is out of date. */
  key: string
  name: string
  /** The block it assesses, by name, and by id: the block note and the field brief of another block leave it out. */
  block: string
  blockId: string
  /** `lensLabel`: "50 mm · 39.6° across". */
  lens: string
  state: ViewCaptureState
  include: boolean
  /** The saved view that is its current capture, or null. */
  savedViewId: string | null
  /**
   * The view's own landform by name (`ViewOfInterest.landformId`), which its capture and figure are made against.
   * Null or absent: it is assessed against the site landform.
   */
  landform?: string | null
  /** Why its last capture under the current key failed, or null. Preview skips it; Download tries again. */
  failed: string | null
  /**
   * Captured, but without the before-harvest render an output pairs with it (the VIA report's before pictures, the
   * analysis sheet's with-timber figure): the export captures it again with its before render (`beforeToCapture`).
   * Absent: false.
   */
  beforeOwed?: boolean
  /** Why its before render could not be taken under the current key, or null/absent. Preview skips it; Download retries. */
  beforeFailed?: string | null
}

/** A view of the package an output cannot draw, and why (worded to follow "not in the file: "). */
export type UnprintedView = { id: string; name: string; reason: string }

/** The page's capture of views of interest (`useViewCapture`), as the dialog shows its progress. */
export type ExportCapture = {
  status: 'idle' | 'running' | 'done' | 'cancelled' | 'error'
  message: string | null
  done: number
  total: number
}

const IDLE_CAPTURE: ExportCapture = { status: 'idle', message: null, done: 0, total: 0 }

/** The visibility run the export starts on its own when a file needs it. */
/** The block map sheet as the dialog lists it: its choices in words, and what the scene puts on its map. */
export type ExportBlockSheet = {
  block: string
  sheet: string
  paper: string
  scale: string
  style: string
  /** Why the chosen sheet type cannot be made here, or null. */
  unavailable: string | null
  drawn: Row[]
  /** The file: format, one sheet or a series and which blocks, file names, the mask, the terrain read. */
  file: Row[]
  /** What the format holds and, for a series, how it is made and how a sheet that cannot be made is reported. */
  fileNote: string
  /** Why the series cannot be written as chosen (no block left, too many), or null. */
  problem: string | null
  /** The download's extension: the format's, or `.zip` / `.pdf` for a series. */
  extension: string
}

export type ExportAutoRun = {
  /** Why the scene cannot run, or null when it can. */
  blocker: string | null
  status: 'idle' | 'running' | 'error'
  /** The run's progress, worded, while it runs. */
  progress: string | null
  error: string | null
}

export type ExportLandform = {
  name: string
  objective: string
  vac: string | null
  areaHa: number
  source: string
  inventoryUnit: string | null
}

export type ExportContext = {
  run: 'current' | 'stale' | 'none'
  numericalReady: boolean
  /** Run warnings: what the PDF withholds and why. */
  runWarnings: string[]
  /** The run's figures, only when they are the assessment's (`runFigures`): null while the run is not ready. */
  perspectivePercent: number | null
  planimetricPercent: number | null
  /** Why the figures are withheld, first gap first (`runFigures`); empty when they are ready. */
  runGaps: RunGap[]
  /** The run's raw figures while they are withheld, printed only under the diagnostic label. */
  diagnosticPercents?: { perspective: number | null; planimetric: number | null }
  /** What the run's existing disturbance rests on (`runExistingBasis`); absent with no run. */
  existingBasis?: string | null
  rating: string | null
  ratingMissing: string[]
  ocularClass: string | null
  viewpoint: { name: string; kind: 'road' | 'spot'; lengthKm: number }
  /** The landform the run measures: the site's, or a view's own while the page stands at that view. */
  landform: ExportLandform | null
  landformCount: number
  /**
   * How the scene's other landforms are used: the site landform by name when the run measures a view's own instead,
   * how many views of interest have a landform of their own, and how many landforms nothing is assessed against.
   */
  landformUse: { site: string | null; viewsWithOwn: number; views: number; unused: number }
  blocks: Array<{ name: string; areaHa: number; system: string }>
  openings: number
  masks: Array<{ kind: string; name: string }>
  views: ExportView[]
  /** The views of interest planned on the plan map, captured as saved views on Preview or Download. */
  planned: ExportPlannedView[]
  /**
   * The package's views the outputs that draw figures (`DRAWS_FIGURES`) cannot draw, and why: saved without a
   * screenshot, or without the class pass its analysis sheet is drawn from. Each is named in the file and in What goes
   * in, never dropped silently.
   */
  unprinted: UnprintedView[]
  capture: ExportCapture
  /** The package's recipe by name, or null when none is chosen (the VIA document's format then chooses the report). */
  recipe: string | null
  /** The recipe the VIA report follows whether or not the package chose one, with its reference documents. */
  reportRecipe: { name: string; sources: string } | null
  settings: Row[]
  review: {
    visualsNote: 'yours' | 'draft'
    measures: 'yours' | 'draft'
    stage: string
    checklist: string
  }
  officeFields: { filled: number; total: number }
  /**
   * FS1252: the stations listed for the form, by station index: those chosen (`on`) and those switched off in its
   * contents, which keep their place until removed.
   */
  fs1252Stations: Array<{ index: number; label: string; on: boolean; assessment: boolean; inputs: boolean }>
  /** Block note: the text the paragraph panel holds, or null before a block. */
  blockNote: {
    /** The note's block: views of interest planned for another block are left out of it. */
    blockId: string
    header: Row[]
    landform: Row[]
    measures: number
    figures: boolean
  } | null
  /** VIA document: the format chosen and what it was filled from, or null before a view has a class pass. */
  document: {
    format: string
    sources: string
    formula: string
    scale: string
    images: string[]
    viewpoints: Array<{ name: string; figure: string }>
    toComplete: number
    gaps: string[]
  } | null
  /** VIA report: the recipe chosen and what it holds, or null before a view has a class pass. */
  report: {
    recipe: string
    sources: string
    figures: number
    /** Null while the report's parts load with the dialog (`viaReportEngine.ts`). */
    toComplete: number | null
    /** The figure style the maps' blocks and openings are drawn in, when one was chosen over the maps' own. */
    mapStyle?: string
  } | null
  /**
   * The VIA report's contents as its list reads them (`recipeContents.ts`): the package's recipe, the parts of the
   * shipped recipe it was copied from, and what each printing part gave once the report was assembled (null until it
   * has been: no view with a class pass yet, or the report's parts still loading). Absent: not known here.
   */
  reportContents?: {
    recipe: RecipeContentsSource
    base: readonly string[] | null
    facts: ReadonlyArray<PartFacts> | null
  }
  /** The logo printed sheets and reports carry, in words ("Your logo, x.png" / "Brand: y" / "None"). */
  logo: string
  /**
   * Who draws the figures of the analysis sheet, the VIA document and the VIA report: PGMaps (the saved views as
   * saved) or another engine at final quality, rendered in the background (`BackgroundRenders.tsx`).
   */
  renderer: {
    id: 'pgmaps' | 'worldgen' | 'nanite'
    label: string
    /** Saved views not yet drawn by the engine, and all the views the output uses. */
    missing: number
    views: number
    /** Renders queued or running for this engine. */
    running: boolean
    /** The time left, worded (`formatRemaining`), and whether it comes from this browser's own renders. */
    left: string | null
    measured: boolean
    /** A render that failed, worded, or null. */
    failed: string | null
    /** Why this engine cannot draw here, or null. */
    unavailable: string | null
    /**
     * `unavailable` is only the road view's terrain reloading (after a run or an import): an export waits for it
     * rather than failing. Absent: false.
     */
    settling?: boolean
    /**
     * The VIA report's before pictures the engine still owes, beyond `missing`: each view drawn again before harvest
     * by the same engine, so a before/after pair never compares two renderers. Only the report waits for them, and a
     * failed one is not counted (the pair then falls back to PGMaps for both pictures). Absent: 0.
     */
    missingBefore?: number
    /** `left` with those before pictures added: the report's wait. */
    leftWithBefore?: string | null
    /**
     * Views saved at another place than where the reviewer stands: an engine draws from the road view's terrain and
     * the run there, so these keep PGMaps' figures (and before pictures), and the files say so. Absent: 0.
     */
    elsewhere?: number
  }
  /**
   * The block map sheet's choices and what its map draws (`visualsBlockSheet.ts`, `visualsSheetSummary`). Absent:
   * the scene has no block to print.
   */
  blockSheet?: ExportBlockSheet
  /** Analysis sheet: the view and the look chosen. */
  figure: { viewId: string | null; style: string; labelStyle: string; cameraInfo: boolean; paintBlocks: boolean }
  /** The field brief's block, by name and id (views of interest planned for another block are left out), and its counts. */
  brief: { block: string | null; blockId?: string | null; viewpoints: number; screenshots: number }
  evidence: { loaded: boolean; gaps: string[]; views: number; runs: number; fields: number }
  /** The own photos open in the set, which the project file keeps with their originals. Absent: none open. */
  ownPhotos?: { count: number; accepted: number; flights: number }
  /** The project's attachments, which the project file carries as they are. Absent: none. */
  attachments?: Array<{ name: string; bytes: number; linked: string | null }>
  /** The road view is open with its terrain loaded, so the 3D scene can be written. */
  roadViewReady: boolean
  /** *Scene for GIS*: the layers the scene gives with their counts (`sceneGisPlan`), and the kinds it holds none of. */
  gis: { layers: SceneGisPlanEntry[]; absent: string[] }
  /** The Castor constraint as the current run gives it (`castorConstraint.ts`), or why it cannot be written yet. */
  castor: {
    constraint: { id: string; zoneId: string; threshold: number; percentage: number; percentageNote: string } | null
    problem: string | null
  }
  autoRun: ExportAutoRun
  /**
   * The scene's visual landscape inventory, read live from DataBC (the EVQO drape's read), which the outputs in
   * `READS_INVENTORY` print. Absent: the page offers no read, and those outputs print what the views were saved with.
   */
  visualInventory?: { status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }
  /** Each prescribed block's trees in a line (`standFileSummary`); empty when no block has a prescription. */
  prescribedStands: Row[]
  /** The run retained this session in Reference measurements; null until one is. */
  sightlineArchive: { name: string; rowId: string; bytes: number } | null
  /** The land status checks (`landStatusChecks.ts`) as the block note would print them now. */
  landChecks: {
    include: boolean
    pending: number
    rows: Array<Row & { note: string; review: boolean; reading: boolean }>
  }
  /**
   * The road view video (`roadVideo.ts`): the scene as it reads it, the plan a take records, the take kept for that
   * plan (null when none matches it) and whether a take is under way. Absent: the page offers no video.
   */
  roadVideo?: {
    scene: RoadVideoScene
    plan: RoadVideoPlan
    take: RoadVideoTakeFacts | null
    recording: boolean
  }
  /**
   * The route card (`src/lib/forestry/routeCard/`) for its block, as the sidebar's *Route card* shows it. Absent: the
   * page offers none.
   */
  routeCard?: {
    blockName: string | null
    presetName: string
    /** Why the file cannot be written yet, or null. */
    problem: string | null
    reading: boolean
    counts: {
      rows: number
      flagged: number
      within: number
      notRead: number
      notPublic: number
      entered: number
      estimated: number
    } | null
    considerations: Array<{ title: string; own: boolean; toComplete: number }>
    notCalledFor: string[]
    access: string | null
  }
  /** BC inventory viewpoints near the block note's block. */
  inventory: {
    status: 'idle' | 'loading' | 'ready' | 'error'
    error: string | null
    blockName: string | null
    candidates: ExportInventoryViewpoint[]
  }
}

/** The outputs written from the run: the export runs the assessment first when it is missing or stale. */
export const RUNS_ON_EXPORT: ReadonlySet<VisualsExport> = new Set([
  'block-note',
  'fs1252',
  'field-brief',
  'worksheet',
  'castor-constraint',
])

/** The outputs drawn from the saved views' figures: another engine can draw those again at final quality. */
export const DRAWS_FIGURES: ReadonlySet<VisualsExport> = new Set(['analysis-sheet', 'via-document', 'via-report'])

/**
 * The outputs that draw the package's views: they leave out what *Package* leaves out, and capture the views of
 * interest the package includes before the file is written.
 */
export const USES_PACKAGE_VIEWS: ReadonlySet<VisualsExport> = new Set([
  'block-note',
  'analysis-sheet',
  'via-document',
  'via-report',
  'field-brief',
])

/**
 * The outputs written for one block: a view of interest planned for another block is left out of them (and never
 * captured for them), listed in What goes in as for another block. A saved view not captured for a planned view is
 * not a block's own and keeps going in.
 */
export const FOR_ONE_BLOCK: ReadonlySet<VisualsExport> = new Set(['block-note', 'field-brief'])

/**
 * The outputs that pair a view with its before-harvest render: the VIA report's before pictures and the analysis
 * sheet's with-timber figure. A capture for them also takes each view's before render where it stands.
 */
export const NEEDS_BEFORE: ReadonlySet<VisualsExport> = new Set(['via-report', 'analysis-sheet'])

/** A view of interest with a current capture the files can take: drawn (`captured`), or saved without its sheet. */
const hasCurrentCapture = (view: ExportPlannedView) => view.state === 'captured' || view.state === 'no-figure'

type PlannedContext = Pick<ExportContext, 'planned'> &
  Partial<Pick<ExportContext, 'blockNote' | 'brief' | 'figure' | 'unprinted'>>

/** The block `kind` is written for, by id, when it is written for one (`FOR_ONE_BLOCK`); else null. */
function outputBlockId(kind: VisualsExport, ctx: PlannedContext): string | null {
  if (kind === 'block-note') return ctx.blockNote?.blockId ?? null
  if (kind === 'field-brief') return ctx.brief?.blockId ?? null
  return null
}

/** The view of interest is planned for another block than the one `kind` is written for. */
export function forAnotherBlock(kind: VisualsExport, ctx: PlannedContext, view: ExportPlannedView): boolean {
  const blockId = FOR_ONE_BLOCK.has(kind) ? outputBlockId(kind, ctx) : null
  return !!blockId && view.blockId !== blockId
}

/** The views of interest `kind` takes: those included, less those planned for another block than its own. */
export function plannedForOutput(kind: VisualsExport, ctx: PlannedContext): ExportPlannedView[] {
  if (!USES_PACKAGE_VIEWS.has(kind)) return []
  return ctx.planned.filter((view) => view.include && !forAnotherBlock(kind, ctx, view))
}

/**
 * The views of interest `kind` captures before its file: those it takes and not captured with their current key.
 * One whose capture failed under that key is tried again only on `retry` (a download), so a preview never loops on it.
 */
export function viewsToCapture(kind: VisualsExport, ctx: PlannedContext, options: { retry?: boolean } = {}): string[] {
  return plannedForOutput(kind, ctx)
    .filter((view) => view.state !== 'captured' && (options.retry || !view.failed))
    .map((view) => view.id)
}

/**
 * The captured views of interest `kind` captures again for their before-harvest render (`beforeOwed`): every one the
 * VIA report prints, the analysis sheet's own view only. One whose before render failed under its current key is
 * tried again only on `retry`.
 */
export function beforeToCapture(kind: VisualsExport, ctx: PlannedContext, options: { retry?: boolean } = {}): string[] {
  if (!NEEDS_BEFORE.has(kind)) return []
  const unprinted = new Set((ctx.unprinted ?? []).map((view) => view.id))
  return plannedForOutput(kind, ctx)
    .filter(
      (view) =>
        view.state === 'captured' &&
        view.beforeOwed &&
        !!view.savedViewId &&
        !unprinted.has(view.savedViewId) &&
        (kind !== 'analysis-sheet' || view.savedViewId === ctx.figure?.viewId) &&
        (options.retry || !view.beforeFailed),
    )
    .map((view) => view.id)
}

/** The package's views that `kind` cannot draw, and why (`ExportContext.unprinted`); none for an output not drawn. */
export function unprintedFor(kind: VisualsExport, ctx: PlannedContext): UnprintedView[] {
  if (!DRAWS_FIGURES.has(kind)) return []
  const unprinted = ctx.unprinted ?? []
  // The analysis sheet draws one view: it names only that one.
  return kind === 'analysis-sheet' ? unprinted.filter((view) => view.id === ctx.figure?.viewId) : unprinted
}

/**
 * The included views `kind` will be written without, worded for the pane and the file's notice, or null when none:
 * views of interest not captured, and views the output cannot draw (`unprintedFor`).
 */
export function uncapturedNote(kind: VisualsExport, ctx: PlannedContext): string | null {
  // A capture saved without its sheet is named once, as not drawn (`unprintedFor`), where the output draws figures.
  const missing = plannedForOutput(kind, ctx).filter((view) => !hasCurrentCapture(view))
  const undrawn = unprintedFor(kind, ctx)
  const parts: string[] = []
  if (missing.length) {
    const list = missing
      .map((view) => `${view.name} (${view.failed?.replace(/[.\s]*$/, '') || 'not captured'})`)
      .join('; ')
    parts.push(
      `${missing.length === 1 ? 'A view of interest is' : `${missing.length} views of interest are`} not in the file because ${missing.length === 1 ? 'it was' : 'they were'} not captured: ${list}.`,
    )
  }
  if (undrawn.length)
    parts.push(
      `${undrawn.length === 1 ? 'A view is' : `${undrawn.length} views are`} not drawn in the file: ${undrawn
        .map((view) => `${view.name} (${view.reason.replace(/[.\s]*$/, '')})`)
        .join('; ')}.`,
    )
  return parts.length ? parts.join(' ') : null
}

/** How many renders `kind` still waits for from the chosen engine: the figures, and for the VIA report its before pictures. */
export function rendererMissing(kind: VisualsExport, r: ExportContext['renderer']): number {
  if (!DRAWS_FIGURES.has(kind) || r.id === 'pgmaps') return 0
  return r.missing + (kind === 'via-report' ? (r.missingBefore ?? 0) : 0)
}

/**
 * The outputs that print the visual inventory's units (VSU, VSC, VAC, EVC, VQO): the export reads the scene's
 * inventory first when it has not been read, so a view saved before any read still prints its unit.
 */
export const READS_INVENTORY: ReadonlySet<VisualsExport> = new Set(['analysis-sheet', 'via-document', 'via-report'])

/**
 * What writing an output does before the file: run the assessment (in the analysis worker) when
 * the output reads the run and it is missing or stale, read the visual inventory when the output
 * prints it and it has not been read (`retry`: also after a failed read, as a download does), and
 * wait for the land checks the block note prints. `note` says so in the dialog, or is null when
 * nothing waits.
 */
export function exportPreparation(
  kind: VisualsExport,
  ctx: Pick<ExportContext, 'run' | 'autoRun' | 'landChecks' | 'renderer' | 'visualInventory'> &
    Partial<Pick<ExportContext, 'planned' | 'capture' | 'blockNote' | 'brief' | 'figure' | 'unprinted'>>,
  options: { retry?: boolean } = {},
): {
  run: boolean
  landChecks: boolean
  render: boolean
  inventory: boolean
  /**
   * The views of interest captured first: those not captured (`viewsToCapture`), and those captured again for their
   * before-harvest render (`beforeToCapture`).
   */
  capture: string[]
  /** The capture also takes each view's before-harvest render (`NEEDS_BEFORE`). */
  captureBefore: boolean
  note: string | null
  /** `note` only names the views the file goes without, which a preview prints above itself too. */
  noteIsSkipped: boolean
} {
  const planned: PlannedContext = {
    planned: ctx.planned ?? [],
    ...(ctx.blockNote !== undefined ? { blockNote: ctx.blockNote } : {}),
    ...(ctx.brief ? { brief: ctx.brief } : {}),
    ...(ctx.figure ? { figure: ctx.figure } : {}),
    ...(ctx.unprinted ? { unprinted: ctx.unprinted } : {}),
  }
  const fresh = viewsToCapture(kind, planned, options)
  const again = beforeToCapture(kind, planned, options).filter((id) => !fresh.includes(id))
  const capture = [...fresh, ...again]
  const capturing = USES_PACKAGE_VIEWS.has(kind) && ctx.capture?.status === 'running'
  const captureNote = capturing
    ? `${ctx.capture?.message ?? 'Capturing the views of interest.'} The file is written when the views are saved.`
    : capture.length
      ? [
          fresh.length
            ? `${fresh.length === 1 ? 'A view of interest is' : `${fresh.length} views of interest are`} captured first: the page stands at each, runs there and saves the view as Save viewpoint does${NEEDS_BEFORE.has(kind) ? ', with its before-harvest render' : ''}.`
            : '',
          again.length
            ? `${again.length === 1 ? 'A captured view of interest is' : `${again.length} captured views of interest are`} captured again for ${again.length === 1 ? 'its' : 'their'} before-harvest render, which is taken where the view stands.`
            : '',
          'Then the file is written from the views as captured.',
        ]
          .filter(Boolean)
          .join(' ')
      : null
  const skipped = uncapturedNote(kind, planned)
  const run = RUNS_ON_EXPORT.has(kind) && ctx.run !== 'current' && !ctx.autoRun.blocker
  const landChecks = kind === 'block-note' && ctx.landChecks.include && ctx.landChecks.pending > 0
  const vi = READS_INVENTORY.has(kind) ? ctx.visualInventory : undefined
  const inventory =
    !!vi && (vi.status === 'idle' || vi.status === 'loading' || (vi.status === 'error' && !!options.retry))
  const inventoryNote = !vi
    ? null
    : vi.status === 'idle' || vi.status === 'loading'
      ? 'Reading the visual landscape inventory from DataBC first, for the units the file prints.'
      : vi.status === 'error'
        ? `The visual landscape inventory could not be read (${vi.error ?? 'no reason given'}): the file says it was not read. Downloading reads it again first.`
        : null
  const r = ctx.renderer
  const render = rendererMissing(kind, r) > 0 && !r.unavailable
  // The VIA report also waits for the views' before pictures by the same engine.
  const before = kind === 'via-report' ? (r.missingBefore ?? 0) : 0
  const left = before ? (r.leftWithBefore ?? r.left) : r.left
  const owed = [
    ...(r.missing ? [`${r.missing} saved view${r.missing === 1 ? '' : 's'}`] : []),
    ...(before ? [`${before} before picture${before === 1 ? '' : 's'}`] : []),
  ].join(' and ')
  const renderNote = !render
    ? null
    : r.running
      ? `${r.label} is drawing the saved views at final quality in the background: ${r.views - r.missing} of ${r.views} done${before ? `, ${before} before picture${before === 1 ? '' : 's'} to draw` : ''}${left ? `, ${left} left` : ''}. The file is written when they finish; the page stays usable.`
      : `${r.label} draws ${owed} at final quality first, in the background${left ? `: ${left}` : ''}${left ? (r.measured ? ' (from your renders)' : ' (first estimate)') : ''}. Then the file is written.`
  const note = captureNote
    ? captureNote
    : renderNote
      ? renderNote
      : ctx.autoRun.status === 'running' && waitsForRun(kind)
        ? `Running the visibility assessment${ctx.autoRun.progress ? ` · ${ctx.autoRun.progress}` : ''}. The file is written when it finishes.`
        : run
          ? ctx.run === 'stale'
            ? 'The run is out of date: the export runs the assessment again first, in the background, then writes the file.'
            : 'Not run yet: the export runs the assessment first, in the background, then writes the file.'
          : landChecks
            ? 'Land status checks are still reading: the file waits for them.'
            : (inventoryNote ?? (skipped ? `${skipped} Download tries again.` : null))
  const noteIsSkipped = !!skipped && note === `${skipped} Download tries again.`
  return { run, landChecks, render, inventory, capture, captureBefore: NEEDS_BEFORE.has(kind), note, noteIsSkipped }
}

/**
 * Whether `kind` waits for a run in progress before its file: the outputs written from the run, and those drawn from
 * the views, whose figures and facts read the run at their station (a capture's way back runs again where the
 * reviewer stood).
 */
export const waitsForRun = (kind: VisualsExport) => RUNS_ON_EXPORT.has(kind) || USES_PACKAGE_VIEWS.has(kind)

/** Included views of interest that a download captures before the file. */
const capturesFirst = (ctx: ExportContext, kind: VisualsExport = 'via-report') =>
  plannedForOutput(kind, ctx).some((view) => view.state !== 'captured')

/** Why an output that draws views has none: every view left out, or none planned or saved. */
function noPackageViews(ctx: ExportContext, why: string): string {
  const any = ctx.planned.length > 0 || ctx.views.some((view) => !view.planned && view.hasScreenshot)
  return any
    ? 'Every view is left out of the package: include one under Package.'
    : `Add a view of interest in step 2, or save one in the road view: ${why}`
}

/** Why an output cannot be written yet, or null when it can. */
export function exportUnavailable(kind: VisualsExport, ctx: ExportContext): string | null {
  if (DRAWS_FIGURES.has(kind) && ctx.renderer.id !== 'pgmaps' && ctx.renderer.unavailable)
    return `${ctx.renderer.label} cannot draw the figures: ${ctx.renderer.unavailable}`
  switch (kind) {
    case 'block-note':
      return ctx.blockNote ? null : 'Add a cutblock in step 1 to write its note.'
    case 'fs1252':
      if (ctx.run !== 'current' && !ctx.autoRun.blocker) return null
      if (ctx.run === 'none') return 'Run the visibility assessment first: the form is filled from the run.'
      if (ctx.run === 'stale') return 'The run is out of date. Run it again to fill the form from the current scene.'
      if (!ctx.fs1252Stations.some((station) => station.on)) return 'Choose at least one station for the form.'
      return ctx.fs1252Stations.filter((station) => station.on).length > 30 ? 'Choose 30 stations or fewer.' : null
    case 'analysis-sheet':
      return ctx.views.some((view) => view.inReport && view.hasScreenshot) || capturesFirst(ctx)
        ? null
        : noPackageViews(ctx, 'its screenshot and class pass are what the sheet is drawn from.')
    case 'via-report':
      return ctx.report || capturesFirst(ctx)
        ? null
        : noPackageViews(ctx, 'the report’s figures and calculations come from each view.')
    case 'via-document':
      return ctx.document || capturesFirst(ctx)
        ? null
        : noPackageViews(ctx, 'the document’s figures come from each view’s class pass.')
    case 'field-brief':
      return ctx.brief.block ? null : 'Add a cutblock in step 1 to brief the crew on it.'
    case 'block-sheet':
      return ctx.blockSheet
        ? (ctx.blockSheet.unavailable ?? ctx.blockSheet.problem)
        : 'Add a cutblock in step 1 to print its map sheet.'
    case 'worksheet':
      return ctx.run === 'current' || !ctx.autoRun.blocker
        ? null
        : ctx.run === 'stale'
          ? 'The run is out of date. Run it again to write the worksheet.'
          : `Run the visibility assessment first. ${ctx.autoRun.blocker}`
    case 'evidence':
    case 'workspace':
      return ctx.evidence.loaded ? null : 'The stored workspace is still loading.'
    case 'views':
      return null
    case 'project':
      return ctx.evidence.loaded ? null : 'The stored workspace is still loading.'
    case 'scene':
      return null
    case 'scene-package':
      return ctx.roadViewReady ? null : 'Open the road view and let its terrain load first.'
    case 'scene-gis':
      return sceneGisUnavailable(ctx.gis)
    case 'route-card':
      return ctx.routeCard ? ctx.routeCard.problem : 'The route card is not offered here.'
    case 'castor-constraint':
      if (!ctx.landform) return 'Delineate or adopt one active landform first: it is the constraint’s zone.'
      if (ctx.run !== 'current')
        return ctx.autoRun.blocker
          ? ctx.run === 'stale'
            ? 'The run is out of date. Run it again to write the constraint.'
            : `Run the visibility assessment first. ${ctx.autoRun.blocker}`
          : null
      return ctx.castor.problem
    case 'stand-trees':
      return ctx.prescribedStands.length
        ? null
        : 'Give a retention or partial-cut block a stand prescription first (step 2, Prescribe trees…).'
    case 'sightline-archive':
      return ctx.sightlineArchive
        ? null
        : 'Retain a run first: Reference measurements → Numerical run and offline replay → Run and retain.'
    case 'road-video':
      if (!ctx.roadVideo) return 'The road view video is not offered here.'
      // A take under way keeps its pane and its Stop, whatever the road view reports meanwhile.
      return ctx.roadVideo.recording
        ? null
        : roadVideoUnavailable(ctx.roadVideo.scene, ctx.roadVideo.plan, ctx.roadVideo.take)
  }
}

/**
 * A job the dialog can start for a part: `stand:<key>` stands at an inventory viewpoint in the road
 * view, `load-inventory` reads the inventory near the block, `open-road-view` opens the road view.
 */
export type ExportAction = { id: string; label: string }

/** The dialog opens its *Package* entry for this action: the recipe, the renderer and the views, chosen once. */
export const OPEN_PACKAGE_ACTION = 'open-package'
const packageAction: ExportAction = { id: OPEN_PACKAGE_ACTION, label: 'Change in Package' }
/** The final rating is made at the top of the package's entry, not in a step of the sidebar. */
const rateAction: ExportAction = { id: OPEN_PACKAGE_ACTION, label: 'Rate in Package' }

/**
 * The piece of the page a part is edited with, shown under the part in the dialog rather than behind it: a section
 * of the sidebar (a `Projectable` in `Sidebar.tsx`, moved into the dialog while it is edited there) or, for `views`,
 * the views of interest already planned. The same controls with the same state as in the step, never a second form.
 * Name one only for a part those controls really set: a saved view that is not a view of interest has none.
 */
export type ExportEditor = 'cutblocks' | 'landform' | 'viewpoint' | 'run' | 'assess' | 'views' | 'route-card'

/** The id a sidebar section and the dialog's slot for it share. */
export const exportEditorId = (editor: ExportEditor) => `visuals-export-editor:${editor}`

/** A part of an output, with the step where it is set. */
export type ExportSection = {
  title: string
  step?: ViaStepId
  /** What edits the part in the dialog; `step` is then where the same controls live, for work that needs the map. */
  editor?: ExportEditor
  rows?: Row[]
  /** One entry per thing listed, such as a saved view with its settings. */
  items?: Array<{ title: string; subtitle?: string; rows?: Row[]; action?: ExportAction }>
  /** A button beside the title that does the part's job from the dialog. */
  action?: ExportAction
  /** Said when there is nothing to list. */
  empty?: string
  note?: string
  /**
   * The file's own parts as one list in print order (`DocumentContents`): what each is set to, kept at its place when
   * it is off. A section with one is drawn first in *What goes in*, above the output's options; the page gives the
   * controls that change it (the dialog's `contents`), and without them the list is read-only.
   */
  contents?: SectionContents
}

/** A section's parts list (`ExportSection.contents`). */
export type SectionContents = {
  /** What is printed, for the list's accessible name: "the report". */
  subject: string
  parts: ContentsPart[]
  /** Each printing part's place in the draft (`part-<place>`), by key; only the VIA report has a draft. */
  places?: Readonly<Record<string, number>>
  /** Behind the list's (i). */
  help?: string
  /** Replaces the list's count line. */
  summary?: string
}

/** What *What goes in* knows beyond the context and must not restart a preview: the draft's pages, once written. */
export type ContentsKnown = {
  /** The page each printing part of the VIA report starts on in its draft, by its place among the printing parts. */
  reportPages?: readonly number[] | null
}

const hectares = (ha: number) =>
  `${ha.toLocaleString('en-CA', { maximumFractionDigits: ha < 10 ? 1 : 0, minimumFractionDigits: ha < 10 ? 1 : 0 })} ha`
const percent = (value: number | null) => (value === null ? 'withheld' : `${value.toFixed(2)}%`)
/** Who draws the figures, and whether they are ready. */
const rendererRow = (ctx: ExportContext, kind: VisualsExport = 'analysis-sheet') => {
  const r = ctx.renderer
  if (r.id === 'pgmaps') return 'PGMaps, as each view was saved'
  const before = kind === 'via-report' ? (r.missingBefore ?? 0) : 0
  // The report's before pictures come from the same engine as its simulations.
  const pairs = kind === 'via-report' ? ', before pictures by the same engine' : ''
  const elsewhere = r.elsewhere
    ? `; ${plural(r.elsewhere, 'view')} saved at another place ${r.elsewhere === 1 ? 'keeps its' : 'keep their'} PGMaps figure${kind === 'via-report' ? ' and before picture' : ''}, since ${r.label} draws only where the road view stands`
    : ''
  return r.missing || before
    ? `${r.label} at final quality${pairs}: ${r.missing} of ${r.views} still to render${before ? `, and ${before} before picture${before === 1 ? '' : 's'}` : ''}${elsewhere}`
    : `${r.label} at final quality${pairs}, rendered${elsewhere}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function runSection(ctx: ExportContext): ExportSection {
  const status =
    ctx.run === 'current'
      ? ctx.numericalReady
        ? 'Current'
        : 'Current · provisional: numerical fields withheld'
      : ctx.run === 'stale'
        ? 'Out of date: the scene changed since it ran'
        : 'Not run'
  return {
    title: 'Run',
    step: 'design',
    editor: 'run',
    rows: [
      { label: 'Status', value: status },
      ...(ctx.run === 'none'
        ? []
        : ctx.runGaps.length === 0
          ? [
              { label: 'Perspective alteration', value: percent(ctx.perspectivePercent) },
              { label: 'Planimetric alteration', value: percent(ctx.planimetricPercent) },
            ]
          : [
              // One readiness rule (`runFigures`): a withheld figure names why, never prints as the assessment's.
              { label: 'Alteration', value: withheldText({ gaps: ctx.runGaps }) },
              ...(ctx.diagnosticPercents &&
              (ctx.diagnosticPercents.perspective !== null || ctx.diagnosticPercents.planimetric !== null)
                ? [
                    {
                      label: DIAGNOSTIC_LABEL,
                      value: `perspective ${percent(ctx.diagnosticPercents.perspective)} · planimetric ${percent(ctx.diagnosticPercents.planimetric)}`,
                    },
                  ]
                : []),
            ]),
      ...(ctx.run !== 'none' && ctx.existingBasis ? [{ label: 'Existing disturbance', value: ctx.existingBasis }] : []),
    ],
    note: ctx.runWarnings.length ? ctx.runWarnings.join(' ') : undefined,
  }
}

function landformSection(ctx: ExportContext): ExportSection {
  const lf = ctx.landform
  return {
    title: 'Landform',
    step: 'identify',
    editor: 'landform',
    rows: lf
      ? [
          { label: 'Name', value: lf.name },
          { label: 'Objective', value: lf.objective },
          ...(lf.vac ? [{ label: 'VAC', value: lf.vac }] : []),
          { label: 'Area', value: hectares(lf.areaHa) },
          { label: 'Source', value: lf.source },
          ...(lf.inventoryUnit ? [{ label: 'Inventory unit', value: lf.inventoryUnit }] : []),
          // The run measures a view's own landform while the page stands there; the site's is the default again after.
          ...(ctx.landformUse.site
            ? [{ label: 'Site landform', value: `${ctx.landformUse.site}; this run is at a view with its own` }]
            : []),
          ...(ctx.landformUse.viewsWithOwn
            ? [
                {
                  label: 'Views with their own',
                  value: `${ctx.landformUse.viewsWithOwn} of ${plural(ctx.landformUse.views, 'view')} of interest, each assessed against its own landform`,
                },
              ]
            : []),
          ...(ctx.landformUse.unused
            ? [
                {
                  label: 'Other landforms',
                  value: `${ctx.landformUse.unused} in the scene that nothing uses, not assessed`,
                },
              ]
            : []),
        ]
      : undefined,
    empty: 'None chosen. Adopt or draw a landform in step 1.',
  }
}

function viewpointSection(ctx: ExportContext): ExportSection {
  return {
    title: 'Viewpoint',
    step: 'identify',
    editor: 'viewpoint',
    rows: [
      { label: 'Name', value: ctx.viewpoint.name || 'Unnamed' },
      {
        label: 'Kind',
        value:
          ctx.viewpoint.kind === 'road'
            ? `Road, ${ctx.viewpoint.lengthKm.toFixed(2)} km`
            : 'A spot (a pullout or viewpoint stood at)',
      },
    ],
  }
}

function viewsSection(ctx: ExportContext, title: string, options: { screenshotsOnly?: boolean } = {}): ExportSection {
  const views = options.screenshotsOnly ? ctx.views.filter((view) => view.hasScreenshot) : ctx.views
  return {
    title,
    step: 'visit',
    items: views.map((view) => ({
      title: view.name,
      subtitle: [
        view.here ? `${(view.positionMeters / 1000).toFixed(2)} km along ${view.place}` : `At ${view.place}`,
        view.harvestPhase === 'after' ? 'after harvest' : 'before harvest',
        view.design ? `design ${view.design}` : null,
        view.hasScreenshot ? (view.hasClassPass ? 'screenshot and class pass' : 'screenshot only') : 'no screenshot',
      ]
        .filter(Boolean)
        .join(' · '),
      rows: view.settings,
    })),
    empty: 'No saved views. Save one from the road view’s bar.',
  }
}

/** How a view of interest stands for a file that is about to be written. */
function plannedStatus(view: ExportPlannedView, kind: VisualsExport, ctx: ExportContext): string {
  if (!view.include) return 'Left out'
  if (forAnotherBlock(kind, ctx, view)) return 'For another block: left out of this file'
  const undrawn = view.savedViewId ? unprintedFor(kind, ctx).find((entry) => entry.id === view.savedViewId) : null
  if (hasCurrentCapture(view) && undrawn)
    return `Captured, but not drawn in the file: ${undrawn.reason.replace(/[.\s]*$/, '')}${
      view.failed ? '' : '. Captured again before the file is written'
    }`
  // The block note draws no figure, so its gap is a capture with no screenshot in this session (`blockNoteWithoutScreenshot`).
  if (
    kind === 'block-note' &&
    hasCurrentCapture(view) &&
    ctx.views.some((saved) => saved.id === view.savedViewId && !saved.hasScreenshot)
  )
    return 'Captured, but with no screenshot in this session: not in the note. Capture it again'
  if (view.state === 'no-figure')
    return view.failed
      ? `Captured without its analysis sheet (${view.failed.replace(/[.\s]*$/, '')}): in the file as its screenshot. Download tries again`
      : 'Captured without its analysis sheet: captured again before the file is written'
  if (view.state === 'captured')
    return view.beforeOwed && NEEDS_BEFORE.has(kind)
      ? view.beforeFailed
        ? `Captured: in the file, without its before-harvest render (${view.beforeFailed.replace(/[.\s]*$/, '')})`
        : 'Captured: in the file; captured again first for its before-harvest render'
      : 'Captured: in the file'
  if (view.failed)
    return `Not captured: ${view.failed.replace(/[.\s]*$/, '')}. The file is written without it; Download tries again.`
  return view.state === 'outdated'
    ? 'Changed since it was captured: captured again before the file is written'
    : 'To capture: captured before the file is written'
}

/** The views of interest planned on the plan map, as `kind` takes them; null when none are planned. */
function plannedViewsSection(ctx: ExportContext, kind: VisualsExport): ExportSection | null {
  if (!ctx.planned.length) return null
  const taken = plannedForOutput(kind, ctx)
  // What a preview captures (a failed view waits for a download), and what the file then goes without.
  const toCapture = viewsToCapture(kind, ctx).length
  const undrawn = new Set(unprintedFor(kind, ctx).map((view) => view.id))
  const without = taken.filter(
    (view) => (view.state !== 'captured' && view.failed) || (!!view.savedViewId && undrawn.has(view.savedViewId)),
  ).length
  const elsewhere = ctx.planned.filter((view) => view.include && forAnotherBlock(kind, ctx, view)).length
  return {
    title: 'Views of interest',
    step: 'visit',
    editor: 'views',
    action: packageAction,
    items: ctx.planned.map((view) => ({
      title: view.name,
      subtitle: [
        view.block,
        view.lens,
        // A view is assessed against the site landform unless it has its own: only the exception is named.
        ...(view.landform ? [`its own landform, ${view.landform}`] : []),
        plannedStatus(view, kind, ctx),
      ].join(' · '),
    })),
    note: `${plural(taken.length - without, 'view')} of interest in the file${
      toCapture
        ? `, ${toCapture} to capture first: Preview and Download stand at each, run there and save it as Save viewpoint does`
        : ''
    }.${without ? ` ${plural(without, 'view')} of interest ${without === 1 ? 'is' : 'are'} not in it, as listed; Download tries again.` : ''}${elsewhere ? ` ${plural(elsewhere, 'view')} planned for another block ${elsewhere === 1 ? 'is' : 'are'} left out: ${elsewhere === 1 ? 'it goes' : 'they go'} in that block’s file.` : ''} Choose which under Package.`,
  }
}

/** The package's views an output cannot draw, each with why; null when it draws them all. */
function unprintedSection(ctx: ExportContext, kind: VisualsExport): ExportSection | null {
  const undrawn = unprintedFor(kind, ctx)
  if (!undrawn.length) return null
  return {
    title: 'Views not drawn',
    step: 'visit',
    items: undrawn.map((view) => ({ title: view.name, subtitle: `Not in the file: ${view.reason}` })),
    note: 'The file names each of them and why. Capture the view again, or leave it out under Package.',
  }
}

/**
 * Where views of interest come from when the package has none, for an output that is written from them. A view is
 * placed on the plan map, so this part opens its step rather than an editor in the dialog.
 */
function noViewsSection(): ExportSection {
  return {
    title: 'Views of interest',
    step: 'visit',
    empty:
      'None planned. A view of interest is placed on the plan map: in step 2, use the map’s Add a view of interest tool. It is then edited here.',
  }
}

const withPlanned = (sections: Array<ExportSection | null>): ExportSection[] =>
  sections.filter((section): section is ExportSection => !!section)

/**
 * The saved views the block note takes that have no screenshot, by name, in the dialog's order: the note has no
 * picture of them and prints nothing in their place, so Save & export names them (`missingScreenshotsNotice` beside
 * the preview and the download, and here). A capture of a view of interest planned for another block is that block's.
 */
export function blockNoteWithoutScreenshot(ctx: Pick<ExportContext, 'views' | 'planned' | 'blockNote'>): string[] {
  return ctx.views
    .filter((view) => view.inReport && !view.hasScreenshot)
    .filter((view) => {
      const planned = ctx.planned.find((entry) => entry.savedViewId === view.id)
      return !planned || !forAnotherBlock('block-note', ctx, planned)
    })
    .map((view) => view.name)
}

/** The block note's views: which go in, which are left out, and which have no screenshot. */
function reportViewsSection(ctx: ExportContext, figures: boolean): ExportSection {
  const order = (view: ExportView) => (view.inReport && view.hasScreenshot ? 0 : view.hasScreenshot ? 2 : 1)
  // A capture of a view of interest is listed with that view (`plannedViewsSection`).
  const views = ctx.views.filter((view) => !view.planned).sort((a, b) => order(a) - order(b))
  const shown = views.filter((view) => view.inReport && view.hasScreenshot).length
  return {
    title: 'Viewpoints in the report',
    step: 'visit',
    items: views.map((view) => ({
      title: view.name,
      subtitle: [
        !view.hasScreenshot
          ? view.inReport
            ? 'No screenshot: not in the note. Reopen it and save it again'
            : 'Left out · no screenshot'
          : view.inReport
            ? figures && view.hasClassPass
              ? 'In the report as its analysis-sheet figure'
              : 'In the report as its screenshot'
            : 'Left out',
        view.here ? `${(view.positionMeters / 1000).toFixed(2)} km along ${view.place}` : `At ${view.place}`,
        view.harvestPhase === 'after' ? 'after harvest' : 'before harvest',
        view.design ? `design ${view.design}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      rows: view.settings,
    })),
    action: packageAction,
    empty: ctx.planned.length
      ? 'No other saved views.'
      : 'No saved views. Add a view of interest in step 2, stand at a viewpoint below, or open the road view and save one from its bar.',
    note: views.length
      ? `${plural(shown, 'saved view')} in the report. Choose which under Package. Screenshots are taken when a view is saved, never redrawn at export.`
      : undefined,
  }
}

const INVENTORY_SHOWN = 6

/** BC inventory viewpoints near the block: places a reviewer would stand, not yet captured. */
function inventorySection(ctx: ExportContext): ExportSection {
  const inv = ctx.inventory
  const load = { id: 'load-inventory', label: inv.status === 'error' ? 'Try again' : 'Find them' }
  return {
    title: 'Inventory viewpoints near the block',
    step: 'identify',
    action: inv.status === 'idle' || inv.status === 'error' ? load : undefined,
    items:
      inv.status === 'ready'
        ? inv.candidates.slice(0, INVENTORY_SHOWN).map((candidate) => ({
            title: candidate.name,
            subtitle: [
              candidate.kind === 'rec-site' ? 'Recreation site' : 'Inventory viewpoint',
              `${(candidate.distanceMeters / 1000).toFixed(1)} km from the block`,
              candidate.kind === 'rec-site' ? null : candidate.aims ? 'an arrow aims at it' : 'no arrow aims at it',
            ]
              .filter(Boolean)
              .join(' · '),
            action: { id: `stand:${candidate.key}`, label: 'Stand here' },
          }))
        : undefined,
    empty: !inv.blockName
      ? 'Add a cutblock first.'
      : inv.status === 'loading'
        ? 'Reading the BC Visual Landscape Inventory near the block…'
        : inv.status === 'error'
          ? (inv.error ?? 'The inventory could not be read.')
          : inv.status === 'ready'
            ? `None within reach of ${inv.blockName}.`
            : 'Not read yet.',
    note:
      inv.status === 'ready' && inv.candidates.length
        ? `Not in the report until captured: Stand here opens the road view there facing the block; save a view from its bar to add it.${inv.candidates.length > INVENTORY_SHOWN ? ` ${inv.candidates.length - INVENTORY_SHOWN} more in step 1.` : ''}`
        : undefined,
  }
}

/** The land status checks as the note prints them. */
function landChecksSection(ctx: ExportContext): ExportSection {
  const checks = ctx.landChecks
  return {
    title: 'Land status checks',
    rows: checks.include
      ? checks.rows.map((row) => ({
          label: row.label,
          value: row.reading ? 'Checking…' : row.value,
        }))
      : undefined,
    empty: 'Left out of the note. Switch them on in Contents, above.',
    note: checks.include
      ? 'Their own sheet and page: a screen from DataBC, never a legal determination or a mask. Not read means the layer could not be read.'
      : undefined,
  }
}

function blocksSection(ctx: ExportContext): ExportSection {
  return {
    title: 'Blocks',
    step: 'identify',
    editor: 'cutblocks',
    rows: [
      ...ctx.blocks.map((block) => ({ label: block.name, value: `${hectares(block.areaHa)} · ${block.system}` })),
      ...(ctx.openings ? [{ label: 'Existing openings', value: String(ctx.openings) }] : []),
      ...(ctx.masks.length
        ? [
            {
              label: 'Masks',
              value: Object.entries(
                ctx.masks.reduce<Record<string, number>>((counts, mask) => {
                  counts[mask.kind] = (counts[mask.kind] ?? 0) + 1
                  return counts
                }, {}),
              )
                .map(([kind, n]) => `${n} ${kind}`)
                .join(' · '),
            },
          ]
        : []),
    ],
    empty: 'No cutblocks yet.',
  }
}

function settingsSection(ctx: ExportContext): ExportSection {
  return { title: 'Run settings', step: 'design', rows: ctx.settings }
}

function reviewSection(ctx: ExportContext): ExportSection {
  return {
    title: 'Review',
    action: rateAction,
    rows: [
      { label: 'Rating', value: ctx.rating ?? 'Not rated yet' },
      ...(ctx.ocularClass ? [{ label: 'Ocular class', value: ctx.ocularClass }] : []),
      ...(ctx.rating || !ctx.ratingMissing.length
        ? []
        : [{ label: 'Still needed', value: ctx.ratingMissing.join('; ') }]),
    ],
  }
}

/**
 * The block note's sheets and pages as `blockNote.ts` writes them, in its fixed order: what the planner's layout always
 * writes is locked, the visual measures and the viewpoint records are written only when there is something to put in
 * them, and the land status checks are the one switch. Figure or screenshot is an option, not a part.
 */
function blockNoteContents(ctx: ExportContext): ExportSection {
  const note = ctx.blockNote
  const always = 'Always written: the planner’s layout'
  const records = ctx.views.filter((view) => view.inReport && view.hasScreenshot).length
  const noPicture = blockNoteWithoutScreenshot(ctx)
  return {
    title: 'Contents',
    contents: {
      subject: 'the block note',
      help: 'The note’s sheets in Excel, and its pages in the PDF, in the order they are written. Only the land status checks can be left out; the rest is the planner’s layout.',
      parts: [
        {
          key: 'other-considerations',
          label: 'Other Considerations: the Visuals paragraph and a picture per view',
          state: 'on',
          locked: always,
          ...(noPicture.length
            ? {
                note: `No screenshot, so no picture: ${noPicture.join(', ')}. Nothing stands in for ${noPicture.length === 1 ? 'it' : 'them'}; reopen each view and save it again.`,
              }
            : {}),
          help: 'Excel: the label in B2, the paragraph in C2 and the pictures below, as the planner’s report has them. PDF: the first page.',
        },
        {
          key: 'visual-measures',
          label: 'Visual measures',
          state: 'on',
          ...(note?.measures
            ? { locked: 'Written when there are measures', detail: plural(note.measures, 'measure') }
            : { unavailable: 'None to write yet: draft them in Visual measures' }),
        },
        { key: 'block', label: 'Block: its header, the landform and the figures', state: 'on', locked: always },
        {
          key: 'viewpoints',
          label: 'Viewpoints: what made each simulation',
          state: 'on',
          ...(records
            ? { locked: 'Written for each view in the package with its record' }
            : { unavailable: 'No view in the package has a screenshot' }),
        },
        { key: 'plan-map', label: 'Plan map', state: 'on', locked: always },
        {
          key: 'land-status',
          label: 'Land status checks',
          state: ctx.landChecks.include ? 'on' : 'off',
          help: 'Treaty land, reserves, private land, parks and the rest, read from DataBC: a screen on its own sheet and page, never a legal determination.',
        },
        {
          key: 'basis',
          label: 'Basis: what each drafted sentence was written from',
          state: 'on',
          locked: always,
          detail: 'Excel',
        },
      ],
    },
  }
}

/** The FS1252's stations as its contents: one form per station switched on, in station order. */
function fs1252Contents(ctx: ExportContext): ExportSection {
  return {
    title: 'Stations in the PDF',
    step: 'assess',
    editor: 'assess',
    empty: 'None chosen. Add a station under Options.',
    contents: {
      subject: 'the FS1252 form',
      help: 'One form per station switched on, then the reference pages and a scenario appendix. A station switched off keeps its place here; Options adds stations and holds each one’s reviewer inputs.',
      parts: ctx.fs1252Stations.map((station) => ({
        key: String(station.index),
        label: station.label,
        state: station.on ? 'on' : 'off',
        ...(station.assessment
          ? { detail: 'assessment station' }
          : station.inputs
            ? { detail: 'reviewer inputs set' }
            : {}),
      })),
    },
  }
}

/** The VIA report's parts in print order, from its recipe (`recipeContents.ts`); null when the recipe is not known. */
function reportContentsSection(ctx: ExportContext, known: ContentsKnown): ExportSection | null {
  const source = ctx.reportContents
  if (!source) return null
  const { parts, places } = recipeContents(source.recipe, {
    base: source.base,
    facts: source.facts,
    pages: known.reportPages ?? null,
  })
  return {
    title: 'Contents',
    contents: {
      subject: 'the report',
      parts,
      places,
      help: 'The package’s recipe, part by part in print order. The first change to a shipped recipe makes it your own copy, kept in this browser; Reset goes back to the recipe it was copied from. A part switched off keeps its place and comes back there.',
    },
  }
}

/**
 * What goes into an output, part by part: its own parts first where it has a list of them (`contents`), then what it
 * reads. `known` is what the dialog knows beyond the context (the draft's pages), which never restarts a preview.
 */
export function exportContents(kind: VisualsExport, ctx: ExportContext, known: ContentsKnown = {}): ExportSection[] {
  switch (kind) {
    case 'block-note': {
      const note = ctx.blockNote
      return [
        ...(note ? [blockNoteContents(ctx)] : []),
        {
          title: 'Block',
          step: 'identify',
          editor: 'cutblocks',
          rows: note?.header,
          empty: 'No cutblock yet.',
        },
        {
          // Written in this output's options, above: step 5 only opens Save & export.
          title: 'Visuals paragraph and measures',
          rows: [
            {
              label: 'Visuals paragraph',
              value: ctx.review.visualsNote === 'yours' ? 'Yours, as signed' : 'The draft, marked as a draft',
            },
            {
              label: 'Visual measures',
              value: `${plural(note?.measures ?? 0, 'measure')} · ${ctx.review.measures === 'yours' ? 'yours' : 'the draft'}`,
            },
          ],
        },
        { title: 'Landform', step: 'identify', editor: 'landform', rows: note?.landform, empty: 'None adopted.' },
        ...withPlanned([plannedViewsSection(ctx, 'block-note')]),
        reportViewsSection(ctx, !!note?.figures),
        inventorySection(ctx),
        landChecksSection(ctx),
        { title: 'Plan map', rows: [{ label: 'Plan map', value: 'The block and the viewpoint, taken from the map' }] },
      ]
    }
    case 'fs1252':
      return [
        fs1252Contents(ctx),
        runSection(ctx),
        landformSection(ctx),
        viewpointSection(ctx),
        reviewSection(ctx),
        {
          title: 'Office information',
          rows: [{ label: 'Filled', value: `${ctx.officeFields.filled} of ${ctx.officeFields.total} fields` }],
          note: 'Unknown fields stay blank. The signature and the final decision are never filled.',
        },
      ]
    case 'analysis-sheet': {
      const view = ctx.views.find((entry) => entry.id === ctx.figure.viewId) ?? null
      return withPlanned([
        {
          title: 'Figure',
          step: 'visit',
          action: packageAction,
          rows: [
            {
              label: 'Saved view',
              value: view?.name ?? (capturesFirst(ctx) ? 'The last view of interest, once captured' : 'None'),
            },
            { label: 'Drawn by', value: rendererRow(ctx) },
            { label: 'Figure style', value: ctx.figure.style },
            { label: 'Label style', value: ctx.figure.labelStyle },
            { label: 'Camera information', value: ctx.figure.cameraInfo ? 'On the image' : 'Off' },
            ...(ctx.figure.style.startsWith('Analysis sheet') ? [{ label: 'Logo', value: ctx.logo }] : []),
            { label: 'Block ground', value: ctx.figure.paintBlocks ? 'Painted as harvested ground' : 'As captured' },
            {
              label: 'Outlines and pixel figure',
              value: view?.hasClassPass
                ? 'From the view’s class pass'
                : `None: ${
                    unprintedFor('analysis-sheet', ctx)
                      .find((entry) => entry.id === view?.id)
                      ?.reason.replace(/[.\s]*$/, '') ?? 'saved without a class pass'
                  }`,
            },
          ],
        },
        ...(view
          ? [{ title: 'View settings', step: 'visit' as const, rows: view.settings, empty: 'Not recorded.' }]
          : []),
        plannedViewsSection(ctx, 'analysis-sheet'),
        landformSection(ctx),
        runSection(ctx),
      ])
    }
    case 'via-report': {
      const report = ctx.report
      // One Report part whether or not there is anything to draw yet: what the report follows, how many figures it
      // has and who draws them. The logo and the map style are this output's options, shown live above it.
      const recipe = report ? { name: report.recipe, sources: report.sources } : ctx.reportRecipe
      const structure = recipe
        ? [
            {
              label: 'Structure of',
              value: `${recipe.name} (reference document ${recipe.sources})${
                ctx.recipe ? ', the package’s recipe' : ', following the VIA document’s format'
              }`,
            },
          ]
        : ctx.recipe
          ? [{ label: 'Structure of', value: ctx.recipe }]
          : []
      const contents = reportContentsSection(ctx, known)
      if (!report)
        return withPlanned([
          contents,
          {
            title: 'Report',
            action: packageAction,
            rows: [
              ...structure,
              {
                label: 'Figures',
                value: capturesFirst(ctx) ? 'From the views of interest, once captured' : 'None yet',
              },
              { label: 'Drawn by', value: rendererRow(ctx, 'via-report') },
            ],
            note: capturesFirst(ctx)
              ? 'The figures and calculations are drawn from the views of interest once they are captured.'
              : 'Every figure and calculation in the report comes from a view in the package, and it has none yet. Add a view of interest in step 2, or save one from the road view’s bar.',
          },
          unprintedSection(ctx, 'via-report'),
          plannedViewsSection(ctx, 'via-report') ?? noViewsSection(),
        ])
      const undrawn = unprintedFor('via-report', ctx).length
      return withPlanned([
        contents,
        {
          title: 'Report',
          action: packageAction,
          rows: [
            ...structure,
            { label: 'Logo', value: ctx.logo },
            ...(report.mapStyle ? [{ label: 'Map style', value: report.mapStyle }] : []),
            {
              label: 'Figures',
              value: `${plural(report.figures, 'saved view')}${undrawn ? `; ${undrawn} more in the package not drawn (below)` : ''}`,
            },
            { label: 'Drawn by', value: rendererRow(ctx, 'via-report') },
          ],
        },
        {
          title: 'To complete before signing',
          step: 'assess',
          editor: 'assess',
          rows: [
            {
              label: 'Items',
              value:
                report.toComplete === null
                  ? 'Counted once the report’s parts have loaded'
                  : report.toComplete
                    ? plural(report.toComplete, 'item')
                    : 'None',
            },
          ],
          note: 'Judgements, office fields and signatures the run cannot give print blank and are listed at the end of the report.',
        },
        unprintedSection(ctx, 'via-report'),
        plannedViewsSection(ctx, 'via-report'),
        runSection(ctx),
      ])
    }
    case 'via-document': {
      const doc = ctx.document
      if (!doc)
        return withPlanned([
          {
            title: 'Format',
            action: packageAction,
            rows: [
              ...(ctx.recipe ? [{ label: 'From the recipe', value: ctx.recipe }] : []),
              { label: 'Drawn by', value: rendererRow(ctx, 'via-document') },
            ],
            note: capturesFirst(ctx)
              ? 'Filled from the views of interest once they are captured.'
              : 'No view in the package has a class pass yet.',
          },
          unprintedSection(ctx, 'via-document'),
          plannedViewsSection(ctx, 'via-document'),
        ])
      return withPlanned([
        {
          title: 'Format',
          action: packageAction,
          rows: [
            { label: 'Format', value: doc.format },
            ...(ctx.recipe ? [{ label: 'From the recipe', value: ctx.recipe }] : []),
            { label: 'Structure of', value: `Reference document ${doc.sources}` },
            { label: 'Percent alteration', value: doc.formula },
            { label: 'Read against', value: doc.scale },
          ],
        },
        {
          title: 'Images it needs',
          step: 'visit',
          items: doc.images.map((image) => ({ title: image })),
          note: 'The saved views give the analysis image; the other images are listed with their settings.',
        },
        {
          title: 'Viewpoints',
          step: 'visit',
          items: doc.viewpoints.map((vp) => ({ title: vp.name, subtitle: vp.figure })),
        },
        {
          title: 'Reviewer to complete',
          step: 'assess',
          editor: 'assess',
          rows: [{ label: 'Sentences and cells', value: doc.toComplete ? plural(doc.toComplete, 'item') : 'None' }],
          note: 'Judgements the run never makes (visibility term, lines of force, edges, the extent met) come from step 4 at the assessment station only, and are listed, never invented.',
        },
        ...(doc.gaps.length ? [{ title: 'Not filled by PGMaps', items: doc.gaps.map((gap) => ({ title: gap })) }] : []),
        unprintedSection(ctx, 'via-document'),
        plannedViewsSection(ctx, 'via-document'),
        runSection(ctx),
      ])
    }
    case 'field-brief':
      return [
        {
          title: 'Brief',
          step: 'visit',
          rows: [
            { label: 'Block', value: ctx.brief.block ?? 'None' },
            { label: 'Viewpoints', value: String(ctx.brief.viewpoints) },
            { label: 'Screenshots', value: `${ctx.brief.screenshots} (up to 3)` },
            { label: 'Layout stage', value: ctx.review.stage },
            { label: 'Crew checklist', value: ctx.review.checklist },
          ],
        },
        landformSection(ctx),
        runSection(ctx),
        ...withPlanned([plannedViewsSection(ctx, 'field-brief')]),
        {
          // The package's saved views; a capture of a view of interest is listed with that view above.
          ...viewsSection(
            { ...ctx, views: ctx.views.filter((view) => view.inReport && !view.planned) },
            'Saved views in the brief',
            { screenshotsOnly: true },
          ),
          action: packageAction,
          note: 'The brief takes the package’s views, as the other documents do; choose which under Package.',
        },
      ]
    case 'block-sheet': {
      const sheet = ctx.blockSheet
      if (!sheet) return [blocksSection(ctx)]
      return [
        {
          title: 'Sheet',
          rows: [
            { label: 'Block', value: sheet.block },
            { label: 'Sheet', value: sheet.sheet },
            { label: 'Paper', value: sheet.paper },
            { label: 'Scale', value: sheet.scale },
            { label: 'Map style', value: sheet.style },
            { label: 'Logo', value: ctx.logo },
          ],
          note: 'The legend lists only what falls inside the map frame. Terrain for the contours, slope or hillshade is read from the terrain tiles when the sheet is written; the block’s elevations come from the same tiles.',
        },
        {
          title: 'File',
          rows: sheet.file,
          note: sheet.fileNote,
        },
        {
          title: 'On the map',
          step: 'identify',
          editor: 'cutblocks',
          rows: sheet.drawn,
          note: 'A map of the scene: no figure from the run is printed on it.',
        },
      ]
    }
    case 'worksheet':
      return [runSection(ctx), landformSection(ctx), viewpointSection(ctx), blocksSection(ctx), settingsSection(ctx)]
    case 'evidence':
      return [
        {
          title: 'Package',
          rows: [
            { label: 'Recorded assessments', value: String(ctx.evidence.runs) },
            { label: 'Viewpoints', value: String(ctx.evidence.views) },
            { label: 'Field records', value: String(ctx.evidence.fields) },
          ],
        },
        {
          title: 'Evidence checklist',
          items: ctx.evidence.gaps.map((gap) => ({ title: gap })),
          empty: 'Expected evidence categories present. Check content and adequacy.',
        },
      ]
    case 'project': {
      const pictured = ctx.views.filter((view) => view.hasScreenshot).length
      return [
        viewpointSection(ctx),
        landformSection(ctx),
        blocksSection(ctx),
        viewsSection(ctx, 'Saved views, here and at other viewpoints'),
        {
          title: 'With each view',
          rows: [
            { label: 'Pictures', value: `${pictured} of ${ctx.views.length}` },
            {
              label: 'Also kept',
              value: 'Analysis figures, before-harvest renders, another engine’s finished figures',
            },
          ],
        },
        settingsSection(ctx),
        reviewSection(ctx),
        {
          title: 'Own photos',
          rows: ctx.ownPhotos
            ? [
                {
                  label: 'Photos',
                  value: `${ctx.ownPhotos.count}${ctx.ownPhotos.flights > 1 ? ` in ${ctx.ownPhotos.flights} flights` : ''}, ${ctx.ownPhotos.accepted} accepted`,
                },
                {
                  label: 'With each',
                  value: 'The original, its camera and where each value came from, its last search; reopened together',
                },
              ]
            : undefined,
          empty: 'No own photos open.',
        },
        {
          title: 'Project attachments',
          action: { id: 'manage-attachments', label: 'Manage…' },
          items: ctx.attachments?.map((file) => ({
            title: file.name,
            subtitle: [formatBytes(file.bytes), file.linked].filter(Boolean).join(' · '),
          })),
          empty: 'No files attached. Attach the original VIA sheets, a case.json or other evidence with the paperclip.',
        },
        {
          title: 'Workspace and package',
          rows: [
            { label: 'Recorded assessments', value: String(ctx.evidence.runs) },
            { label: 'Figures drawn by', value: ctx.renderer.label },
          ],
        },
        {
          title: 'Not in the file',
          note: 'Terrain, the inventories and the run: they are read and made again when the project is opened. Open it with Open a project, under Start from in step 1.',
        },
      ]
    }
    case 'scene':
      return [
        viewpointSection(ctx),
        landformSection(ctx),
        blocksSection(ctx),
        settingsSection(ctx),
        reviewSection(ctx),
        {
          title: 'Not in the file',
          note: 'Saved views and their screenshots, terrain tiles and the inventory. Use Saved views to keep the views.',
        },
      ]
    case 'views': {
      const elsewhere = ctx.views.filter((view) => !view.here).length
      return [
        viewpointSection(ctx),
        {
          ...viewsSection({ ...ctx, views: ctx.views.filter((view) => view.here) }, 'Saved views'),
          note: elsewhere
            ? `${plural(elsewhere, 'view')} saved at other viewpoints ${elsewhere === 1 ? 'is' : 'are'} not in this file; stand there again to save ${elsewhere === 1 ? 'it' : 'them'}.`
            : undefined,
        },
        landformSection(ctx),
        blocksSection(ctx),
        { title: 'Not in the file', note: 'Screenshots and class passes: save the documents that carry them first.' },
      ]
    }
    case 'workspace':
      return [
        {
          title: 'Workspace',
          rows: [
            { label: 'Recorded assessments', value: String(ctx.evidence.runs) },
            { label: 'Viewpoints', value: String(ctx.evidence.views) },
            { label: 'Field records', value: String(ctx.evidence.fields) },
            { label: 'Current scene', value: ctx.viewpoint.name || 'Unnamed viewpoint' },
          ],
        },
      ]
    case 'scene-package':
      return [
        viewpointSection(ctx),
        {
          title: 'Road view',
          step: 'visit',
          rows: [{ label: 'Status', value: ctx.roadViewReady ? 'Open, terrain loaded' : 'Closed' }],
          action: ctx.roadViewReady ? undefined : { id: 'open-road-view', label: 'Open the road view' },
          note: 'The eye and the look are where the road view stands now.',
        },
        {
          title: 'As a 3D model',
          note: 'glTF, OBJ and STL draw the same scene as a simplified model: the ground from its grid, cut ground and water as their own parts, and each tree a generated low-polygon shape of its own height and crown, never the road view’s drawings. A large scene is thinned to stay within a million triangles; the notes shown with the file say what was simplified or left out. OBJ comes zipped with its .mtl; STL has no colours. Display only.',
        },
      ]
    case 'scene-gis': {
      const { layers, absent } = ctx.gis
      const shapes = { point: ['point', 'points'], line: ['line', 'lines'], polygon: ['area', 'areas'] } as const
      return [
        {
          title: 'Layers',
          step: 'identify',
          rows: layers.map((layer) => ({
            label: layer.title,
            value: `${layer.count} ${shapes[layer.geometry][layer.count === 1 ? 0 : 1]}`,
          })),
          empty: 'None: the scene has no shapes yet.',
          note: 'Each with its attributes: names, a block’s harvest system as stored and as shown, areas in BC Albers hectares, a mask’s kind as stored beside its label, each view’s bearing, lens and block. Drawn in the plan map’s colours: a QGIS style in the GeoPackage and beside each shapefile, one style per layer in the KMZ; GeoJSON carries none.',
        },
        ...(absent.length
          ? [{ title: 'None in the scene', step: 'identify' as const, note: `No ${absent.join(', ').toLowerCase()}.` }]
          : []),
        {
          title: 'Not in the file',
          note: 'The run’s figures (visibility samples, percent alteration, the rating) and the live inventories (VRI, the visual landscape inventory, BC viewpoints): this file holds the scene only, so it needs no run and changes nothing. Sub-landforms and lines of force, drawn from the terrain and never kept in the scene. Saved views and their screenshots.',
        },
      ]
    }
    case 'stand-trees':
      return [
        {
          title: 'Blocks',
          step: 'design',
          rows: ctx.prescribedStands,
          note: 'Diameters are a drawing assumption sized to VRI where it recorded a stand size. The trees are the ones the road view draws; nothing here is a run figure.',
        },
      ]
    case 'sightline-archive': {
      const a = ctx.sightlineArchive
      return [
        {
          title: 'Retained run',
          step: 'assess',
          rows: a
            ? [
                { label: 'File', value: a.name },
                { label: 'Reference row', value: a.rowId },
                { label: 'Size', value: `${(a.bytes / 1_048_576).toFixed(1)} MB` },
              ]
            : [{ label: 'File', value: 'None retained yet' }],
          note: 'Replay it from Numerical run and offline replay: the figures are checked against the checksums it carries.',
        },
      ]
    }
    case 'road-video':
      return ctx.roadVideo
        ? roadVideoContents(ctx.roadVideo.scene, ctx.roadVideo.plan, ctx.roadVideo.take)
        : [{ title: 'Video', note: 'The road view video is not offered here.' }]
    case 'route-card': {
      const card = ctx.routeCard
      if (!card) return [{ title: 'Route card', note: 'The route card is not offered here.' }]
      const counts = card.counts
      return [
        {
          title: 'Route Card Tool Assessment',
          step: 'identify',
          editor: 'route-card',
          rows: [
            { label: 'Block', value: card.blockName ?? 'Add a cutblock' },
            { label: 'Preset', value: card.presetName },
            {
              label: 'Rows',
              value: card.reading
                ? 'Still reading the layers'
                : counts
                  ? `${counts.rows}: ${counts.flagged} Y, ${counts.within} within, ${counts.notRead} not read, ${counts.notPublic} not public, ${counts.entered} entered, ${counts.estimated} estimated`
                  : 'Not read yet',
            },
            { label: 'Access road', value: card.access ?? 'None: crossings are not checked' },
          ],
          note: 'Read live from public BC layers: a screen, not a legal determination. A row no public layer answers prints Not public until you enter it.',
        },
        {
          title: 'Other Considerations',
          step: 'identify',
          editor: 'route-card',
          rows: card.considerations.map((item) => ({
            label: item.title,
            value: `${item.own ? 'Yours' : 'Draft'}${item.toComplete ? `, ${item.toComplete} to complete` : ''}`,
          })),
          note: card.notCalledFor.length
            ? `Not called for by the rows: ${card.notCalledFor.join(', ')}.`
            : 'Every consideration the preset lists is called for.',
        },
      ]
    }
    case 'castor-constraint': {
      const c = ctx.castor.constraint
      return [
        landformSection(ctx),
        {
          title: 'Constraint',
          step: 'design',
          rows: [
            { label: 'Zone column', value: 'zone:vqo' },
            { label: 'Zone ID', value: c?.zoneId ?? 'From the landform' },
            { label: 'Type', value: 'le: at most the percentage of the zone at or below the height' },
            {
              label: 'Green-up height',
              value: c ? `${c.threshold.toFixed(2)} m, the run's area-weighted Table 6 height` : 'From the run',
            },
            {
              label: 'Allowance',
              value: c ? `${c.percentage}% planimetric. ${c.percentageNote}` : "The objective's planimetric figure",
            },
          ],
          note: CASTOR_DENOMINATOR_NOTE,
        },
      ]
    }
  }
}

/** A saved view with what was kept when it was saved, as the page holds them. */
export type ContextView = {
  view: Pick<
    SavedDriveView,
    | 'id'
    | 'name'
    | 'positionMeters'
    | 'harvestPhase'
    | 'treeHeightMeters'
    | 'roadClearWidthMeters'
    | 'lookAtTargetId'
    | 'lookBearing'
    | 'designName'
    | 'plannedViewId'
  >
  here: boolean
  screenshot: boolean
  classPass: boolean
  /** The settings rows recorded with the screenshot (`ViewpointPage.settings`), when one was taken. */
  settings: Row[] | null
  /** In the package (`resolvePackage`'s `viewIds`); true unless left out. */
  inReport?: boolean
}

export type ContextInput = {
  scene: ForestryScene
  result: AnalysisResult | null
  stale: boolean
  assessment: ViaAssessment | null
  views: ContextView[]
  /** `listed`: stations switched off in the form's contents, kept in its list until removed. Absent: none. */
  fs1252: { selected: number[]; reviews: Record<number, unknown>; listed?: number[] }
  blockNote: { blockId?: string; header: Row[]; landform: Row[]; measures: number } | null
  noteFigures: boolean
  figure: { viewId: string | null; style: string; labelStyle: string; cameraInfo: boolean; paintBlocks: boolean }
  document: ExportContext['document']
  report: ExportContext['report']
  /** The VIA report's contents (`ExportContext.reportContents`). Absent: not known here. */
  reportContents?: ExportContext['reportContents']
  logo: string
  renderer: ExportContext['renderer']
  /** `screenshots`: the views with a screenshot the brief takes; absent, every view with one. */
  brief: { blockId: string | null; viewpoints: number; screenshots?: number }
  evidence: { loaded: boolean; gaps: string[]; counts: { views: number; runs: number; fields: number } }
  ownPhotos?: ExportContext['ownPhotos']
  attachments?: ExportContext['attachments']
  roadViewReady: boolean
  /** Absent: no block has a stand prescription. */
  prescribedStands?: Row[]
  /** Absent: no run retained this session. */
  sightlineArchive?: ExportContext['sightlineArchive']
  officeFieldCount: number
  autoRun: ExportAutoRun
  landChecks: ExportContext['landChecks']
  routeCard?: ExportContext['routeCard']
  inventory: ExportContext['inventory']
  visualInventory?: ExportContext['visualInventory']
  /** The package's views of interest (`resolvePackage`). Absent: none planned. */
  planned?: ExportPlannedView[]
  /** The package's views that cannot be drawn, and why (`unprintedViews`). Absent: none. */
  unprinted?: UnprintedView[]
  /** The capture's progress (`useViewCapture`). Absent: idle. */
  capture?: ExportCapture
  /**
   * The site landform (`siteLandformOf`): what a view with no landform of its own is assessed against. Absent: the
   * run's landform, which differs only while the page stands at a view on its own landform.
   */
  siteLandform?: TargetPolygon | null
  /** The package's recipe by name, or null/absent for none. */
  recipe?: string | null
  /** The recipe the VIA report follows, chosen or not. Absent: not known here. */
  reportRecipe?: { name: string; sources: string } | null
  /** The block map sheet as chosen. Absent: the scene has no block. */
  blockSheet?: ExportBlockSheet
  /** The road view video as planned (`ExportContext.roadVideo`). Absent: the page offers none. */
  roadVideo?: ExportContext['roadVideo']
}

const objectiveName = (id: VisualQualityClassId) => {
  const code = EVQO_CODE_FOR_CLASS[id]
  return `${EVQO_NAMES[code]} (${code})`
}

const SYSTEM_NAMES: Record<HarvestSystem, string> = {
  clearcut: 'clearcut',
  retention: 'dispersed retention',
  partial: 'partial cut',
}

/** The run's settings, worded as the files name them. */
export function settingsRows(scene: ForestryScene): Row[] {
  const s = scene.settings
  return [
    { label: 'Eye height', value: `${s.observerHeightMeters} m` },
    { label: 'Station spacing', value: `${s.stationSpacingMeters} m` },
    { label: 'Farthest view', value: `${(s.maxViewDistanceMeters / 1000).toLocaleString('en-CA')} km` },
    { label: 'Green-up age', value: `${s.greenUpAgeYears} years` },
    {
      label: 'Screening',
      value: s.screeningEnabled
        ? `On · crown closure ${s.minCrownClosurePercent}%+ · cleared ${s.screeningEyeClearingMeters ?? 50} m round the eye`
        : 'Off: bare earth',
    },
    {
      label: 'Perspective denominator',
      value:
        s.perspectiveDenominator === 'non-treed-out'
          ? 'Treed landform only (1998 rule)'
          : 'Landform net of rock, water and ice',
    },
    {
      label: 'Private land',
      value: s.privateLandOutOfDenominator ? 'Out of the denominators' : 'In the denominators, no alteration',
    },
    { label: 'Assessment year', value: String(scene.assessmentYear ?? new Date().getFullYear()) },
  ]
}

/** The settings of a saved view without a screenshot record: what the view itself keeps. */
function viewRows(view: ContextView['view'], scene: ForestryScene): Row[] {
  const target = view.lookAtTargetId ? scene.targets.find((entry) => entry.id === view.lookAtTargetId) : null
  return [
    {
      label: 'Position',
      value: `${(view.positionMeters / 1000).toFixed(2)} km along ${scene.viewpoint.name || 'the road'}`,
    },
    {
      label: 'Facing',
      value: target ? target.name : view.lookBearing != null ? `${Math.round(view.lookBearing)}°` : 'Along the road',
    },
    { label: 'Timber', value: `${view.treeHeightMeters} m where heights are not recorded` },
    { label: 'Road clearing', value: `${view.roadClearWidthMeters} m` },
  ]
}

const roadLengthKm = (coordinates: ReadonlyArray<[number, number]>) => lineLengthMeters(coordinates) / 1000

/** The dialog's context from the page's state. */
export function buildExportContext(input: ContextInput): ExportContext {
  const { scene, result, stale, assessment } = input
  const castorConstraint = castorVqoConstraint(scene, result)
  const landform = findSceneLandform(scene)
  const review = scene.viaReview ?? {}
  const checklist = review.fieldChecklist
  const answers = checklist
    ? [...Object.values(checklist.viewpoints), ...Object.values(checklist.greenUp)].filter((entry) => entry.answer)
        .length
    : 0
  const block = (id: string | null) => scene.targets.find((entry) => entry.role === 'block' && entry.id === id) ?? null
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const briefBlock = block(input.brief.blockId) ?? blocks[0] ?? null
  const lengthKm = roadLengthKm(scene.viewpoint.coordinates)
  const planned = input.planned ?? []
  const plannedIds = new Set(planned.map((view) => view.id))
  return {
    run: result ? 'current' : stale ? 'stale' : 'none',
    numericalReady: !!result?.quality?.numericalReady,
    runWarnings: (result?.quality?.warnings ?? []).slice(0, 3),
    ...(() => {
      const figures = runFigures(result, { stale })
      return {
        perspectivePercent: figures.perspective?.cumulativePercent ?? null,
        planimetricPercent: figures.planimetric?.cumulativePercent ?? null,
        runGaps: figures.gaps,
        existingBasis: runExistingBasis(result)?.label ?? null,
        ...(figures.state === 'provisional'
          ? {
              diagnosticPercents: {
                perspective: figures.diagnostic.perspective?.cumulativePercent ?? null,
                planimetric: figures.diagnostic.planimetric?.cumulativePercent ?? null,
              },
            }
          : {}),
      }
    })(),
    rating: assessment?.rating?.label ?? null,
    ratingMissing: assessment?.missing ?? [],
    ocularClass: assessment?.ocular ? objectiveName(assessment.ocular.classId) : null,
    viewpoint: {
      name: scene.viewpoint.name,
      kind: scene.viewpoint.mode === 'corridor' && lengthKm > 0.1 ? 'road' : 'spot',
      lengthKm,
    },
    landform: landform
      ? {
          name: landform.name,
          objective: objectiveName(landform.objectiveId),
          vac: landform.vac,
          areaHa: polygonAreaMeters(landform.geometry) / 10_000,
          source: landform.source,
          inventoryUnit: landform.inventoryUnitId ?? null,
        }
      : null,
    landformCount: scene.targets.filter((target) => target.role === 'landscape').length,
    landformUse: (() => {
      const site = input.siteLandform === undefined ? landform : input.siteLandform
      const use = landformAssignments(scene, site)
      return {
        site: site && landform && site.id !== landform.id ? site.name : null,
        viewsWithOwn: use.views.filter((entry) => entry.own).length,
        views: use.views.length,
        unused: use.unused.length,
      }
    })(),
    blocks: blocks.map((entry) => ({
      name: entry.name,
      areaHa: polygonAreaMeters(entry.geometry) / 10_000,
      system:
        entry.harvestSystem === 'retention' && entry.retentionPercent != null
          ? `${SYSTEM_NAMES.retention}, ${entry.retentionPercent}% left`
          : SYSTEM_NAMES[entry.harvestSystem ?? 'clearcut'],
    })),
    openings: scene.targets.filter((target) => target.role === 'harvested').length,
    masks: (scene.masks ?? []).map((mask) => ({
      kind: mask.kind === 'retained' ? 'retention' : mask.kind,
      name: mask.name,
    })),
    views: input.views.map(({ view, here, screenshot, classPass, settings, inReport }) => ({
      id: view.id,
      name: view.name,
      place: here ? scene.viewpoint.name || 'the road' : 'an earlier viewpoint',
      here,
      positionMeters: view.positionMeters,
      harvestPhase: view.harvestPhase,
      design: view.designName ?? null,
      hasScreenshot: screenshot,
      hasClassPass: classPass,
      inReport: inReport ?? true,
      ...(view.plannedViewId && plannedIds.has(view.plannedViewId) ? { planned: true } : {}),
      settings: [
        ...(settings ?? viewRows(view, scene)),
        { label: 'Harvest phase', value: view.harvestPhase === 'after' ? 'After harvest' : 'Before harvest' },
      ],
    })),
    planned,
    unprinted: input.unprinted ?? [],
    capture: input.capture ?? IDLE_CAPTURE,
    recipe: input.recipe ?? null,
    reportRecipe: input.reportRecipe ?? null,
    settings: settingsRows(scene),
    review: {
      visualsNote: review.visualsNote ? 'yours' : 'draft',
      measures: review.visualMeasures ? 'yours' : 'draft',
      stage: layoutStageLabel(layoutStageOf(review)),
      checklist: answers ? `${answers} answer${answers === 1 ? '' : 's'} recorded` : 'Not checked yet',
    },
    officeFields: {
      filled: Object.values(scene.reportMetadata ?? {}).filter((value) => typeof value === 'string' && value.trim())
        .length,
      total: input.officeFieldCount,
    },
    fs1252Stations: result
      ? [...new Set([...input.fs1252.selected, ...(input.fs1252.listed ?? [])])]
          .filter((index) => index < result.stations.length)
          .sort((a, b) => a - b)
          .map((index) => ({
            index,
            label: `Station ${index + 1} · ${(result.stations[index].distanceAlongMeters / 1000).toFixed(2)} km`,
            on: input.fs1252.selected.includes(index),
            assessment: index === result.assessmentStationIndex,
            inputs: !!input.fs1252.reviews[index],
          }))
      : [],
    blockNote: input.blockNote
      ? { ...input.blockNote, blockId: input.blockNote.blockId ?? '', figures: input.noteFigures }
      : null,
    figure: input.figure,
    ...(input.blockSheet ? { blockSheet: input.blockSheet } : {}),
    document: input.document,
    report: input.report,
    ...(input.reportContents ? { reportContents: input.reportContents } : {}),
    logo: input.logo,
    renderer: input.renderer,
    brief: {
      block: briefBlock?.name ?? null,
      blockId: briefBlock?.id ?? null,
      viewpoints: input.brief.viewpoints,
      screenshots: Math.min(3, input.brief.screenshots ?? input.views.filter((view) => view.screenshot).length),
    },
    evidence: { loaded: input.evidence.loaded, gaps: input.evidence.gaps, ...input.evidence.counts },
    ...(input.ownPhotos?.count ? { ownPhotos: input.ownPhotos } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    roadViewReady: input.roadViewReady,
    gis: sceneGisPlan(scene),
    prescribedStands: input.prescribedStands ?? [],
    sightlineArchive: input.sightlineArchive ?? null,
    castor: {
      constraint: castorConstraint && {
        id: castorConstraint.id,
        zoneId: castorConstraint.zoneId,
        threshold: castorConstraint.threshold,
        percentage: castorConstraint.percentage,
        percentageNote: castorConstraint.percentageNote,
      },
      problem: castorConstraintProblem(scene, result),
    },
    autoRun: input.autoRun,
    landChecks: input.landChecks,
    ...(input.routeCard ? { routeCard: input.routeCard } : {}),
    inventory: input.inventory,
    ...(input.visualInventory ? { visualInventory: input.visualInventory } : {}),
    ...(input.roadVideo ? { roadVideo: input.roadVideo } : {}),
  }
}

/**
 * The package Save & export chooses once for every output: the recipe, the VIA document's format it sets, and the
 * views that go in. `excludedViews` holds the saved views left out by hand (views of interest keep their own
 * `include`). A recipe names the document's format, so the document and the report agree; with none, the document's
 * own choice (else the road view's figure style, else the first format) chooses, and the report follows it.
 */
export type PackageChoice = {
  recipeId: string | null
  documentFormatId: string | null
  excludedViews: ReadonlySet<string>
}

export type PackageInput = {
  choice: PackageChoice
  recipes: ReadonlyArray<{ id: string; format: string }>
  formats: ReadonlyArray<{ id: string; style?: string | null }>
  roadViewStyleId: string | null
  planned: readonly ViewOfInterest[]
  blocks: ReadonlyArray<{ id: string; name: string }>
  /** The scene's landforms, to name a view's own. Absent: no view's landform is named. */
  landforms?: ReadonlyArray<{ id: string; name: string }>
  /** The site landform's id: a view that names it is assessed against the site's, like one that names none. */
  siteLandformId?: string | null
  /** Every saved view, on this road and shelved, in the order the outputs list them. */
  savedViews: ReadonlyArray<{ id: string; name: string; plannedViewId?: string; plannedKey?: string }>
  /** Failed captures by view id, with the `viewCaptureKey` they failed under. */
  failures?: Readonly<Record<string, { key: string; reason: string }>>
  /**
   * Saved views (by id) without the before-harvest render an output pairs them with, which a capture standing there
   * would take (`ExportPlannedView.beforeOwed`). Absent: none.
   */
  beforeOwed?: ReadonlySet<string>
  /** Before renders that failed, by view of interest id, with the `viewCaptureKey` they failed under. */
  beforeFailures?: Readonly<Record<string, { key: string; reason: string }>>
  /**
   * Whether a saved view has its analysis sheet (`viewImages[id]?.figure`): a current capture without one reads
   * `no-figure` and is captured again (`viewCaptureState`). Absent: every current capture reads `captured`.
   */
  hasFigure?: (savedViewId: string) => boolean
}

export type ResolvedPackage = {
  recipeId: string
  /** The recipe was chosen, rather than following the document's format. */
  recipeChosen: boolean
  documentFormatId: string
  planned: ExportPlannedView[]
  /** The saved views that are not a planned view's capture, with whether each goes in. */
  saved: Array<{ id: string; name: string; included: boolean }>
  /** Every saved view the package's outputs draw: the included saved views and each included view's capture. */
  viewIds: ReadonlySet<string>
  /** Every saved view left out, for the block note's builder (`BlockNoteChoices.excludedViews`). */
  excludedViews: ReadonlySet<string>
}

/** Resolves the package choice against the page's recipes, formats, views of interest and saved views. Pure. */
export function resolvePackage(input: PackageInput): ResolvedPackage {
  const { choice, recipes, formats } = input
  const chosen = recipes.find((recipe) => recipe.id === choice.recipeId)
  const chosenFormat = chosen && formats.find((format) => format.id === chosen.format)
  const documentFormat =
    chosenFormat ??
    formats.find((format) => format.id === choice.documentFormatId) ??
    formats.find((format) => (format.style ?? null) === input.roadViewStyleId) ??
    formats[0]
  const recipe =
    (chosenFormat ? chosen : null) ?? recipes.find((entry) => entry.format === documentFormat?.id) ?? recipes[0]
  const plannedIds = new Set(input.planned.map((view) => view.id))
  const planned: ExportPlannedView[] = input.planned.map((view) => {
    const key = viewCaptureKey(view)
    // The latest capture with the current key: an earlier one, or one under another key, is superseded.
    const capture = input.savedViews
      .filter((saved) => saved.plannedViewId === view.id && saved.plannedKey === key)
      .at(-1)
    const failure = input.failures?.[view.id]
    const beforeFailure = input.beforeFailures?.[view.id]
    const state = viewCaptureState(view, input.savedViews, input.hasFigure)
    const owed = state === 'captured' && !!capture && !!input.beforeOwed?.has(capture.id)
    return {
      id: view.id,
      key,
      name: view.name,
      block: input.blocks.find((block) => block.id === view.blockId)?.name ?? 'A block no longer in the scene',
      blockId: view.blockId,
      lens: lensLabel(view.focalMm),
      state,
      include: isIncluded(view),
      savedViewId: capture?.id ?? null,
      landform:
        view.landformId && view.landformId !== input.siteLandformId
          ? (input.landforms?.find((landform) => landform.id === view.landformId)?.name ?? null)
          : null,
      failed: state !== 'captured' && failure && failure.key === key ? failure.reason : null,
      ...(owed
        ? {
            beforeOwed: true,
            beforeFailed: beforeFailure && beforeFailure.key === key ? beforeFailure.reason : null,
          }
        : {}),
    }
  })
  const saved = input.savedViews
    .filter((view) => !view.plannedViewId || !plannedIds.has(view.plannedViewId))
    .map((view) => ({ id: view.id, name: view.name, included: !choice.excludedViews.has(view.id) }))
  const viewIds = new Set([
    ...saved.filter((view) => view.included).map((view) => view.id),
    ...planned.flatMap((view) => (view.include && view.savedViewId ? [view.savedViewId] : [])),
  ])
  return {
    recipeId: recipe?.id ?? '',
    recipeChosen: !!chosenFormat,
    documentFormatId: documentFormat?.id ?? '',
    planned,
    saved,
    viewIds,
    excludedViews: new Set(input.savedViews.filter((view) => !viewIds.has(view.id)).map((view) => view.id)),
  }
}

/**
 * The saved views a file written for one block (`FOR_ONE_BLOCK`: the block note, the field brief) leaves out: the
 * package's own (`excludedViews`) and the current capture of every view of interest planned for another block. A saved
 * view not captured for a planned view keeps going in, as it always has.
 */
export function excludedForBlock(pkg: Pick<ResolvedPackage, 'planned' | 'excludedViews'>, blockId: string | null) {
  const out = new Set(pkg.excludedViews)
  if (!blockId) return out
  for (const view of pkg.planned) if (view.blockId !== blockId && view.savedViewId) out.add(view.savedViewId)
  return out
}

/**
 * The package's views an output that draws figures cannot draw, and why, in the package's order: a view saved without
 * a screenshot, or without the class pass its analysis sheet is drawn from (with the reason its save gave, when kept).
 */
export function unprintedViews(
  views: ReadonlyArray<{ id: string; name: string }>,
  images: Readonly<Record<string, { figure?: unknown; figureError?: string | null } | undefined>>,
): UnprintedView[] {
  return views.flatMap((view) => {
    const image = images[view.id]
    if (!image)
      return [
        {
          id: view.id,
          name: view.name,
          reason:
            'it has no screenshot or analysis sheet in this session (they are not kept when the page reloads, or its screenshot could not be taken): capture it again',
        },
      ]
    if (image.figure) return []
    const why = image.figureError?.trim().replace(/[.\s]*$/, '')
    return [
      {
        id: view.id,
        name: view.name,
        reason: `its analysis sheet could not be drawn: ${why ? why[0].toLowerCase() + why.slice(1) : 'its class pass was not taken when it was saved'}`,
      },
    ]
  })
}

/**
 * A VIA document viewpoint's figure as What goes in lists it: its printed percent and term, or why it prints none.
 * Every view the document holds has a class pass; a figure is missing only when the picture holds none of the
 * landform, or the format's deductions (rock, private land) take all of it.
 */
export function documentFigureLine(
  printed: { percent: string; term: string } | null,
  areas: { landform: number } | null,
): string {
  if (printed) return `${printed.percent}% · ${printed.term}`
  if (!areas) return 'No figure: the view has no class pass'
  return areas.landform > 0
    ? 'No figure: the format’s deductions (rock, private land) take all of the landform in the picture'
    : 'No figure: the landform is not in the picture (its class pass shows none of it)'
}

/**
 * The included views `kind` is written without, each with why, for the file's own notice: views of interest not
 * captured (their capture's reason, else not captured yet) and views it cannot draw (`unprintedFor`).
 */
export function viewsLeftOut(kind: VisualsExport, ctx: PlannedContext): Array<{ name: string; reason: string }> {
  return [
    ...plannedForOutput(kind, ctx)
      .filter((view) => !hasCurrentCapture(view))
      .map((view) => ({
        name: view.name,
        reason: view.failed
          ? `not captured: ${view.failed[0].toLowerCase()}${view.failed.slice(1)}`
          : view.state === 'outdated'
            ? 'not captured again since it changed, so its earlier capture is left out'
            : 'not captured',
      })),
    ...unprintedFor(kind, ctx).map((view) => ({ name: view.name, reason: view.reason })),
  ]
}

/**
 * An engine's render of a saved view under the names the view was saved with: where it stood (`place`, the facts'
 * Viewpoint line) and its own name. The engine draws the picture again; who and where the view is stay the saved
 * record's, never the page's as it stands while the render runs.
 */
export function savedIdentity<
  F extends { place?: string; viewpoint: string; facts: ReadonlyArray<{ label: string; value: string }> },
>(drawn: F, own: F | undefined): F {
  if (!own) return drawn
  const ownLine = own.facts.find((fact) => fact.label === 'Viewpoint')
  const named: F = {
    ...drawn,
    viewpoint: own.viewpoint,
    facts: drawn.facts.map((fact) => (fact.label === 'Viewpoint' && ownLine ? ownLine : fact)),
  }
  if (own.place !== undefined) named.place = own.place
  else delete named.place
  return named
}

/** The package in one line, for its entry in the dialog's list. */
export function packageSummary(ctx: ExportContext): string {
  const own = ctx.views.filter((view) => !view.planned && view.inReport).length
  const planned = ctx.planned.filter((view) => view.include)
  const toCapture = planned.filter((view) => view.state !== 'captured').length
  return [
    ctx.recipe ?? 'No recipe',
    ctx.renderer.label,
    `${plural(own + planned.length, 'view')}${toCapture ? `, ${toCapture} to capture` : ''}`,
  ].join(' · ')
}
