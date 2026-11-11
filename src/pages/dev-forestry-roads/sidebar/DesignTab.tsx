import { useStationReader } from '../roadStation'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { RoadNameField } from '../SharedRoadFields'
import { useEffect, useMemo, useState } from 'react'
import { Layers, Plus, SquareArrowOutUpRight, Trash2, Upload, Waypoints, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CommandButton, type CommandPresentation } from '@/components/interfaces/CommandButton'
import type { WorkspaceCommand } from '@/components/interfaces/workspaceCommands'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { FolderTree, Map as MapIcon, Mountain, Truck } from 'lucide-react'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from '../Controls'
import { HaulGradeFields } from '../HaulGradeFields'
import { AccessReviewPanel } from '../AccessReviewPanel'
import { SkidReachPanel } from '../SkidReachPanel'
import { formatRoadStation } from '../Charts'
import { CurveTools } from '../CurveTools'
import { SwitchbackTools } from '../SwitchbackTools'
import { VerticalDesignControls } from '../VerticalDesignControls'
import { horizontalFitNote, limitedRadius, verticalFitNote } from '../curveFit'
import { distance, horizontalCurveFits, verticalCurveSummary } from '../engine'
import { DEFAULT_ROUTE_OPTIONS, type RouteSearchOptions } from '../routing'
import { MAX_GROUND_WINDOW_M, resolvedGroundWindow } from '../groundTrend'
import { MAX_SEARCH_RADIUS_M, MIN_SEARCH_RADIUS_M, type RoadOptimizationObjective } from '../corridorOptimizer'
import { FullCostRecordSummary } from '../FullCostRecordSummary'
import { CrossingCostControls } from '../CrossingCostControls'
import { RoadSection, SectionReachAlert } from '../SidebarParts'
import { RouteFinder } from '../RouteFinder'
import { RouteAlternativesList } from '../RouteAlternativesList'
import { replaceableRouteAlternatives } from '../routeAlternatives'
import { profileKeptNotice, straightPointIds } from '../horizontalTools'
import type { SidebarProps } from '../DesignSidebarBody'
import { FirstRoadPanel } from '../FirstRoadPanel'
import { isLoadableMappedRoad } from '../mappedRoad'
import { MappedRoadPanel } from '../MappedRoadPanel'
import { SightDistancePanel } from '../SightDistancePanel'
import { RoadGeometryFitPanel } from '../RoadGeometryFitPanel'
import { ProfileGeometryPanel } from '../ProfileGeometryPanel'
import { awaitingFirstRoad } from '../investigationWorkspace'

const id = () => crypto.randomUUID()
const MAX_ALIGNMENTS = 20
/** Why a search waits while a road is being pegged: it would run on the saved road, not the line on the plan. */
const DRAWING_REASON = 'Finish the road being drawn on the plan first'

