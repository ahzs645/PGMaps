import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

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
import { briefViewpoints, buildFieldBrief, fieldBriefFileName, fieldBriefPdf } from './fieldBrief'
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
import { estimateRender, formatRemaining, type RenderEngineId, type RenderHistory } from './renderEstimate'
import { DEFAULT_OVERVIEW_SHEET_STYLE, OVERVIEW_SHEET_STYLES, type OverviewSheetStyle } from './reportMaps'
import { documentFacts } from './viaDocument/facts'
import { VIA_DOCUMENT_FORMATS, findDocumentFormat } from './viaDocument/formats'
import { documentMarkdown } from './viaDocument/markdown'
import { resolveViaDocument } from './viaDocument/resolve'
import { EVQO_CODE_FOR_CLASS } from './visualsNarrative'
import { buildReportContext, type ReportView } from './viaReport/context'
import { reportHtml, reportMarkdown } from './viaReport/html'
import type { ReportFigure } from './viaReport/model'
import type { ReportImages } from './viaReport/parts'
import { assembleReport, findReportRecipe, recipeFormat, REPORT_RECIPES } from './viaReport/recipes'
import { VisualsExportDialog, type BuiltFile } from './VisualsExportDialog'
import {
  castorConstraintCsv,
  castorConstraintProblem,
  castorVqoConstraint,
  castorZoneGeoJson,
} from './castorConstraint'
import {
  buildExportContext,
  type ContextView,
  type ExportAction,
  type ExportAutoRun,
  type VisualsExport,
} from './visualsExports'

