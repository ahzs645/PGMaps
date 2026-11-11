import { MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  FormField,
  NumberField as SharedNumberField,
  NullableNumberField,
  NativeSelect,
} from '@/components/ui/form-field'
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
import { useRef, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ListHeader, ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { TextButton } from '@/components/ui/text-button'
import { ToggleRow } from '@/components/ui/toggle-row'
import { formatMeasure, formatNumber, formatPercentValue } from '@/lib/format'
import { InfoTip } from '@/components/ui/info-tip'
import { Notification } from '@/components/ui/notification'
import { EVQO_COLORS, EVQO_NAMES, type EvqoCode } from './visualsNarrative'
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
import { SENSITIVITY_UNIT_COLORS } from './planMapStyle'
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
  /** Satellite imagery draped over the ground, as in a Google Earth screenshot. */
  imagery: boolean
  /** Draw proposed blocks solid white for a planning-note screenshot. */
  reportLook: boolean
  /** Drape the established VQO polygons over the ground, coloured by class. */
  showEvqo: boolean
  /** Drape the landform being assessed, and any ridge layers read for it, in the road view. */
  showLandform: boolean
  /** Stronger distance haze, so ridge layers separate as they do in real air. Display only. */
  haze: boolean
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

const SELECT_CLASS =
  'h-7 max-w-full rounded-md border border-border bg-background px-1.5 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

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
  return (
    <FormField
      label={label}
      hint={hint}
      group={group}
      contentClassName="block"
      labelClassName="mb-1 block text-2xs font-medium text-muted-foreground"
      descriptionClassName="text-3xs leading-4"
    >
      {children}
    </FormField>
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
    <SharedNumberField
      label={label}
      hint={hint}
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      step={step}
      suffix={suffix}
      clampOn="change"
      blankValue="zero"
      inputClassName={FORM_INPUT_CLASS}
      contentClassName="block"
      labelClassName="mb-1 block text-2xs font-medium text-muted-foreground"
      descriptionClassName="text-3xs leading-4"
      unitClassName="text-2xs"
    />
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
    <NullableNumberField
      label={label}
      aria-label={label}
      value={value ?? null}
      onValueChange={onChange}
      min={min}
      max={max}
      suffix={suffix}
      clampOn="change"
      hideLabel
      contentClassName="flex flex-row items-center gap-1 text-2xs text-muted-foreground"
      inputClassName={cn(FORM_INPUT_CLASS, 'w-16')}
      unitClassName="text-2xs"
    />
  )
}

/** "Which roads see the block" lists this many before *Show all*. */
const ROADS_SHOWN = 8

/** A row's fields when it is not selected: `ResultRowDetail`'s layout without its tint. */
function PlainRowDetail({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('pb-3 pl-8 pr-3 text-xs', className)}>{children}</div>
}

/** Colours a planner would fill a block with in a screenshot; the picker offers them first. */
const BLOCK_COLOR_PRESETS = ['#ffffff', '#facc15', '#f97316', '#d946ef', '#22d3ee', '#7c3aed', '#111827']

/**
 * A block's colour on the map, in the road view and in its screenshots: a
 * colour picker with screenshot presets, in step 2's road view beside the note
 * screenshot look. Unset, the block is drawn as cleared ground (white in the
 * note screenshot look); the (×) puts it back.
 */