export function DesignTab(p: SidebarProps) {
  const { project, alignment } = p.workspace
  const full = project.alignments.length >= MAX_ALIGNMENTS
  if (awaitingFirstRoad(project))
    return (
      <FirstRoadPanel
        context={project.context}
        onPeg={() => p.onMode('road')}
        onSketch={() => p.onMode('sketch')}
        onImport={() => p.onFile('alignment')}
        onLoadMappedRoad={(id) => p.onLoadMappedRoad?.(id)}
        onLoadAllInView={p.onLoadMappedRoadsInView}
      />
    )
  const mapped = !!alignment.mappedRoad
  const hasMappedRoads = project.context.some(isLoadableMappedRoad)
  return (
    <>
      <RoadSection
        title="Road"
        actions={
          <Button
            size="icon"
            className="size-7 shrink-0"
            variant="ghost"
            aria-label="Delete active alignment"
            title="Delete this road"
            onClick={p.onRemoveAlignment}
            disabled={project.alignments.length <= 1}
          >
            <Trash2 className="size-3" />
          </Button>
        }
        help={
          <>
            <b>Peg road:</b> click the start, optional middle points, then the end and Finish road.
            <br />
            <b>Sketch:</b> press and drag a road freehand; its corners get the minimum radius. A stroke that starts or
            ends at the active road&apos;s end continues that road.
            <br />
            <b>Extend:</b> peg on from the active road&apos;s nearer end.
            <br />
            <b>Import line:</b> a road line from GeoJSON, a zipped shapefile, KML or KMZ becomes a road with a control
            at every vertex.
            <br />
            <b>Edit points:</b> drag any numbered control; click + between controls to add a middle point.
            <br />
            <b>Inspect</b> returns to station selection. Profile, sections and quantities update when you release a
            drag.
            <br />
            To compare paths, Duplicate road and move its middle controls, then switch with Active road.
          </>
        }
      >
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Active road">
              <RoadSelect
                ariaLabel="Active road"
                className={roadFieldClass}
                value={alignment.id}
                onValueChange={(value) => {
                  // The same selection as the road switcher: it also clears previews and the station.
                  if (p.onSelectRoad) p.onSelectRoad(value)
                  else p.workspace.update((x) => ({ ...x, activeAlignmentId: value }))
                  p.onProfile('')
                  p.onPoint(null)
                }}
              >
                {project.alignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </RoadSelect>
            </Field>
            <RoadNameField workspace={p.workspace} />
          </div>
          {/* Two rows of two: four labelled buttons do not fit the sidebar's width on one line. The
              buttons are the registry's commands, so their enable rules match the ribbon's. */}
          <div className="grid grid-cols-2 gap-1">
            {CREATE_TOOLS.map((id) => (
              <CommandButton
                key={id}
                id={id}
                surface="sidebar"
                state={p.commandStates?.[id]}
                presentation={createToolPresentation(id, mapped)}
                onRun={(command) => p.onCommand?.(command)}
              />
            ))}
          </div>
          {hasMappedRoads && p.onLoadMappedRoadsInView && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full gap-1"
              title="Load every mapped road in the plan's view as its own road, each in its own colour"
              onClick={p.onLoadMappedRoadsInView}
              disabled={full}
            >
              <Layers className="size-3" /> Load mapped roads in view
            </Button>
          )}
        </div>
      </RoadSection>
      {mapped && (
        <MappedRoadPanel
          workspace={p.workspace}
          full={full}
          onCopyAsDesign={() => p.onCopyMappedRoad?.()}
          onCompareRoutes={() => p.onSuggest(project.routeSearch ?? DEFAULT_ROUTE_OPTIONS)}
          onLocate={p.onLocateActiveRoad}
          onStation={(chainage) => p.workspace.setStation(chainage)}
          onLoadTerrain={p.onLoadTerrainAroundRoad}
          onPreviewTerrainRoad={p.onPreviewTerrainRoad}
        />
      )}
      {mapped && (
        <RoadGeometryFitPanel workspace={p.workspace} full={full} onCopy={(points) => p.onCopyMappedRoad?.(points)} />
      )}
      {mapped && <SightDistancePanel workspace={p.workspace} />}
      {mapped && <ProfileGeometryPanel workspace={p.workspace} />}
      {mapped && <RouteFinding {...p} full={full} />}
      {!mapped && <DesignRoadSections {...p} full={full} />}
    </>
  )
}

/** The editing tools of a designed road; a mapped road is held as recorded and shows none of them. */
function DesignRoadSections(p: SidebarProps & { full: boolean }) {
  const { project, alignment } = p.workspace
  const full = p.full
  return (
    <>
      <RouteFinder
        workspace={p.workspace}
        full={full}
        drawing={p.drawing}
        onPegRoad={() => p.onMode('road')}
        onPreview={p.onPreviewRoutes}
        onShowCompare={p.onShowCompare}
        onSelectRoad={p.onSelectRoad}
      />
      <AccessReviewPanel {...p} full={full} />
      <SkidReachPanel {...p} />
      <RouteFinding {...p} full={full} />
      <HorizontalPoints {...p} />
      <VerticalAlignment {...p} />
      <VerticalDesignControls workspace={p.workspace} />
      <SightDistancePanel workspace={p.workspace} />
      <ProfileGeometryPanel workspace={p.workspace} />
      <SwitchbackTools
        key={alignment.id}
        workspace={p.workspace}
        readOnly={p.readOnlyPreview}
        onCreated={() => {
          p.onPoint(null)
          p.onProfile('')
          p.onMode('inspect')
        }}
      />
      <CrossingCostControls workspace={p.workspace} />
      <div className="space-y-1 p-3" data-testid="road-design-tools">
        {/* Equal rows, so every card is the size of the tallest label. */}
        <div className="grid auto-rows-fr grid-cols-2 gap-1">
          {p.onPlanNetwork && (
            <div data-testid="network-planning-controls" className="contents">
              <ToolButton
                icon={FolderTree}
                label="Plan road network"
                onClick={p.onPlanNetwork}
                disabled={!!p.workspace.busy}
                help="Connect several landings to selected roads, compare network methods and stage future access."
              />
            </div>
          )}
          <div data-testid="full-cost-planning-controls" className="contents">
            <ToolButton
              icon={MapIcon}
              label="Compare complete route costs"
              onClick={p.onCompareCompleteCosts}
              disabled={!!p.workspace.busy}
              help="Construction, connected road reuse, rehabilitation and delivered gravel together. Each candidate must pass final curve, loaded-grade and road-footprint checks."
            />
          </div>
          <ToolButton icon={Mountain} label="Review existing roads" onClick={p.onShowExistingRoads} />
          <ToolButton icon={Truck} label="Gravel & aggregate costs" onClick={p.onShowEngineering} />
        </div>
        <FullCostRecordSummary alignment={alignment} project={project} onOpenComparison={p.onCompareCompleteCosts} />
      </div>
    </>
  )
}