export type ViewImage = NoteImage & {
  savedAt: number
  figure?: SavedFigure
  viewpoint?: Omit<ViewpointPage, 'simulation'>
}

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
  /** Saved views the reviewer left out, by id. */
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
  const openExport = useCallback((kind: VisualsExport = 'block-note') => {
    setInitialOutput(kind)
    setOpen(true)
  }, [])
  return { open, setOpen, initialOutput, openExport }
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
    jobFor: (viewId: string, engine: RenderEngineId) => RenderJob | null
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
  }) => Promise<{ images: ReportImages; notes: string[]; beforeRenders?: BeforeRenders }>
  /**
   * Before-harvest renders of saved views from their own framed poses, for the with-timber pixel figure
   * (`timberMeasureFor`); absent, the figure says no before render was taken.
   */
  captureBeforeRenders?: (views: ReadonlyArray<{ id: string; name: string }>) => Promise<BeforeRenders>
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
  // Who draws the figures of the sheet, the document and the report: PGMaps as saved, or another engine.
  const [figureRenderer, setFigureRenderer] = useState<RoadRendererId>('pgmaps')
  // The VIA report's recipe; until chosen, the one that reads the document's format.
  const [reportRecipeId, setReportRecipeId] = useState<string | null>(null)
  // The 11 × 17 overview sheet's style; until chosen, the recipe's (`overviewSheetStyle`), else landscape topographic.
  const [overviewSheetChoice, setOverviewSheetChoice] = useState<OverviewSheetStyle | null>(null)
  // The logo printed sheets and reports carry (the user's own, else the brand's), kept in IndexedDB.
  const branding = useBranding()
  // The block note's choices last as long as the page: views left out, land checks in or out.
  const [excludedViews, setExcludedViews] = useState<ReadonlySet<string>>(() => new Set())
  const [includeLandChecks, setIncludeLandChecks] = useState(true)

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

  // With another engine chosen, each saved view's figure is that engine's render when it is done.
  const renders = input.renders
  const engineId: RenderEngineId | null = figureRenderer === 'pgmaps' ? null : figureRenderer
  const engineJobs =
    engineId && renders
      ? [...otherViews, ...savedViews].flatMap((view) => {
          const job = images[view.id]?.figure ? renders.jobFor(view.id, engineId) : null
          return job ? [job] : []
        })
      : []
  const missingJobs = engineJobs.filter((job) => !renders?.figures[job.key])
  const figureImages: typeof images =
    engineId && renders
      ? Object.fromEntries(
          Object.entries(images).map(([id, image]) => {
            const job = engineJobs.find((entry) => entry.viewId === id)
            const drawn = job ? renders.figures[job.key] : undefined
            return [id, drawn ? { ...image, figure: drawn } : image]
          }),
        )
      : images
  const engineState = engineId && renders ? renders.jobs.filter((entry) => entry.job.engine === engineId) : []
  const engineRunning = engineState.some((entry) => entry.status === 'running' || entry.status === 'waiting')
  const engineFailed = engineState.find(
    (entry) => entry.status === 'error' && missingJobs.some((job) => job.key === entry.job.key),
  )
  const notStartedMs = missingJobs
    .filter((job) => !engineState.some((entry) => entry.job.key === job.key && entry.status !== 'error'))
    .reduce(
      (sum, job, index) =>
        sum + estimateRender(job.engine, job.work, renders?.history ?? [], index === 0 && !engineRunning).totalMs,
      0,
    )
  const engineLeftMs = engineRunning ? (renders?.leftMs ?? 0) + notStartedMs : missingJobs.length ? notStartedMs : null
  const engineBlocked = engineId
    ? roadRendererUnavailable(engineId, {
        url: roadRendererUrl(engineId, import.meta.env),
        webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      })
    : null
  // The road view's terrain reloads after a run (a report runs one when stale): the renders wait for it.
  const engineSettling = !!engineId && !engineBlocked && !!renders && !renders.ready && missingJobs.length > 0
  const engineUnavailable = engineId
    ? (engineBlocked ??
      (!renders
        ? 'background renders are not available here.'
        : engineSettling
          ? 'open the road view and let its terrain load: the engine draws from it.'
          : null))
    : null

  const figureViews: FigureView[] = [...otherViews, ...savedViews].map((view) => ({
    id: view.id,
    name: view.name,
    image: figureImages[view.id],
  }))
  const resolved = resolveFigureChoice(figureChoice, figureViews, roadView)

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
  const documentFormat =
    findDocumentFormat(documentFormatId) ??
    VIA_DOCUMENT_FORMATS.find((format) => format.style === roadView.styleId) ??
    VIA_DOCUMENT_FORMATS[0]
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
      })
    : null
  const viaDocument = facts ? resolveViaDocument(documentFormat, facts) : null

  // The report: its recipe, its views and a context assembled without figures for the dialog; the file adds them.
  const reportRecipe =
    findReportRecipe(reportRecipeId) ??
    REPORT_RECIPES.find((recipe) => recipe.format === documentFormat.id) ??
    REPORT_RECIPES[0]
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
  const briefViews = [
    ...savedViews.map((view) => ({ ...view, onThisRoad: true })),
    ...otherViews.map((view) => ({ ...view, onThisRoad: false })),
  ]
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
    inReport: !excludedViews.has(view.id),
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
          viewpoints: viaDocument.viewpoints.map((vp) => ({
            name: vp.name,
            figure: vp.printed ? `${vp.printed.percent}% · ${vp.printed.term}` : 'No class pass',
          })),
          toComplete: viaDocument.toComplete.length,
          gaps: [...documentFormat.gaps],
        }
      : null,
    brief: { blockId: briefBlock?.id ?? null, viewpoints: briefPoints.length },
    evidence,
    roadViewReady: input.scenePackage.ready,
    officeFieldCount: FS1252_OFFICE_FIELDS.length,
    autoRun,
    landChecks: {
      include: includeLandChecks,
      pending: input.landChecks.unchecked ? 0 : landChecksPending(input.landChecks.states),
      rows: landRows,
    },
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
    excludedViews,
    landStatus: includeLandChecks
      ? { rows: landRows.map(({ label, value, note }) => ({ label, value, note })), caveat: LAND_CHECK_CAVEAT }
      : null,
  }
  // What a preview depends on beyond the context: the text, the review, the office fields.
  const version = [
    input.sceneKey,
    // The run's progress is not content: a preview waiting on the run must not restart each tick.
    JSON.stringify({ ...context, autoRun: null }),
    JSON.stringify(fs1252),
    JSON.stringify(blockNoteParts),
    JSON.stringify(scene.viaReview ?? null),
    JSON.stringify(scene.reportMetadata ?? null),
    Object.keys(images).length,
    documentFormat.id,
    // A render finishing changes the figures the file is drawn from.
    figureRenderer,
    engineJobs.map((job) => (renders?.figures[job.key] ? 1 : 0)).join(''),
    reportRecipe.id,
    overviewSheetStyle,
    chosenLogo ? `${chosenLogo.source}:${chosenLogo.name}` : 'no-logo',
  ].join('|')

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
        const timber = view && !view.image?.figure?.illustration ? ((await timberFor([view]))[view.id] ?? null) : null
        return analysisSheetFile(resolved, format === 'png' ? 'png' : 'pdf', await printedLogoRaster(branding), timber)
      }
      case 'via-report': {
        if (!reportViews.length) throw new Error('Save a viewpoint in the road view first.')
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
        const tabloid = reportRecipe.parts.includes('calculations')
        const figures: ReportFigure[] = await Promise.all(
          reportViewIds.map(async (view, index) => {
            const image = await figureNoteImage(view.image!, style, {
              ...(timber[view.id] ? { timber: timber[view.id] } : {}),
              tabloid,
            })
            return {
              view: names[index] ?? view.name,
              caption: `${names[index] ?? view.name}: ${image.caption}${
                view.image?.figure?.illustration ? ` Drawn by ${view.image.figure.illustration.renderer}.` : ''
              }`,
              dataUrl: image.dataUrl,
              width: image.width,
              height: image.height,
            }
          }),
        )
        // Each view's plain simulation (its framed capture, else its screenshot) for the "after" pictures.
        const after: Record<string, ReportFigure> = Object.fromEntries(
          figureViews
            .filter((view) => view.image?.figure)
            .map((view, index) => {
              const picture = view.image!.figure!.frameImage ?? view.image!
              const name = names[index] ?? view.name
              return [
                name,
                {
                  view: name,
                  caption: `${name}: simulation`,
                  dataUrl: picture.dataUrl,
                  width: picture.width,
                  height: picture.height,
                  // Where each block lies in the picture: the callouts' anchors, which are in this picture's pixels.
                  marks: [
                    ...view.image!.figure!.callouts.filter((c) => !c.secondary),
                    ...(view.image!.figure!.hidden ?? []),
                  ]
                    .filter((c) => c.anchor[0] >= 0 && c.anchor[1] >= 0)
                    .map((c) => ({
                      x: c.anchor[0] / picture.width,
                      y: c.anchor[1] / picture.height,
                      label: c.title,
                      status: c.status,
                    }))
                    .filter((m) => m.x <= 1 && m.y <= 1),
                },
              ]
            }),
        )
        const images = { ...(captured?.images ?? {}), after }
        // Where the landform lies in each render (the figure's crop rows), so a recipe that prints panoramas (26)
        // shows a wide band round it (`panoramaBand`, drawn by the report). Before renders share the view's frame;
        // a field photograph has its own framing and takes none.
        {
          // The after pictures are keyed by the report's names, the before pictures by the views' own.
          const viewsByName = new Map(
            figureViews.flatMap((view, index) => [
              [view.name, view],
              [names[index] ?? view.name, view],
            ]),
          )
          const rowsFor = (name: string, picture: { width: number; height: number }) => {
            const figure = viewsByName.get(name)?.image?.figure
            const frame = figure?.frameImage
            const rows = figure?.landformRows ?? figure?.crop
            if (!frame || !rows || frame.width !== picture.width || frame.height !== picture.height) return null
            return rows
          }
          for (const [name, picture] of Object.entries(after)) {
            const rows = rowsFor(name, picture)
            if (rows) after[name] = { ...picture, landformRows: rows }
          }
          const before = { ...(images.before ?? {}) }
          for (const [name, picture] of Object.entries(before)) {
            const rows = picture.source === 'render' ? rowsFor(name, picture) : null
            if (rows) before[name] = { ...picture, landformRows: rows }
          }
          images.before = before
        }
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
          })
        const report = assembleReport(reportRecipe, context)
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
        if (!viaDocument || !facts) throw new Error('Save a viewpoint in the road view first.')
        const name = `forestry-via-${documentFormat.id}`
        return format === 'json'
          ? textFile(JSON.stringify({ facts, document: viaDocument }, null, 2), `${name}.json`, 'application/json')
          : textFile(documentMarkdown(viaDocument, facts, new Date()), `${name}.md`, 'text/markdown')
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

  const noteViews = contextViews.filter((entry) => entry.screenshot)
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
        {noteViews.length > 0 && (
          <fieldset className="grid gap-1 pt-1">
            <legend className="pb-1 text-2xs text-muted-foreground">Views in the report</legend>
            {noteViews.map(({ view }) => (
              <CheckboxField
                key={view.id}
                label={view.name}
                checked={!excludedViews.has(view.id)}
                onCheckedChange={(on) =>
                  setExcludedViews((current) => {
                    const next = new Set(current)
                    if (on) next.delete(view.id)
                    else next.add(view.id)
                    return next
                  })
                }
              />
            ))}
          </fieldset>
        )}
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
        <StyledSelect
          aria-label="VIA report structure"
          className="w-full rounded-md border bg-background p-1"
          value={reportRecipe.id}
          onChange={(event) => setReportRecipeId(event.target.value)}
        >
          {REPORT_RECIPES.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name} ({recipe.sources.join(', ')})
            </option>
          ))}
        </StyledSelect>
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
    'via-document': (
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

  const rendererSelect = (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">Figures drawn by</span>
      <StyledSelect
        aria-label="Figures drawn by"
        className="w-full rounded-md border bg-background p-1"
        value={figureRenderer}
        onChange={(event) => setFigureRenderer(event.target.value as RoadRendererId)}
      >
        {ROAD_RENDERERS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.id === 'pgmaps'
              ? 'PGMaps: as saved, ready now'
              : `${entry.label}: final quality, rendered in the background`}
          </option>
        ))}
      </StyledSelect>
    </label>
  )
  for (const kind of ['analysis-sheet', 'via-document', 'via-report'] as const)
    if (options[kind] || kind !== 'analysis-sheet')
      options[kind] = (
        <div className="grid gap-2">
          {rendererSelect}
          {options[kind]}
        </div>
      )

  const dialog = (
    <VisualsExportDialog
      open={open}
      initialOutput={initialOutput}
      onOpenChange={setOpen}
      context={context}
      options={options}
      build={build}
      version={version}
      onGoToStep={onGoToStep}
      onAction={onAction}
      onRun={analysis.run}
      onRender={() => {
        if (missingJobs.length) renders?.enqueue(missingJobs)
      }}
      portalContainer={input.portalContainer}
    />
  )
  return dialog
}
