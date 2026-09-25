import {
  Camera,
  Crosshair,
  Download,
  Eye,
  FileText,
  FileUp,
  Waypoints,
  Gauge,
  Landmark,
  Loader2,
  Magnet,
  MapPin,
  Mountain,
  Play,
  Radar,
  Route,
  Ruler,
  Sparkles,
  SquareDashed,
  Trash2,
  TreePine,
  Trees,
  X,
  ZoomIn,
} from 'lucide-react'
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  CollapsibleSection,
  InlineAlert,
  MapSidebarShell,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { StepMarker, StepSection, stepStatusText } from '@/components/ui/step-section'
import { TabBar } from '@/components/ui/tab-bar'
import { cn } from '@/lib/utils'

import { summariseUnits, type BcSensitivityUnit } from './bcVisualInventory'
import { ResultsPanel } from './ResultsPanel'
import { ROLE_COLORS, targetAreaHectares, type ForestryScene } from './scene'
import { MAX_DEM_ZOOM, MIN_DEM_ZOOM, demResolutionMeters } from './terrain'
import type { AnalysisSettings, HarvestSystem, TargetPolygon, TargetRole, Viewpoint } from './types'
import type { TreeStyle } from './treeLayer'
import type { AnalysisState, ReverseState } from './useVisibilityAnalysis'
import { findSceneLandform } from './sceneInput'
import { lineLengthMeters } from './visibility'
import {
  AdjustmentFields,
  FinalRatingFields,
  NumericalAssessmentSummary,
  OcularAssessmentFields,
  ViaHeadline,
  ViewpointTypeField,
} from './ViaPanels'
import { VIA_STEPS, type ViaAssessment, type ViaReview, type ViaStepId, type ViaStepStatus } from './via'
import {
  ALTERATION_BASIS_LABELS,
  ALTERATION_BASIS_NOTES,
  DEFAULT_VISUAL_QUALITY_THRESHOLDS,
  VAC_LABELS,
  VAC_RATINGS,
  VISUAL_QUALITY_CLASSES,
  visualQualityClass,
  type AlterationBasis,
  type VacRating,
  type VisualQualityClassId,
  type VisualQualityThresholds,
} from './vqo'

export type DrawMode = 'none' | 'spot' | 'corridor' | 'block' | 'landscape'

export type InventoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  units: BcSensitivityUnit[]
  error: string | null
  truncated: boolean
  /** Existing openings pulled in alongside the inventory. */
  harvestCount: number
  /** Surveyed stands, which the 3D timber is drawn from where they cover the ground. */
  stands: Array<{ speciesCode?: string | null }>
}

export type DriveState = {
  existingForest: boolean
  projectRecordedHeights: boolean
  growthMetersPerYear: number
  regenerationLagYears: number
  quality: 'auto' | 'detailed' | 'fast'
  active: boolean
  playing: boolean
  speedKmh: number
  positionMeters: number
  /** Block to face, or null to look along the road. */
  lookAtTargetId: string | null
  exaggeration: number
  /** Whether standing timber is drawn around the camera. */
  forest: boolean
  /** Height of the stand the trees are drawn at, in metres. */
  treeHeightMeters: number
  /** Width of the timber-free strip along the road, in metres. */
  roadClearWidthMeters: number
  /**
   * While facing a block, leave the drawn timber out of the line of sight to
   * it — a viewing gap, as a pullout or a gap in the roadside trees gives. A
   * drawing aid only; no number moves.
   */
  viewingGap: boolean
  /** How a stem is drawn: a camera-facing card, or real cone geometry. */
  harvestPhase: 'before' | 'after'
  showAnalysis: boolean
  treeStyle: TreeStyle
}

/** A titled block inside a step: a hairline above, and no rule of its own below. */
const SUBSECTION_CLASS = 'border-b-0 border-t border-border/60 px-4 py-3'

const VIA_CLASS_CODES = {
  preservation: 'P',
  retention: 'R',
  'partial-retention': 'PR',
  modification: 'M',
  'maximum-modification': 'MM',
} as const

/** Short tab labels; each tab's accessible name carries the handbook title. */
const STEP_TAB_LABELS: Record<ViaStepId, string> = {
  identify: 'Identify',
  visit: 'Visit',
  design: 'Simulate',
  assess: 'Assess',
  rate: 'Rate',
}

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const SELECT_CLASS =
  'h-7 max-w-full rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function Field({
  label,
  hint,
  children,
  group = false,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  group?: boolean
}) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{hint}</span>}
    </Tag>
  )
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string
  hint?: ReactNode
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          className={INPUT_CLASS}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)))
          }}
        />
        {suffix && <span className="shrink-0 text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </Field>
  )
}

/** An empty input clears the value rather than reading as zero. */
function OptionalNumber({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number | null | undefined
  min: number
  max: number
  suffix: string
  onChange: (value: number | null) => void
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <input
        type="number"
        className={`${SELECT_CLASS} w-16`}
        aria-label={label}
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(event) => {
          if (event.target.value === '') return onChange(null)
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)))
        }}
      />
      {suffix}
    </label>
  )
}

const HARVEST_SYSTEMS: ReadonlyArray<{ id: HarvestSystem; label: string }> = [
  { id: 'clearcut', label: 'Clearcut' },
  { id: 'retention', label: 'Dispersed retention' },
  { id: 'partial', label: 'Partial cut' },
]

/**
 * How a block is cut. Retention feeds Table 5; a partial cut is taken out of
 * the cleared-ground measurement and read from Table 6 instead (3.4.4).
 */
function BlockHarvestFields({
  target,
  onChange,
}: {
  target: TargetPolygon
  onChange: (patch: Partial<TargetPolygon>) => void
}) {
  const system = target.harvestSystem ?? 'clearcut'
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[18px]">
      <select
        className={SELECT_CLASS}
        value={system}
        onChange={(event) => onChange({ harvestSystem: event.target.value as HarvestSystem })}
        aria-label={`Harvest system for ${target.name}`}
      >
        {HARVEST_SYSTEMS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      {system === 'retention' && (
        <OptionalNumber
          label={`Stand retained in ${target.name}`}
          value={target.retentionPercent}
          min={0}
          max={100}
          suffix="% retained"
          onChange={(value) => onChange({ retentionPercent: value })}
        />
      )}
      {system === 'partial' && (
        <>
          <OptionalNumber
            label={`Volume removed from ${target.name}`}
            value={target.volumeRemovedPercent}
            min={0}
            max={100}
            suffix="% removed"
            onChange={(value) => onChange({ volumeRemovedPercent: value })}
          />
          <OptionalNumber
            label={`Residual tree height in ${target.name}`}
            value={target.residualHeightMeters}
            min={1}
            max={60}
            suffix="m left"
            onChange={(value) => onChange({ residualHeightMeters: value })}
          />
        </>
      )}
    </div>
  )
}