/** A tool that opens somewhere else: its name on a tile, and what it does behind an (i). */
function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  help,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  disabled?: boolean
  help?: string
}) {
  return (
    <div className="relative flex">
      <Button
        variant="outline"
        size="sm"
        className="h-auto min-h-12 w-full flex-1 flex-col gap-1 whitespace-normal px-2 py-1.5 text-center text-xs"
        onClick={onClick}
        disabled={disabled}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </Button>
      {help && (
        <InfoTip label={`About ${label.toLowerCase()}`} className="absolute right-0.5 top-0.5">
          {help}
        </InfoTip>
      )}
    </div>
  )
}

function RouteFinding(p: SidebarProps & { full: boolean }) {
  const [livePreview, setLivePreview] = useState(false)
  const { onPreviewRoute } = p
  const { project, source, alignment } = p.workspace
  const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
  const setRoute = (change: (current: RouteSearchOptions) => RouteSearchOptions) =>
    p.workspace.update((current) => ({
      ...current,
      routeSearch: change(current.routeSearch ?? DEFAULT_ROUTE_OPTIONS),
    }))
  useEffect(() => {
    if (!onPreviewRoute) return
    if (!livePreview) {
      onPreviewRoute(null)
      return
    }
    const timer = window.setTimeout(() => onPreviewRoute({ ...route, alternatives: 1 }), 500)
    return () => window.clearTimeout(timer)
  }, [livePreview, route, project.settings, project.context, source, alignment.id, alignment.points, onPreviewRoute])
  useEffect(() => () => onPreviewRoute?.(null), [onPreviewRoute])
  const eligibleRoads = project.context.filter(
    (feature) =>
      feature.kind === 'existing-road' &&
      feature.roadEvidence?.reuseAllowed &&
      feature.roadEvidence.condition !== 'closed',
  ).length
  const [objective, setObjective] = useState<RoadOptimizationObjective>('balanced')
  const [halfWidth, setHalfWidth] = useState(180)
  const validCorridorSettings =
    project.settings.maxGradePercent >= 1 &&
    project.settings.maxGradePercent <= 30 &&
    project.settings.minRadius >= 0 &&
    project.settings.minRadius <= MAX_SEARCH_RADIUS_M
  const validWidth = Number.isFinite(halfWidth) && halfWidth >= 25 && halfWidth <= 1000
  return (
    <CollapsibleSection
      label="Search tools"
      summary="Grid, corridor, FSR"
      summaryWhenCollapsedOnly
      toggleProps={{ 'data-testid': 'road-route-tools' }}
      contentClassName="space-y-3 px-3 pb-3"
    >
      <div className="space-y-2" data-testid="road-route-options">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Terrain-cost search</p>
          <InfoTip label="About terrain-cost search">
            An eight-neighbour search between the road's endpoints. Its score is road $/m scaled by sampled grade, plus
            each stream crossing and the $/m of any avoidance area given a zone cost: a ranking figure, not an estimate,
            and the defaults are placeholders. Each route found becomes a road with curves of at least the minimum
            radius where they fit and stay on the terrain; a corner that cannot take one stays sharp and is flagged.
            Clearance and terrain-slope inputs screen the centreline, not the final road footprint. Headings hold the
            first and last legs within ±45°.
          </InfoTip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Maximum grade %"
            value={project.settings.maxGradePercent}
            min={0.1}
            max={100}
            step={0.5}
            hint="Absolute sampled ground grade for this route search; the designed vertical profile is checked separately."
            onChange={(maxGradePercent) =>
              p.workspace.update((current) => ({ ...current, settings: { ...current.settings, maxGradePercent } }))
            }
          />
          <NumberField
            label="Minimum radius (m)"
            value={project.settings.minRadius}
            min={0}
            max={10000}
            step={5}
            hint={`Curves fitted to a found route are at least this radius; a corner too tight for one stays sharp and is flagged. The corridor optimizer and the curve checks use it too. 0 sets no minimum: curves are then fitted from ${MIN_SEARCH_RADIUS_M} m up and none is flagged as tight.`}
            onChange={(minRadius) =>
              p.workspace.update((current) => ({ ...current, settings: { ...current.settings, minRadius } }))
            }
          />
          <OptionalNumberField
            label="Terrain slope limit %"
            value={route.maxTerrainSlopePercent}
            min={1}
            max={300}
            step={5}
            hint="Optional maximum magnitude of the terrain gradient, measured east/west and north/south. Missing neighbour samples block the route. This is not a slope-stability assessment."
            onChange={(maxTerrainSlopePercent) => setRoute((current) => ({ ...current, maxTerrainSlopePercent }))}
          />
          <NumberField
            label="Slope sample ±m"
            value={route.terrainSlopeSampleM}
            min={1}
            max={100}
            step={1}
            disabled={route.maxTerrainSlopePercent === null}
            onChange={(terrainSlopeSampleM) => setRoute((current) => ({ ...current, terrainSlopeSampleM }))}
          />
          <NumberField
            label="Exclusion clearance (m)"
            value={route.exclusionBufferM}
            max={500}
            step={5}
            hint="Centreline distance outside blocked exclusion polygons and lines. Set this to cover the expected road/clearing width and your project-specific setback. Cost zones stay passable."
            onChange={(exclusionBufferM) => setRoute((current) => ({ ...current, exclusionBufferM }))}
          />
          <NumberField
            label="Ground trend (m)"
            ariaLabel="Route search ground trend metres"
            value={resolvedGroundWindow(route, project.terrain.resolutionM)}
            max={MAX_GROUND_WINDOW_M}
            step={2}
            hint="Grades are judged on ground averaged over this width, so micro-relief in a 1 m DTM does not block a route. Sections and quantities always use the source terrain."
            onChange={(groundWindowM) => setRoute((current) => ({ ...current, groundWindowM }))}
          />
          <OptionalNumberField
            label="Search margin (m)"
            value={route.searchMarginM}
            min={20}
            max={1000}
            step={20}
            placeholder="automatic"
            onChange={(searchMarginM) => setRoute((current) => ({ ...current, searchMarginM }))}
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={route.allowStreamCrossings}
            onChange={(event) => setRoute((current) => ({ ...current, allowStreamCrossings: event.target.checked }))}
          />
          Allow priced stream crossings
        </label>
        {!route.allowStreamCrossings && (
          <NumberField
            label="Stream clearance (m)"
            value={route.streamBufferM}
            max={500}
            step={5}
            hint="Distance from imported stream linework when crossings are forbidden. This is an entered screening distance, not an automatic legal riparian classification. Import assessed riparian polygons as exclusions."
            onChange={(streamBufferM) => setRoute((current) => ({ ...current, streamBufferM }))}
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={route.reuseExistingRoads}
            onChange={(event) => setRoute((current) => ({ ...current, reuseExistingRoads: event.target.checked }))}
          />
          Prefer reviewed existing roads ({eligibleRoads} eligible)
        </label>
        {route.reuseExistingRoads && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Retained road cost %"
                value={route.existingRoadCostFactor * 100}
                min={5}
                max={100}
                step={5}
                hint="Portion of base road cost retained near eligible existing roads. Include rehabilitation in this assumption. Mark roads eligible after reviewing access and condition; proximity does not verify a connection."
                onChange={(percent) => setRoute((current) => ({ ...current, existingRoadCostFactor: percent / 100 }))}
              />
              <NumberField
                label="Road proximity (m)"
                value={route.roadSnapDistanceM}
                min={1}
                max={50}
                step={1}
                onChange={(roadSnapDistanceM) => setRoute((current) => ({ ...current, roadSnapDistanceM }))}
              />
            </div>
          </>
        )}
        <div className="grid grid-cols-3 gap-1">
          <NumberField
            label="Road $/m"
            value={route.baseCostPerM}
            min={0.01}
            max={100000}
            step={10}
            onChange={(baseCostPerM) => setRoute((r) => ({ ...r, baseCostPerM }))}
          />
          <NumberField
            label="Crossing $"
            value={route.crossingCost}
            max={1e8}
            step={500}
            onChange={(crossingCost) => setRoute((r) => ({ ...r, crossingCost }))}
          />
          <NumberField
            label="Alternatives"
            value={route.alternatives}
            min={1}
            max={5}
            step={1}
            onChange={(alternatives) => setRoute((r) => ({ ...r, alternatives: Math.round(alternatives) }))}
          />
          <OptionalNumberField
            label="Start heading °"
            value={route.startHeading}
            min={0}
            max={360}
            step={5}
            onChange={(startHeading) => setRoute((r) => ({ ...r, startHeading }))}
          />
          <OptionalNumberField
            label="End heading °"
            value={route.endHeading}
            min={0}
            max={360}
            step={5}
            onChange={(endHeading) => setRoute((r) => ({ ...r, endHeading }))}
          />
        </div>
        <HaulGradeFields
          value={route.haulGrades}
          onChange={(haulGrades) => setRoute((current) => ({ ...current, haulGrades }))}
        />
        {onPreviewRoute && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={livePreview} onChange={(event) => setLivePreview(event.target.checked)} />
            Live route preview
          </label>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!!p.drawing || (p.full && !replaceableRouteAlternatives(project.alignments, alignment.id).length)}
          title={p.drawing ? DRAWING_REASON : undefined}
          onClick={() => p.onSuggest(route)}
        >
          Suggest terrain-cost {route.alternatives > 1 ? 'alternatives' : 'alternative'}
        </Button>
        <RouteAlternativesList workspace={p.workspace} onSelectRoad={p.onSelectRoad} />
      </div>
      <div className="space-y-2 border-t pt-3" data-testid="road-corridor-optimizer">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Optimize sketched road corridor</p>
          <InfoTip label="About the corridor optimizer">
            Peg two endpoints and any guide points first; the sketched shape is the centre of the search corridor. It
            uses the current grade and minimum-radius settings as screening inputs, and every result is a new, editable
            road alternative. It uses grade, radius and mapped exclusions only; the slope, stream and reuse settings
            above apply to the terrain-cost and FSR searches. Not a certified road design.
            <br />
            <b>Shortest</b> penalises grade least. <b>Balanced</b> weighs grade, length and curves.{' '}
            <b>Contour-friendly</b> favours gentler terrain.
          </InfoTip>
        </div>
        {!validCorridorSettings && (
          <InlineAlert tone="warning">
            Corridor search requires a grade limit of 1–30% and a minimum radius of at most{' '}
            {MAX_SEARCH_RADIUS_M.toLocaleString('en-CA')} m. Adjust the shared fields above to enable it.
          </InlineAlert>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Preference">
            <RoadSelect
              ariaLabel="Corridor optimization objective"
              className={roadFieldClass}
              value={objective}
              onValueChange={(value) => setObjective(value as RoadOptimizationObjective)}
            >
              <option value="shortest">Shortest</option>
              <option value="balanced">Balanced</option>
              <option value="contour">Contour-friendly</option>
            </RoadSelect>
          </Field>
          <Field label="Width each side (m)">
            <input
              aria-label="Corridor half-width metres"
              type="number"
              min={25}
              max={1000}
              step={25}
              className={roadFieldClass}
              value={halfWidth}
              onChange={(e) => setHalfWidth(Number(e.target.value))}
            />
          </Field>
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={!!p.drawing || p.full || !validWidth || !validCorridorSettings}
          title={p.drawing ? DRAWING_REASON : undefined}
          onClick={() => p.onOptimize(objective, halfWidth)}
        >
          Optimize sketched corridor
        </Button>
      </div>
    </CollapsibleSection>
  )
}

function HorizontalPoints(p: SidebarProps) {
  const { project, alignment, updateAlignment, source } = p.workspace
  const point = alignment.points.find((x) => x.id === p.selectedPoint)
  const straight = useMemo(() => straightPointIds(alignment.points), [alignment.points])
  // A point picked on the map shows its fields, wherever this section was left.
  const [open, setOpen] = useState(false)
  const [shownPoint, setShownPoint] = useState(point?.id)
  if (point?.id !== shownPoint) {
    setShownPoint(point?.id)
    if (point) setOpen(true)
  }
  const movePoint = (axis: 0 | 1, value: number) => {
    updateAlignment((a) => ({
      ...a,
      points: a.points.map((x) =>
        x.id === point?.id ? { ...x, coordinate: axis === 0 ? [value, x.coordinate[1]] : [x.coordinate[0], value] } : x,
      ),
    }))
    const kept = profileKeptNotice(alignment.vertical.length)
    if (kept) p.workspace.setNotice(kept)
  }
  // What became of the radius typed at this point: held to the range, or not fitted to its legs.
  const [limited, setLimited] = useState<{ pointId: string; radiusM: number; note: string } | null>(null)
  const limitedNote =
    limited && limited.pointId === point?.id && limited.radiusM === point.radiusM ? limited.note : null
  const fitNote = useMemo(() => {
    if (!point) return null
    try {
      return horizontalFitNote(horizontalCurveFits(alignment).find((fit) => fit.pointId === point.id))
    } catch {
      // An alignment that cannot be compiled is reported by the workspace.
      return null
    }
  }, [alignment, point])
  return (
    <RoadSection
      title="Horizontal points"
      summary={`${alignment.points.length} points · ${alignment.points.filter((x) => x.radiusM > 0).length} curves${straight.length ? ` · ${straight.length} straight` : ''}`}
      open={open}
      onOpenChange={setOpen}
      help="Each control point is an intersection point (IP, also written PI): where two straight legs of the road meet. Select one to type its position, radius and spirals, or use the bulk tools to fit every corner at once. Sharp corners need a fitted radius before the road is a design."
    >
      {straight.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="mb-2 h-7 w-full text-xs"
          onClick={() => {
            updateAlignment((a) => ({ ...a, points: a.points.filter((x) => !straight.includes(x.id)) }))
            p.onPoint(null)
            p.workspace.setNotice(
              `Removed ${straight.length} point${straight.length === 1 ? '' : 's'} that did not shape the road.`,
            )
          }}
        >
          Remove {straight.length} straight point{straight.length === 1 ? '' : 's'}
        </Button>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1">
        <RoadSelect
          ariaLabel="Selected horizontal point"
          className={roadFieldClass}
          value={point?.id ?? ''}
          onValueChange={(value) => {
            p.onPoint(value)
            p.onMode('edit')
          }}
        >
          <option value="">Select a control point</option>
          {alignment.points.map((x, i) => (
            <option key={x.id} value={x.id}>
              Point {i + 1}
              {i === 0 ? ' · start' : i === alignment.points.length - 1 ? ' · end' : ''} · radius {x.radiusM} m
            </option>
          ))}
        </RoadSelect>
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          aria-label="Select start"
          title="Select the start point"
          onClick={() => {
            p.onMode('edit')
            p.onPoint(alignment.points[0]?.id ?? null)
          }}
        >
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2 text-xs"
          aria-label="Select end"
          title="Select the end point"
          onClick={() => {
            p.onMode('edit')
            p.onPoint(alignment.points.at(-1)?.id ?? null)
          }}
        >
          End
        </Button>
      </div>
      {point && (
        <div className="mt-2 space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Longitude"
              value={point.coordinate[0]}
              min={-180}
              max={180}
              step={0.00001}
              onChange={(value) => movePoint(0, value)}
            />
            <NumberField
              label="Latitude"
              value={point.coordinate[1]}
              min={-85}
              max={85}
              step={0.00001}
              onChange={(value) => movePoint(1, value)}
            />
            {/* The field's own limit would change a typed value without a word; `limitedRadius` says so. */}
            <NumberField
              label="Horizontal radius (m)"
              value={point.radiusM}
              max={1e9}
              step={1}
              onChange={(entered) => {
                const { radiusM, note } = limitedRadius(entered)
                // Leaving the field repeats the value now shown; that must not withdraw the note.
                setLimited((shown) =>
                  note
                    ? { pointId: point.id, radiusM, note }
                    : shown?.pointId === point.id && shown.radiusM === radiusM
                      ? shown
                      : null,
                )
                updateAlignment((a) => ({
                  ...a,
                  points: a.points.map((x) => (x.id === point.id ? { ...x, radiusM } : x)),
                }))
              }}
            />
            <NumberField
              label="Spiral length each side (m)"
              value={point.spiralM ?? 0}
              max={2000}
              step={5}
              onChange={(spiralM) =>
                updateAlignment((a) => ({
                  ...a,
                  points: a.points.map((x) => {
                    if (x.id !== point.id) return x
                    const { spiralM: _old, ...rest } = x
                    void _old
                    return spiralM > 0 ? { ...rest, spiralM } : rest
                  }),
                }))
              }
            />
          </div>
          {(limitedNote || fitNote) && (
            <div data-testid="road-radius-note">
              <InlineAlert tone="warning">{[limitedNote, fitNote].filter(Boolean).join(' ')}</InlineAlert>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={alignment.points.length <= 2}
            onClick={() => {
              updateAlignment((a) => ({ ...a, points: a.points.filter((x) => x.id !== point.id) }))
              p.onPoint(null)
            }}
          >
            <Trash2 className="mr-1 size-3" />
            Remove selected point
          </Button>
        </div>
      )}
      <CurveTools workspace={p.workspace} />
      <details className="mt-2">
        <summary className="cursor-pointer text-xs">Segment distances & ground grades</summary>
        <div className="mt-2 max-h-48 overflow-auto overscroll-none">
          <EngineeringTable>
            <thead>
              <tr>
                <ColumnHeader label="Leg" />
                <ColumnHeader label="Distance" unit="m" />
                <ColumnHeader label="Ground" unit="%" />
              </tr>
            </thead>
            <tbody>
              {alignment.points.slice(1).map((b, i) => {
                const a = alignment.points[i],
                  length = distance(a.coordinate, b.coordinate),
                  za = source.elevationAt(...a.coordinate),
                  zb = source.elevationAt(...b.coordinate),
                  grade = length > 0 && Number.isFinite(za + zb) ? ((zb - za) / length) * 100 : null
                return (
                  <tr key={b.id}>
                    <td>
                      {i + 1}–{i + 2}
                    </td>
                    <td>{length.toFixed(1)}</td>
                    <td
                      className={
                        grade !== null && Math.abs(grade) > project.settings.maxGradePercent ? 'text-red-600' : ''
                      }
                    >
                      {grade?.toFixed(1) ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </EngineeringTable>
        </div>
      </details>
    </RoadSection>
  )
}

function VerticalAlignment(p: SidebarProps) {
  const { alignment, analysis, updateAlignment } = p.workspace
  const readStation = useStationReader(p.workspace)
  // Why an entered vertical curve was not applied, by PVI.
  const fitNotes = useMemo(() => {
    try {
      return new Map(verticalCurveSummary(alignment).map((curve) => [curve.pviId, verticalFitNote(curve)]))
    } catch {
      // Invalid PVIs are reported by the workspace.
      return new Map<string, string | null>()
    }
  }, [alignment])
  const addPvi = () => {
    const station = readStation()
    const at = analysis.stations.reduce(
      (best, s) => (Math.abs(s.chainage - station) < Math.abs(best.chainage - station) ? s : best),
      analysis.stations[0],
    )
    if (!at || at.groundElevation === null) return
    updateAlignment((a) => ({
      ...a,
      vertical: [
        ...a.vertical.filter((v) => Math.abs(v.chainage - at.chainage) > 0.05),
        { id: id(), chainage: at.chainage, elevation: at.designElevation ?? at.groundElevation!, curveLength: 0 },
      ].sort((a, b) => a.chainage - b.chainage),
    }))
  }
  return (
    <RoadSection
      title="Vertical alignment"
      summary={
        alignment.vertical.length
          ? `${alignment.vertical.length} PVIs · ${analysis.maxGradePercent.toFixed(1)}%`
          : 'Following the ground'
      }
      help="A PVI is a point of vertical intersection: where two grade lines of the profile meet. Drag the diamonds in the profile, double-click the profile to add a PVI, or edit the points here. Levels are formation centre elevations; curve lengths are metres. Follow ground removes every PVI."
    >
      <div className="flex gap-1">
        <Button size="sm" variant="outline" className="flex-1" onClick={addPvi}>
          <Plus className="mr-1 size-3" />
          Add PVI at station
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1"
          disabled={!alignment.vertical.length}
          onClick={() => updateAlignment((a) => ({ ...a, vertical: [] }))}
        >
          Follow ground
        </Button>
      </div>
      {!alignment.vertical.length && (
        <InlineAlert tone="info" className="mt-2">
          Following the ground. Add PVIs to design formation levels.
        </InlineAlert>
      )}
      <SectionReachAlert workspace={p.workspace} />
      {alignment.vertical.length > 0 && (
        <div className="mt-2" data-testid="road-pvi-list">
          <div className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_1.5rem] gap-1 px-0.5 pb-1 text-2xs text-muted-foreground">
            <span />
            <span>Station</span>
            <span>Level</span>
            <span>Curve m</span>
            <span />
          </div>
          <div className="space-y-1">
            {alignment.vertical.map((v, i) => (
              <div key={v.id} className="grid grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_1.5rem] items-center gap-1">
                {fitNotes.get(v.id) && (
                  <p
                    className="order-last col-span-full text-2xs text-amber-800 dark:text-amber-300"
                    role="status"
                    data-testid="road-pvi-curve-note"
                  >
                    {fitNotes.get(v.id)}
                  </p>
                )}
                <button
                  className="text-left text-2xs font-medium tabular-nums text-muted-foreground hover:text-foreground"
                  title={`Go to ${formatRoadStation(v.chainage)}`}
                  aria-label={`PVI ${i + 1} · ${formatRoadStation(v.chainage)}`}
                  onClick={() => p.workspace.setStation(v.chainage)}
                >
                  {i + 1}
                </button>
                {(['chainage', 'elevation', 'curveLength'] as const).map((key) => (
                  <NumberField
                    key={key}
                    hideLabel
                    label={key === 'chainage' ? 'Station' : key === 'elevation' ? 'Level' : 'Curve length (m)'}
                    ariaLabel={
                      key === 'chainage'
                        ? `PVI ${i + 1} station`
                        : key === 'elevation'
                          ? `PVI ${i + 1} level`
                          : `PVI ${i + 1} curve`
                    }
                    value={v[key]}
                    min={key === 'elevation' ? -1000 : 0}
                    max={key === 'elevation' ? 9000 : key === 'chainage' ? Math.max(analysis.length, v.chainage) : 2000}
                    step={key === 'elevation' ? 0.1 : 1}
                    onChange={(value) =>
                      updateAlignment((a) => ({
                        ...a,
                        vertical: a.vertical
                          .map((x) => (x.id === v.id ? { ...x, [key]: value } : x))
                          .sort((a, b) => a.chainage - b.chainage),
                      }))
                    }
                  />
                ))}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 touch:size-9"
                  aria-label={`Remove PVI ${i + 1}`}
                  onClick={() => updateAlignment((a) => ({ ...a, vertical: a.vertical.filter((x) => x.id !== v.id) }))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </RoadSection>
  )
}

/** The Design tab's create tools: registry commands, captioned to fit the sidebar's two columns. */
const CREATE_TOOLS: WorkspaceCommand[] = ['peg', 'sketch', 'extend', 'duplicateRoad', 'importAlignment', 'traceRoad']

function createToolPresentation(id: WorkspaceCommand, mapped: boolean): CommandPresentation {
  switch (id) {
    case 'peg':
      return { emphasis: 'primary' }
    case 'sketch':
      return { shortLabel: 'Sketch', title: 'Press and drag to sketch a road freehand' }
    case 'extend':
      return {
        shortLabel: 'Extend',
        icon: <SquareArrowOutUpRight className="size-3" />,
        title: mapped ? 'Copy this mapped road as a design to extend it' : 'Peg on from the nearer end of this road',
      }
    case 'duplicateRoad':
      return {
        ariaLabel: mapped ? 'Copy mapped road as a design' : 'Duplicate active alignment',
        caption: mapped ? 'Copy as design' : 'Duplicate',
        title: mapped
          ? 'An editable design on this mapped line'
          : 'Keep this road and edit a separate path alternative',
      }
    case 'importAlignment':
      return {
        shortLabel: 'Import line',
        icon: <Upload className="size-3" />,
        title: 'A road line from GeoJSON, a zipped shapefile, KML or KMZ',
      }
    case 'traceRoad':
      return {
        shortLabel: 'Trace road',
        icon: <Waypoints className="size-3" />,
        title:
          'Click along an existing road seen on imagery; on LiDAR the line follows the road bench. Adds an existing road to connect to.',
      }
    default:
      return {}
  }
}
