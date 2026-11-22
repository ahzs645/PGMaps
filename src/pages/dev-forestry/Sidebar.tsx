import { MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import {
  CheckboxField,
  FORM_INPUT_CLASS,
  NumberField as SharedNumberField,
  NullableNumberField,
  StyledSelect,
} from '@/components/ui/form-field'
import {
  Crosshair,
  Download,
  FileText,
  FileUp,
  History,
  Waypoints,
  Landmark,
  Loader2,
  Magnet,
  MapPin,
  Mountain,
  Play,
  Radar,
  Route,
  Trash2,
  Trees,
  X,
  ZoomIn,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColorField } from '@/components/ui/color-field'
import { FileButton } from '@/components/ui/file-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ListHeader, ResultRow } from '@/components/ui/result-list'
import { ExternalLink, TextButton } from '@/components/ui/text-button'
import { formatMeasure, formatNumber, formatPercentValue } from '@/lib/format'
import { HoverTip, InfoTip } from '@/components/ui/info-tip'
import { Notification } from '@/components/ui/notification'
import { BC_DESIGN_HANDBOOK } from './LandformDesignPanel'
import { insetBox } from '@/components/ui/inset-box'
import { InlineAlert, MapSidebarShell } from '@/components/ui/map-panels'
import { Projectable } from '@/components/ui/movable-content'
import { ToolSection, ToolSubsection } from '@/components/ui/tool-section'
import { StepMarker, stepStatusText } from '@/components/ui/step-section'
import { TabBar } from '@/components/ui/tab-bar'
import { cn } from '@/lib/utils'

import { summariseUnits, type BcSensitivityUnit } from './bcVisualInventory'
import { ResultsPanel } from './ResultsPanel'
import { SubLandformFields } from './ReviewRecordFields'
import { ROLE_COLORS, targetAreaHectares, type ForestryScene } from './scene'
import type { HarvestSystem, TargetPolygon, TargetRole, Viewpoint } from './types'
import type { TreeLook, TreeStyle } from './treeLayer'
import type { AnalysisState, ReverseState } from './useVisibilityAnalysis'
import { findSceneLandform } from './sceneInput'
import { START_SCENARIOS, startScenarioContents, type StartScenarioId } from './scenarioSummary'
import { lineLengthMeters } from './visibility'
import { SENSITIVITY_UNIT_COLORS, TREE_FREE_COLOR } from './planMapStyle'
import { VIEWPOINT_CLEARING, type TreeFreeArea, type ViewpointClearingSetting } from './treeFreeAreas'
import { polygonAreaMeters } from './visibility'
import {
  AdjustmentFields,
  NumericalAssessmentSummary,
  OcularAssessmentFields,
  ViaHeadline,
  ViewpointTypeField,
} from './ViaPanels'
import { layoutStageOf } from './fieldChecklist'
import type { LabelStyleId } from '@/lib/mapSheet/callouts'
import type { EngineEnvironmentChoice, RoadRendererId } from './externalRenderers'
import { landformAssignments } from './viewLandform'
import { exportEditorId, type VisualsExport } from './visualsExports'
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

/** `view`: the next plan click places a view of interest (`ViewsOfInterestPanel`). */
export type DrawMode =
  | 'none'
  | 'spot'
  | 'corridor'
  | 'block'
  | 'landscape'
  | 'tree-free'
  | 'wildlife-tree-patch'
  | 'view'

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
  /**
   * A compass bearing to face when no block is: an inventory viewpoint's arrow,
   * standing at that viewpoint. Null looks along the road.
   */
  lookBearing: number | null
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
  /** Tree shading: the drawing's own colours, or lit as crown volumes. Display only. */
  treeLook: TreeLook
  /**
   * Where the trees' light comes from: the page's fixed late-morning light, or the sun at the site's
   * date and time (`engineEnvironment`, the clock the other renderers are given). Display only.
   */
  treeSun: 'fixed' | 'site'
  /** The nearest trees lay a shadow on the ground, away from the trees' light. Display only. */
  treeShadows: boolean
  /**
   * Draw the road view at a lower resolution while it moves and at the screen's own once it holds
   * still. Display only: saved views and images are taken still.
   */
  movingResolution: 'full' | 'reduced'
  /**
   * Tree colours: natural, or by a stand prescription's treatment — before harvest the trees marked to
   * cut, after it the trees kept, and protected trees in both (`stand/prescribedCells.ts`). A colour only:
   * every tree covers the same pixels. Display only.
   */
  treeColours: 'natural' | 'treatment'
  /**
   * Which engine draws the road view (`externalRenderers.ts`): PGMaps' own map, or another engine in a frame over
   * it, fed the same scene and camera. Display only: figures, saved views and images stay PGMaps' own.
   */
  renderer: RoadRendererId
  /** The light and weather another renderer draws (`engineEnvironment`). Display only; PGMaps' own drawing ignores it. */
  engineEnvironment: EngineEnvironmentChoice
  /**
   * Draw the stems within this many metres in detail once the view holds
   * still; 0 never. Moving, every stem stays a card. Display only.
   */
  detailRadiusMeters: number
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
  /**
   * A VIA figure style (`src/lib/forestry/viaFigure/presets.ts`) draped on the road view, and the
   * style the analysis sheet is composed in. Display only, like block colours: never in the run.
   */
  figureStyle: string | null
  /** How the analysis sheet names features (`LABEL_STYLES`); the figure style's own when null. Display only. */
  labelStyle: LabelStyleId | null
}

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

/** Which group of views steps 4 and 5 are made for, and the offer to take in an assessment made before groups. */
function AssessingFrom({ group }: { group: NonNullable<SidebarProps['assessGroup']> }) {
  const list = (names: string[]) =>
    names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return (
    <div className="space-y-1.5 px-3 pt-2 text-2xs text-muted-foreground" data-assessing-group={group.leadName}>
      {group.memberNames.length > 1 ? (
        <p>
          Standing at <span className="font-medium text-foreground">{group.standingName}</span>. One assessment covers{' '}
          {list(group.memberNames)}, grouped in their rows in step 2.
        </p>
      ) : (
        <p>
          Assessing from <span className="font-medium text-foreground">{group.standingName}</span>. Views that see the
          block the same way can share this assessment: group them in their rows in step 2.
        </p>
      )}
      {group.onUseEarlier && (
        <InlineAlert>
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0">An assessment was recorded before views were grouped.</span>
            <Button type="button" variant="outline" size="2xs" className="shrink-0" onClick={group.onUseEarlier}>
              Use it here
            </Button>
          </span>
        </InlineAlert>
      )}
    </div>
  )
}

/** A button in a two-column grid of actions, as in the road designer's sidebar. */
const GRID_BUTTON = 'h-auto min-h-8 whitespace-normal px-2 text-xs touch:min-h-10'

const SELECT_CLASS =
  'h-7 max-w-full rounded-md border border-border bg-background px-1.5 text-2xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/** A field's explanation: an (i) at the end of its label row, so the sidebar lists values, not prose. */
function fieldTip(label: string, ...parts: ReactNode[]) {
  const shown = parts.filter((part) => part != null && part !== false)
  if (!shown.length) return undefined
  return (
    <InfoTip label={`About ${label.toLowerCase()}`} className="absolute -top-1 right-0">
      {shown.map((part, index) => (
        <span key={index} className={cn('block', index > 0 && 'mt-1.5')}>
          {part}
        </span>
      ))}
    </InfoTip>
  )
}