/**
 * The handbook's own record for the page: the reviewer's judgements, what they
 * add up to, and which step each part of the procedure has reached.
 */
export type ViaSidebarState = {
  assessment: ViaAssessment | null
  stale: boolean
  statuses: Record<ViaStepId, ViaStepStatus>
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  landformName: string | null
}

type SidebarProps = {
  via: ViaSidebarState
  scene: ForestryScene
  onViewpointChange: (viewpoint: Viewpoint) => void
  onSettingsChange: (settings: AnalysisSettings) => void
  onThresholdsChange: (thresholds: VisualQualityThresholds) => void
  onTargetChange: (targetId: string, patch: Partial<TargetPolygon>) => void
  onRemoveTarget: (targetId: string) => void
  onZoomToTarget: (targetId: string) => void

  drawMode: DrawMode
  onDrawModeChange: (mode: DrawMode) => void

  /** Replaces the drawn corridor with the road the basemap says it traces. */
  onSnapToRoad: () => void
  snapMessage: string | null

  analysis: AnalysisState
  onRun: () => void
  onCancel: () => void

  reverse: ReverseState
  onRunReverse: () => void
  /** Adopts one of the ranked roads as the corridor. */
  onUseRoad: (roadId: string) => void

  /** What the 3D stand is drawing, or why it is not. */
  forestStatus: import('./ForestOverlay').ForestStatus | null

  selectedTargetId: string | null
  onSelectTarget: (targetId: string) => void

  drive: DriveState
  onDriveChange: (patch: Partial<DriveState>) => void

  onImportFile: (file: File) => void
  importMessage: string | null

  inventory: InventoryState
  showInventory: boolean
  onToggleInventory: () => void
  onLookupInventory: () => void
  onAdoptUnit: (unitId: string) => void

  onLoadSample: () => void
  onLoadDriveSample: () => void
  /** A road from a GeoJSON or zipped shapefile, replacing the current one. */
  onImportRoad: (file: File) => void
  /** Makes a landform the one the run assesses against. */
  onActivateLandform: (targetId: string) => void
  /** A road-view preview is being prepared or is open; the sidebar shows step 2, where it is. */
  roadViewOpening?: boolean
  onClearScene: () => void
  onExport: () => void
  /** Downloads the run as a worksheet; null until there is a run to write up. */
  onExportReport: (() => void) | null
  /** Adds the on-screen roads inside the landform as FS1252 line (b) disturbance. */
  onAddRoadDisturbance: () => void

  /*
   * Panels the page owns, each placed in the step the handbook does that work
   * in. They render inside the shell's scroll container rather than beside
   * this component: the layout gives the sidebar one fixed-height slot with
   * `overflow-hidden`, so a sibling above a `h-full` shell pushes the shell's
   * lower half — and the bottom of its scroll port — off the screen for good.
   */
  /** Step 1: the road and the proposed cutblocks. */
  setup: ReactNode
  /** Step 1: nearby inventory units to adopt as the landform. */
  landformFinder?: ReactNode
  /** Step 2: preparing the eye-level view, and the views saved from it. */
  visit: ReactNode
  /** Step 2: a street-level field photo to line the road view up with. */
  fieldPhoto?: ReactNode
  /** Step 3: which landform the run measures, and its green area. */
  landformScope: ReactNode
  /** Step 3: the landform design review. */
  designReview: ReactNode
  /** Step 5: the FS1252 draft package. */
  report: ReactNode

  /** What the basemap said about the road and water, for the drive panel's clearing note. */
  roadClearing?: { roadClass: string | null; widthMeters: number; waterPolygons: number }
}

