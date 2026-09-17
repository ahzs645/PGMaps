import {
  Crosshair,
  Download,
  Eye,
  FileUp,
  Gauge,
  Landmark,
  Loader2,
  Magnet,
  MapPin,
  Mountain,
  Pause,
  Play,
  Radar,
  RotateCcw,
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
import { InlineAlert, MapSidebarShell, SidebarSection, ToggleChip } from '@/components/ui/map-panels'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import { summariseUnits, type BcSensitivityUnit } from './bcVisualInventory'
import { ResultsPanel } from './ResultsPanel'
import { ROLE_COLORS, targetAreaHectares, type ForestryScene } from './scene'
import { MAX_DEM_ZOOM, MIN_DEM_ZOOM, demResolutionMeters } from './terrain'
import type { AnalysisSettings, TargetPolygon, TargetRole, Viewpoint } from './types'
import type { AnalysisState, ReverseState } from './useVisibilityAnalysis'
import { lineLengthMeters } from './visibility'
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
}

export type DriveState = {
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
}

const INPUT_CLASS =
  'h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const SELECT_CLASS =
  'h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{hint}</span>}
    </label>
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

type SidebarProps = {
  scene: ForestryScene
  onViewpointChange: (viewpoint: Viewpoint) => void
  onSettingsChange: (settings: AnalysisSettings) => void
  onThresholdsChange: (thresholds: VisualQualityThresholds) => void
  onTargetChange: (targetId: string, patch: Partial<TargetPolygon>) => void
  onRemoveTarget: (targetId: string) => void
  onZoomToTarget: (targetId: string) => void

  drawMode: DrawMode
  onDrawModeChange: (mode: DrawMode) => void
  draftCoordinates: Array<[number, number]>
  onFinishDraft: () => void

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
  forestStatus: { treeCount: number; error: string | null } | null

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
  onClearScene: () => void
  onExport: () => void
}

