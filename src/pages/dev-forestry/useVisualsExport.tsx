import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import type { LabelStyleId } from '@/lib/mapSheet/callouts'
import { LABEL_STYLES } from '@/lib/mapSheet/callouts'

import type { BlockNoteParts } from './VisualsParagraphPanel'
import type { NoteImage, ViewpointPage } from './blockNote'
import { briefViewpoints, buildFieldBrief, fieldBriefFileName, fieldBriefPdf } from './fieldBrief'
import {
  AnalysisSheetOptions,
  analysisSheetFile,
  NO_FIGURE_CHOICE,
  resolveFigureChoice,
  type FigureChoice,
  type FigureView,
  type SavedFigure,
} from './FigureSheetPanel'
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
import { VisualsExportDialog, type BuiltFile } from './VisualsExportDialog'
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
  briefBlockId: string | null
  onBriefBlockId: (id: string) => void
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

  // Closed, the dialog costs the page nothing: this page re-renders several times a second while the
  // road view moves, and nothing below is needed until the dialog opens.
  if (!open) return null

  const figureViews: FigureView[] = [...otherViews, ...savedViews].map((view) => ({
    id: view.id,
    name: view.name,
    image: images[view.id],
  }))
  const resolved = resolveFigureChoice(figureChoice, figureViews, roadView)

  const landform = findSceneLandform(scene)
  const blocks = scene.targets.filter((target) => target.role === 'block')
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
    },
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
      case 'analysis-sheet':
        return analysisSheetFile(resolved, format === 'png' ? 'png' : 'pdf')
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
            <AnalysisSheetOptions
              views={figureViews}
              resolved={resolved}
              onChange={(patch) => setFigureChoice((current) => ({ ...current, ...patch }))}
            />
          ),
        }
      : {}),
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
      portalContainer={input.portalContainer}
    />
  )
  return dialog
}