export function Sidebar({
  via,
  scene,
  onViewpointChange,
  onSettingsChange,
  onThresholdsChange,
  onTargetChange,
  onRemoveTarget,
  onZoomToTarget,
  drawMode,
  onDrawModeChange,
  onSnapToRoad,
  snapMessage,
  analysis,
  onRun,
  onCancel,
  reverse,
  onRunReverse,
  onUseRoad,
  forestStatus,
  selectedTargetId,
  onSelectTarget,
  drive,
  onDriveChange,
  onImportFile,
  importMessage,
  inventory,
  showInventory,
  onToggleInventory,
  onLookupInventory,
  onAdoptUnit,
  onLoadSample,
  onLoadDriveSample,
  onImportRoad,
  onActivateLandform,
  roadViewOpening = false,
  onClearScene,
  onExport,
  onExportReport,
  onAddRoadDisturbance,
  setup,
  landformFinder,
  visit,
  fieldPhoto,
  landformScope,
  designReview,
  report,
  roadClearing,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Which scale the threshold editor is showing. Purely a view concern — both
  // sets are always in the scene and both are always reported.
  const [thresholdBasis, setThresholdBasis] = useState<AlterationBasis>('perspective')
  const { viewpoint, targets, settings, thresholds } = scene

  const blocks = targets.filter((target) => target.role === 'block')
  const hasViewpoint = viewpoint.coordinates.length > 0
  const corridorLength =
    viewpoint.mode === 'corridor' && viewpoint.coordinates.length > 1 ? lineLengthMeters(viewpoint.coordinates) : 0
  const running = analysis.status === 'running'
  const reverseRunning = reverse.status === 'running'
  const result = analysis.result

  const driveStation =
    result && drive.active
      ? result.stations.reduce(
          (closest, station, index) =>
            Math.abs(station.distanceAlongMeters - drive.positionMeters) <
            Math.abs(result.stations[closest].distanceAlongMeters - drive.positionMeters)
              ? index
              : closest,
          0,
        )
      : null

  const driveTarget = blocks.find((block) => block.id === (drive.lookAtTargetId ?? selectedTargetId)) ?? blocks[0]
  const driveVisiblePercent =
    result && driveStation !== null
      ? (result.targets.find((target) => target.targetId === driveTarget?.id)?.stations[driveStation]?.visiblePercent ??
        null)
      : null

  const roadFileRef = useRef<HTMLInputElement>(null)
  const handleRoadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onImportRoad(file)
    event.target.value = ''
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onImportFile(file)
    event.target.value = ''
  }

  const inventorySummary = summariseUnits(inventory.units)
  // Unrated units stay on the map for context but would swamp a list.
  const ratedUnits = inventory.units

  // One step at a time, as tabs. It opens on the step to work on next; after
  // that the reviewer moves between them, and the headline's "Go to step"
  // switches for them. Every step stays mounted, so what is typed survives.
  const currentStep = VIA_STEPS.find((step) => via.statuses[step.id] === 'current')?.id ?? null
  const [activeStep, setActiveStep] = useState<ViaStepId>(() => currentStep ?? 'identify')
  const tabsRef = useRef<HTMLDivElement | null>(null)
  // Starting the road view from anywhere — the roadside demo in step 1, a
  // saved view — brings step 2 forward, where its progress and settings are.
  // Adjusted during render rather than in an effect, so it lands in one paint.
  const [seenRoadView, setSeenRoadView] = useState(roadViewOpening)
  if (roadViewOpening !== seenRoadView) {
    setSeenRoadView(roadViewOpening)
    if (roadViewOpening) setActiveStep('visit')
  }
  const goToStep = (id: ViaStepId) => {
    setActiveStep(id)
    // Back to the top of the step, tabs in view.
    window.requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const stepProps = (id: ViaStepId) => {
    const step = VIA_STEPS.find((entry) => entry.id === id)!
    return {
      step: step.number,
      title: step.title,
      reference: `Handbook ${step.section}`,
      status: via.statuses[id],
      collapsible: false,
    }
  }
  const stepPanelProps = (id: ViaStepId) => ({
    role: 'tabpanel' as const,
    id: `via-steps-panel-${id}`,
    'aria-labelledby': `via-steps-tab-${id}`,
    hidden: activeStep !== id,
    'data-via-panel': id,
  })
  const stepPurpose = (id: ViaStepId) => (
    <p className="px-4 pb-3 text-xs leading-5 text-muted-foreground">
      {VIA_STEPS.find((step) => step.id === id)!.purpose}
    </p>
  )

  const assessment = via.assessment
  const numericalReady = !!result?.quality?.numericalReady
  const summaries: Record<ViaStepId, string> = {
    identify: [
      blocks.length ? `${blocks.length} cutblock${blocks.length === 1 ? '' : 's'}` : 'No cutblocks',
      hasViewpoint
        ? viewpoint.mode === 'corridor'
          ? `${(corridorLength / 1000).toFixed(1)} km of road`
          : 'Spot viewpoint'
        : 'No viewpoint',
      assessment ? `${assessment.objective.code} objective` : 'No landform',
    ].join(' · '),
    visit:
      via.statuses.visit === 'done'
        ? 'Viewed from the road'
        : result
          ? 'Ready — look from the road'
          : 'Prepare the eye-level view',
    design: running
      ? 'Running…'
      : result
        ? `${numericalReady ? 'Run is current' : 'Provisional run'} · ${result.stations.length} station${result.stations.length === 1 ? '' : 's'}`
        : 'Not run yet',
    assess: assessment?.adjusted
      ? `Ocular ${assessment.ocular ? VIA_CLASS_CODES[assessment.ocular.classId] : '—'} · adjusted ${assessment.adjusted.percent.toFixed(1)}%`
      : assessment?.ocular
        ? `Ocular ${VIA_CLASS_CODES[assessment.ocular.classId]} · adjustments to rate`
        : 'Ocular assessment to record',
    rate: assessment?.rating
      ? `${assessment.rating.label}${assessment.rationaleWritten ? '' : ' · rationale to write'}`
      : 'Needs steps 3 and 4',
  }
  const progressPercent =
    analysis.progress && analysis.progress.total > 0
      ? Math.min(100, (analysis.progress.completed / analysis.progress.total) * 100)
      : 0

  // One polygon's row: name, area and source, zoom and remove, then its role,
  // objective and whichever of VAC or harvest system applies.
  const renderTarget = (target: TargetPolygon) => (
                  <li
                    key={target.id}
                    className={cn(
                      'rounded-md border p-2',
                      selectedTargetId === target.id ? 'border-primary/60 bg-muted/30' : 'border-border',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: ROLE_COLORS[target.role] }}
                      />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onSelectTarget(target.id)}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-xs font-medium text-foreground">{target.name}</span>
                          {target.role === 'landscape' && target.id === activeLandformId && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium leading-4 text-primary">
                              Active
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {targetAreaHectares(target).toLocaleString('en-CA', {
                            maximumFractionDigits: 1,
                          })}{' '}
                          ha · {target.source}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => onZoomToTarget(target.id)}
                        title="Zoom to polygon"
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                        onClick={() => onRemoveTarget(target.id)}
                        title="Remove polygon"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[18px]">
                      <select
                        className={SELECT_CLASS}
                        value={target.role}
                        onChange={(event) => onTargetChange(target.id, { role: event.target.value as TargetRole })}
                        aria-label={`Role for ${target.name}`}
                      >
                        <option value="block">Block</option>
                        <option value="landscape">Landform</option>
                      </select>
                      <select
                        className={SELECT_CLASS}
                        value={target.objectiveId}
                        onChange={(event) =>
                          onTargetChange(target.id, {
                            objectiveId: event.target.value as VisualQualityClassId,
                          })
                        }
                        aria-label={`Visual quality objective for ${target.name}`}
                      >
                        {VISUAL_QUALITY_CLASSES.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label} ≤ {thresholds.perspective[entry.id]}%
                          </option>
                        ))}
                      </select>
                      {/* Visual absorption capability rates a landform's capacity
                      to hide alteration, so it only means anything on one. */}
                      {target.role === 'landscape' && (
                        <select
                          className={SELECT_CLASS}
                          value={target.vac ?? ''}
                          onChange={(event) =>
                            onTargetChange(target.id, { vac: (event.target.value || null) as VacRating | null })
                          }
                          aria-label={`Visual absorption capability for ${target.name}`}
                        >
                          <option value="">VAC not rated</option>
                          {VAC_RATINGS.map((rating) => (
                            <option key={rating} value={rating}>
                              VAC {VAC_LABELS[rating]}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {target.role === 'block' && (
                      <BlockHarvestFields target={target} onChange={(patch) => onTargetChange(target.id, patch)} />
                    )}
                    {target.role === 'landscape' && target.id !== activeLandformId && (
                      <div className="mt-1.5 pl-[18px]">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => onActivateLandform(target.id)}
                        >
                          Assess against this landform
                        </Button>
                      </div>
                    )}
                  </li>
  )
  const landforms = targets.filter((target) => target.role === 'landscape')
  const activeLandformId = findSceneLandform(scene)?.id ?? null
  const openings = targets.filter((target) => target.role === 'harvested')

  return (
    <MapSidebarShell
      title="Visual quality"
      subtitle="Visual impact assessment, step by step"
      className="h-full w-full border-0 shadow-none md:border-r md:shadow-xl"
    >
      <ViaHeadline
        assessment={via.assessment}
        stale={via.stale}
        landformName={via.landformName}
        statuses={via.statuses}
        onOpenStep={goToStep}
        activeStep={activeStep}
      />

      {/* The five handbook steps as tabs, pinned while the step scrolls. */}
      <div ref={tabsRef} className="sticky top-0 z-10 border-b border-border bg-background/95 px-2 pt-1 backdrop-blur">
        <TabBar
          label="Assessment steps"
          variant="underline"
          stretch
          stacked
          idPrefix="via-steps"
          className="border-b-0"
          value={activeStep}
          onChange={setActiveStep}
          options={VIA_STEPS.map((step) => ({
            value: step.id,
            label: STEP_TAB_LABELS[step.id],
            ariaLabel: `Step ${step.number}: ${step.title} (${stepStatusText(via.statuses[step.id])})`,
            marker: <StepMarker step={step.number} status={via.statuses[step.id]} className="h-5 w-5 text-[11px]" />,
          }))}
          getTabProps={(option) => ({ 'data-via-step': option.value })}
        />
      </div>

      {/* Step 1 — 3.1: the proposal, its objective, and where it may be seen from. */}
      <div {...stepPanelProps('identify')}>
        <StepSection {...stepProps('identify')} summary={summaries.identify}>
          {stepPurpose('identify')}
          {/* Where to begin: a worked sample, the road-view demo, or a clean site. */}
          <div className="space-y-2 px-4 pb-4">
            <p className="text-xs font-medium text-foreground">Start from</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="touch:h-10" onClick={onLoadSample}>
                Tabor Mountain sample
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch:h-10"
                onClick={onLoadDriveSample}
                title="A hypothetical opening beside a 1.2 km route, opened straight into the road view. It has no landform: its block stands on the valley floor."
              >
                Roadside demo drive
              </Button>
              <Button type="button" variant="outline" size="sm" className="touch:h-10" onClick={onClearScene}>
                New site
              </Button>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".zip,.geojson,.json" className="hidden" onChange={handleFile} />
          <input ref={roadFileRef} type="file" accept=".zip,.geojson,.json" className="hidden" onChange={handleRoadFile} />

          <SidebarSection title="Road or viewpoint" icon={Route} headingLevel={3} className={SUBSECTION_CLASS}>
            {(drawMode === 'corridor' || drawMode === 'spot') && <div className="mb-3">{setup}</div>}
            <div className="mb-3 flex gap-1.5">
              <ToggleChip
                active={viewpoint.mode === 'spot'}
                onClick={() => onViewpointChange({ ...viewpoint, mode: 'spot', coordinates: [] })}
              >
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Spot
                </span>
              </ToggleChip>
              <ToggleChip
                active={viewpoint.mode === 'corridor'}
                onClick={() => onViewpointChange({ ...viewpoint, mode: 'corridor', coordinates: [] })}
              >
                <span className="inline-flex items-center gap-1">
                  <Route className="h-3 w-3" /> Length of road
                </span>
              </ToggleChip>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-3 w-full"
              onClick={() => onDrawModeChange(viewpoint.mode)}
            >
              <Crosshair className="h-4 w-4" />
              {viewpoint.mode === 'spot' ? 'Place the viewpoint' : 'Draw the road'}
            </Button>
            {viewpoint.mode === 'corridor' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-mt-2 mb-3 w-full text-[11px]"
                onClick={() => roadFileRef.current?.click()}
              >
                <FileUp className="h-3.5 w-3.5" />
                Import a road (GeoJSON or zipped shapefile)
              </Button>
            )}

            {hasViewpoint && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">
                  {viewpoint.mode === 'spot'
                    ? `${viewpoint.coordinates[0][1].toFixed(4)}, ${viewpoint.coordinates[0][0].toFixed(4)}`
                    : `${viewpoint.coordinates.length} points · ${(corridorLength / 1000).toFixed(2)} km`}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => onViewpointChange({ ...viewpoint, coordinates: [] })}
                  title="Clear the viewpoint"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {hasViewpoint && (
              <div className="mb-3">
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={onSnapToRoad}>
                  <Magnet className="h-4 w-4" />
                  Snap to the nearest road
                </Button>
                {snapMessage && <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{snapMessage}</p>}
              </div>
            )}
            {/* The same question the other way round: rather than picking a road and
              asking what it sees, take the block and find the roads that see it. */}
            <CollapsibleSection
              label="Which roads see the block"
              toggleProps={{ 'data-forestry-disclosure': 'reverse-viewshed' }}
              summary="Search the roads on screen"
              summaryWhenCollapsedOnly
              className="-mx-4 border-b-0 border-t border-border/60"
            >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={blocks.length === 0 || reverseRunning}
              onClick={onRunReverse}
            >
              {reverseRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              {reverseRunning ? 'Searching…' : 'Find them on screen'}
            </Button>
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
              Reads the roads the basemap is drawing right now, so pan and zoom to the ground you want tested first —
              roads off screen are not searched.
            </p>

            {reverseRunning && reverse.progress && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {reverse.progress.phase === 'terrain'
                  ? `Fetching terrain — ${reverse.progress.completed} of ${reverse.progress.total} tiles`
                  : 'Tracing sightlines…'}
              </p>
            )}

            {reverse.error && (
              <InlineAlert className="mt-2" tone="error">
                {reverse.error}
              </InlineAlert>
            )}

            {reverse.result && reverse.result.roads.length === 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No road on screen can see it
                {reverse.result.outOfRangeRoadCount > 0
                  ? `, and ${reverse.result.outOfRangeRoadCount} sat beyond the view distance.`
                  : '.'}
              </p>
            )}

            {reverse.result && reverse.result.roads.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {reverse.result.roads.slice(0, 8).map((road) => (
                  <li key={road.roadId}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-border p-2 text-left hover:bg-accent"
                      onClick={() => onUseRoad(road.roadId)}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium text-foreground">{road.name}</span>
                        <span
                          className={cn(
                            'shrink-0 text-xs font-semibold tabular-nums',
                            road.maxVisiblePercent > 0 ? 'text-rose-600' : 'text-muted-foreground',
                          )}
                        >
                          {road.maxVisiblePercent.toFixed(0)}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                        {road.seeingStationCount === 0
                          ? 'Hidden from every point on it'
                          : `Seen from ${(road.exposedLengthFraction * 100).toFixed(0)}% of its length · ` +
                            `nearest ${(road.nearestDistanceMeters / 1000).toFixed(1)} km`}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {reverse.result && reverse.result.roads.length > 0 && (
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                Percentages are the share of the block&rsquo;s ground area in view from one point. Pick a road to make
                it the corridor, then run the full assessment for the figures an objective is judged on.
              </p>
            )}
            </CollapsibleSection>
          </SidebarSection>

          <SidebarSection
            title="Cutblocks"
            icon={TreePine}
            headingLevel={3}
            className={SUBSECTION_CLASS}
            actions={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="h-3.5 w-3.5" />
                Import
              </Button>
            }
          >
            <div className="mb-3">
              <ToggleChip
                active={drawMode === 'block'}
                tone="rose"
                onClick={() => onDrawModeChange(drawMode === 'block' ? 'none' : 'block')}
              >
                <span className="inline-flex items-center gap-1">
                  <SquareDashed className="h-3 w-3" /> Draw block
                </span>
              </ToggleChip>
            </div>
            {drawMode === 'block' && <div className="mb-3">{setup}</div>}
            {importMessage && (
              <InlineAlert className="mb-3" tone={importMessage.startsWith('Could not') ? 'error' : 'info'}>
                {importMessage}
              </InlineAlert>
            )}
            {blocks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Trace a cutblock on the map, or import a zipped shapefile or GeoJSON of them.
              </p>
            ) : (
              <ul className="space-y-1.5">{blocks.map(renderTarget)}</ul>
            )}
          </SidebarSection>

          <SidebarSection
            title="Landform and objective"
            icon={Mountain}
            headingLevel={3}
            className={SUBSECTION_CLASS}
            subtitle="Handbook 3.1.1: the objective comes from the visual landscape inventory, and is judged against one landform."
          >
            <div className="mb-3">
              <ToggleChip
                active={drawMode === 'landscape'}
                tone="cyan"
                onClick={() => onDrawModeChange(drawMode === 'landscape' ? 'none' : 'landscape')}
              >
                <span className="inline-flex items-center gap-1">
                  <Mountain className="h-3 w-3" /> Draw landform
                </span>
              </ToggleChip>
            </div>
            {drawMode === 'landscape' && <div className="mb-3">{setup}</div>}
            {landforms.length === 0 ? (
              <p className="mb-3 text-xs text-muted-foreground">
                No landform yet. Suggest one from the terrain or the inventory below, or draw the hillside.
              </p>
            ) : (
              <ul className="mb-3 space-y-1.5">{landforms.map(renderTarget)}</ul>
            )}
            {openings.length > 0 && (
              <CollapsibleSection
                label="Existing openings"
                toggleProps={{ 'data-forestry-disclosure': 'existing-openings' }}
                summary={`${openings.length} on the map`}
                summaryWhenCollapsedOnly
                className="-mx-4 mb-3 border-b-0 border-y border-border/60"
              >
                <ul className="space-y-1.5">{openings.map(renderTarget)}</ul>
              </CollapsibleSection>
            )}
            {landformFinder && <div className="mb-3">{landformFinder}</div>}
            {/* The map-extent lookup also brings in existing harvest and forest
              cover, so it is more than a landform finder — but it is secondary
              to the two finders above, and folded. */}
            <CollapsibleSection
              label="Look up this map view in the BC inventory"
              toggleProps={{ 'data-forestry-disclosure': 'inventory-lookup' }}
              summary={inventory.units.length ? `${inventory.units.length} units` : 'Also brings in existing harvest'}
              summaryWhenCollapsedOnly
              className="-mx-4 border-b-0 border-t border-border/60"
            >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">Units in this map view</span>
              {inventory.units.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={onToggleInventory}
                >
                  {showInventory ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
            <div className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={inventory.status === 'loading'}
                onClick={onLookupInventory}
              >
                {inventory.status === 'loading' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Landmark className="h-4 w-4" />
                )}
                {inventory.status === 'loading' ? 'Loading inventory…' : 'Look up this view'}
              </Button>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Downloaded provincial sensitivity units, plus live harvest and forest-cover context. Boundaries are
                candidates: review the visible landform before adopting one.
              </p>

              {inventory.status === 'error' && (
                <InlineAlert className="mt-2" tone="error">
                  {inventory.error}
                </InlineAlert>
              )}

              {inventory.status === 'ready' &&
                (inventory.units.length === 0 ? (
                  <InlineAlert className="mt-2">
                    No inventory boundaries intersect this map extent. Use "Find a landform in the BC inventory" above to search nearby units,
                    or draw or import the visible hillside.
                  </InlineAlert>
                ) : (
                  <div className="mt-2">
                    <p className="text-[11px] text-muted-foreground">
                      {inventorySummary.total} units · {inventorySummary.withObjective} with an established objective ·{' '}
                      {inventorySummary.withVac} with a VAC rating
                      {inventory.truncated ? ' · more exist than were returned' : ''}
                      {inventory.harvestCount > 0 ? ` · ${inventory.harvestCount} existing openings` : ''}
                      {inventory.stands.length > 0 ? ` · ${inventory.stands.length} surveyed stands` : ''}
                    </p>
                    <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                      {ratedUnits.map((unit) => (
                        <li key={unit.id}>
                          <button
                            type="button"
                            onClick={() => onAdoptUnit(unit.id)}
                            className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                          >
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{
                                backgroundColor: unit.objectiveId
                                  ? visualQualityClass(unit.objectiveId).color
                                  : 'transparent',
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-foreground">{unit.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {unit.objectiveId
                                  ? visualQualityClass(unit.objectiveId).label
                                  : 'No established objective'}
                                {unit.vac ? ` · VAC ${VAC_LABELS[unit.vac]}` : ' · VAC not rated'}
                                {unit.vsc ? ` · VSC ${unit.vsc}` : ''}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {ratedUnits.length < inventory.units.length && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {inventory.units.length - ratedUnits.length} unrated units are on the map but not listed.
                      </p>
                    )}
                  </div>
                ))}
            </div>
            </CollapsibleSection>
          </SidebarSection>
        </StepSection>
      </div>

      {/* Step 2 — 3.2: travel the road as a visitor would and record the views. */}
      <div {...stepPanelProps('visit')}>
        <StepSection {...stepProps('visit')} summary={summaries.visit}>
          {stepPurpose('visit')}
          <div className="px-4 pb-4">{visit}</div>
          {fieldPhoto && (
            <SidebarSection title="Field photo" icon={Camera} headingLevel={3} className={SUBSECTION_CLASS}>
              {fieldPhoto}
            </SidebarSection>
          )}
          {/* Playback — play, speed, position — is on the road-view panel over
            the map. The sidebar keeps what that panel does not: where to look,
            what the analysis sees from here, and how the timber is drawn. */}
          {result && drive.active && (
            <SidebarSection title="Road view" icon={Route} headingLevel={3} className={SUBSECTION_CLASS}>
              <p className="mb-3 text-[11px] leading-4 text-muted-foreground">
                Play, speed, position and the way back to the map are on the road-view panel over the map.
              </p>
              {(
                <div className="space-y-3">
                  <Field label="Where to look">
                    <select
                      className={cn(SELECT_CLASS, 'w-full')}
                      value={drive.lookAtTargetId ?? ''}
                      onChange={(event) => onDriveChange({ lookAtTargetId: event.target.value || null })}
                      aria-label="Where to look"
                    >
                      <option value="">Along the road</option>
                      {blocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          Face {block.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {driveVisiblePercent !== null && (
                    <div className="rounded-md border border-border bg-muted/20 p-2">
                      <p className="text-[11px] text-muted-foreground">Ground visible at nearest station</p>
                      <p className="text-2xl font-bold tabular-nums text-foreground">
                        {driveVisiblePercent.toFixed(0)}
                        <span className="text-sm">%</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {driveTarget?.name}: share of cutblock ground visible in the analysis. This is not the share of
                        your screen, and illustrated trees do not change this number.
                      </p>
                    </div>
                  )}

                  {/* The block as a coloured polygon tells you where it is. The
                  block as the gap where the trees stop tells you whether you
                  can see it, which is the thing the objective is about. */}
                  <div className="rounded-md border border-border p-2">
                    <ToggleChip active={drive.forest} onClick={() => onDriveChange({ forest: !drive.forest })}>
                      <span className="inline-flex items-center gap-1">
                        <Trees className="h-3 w-3" /> Standing timber: {drive.forest ? 'on' : 'off'}
                      </span>
                    </ToggleChip>
                    {drive.forest ? (
                      <div className="mt-2">
                        <NumberField
                          label="Stand height"
                          value={drive.treeHeightMeters}
                          min={5}
                          max={60}
                          step={1}
                          suffix="m"
                          hint="Timber fills the view and the block and any existing opening take it off, so the cut reads as a gap. A drawn picture, not an inventory."
                          onChange={(value) => onDriveChange({ treeHeightMeters: value })}
                        />
                        <div className="mt-3">
                          <NumberField
                            label="Cleared width along the road"
                            value={drive.roadClearWidthMeters}
                            min={6}
                            max={400}
                            step={2}
                            suffix="m"
                            hint={`${
                              roadClearing?.roadClass
                                ? `Starts at ${roadClearing.widthMeters} m from the basemap's class for this road (${roadClearing.roadClass}). `
                                : ''
                            }${
                              roadClearing?.waterPolygons ? 'Mapped water is left open. ' : ''
                            }A 28 m tree standing 15 m away fills the sky, so from a narrow road you see timber and nothing else. Widen this to open the foreground. It changes only what is drawn; the percentages do not move.`}
                            onChange={(value) => onDriveChange({ roadClearWidthMeters: value })}
                          />
                        </div>

                        {/* Both are here to be compared: a card carrying a drawn
                        tree against real cone geometry, at the same stem count. */}
                        <div className="mt-3">
                          <Field
                            group
                            label="How a stem is drawn"
                            hint={
                              drive.treeStyle === 'hybrid'
                                ? 'Three fixed silhouette planes per foreground tree, unchanged as you approach. Distant instances represent canopy groups.'
                                : drive.treeStyle === 'billboard'
                                  ? 'Two fixed silhouette planes per foreground tree, with camera-facing canopy groups farther away.'
                                  : 'Real geometry with real normals. Lights correctly from any angle and is honest from above, at about fifteen times the triangles.'
                            }
                          >
                            <div className="flex flex-wrap gap-1.5">
                              <ToggleChip
                                active={drive.treeStyle === 'hybrid'}
                                onClick={() => onDriveChange({ treeStyle: 'hybrid' })}
                              >
                                Stable silhouettes
                              </ToggleChip>
                              <ToggleChip
                                active={drive.treeStyle === 'billboard'}
                                onClick={() => onDriveChange({ treeStyle: 'billboard' })}
                              >
                                Billboards
                              </ToggleChip>
                              <ToggleChip
                                active={drive.treeStyle === 'solid'}
                                onClick={() => onDriveChange({ treeStyle: 'solid' })}
                              >
                                Solid cones
                              </ToggleChip>
                            </div>
                          </Field>
                        </div>
                        {forestStatus?.error ? (
                          <InlineAlert className="mt-2" tone="error">
                            {forestStatus.error}
                          </InlineAlert>
                        ) : (
                          forestStatus !== null && (
                            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                              {forestStatus.treeCount.toLocaleString()} stems standing around the camera · Distant
                              instances represent canopy groups. Detail reduces with distance.
                              {(forestStatus.inventoryStandCount ?? inventory.stands.length) > 0
                                ? ` Species and height come from ${forestStatus.inventoryStandCount ?? inventory.stands.length} surveyed stands where they cover the ground, and a regional mix elsewhere.`
                                : ' Species and height are a regional mix — run the BC inventory lookup to draw what the province recorded here.'}
                            </p>
                          )
                        )}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                        Bare ground — the hillside as the terrain model has it.
                      </p>
                    )}
                  </div>

                  <p className="mt-3 text-[10px] text-muted-foreground">
                    Terrain is shown at true scale (1×). The road surface and forest are illustrative; changing them
                    does not change the assessment.
                  </p>
                </div>
              )}
            </SidebarSection>
          )}
          <div className="border-t border-border/60 px-4 py-3">
            <ViewpointTypeField
              result={result}
              review={via.review}
              speedKmh={drive.speedKmh}
              onChange={via.onReviewChange}
            />
          </div>
        </StepSection>
      </div>

      {/* Step 3 — 3.3: delineate the landform, review the design, simulate. */}
      <div {...stepPanelProps('design')}>
        <StepSection {...stepProps('design')} summary={summaries.design}>
          {stepPurpose('design')}
          <SidebarSection
            title="Run assumptions"
            icon={Mountain}
            headingLevel={3}
            className={SUBSECTION_CLASS}
            subtitle="Handbook 3.3.2: the proposal is measured against the landform it sits on."
          >
            {landformScope}
          </SidebarSection>
          <SidebarSection
            title="Simulation"
            icon={Sparkles}
            headingLevel={3}
            className={SUBSECTION_CLASS}
            subtitle="Handbook 3.3.4: terrain sightlines from each station on the road."
          >
            <div className="flex gap-1.5">
              <Button
                type="button"
                className="flex-1"
                size="sm"
                disabled={!hasViewpoint || blocks.length === 0 || running}
                onClick={onRun}
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {running ? 'Working…' : 'Run visibility'}
              </Button>
              {running && (
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                  Stop
                </Button>
              )}
            </div>

            {running && analysis.progress && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width] duration-150"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {analysis.progress.phase === 'terrain'
                    ? `Fetching terrain — ${analysis.progress.completed} of ${analysis.progress.total} tiles`
                    : `Tracing sightlines — ${progressPercent.toFixed(0)}%`}
                </p>
              </div>
            )}

            {!hasViewpoint && <p className="mt-2 text-[11px] text-muted-foreground">Place a viewpoint to run.</p>}
            {hasViewpoint && blocks.length === 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">Add at least one block to assess.</p>
            )}
            {analysis.error && (
              <InlineAlert className="mt-2" tone="error">
                {analysis.error}
              </InlineAlert>
            )}
            {/* Whether the run's numbers can be used, where the run was pressed
              rather than only in the package two steps on. */}
            {result && !running && (
              <InlineAlert className="mt-2" tone={numericalReady ? 'success' : 'warning'}>
                {numericalReady ? 'Scenario numerical fields available' : 'Provisional result — PDF numerical fields withheld'}
                {!numericalReady && result.quality?.warnings.length ? (
                  <span className="block">{result.quality.warnings[0]}</span>
                ) : null}
              </InlineAlert>
            )}

            {/* FS1252 line 2.3.2 (b): roads, landings and side cast outside the
            openings. Without these the alteration figure is a floor, and on
            steep ground a road can read as heavily as the block it serves. */}
            <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={onAddRoadDisturbance}>
              <Waypoints className="h-4 w-4" />
              Add on-screen roads as site disturbance
            </Button>
          </SidebarSection>
          <CollapsibleSection
            label="Simulation settings"
            toggleProps={{ 'data-forestry-disclosure': 'simulation-settings' }}
            summary={`${settings.observerHeightMeters} m eye · ${(settings.maxViewDistanceMeters / 1000).toFixed(1)} km range`}
            summaryWhenCollapsedOnly
            className="border-b-0 border-t border-border/60"
          >
            <div className="px-4 pb-4">
              <NumberField
                label="Eye height above the road"
                suffix="m"
                value={settings.observerHeightMeters}
                min={0}
                max={100}
                step={0.1}
                hint="1.6 m is a person standing; raise it for a loaded truck cab or a lookout."
                onChange={(value) => onSettingsChange({ ...settings, observerHeightMeters: value })}
              />
              {viewpoint.mode === 'corridor' && (
                <div className="mt-3">
                  <NumberField
                    label="Distance between viewing stations"
                    suffix="m"
                    value={settings.stationSpacingMeters}
                    min={20}
                    max={2000}
                    step={10}
                    hint="Closer stations catch short windows through the trees at the cost of run time."
                    onChange={(value) => onSettingsChange({ ...settings, stationSpacingMeters: value })}
                  />
                </div>
              )}
              <div className="mt-3">
                <Field
                  label="Terrain detail"
                  hint={`${demResolutionMeters(viewpoint.coordinates[0]?.[1] ?? 54, settings.demZoom).toFixed(
                    0,
                  )} m between elevation samples. Finer detail means many more tiles to fetch.`}
                >
                  <select
                    className={INPUT_CLASS}
                    value={settings.demZoom}
                    onChange={(event) => onSettingsChange({ ...settings, demZoom: Number(event.target.value) })}
                  >
                    {Array.from({ length: MAX_DEM_ZOOM - MIN_DEM_ZOOM + 1 }, (_, index) => {
                      const zoom = MIN_DEM_ZOOM + index
                      return (
                        <option key={zoom} value={zoom}>
                          Zoom {zoom} · {demResolutionMeters(viewpoint.coordinates[0]?.[1] ?? 54, zoom).toFixed(0)} m
                        </option>
                      )
                    })}
                  </select>
                </Field>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <NumberField
                    label="Max view distance"
                    suffix="km"
                    value={settings.maxViewDistanceMeters / 1000}
                    min={0.5}
                    max={40}
                    step={0.5}
                    onChange={(value) => onSettingsChange({ ...settings, maxViewDistanceMeters: value * 1000 })}
                  />
                  <NumberField
                    label="Target height"
                    suffix="m"
                    value={settings.targetOffsetMeters}
                    min={0}
                    max={60}
                    step={0.5}
                    onChange={(value) => onSettingsChange({ ...settings, targetOffsetMeters: value })}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <NumberField
                    label="Green-up age"
                    suffix="yr"
                    value={settings.greenUpAgeYears}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(value) => onSettingsChange({ ...settings, greenUpAgeYears: value })}
                  />
                  <NumberField
                    label="Screening crown closure"
                    suffix="%"
                    value={settings.minCrownClosurePercent}
                    min={0}
                    max={100}
                    step={5}
                    onChange={(value) => onSettingsChange({ ...settings, minCrownClosurePercent: value })}
                  />
                </div>
                <label className="mt-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5"
                    checked={settings.screeningEnabled}
                    onChange={(event) => onSettingsChange({ ...settings, screeningEnabled: event.target.checked })}
                  />
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    <span className="font-medium text-foreground">Screen with standing timber.</span> Adds VRI
                    rank-1&apos;s projected stand height to the ground along each sightline, so a block behind mature
                    timber reads as hidden. Openings and the proposal itself are treated as cleared. Full-landscape
                    coverage, and a slow query — it fetches every inventory polygon over the run&apos;s extent.
                  </span>
                </label>
                <div className="mt-3">
                  <NumberField
                    label="Sample points per polygon"
                    value={settings.sampleBudget}
                    min={100}
                    max={20000}
                    step={100}
                    hint="More points resolve the edges of a block and small openings on a large landform; the run warns when a proposal covers too few landform cells. The grid is coarsened automatically if a run would take too long."
                    onChange={(value) => onSettingsChange({ ...settings, sampleBudget: value })}
                  />
                </div>
              </div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Planning thresholds"
            toggleProps={{ 'data-forestry-disclosure': 'planning-thresholds' }}
            summary="Not the handbook’s Table 2"
            summaryWhenCollapsedOnly
            className="border-b-0 border-t border-border/60"
          >
            <div className="px-4 pb-4">
              <div className="mb-2 flex gap-1.5">
                {(['perspective', 'planimetric'] as AlterationBasis[]).map((basis) => (
                  <ToggleChip
                    key={basis}
                    active={thresholdBasis === basis}
                    tone={basis === 'perspective' ? 'sky' : 'amber'}
                    onClick={() => setThresholdBasis(basis)}
                  >
                    {ALTERATION_BASIS_LABELS[basis]}
                  </ToggleChip>
                ))}
              </div>
              <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
                {ALTERATION_BASIS_NOTES[thresholdBasis]} Defaults come from{' '}
                {thresholdBasis === 'perspective'
                  ? 'A Guide to Visual Quality Objectives (2013)'
                  : 'Procedures for Factoring Visual Resources into Timber Supply Analyses (1998), Table 3'}
                — edit them to match a district&apos;s own numbers.
              </p>
              <div className="space-y-1">
                {VISUAL_QUALITY_CLASSES.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={entry.description}>
                      {entry.label}
                    </span>
                    <input
                      type="number"
                      className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-right text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={thresholds[thresholdBasis][entry.id]}
                      min={0}
                      max={100}
                      step={0.5}
                      aria-label={`${entry.label} ${thresholdBasis} threshold`}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (!Number.isFinite(next)) return
                        onThresholdsChange({
                          ...thresholds,
                          [thresholdBasis]: {
                            ...thresholds[thresholdBasis],
                            [entry.id]: Math.max(0, Math.min(100, next)),
                          },
                        })
                      }}
                    />
                    <span className="w-3 shrink-0 text-[11px] text-muted-foreground">%</span>
                  </div>
                ))}
              </div>
              {thresholdBasis === 'planimetric' && (
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  Table 4 narrows these to one figure per visual absorption capability. Rate a landform&apos;s VAC in
                  the polygon list above and the results use that figure instead of the class maximum.
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => onThresholdsChange({ ...DEFAULT_VISUAL_QUALITY_THRESHOLDS })}
              >
                Reset to guidebook defaults
              </Button>
            </div>
          </CollapsibleSection>
          {result && (
            <SidebarSection title="Simulation results" icon={Gauge} headingLevel={3} className={SUBSECTION_CLASS}>
              <ResultsPanel
                result={result}
                targets={targets}
                thresholds={thresholds}
                selectedTargetId={selectedTargetId}
                onSelectTarget={onSelectTarget}
                drivePositionMeters={drive.active ? drive.positionMeters : null}
                onSeek={(distanceMeters) => onDriveChange({ active: true, positionMeters: distanceMeters })}
              />
            </SidebarSection>
          )}
          {/* Guidance for reading the design against the terrain: after the
            results it explains, and folded, since it is reading, not a control. */}
          <div className="border-t border-border/60 px-4 py-3">{designReview}</div>
        </StepSection>
      </div>

      {/* Step 4 — 3.4: the ocular class first, then the measured and adjusted figure. */}
      <div {...stepPanelProps('assess')}>
        <StepSection {...stepProps('assess')} summary={summaries.assess}>
          {stepPurpose('assess')}
          {assessment ? (
            <>
              <SidebarSection
                title="Ocular assessment"
                icon={Eye}
                headingLevel={3}
                className={SUBSECTION_CLASS}
                subtitle="Handbook 3.4.1 · Table 1"
              >
                <OcularAssessmentFields assessment={assessment} review={via.review} onChange={via.onReviewChange} />
              </SidebarSection>
              <SidebarSection
                title="Percent alteration"
                icon={Ruler}
                headingLevel={3}
                className={SUBSECTION_CLASS}
                subtitle="Handbook 3.4.2 · Table 2"
              >
                <NumericalAssessmentSummary assessment={assessment} result={result} />
              </SidebarSection>
              <SidebarSection
                title="Design adjustments"
                icon={Waypoints}
                headingLevel={3}
                className={SUBSECTION_CLASS}
                subtitle="Handbook 3.4.3 · Tables 3–5"
              >
                <AdjustmentFields assessment={assessment} review={via.review} onChange={via.onReviewChange} />
              </SidebarSection>
            </>
          ) : (
            <div className="px-4 pb-4">
              <InlineAlert>
                Set the landform in step 1 first — the assessment is made against its objective.
              </InlineAlert>
            </div>
          )}
        </StepSection>
      </div>

      {/* Step 5 — 3.5 and 4.0: the rating, why, and the package. */}
      <div {...stepPanelProps('rate')}>
        <StepSection {...stepProps('rate')} summary={summaries.rate}>
          {stepPurpose('rate')}
          {assessment && (
            <SidebarSection
              title="Final rating"
              icon={Gauge}
              headingLevel={3}
              className={SUBSECTION_CLASS}
              subtitle="Handbook 3.5 · Table 7"
            >
              <FinalRatingFields assessment={assessment} review={via.review} onChange={via.onReviewChange} />
            </SidebarSection>
          )}
          <SidebarSection
            title="Package"
            icon={FileText}
            headingLevel={3}
            className={SUBSECTION_CLASS}
            subtitle="Handbook 4.0: map, views, simulation, design analysis, and a summary per viewpoint."
          >
            {report}
            {/* Secondary to the FS1252 above: the worked figures, and the scene to reopen later. */}
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">Also download</p>
              <div className="flex flex-wrap gap-2">
                {onExportReport && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onExportReport}>
                    <FileText className="h-3.5 w-3.5" />
                    Download the worksheet
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onExport}>
                  <Download className="h-3.5 w-3.5" />
                  Export the scene (JSON)
                </Button>
              </div>
            </div>
          </SidebarSection>
        </StepSection>
      </div>
    </MapSidebarShell>
  )
}