function NumberField({
  label,
  hint,
  info,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string
  /** Both go behind one (i) beside the label: what the value means, then any background. */
  hint?: ReactNode
  info?: ReactNode
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
      hintAction={fieldTip(label, hint, info)}
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

/** The Forest Planning and Practices Regulation (B.C. Reg. 14/2004) on BC Laws. */
const FPPR_URL = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004'

/** "Which roads see the block" lists this many before *Show all*. */
const ROADS_SHOWN = 8

/** A polygon card's fields, lined up under its title; the card carries any selection tint. */
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
  return (
    <ColorField
      size="sm"
      className="mt-0.5 shrink-0"
      label={`Colour for ${target.name}`}
      resetLabel={`Reset colour of ${target.name}`}
      title="Block colour"
      value={target.displayColor ?? null}
      onChange={onChange}
      presets={BLOCK_COLOR_PRESETS}
      presetDisplay="picker"
    />
  )
}

const HARVEST_SYSTEMS: ReadonlyArray<{ id: HarvestSystem; label: string }> = [
  { id: 'clearcut', label: 'Clearcut' },
  { id: 'retention', label: 'Dispersed retention' },
  { id: 'partial', label: 'Partial cut' },
]

/** How a block is cut, beside its role in the row's grid. */
function HarvestSystemSelect({
  target,
  onChange,
  className,
}: {
  target: TargetPolygon
  onChange: (patch: Partial<TargetPolygon>) => void
  className?: string
}) {
  return (
    <StyledSelect
      className={cn(SELECT_CLASS, className)}
      value={target.harvestSystem ?? 'clearcut'}
      onChange={(event) => onChange({ harvestSystem: event.target.value as HarvestSystem })}
      aria-label={`Harvest system for ${target.name}`}
    >
      {HARVEST_SYSTEMS.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.label}
        </option>
      ))}
    </StyledSelect>
  )
}

/**
 * What a block's harvest system asks for beyond the system itself. Retention feeds Table 5; a partial cut is taken
 * out of the cleared-ground measurement and read from Table 6 instead (3.4.4). A clearcut asks for nothing.
 */
function BlockHarvestFields({
  target,
  onChange,
  prescription,
  onOpenPrescription,
}: {
  target: TargetPolygon
  onChange: (patch: Partial<TargetPolygon>) => void
  /** The block's stand prescription, read: one line of what it takes, or why it has none. */
  prescription?: StandPrescriptionLine | null
  onOpenPrescription?: () => void
}) {
  const system = target.harvestSystem ?? 'clearcut'
  if (system === 'clearcut') return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
      {onOpenPrescription && (
        <div className="flex w-full items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenPrescription}
            aria-label={`Stand prescription for ${target.name}`}
          >
            {target.prescription ? 'Prescription…' : 'Prescribe trees…'}
          </Button>
          {prescription?.tone === 'warning' && (
            <Badge tone="warning" pill>
              Target not met
            </Badge>
          )}
          <span className="min-w-0 truncate text-xs text-muted-foreground" title={prescription?.text}>
            {prescription?.text ?? 'Random thinning to the share above'}
          </span>
          <InfoTip label="About stand prescriptions">
            A prescription chooses which trees the block takes, tree by tree: thinning from below or above to a basal
            area, stems or density target, or keeping groups of trees. The road view then draws exactly those trees, and
            the trees taken as stumps or felled stems. It draws the stand only: Table 5 and 6 read the figures in this
            row, which the prescription can copy in when you choose.
          </InfoTip>
        </div>
      )}
    </div>
  )
}

/** One line for a prescribed block's row: what it takes, or why it could not be read. */
export type StandPrescriptionLine = { text: string; tone: 'default' | 'warning' }

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
  /** Step 2's views of interest: how many the export draws and how many are captured, for the headline. */
  views?: { included: number; captured: number }
}

export type SidebarProps = {
  via: ViaSidebarState
  scene: ForestryScene
  onViewpointChange: (viewpoint: Viewpoint) => void
  onThresholdsChange: (thresholds: VisualQualityThresholds) => void
  onTargetChange: (targetId: string, patch: Partial<TargetPolygon>) => void
  onRemoveTarget: (targetId: string) => void
  onZoomToTarget: (targetId: string) => void
  /** Opens a retention or partial-cut block's stand prescription. */
  onOpenPrescription?: (targetId: string) => void
  /** Each prescribed block's one-line reading, by target id. */
  prescriptionLines?: ReadonlyMap<string, StandPrescriptionLine>
  onRemoveTreeFreeArea?: (areaId: string) => void
  /**
   * The automatic clearing in front of a stood-at viewpoint (`viewpointClearingArea`): its setting,
   * and the area drawn now (null while off, or when the viewpoint is a road).
   */
  viewpointClearing?: { stood: boolean; setting: ViewpointClearingSetting; area: TreeFreeArea | null }
  onViewpointClearingChange?: (setting: ViewpointClearingSetting) => void
  /** Private land drawn without its timber (`ForestryScene.clearPrivateLand`); null when the scene has no private land. */
  privateLandClearing?: { cleared: boolean; hectares: number } | null
  onPrivateLandClearingChange?: (cleared: boolean) => void

  drawMode: DrawMode
  onDrawModeChange: (mode: DrawMode) => void

  /** Replaces the drawn corridor with the road the basemap says it traces. */
  onSnapToRoad: () => void
  snapMessage: string | null

  analysis: AnalysisState
  onRun: () => void
  /** Why *Run visibility* waits (views of interest being captured), or null/absent when it can run. */
  runBlocked?: string | null
  onCancel: () => void

  reverse: ReverseState
  onRunReverse: () => void
  /** Adopts one of the ranked roads as the corridor. */
  onUseRoad: (roadId: string) => void

  /** What the 3D stand is drawing, or why it is not. */
  forestStatus?: import('./ForestOverlay').ForestStatus | null

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
  /**
   * Makes a landform the site's: the one the assessment is made against, and every view without a landform of its
   * own with it.
   */
  onActivateLandform: (targetId: string) => void
  /**
   * The site landform (`siteLandformOf`). Absent: the run's landform, which differs only while the page stands at a
   * view whose own landform it made the run's.
   */
  siteLandformId?: string | null
  /**
   * Step 1's landform of each view of interest (`ViewLandforms`), under the site landform. It is given the section's
   * own landform card to draw a view's landform with.
   */
  viewLandforms?: (renderLandform: (target: TargetPolygon) => ReactNode) => ReactNode
  onClearScene: () => void
  /** Opens a project file saved from Save & export: it replaces what is on the map and the saved views. */
  onOpenProject: (file: File) => void
  /**
   * Brings back the site this browser last kept, with its saved views, when the map now shows another (it is kept
   * until a view is saved on the new one). Absent: nothing else is kept.
   */
  onReopenPrevious?: () => void
  /** Opens Save & export, on one output or the first. */
  onOpenExport: (kind?: VisualsExport) => void
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
  /**
   * Step 1, under the cutblocks: a block's route card and the Other Considerations drafted from it (`RouteCardPanel`).
   * Read only while open, so its section's open state is the page's.
   */
  routeCard?: ReactNode
  routeCardOpen?: boolean
  onRouteCardOpenChange?: (open: boolean) => void
  /** What the folded section says: its Y count and the rows still to enter. */
  routeCardSummary?: string
  projectAttachments?: ReactNode
  /** Step 1: nearby inventory units to adopt as the landform. */
  landformFinder?: ReactNode
  /** Step 2: preparing the eye-level view, and the views saved from it. */
  visit: ReactNode
  /** Step 2: a street-level field photo to line the road view up with. */
  fieldPhoto?: ReactNode
  /** Step 2: the reviewer's own photos (`OwnFieldPhoto`) and the evidence images (`ToolFieldPanel`), as one block. */
  fieldRecords?: ReactNode
  /** Step 2: the pre-layout field brief for the layout crew, and the crew's checklist answered back. */
  fieldBrief?: ReactNode
  /**
   * Step 2's *Road viewpoint*, the road's own record beside the views' rows: its 3.2.1 type and, at a stand on it, the
   * surveyed eye. False while a view of interest is stood at, whose row keeps both. Default true.
   */
  showViewpointType?: boolean
  /** The surveyed eye at the road's stand (`StoodViewpointPanel`, bare), shown in *Road viewpoint*. */
  roadStand?: ReactNode
  /** Step 3: which landform the run measures, and its green area. */
  landformScope: ReactNode
  /** Step 3: draw wildlife tree patches (retained masks), under the run. */
  wildlifeTreePatches?: ReactNode
  /** Step 3: private land from ParcelMap BC, added by the reviewer as private-land masks. */
  privateLand?: ReactNode
  /** Step 3: FTEN gross, planned net and net of RESULTS group reserves, reserves added as retained masks. */
  netFootprints?: ReactNode
  /** Step 3: the landform design review. */
  designReview: ReactNode
  /** Saved design alternatives and their comparisons: step 3's, unlike the reading in Resources. */
  designComparisons?: ReactNode
  /** Step 3, heading the Results: the previous run's verdict beside this one's (`runRevision.ts`). */
  runRevision?: ReactNode
  /** Step 5: opens Save & export on its Package entry, where the final rating is made. */
  onOpenPackage?: () => void
  /** Step 2, under the views of interest: inventory viewpoints and rec sites near the block, which add to them. */
  viewpointFinder?: ReactNode
  /**
   * Step 2, first: the views of interest planned on the plan map and captured without driving
   * (`ViewsOfInterestPanel`). The finder under it adds to it.
   */
  viewsOfInterest?: ReactNode
  /**
   * Step 1's *Assess from: A view*: which view of interest the assessment runs from, and adding one on the map
   * (`AssessFromView`). Shown in place of the old spot placement; absent keeps it.
   */
  assessFromView?: ReactNode
  /**
   * Steps 4 and 5 made for a group of views of interest (`viewGroups.ts`): its lead and the views it covers, and an
   * assessment recorded before groups existed that the reviewer can take into this group's. Absent on a road.
   */
  assessGroup?: {
    leadName: string
    /** The view stood at, which may be any view of the group. */
    standingName: string
    memberNames: string[]
    /** An earlier, ungrouped step 4 exists and this group has none yet. */
    onUseEarlier?: () => void
  } | null
  /** What *Assess from* shows: a view while standing at one, else the viewpoint's mode. */
  assessMode?: Viewpoint['mode']
  /** Switching *Assess from*; absent switches the viewpoint's mode and clears it, as before. */
  onAssessModeChange?: (mode: Viewpoint['mode']) => void
  /** Step 2, in the road view: the existing forest and regrowth records the timber is drawn from. */
  roadViewForest?: ReactNode

  /** What the basemap said about the road and water, for the drive panel's clearing note. */
  roadClearing?: { roadClass: string | null; widthMeters: number; waterPolygons: number }

  /**
   * The step shown, held by the page so the sidebar's tabs and the ribbon's tabs are one choice
   * (`useWorkflowPlacement`). `reveal` is false when the page moves on by itself (the road view
   * opening brings step 2 forward) rather than at the reviewer's click.
   */
  step: ViaStepId
  onStepChange: (step: ViaStepId, reveal?: boolean) => void
  /**
   * Shown in the ribbon's task pane, whose tabs choose the step: the sidebar draws no step tabs of
   * its own. Its shell stays, so every section keeps its density and its one scroll container.
   */
  embedded?: boolean
}