function BlockColorSwatch({ target, onChange }: { target: TargetPolygon; onChange: (color: string | null) => void }) {
  const listId = `block-colours-${target.id}`
  return (
    <span className="relative mt-0.5 flex shrink-0 items-center">
      <label
        className="relative block h-3.5 w-3.5 cursor-pointer overflow-hidden rounded-sm border border-border"
        // Unset reads as "default" (cleared ground, or white in the screenshot look), not as a colour.
        style={
          target.displayColor
            ? { backgroundColor: target.displayColor }
            : {
                backgroundImage: 'repeating-linear-gradient(45deg, #e5e7eb 0 2px, #ffffff 2px 4px)',
                borderStyle: 'dashed',
              }
        }
        title={target.displayColor ? 'Block colour' : 'Default colour: choose one'}
      >
        <input
          type="color"
          aria-label={`Colour for ${target.name}`}
          list={listId}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={target.displayColor ?? '#ffffff'}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <datalist id={listId}>
          {BLOCK_COLOR_PRESETS.map((color) => (
            <option key={color} value={color} />
          ))}
        </datalist>
      </label>
      {target.displayColor && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-0.5 h-5 w-5 text-muted-foreground touch:h-9 touch:w-9"
          aria-label={`Reset colour of ${target.name}`}
          title="Back to the default colour"
          onClick={() => onChange(null)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </span>
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
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <NativeSelect
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
      </NativeSelect>
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
  /** A realistic planner's case: a block across Purden Lake from Hwy 16. */
  onLoadHighwaySample: () => void
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
  /** Step 1: inventory viewpoints and rec sites near the block. */
  viewpointFinder?: ReactNode
  /** Step 2, in the road view: jump to a spot the block is seen from. */
  roadViewJump?: ReactNode
  /** Step 2, in the road view: the existing forest and regrowth records the timber is drawn from. */
  roadViewForest?: ReactNode
  /** Step 5: the block's planning-note summary and Visuals paragraph. */
  visualsParagraph?: ReactNode

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
  onLoadHighwaySample,
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
  viewpointFinder,
  roadViewJump,
  roadViewForest,
  visualsParagraph,
  roadClearing,
}: SidebarProps) {
  // Which scale the threshold editor is showing. Purely a view concern — both
  // sets are always in the scene and both are always reported.
  const [thresholdBasis, setThresholdBasis] = useState<AlterationBasis>('perspective')
  // The roads list shows the first few; the rest are a click away, and the header says so.
  const [showAllRoads, setShowAllRoads] = useState(false)
  const { viewpoint, targets, settings, thresholds } = scene

  const blocks = targets.filter((target) => target.role === 'block')
  const hasViewpoint = viewpoint.coordinates.length > 0
  const corridorLength =
    viewpoint.mode === 'corridor' && viewpoint.coordinates.length > 1 ? lineLengthMeters(viewpoint.coordinates) : 0
  const running = analysis.status === 'running'
  const reverseRunning = reverse.status === 'running'
  const result = analysis.result

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
  // One line, not a paragraph: the step's title and summary already say where you are.
  const stepPurpose = (id: ViaStepId) => (
    <div className="px-4 pb-2 text-2xs text-muted-foreground">
      <InfoTip label="What this step is for" showLabel>
        {VIA_STEPS.find((step) => step.id === id)!.purpose}
      </InfoTip>
    </div>
  )

  const assessment = via.assessment
  const numericalReady = !!result?.quality?.numericalReady
  const summaries: Record<ViaStepId, string> = {
    identify: [
      blocks.length ? `${blocks.length} cutblock${blocks.length === 1 ? '' : 's'}` : 'No cutblocks',
      hasViewpoint
        ? viewpoint.mode === 'corridor'
          ? `${formatMeasure(corridorLength / 1000, 'km', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} of road`
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
      ? `Ocular ${assessment.ocular ? VIA_CLASS_CODES[assessment.ocular.classId] : '—'} · adjusted ${formatPercentValue(assessment.adjusted.percent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
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
  const renderTarget = (target: TargetPolygon) => {
    const selected = selectedTargetId === target.id
    // Fields under the row, lined up with its title; tinted with it while selected.
    const Detail = selected ? ResultRowDetail : PlainRowDetail
    return (
      <li key={target.id} className="overflow-hidden rounded-md border border-border">
        <div className="flex items-start">
          <ResultRow
            className="min-w-0 flex-1 px-2 py-2"
            selected={selected}
            onClick={() => onSelectTarget(target.id)}
            leading={
              // A block's chosen colour; the colour is chosen in step 2's road view.
              <span
                className="mt-1 block h-2.5 w-2.5 rounded-sm border border-border/60"
                style={{
                  backgroundColor: (target.role === 'block' && target.displayColor) || ROLE_COLORS[target.role],
                }}
              />
            }
            title={
              <span className="flex items-center gap-1.5 text-xs">
                <span className="min-w-0 truncate">{target.name}</span>
                {target.role === 'landscape' && target.id === activeLandformId && (
                  <Badge tone="info" pill className="shrink-0">
                    Active
                  </Badge>
                )}
              </span>
            }
            subtitle={
              <span className="text-2xs">
                {formatMeasure(targetAreaHectares(target), 'ha', { maximumFractionDigits: 1 })} · {target.source}
              </span>
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-1 h-7 w-7 shrink-0 text-muted-foreground touch:h-10 touch:w-10"
            onClick={() => onZoomToTarget(target.id)}
            aria-label={`Zoom to ${target.name}`}
            title="Zoom to polygon"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-1 mt-1 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive touch:h-10 touch:w-10"
            onClick={() => onRemoveTarget(target.id)}
            aria-label={`Remove ${target.name}`}
            title="Remove polygon"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Detail className="pl-7">
          <div className="flex flex-wrap items-center gap-1.5">
            <NativeSelect
              className={SELECT_CLASS}
              value={target.role}
              onChange={(event) => onTargetChange(target.id, { role: event.target.value as TargetRole })}
              aria-label={`Role for ${target.name}`}
            >
              <option value="block">Block</option>
              <option value="landscape">Landform</option>
            </NativeSelect>
            <NativeSelect
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
            </NativeSelect>
            {/* Visual absorption capability rates a landform's capacity
                      to hide alteration, so it only means anything on one. */}
            {target.role === 'landscape' && (
              <NativeSelect
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
              </NativeSelect>
            )}
          </div>
          {target.role === 'block' && (
            <BlockHarvestFields target={target} onChange={(patch) => onTargetChange(target.id, patch)} />
          )}
          {target.role === 'landscape' && target.id !== activeLandformId && (
            <div className="mt-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-2xs"
                onClick={() => onActivateLandform(target.id)}
              >
                Assess against this landform
              </Button>
            </div>
          )}
        </Detail>
      </li>
    )
  }
  const landforms = targets.filter((target) => target.role === 'landscape')
  const activeLandformId = findSceneLandform(scene)?.id ?? null
  const openings = targets.filter((target) => target.role === 'harvested')

  return (
    <MapSidebarShell
      title="Visual quality"
      subtitle="Visual impact assessment, step by step"
      icon={Eye}
      actions={<ForestryBackLink />}
      className={MAP_SIDEBAR_CLASS}
      density="compact"
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
            marker: <StepMarker step={step.number} status={via.statuses[step.id]} className="h-5 w-5 text-2xs" />,
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
                onClick={onLoadHighwaySample}
                title="A hypothetical block on Purden Lake's north face, across the water from Hwy 16, under BC's Retention and Partial Retention EVQO. The road, landform, viewpoints and arrows are real records."
              >
                Hwy 16 · Purden Lake
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

          <SidebarSection title="Road or viewpoint" icon={Route} headingLevel={3} className={SUBSECTION_CLASS}>
            {(drawMode === 'corridor' || drawMode === 'spot') && <div className="mb-3">{setup}</div>}
            <SegmentedControl
              className="mb-3"
              size="sm"
              label="Assess from"
              value={viewpoint.mode}
              options={[
                { value: 'spot', label: 'Spot', icon: MapPin },
                { value: 'corridor', label: 'Length of road', icon: Route },
              ]}
              onChange={(mode) => {
                if (mode !== viewpoint.mode) onViewpointChange({ ...viewpoint, mode, coordinates: [] })
              }}
            />

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
              <FileButton
                label="Road file"
                accept=".zip,.geojson,.json"
                variant="ghost"
                className="-mt-2 mb-3 w-full text-2xs"
                onFiles={([file]) => onImportRoad(file)}
              >
                <FileUp className="h-3.5 w-3.5" />
                Import a road (GeoJSON or zipped shapefile)
              </FileButton>
            )}

            {hasViewpoint && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">
                  {viewpoint.mode === 'spot'
                    ? `${formatMeasure(viewpoint.coordinates[0][1], null, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, ${formatMeasure(viewpoint.coordinates[0][0], null, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
                    : `${viewpoint.coordinates.length} points · ${formatMeasure(corridorLength / 1000, 'km', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground touch:h-10 touch:w-10"
                  onClick={() => onViewpointChange({ ...viewpoint, coordinates: [] })}
                  aria-label={viewpoint.mode === 'spot' ? 'Clear the viewpoint' : 'Clear the road'}
                  title="Clear the viewpoint"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {hasViewpoint && (
              <div className="mb-3">
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={onSnapToRoad}>
                  <Magnet className="h-4 w-4" />
                  Snap to the nearest road
                </Button>
                {snapMessage && <p className="mt-1 text-3xs leading-4 text-muted-foreground">{snapMessage}</p>}
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
              <p className="mt-1.5 text-3xs leading-4 text-muted-foreground">
                Reads the roads the basemap is drawing right now, so pan and zoom to the ground you want tested first —
                roads off screen are not searched.
              </p>

              {reverseRunning && reverse.progress && (
                <InlineAlert className="mt-2" loading>
                  {reverse.progress.phase === 'terrain'
                    ? `Fetching terrain — ${reverse.progress.completed} of ${reverse.progress.total} tiles`
                    : 'Tracing sightlines…'}
                </InlineAlert>
              )}

              {reverse.error && (
                <InlineAlert className="mt-2" tone="error">
                  {reverse.error}
                </InlineAlert>
              )}

              {reverse.result && reverse.result.roads.length === 0 && (
                <p className="mt-2 text-2xs text-muted-foreground">
                  No road on screen can see it
                  {reverse.result.outOfRangeRoadCount > 0
                    ? `, and ${reverse.result.outOfRangeRoadCount} sat beyond the view distance.`
                    : '.'}
                </p>
              )}

              {reverse.result && reverse.result.roads.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-md border border-border">
                  <ListHeader
                    count={reverse.result.roads.length}
                    noun={['road', 'roads']}
                    shown={showAllRoads ? undefined : Math.min(ROADS_SHOWN, reverse.result.roads.length)}
                    sticky={false}
                    className="px-2 py-1.5 text-2xs"
                    aside={
                      reverse.result.roads.length > ROADS_SHOWN && (
                        <TextButton className="text-2xs" onClick={() => setShowAllRoads((value) => !value)}>
                          {showAllRoads ? 'Show fewer' : 'Show all'}
                        </TextButton>
                      )
                    }
                  />
                  <ul className="divide-y divide-border" aria-label="Roads that see the block">
                    {(showAllRoads ? reverse.result.roads : reverse.result.roads.slice(0, ROADS_SHOWN)).map((road) => (
                      <li key={road.roadId}>
                        <ResultRow
                          className="px-2 py-2"
                          onClick={() => onUseRoad(road.roadId)}
                          title={<span className="text-xs">{road.name}</span>}
                          subtitle={
                            <span className="whitespace-normal text-3xs leading-4">
                              {road.seeingStationCount === 0
                                ? 'Hidden from every point on it'
                                : `Seen from ${formatPercentValue(road.exposedLengthFraction * 100, { maximumFractionDigits: 0 })} of its length · ` +
                                  `nearest ${formatMeasure(road.nearestDistanceMeters / 1000, 'km', { maximumFractionDigits: 1 })}`}
                            </span>
                          }
                          trailing={
                            <span
                              className={cn(
                                'text-xs',
                                road.maxVisiblePercent > 0 ? 'text-rose-600' : 'font-normal text-muted-foreground',
                              )}
                            >
                              {formatPercentValue(road.maxVisiblePercent, { maximumFractionDigits: 0 })}
                            </span>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {reverse.result && reverse.result.roads.length > 0 && (
                <p className="mt-2 text-3xs leading-4 text-muted-foreground">
                  Percentages are the share of the block&rsquo;s ground area in view from one point. Pick a road to make
                  it the corridor, then run the full assessment for the figures an objective is judged on.
                </p>
              )}
            </CollapsibleSection>
            {viewpointFinder}
          </SidebarSection>

          <SidebarSection
            title="Cutblocks"
            icon={TreePine}
            headingLevel={3}
            className={SUBSECTION_CLASS}
            actions={
              <FileButton
                label="Cutblock or landform file"
                accept=".zip,.geojson,.json"
                variant="ghost"
                className="h-7 px-2 text-2xs"
                onFiles={([file]) => onImportFile(file)}
              >
                <FileUp className="h-3.5 w-3.5" />
                Import
              </FileButton>
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
                    className="h-7 px-2 text-2xs"
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
                <p className="mt-2 text-2xs leading-4 text-muted-foreground">
                  Provincial sensitivity units read live from DataBC, plus harvest and forest-cover context. Boundaries
                  are candidates: review the visible landform before adopting one.
                </p>

                {inventory.status === 'error' && (
                  <InlineAlert className="mt-2" tone="error">
                    {inventory.error}
                  </InlineAlert>
                )}

                {inventory.status === 'ready' &&
                  (inventory.units.length === 0 ? (
                    <InlineAlert className="mt-2">
                      No inventory boundaries intersect this map extent. Use "Find a landform in the BC inventory" above
                      to search nearby units, or draw or import the visible hillside.
                    </InlineAlert>
                  ) : (
                    <div className="mt-2">
                      <p className="text-2xs text-muted-foreground">
                        {inventorySummary.total} units · {inventorySummary.withObjective} with an established objective
                        · {inventorySummary.withVac} with a VAC rating
                        {inventory.truncated ? ' · more exist than were returned' : ''}
                        {inventory.harvestCount > 0 ? ` · ${inventory.harvestCount} existing openings` : ''}
                        {inventory.stands.length > 0 ? ` · ${inventory.stands.length} surveyed stands` : ''}
                      </p>
                      <ul
                        className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border"
                        aria-label="Inventory units in this view"
                      >
                        {ratedUnits.map((unit) => (
                          <li key={unit.id}>
                            <ResultRow
                              className="px-2 py-1.5"
                              onClick={() => onAdoptUnit(unit.id)}
                              leading={
                                // The unit's colour on the map: its objective's, grey with none.
                                <span
                                  className="mt-1 block h-2.5 w-2.5 rounded-sm"
                                  style={{
                                    backgroundColor: unit.objectiveId
                                      ? visualQualityClass(unit.objectiveId).color
                                      : SENSITIVITY_UNIT_COLORS.unrated,
                                  }}
                                />
                              }
                              title={<span className="text-xs">{unit.name}</span>}
                              subtitle={
                                <span className="text-2xs">
                                  {unit.objectiveId
                                    ? visualQualityClass(unit.objectiveId).label
                                    : 'No established objective'}
                                  {unit.vac ? ` · VAC ${VAC_LABELS[unit.vac]}` : ' · VAC not rated'}
                                  {unit.vsc ? ` · VSC ${unit.vsc}` : ''}
                                </span>
                              }
                            />
                          </li>
                        ))}
                      </ul>
                      {ratedUnits.length < inventory.units.length && (
                        <p className="mt-1 text-3xs text-muted-foreground">
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
          {/* The map's bar plays, saves and exits; everything about how the view
            looks is here, once. */}
          {result && drive.active && (
            <SidebarSection title="Road view" icon={Route} headingLevel={3} className={SUBSECTION_CLASS}>
              <div className="space-y-3">
                <Field label="Where to look">
                  <NativeSelect
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
                  </NativeSelect>
                </Field>
                {roadViewJump}
                <div>
                  <p className="mb-1 flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                    Show
                    <InfoTip label="About these views">
                      Analysis points are the block ground the terrain lets the nearest station see. Satellite imagery
                      drapes the photo over the hills. EVQO polygons drape the established objectives over the ground,
                      coloured by class, as a planner's Google Earth layer does; each block's own colour is set under
                      Block colours below. Landform drapes the landform being assessed (light blue) and the other ridge
                      layers read for it (purple), so you can see which band of the mountain the block takes a share of.
                      Distance haze fades each ridge a little more than the one in front, as real air does; it changes
                      only the picture. Note screenshot look is how planning-note screenshots are taken in Google Earth:
                      imagery, the proposed blocks filled white, no drawn timber or points. Turn timber back on to see
                      what roadside trees would screen.
                    </InfoTip>
                  </p>
                  <div
                    className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
                    role="group"
                    aria-label="Show in the road view"
                  >
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      label="Analysis points"
                      active={drive.showAnalysis}
                      onClick={() => onDriveChange({ showAnalysis: !drive.showAnalysis })}
                    />
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      label="Satellite imagery"
                      active={drive.imagery}
                      onClick={() => onDriveChange({ imagery: !drive.imagery })}
                    />
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      label="Note screenshot look"
                      active={drive.reportLook}
                      onClick={() =>
                        onDriveChange(
                          drive.reportLook
                            ? { reportLook: false }
                            : {
                                reportLook: true,
                                harvestPhase: 'after',
                                showAnalysis: false,
                                imagery: true,
                                forest: false,
                              },
                        )
                      }
                    />
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      label="EVQO polygons"
                      active={drive.showEvqo}
                      onClick={() => onDriveChange({ showEvqo: !drive.showEvqo })}
                    />
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      label="Landform"
                      active={drive.showLandform}
                      onClick={() => onDriveChange({ showLandform: !drive.showLandform })}
                    />
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      label="Distance haze"
                      active={drive.haze}
                      onClick={() => onDriveChange({ haze: !drive.haze })}
                    />
                  </div>
                  {drive.showEvqo && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-muted-foreground">
                      {(Object.entries(EVQO_COLORS) as Array<[EvqoCode, string]>).map(([code, color]) => (
                        <span key={code} className="inline-flex items-center gap-1" title={EVQO_NAMES[code]}>
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                          {code}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {blocks.length > 0 && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                      Block colours
                      <InfoTip label="About block colours">
                        How each block is filled on the map, in the road view and in the screenshots taken from it:
                        white for a planning-note screenshot, or any colour to tell blocks apart. Unset, a block is
                        cleared ground (white in the note screenshot look). Display only: the run never changes. A saved
                        screenshot keeps the colour it was taken with.
                      </InfoTip>
                    </p>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Block colours">
                      {blocks.map((block) => (
                        <li key={block.id} className="flex items-center gap-1.5 text-2xs">
                          <BlockColorSwatch
                            target={block}
                            onChange={(displayColor) => onTargetChange(block.id, { displayColor })}
                          />
                          <span className="max-w-[9rem] truncate">{block.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* The block as the gap where the trees stop tells you whether
                  you can see it, which is what the objective is about. */}
                <div className="rounded-md border border-border p-2">
                  <div className="flex items-center gap-1.5">
                    <ToggleRow
                      layout="tile"
                      tone="primary"
                      icon={Trees}
                      label="Standing timber"
                      className="flex-1"
                      active={drive.forest}
                      onClick={() => onDriveChange({ forest: !drive.forest })}
                    />
                    <InfoTip label="About the drawn timber">
                      Timber fills the view, and the proposed and existing openings take it off, so a cut reads as a
                      gap. It is a drawing: stand height, cleared width and stem style change only the picture, never
                      the percentages. A 28 m tree 15 m away fills the sky, so widen the cleared strip to open the
                      foreground
                      {roadClearing?.roadClass
                        ? `; it started at ${roadClearing.widthMeters} m from the basemap's class for this road (${roadClearing.roadClass})`
                        : ''}
                      {roadClearing?.waterPolygons ? ', and mapped water is left open' : ''}.
                    </InfoTip>
                  </div>
                  {drive.forest && (
                    <div className="mt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <NumberField
                          label="Stand height"
                          value={drive.treeHeightMeters}
                          min={5}
                          max={60}
                          step={1}
                          suffix="m"
                          onChange={(value) => onDriveChange({ treeHeightMeters: value })}
                        />
                        <NumberField
                          label="Cleared width"
                          value={drive.roadClearWidthMeters}
                          min={6}
                          max={400}
                          step={2}
                          suffix="m"
                          onChange={(value) => onDriveChange({ roadClearWidthMeters: value })}
                        />
                      </div>
                      <SegmentedControl
                        size="sm"
                        label="How a stem is drawn"
                        value={drive.treeStyle}
                        onChange={(treeStyle) => onDriveChange({ treeStyle })}
                        options={[
                          {
                            value: 'hybrid',
                            label: 'Stable silhouettes',
                            title:
                              'Three fixed silhouette planes per near tree; distant instances stand for canopy groups',
                          },
                          { value: 'billboard', label: 'Billboards', title: 'Two fixed planes per near tree; lighter' },
                          {
                            value: 'solid',
                            label: 'Solid cones',
                            title: 'Real cone geometry: honest from any angle, about fifteen times the triangles',
                          },
                        ]}
                      />
                      {drive.lookAtTargetId && (
                        <ToggleRow
                          layout="tile"
                          tone="primary"
                          label="Viewing gap to the block"
                          title="Leaves the drawn timber out of the line of sight to the block, as a pullout or a gap in the roadside trees would"
                          active={drive.viewingGap}
                          onClick={() => onDriveChange({ viewingGap: !drive.viewingGap })}
                        />
                      )}
                      {forestStatus?.error ? (
                        <InlineAlert tone="error">{forestStatus.error}</InlineAlert>
                      ) : (
                        forestStatus !== null && (
                          <p className="text-3xs leading-4 text-muted-foreground">
                            {formatNumber(forestStatus.treeCount)} stems ·{' '}
                            {(forestStatus.inventoryStandCount ?? inventory.stands.length) > 0
                              ? `species and height from ${forestStatus.inventoryStandCount ?? inventory.stands.length} surveyed stands, a regional mix elsewhere`
                              : 'a regional mix; look up the BC inventory to draw what was recorded here'}
                          </p>
                        )
                      )}
                    </div>
                  )}
                </div>
                {roadViewForest}
                <label className="flex items-center justify-between gap-2 text-xs">
                  Display quality
                  <NativeSelect
                    aria-label="Display quality"
                    className={SELECT_CLASS}
                    value={drive.quality}
                    onChange={(event) => onDriveChange({ quality: event.target.value as DriveState['quality'] })}
                  >
                    <option value="auto">Default</option>
                    <option value="detailed">Detailed</option>
                    <option value="fast">Faster</option>
                  </NativeSelect>
                </label>
              </div>
            </SidebarSection>
          )}
          <div className="px-4 pb-4">{visit}</div>
          {fieldPhoto && (
            <SidebarSection title="Field photo" icon={Camera} headingLevel={3} className={SUBSECTION_CLASS}>
              {fieldPhoto}
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
            </div>

            {/* The run's progress joins the shared notification stack, with Stop beside it. */}
            {running && analysis.progress && (
              <Notification
                id="visual-quality-run"
                tone="loading"
                title="Visibility run"
                message={
                  analysis.progress.phase === 'terrain'
                    ? `Fetching terrain — ${analysis.progress.completed} of ${analysis.progress.total} tiles`
                    : 'Tracing sightlines'
                }
                progress={{
                  value: Math.round(progressPercent),
                  max: 100,
                  valueText: formatPercentValue(progressPercent, { maximumFractionDigits: 0 }),
                }}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                    Stop
                  </Button>
                }
              />
            )}

            {!hasViewpoint && <p className="mt-2 text-2xs text-muted-foreground">Place a viewpoint to run.</p>}
            {hasViewpoint && blocks.length === 0 && (
              <p className="mt-2 text-2xs text-muted-foreground">Add at least one block to assess.</p>
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
                {numericalReady
                  ? 'Scenario numerical fields available'
                  : 'Provisional result — PDF numerical fields withheld'}
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
            summary={`${formatMeasure(settings.observerHeightMeters, 'm')} eye · ${formatMeasure(settings.maxViewDistanceMeters / 1000, 'km', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} range`}
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
                  hint={`${formatMeasure(demResolutionMeters(viewpoint.coordinates[0]?.[1] ?? 54, settings.demZoom), 'm', { maximumFractionDigits: 0 })} between elevation samples. Finer detail means many more tiles to fetch.`}
                >
                  <NativeSelect
                    className={FORM_INPUT_CLASS}
                    value={settings.demZoom}
                    onChange={(event) => onSettingsChange({ ...settings, demZoom: Number(event.target.value) })}
                  >
                    {Array.from({ length: MAX_DEM_ZOOM - MIN_DEM_ZOOM + 1 }, (_, index) => {
                      const zoom = MIN_DEM_ZOOM + index
                      return (
                        <option key={zoom} value={zoom}>
                          Zoom {zoom} ·{' '}
                          {formatMeasure(demResolutionMeters(viewpoint.coordinates[0]?.[1] ?? 54, zoom), 'm', {
                            maximumFractionDigits: 0,
                          })}
                        </option>
                      )
                    })}
                  </NativeSelect>
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
                <CheckboxField
                  className="mt-3"
                  label={<span className="text-2xs font-medium">Screen with standing timber</span>}
                  description={
                    <span className="text-2xs leading-4">
                      Adds VRI rank-1&apos;s projected stand height to the ground along each sightline, so a block
                      behind mature timber reads as hidden. Openings and the proposal itself are treated as cleared.
                      Full-landscape coverage, and a slow query — it fetches every inventory polygon over the run&apos;s
                      extent.
                    </span>
                  }
                  checked={settings.screeningEnabled}
                  onCheckedChange={(screeningEnabled) => onSettingsChange({ ...settings, screeningEnabled })}
                />
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
              <SegmentedControl
                className="mb-2"
                size="sm"
                label="Threshold scale"
                value={thresholdBasis}
                onChange={setThresholdBasis}
                options={(['perspective', 'planimetric'] as AlterationBasis[]).map((basis) => ({
                  value: basis,
                  label: ALTERATION_BASIS_LABELS[basis],
                }))}
              />
              <p className="mb-2 text-2xs leading-4 text-muted-foreground">
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
                    {/* A cleared box keeps the threshold until a new number is typed. */}
                    <SharedNumberField
                      label={`${entry.label} ${thresholdBasis} threshold`}
                      aria-label={`${entry.label} ${thresholdBasis} threshold`}
                      hideLabel
                      value={thresholds[thresholdBasis][entry.id]}
                      min={0}
                      max={100}
                      step={0.5}
                      suffix="%"
                      clampOn="commit"
                      onValueChange={(next) =>
                        onThresholdsChange({
                          ...thresholds,
                          [thresholdBasis]: { ...thresholds[thresholdBasis], [entry.id]: next },
                        })
                      }
                      contentClassName="flex flex-row items-center gap-1 text-2xs text-muted-foreground"
                      inputClassName={cn(FORM_INPUT_CLASS, 'w-16 text-right')}
                      unitClassName="text-2xs"
                    />
                  </div>
                ))}
              </div>
              {thresholdBasis === 'planimetric' && (
                <p className="mt-2 text-3xs leading-4 text-muted-foreground">
                  Table 4 narrows these to one figure per visual absorption capability. Rate a landform&apos;s VAC in
                  the polygon list above and the results use that figure instead of the class maximum.
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-7 px-2 text-2xs text-muted-foreground"
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
          {visualsParagraph && (
            <SidebarSection
              title="Planning note · Visuals"
              icon={FileText}
              headingLevel={3}
              className={SUBSECTION_CLASS}
              subtitle="The block summary and the Visuals paragraph, drafted from the run."
            >
              {visualsParagraph}
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
              <p className="mb-2 text-2xs font-medium text-muted-foreground">Also download</p>
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
