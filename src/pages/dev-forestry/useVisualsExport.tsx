import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { standFileSummary, standTreeCsv, standTreeGeoJson, type PrescribedStandFile } from './stand/standExport'
import { LogoChooser } from '@/branding/LogoChooser'
import { logoDataUrl } from '@/branding/model'
import { brandedHtml } from '@/branding/presentation'
import { exportBrand, printedLogo } from '@/branding/store'
import { useBranding } from '@/branding/useBranding'
import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import type { LabelStyleId } from '@/lib/mapSheet/callouts'
import { LABEL_STYLES } from '@/lib/mapSheet/callouts'

import type { BlockNoteParts } from './VisualsParagraphPanel'
import type { NoteImage, ViewpointPage } from './blockNote'
import type { BcSensitivityUnit } from './bcVisualInventory'
import { briefViewpoints, buildFieldBrief, fieldBriefFileName, fieldBriefPdf } from './fieldBrief'
import { withReadInventory } from './inventoryBadge'
import { terrainDetailNote } from './figureFraming'
import {
  AnalysisSheetOptions,
  analysisSheetFile,
  DEFAULT_FIGURE_STYLE,
  figureNoteImage,
  NO_FIGURE_CHOICE,
  resolveFigureChoice,
  timberMeasureFor,
  type FigureChoice,
  type FigureView,
  type SavedFigure,
} from './FigureSheetPanel'
import { TIMBER_ABSENT, type TimberMeasure } from '@/lib/forestry/viaFigure/timberScreen'
import { FS1252_OFFICE_FIELDS, Fs1252Options, type Fs1252Choice } from './Fs1252Options'
import {
  LAND_CHECK_CAVEAT,
  landCheckReportRows,
  landChecksPending,
  type LandCheckId,
  type LandCheckState,
} from './landStatusChecks'
import { buildFs1252, type FormReview } from './pdf/fs1252'
import { serializePreview, type SavedDriveView } from './previewState'
import { serializeScene, type ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import type { AnalysisProgress, AnalysisResult, TargetPolygon } from './types'
import type { ViewpointInventoryState } from './ViewpointFinderPanel'
import { viewpointsNearBlock, type ViewpointCandidate } from './viewpointInventory'
import type { ViaAssessment, ViaStepId } from './via'
import type { RenderJob, RenderJobState } from './BackgroundRenders'
import {
  ROAD_RENDERERS,
  roadRendererInfo,
  roadRendererUnavailable,
  roadRendererUrl,
  type RoadRendererId,
} from './externalRenderers'
import { formatRemaining, notQueuedMs, type RenderEngineId, type RenderHistory } from './renderEstimate'
import { pairPictures, simulationPicture, type BeforePicture } from './reportPairs'
import { DEFAULT_OVERVIEW_SHEET_STYLE, OVERVIEW_SHEET_STYLES, type OverviewSheetStyle } from './reportMaps'
import { documentFacts } from './viaDocument/facts'
import { runGreenUpBasis } from './greenUp'
import { VIA_DOCUMENT_FORMATS, findDocumentFormat } from './viaDocument/formats'
import { documentMarkdown, viewsLeftOutMarkdown } from './viaDocument/markdown'
import { resolveViaDocument } from './viaDocument/resolve'
import { EVQO_CODE_FOR_CLASS } from './visualsNarrative'
import { buildReportContext, type ReportView } from './viaReport/context'
import { reportHtml, reportMarkdown } from './viaReport/html'
import type { ReportFigure } from './viaReport/model'
import type { ReportImages } from './viaReport/parts'
import type { ReportSetting } from './viaReport/setting'
import { assembleReport, findReportRecipe, recipeFormat, REPORT_RECIPES, withViewsLeftOut } from './viaReport/recipes'
import { ExportPackagePane, VisualsExportDialog, type BuiltFile } from './VisualsExportDialog'
import type { ViewCaptureApi, ViewCaptureReport } from './useViewCapture'
import { viewCaptureKey, type ViewOfInterest } from './viewsOfInterest'
import {
  castorConstraintCsv,
  castorConstraintProblem,
  castorVqoConstraint,
  castorZoneGeoJson,
} from './castorConstraint'
import {
  buildExportContext,
  documentFigureLine,
  excludedForBlock,
  resolvePackage,
  savedIdentity,
  unprintedViews,
  viewsLeftOut,
  type ContextView,
  type ExportAction,
  type ExportAutoRun,
  type VisualsExport,
} from './visualsExports'

export type ViewImage = NoteImage & {
  savedAt: number
  figure?: SavedFigure
  /** Why its analysis sheet (class pass) could not be drawn when it was saved, when it could not. */
  figureError?: string
  viewpoint?: Omit<ViewpointPage, 'simulation'>
  /** Where and how it was framed (`FigureAt`): only whether it kept the drive's pose is read here. */
  figureAt?: { pose?: object | null }
}

/** A before-harvest render a capture took where the view stands (`capture(ids, { before: true })`), by saved view. */
export type CapturedBefore = Readonly<
  Record<string, { plannedKey: string | null; render: { dataUrl: string; width: number; height: number } }>
>

const textFile = (text: string, fileName: string, type: string): BuiltFile => ({
  blob: new Blob([text], { type }),
  fileName,
})

/** The evidence package and workspace backup, from the assessment tools' stored document. */
export type EvidenceExports = {
  loaded: boolean
  gaps: string[]
  counts: { views: number; runs: number; fields: number }
  pdf: () => Promise<Blob>
  html: () => string
  workspaceJson: () => string
}

/** What the block note's file carries besides its text, chosen in the dialog. */
export type BlockNoteChoices = {
  /**
   * Saved views left out of the package, by id: those left out by hand, the captures of views of interest left out,
   * and every capture superseded by a later one or an edit (`resolvePackage`'s `excludedViews`).
   */
  excludedViews: ReadonlySet<string>
  /** The land status checks as printed, or null when left out. */
  landStatus: { rows: Array<{ label: string; value: string; note: string }>; caveat: string } | null
}

const progressText = (progress: AnalysisProgress | null) =>
  !progress
    ? null
    : progress.phase === 'terrain'
      ? `fetching terrain, ${progress.completed} of ${progress.total} tiles`
      : `tracing sightlines${progress.total ? `, ${Math.round((100 * progress.completed) / progress.total)}%` : ''}`

/** Before-harvest renders by view id, and why a view has none (`captureBeforeRenders` on the page). */
type BeforeRenders = {
  renders: Record<string, { dataUrl: string; width: number; height: number }>
  absent: Record<string, string>
  notes: string[]
}

/** Whether Save & export is open and on which output; made before the panels that open it. */
export function useExportOpener() {
  const [open, setOpen] = useState(false)
  const [initialOutput, setInitialOutput] = useState<VisualsExport>('block-note')
  // Opened on the package's entry rather than an output (*Figures drawn by · Change* in the views panel).
  const [initialPackage, setInitialPackage] = useState(false)
  // Who draws the figures of the sheet, the document and the report: PGMaps as saved, or another engine. Held here,
  // made before the panels, so the views panel can say it while the dialog is closed.
  const [figureRenderer, setFigureRenderer] = useState<RoadRendererId>('pgmaps')
  const openExport = useCallback((kind: VisualsExport = 'block-note') => {
    setInitialOutput(kind)
    setInitialPackage(false)
    setOpen(true)
  }, [])
  const openPackage = useCallback(() => {
    setInitialPackage(true)
    setOpen(true)
  }, [])
  return { open, setOpen, initialOutput, initialPackage, openExport, openPackage, figureRenderer, setFigureRenderer }
}
export type ExportOpener = ReturnType<typeof useExportOpener>

/**
 * Save & export for the visual-quality page: the dialog, the choices each output keeps while the
 * page is open (FS1252 stations, the analysis sheet's view and style), and how each file is written.
 * Closed, it renders nothing and computes nothing. Opening it is `opener.openExport(kind)`; the sidebar's export buttons and the toolbar's both use it.
 */
export function useVisualsExport(input: {
  opener: ExportOpener
  scene: ForestryScene
  setScene: (update: (current: ForestryScene) => ForestryScene) => void
  /** Changes when the run's inputs do (`sceneFingerprint`). */
  sceneKey: string
  /** The current run; null when there is none or it is stale. */
  result: AnalysisResult | null
  stale: boolean
  /** The scene the current run was made from. */
  snapshot: ForestryScene | null
  assessment: ViaAssessment | null
  /** The step 4 record in the FS1252's terms, for the assessment station. */
  fs1252Review: FormReview | null
  savedViews: ReadonlyArray<SavedDriveView>
  otherViews: ReadonlyArray<SavedDriveView>
  images: Readonly<Record<string, ViewImage>>
  roadView: { styleId: string | null; labelStyle: LabelStyleId | null }
  /** The blocks with a stand prescription, read (`stand/standExport.ts`). */
  prescribedStands: ReadonlyArray<PrescribedStandFile>
  currentStation: number
  blockNoteParts: BlockNoteParts | null
  noteFigures: boolean
  onNoteFigures: (on: boolean) => void
  buildBlockNote: (format: 'xlsx' | 'pdf', parts: BlockNoteParts, choices: BlockNoteChoices) => Promise<BuiltFile>
  /** The page's visibility run, which the export starts itself when an output reads it. */
  analysis: {
    status: 'idle' | 'running' | 'ready' | 'error'
    progress: AnalysisProgress | null
    error: string | null
    /** Why this scene cannot run, or null. */
    blocker: string | null
    run: () => void
  }
  /** The land status checks the summary cards read (`useLandChecks`). */
  landChecks: { states: Partial<Record<LandCheckId, LandCheckState>>; unchecked: string | null }
  /**
   * The scene's visual landscape inventory, read live around the scene (the EVQO drape's read): `units` once read,
   * null before and after a failure. `read` starts it, or reads again after a failure; the outputs that print the
   * inventory ask for it before they are written (`READS_INVENTORY`).
   */
  visualInventory?: {
    status: 'idle' | 'loading' | 'ready' | 'error'
    units: readonly BcSensitivityUnit[] | null
    error: string | null
    read: () => void
  }
  /** The BC viewpoint inventory as the page last read it, and how to read it around a block. */
  viewpointInventory: ViewpointInventoryState
  onLoadInventory: (block: TargetPolygon, options: { show: boolean }) => void
  /** Closes nothing itself: stands at an inventory viewpoint in the road view, facing the block. */
  onStandAt: (candidate: ViewpointCandidate, block: TargetPolygon) => void
  onOpenRoadView: () => void
  /** The worked figures as Markdown, or null when the run is not current. */
  worksheet: () => BuiltFile | null
  scenePackage: { ready: boolean; build: () => BuiltFile }
  evidence: EvidenceExports
  /**
   * The background renders (`useBackgroundRenders`): the saved views drawn again by another engine at final quality,
   * the queue, and the job a view would take. Absent, figures are always PGMaps' own.
   */
  renders?: {
    figures: Readonly<Record<string, SavedFigure>>
    jobs: readonly RenderJobState[]
    history: RenderHistory
    leftMs: number | null
    enqueue: (jobs: RenderJob[]) => void
    /** `before`: the view's before picture for the VIA report, by the same engine (null when it needs none). */
    jobFor: (viewId: string, engine: RenderEngineId, phase?: 'before') => RenderJob | null
    /** The road view is open with its terrain: an engine draws from it. */
    ready: boolean
  }
  briefBlockId: string | null
  onBriefBlockId: (id: string) => void
  /**
   * The VIA report's maps and extra pictures (overview, regional and location maps, before pictures, overhead
   * renders), captured from the page's maps while the report file is built and put back afterwards. Absent, the
   * report prints placeholders.
   */
  captureReportImages?: (request: {
    views: ReadonlyArray<{ id: string; name: string }>
    overviewSheet?: {
      style: OverviewSheetStyle
      logo: import('@/lib/mapSheet/drawOps').RasterImage | null
      project: string | null
    }
    obliquePitch?: number
    /** The report prints 26's figure page, which takes location and regional maps of its own. */
    figurePageMaps?: boolean
  }) => Promise<{ images: ReportImages; notes: string[]; beforeRenders?: BeforeRenders }>
  /**
   * Before-harvest renders of saved views from their own framed poses, for the with-timber pixel figure
   * (`timberMeasureFor`); absent, the figure says no before render was taken.
   */
  captureBeforeRenders?: (views: ReadonlyArray<{ id: string; name: string }>) => Promise<BeforeRenders>
  /**
   * Where the blocks are and what the land is like for the VIA report's summary and landscape paragraphs
   * (`viaReport/setting.ts`); the page caches it by run, so calling it on each render costs nothing.
   */
  reportSetting?: () => ReportSetting | null
  /**
   * The views of interest planned on the plan map (`scene.viewsOfInterest`) and how to change them: the package's
   * checklist writes a view's `include`. Absent: none are planned.
   */
  viewsOfInterest?: readonly ViewOfInterest[]
  setViewsOfInterest?: (update: (views: ViewOfInterest[]) => ViewOfInterest[]) => void
  /**
   * Captures views of interest as saved views (`useViewCapture`): the outputs that draw views call it on Preview and
   * Download for the included views not yet captured, and show its progress with a Cancel.
   */
  viewCapture?: Pick<ViewCaptureApi, 'state' | 'capture' | 'cancel'>
  /**
   * The before-harvest renders captures took where each view stands, by saved view id, with the planned view's key they
   * were taken under: a view away from where the reviewer stands takes its before picture from here.
   */
  capturedBefore?: CapturedBefore
  portalContainer?: HTMLElement | null
}) {
  const {
    scene,
    setScene,
    result,
    stale,
    snapshot,
    assessment,
    fs1252Review,
    savedViews,
    otherViews,
    images,
    roadView,
    blockNoteParts,
    noteFigures,
    evidence,
  } = input
  const { open, setOpen, initialOutput } = input.opener

  // The stations reset with the run, as the sidebar's did: one form for the assessment station.
  const [fs1252, setFs1252] = useState<Fs1252Choice>({ selected: [], reviews: {} })
  const [choiceRun, setChoiceRun] = useState<AnalysisResult | null>(null)
  if (choiceRun !== result) {
    setChoiceRun(result)
    setFs1252({ selected: result ? [result.assessmentStationIndex] : [], reviews: {} })
  }
  const [figureChoice, setFigureChoice] = useState<FigureChoice>(NO_FIGURE_CHOICE)
  // The VIA document's format; until chosen, the one drawn in the road view's figure style.
  const [documentFormatId, setDocumentFormatId] = useState<string | null>(null)
  const { figureRenderer, setFigureRenderer } = input.opener
  // The package's recipe (the VIA report's structure, and the VIA document's format it names); until chosen, none:
  // the report follows the document's format.
  const [packageRecipeId, setPackageRecipeId] = useState<string | null>(null)
  // The 11 × 17 overview sheet's style; until chosen, the recipe's (`overviewSheetStyle`), else landscape topographic.
  const [overviewSheetChoice, setOverviewSheetChoice] = useState<OverviewSheetStyle | null>(null)
  // The logo printed sheets and reports carry (the user's own, else the brand's), kept in IndexedDB.
  const branding = useBranding()
  // The package's saved views left out by hand, read by every output that draws views; and the block note's land
  // checks in or out. Both last as long as the page.
  const [excludedViews, setExcludedViews] = useState<ReadonlySet<string>>(() => new Set())
  const [includeLandChecks, setIncludeLandChecks] = useState(true)
  // Views of interest whose capture failed, under the key they failed with: a preview skips them, a download retries.
  const [captureFailures, setCaptureFailures] = useState<Readonly<Record<string, { key: string; reason: string }>>>({})
  // Views of interest whose before-harvest render could not be taken, under the key they were captured with.
  const [beforeFailures, setBeforeFailures] = useState<Readonly<Record<string, { key: string; reason: string }>>>({})

  // The inventory near the note's block is read when the dialog opens on it, once per block, without
  // switching the plan's inventory layer on. Nothing to press; the section says when it is reading.
  const noteBlock = scene.targets.find((target) => target.id === blockNoteParts?.blockId && target.role === 'block')
  const inventoryState = input.viewpointInventory
  const askedFor = useRef<string | null>(null)
  const { onLoadInventory } = input
  useEffect(() => {
    if (!open || !noteBlock || askedFor.current === noteBlock.id) return
    if (inventoryState.status === 'loading') return
    if (inventoryState.status === 'ready' && inventoryState.blockId === noteBlock.id) return
    askedFor.current = noteBlock.id
    onLoadInventory(noteBlock, { show: false })
  }, [open, noteBlock, inventoryState.status, inventoryState.blockId, onLoadInventory])

  // The report's captured maps and pictures, kept for the scene and views they were taken from.
  const reportCaptures = useRef<{
    key: string
    value: { images: ReportImages; notes: string[]; beforeRenders?: BeforeRenders }
  } | null>(null)
  // The with-timber measures made this session, by scene, view and save: a before render moves the road view for a
  // few seconds, so a view is rendered once. Only measured ones are kept; an absent one is looked for again.
  const timberMeasures = useRef(new Map<string, TimberMeasure>())

  // Closed, the dialog costs the page nothing: this page re-renders several times a second while the
  // road view moves, and nothing below is needed until the dialog opens.
  if (!open) return null

  // The package, chosen once for every output: the recipe and the document format it names, and the views that go
  // in (the saved views not left out, and the current capture of each view of interest included).
  const plannedViews = input.viewsOfInterest ?? []
  const allViews = [...otherViews, ...savedViews]
  // The planned views' captures that a before picture would pair with and that have none a capture took: those away
  // from where the reviewer stands (or here with the road view closed) are captured again with their before render.
  const capturedBefore = input.capturedBefore ?? {}
  const here = new Set(savedViews.map((view) => view.id))
  const beforeOwed = new Set(
    allViews
      .filter((view) => {
        const image = images[view.id]
        if (!view.plannedViewId || !image?.figure || !image.figureAt?.pose) return false
        if (image.viewpoint?.harvestPhase === 'before' || image.viewpoint?.photo) return false
        if (capturedBefore[view.id] && capturedBefore[view.id].plannedKey === (view.plannedKey ?? null)) return false
        return !(here.has(view.id) && input.scenePackage.ready)
      })
      .map((view) => view.id),
  )
  const pkg = resolvePackage({
    choice: { recipeId: packageRecipeId, documentFormatId, excludedViews },
    recipes: REPORT_RECIPES,
    formats: VIA_DOCUMENT_FORMATS,
    roadViewStyleId: roadView.styleId,
    planned: plannedViews,
    blocks: scene.targets.filter((target) => target.role === 'block'),
    savedViews: allViews,
    failures: captureFailures,
    beforeOwed,
    beforeFailures,
    hasFigure: (id) => !!images[id]?.figure,
  })
  const packageViews = allViews.filter((view) => pkg.viewIds.has(view.id))
  // The package's views the sheet, the document and the report cannot draw, each named in the file with why.
  const unprinted = unprintedViews(packageViews, images)

  // With another engine chosen, each saved view's figure is that engine's render when it is done.
  const renders = input.renders
  const engineId: RenderEngineId | null = figureRenderer === 'pgmaps' ? null : figureRenderer
  const engineJobs =
    engineId && renders
      ? packageViews.flatMap((view) => {
          const job = images[view.id]?.figure ? renders.jobFor(view.id, engineId) : null
          return job ? [job] : []
        })
      : []
  const missingJobs = engineJobs.filter((job) => !renders?.figures[job.key])
  // The VIA report's before pictures by the same engine, so a pair never compares two renderers. A failed one is not
  // asked again or waited for: that pair falls back to PGMaps for both pictures, and says so.
  const beforeJobs =
    engineId && renders
      ? packageViews.flatMap((view) => {
          const job = images[view.id]?.figure ? renders.jobFor(view.id, engineId, 'before') : null
          return job ? [job] : []
        })
      : []
  const beforeFailed = (job: RenderJob) =>
    !!renders?.jobs.some((entry) => entry.job.key === job.key && entry.status === 'error')
  const missingBeforeJobs = beforeJobs.filter((job) => !renders?.figures[job.key] && !beforeFailed(job))
  // A view saved before the inventory was read takes its unit from the scene's read, by the rules its sheet uses.
  const readUnits = input.visualInventory?.units ?? null
  const withInventory = (image: (typeof images)[string]) =>
    image?.figure && readUnits ? { ...image, figure: withReadInventory(image.figure, readUnits) } : image
  const figureImages: typeof images = Object.fromEntries(
    Object.entries(images).map(([id, image]) => {
      const job = engineId && renders ? engineJobs.find((entry) => entry.viewId === id) : undefined
      const drawn = job ? renders?.figures[job.key] : undefined
      return [id, withInventory(drawn ? { ...image, figure: savedIdentity(drawn, image.figure) } : image)]
    }),
  )
  // Views saved at another place: an engine draws from the road view where the reviewer stands, so they have no job
  // (`renderJobFor`) and keep PGMaps' figures, which the files say.
  const engineElsewhere = engineId
    ? new Set(packageViews.filter((view) => images[view.id]?.figure && !here.has(view.id)).map((view) => view.id))
    : new Set<string>()
  const engineState = engineId && renders ? renders.jobs.filter((entry) => entry.job.engine === engineId) : []
  const engineRunning = engineState.some((entry) => entry.status === 'running' || entry.status === 'waiting')
  const engineFailed = engineState.find(
    (entry) => entry.status === 'error' && missingJobs.some((job) => job.key === entry.job.key),
  )
  const queuedKeys = new Set(engineState.filter((entry) => entry.status !== 'error').map((entry) => entry.job.key))
  const leftFor = (owed: readonly RenderJob[]) => {
    const notStarted = notQueuedMs(owed, queuedKeys, renders?.history ?? [], engineRunning)
    return engineRunning ? (renders?.leftMs ?? 0) + notStarted : owed.length ? notStarted : null
  }
  const engineLeftMs = leftFor(missingJobs)
  // The VIA report's wait: its figures and its before pictures.
  const reportLeftMs = leftFor([...missingJobs, ...missingBeforeJobs])
  const engineBlocked = engineId
    ? roadRendererUnavailable(engineId, {
        url: roadRendererUrl(engineId, import.meta.env),
        webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      })
    : null
  // The road view's terrain reloads after a run (a report runs one when stale): the renders wait for it.
  const engineSettling =
    !!engineId && !engineBlocked && !!renders && !renders.ready && missingJobs.length + missingBeforeJobs.length > 0
  const engineUnavailable = engineId
    ? (engineBlocked ??
      (!renders
        ? 'background renders are not available here.'
        : engineSettling
          ? 'open the road view and let its terrain load: the engine draws from it.'
          : null))
    : null

  // The views the sheet, the document and the report draw: the package's.
  const figureViews: FigureView[] = packageViews.map((view) => ({
    id: view.id,
    name: view.name,
    image: figureImages[view.id],
  }))
  // The sheet's calculation follows the scene's denominators when the scene takes private land out of them.
  const resolved = { ...resolveFigureChoice(figureChoice, figureViews, roadView), sceneDenominator: scene.settings }

  // PGMaps' with-timber pixel figure: the view's before-harvest render against its after picture (`timberScreen.ts`).
  const timberKey = (id: string) => `${input.sceneKey}|${id}|${images[id]?.savedAt ?? ''}`
  /** Each view's measure from `before` (or one kept from earlier), or why it has none. Keeps the measured ones. */
  const measureTimber = async (
    views: ReadonlyArray<{ id: string }>,
    before: BeforeRenders | null,
  ): Promise<Record<string, TimberMeasure>> => {
    const out: Record<string, TimberMeasure> = {}
    for (const view of views) {
      const kept = timberMeasures.current.get(timberKey(view.id))
      const figure = images[view.id]?.figure
      if (kept) out[view.id] = kept
      else if (figure) {
        const render = before?.renders[view.id] ?? null
        const measure: TimberMeasure = render
          ? await timberMeasureFor(figure, render)
          : { kind: 'absent', reason: before?.absent[view.id] ?? TIMBER_ABSENT.noBefore }
        if (measure.kind === 'measured') timberMeasures.current.set(timberKey(view.id), measure)
        out[view.id] = measure
      }
    }
    return out
  }
  /** As `measureTimber`, rendering before harvest the views not yet measured (this moves the road view). */
  const timberFor = async (views: ReadonlyArray<{ id: string; name: string }>) => {
    const missing = views.filter((view) => !timberMeasures.current.has(timberKey(view.id)) && images[view.id]?.figure)
    const before = missing.length && input.captureBeforeRenders ? await input.captureBeforeRenders(missing) : null
    if (before?.notes.length) console.warn(`With-timber pixel figure:\n${before.notes.join('\n')}`)
    return measureTimber(views, before)
  }

  const landform = findSceneLandform(scene)
  const blocks = scene.targets.filter((target) => target.role === 'block')

  // One resolved document feeds the dialog's contents, its preview and the file.
  // The package's recipe names it; with none, the document's own choice, else the road view's figure style.
  const documentFormat = findDocumentFormat(pkg.documentFormatId) ?? VIA_DOCUMENT_FORMATS[0]
  // A with-timber measure made this session (by the analysis sheet or the report) reaches the document too.
  const documentViews = figureViews.flatMap((view) => {
    const timber = timberMeasures.current.get(timberKey(view.id))
    return view.image?.figure ? [{ name: view.name, figure: view.image.figure, ...(timber ? { timber } : {}) }] : []
  })
  const facts = documentViews.length
    ? documentFacts({
        project: blocks.length ? blocks.map((entry) => entry.name).join(', ') : 'the proposed blocks',
        objective: landform ? EVQO_CODE_FOR_CLASS[landform.objectiveId] : null,
        views: documentViews,
        assessmentStation: result?.assessmentStationIndex ?? null,
        review: scene.viaReview ?? null,
        assessment,
        breakdown: result?.perspectiveAlteration ?? null,
        ...(result ? { screeningModelled: !!result.settings.screeningEnabled } : {}),
        greenUp: result ? runGreenUpBasis(result).label : null,
      })
    : null
  const viaDocument = facts ? resolveViaDocument(documentFormat, facts) : null

  // The report: its recipe, its views and a context assembled without figures for the dialog; the file adds them.
  const reportRecipe = findReportRecipe(pkg.recipeId) ?? REPORT_RECIPES[0]
  const overviewSheetStyle: OverviewSheetStyle =
    overviewSheetChoice ?? reportRecipe.overviewSheetStyle ?? DEFAULT_OVERVIEW_SHEET_STYLE
  const reportViews: ReportView[] = figureViews.flatMap((view) =>
    view.image?.figure
      ? [{ name: view.name, figure: view.image.figure, settings: figureImages[view.id]?.viewpoint?.settings ?? null }]
      : [],
  )
  const reportContext = (
    figures: readonly ReportFigure[],
    images?: ReportImages,
    views: readonly ReportView[] = reportViews,
  ) =>
    buildReportContext({
      recipe: reportRecipe,
      scene,
      views,
      assessmentStation: result?.assessmentStationIndex ?? null,
      assessment,
      breakdown: result?.perspectiveAlteration ?? null,
      figures,
      ...(images ? { images } : {}),
      ...(readUnits ? { inventoryUnits: readUnits } : {}),
      reportSetting: input.reportSetting?.() ?? null,
      greenUp: result ? runGreenUpBasis(result).label : null,
      date: new Date(),
    })
  // Placeholder figures stand in for the counts only; the file draws each view's figure.
  const draftReport = reportViews.length
    ? assembleReport(
        reportRecipe,
        reportContext(
          reportViews.map((view) => ({ view: view.name, caption: view.name, dataUrl: '', width: 1, height: 1 })),
        ),
      )
    : null
  const chosenLogo = printedLogo(branding)
  const briefBlock = blocks.find((entry) => entry.id === input.briefBlockId) ?? blocks[0] ?? null
  // The brief takes the package's views as the other documents do, less views of interest planned for another block.
  const briefLeftOut = excludedForBlock(pkg, briefBlock?.id ?? null)
  const briefViews = [
    ...savedViews.map((view) => ({ ...view, onThisRoad: true })),
    ...otherViews.map((view) => ({ ...view, onThisRoad: false })),
  ].filter((view) => !briefLeftOut.has(view.id))
  const briefPoints = briefViewpoints({
    viewpoint: scene.viewpoint,
    block: briefBlock,
    targets: scene.targets,
    result,
    savedViews: briefViews,
  })

  const contextViews: ContextView[] = [
    ...savedViews.map((view) => ({ view, here: true })),
    ...otherViews.map((view) => ({ view, here: false })),
  ].map(({ view, here }) => ({
    view,
    here,
    screenshot: !!images[view.id],
    classPass: !!images[view.id]?.figure,
    settings: images[view.id]?.viewpoint?.settings ?? null,
    inReport: pkg.viewIds.has(view.id),
  }))
  const analysis = input.analysis
  const autoRun: ExportAutoRun = {
    blocker: analysis.blocker,
    status: analysis.status === 'running' ? 'running' : analysis.status === 'error' ? 'error' : 'idle',
    progress: analysis.status === 'running' ? progressText(analysis.progress) : null,
    error: analysis.error,
  }
  const landRows = landCheckReportRows(input.landChecks.states, { unchecked: input.landChecks.unchecked })
  const candidates =
    noteBlock && inventoryState.data && inventoryState.blockId === noteBlock.id
      ? viewpointsNearBlock(noteBlock.geometry, inventoryState.data)
      : []
  const inventoryStatus =
    inventoryState.status === 'ready' && inventoryState.blockId !== noteBlock?.id ? 'idle' : inventoryState.status
  const context = buildExportContext({
    scene,
    result,
    stale,
    assessment,
    views: contextViews,
    fs1252,
    blockNote: blockNoteParts
      ? {
          blockId: blockNoteParts.blockId,
          header: blockNoteParts.header,
          landform: blockNoteParts.landform,
          measures: blockNoteParts.measures.items.length,
        }
      : null,
    noteFigures,
    figure: {
      viewId: resolved.view?.id ?? null,
      style: resolved.preset.name,
      labelStyle: LABEL_STYLES.find((entry) => entry.id === resolved.labelStyle)?.name ?? resolved.labelStyle,
      cameraInfo: resolved.cameraInfo,
      paintBlocks: resolved.paintBlocks,
    },
    report: draftReport
      ? {
          recipe: reportRecipe.name,
          sources: reportRecipe.sources.join(', '),
          parts: reportRecipe.parts.map((id) => id.replace(/-/g, ' ')),
          figures: reportViews.length,
          toComplete: draftReport.toComplete.length,
        }
      : null,
    renderer: {
      id: figureRenderer,
      label: roadRendererInfo(figureRenderer).label,
      missing: missingJobs.length,
      views: engineJobs.length,
      running: engineRunning,
      left: engineLeftMs === null ? null : formatRemaining(engineLeftMs),
      measured: !!engineId && (renders?.history ?? []).some((entry) => entry.engine === engineId),
      failed: engineFailed ? `${engineFailed.job.viewName}: ${engineFailed.error}` : null,
      unavailable: engineUnavailable,
      settling: engineSettling,
      missingBefore: missingBeforeJobs.length,
      leftWithBefore: reportLeftMs === null ? null : formatRemaining(reportLeftMs),
      elsewhere: engineElsewhere.size,
    },
    logo: chosenLogo
      ? chosenLogo.source === 'uploaded'
        ? `Your logo, ${chosenLogo.name}`
        : `The ${chosenLogo.name} brand’s logo`
      : 'None: the slot stays empty',
    document: viaDocument
      ? {
          format: documentFormat.name,
          sources: documentFormat.sources.join(', '),
          formula: `${documentFormat.rule.formula} (${documentFormat.rule.basis}, ${documentFormat.rule.decimals} dp)`,
          scale: documentFormat.percentScale.name,
          images: documentFormat.recipes.map((recipe) => recipe.label),
          viewpoints: viaDocument.viewpoints.map((vp, index) => ({
            name: vp.name,
            figure: documentFigureLine(vp.printed, facts?.viewpoints[index]?.areas ?? null),
          })),
          toComplete: viaDocument.toComplete.length,
          gaps: [...documentFormat.gaps],
        }
      : null,
    brief: {
      blockId: briefBlock?.id ?? null,
      viewpoints: briefPoints.length,
      screenshots: briefViews.filter((view) => images[view.id]).length,
    },
    evidence,
    roadViewReady: input.scenePackage.ready,
    prescribedStands: standFileSummary(input.prescribedStands),
    officeFieldCount: FS1252_OFFICE_FIELDS.length,
    autoRun,
    landChecks: {
      include: includeLandChecks,
      pending: input.landChecks.unchecked ? 0 : landChecksPending(input.landChecks.states),
      rows: landRows,
    },
    ...(input.visualInventory
      ? { visualInventory: { status: input.visualInventory.status, error: input.visualInventory.error } }
      : {}),
    planned: pkg.planned,
    unprinted,
    ...(input.viewCapture
      ? {
          capture: {
            status: input.viewCapture.state.status,
            message: input.viewCapture.state.message,
            done: input.viewCapture.state.done,
            total: input.viewCapture.state.total,
          },
        }
      : {}),
    recipe: pkg.recipeChosen ? reportRecipe.name : null,
    inventory: {
      status: inventoryStatus,
      error: inventoryState.error,
      blockName: noteBlock?.name ?? null,
      candidates: candidates.map((candidate) => ({
        key: candidate.key,
        name: candidate.name,
        kind: candidate.kind,
        distanceMeters: candidate.distanceMeters,
        aims: !!candidate.arrow?.aims,
      })),
    },
  })
  const noteChoices: BlockNoteChoices = {
    // The package's choice, less views of interest planned for another block: they go in that block's note.
    excludedViews: excludedForBlock(pkg, blockNoteParts?.blockId ?? null),
    landStatus: includeLandChecks
      ? { rows: landRows.map(({ label, value, note }) => ({ label, value, note })), caveat: LAND_CHECK_CAVEAT }
      : null,
  }
  // What a preview depends on beyond the context: the text, the review, the office fields.
  const version = [
    input.sceneKey,
    // The run's and the capture's progress are not content: a preview waiting on them must not restart each tick.
    JSON.stringify({ ...context, autoRun: null, capture: null }),
    JSON.stringify(fs1252),
    JSON.stringify(blockNoteParts),
    JSON.stringify(scene.viaReview ?? null),
    JSON.stringify(scene.reportMetadata ?? null),
    Object.keys(images).length,
    documentFormat.id,
    // A render finishing changes the figures the file is drawn from.
    figureRenderer,
    engineJobs.map((job) => (renders?.figures[job.key] ? 1 : 0)).join(''),
    beforeJobs.map((job) => (renders?.figures[job.key] ? 1 : beforeFailed(job) ? 'x' : 0)).join(''),
    reportRecipe.id,
    overviewSheetStyle,
    chosenLogo ? `${chosenLogo.source}:${chosenLogo.name}` : 'no-logo',
  ].join('|')

  // The export context under another name: the report's build names its own `context`.
  const exportContext = context
  const build = async (kind: VisualsExport, format: string): Promise<BuiltFile> => {
    switch (kind) {
      case 'block-note':
        if (!blockNoteParts) throw new Error('Add a cutblock to write its note.')
        return input.buildBlockNote(format === 'pdf' ? 'pdf' : 'xlsx', blockNoteParts, noteChoices)
      case 'fs1252': {
        if (!result || !snapshot) throw new Error('Run the visibility assessment first.')
        const reviews = {
          ...(fs1252Review ? { [result.assessmentStationIndex]: fs1252Review } : {}),
          ...fs1252.reviews,
        }
        return buildFs1252({
          result,
          targets: snapshot.targets,
          viewpointName: snapshot.viewpoint.name,
          stationIndices: fs1252.selected,
          metadata: scene.reportMetadata ?? {},
          reviews,
          generatedAt: new Date().toISOString(),
        })
      }
      case 'analysis-sheet': {
        const { printedLogoRaster } = await import('@/branding/raster')
        // PGMaps' own figure prints its with-timber pixel figure: the view rendered before harvest, once a session.
        const view = resolved.view
        if (!view) throw new Error('No view in the package has a screenshot to draw the sheet from.')
        const timber = view && !view.image?.figure?.illustration ? ((await timberFor([view]))[view.id] ?? null) : null
        return analysisSheetFile(resolved, format === 'png' ? 'png' : 'pdf', await printedLogoRaster(branding), timber)
      }
      case 'via-report': {
        if (!reportViews.length) throw new Error('No view in the package has a class pass to draw the report from.')
        const names = reportContext([]).facts.viewpoints.map((vp) => vp.name)
        // The maps and before pictures are captured now, once per scene and set of views: Preview and Download
        // build the same file, and the captures move the page's maps for a few seconds each.
        const reportViewIds = figureViews.filter((view) => view.image?.figure)
        const captureKey = [
          input.sceneKey,
          reportViewIds.map((view) => `${view.id}:${figureImages[view.id]?.savedAt ?? ''}`).join(','),
          inventoryState.status,
          overviewSheetStyle,
          overviewSheetStyle === 'end-map-portrait'
            ? `${chosenLogo ? `${chosenLogo.source}:${chosenLogo.name}` : 'no-logo'}|${draftReport?.subtitle ?? ''}`
            : '',
          reportRecipe.obliquePitch ?? '',
          reportRecipe.parts.includes('ea-figure-pages') ? 'figure-page-maps' : '',
        ].join('|')
        let captured = reportCaptures.current?.key === captureKey ? reportCaptures.current.value : null
        if (!captured && input.captureReportImages) {
          // The portrait end map's title block takes the printed logo and the report's project line.
          const endMapLogo =
            overviewSheetStyle === 'end-map-portrait'
              ? await (await import('@/branding/raster')).printedLogoRaster(branding)
              : null
          captured = await input.captureReportImages({
            views: reportViewIds.map((view, index) => ({ id: view.id, name: names[index] ?? view.name })),
            overviewSheet: { style: overviewSheetStyle, logo: endMapLogo, project: draftReport?.subtitle ?? null },
            ...(reportRecipe.obliquePitch !== undefined ? { obliquePitch: reportRecipe.obliquePitch } : {}),
            ...(reportRecipe.parts.includes('ea-figure-pages') ? { figurePageMaps: true } : {}),
          })
          reportCaptures.current = { key: captureKey, value: captured }
          // What could not be captured prints as a placeholder in the report; the reason goes to the console.
          if (captured.notes.length) console.warn(`VIA report pictures:\n${captured.notes.join('\n')}`)
          // Development only: the VIA reference-library harness reads the captures whatever the recipe prints.
          if (import.meta.env.DEV)
            (window as unknown as { __viaReportCaptures?: unknown }).__viaReportCaptures = captured
        }
        // The with-timber pixel figure of each PGMaps view, from the before renders just taken (or kept from earlier).
        const timber = await measureTimber(reportViewIds, captured?.beforeRenders ?? null)
        // Each view's analysed figure in the report's own style, named as the report names its viewpoint. A report
        // with calculation pages composes them on an 11 × 17 page (`tabloidFigure`), which it prints on its own page.
        const style = reportRecipe.figureStyle ?? recipeFormat(reportRecipe).style ?? DEFAULT_FIGURE_STYLE
        const tabloid = reportRecipe.parts.includes('calculations') || reportRecipe.parts.includes('appendix-sheets')
        const figures: ReportFigure[] = await Promise.all(
          reportViewIds.map(async (view, index) => {
            // The report's own arithmetic, whatever the style: its figures print what its tables print.
            const image = await figureNoteImage(view.image!, style, {
              ...(timber[view.id] ? { timber: timber[view.id] } : {}),
              tabloid,
              rule: recipeFormat(reportRecipe).rule,
            })
            // Why the picture's pixel figure and the run's can part: the map drew far ground coarser.
            const terrainNote = terrainDetailNote(view.image?.figure?.terrainDetail ?? null)
            return {
              view: names[index] ?? view.name,
              caption: `${names[index] ?? view.name}: ${image.caption}${
                view.image?.figure?.illustration ? ` Drawn by ${view.image.figure.illustration.renderer}.` : ''
              }${terrainNote ? ` ${terrainNote}` : ''}`,
              dataUrl: image.dataUrl,
              width: image.width,
              height: image.height,
            }
          }),
        )
        // Each view's plain simulation (its framed capture, else its screenshot) for the "after" pictures, and its
        // before picture from the same renderer (`reportPairs.ts`): an engine's figures pair with that engine's
        // render before harvest, else both pictures are PGMaps', never PGMaps' before beside an engine's after.
        const after: Record<string, ReportFigure> = {}
        const pairedBefore: Record<string, BeforePicture> = {}
        // Where the landform lies in each render (the figure's crop rows), so a recipe that prints panoramas (26)
        // shows a wide band round it (`panoramaBand`, drawn by the report). A render takes the rows of the figure it
        // was framed with; a field photograph has its own framing and takes none.
        const rowsOf = (
          figure: SavedFigure | undefined,
          picture: { width: number; height: number },
        ): { y: number; height: number } | null => {
          const frame = figure?.frameImage
          const rows = figure?.landformRows ?? figure?.crop
          if (!frame || !rows || frame.width !== picture.width || frame.height !== picture.height) return null
          return rows
        }
        const withRows = <T extends ReportFigure>(picture: T, figure: SavedFigure | undefined): T => {
          const rows = rowsOf(figure, picture)
          return rows ? { ...picture, landformRows: rows } : picture
        }
        figureViews
          .filter((view) => view.image?.figure)
          .forEach((view, index) => {
            const name = names[index] ?? view.name
            const drawn = view.image!.figure!
            const own = input.images[view.id]
            const ownFigure = own?.figure
            const renderer = engineId ? (drawn.illustration?.renderer ?? null) : null
            // The engine's render before harvest: a before job's figure, or the view itself when saved before harvest.
            const beforeJob = engineId && renders ? renders.jobFor(view.id, engineId, 'before') : null
            const beforeFigure = !renderer
              ? null
              : beforeJob
                ? (renders?.figures[beforeJob.key] ?? null)
                : own?.viewpoint?.harvestPhase === 'before'
                  ? drawn
                  : null
            const failed = beforeJob
              ? renders?.jobs.find((entry) => entry.job.key === beforeJob.key && entry.status === 'error')
              : undefined
            const pair = pairPictures({
              name,
              after: simulationPicture(name, drawn, view.image!),
              afterRenderer: renderer,
              ownAfter: ownFigure && own ? simulationPicture(name, ownFigure, own) : null,
              before: captured?.images.before?.[name] ?? null,
              engineBefore: beforeFigure?.frameImage ?? null,
              engineBeforeMissing: failed
                ? `its render failed: ${failed.error ?? 'no reason given'}`
                : beforeJob
                  ? 'its render was not finished'
                  : 'the view has no pose to frame it on',
            })
            const afterFigure = pair.after.renderer === 'PGMaps' && renderer ? ownFigure : drawn
            after[name] = withRows(
              engineId && engineElsewhere.has(view.id)
                ? {
                    ...pair.after,
                    note: `Drawn by PGMaps, as the picture before it: ${roadRendererInfo(engineId).label} draws only where the road view stands, and this view was saved at another place.`,
                  }
                : pair.after,
              afterFigure,
            )
            if (pair.before)
              pairedBefore[name] =
                pair.before.source === 'render'
                  ? withRows(pair.before, pair.before.renderer === 'PGMaps' ? ownFigure : (beforeFigure ?? drawn))
                  : pair.before
          })
        const images = { ...(captured?.images ?? {}), after, before: pairedBefore }
        const context = reportContext(
          figures,
          images,
          reportViews.map((view) => {
            const id = figureViews.find((entry) => entry.name === view.name)?.id
            return id && timber[id] ? { ...view, timber: timber[id] } : view
          }),
        )
        // Development only: the pictures and facts the report was built from, for the reference comparison.
        if (import.meta.env.DEV)
          Object.assign(window as unknown as Record<string, unknown>, {
            __viaReportAfter: after,
            __viaReportBefore: images.before,
            __viaReportFacts: context.facts,
            __viaReportUnits: context.inventoryUnits ?? null,
            // Where the blocks are and what the land is like (`reportSetting`), as the page read it for this report.
            __viaReportSetting: context.setting ?? null,
          })
        // Every view of the package the report does not print is named at its end, with why.
        const report = withViewsLeftOut(
          assembleReport(reportRecipe, context),
          viewsLeftOut('via-report', exportContext),
        )
        const fileName = `forestry-via-report-${reportRecipe.id}`
        if (format === 'md') return textFile(reportMarkdown(report), `${fileName}.md`, 'text/markdown')
        const logo = chosenLogo
          ? {
              name: chosenLogo.name,
              dataUrl:
                chosenLogo.source === 'uploaded'
                  ? chosenLogo.logo.dataUrl
                  : logoDataUrl(chosenLogo.brand.profile.logos.primary),
            }
          : null
        return textFile(brandedHtml(reportHtml(report, logo), exportBrand(branding)), `${fileName}.html`, 'text/html')
      }
      case 'via-document': {
        if (!viaDocument || !facts)
          throw new Error('No view in the package has a class pass to fill the document from.')
        const name = `forestry-via-${documentFormat.id}`
        // Every view of the package the document does not hold is named in it, with why.
        const leftOut = viewsLeftOut('via-document', exportContext)
        return format === 'json'
          ? textFile(
              JSON.stringify({ facts, document: viaDocument, viewsLeftOut: leftOut }, null, 2),
              `${name}.json`,
              'application/json',
            )
          : textFile(
              documentMarkdown(viaDocument, facts, new Date()) + viewsLeftOutMarkdown(leftOut),
              `${name}.md`,
              'text/markdown',
            )
      }
      case 'field-brief': {
        if (!briefBlock) throw new Error('Add a cutblock to brief the crew on it.')
        const brief = buildFieldBrief({
          block: briefBlock,
          targets: scene.targets,
          viewpoint: scene.viewpoint,
          landform,
          result,
          stale,
          assessment,
          review: scene.viaReview ?? {},
          savedViews: briefViews,
          images,
          notes: [
            'A desk screening from terrain (AWS Open Data CDEM/SRTM) and drawn timber; confirm every viewpoint and figure in the field.',
          ],
          generatedAt: new Date(),
        })
        const jspdf = await import('jspdf')
        return {
          blob: new Blob([fieldBriefPdf(brief, jspdf)], { type: 'application/pdf' }),
          fileName: fieldBriefFileName(brief),
        }
      }
      case 'worksheet': {
        const file = input.worksheet()
        if (!file) throw new Error('Run the visibility assessment first.')
        return file
      }
      case 'evidence':
        return format === 'html'
          ? textFile(evidence.html(), 'forestry-via-evidence.html', 'text/html')
          : { blob: await evidence.pdf(), fileName: 'forestry-via-evidence.pdf' }
      case 'scene':
        return textFile(serializeScene(scene), 'forestry-visual-quality-scene.json', 'application/json')
      case 'views':
        return textFile(serializePreview(scene, [...savedViews]), 'forestry-driving-preview.json', 'application/json')
      case 'workspace':
        return textFile(evidence.workspaceJson(), 'forestry-assessment-workspace.json', 'application/json')
      case 'scene-package':
        return input.scenePackage.build()
      case 'stand-trees':
        if (!input.prescribedStands.length) throw new Error('No block has a stand prescription.')
        return format === 'geojson'
          ? textFile(standTreeGeoJson(input.prescribedStands), 'prescribed-trees.geojson', 'application/geo+json')
          : textFile(standTreeCsv(input.prescribedStands), 'prescribed-trees.csv', 'text/csv')
      case 'castor-constraint': {
        const constraint = castorVqoConstraint(scene, result)
        if (!constraint)
          throw new Error(castorConstraintProblem(scene, result) ?? 'Run the visibility assessment first.')
        return format === 'geojson'
          ? textFile(
              castorZoneGeoJson(constraint, new Date()),
              `castor-vqo-zone-${constraint.zoneId}.geojson`,
              'application/geo+json',
            )
          : textFile(castorConstraintCsv(constraint), 'constraints.csv', 'text/csv')
      }
    }
  }

  const onGoToStep = (id: ViaStepId) => {
    setOpen(false)
    // The sidebar owns its step tabs; choosing one is a click on it, as a reader would.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-via-step="${id}"]`)?.click())
  }

  const onAction = (action: ExportAction) => {
    if (action.id === 'load-inventory') {
      askedFor.current = noteBlock?.id ?? null
      if (noteBlock) onLoadInventory(noteBlock, { show: false })
      return
    }
    if (action.id === 'open-road-view') {
      setOpen(false)
      input.onOpenRoadView()
      return
    }
    if (action.id.startsWith('stand:')) {
      const candidate = candidates.find((entry) => `stand:${entry.key}` === action.id)
      if (!candidate || !noteBlock) return
      setOpen(false)
      input.onStandAt(candidate, noteBlock)
    }
  }

  const options: Partial<Record<VisualsExport, ReactNode>> = {
    'block-note': (
      <div className="grid gap-1.5">
        <CheckboxField
          label="Use each view's analysis-sheet figure instead of its screenshot"
          checked={noteFigures}
          onCheckedChange={input.onNoteFigures}
        />
        <CheckboxField
          label="Include the land status checks (treaty land, reserves, private land, parks…)"
          checked={includeLandChecks}
          onCheckedChange={setIncludeLandChecks}
        />
      </div>
    ),
    fs1252: (
      <Fs1252Options
        result={result}
        choice={fs1252}
        onChoice={setFs1252}
        currentStation={input.currentStation}
        viaReview={fs1252Review}
        metadata={scene.reportMetadata ?? {}}
        onMetadata={(reportMetadata) => setScene((current) => ({ ...current, reportMetadata }))}
      />
    ),
    ...(figureViews.some((view) => view.image)
      ? {
          'analysis-sheet': (
            <div className="grid gap-2">
              <AnalysisSheetOptions
                views={figureViews}
                resolved={resolved}
                onChange={(patch) => setFigureChoice((current) => ({ ...current, ...patch }))}
              />
              <LogoChooser />
            </div>
          ),
        }
      : {}),
    'via-report': (
      <div className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Structure of {reportRecipe.name} ({reportRecipe.sources.join(', ')})
          {pkg.recipeChosen ? ', the package’s recipe.' : ', which reads the VIA document’s format.'} The recipe, who
          draws the figures and the views are chosen under Package.
        </p>
        {reportRecipe.parts.includes('overview-sheet') && (
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Overview sheet</span>
            <StyledSelect
              aria-label="Overview sheet"
              className="w-full rounded-md border bg-background p-1"
              value={overviewSheetStyle}
              onChange={(event) => setOverviewSheetChoice(event.target.value as OverviewSheetStyle)}
            >
              {OVERVIEW_SHEET_STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.id === 'topo-landscape' ? 'Landscape topographic' : 'Portrait end map'} (11 × 17)
                </option>
              ))}
            </StyledSelect>
          </label>
        )}
        <LogoChooser />
      </div>
    ),
    // The package's recipe names the document's format, so the two agree; with none, the format is chosen here.
    'via-document': pkg.recipeChosen ? (
      <p className="text-xs text-muted-foreground">
        {documentFormat.name} ({documentFormat.sources.join(', ')}), the format of the package’s recipe,{' '}
        {reportRecipe.name}. Choose No recipe under Package to pick another format.
      </p>
    ) : (
      <StyledSelect
        aria-label="VIA document format"
        className="w-full rounded-md border bg-background p-1"
        value={documentFormat.id}
        onChange={(event) => setDocumentFormatId(event.target.value)}
      >
        {VIA_DOCUMENT_FORMATS.map((format) => (
          <option key={format.id} value={format.id}>
            {format.name} ({format.sources.join(', ')})
          </option>
        ))}
      </StyledSelect>
    ),
    ...(blocks.length > 1
      ? {
          'field-brief': (
            <StyledSelect
              aria-label="Block the brief is for"
              className="w-full rounded-md border bg-background p-1"
              value={briefBlock?.id ?? ''}
              onChange={(event) => input.onBriefBlockId(event.target.value)}
            >
              {blocks.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </StyledSelect>
          ),
        }
      : {}),
  }

  // The package's choices, shown once under its own entry in the dialog's list.
  const setPlannedInclude = (id: string, on: boolean) =>
    input.setViewsOfInterest?.((views) =>
      views.map((view) => {
        if (view.id !== id) return view
        // Absent reads as included (`isIncluded`), so including a view drops the flag rather than storing true.
        const next = { ...view }
        if (on) delete next.include
        else next.include = false
        return next
      }),
    )
  const setSavedInclude = (id: string, on: boolean) =>
    setExcludedViews((current) => {
      const next = new Set(current)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })
  const shownView = (id: string | null) => (id ? (images[id]?.dataUrl ?? null) : null)
  const packagePane = (
    <ExportPackagePane
      recipe={{
        value: pkg.recipeChosen ? reportRecipe.id : '',
        options: [
          { value: '', label: 'No recipe: the VIA document’s format chooses the report' },
          ...REPORT_RECIPES.map((recipe) => ({
            value: recipe.id,
            label: `${recipe.name} (${recipe.sources.join(', ')})`,
          })),
        ],
        onChange: (id) => setPackageRecipeId(id || null),
        note: pkg.recipeChosen
          ? `The VIA report takes its structure and the VIA document its format (${documentFormat.name}) from it.`
          : `The VIA document is ${documentFormat.name}; the report follows it, as ${reportRecipe.name}.`,
      }}
      renderer={{
        value: figureRenderer,
        options: ROAD_RENDERERS.map((entry) => ({
          value: entry.id,
          label:
            entry.id === 'pgmaps'
              ? 'PGMaps: as saved, ready now'
              : `${entry.label}: final quality, rendered in the background`,
        })),
        onChange: (id) => setFigureRenderer(id as RoadRendererId),
        unavailable: engineUnavailable,
      }}
      planned={pkg.planned.map((view) => ({ ...view, thumbnail: shownView(view.savedViewId) }))}
      saved={pkg.saved.map((view) => {
        const entry = contextViews.find((candidate) => candidate.view.id === view.id)
        return {
          ...view,
          detail: [
            entry?.here
              ? `${(entry.view.positionMeters / 1000).toFixed(2)} km along the road`
              : 'At an earlier viewpoint',
            entry?.view.harvestPhase === 'before' ? 'before harvest' : 'after harvest',
            entry?.screenshot ? (entry.classPass ? 'screenshot and class pass' : 'screenshot only') : 'no screenshot',
          ].join(' · '),
          thumbnail: shownView(view.id),
        }
      })}
      onPlannedInclude={input.setViewsOfInterest ? setPlannedInclude : undefined}
      onSavedInclude={setSavedInclude}
    />
  )

  /**
   * Captures views of interest for an output (`before`: with each one's before-harvest render), remembering each
   * failure under the key it failed with: a view not captured, and apart from it a before render not taken.
   */
  const captureViews = async (
    ids: readonly string[],
    options: { before?: boolean } = {},
  ): Promise<ViewCaptureReport> => {
    if (!input.viewCapture) throw new Error('Views of interest cannot be captured here.')
    const keys = Object.fromEntries(
      plannedViews.filter((view) => ids.includes(view.id)).map((view) => [view.id, viewCaptureKey(view)]),
    )
    const report = await input.viewCapture.capture(ids, options.before ? { before: true } : {})
    // Each view captured for its before render is marked tried under its key: when the render was kept, the view no
    // longer owes one and the mark is never read; when it was not, a preview does not capture it again in a loop.
    if (options.before)
      setBeforeFailures((current) => {
        const next = { ...current }
        for (const id of report.captured)
          if (keys[id]) next[id] = { key: keys[id], reason: 'no before-harvest render was kept from its capture' }
        for (const failure of report.failures)
          if (failure.warning === 'before' && keys[failure.viewId])
            next[failure.viewId] = { key: keys[failure.viewId], reason: failure.reason }
        return next
      })
    setCaptureFailures((current) => {
      const next = { ...current }
      for (const id of report.captured) delete next[id]
      // A view saved without its sheet still needs capturing (`no-figure`): its reason is kept so a preview does not
      // capture it again in a loop. One saved without its before render is a capture all the same.
      for (const failure of report.failures)
        if (failure.warning !== 'before' && keys[failure.viewId])
          next[failure.viewId] = { key: keys[failure.viewId], reason: failure.reason }
      // A cancelled capture leaves the rest untried: a preview does not start it again, a download does.
      if (report.cancelled)
        for (const id of ids)
          if (!report.captured.includes(id) && !next[id] && keys[id])
            next[id] = { key: keys[id], reason: 'Its capture was cancelled.' }
      return next
    })
    return report
  }

  const dialog = (
    <VisualsExportDialog
      open={open}
      initialOutput={initialOutput}
      initialPackage={input.opener.initialPackage}
      onOpenChange={setOpen}
      context={context}
      options={options}
      build={build}
      version={version}
      onGoToStep={onGoToStep}
      onAction={onAction}
      onRun={analysis.run}
      {...(input.visualInventory ? { onReadInventory: input.visualInventory.read } : {})}
      packagePane={packagePane}
      {...(input.viewCapture ? { onCapture: captureViews, onCancelCapture: input.viewCapture.cancel } : {})}
      onRender={(kind) => {
        // Only the VIA report prints before pictures: the other outputs never wait for them.
        const owed = kind === 'via-report' ? [...missingJobs, ...missingBeforeJobs] : missingJobs
        if (owed.length) renders?.enqueue(owed)
      }}
      portalContainer={input.portalContainer}
    />
  )
  return dialog
}