export function Sidebar({
  via,
  scene,
  onViewpointChange,
  onThresholdsChange,
  onTargetChange,
  onRemoveTarget,
  onZoomToTarget,
  onOpenPrescription,
  prescriptionLines,
  drawMode,
  onDrawModeChange,
  onSnapToRoad,
  snapMessage,
  analysis,
  onRun,
  runBlocked = null,
  onCancel,
  reverse,
  onRunReverse,
  onUseRoad,
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
  siteLandformId,
  viewLandforms,
  onClearScene,
  onOpenProject,
  onReopenPrevious,
  onOpenExport,
  onAddRoadDisturbance,
  setup,
  routeCard,
  routeCardOpen,
  onRouteCardOpenChange,
  routeCardSummary,
  projectAttachments,
  landformFinder,
  visit,
  fieldPhoto,
  fieldRecords,
  fieldBrief,
  showViewpointType = true,
  roadStand,
  landformScope,
  wildlifeTreePatches,
  privateLand,
  netFootprints,
  designReview,
  designComparisons,
  runRevision,
  onOpenPackage,
  viewpointFinder,
  viewsOfInterest,
  assessFromView,
  assessGroup = null,
  assessMode,
  onAssessModeChange,
  roadViewForest,
  step: activeStep,
  onStepChange,
  embedded = false,
}: SidebarProps) {
  // Which scale the threshold editor is showing. Purely a view concern — both
  // sets are always in the scene and both are always reported.
  const [thresholdBasis, setThresholdBasis] = useState<AlterationBasis>('perspective')
  // The roads list shows the first few; the rest are a click away, and the header says so.
  const [showAllRoads, setShowAllRoads] = useState(false)
  const { viewpoint, targets, thresholds } = scene

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

  // One step at a time, as tabs. The page opens it on the step to work on next; after
  // that the reviewer moves between them, and the headline's "Go to step"
  // switches for them. Every step stays mounted, so what is typed survives.
  const tabsRef = useRef<HTMLDivElement | null>(null)
  const setActiveStep = (id: ViaStepId) => onStepChange(id)
  const goToStep = (id: ViaStepId) => {
    setActiveStep(id)
    // Back to the top of the step, tabs in view.
    window.requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const startFrom: Record<StartScenarioId, () => void> = {
    tabor: onLoadSample,
    purden: onLoadHighwaySample,
    roadside: onLoadDriveSample,
    new: onClearScene,
  }
  const stepPanelProps = (id: ViaStepId) => ({
    role: 'tabpanel' as const,
    id: `via-steps-panel-${id}`,
    // Named by the step's title in its intro line, so the panel reads as "Design and simulate", not its short tab label.
    'aria-labelledby': `via-step-title-${id}`,
    hidden: activeStep !== id,
    'data-via-panel': id,
    // The ribbon's Find tools reads a step's sections through this (`ribbonEditorSections.ts`).
    'data-workflow-editor': id,
  })
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
    // The whole card carries the selection (a tinted fill and border, no accent
    // stripe), so the row, its icon buttons and its fields read as one piece.
    return (
      <li
        key={target.id}
        className={cn(
          insetBox({ padding: 'none' }),
          'overflow-hidden',
          selected && 'border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30',
        )}
        data-target-card={target.id}
        data-selected-card={selected || undefined}
      >
        <div className="flex items-center gap-0.5 pr-1">
          <ResultRow
            className="min-w-0 flex-1 bg-transparent px-2 py-2 ring-0 hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent"
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
                {target.role === 'landscape' && target.id === siteId && (
                  <Badge tone="info" pill className="shrink-0">
                    Site landform
                  </Badge>
                )}
                {/* A view's own landform while the page stands there: the run measures it, the site's stays the site's. */}
                {target.role === 'landscape' && target.id === activeLandformId && target.id !== siteId && (
                  <Badge tone="info" pill className="shrink-0">
                    In use at this stand
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
            size="icon-xs"
            className="shrink-0 text-muted-foreground touch:h-10 touch:w-10"
            onClick={() => onZoomToTarget(target.id)}
            aria-label={`Zoom to ${target.name}`}
            title="Zoom to polygon"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-destructive touch:h-10 touch:w-10"
            onClick={() => onRemoveTarget(target.id)}
            aria-label={`Remove ${target.name}`}
            title="Remove polygon"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <PlainRowDetail className="pl-[1.625rem] pt-0 pb-2.5">
          {/* The objective is the long one, so it takes a line; role and harvest system (or VAC) share the next. */}
          <div className="grid grid-cols-2 gap-1.5">
            <StyledSelect
              className={cn(SELECT_CLASS, 'order-2 w-full')}
              value={target.role}
              onChange={(event) => onTargetChange(target.id, { role: event.target.value as TargetRole })}
              aria-label={`Role for ${target.name}`}
            >
              <option value="block">Block</option>
              <option value="landscape">Landform</option>
            </StyledSelect>
            <StyledSelect
              className={cn(SELECT_CLASS, 'order-1 col-span-2 w-full')}
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
            </StyledSelect>
            {target.role === 'block' && (
              <HarvestSystemSelect
                target={target}
                onChange={(patch) => onTargetChange(target.id, patch)}
                className="order-3 w-full"
              />
            )}
            {/* Visual absorption capability rates a landform's capacity
                      to hide alteration, so it only means anything on one. */}
            {target.role === 'landscape' && (
              <StyledSelect
                className={cn(SELECT_CLASS, 'order-3 w-full')}
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
              </StyledSelect>
            )}
          </div>
          {target.role === 'block' && (
            <BlockHarvestFields
              target={target}
              onChange={(patch) => onTargetChange(target.id, patch)}
              prescription={prescriptionLines?.get(target.id) ?? null}
              onOpenPrescription={onOpenPrescription ? () => onOpenPrescription(target.id) : undefined}
            />
          )}
          {target.role === 'landscape' && target.id !== siteId && (
            <div className="mt-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="text-2xs"
                title="The assessment, and every view without a landform of its own, is then made against this landform"
                onClick={() => onActivateLandform(target.id)}
              >
                Make this the site landform
              </Button>
            </div>
          )}
        </PlainRowDetail>
      </li>
    )
  }
  // Where a section stood while Save & export shows it under the part it sets (`Projectable`, `ContentsSection`).
  const editedInExport = (
    <p className="border-b border-border px-3 py-2 text-2xs text-muted-foreground">
      Open in Save &amp; export, where it is being edited.
    </p>
  )
  const landforms = targets.filter((target) => target.role === 'landscape')
  const activeLandformId = findSceneLandform(scene)?.id ?? null
  // The site landform, each view's own, and the ones nothing is assessed against (`landformAssignments`).
  const siteId = siteLandformId === undefined ? activeLandformId : siteLandformId
  const siteLandform = landforms.find((target) => target.id === siteId) ?? null
  const landformUse = landformAssignments(scene, siteLandform)
  const openings = targets.filter((target) => target.role === 'harvested')

  return (
    // The workspace's header (Guided mode) or ribbon names the tool and carries the way back and the
    // simulation settings, so the shell draws no title row of its own: one "Visual quality" heading.
    <MapSidebarShell
      title="Assessment steps"
      className={cn(MAP_SIDEBAR_CLASS, embedded && 'border-r-0 bg-transparent shadow-none backdrop-blur-none')}
      headerClassName="sr-only"
      titleClassName="text-base"
      density="compact"
      data-testid="visuals-steps"
    >
      <ViaHeadline
        assessment={via.assessment}
        stale={via.stale}
        landformName={via.landformName}
        statuses={via.statuses}
        onOpenStep={goToStep}
        activeStep={activeStep}
        views={via.views}
        stage={{
          value: layoutStageOf(via.review),
          onChange: (layoutStage) => via.onReviewChange({ layoutStage }),
        }}
      />

      {/* The five handbook steps as tabs, pinned while the step scrolls; in the ribbon its tabs are these. */}
      <div
        ref={tabsRef}
        hidden={embedded}
        className="sticky top-0 z-10 border-b border-border bg-background/95 p-1.5 backdrop-blur"
      >
        <TabBar
          label="Assessment steps"
          stretch
          stacked
          idPrefix="via-steps"
          value={activeStep}
          onChange={setActiveStep}
          options={VIA_STEPS.map((step) => ({
            value: step.id,
            label: STEP_TAB_LABELS[step.id],
            ariaLabel: `Step ${step.number}: ${step.title} (${stepStatusText(via.statuses[step.id])})`,
            marker: <StepMarker step={step.number} status={via.statuses[step.id]} className="h-4 w-4 text-3xs" />,
          }))}
          getTabProps={(option) => ({ 'data-via-step': option.value, title: summaries[option.value] })}
        />
      </div>

      {/* Step 1 — 3.1: the proposal, its objective, and where it may be seen from. */}
      <div {...stepPanelProps('identify')}>
        <StepIntro id="identify" status={via.statuses.identify} summary={summaries.identify} />
        <ToolSection
          title="Start from"
          help="A worked sample, the roadside demo (opened straight into the road view), or a clean site. Each replaces what is on the map."
        >
          <div className="grid grid-cols-2 gap-1.5">
            {START_SCENARIOS.map((scenario) => (
              <HoverTip
                key={scenario.id}
                content={
                  <>
                    <span className="block">{scenario.description}</span>
                    <span className="mt-1.5 block font-medium">Contains: {startScenarioContents()[scenario.id]}</span>
                  </>
                }
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={GRID_BUTTON}
                  onClick={startFrom[scenario.id]}
                >
                  {scenario.label}
                </Button>
              </HoverTip>
            ))}
          </div>
          <FileButton
            label="Project file"
            accept=".json,.zip"
            variant="outline"
            className={cn(GRID_BUTTON, 'mt-1.5 w-full')}
            title="Open a PGMaps project ZIP, an earlier project JSON file, or a Saved views file from Save & export"
            onFiles={([file]) => onOpenProject(file)}
          >
            <FileUp className="h-3.5 w-3.5" />
            Open a project…
          </FileButton>
          {onReopenPrevious && (
            <Button
              type="button"
              variant="outline"
              className={cn(GRID_BUTTON, 'mt-1.5 w-full')}
              title="Bring back the site this browser kept before this one, with its saved views"
              onClick={onReopenPrevious}
            >
              <History className="h-3.5 w-3.5" />
              Reopen previous site
            </Button>
          )}
          {projectAttachments}
        </ToolSection>

        <Projectable id={exportEditorId('viewpoint')} away={editedInExport}>
          <ToolSection
            title="Road or viewpoint"
            help="Where the assessment is made from: one spot, or a length of road driven end to end. Snap replaces a drawn line with the road the basemap says it traces."
          >
            <div className="space-y-2">
              {drawMode === 'spot' && setup}
              <SegmentedControl
                size="sm"
                label="Assess from"
                value={assessMode ?? viewpoint.mode}
                options={[
                  { value: 'spot', label: assessFromView ? 'A view' : 'Spot', icon: MapPin },
                  { value: 'corridor', label: 'Length of road', icon: Route },
                ]}
                onChange={(mode) => {
                  if (mode === (assessMode ?? viewpoint.mode)) return
                  if (onAssessModeChange) onAssessModeChange(mode)
                  else onViewpointChange({ ...viewpoint, mode, coordinates: [] })
                }}
              />
              {/* A view of interest is the one way to put a viewpoint on the map: chosen or added here, planned in step 2. */}
              {assessFromView && (assessMode ?? viewpoint.mode) === 'spot' ? (
                assessFromView
              ) : (
                <>
                  {/* The road is drawn with the plan map's *Draw the road* tool; a file comes in here. */}
                  {viewpoint.mode === 'spot' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={GRID_BUTTON}
                      onClick={() => onDrawModeChange('spot')}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      Place the viewpoint
                    </Button>
                  ) : (
                    <FileButton
                      label="Road file"
                      accept=".zip,.geojson,.json"
                      variant="outline"
                      className={cn(GRID_BUTTON, 'w-full')}
                      title="A road as GeoJSON or a zipped shapefile"
                      onFiles={([file]) => onImportRoad(file)}
                    >
                      <FileUp className="h-3.5 w-3.5" />
                      Import road
                    </FileButton>
                  )}
                  {viewpoint.mode === 'corridor' && !hasViewpoint && (
                    <p className="text-2xs text-muted-foreground">
                      Draw it with the map&apos;s road tool, or import a file.
                    </p>
                  )}
                  {hasViewpoint && (
                    <div
                      className={cn(
                        insetBox({ padding: 'none', tone: 'muted' }),
                        'flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {viewpoint.mode === 'spot'
                          ? `${formatMeasure(viewpoint.coordinates[0][1], null, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}, ${formatMeasure(viewpoint.coordinates[0][0], null, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
                          : `${viewpoint.coordinates.length} points · ${formatMeasure(corridorLength / 1000, 'km', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground touch:h-10 touch:w-10"
                        onClick={onSnapToRoad}
                        aria-label="Snap to the nearest road"
                        title="Snap to the nearest road"
                      >
                        <Magnet className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground touch:h-10 touch:w-10"
                        onClick={() => onViewpointChange({ ...viewpoint, coordinates: [] })}
                        aria-label={viewpoint.mode === 'spot' ? 'Clear the viewpoint' : 'Clear the road'}
                        title="Clear the viewpoint"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
              {snapMessage && <p className="text-3xs leading-4 text-muted-foreground">{snapMessage}</p>}
            </div>
          </ToolSection>
        </Projectable>

        {/* The same question the other way round: rather than picking a road and
          asking what it sees, take the block and find the roads that see it. */}
        <ToolSection
          title="Which roads see the block"
          summary={
            reverse.result
              ? `${reverse.result.roads.length} road${reverse.result.roads.length === 1 ? '' : 's'} found`
              : 'Search the roads on screen'
          }
          toggleProps={{ 'data-forestry-disclosure': 'reverse-viewshed' }}
          help="Reads the roads the basemap is drawing right now, so pan and zoom to the ground you want tested first: roads off screen are not searched. Percentages are the share of the block's ground area in view from one point. Pick a road to make it the corridor, then run the full assessment for the figures an objective is judged on."
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

          {reverseRunning && reverse.progress && (
            <InlineAlert loading>
              {reverse.progress.phase === 'terrain'
                ? `Fetching terrain — ${reverse.progress.completed} of ${reverse.progress.total} tiles`
                : 'Tracing sightlines…'}
            </InlineAlert>
          )}

          {reverse.error && <InlineAlert tone="error">{reverse.error}</InlineAlert>}

          {reverse.result && reverse.result.roads.length === 0 && (
            <p className="text-2xs text-muted-foreground">
              No road on screen can see it
              {reverse.result.outOfRangeRoadCount > 0
                ? `, and ${reverse.result.outOfRangeRoadCount} sat beyond the view distance.`
                : '.'}
            </p>
          )}

          {reverse.result && reverse.result.roads.length > 0 && (
            <div className={cn(insetBox({ padding: 'none' }), 'overflow-hidden')}>
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
        </ToolSection>

        <Projectable id={exportEditorId('cutblocks')} away={editedInExport}>
          <ToolSection
            title="Cutblocks"
            help="The proposed openings, traced on the map or imported as a zipped shapefile or GeoJSON. Each carries its objective and harvest system; retention feeds Table 5, and a partial cut is read from Table 6 rather than as cleared ground."
          >
            <div className="space-y-2">
              {/* Blocks are drawn with the plan map's *Draw block* tool; files come in here. */}
              <FileButton
                label="Cutblock or landform file"
                accept=".zip,.geojson,.json"
                variant="outline"
                className={cn(GRID_BUTTON, 'w-full')}
                title="Cutblocks or landforms as GeoJSON or a zipped shapefile"
                onFiles={([file]) => onImportFile(file)}
              >
                <FileUp className="h-3.5 w-3.5" />
                Import
              </FileButton>
              {importMessage && (
                <InlineAlert tone={importMessage.startsWith('Could not') ? 'error' : 'info'}>
                  {importMessage}
                </InlineAlert>
              )}
              {blocks.length === 0 ? (
                <p className="text-2xs text-muted-foreground">
                  None yet. Draw one with the map&apos;s block tool, or import a file.
                </p>
              ) : (
                <ul className="space-y-1.5">{blocks.map(renderTarget)}</ul>
              )}
            </div>
          </ToolSection>
        </Projectable>

        {routeCard && (
          <Projectable id={exportEditorId('route-card')} away={editedInExport}>
            <ToolSection
              title="Route card"
              summary={routeCardSummary}
              open={routeCardOpen}
              onOpenChange={onRouteCardOpenChange}
              help="The block's Route Card Tool Assessment, read live from public BC layers by the preset's rows (Y touches the block, Within lies within 200 m), with the rows no public layer holds for you to enter or measure from your own file, and the Other Considerations paragraphs drafted from it. A screen, not a legal determination; Save & export writes it as the planners' workbook or a Word document."
            >
              {routeCard}
            </ToolSection>
          </Projectable>
        )}

        <Projectable id={exportEditorId('landform')} away={editedInExport}>
          <ToolSection
            title="Landform and objective"
            data-landform-section=""
            help="Handbook 3.1.1: the objective comes from the visual landscape inventory, and is judged against one landform. Suggest one from the terrain or the BC inventory below, or draw the hillside."
          >
            <div className="space-y-2">
              <Button
                type="button"
                variant={drawMode === 'landscape' ? 'default' : 'outline'}
                size="sm"
                className={cn(GRID_BUTTON, 'w-full')}
                aria-pressed={drawMode === 'landscape'}
                onClick={() => onDrawModeChange(drawMode === 'landscape' ? 'none' : 'landscape')}
              >
                <Mountain className="h-3.5 w-3.5" />
                Draw landform
              </Button>
              {drawMode === 'landscape' && setup}
              {landforms.length === 0 ? (
                <p className="text-2xs text-muted-foreground">
                  None yet. Find one from the terrain or the BC inventory below, or draw the hillside.
                </p>
              ) : (
                <>
                  {/* Who is assessed against what: the site's landform, each view's own, then the ones nothing uses. */}
                  <ToolSubsection
                    title="Site landform"
                    help="The landform the assessment is made against: the run on the road, and every view of interest that has no landform of its own."
                  >
                    {siteLandform ? (
                      <ul className="space-y-1.5">{renderTarget(siteLandform)}</ul>
                    ) : (
                      <p className="text-2xs text-muted-foreground">
                        None chosen: several landforms cannot share a denominator. Make one of those below the site
                        landform.
                      </p>
                    )}
                  </ToolSubsection>
                  {viewLandforms?.(renderTarget)}
                  {landformUse.unused.length > 0 && (
                    <ToolSubsection
                      title="Other landforms"
                      help="In the scene, but nothing is assessed against them: neither the site landform nor a view's own. They stay out of every figure until one is made the site landform or adopted for a view."
                    >
                      <ul className="space-y-1.5">{landformUse.unused.map(renderTarget)}</ul>
                    </ToolSubsection>
                  )}
                </>
              )}
              {landforms.length > 0 && (
                <SubLandformFields
                  landforms={landforms.map((target) => target.name)}
                  review={via.review}
                  onReviewChange={via.onReviewChange}
                />
              )}
            </div>
          </ToolSection>
        </Projectable>
        {openings.length > 0 && (
          <ToolSection
            title="Existing openings"
            summary={`${openings.length} on the map`}
            toggleProps={{ 'data-forestry-disclosure': 'existing-openings' }}
          >
            <ul className="space-y-1.5">{openings.map(renderTarget)}</ul>
          </ToolSection>
        )}
        {landformFinder}
        {/* The map-extent lookup also brings in existing harvest and forest
          cover, so it is more than a landform finder — but it is secondary
          to the two finders above, and folded. */}
        <ToolSection
          title="Look up this map view"
          summary={inventory.units.length ? `${inventory.units.length} units` : 'BC inventory and existing harvest'}
          toggleProps={{ 'data-forestry-disclosure': 'inventory-lookup' }}
          help="Provincial sensitivity units read live from DataBC, plus harvest and forest-cover context. Boundaries are candidates: review the visible landform before adopting one."
          actions={
            inventory.units.length > 0 && (
              <Button type="button" variant="ghost" size="xs" className="text-2xs" onClick={onToggleInventory}>
                {showInventory ? 'Hide' : 'Show'}
              </Button>
            )
          }
        >
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

          {inventory.status === 'error' && <InlineAlert tone="error">{inventory.error}</InlineAlert>}

          {inventory.status === 'ready' &&
            (inventory.units.length === 0 ? (
              <InlineAlert>
                No inventory boundaries intersect this map extent. Use &ldquo;Find a landform in the BC inventory&rdquo;
                above to search nearby units, or draw or import the visible hillside.
              </InlineAlert>
            ) : (
              <div>
                <p className="text-2xs text-muted-foreground">
                  {inventorySummary.total} units · {inventorySummary.withObjective} with an established objective ·{' '}
                  {inventorySummary.withVac} with a VAC rating
                  {inventory.truncated ? ' · more exist than were returned' : ''}
                  {inventory.harvestCount > 0 ? ` · ${inventory.harvestCount} existing openings` : ''}
                  {inventory.stands.length > 0 ? ` · ${inventory.stands.length} surveyed stands` : ''}
                </p>
                <ul
                  className={cn(insetBox({ padding: 'none' }), 'mt-2 max-h-56 divide-y divide-border overflow-y-auto')}
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
                            {unit.objectiveId ? visualQualityClass(unit.objectiveId).label : 'No established objective'}
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
        </ToolSection>
      </div>

      {/* Step 2 — 3.2: travel the road as a visitor would and record the views. */}
      <div {...stepPanelProps('visit')}>
        <StepTitle id="visit" />
        {viewsOfInterest}
        {viewpointFinder}
        {/* The map's bar plays, saves and exits, and its View options hold how the view
          looks (`RoadViewOptions.tsx`); what is drawn here is the stand and its records. */}
        {result && drive.active && (
          <>
            {blocks.length > 0 && (
              <ToolSection
                title="Block colours"
                summary={
                  blocks.some((block) => block.displayColor)
                    ? `${blocks.filter((block) => block.displayColor).length} of ${blocks.length} set`
                    : 'Cleared ground'
                }
                toggleProps={{ 'data-forestry-disclosure': 'block-colours' }}
                help="How each block is filled on the map, in the road view and in the screenshots taken from it: white for a planning-note screenshot, or any colour to tell blocks apart. Unset, a block is cleared ground (white in the note screenshot look). Display only: the run never changes. A saved screenshot keeps the colour it was taken with."
              >
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
              </ToolSection>
            )}

            {/* Drawn timber is the road view bar's tree popover (`DrawnTimberButton`); tracing a tree-free area on
              the plan keeps its drawing controls here, where the other drawings' are. */}
            {drawMode === 'tree-free' && (
              <ToolSection title="Drawing a tree-free area">
                <div className="space-y-2">
                  <p className="text-2xs text-muted-foreground">
                    Trace the ground the road view draws without timber on the plan map.
                  </p>
                  {setup}
                </div>
              </ToolSection>
            )}
            {roadViewForest}
          </>
        )}
        {visit}
        {(fieldPhoto || fieldRecords) && (
          <ToolSection
            title="Field photos"
            summary={fieldPhoto ? 'Street photos · your photos · evidence' : 'Your photos · evidence'}
            toggleProps={{ 'data-forestry-disclosure': 'field-records' }}
            help="Handbook 3.2 photographs each viewpoint and 3.3.4 checks the simulation against the photo. On the road, line the road view up with a street-level photo from Mapillary. Below, your own photos and evidence images in one list: photos go in through the line-up window (read in this browser, never uploaded) whether or not you line them up, and simulation, map and design images are attached beside them. File each under a view of interest, whose row lists and adds them. They stay on this device, travel in the workspace export and the project file, and a new site or sample starts without them."
          >
            <div className="space-y-3">
              {fieldPhoto}
              {fieldPhoto && fieldRecords && <div className="border-t border-border" aria-hidden="true" />}
              {fieldRecords}
            </div>
          </ToolSection>
        )}
        {showViewpointType && (
          <ToolSection
            title="Road viewpoint"
            toggleProps={{ 'data-forestry-disclosure': 'road-viewpoint' }}
            help="The road's own record, as each view of interest keeps its own in its row. Viewpoint type is handbook 3.2.1: how important the viewpoint is, from how long the proposal stays in view at travel speed; types 4 and 5 are land uses a terrain model cannot see. Standing at a spot on the road, a surveyed eye elevation stands the eye there instead of on the terrain model, for the road view, the run and the figures alike."
          >
            <div className="space-y-2">
              <ViewpointTypeField
                result={result}
                review={via.review}
                speedKmh={drive.speedKmh}
                onChange={via.onReviewChange}
              />
              {roadStand}
            </div>
          </ToolSection>
        )}
        {fieldBrief}
      </div>

      {/* Step 3 — 3.3: delineate the landform, review the design, simulate. */}
      <div {...stepPanelProps('design')}>
        <StepTitle id="design" />
        <ToolSection
          title="Run assumptions"
          help="Handbook 3.3.2: the proposal is measured against the landform it sits on, as it stands in the assessment year."
        >
          {landformScope}
        </ToolSection>
        <Projectable id={exportEditorId('run')} away={editedInExport}>
          <ToolSection
            title="Simulation"
            help="Handbook 3.3.4: terrain sightlines from each station on the road to every point on every block. Add the on-screen roads as site disturbance (FS1252 line b): without them the alteration figure is a floor, and on steep ground a road can read as heavily as the block it serves."
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className={GRID_BUTTON}
                  disabled={!hasViewpoint || blocks.length === 0 || running || !!runBlocked}
                  title={runBlocked ?? undefined}
                  onClick={onRun}
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {running ? 'Working…' : 'Run visibility'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={GRID_BUTTON}
                  title="Adds the roads drawn on screen inside the landform as FS1252 line (b) site disturbance"
                  onClick={onAddRoadDisturbance}
                >
                  <Waypoints className="h-4 w-4" />
                  Add on-screen roads as site disturbance
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

              {runBlocked && !running && <p className="text-2xs text-muted-foreground">{runBlocked}</p>}
              {!hasViewpoint && <p className="text-2xs text-muted-foreground">Place a viewpoint to run.</p>}
              {hasViewpoint && blocks.length === 0 && (
                <p className="text-2xs text-muted-foreground">Add at least one block to assess.</p>
              )}
              {analysis.error && <InlineAlert tone="error">{analysis.error}</InlineAlert>}
              {/* Whether the run's numbers can be used, where the run was pressed
              rather than only in the package two steps on. */}
              {result && !running && (
                <InlineAlert tone={numericalReady ? 'success' : 'warning'}>
                  {numericalReady
                    ? 'Scenario numerical fields available'
                    : 'Provisional result — PDF numerical fields withheld'}
                  {!numericalReady && result.quality?.warnings.length ? (
                    <span className="block">{result.quality.warnings[0]}</span>
                  ) : null}
                </InlineAlert>
              )}
            </div>
          </ToolSection>
        </Projectable>
        {wildlifeTreePatches}
        {privateLand}
        {netFootprints}
        {result && (
          <ToolSection title="Results">
            {runRevision}
            <ResultsPanel
              result={result}
              targets={targets}
              thresholds={thresholds}
              selectedTargetId={selectedTargetId}
              onSelectTarget={onSelectTarget}
              drivePositionMeters={drive.active ? drive.positionMeters : null}
              onSeek={(distanceMeters) => onDriveChange({ active: true, positionMeters: distanceMeters })}
            />
          </ToolSection>
        )}
        {/* Simulation settings are the workspace header's settings button (`SimulationSettingsButton`), or the ribbon's in Simulate. */}
        <ToolSection
          title="Planning thresholds"
          summary="Not the handbook’s Table 2"
          toggleProps={{ 'data-forestry-disclosure': 'planning-thresholds' }}
          help={
            <>
              {ALTERATION_BASIS_NOTES[thresholdBasis]} Defaults come from{' '}
              {thresholdBasis === 'perspective'
                ? 'A Guide to Visual Quality Objectives (2013)'
                : 'Procedures for Factoring Visual Resources into Timber Supply Analyses (1998), Table 3'}
              — edit them to match a district&apos;s own numbers.
              {thresholdBasis === 'planimetric' &&
                ' Table 4 narrows these to one figure per visual absorption capability. Rate a landform’s VAC in step 1 and the results use that figure instead of the class maximum.'}
            </>
          }
        >
          <SegmentedControl
            size="sm"
            label="Threshold scale"
            value={thresholdBasis}
            onChange={setThresholdBasis}
            options={(['perspective', 'planimetric'] as AlterationBasis[]).map((basis) => ({
              value: basis,
              label: ALTERATION_BASIS_LABELS[basis],
            }))}
          />
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
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-2xs text-muted-foreground"
            onClick={() => onThresholdsChange({ ...DEFAULT_VISUAL_QUALITY_THRESHOLDS })}
          >
            Reset to guidebook defaults
          </Button>
        </ToolSection>
        {designComparisons}
      </div>

      {/* Step 4 — 3.4: the ocular class first, then the measured and adjusted figure. */}
      <div {...stepPanelProps('assess')}>
        <StepIntro id="assess" status={via.statuses.assess} summary={summaries.assess} />
        <Projectable id={exportEditorId('assess')} away={editedInExport}>
          {assessGroup && <AssessingFrom group={assessGroup} />}
          {assessment ? (
            <>
              <ToolSection
                title="Ocular assessment"
                help="Handbook 3.4.1, Table 1. The primary measure. Look at the after-harvest road view at the scale a traveller sees it and describe the alteration — every existing opening not yet greened up included. The model does not fill these in."
              >
                <OcularAssessmentFields assessment={assessment} review={via.review} onChange={via.onReviewChange} />
              </ToolSection>
              <ToolSection
                title="Percent alteration"
                help="Handbook 3.4.2, Table 2. The share of the landform's visible green face, in perspective from the assessment station, read against Table 2. Estimated from terrain sightlines, not measured on a photograph."
              >
                <NumericalAssessmentSummary
                  assessment={assessment}
                  result={result}
                  blockNames={Object.fromEntries(
                    scene.targets.filter((target) => target.role === 'block').map((target) => [target.id, target.name]),
                  )}
                />
              </ToolSection>
              <ToolSection
                title="Design adjustments"
                help="Handbook 3.4.3, Tables 3–5. Table 3: Good −1, Moderate 0, Poor +1. Distance, and one or two openings, are measured from the run; override them if the view says otherwise."
              >
                <AdjustmentFields assessment={assessment} review={via.review} onChange={via.onReviewChange} />
              </ToolSection>
            </>
          ) : (
            <div className="px-3 py-3">
              <InlineAlert>
                Set the landform in step 1 first — the assessment is made against its objective.
              </InlineAlert>
            </div>
          )}
        </Projectable>
      </div>

      {/* Step 5 — 3.5 and 4.0: the rating, why, and the package. */}
      <div {...stepPanelProps('rate')}>
        <StepIntro id="rate" status={via.statuses.rate} summary={summaries.rate} />
        {assessGroup && <AssessingFrom group={{ ...assessGroup, onUseEarlier: undefined }} />}
        {/* The rating, the Visuals paragraph and measures, and the evidence record are written where they are printed:
          Save & export, the package's entry and each output's options. */}
        <ToolSection
          title="Rate and write up in Save & export"
          help="Handbook 3.5 and 4.0. Save & export holds this step's work beside the files it goes into: the final rating and its rationale at the top of Package, the Visuals paragraph and visual measures in Block note, and the evidence record and checklist in VIA evidence package. What you write there is saved with the scene and printed in every output that uses it."
        >
          <div className="space-y-2 text-xs">
            {assessment && !assessment.rating && (
              <p className="text-muted-foreground">
                A final rating needs both measures: the run&apos;s figure and step 4&apos;s judgement.
              </p>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                size="sm"
                className={GRID_BUTTON}
                onClick={() => (onOpenPackage ? onOpenPackage() : onOpenExport())}
              >
                <Download className="h-3.5 w-3.5" />
                Rate and package…
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={GRID_BUTTON}
                onClick={() => onOpenExport('block-note')}
              >
                <FileText className="h-3.5 w-3.5" />
                Visuals note…
              </Button>
            </div>
          </div>
        </ToolSection>
      </div>

      {/* Reading, not controls: kept folded under every step rather than inside one. */}
      <ToolSection
        title="Resources"
        summary="Handbook and design guidance"
        toggleProps={{ 'data-forestry-disclosure': 'resources' }}
      >
        <ul className="space-y-1 text-xs">
          <li>
            <ExternalLink href={BC_DESIGN_HANDBOOK}>BC Visual Impact Assessment Handbook (2001)</ExternalLink>
          </li>
          <li>
            <ExternalLink href={FPPR_URL}>Forest Planning and Practices Regulation, s. 1.1</ExternalLink>
          </li>
        </ul>
        {/* FPPR s. 1.1's visually altered forest landscape categories, as the objectives are defined. */}
        <div className="space-y-1" data-testid="fppr-categories">
          <p className="text-2xs font-medium text-muted-foreground">
            Visually altered landscape categories (FPPR s. 1.1)
          </p>
          <dl className="space-y-1.5 text-2xs leading-4">
            {VISUAL_QUALITY_CLASSES.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <dt className="w-7 shrink-0 font-semibold tabular-nums" style={{ color: entry.color }}>
                  {entry.code}
                </dt>
                <dd className="min-w-0">
                  <span className="font-medium text-foreground">{entry.label}.</span>{' '}
                  <span className="text-muted-foreground">{entry.description}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {designReview}
      </ToolSection>
    </MapSidebarShell>
  )
}

/**
 * The step's name and handbook section in one line, its purpose behind the (i).
 * The tab above already says which step this is; this says what it is for.
 */
/**
 * A step's name for its panel (`aria-labelledby`) where the step shows no intro line: its tab already names it, and
 * the headline carries its progress.
 */
function StepTitle({ id }: { id: ViaStepId }) {
  return (
    <h2 id={`via-step-title-${id}`} className="sr-only">
      {VIA_STEPS.find((step) => step.id === id)!.title}
    </h2>
  )
}

function StepIntro({ id, status, summary }: { id: ViaStepId; status: ViaStepStatus; summary: string }) {
  const step = VIA_STEPS.find((entry) => entry.id === id)!
  return (
    <div className="border-b border-border bg-muted/20 px-3 py-2" data-step-status={status}>
      <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span id={`via-step-title-${id}`} className="min-w-0 truncate">
          {step.title}
        </span>
        <span className="shrink-0 text-2xs font-normal text-muted-foreground">Handbook {step.section}</span>
        <InfoTip label="What this step is for" className="ml-auto">
          {step.purpose}
        </InfoTip>
      </h2>
      <p className="mt-0.5 truncate text-2xs text-muted-foreground">{summary}</p>
    </div>
  )
}

/**
 * The road view's drawn timber: whether timber stands, its height and cleared width, tree-free ground, how a stem is
 * drawn and the viewing gap. The road view bar's tree popover (`DrawnTimberButton`). A drawing: it never changes the
 * figures.
 */
export function DrawnTimberPanel({
  drive,
  onDriveChange,
  viewpointClearing,
  onViewpointClearingChange,
  privateLandClearing,
  onPrivateLandClearingChange,
  drawMode,
  onDrawModeChange,
  scene,
  onRemoveTreeFreeArea,
  forestStatus = null,
  inventory,
  roadClearing,
}: Pick<
  SidebarProps,
  | 'drive'
  | 'onDriveChange'
  | 'viewpointClearing'
  | 'onViewpointClearingChange'
  | 'privateLandClearing'
  | 'onPrivateLandClearingChange'
  | 'drawMode'
  | 'onDrawModeChange'
  | 'scene'
  | 'onRemoveTreeFreeArea'
  | 'forestStatus'
  | 'roadClearing'
> & { inventory: Pick<InventoryState, 'stands'> }) {
  return (
    <div className="space-y-2">
      {/* Headed like View options' groups, with the explanation behind its (i). */}
      <h3 className="flex items-center gap-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
        Drawn timber
        <InfoTip label="About the drawn timber">
          Timber fills the view, and the proposed and existing openings take it off, so a cut reads as a gap. It is a
          drawing: stand height, cleared width and stem style change only the picture, never the percentages. A 28 m
          tree 15 m away fills the sky, so widen the cleared strip to open the foreground
          {roadClearing?.roadClass
            ? `; it started at ${roadClearing.widthMeters} m from the basemap's class for this road (${roadClearing.roadClass})`
            : ''}
          {roadClearing?.waterPolygons ? ', and mapped water is left open' : ''}.
        </InfoTip>
      </h3>
      <div className="space-y-2">
        <CheckboxField
          className="text-xs"
          label="Draw standing timber"
          // Focus lands here on opening, not on the heading's (i), whose bubble would cover the panel.
          data-autofocus
          checked={drive.forest}
          onCheckedChange={(forest) => onDriveChange({ forest })}
        />
        {drive.forest && (
          <>
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
            {/* Ground drawn without timber: a pullout, a cleared stretch of roadside, a field. */}
            <div className="space-y-1.5" data-testid="tree-free-areas">
              {viewpointClearing?.stood && onViewpointClearingChange && (
                <div className="flex items-end gap-2" data-testid="viewpoint-clearing">
                  <div className="flex min-w-0 flex-1 items-center gap-1 pb-1.5">
                    <CheckboxField
                      className="min-w-0 flex-1"
                      label={<span className="text-2xs font-medium">Viewpoint clearing</span>}
                      checked={viewpointClearing.setting.enabled}
                      onCheckedChange={(enabled) =>
                        onViewpointClearingChange({ ...viewpointClearing.setting, enabled })
                      }
                    />
                    <InfoTip label="About the viewpoint clearing">
                      A lookout is kept open, so the stand is drawn back from where you stand: a fan of this radius
                      within {VIEWPOINT_CLEARING.halfAngleDegrees}° either side of the block, and{' '}
                      {VIEWPOINT_CLEARING.eyeRadiusMeters} m all round the eye. Display only, like any tree-free area:
                      the figures never change.
                      {viewpointClearing.area
                        ? ` It clears ${formatMeasure(polygonAreaMeters(viewpointClearing.area.geometry) / 10_000, 'ha', { maximumFractionDigits: 2 })}.`
                        : ''}
                    </InfoTip>
                  </div>
                  {viewpointClearing.setting.enabled && (
                    <div className="w-24 shrink-0">
                      <NumberField
                        label="Radius"
                        value={viewpointClearing.setting.radiusMeters}
                        min={VIEWPOINT_CLEARING.minRadiusMeters}
                        max={VIEWPOINT_CLEARING.maxRadiusMeters}
                        step={10}
                        suffix="m"
                        onChange={(radiusMeters) =>
                          onViewpointClearingChange({ ...viewpointClearing.setting, radiusMeters })
                        }
                      />
                    </div>
                  )}
                </div>
              )}
              {privateLandClearing && onPrivateLandClearingChange && (
                <div className="flex min-w-0 items-center gap-1" data-testid="private-land-clearing">
                  <CheckboxField
                    className="min-w-0 flex-1"
                    label={<span className="text-2xs font-medium">Clear private land</span>}
                    checked={privateLandClearing.cleared}
                    onCheckedChange={onPrivateLandClearingChange}
                  />
                  <InfoTip label="About clearing private land">
                    Some VIAs leave forest cover on private land unmodelled and draw the lots de-vegetated &quot;for
                    purposes of analysis&quot;, painted in the private-land colour. This draws the scene&apos;s private
                    land ({formatMeasure(privateLandClearing.hectares, 'ha', { maximumFractionDigits: 1 })}) without its
                    timber, in this road view and in an engine&apos;s. Display only: the run and its figures never
                    change.
                  </InfoTip>
                </div>
              )}
              <Button
                type="button"
                variant={drawMode === 'tree-free' ? 'default' : 'outline'}
                size="sm"
                className="h-8 w-full text-xs touch:h-10"
                aria-pressed={drawMode === 'tree-free'}
                onClick={() => onDrawModeChange(drawMode === 'tree-free' ? 'none' : 'tree-free')}
                title="Trace an area on the plan map where the road view leaves the timber out"
              >
                <Trees className="h-3.5 w-3.5" />
                {drawMode === 'tree-free' ? 'Drawing on the plan…' : 'Draw a tree-free area'}
              </Button>
              {(scene.treeFreeAreas ?? []).length > 0 && (
                <ul className="divide-y divide-border overflow-hidden rounded-md border border-border text-2xs">
                  {(scene.treeFreeAreas ?? []).map((area) => (
                    <li key={area.id} className="flex items-center gap-2 py-0.5 pl-2 pr-0.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed"
                        style={{ borderColor: TREE_FREE_COLOR }}
                      />
                      <span className="min-w-0 flex-1 truncate">{area.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatMeasure(polygonAreaMeters(area.geometry) / 10_000, 'ha', {
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      {onRemoveTreeFreeArea && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive touch:h-10 touch:w-10"
                          onClick={() => onRemoveTreeFreeArea(area.id)}
                          aria-label={`Remove ${area.name}`}
                          title="Put the timber back"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <SegmentedControl
              size="sm"
              label="How a stem is drawn"
              value={drive.treeStyle}
              onChange={(treeStyle) => onDriveChange({ treeStyle })}
              options={[
                {
                  value: 'baked',
                  label: 'Baked from 3D',
                  title:
                    'Each card is its own 3D tree pictured from eight sides: it shows the side you stand on, and is the same tree when the view stops',
                },
                {
                  value: 'hybrid',
                  label: 'Stable silhouettes',
                  title: 'Three fixed silhouette planes per near tree; distant instances stand for canopy groups',
                },
                { value: 'billboard', label: 'Billboards', title: 'Two fixed planes per near tree; lighter' },
                {
                  value: 'solid',
                  label: 'Solid cones',
                  title: 'Real cone geometry: honest from any angle, about fifteen times the triangles',
                },
              ]}
            />
            {(drive.lookAtTargetId || drive.lookBearing !== null) && (
              <CheckboxField
                className="text-xs"
                label={drive.lookAtTargetId ? 'Viewing gap to the block' : 'Viewing gap along the arrow'}
                title="Leaves the drawn timber out of the line of sight, as a pullout or a gap in the roadside trees would"
                checked={drive.viewingGap}
                onCheckedChange={(viewingGap) => onDriveChange({ viewingGap })}
              />
            )}
            {forestStatus?.error ? (
              <InlineAlert tone="error">{forestStatus.error}</InlineAlert>
            ) : (
              forestStatus && (
                <p className="text-3xs leading-4 text-muted-foreground">
                  {formatNumber(forestStatus.treeCount)} stems ·{' '}
                  {(forestStatus.inventoryStandCount ?? inventory.stands.length) > 0
                    ? `species and height from ${forestStatus.inventoryStandCount ?? inventory.stands.length} surveyed stands, a regional mix elsewhere`
                    : 'a regional mix; look up the BC inventory to draw what was recorded here'}
                </p>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}