export function Sidebar({
  scene,
  onViewpointChange,
  onSettingsChange,
  onThresholdsChange,
  onTargetChange,
  onRemoveTarget,
  onZoomToTarget,
  drawMode,
  onDrawModeChange,
  draftCoordinates,
  onFinishDraft,
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
  onClearScene,
  onExport,
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

  const driveVisiblePercent =
    result && driveStation !== null
      ? (result.targets.find((target) => target.targetId === selectedTargetId)?.stations[driveStation]
          ?.visiblePercent ?? null)
      : null

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onImportFile(file)
    event.target.value = ''
  }

  const inventorySummary = summariseUnits(inventory.units)
  // Unrated units stay on the map for context but would swamp a list.
  const ratedUnits = inventory.units.filter((unit) => unit.objectiveId !== null)

  const progressPercent =
    analysis.progress && analysis.progress.total > 0
      ? Math.min(100, (analysis.progress.completed / analysis.progress.total) * 100)
      : 0

  return (
    <MapSidebarShell
      title="Visual quality"
      subtitle="What a road can see of a cutblock"
      className="h-full w-full border-0 shadow-none md:border-r md:shadow-xl"
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onExport} title="Export scene JSON">
            <Download className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClearScene} title="Start over">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <SidebarSection title="Viewpoint" icon={Eye}>
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

        {drawMode === 'spot' || drawMode === 'corridor' ? (
          <div className="mb-3 rounded-md border border-primary/40 bg-primary/5 p-2">
            <p className="text-xs text-foreground">
              {drawMode === 'spot'
                ? 'Click the road to drop the viewpoint.'
                : `Click along the road. ${draftCoordinates.length} point${
                    draftCoordinates.length === 1 ? '' : 's'
                  } so far — double-click or press Finish to close it.`}
            </p>
            <div className="mt-2 flex gap-1.5">
              {drawMode === 'corridor' && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={draftCoordinates.length < 2}
                  onClick={onFinishDraft}
                >
                  Finish
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onDrawModeChange('none')}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-3 w-full"
            onClick={() => onDrawModeChange(viewpoint.mode)}
          >
            <Crosshair className="h-4 w-4" />
            {viewpoint.mode === 'spot' ? 'Place the viewpoint' : 'Draw the road length'}
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
      </SidebarSection>

      <SidebarSection
        title="Polygons"
        icon={TreePine}
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
        <input ref={fileInputRef} type="file" accept=".zip,.geojson,.json" className="hidden" onChange={handleFile} />

        <div className="mb-3 flex gap-1.5">
          <ToggleChip
            active={drawMode === 'block'}
            tone="rose"
            onClick={() => onDrawModeChange(drawMode === 'block' ? 'none' : 'block')}
          >
            <span className="inline-flex items-center gap-1">
              <SquareDashed className="h-3 w-3" /> Draw block
            </span>
          </ToggleChip>
          <ToggleChip
            active={drawMode === 'landscape'}
            tone="cyan"
            onClick={() => onDrawModeChange(drawMode === 'landscape' ? 'none' : 'landscape')}
          >
            <span className="inline-flex items-center gap-1">
              <Mountain className="h-3 w-3" /> Landform
            </span>
          </ToggleChip>
        </div>

        {(drawMode === 'block' || drawMode === 'landscape') && (
          <div className="mb-3 rounded-md border border-primary/40 bg-primary/5 p-2">
            <p className="text-xs text-foreground">
              Click to trace the outline — {draftCoordinates.length} point
              {draftCoordinates.length === 1 ? '' : 's'}. Double-click or press Finish to close it.
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={draftCoordinates.length < 3}
                onClick={onFinishDraft}
              >
                Finish
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onDrawModeChange('none')}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {importMessage && (
          <InlineAlert className="mb-3" tone={importMessage.startsWith('Could not') ? 'error' : 'info'}>
            {importMessage}
          </InlineAlert>
        )}

        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Drop in a zipped shapefile or GeoJSON of cutblocks, or trace one on the map.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {targets.map((target) => (
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
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectTarget(target.id)}>
                    <span className="block truncate text-xs font-medium text-foreground">{target.name}</span>
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

                <div className="mt-1.5 flex items-center gap-1.5 pl-[18px]">
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
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>

      <SidebarSection
        title="BC inventory"
        icon={Landmark}
        actions={
          inventory.units.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onToggleInventory}
            >
              {showInventory ? 'Hide' : 'Show'}
            </Button>
          ) : undefined
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
          {inventory.status === 'loading' ? 'Asking DataBC…' : 'Look up this view'}
        </Button>
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Visual sensitivity units from the province&apos;s visual landscape inventory, with whatever objective and
          absorption capability they carry. Click one on the map or below to use it as the landform.
        </p>

        {inventory.status === 'error' && (
          <InlineAlert className="mt-2" tone="error">
            {inventory.error}
          </InlineAlert>
        )}

        {inventory.status === 'ready' &&
          (inventory.units.length === 0 ? (
            <InlineAlert className="mt-2">
              No sensitivity units cover this view. Inventory coverage is patchy — pan to a mapped scenic area, or keep
              using a drawn or imported landform.
            </InlineAlert>
          ) : (
            <div className="mt-2">
              <p className="text-[11px] text-muted-foreground">
                {inventorySummary.total} units · {inventorySummary.withObjective} with an established objective ·{' '}
                {inventorySummary.withVac} with a VAC rating
                {inventory.truncated ? ' · more exist than were returned' : ''}
                {inventory.harvestCount > 0 ? ` · ${inventory.harvestCount} existing openings` : ''}
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
                          {unit.objectiveId ? visualQualityClass(unit.objectiveId).label : 'No established objective'}
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
      </SidebarSection>

      <SidebarSection title="Objectives" icon={Gauge}>
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
            Table 4 narrows these to one figure per visual absorption capability. Rate a landform&apos;s VAC in the
            polygon list above and the results use that figure instead of the class maximum.
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
      </SidebarSection>

      <SidebarSection title="Terrain and range" icon={Ruler}>
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
            <span className="font-medium text-foreground">Screen with standing timber.</span> Adds the vegetation
            inventory&apos;s projected stand height to the ground along each sightline, so a block behind mature timber
            reads as hidden. Openings and the proposal itself are treated as cleared.
          </span>
        </label>
        <div className="mt-3">
          <NumberField
            label="Sample points per polygon"
            value={settings.sampleBudget}
            min={100}
            max={4000}
            step={100}
            hint="More points resolve the edges of a block; the grid is coarsened automatically if a run would take too long."
            onChange={(value) => onSettingsChange({ ...settings, sampleBudget: value })}
          />
        </div>
      </SidebarSection>

      <SidebarSection title="Analysis" icon={Sparkles}>
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

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 h-7 px-2 text-[11px] text-muted-foreground"
          onClick={onLoadSample}
        >
          Load the Tabor Mountain sample
        </Button>
      </SidebarSection>

      {/* The same question the other way round: rather than picking a road and
          asking what it sees, take the block and find the roads that see it. */}
      <SidebarSection title="Which roads see the block" icon={Radar}>
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
          Reads the roads the basemap is drawing right now, so pan and zoom to the ground you want tested first — roads
          off screen are not searched.
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
            Percentages are the share of the block&rsquo;s ground area in view from one point. Pick a road to make it
            the corridor, then run the full assessment for the figures an objective is judged on.
          </p>
        )}
      </SidebarSection>

      {result && (
        <SidebarSection title="Results" icon={Gauge}>
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

      {result && (
        <SidebarSection title="Drive the view" icon={Route}>
          <Button
            type="button"
            variant={drive.active ? 'secondary' : 'outline'}
            size="sm"
            className="w-full"
            onClick={() => onDriveChange({ active: !drive.active, playing: false })}
          >
            <Eye className="h-4 w-4" />
            {drive.active ? 'Back to the map' : 'Look from the road'}
          </Button>

          {drive.active && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3"
                  disabled={result.stations.length < 2}
                  onClick={() => onDriveChange({ playing: !drive.playing })}
                >
                  {drive.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {drive.playing ? 'Pause' : 'Drive'}
                </Button>
                <select
                  className={SELECT_CLASS}
                  value={drive.speedKmh}
                  onChange={(event) => onDriveChange({ speedKmh: Number(event.target.value) })}
                  aria-label="Travel speed"
                >
                  {[20, 40, 60, 80, 100].map((speed) => (
                    <option key={speed} value={speed}>
                      {speed} km/h
                    </option>
                  ))}
                </select>
                <select
                  className={cn(SELECT_CLASS, 'min-w-0 flex-1')}
                  value={drive.lookAtTargetId ?? ''}
                  onChange={(event) => onDriveChange({ lookAtTargetId: event.target.value || null })}
                  aria-label="Where to look"
                >
                  <option value="">Look along the road</option>
                  {blocks.map((block) => (
                    <option key={block.id} value={block.id}>
                      Face {block.name}
                    </option>
                  ))}
                </select>
              </div>

              {result.stations.length > 1 && (
                <Field
                  label={`Position — ${(drive.positionMeters / 1000).toFixed(2)} km of ${(
                    result.corridorLengthMeters / 1000
                  ).toFixed(2)} km`}
                >
                  <Slider
                    value={[drive.positionMeters]}
                    min={0}
                    max={Math.max(1, result.corridorLengthMeters)}
                    step={10}
                    onValueChange={([value]) => onDriveChange({ positionMeters: value })}
                  />
                </Field>
              )}

              {driveVisiblePercent !== null && (
                <div className="rounded-md border border-border bg-muted/20 p-2">
                  <p className="text-[11px] text-muted-foreground">Visible from here, right now</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {driveVisiblePercent.toFixed(0)}
                    <span className="text-sm">%</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Red ground on the hillside is what this point on the road can see.
                  </p>
                </div>
              )}

              {/* The block as a coloured polygon tells you where it is. The
                  block as the gap where the trees stop tells you whether you
                  can see it, which is the thing the objective is about. */}
              <div className="rounded-md border border-border p-2">
                <ToggleChip active={drive.forest} onClick={() => onDriveChange({ forest: !drive.forest })}>
                  <span className="inline-flex items-center gap-1">
                    <Trees className="h-3 w-3" /> Stand the timber up
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
                        hint="A 28 m tree standing 15 m away fills the sky, so from a narrow road you see timber and nothing else — which is the honest picture, and useless for judging a hillside. Widen this to open the foreground. It changes only what is drawn; the percentages do not move."
                        onChange={(value) => onDriveChange({ roadClearWidthMeters: value })}
                      />
                    </div>
                    {forestStatus?.error ? (
                      <InlineAlert className="mt-2" tone="error">
                        {forestStatus.error}
                      </InlineAlert>
                    ) : (
                      forestStatus !== null && (
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          {forestStatus.treeCount.toLocaleString()} stems standing around the camera.
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

              <NumberField
                label="Terrain exaggeration"
                value={drive.exaggeration}
                min={0.5}
                max={3}
                step={0.1}
                suffix="×"
                hint="1× is true scale. Raise it to read subtle relief, but the percentages stay true-scale."
                onChange={(value) => onDriveChange({ exaggeration: value })}
              />
            </div>
          )}
        </SidebarSection>
      )}
    </MapSidebarShell>
  )
}
