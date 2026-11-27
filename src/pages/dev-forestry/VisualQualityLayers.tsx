import { useMemo, useState, type ComponentProps } from 'react'
import { MapMarker, MapPopup, MapScaleBar, MarkerContent } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { ViewshedOverlay, VIEWSHED_COLORS } from '@/features/terrain-viewshed'
import { ROAD_VIEW_GUIDE_SOURCE } from './mapCapture'
import { BasemapContextProbe, type BasemapContext } from './BasemapContextProbe'
import { FigureStyleLayers, type FigureStyleData } from './FigureStyleLayers'
import { ForestOverlay, type ForestStatus } from './ForestOverlay'
import { MovingResolution } from './MovingResolution'
import { GroundRelief } from './GroundRelief'
import { FIXED_TREE_SUN } from './treeLayer'
import { MapDrawCapture } from './MapDrawCapture'
import { MapSketchDraft } from '@/components/ui/map-sketch'
import { SatelliteImagery } from '@/components/ui/map-satellite-imagery'
import type { LandformVantagePoint } from './TerrainLandformFinder'
import type { BcSensitivityUnit } from './bcVisualInventory'
import {
  candidateLegendKey,
  clueLegendKey,
  evqoLegendKey,
  inventoryPointLegendKey,
  maskLegendKey,
  sampleLegendKey,
  standTreeLegendKey,
  unitLegendKey,
  withoutHiddenFeatures,
  type PlanShow,
} from './planLayers'
import {
  ASSESSMENT_VIEWPOINT_COLOR,
  EXPOSURE_RAMP,
  FACE_CANDIDATE_COLOR,
  INVENTORY_COLORS,
  LANDFORM_CLUE_COLORS,
  MASK_COLORS,
  OTHER_RIDGE_LAYER_COLOR,
  ROAD_COLOR,
  TREE_FREE_COLOR,
  SCREENED_COLOR,
  SENSITIVITY_UNIT_COLOR,
  STAND_TREE_COLORS,
  TERRAIN_CANDIDATE_COLOR,
  VISIBLE_FACE_CANDIDATE_COLOR,
  UNKNOWN_COLOR,
  VISIBLE_COLOR,
} from './planMapStyle'
import { ROLE_COLORS, type ForestryScene } from './scene'
import type { DriveState } from './Sidebar'
import type { AnalysisResult } from './types'
import type { useRouteViewshed } from './useRouteViewshed'
import { viewpointCandidateSummary, type CandidateArrow, type ViewpointCandidate } from './viewpointInventory'
import { compassPoint } from './visualsNarrative'
import { EVQO_COLORS } from './visualsNarrative'

type Collection = GeoJSON.FeatureCollection
const EMPTY_COLLECTION: Collection = { type: 'FeatureCollection', features: [] }
const NOTHING_HIDDEN: PlanShow['hidden'] = new Set()
/** Lakes and rivers in the road view: a still-water blue, with a lighter shoreline. */
const ROAD_VIEW_WATER_COLOR = '#3f6f99'
/**
 * Inventory ground cover as the road view draws it, as MapLibre `match`
 * pairs. Meadow and herb are paler than forest floor, rock grey, wetland a
 * dull olive, shrub a mid green; water matches the mapped lakes.
 */
const GROUND_COVER_FILL = [
  'water',
  ROAD_VIEW_WATER_COLOR,
  'wetland',
  '#6b6f45',
  'rock',
  '#8f8b84',
  'herb',
  '#8b9a5a',
  'shrubLow',
  '#6d7f48',
  'shrubTall',
  '#4f6a3c',
]
const ROAD_VIEW_SHORE_COLOR = '#9cc0d8'

/** Everything the scene's layers draw, built once by the page and handed to both maps. */
export type SceneLayerData = {
  drive: DriveState
  scene: ForestryScene
  result: AnalysisResult | null
  preliminaryDrive: boolean
  planShow: PlanShow
  showInventory: boolean
  inventory: { units: BcSensitivityUnit[] }
  selectedTargetId: string | null
  drawMode: string
  driveStationIndex: number
  driveEye: { lng: number; lat: number } | null
  routeViewshed: ReturnType<typeof useRouteViewshed>
  routeOutline: Collection
  forestConfiguration: ComponentProps<typeof ForestOverlay>['configuration']
  /** The stand's placed patches, kept across the road view's map closing and reopening. */
  forestPatches: ComponentProps<typeof ForestOverlay>['patches']
  /** The background band's ground and inventory once read (View options → *Distant trees*); null until then. */
  forestBackground: ComponentProps<typeof ForestOverlay>['background']
  /** The background band's read is still out: the stand is not ready until it comes or fails. */
  forestBackgroundPending: boolean
  /** Where the drawn trees' light comes from; null the fixed light (`ForestOverlay`'s `sun`). */
  treeSun: ComponentProps<typeof ForestOverlay>['sun']
  /** Whether the nearest trees lay shadows on the ground (`ForestOverlay`'s `shadows`). */
  treeShadows: boolean
  viewingGapTarget: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
  previewTerrainMessage: string | null
  /** Where "Find a landform from the terrain" reads from: a picked point or an inventory viewpoint. */
  landformVantage: LandformVantagePoint | null
  /** Ground the road view draws without timber, outlined on the plan. */
  treeFreeCollection: Collection
  /**
   * Stand prescriptions' trees on the plan, `status` kept, removed or protected (`standTreeCollection`).
   * A click protects or frees one, except while the road view is open, when a plan click moves it.
   */
  standTreeCollection: Collection
  /** The stand profile's strip while the prescription dialog shows it (`profileStripPolygon`). */
  standStripCollection: Collection
  forestGround: { floor: Collection; shade: Collection; soil: Collection; water: Collection; cover: Collection }
  previewRoad: Collection
  /** The road's cut bank and fill slope, by `kind`. */
  previewRoadScar: Collection
  basemapBounds: [number, number, number, number] | null
  mapPick: { onPoint: (point: [number, number]) => void } | null
  inventoryCollection: Collection
  terrainCandidateCollection: Collection
  ridgeLayerCollection: Collection
  viewpointLayers: { screenings: Collection; arrows: Collection; points: Collection }
  standingArrows: Collection
  viewpointCandidates: ViewpointCandidate[]
  landformClues: Collection
  landscapeCollection: Collection
  evqoDisplay: { collection: Collection } | null
  harvestedCollection: Collection
  previewBlockCollection: Collection
  blockCollection: Collection
  harvestedGroundColor: unknown
  maskCollection: Collection
  hazeCollection: Collection
  /** The scene's data by VIA figure role, for the road view's figure style (`drive.figureStyle`). */
  figureStyleData: FigureStyleData
  /** Every station's union, for the plan; the road view's own station, for the eye. */
  sampleCollection: Collection
  eyeSampleCollection: Collection
  reverseRoadCollection: Collection
  corridorCollection: Collection
  corridorExposureCollection: Collection
  stationCollection: Collection
  spotCollection: Collection
  /** The shape being drawn, as the shared sketch draws it (`map-sketch.tsx`). */
  draftCoordinates: Array<[number, number]>
  /** The measure tool is in hand: plan clicks are its points, not selections. */
  measuring: boolean
  inventoryHoverHtml: (properties: Record<string, unknown>) => string | null
  viewpointHoverHtml: (properties: Record<string, unknown>) => string | null
  targetHoverHtml: (properties: Record<string, unknown>) => string | null
  setForestStatus: (status: ForestStatus) => void
  setBasemap: (context: BasemapContext) => void
  setMapPick: (pick: null) => void
  setSelectedTargetId: (id: string) => void
  handleMapPoint: (point: [number, number]) => void
  finishDraft: () => void
  /** Takes the draft's last point back (Backspace with the map focused). */
  removeLastDraftPoint: () => void
  handleAdoptUnit: (id: string) => void
  /** Stands at an inventory viewpoint, facing the block, or along one of its arrows when given. */
  handleUseViewpoint: (candidate: ViewpointCandidate, arrow?: CandidateArrow | null) => void
  onInspectSample: (targetId: string, sampleIndex: number, stationIndex: number) => void
  /** A click on the plan's road line, while the road view can seek along it. */
  onRoadClick?: (lngLat: [number, number]) => void
  /** Protects or frees a prescribed tree (`StandPrescription.protectedKeys`). */
  onToggleProtectedTree?: (targetId: string, key: number) => void
  /** ParcelMap BC's private parcels not yet added, `selected` 1 when ticked (`privateParcelCandidateCollection`). */
  privateParcelCollection?: Collection
  /** Ticks or unticks a private parcel to add; never adds it. */
  onTogglePrivateParcel?: (id: string) => void
}

const STAND_TREE_STATUS: Record<string, string> = {
  kept: 'Kept',
  removed: 'Cut',
  protected: 'Protected',
}
const SPECIES_NAMES: Record<string, string> = {
  pine: 'Pine',
  spruce: 'Spruce',
  fir: 'Fir',
  douglasFir: 'Douglas-fir',
  aspen: 'Aspen',
  birch: 'Birch',
}

/** A prescribed tree's record on hover (WinSVS's tree info): every value is a number or a fixed label. */
function standTreeHoverHtml(properties: Record<string, unknown>): string | null {
  const status = STAND_TREE_STATUS[String(properties.status)]
  const species = SPECIES_NAMES[String(properties.species)]
  if (!status || !species) return null
  const dbh = Number(properties.dbhCm)
  const height = Number(properties.heightMeters)
  return `<strong>${species}</strong> · ${status}<br>${dbh.toFixed(0)} cm DBH · ${height.toFixed(1)} m tall<br><span style="opacity:.7">Click to ${status === 'Protected' ? 'free' : 'protect'} this tree</span>`
}

/** A shape being drawn on the plan, dark so it reads over the imagery and the scene's colours. */
const DRAFT_COLOR = '#111827'

/**
 * The scene's map layers, drawn once in each map: `mode="plan"` in the 2D overview, `mode="eye"` in
 * the eye-level road view. Each layer that used to switch on whether the one map was in the road
 * view now switches on the map it is in. Plan-only layers (the corridor, its stations, drawing,
 * inventory points, terrain candidates, the scale bar and the basemap probe) and eye-only layers
 * (the drawn timber, ground cover, water, road surface and haze) are mounted only in their map.
 */
export function VisualQualityLayers({ mode, data }: { mode: 'plan' | 'eye'; data: SceneLayerData }) {
  const eye = mode === 'eye'
  const {
    drive,
    scene,
    result,
    preliminaryDrive,
    planShow,
    showInventory,
    inventory,
    selectedTargetId,
    drawMode,
    driveStationIndex,
    driveEye,
    routeViewshed,
    routeOutline,
    forestConfiguration,
    forestPatches,
    viewingGapTarget,
    forestGround,
    previewRoad,
    previewRoadScar,
    basemapBounds,
    mapPick,
    inventoryCollection,
    terrainCandidateCollection,
    ridgeLayerCollection,
    viewpointLayers,
    standingArrows,
    viewpointCandidates,
    landformClues,
    landscapeCollection,
    evqoDisplay,
    harvestedCollection,
    previewBlockCollection,
    blockCollection,
    harvestedGroundColor,
    maskCollection,
    hazeCollection,
    sampleCollection,
    eyeSampleCollection,
    reverseRoadCollection,
    corridorCollection,
    corridorExposureCollection,
    stationCollection,
    spotCollection,
    draftCoordinates,
    measuring,
    inventoryHoverHtml,
    viewpointHoverHtml,
    targetHoverHtml,
    setForestStatus,
    setBasemap,
    setMapPick,
    setSelectedTargetId,
    handleMapPoint,
    finishDraft,
    removeLastDraftPoint,
    handleAdoptUnit,
    handleUseViewpoint,
    onInspectSample,
    onRoadClick,
    onToggleProtectedTree,
    standTreeCollection,
    standStripCollection,
    privateParcelCollection = EMPTY_COLLECTION,
    onTogglePrivateParcel,
  } = data
  // While a shape is being drawn or measured, a click on the plan is a vertex: nothing under it is
  // selected, adopted or inspected.
  const planBusy = !eye && (measuring || drawMode !== 'none')
  const whenFree =
    <A extends unknown[]>(handler: (...args: A) => unknown) =>
    (...args: A) => {
      if (!planBusy) handler(...args)
    }
  // The plan's legend rows hide features by class; the road view draws every feature.
  const hidden = eye ? NOTHING_HIDDEN : planShow.hidden
  const shown = (key: Parameters<typeof hidden.has>[0]) => !hidden.has(key)
  const planStandTrees = useMemo(
    () => withoutHiddenFeatures(standTreeCollection, hidden, standTreeLegendKey),
    [standTreeCollection, hidden],
  )
  const planUnits = useMemo(
    () => withoutHiddenFeatures(inventoryCollection, hidden, unitLegendKey),
    [inventoryCollection, hidden],
  )
  const planCandidates = useMemo(
    () => withoutHiddenFeatures(terrainCandidateCollection, hidden, candidateLegendKey),
    [terrainCandidateCollection, hidden],
  )
  const planInventoryPoints = useMemo(
    () => withoutHiddenFeatures(viewpointLayers.points, hidden, inventoryPointLegendKey),
    [viewpointLayers.points, hidden],
  )
  // The inventory point whose card is open: a click chooses it, and the card's buttons stand there.
  // A click on one of its arrows opens the same card, facing that arrow first and anchored where it was clicked.
  const [viewpointCardOpen, setViewpointCardKey] = useState<{
    key: string
    arrowId?: string
    at?: [number, number]
    /** Where the point's own click landed, so the arrow under the same click stands aside. */
    pointClick?: [number, number] | null
  } | null>(null)
  const viewpointCard =
    !eye && showInventory && viewpointCardOpen
      ? (viewpointCandidates.find((entry) => entry.key === viewpointCardOpen.key) ?? null)
      : null
  const arrowHoverHtml = (properties: Record<string, unknown>) => {
    // An open card is the answer already: no tooltip over it.
    if (viewpointCard) return null
    const candidate = viewpointCandidates.find((entry) => entry.key === properties.viewpoint)
    if (!candidate) return null
    const bearing = Number(properties.bearing)
    return mapTooltipHtml({
      title: candidate.name,
      subtitle: Number.isFinite(bearing)
        ? `Inventory arrow · looks ${compassPoint(bearing)} (${bearing}°)`
        : 'Inventory arrow',
      footer: 'Click to stand here, facing along it',
    })
  }
  const planClues = useMemo(() => withoutHiddenFeatures(landformClues, hidden, clueLegendKey), [landformClues, hidden])
  const evqoCollection = evqoDisplay?.collection ?? EMPTY_COLLECTION
  const planEvqo = useMemo(() => withoutHiddenFeatures(evqoCollection, hidden, evqoLegendKey), [evqoCollection, hidden])
  const planMasks = useMemo(
    () => withoutHiddenFeatures(maskCollection, hidden, maskLegendKey),
    [maskCollection, hidden],
  )
  const samples = eye ? eyeSampleCollection : sampleCollection
  const planSamples = useMemo(() => withoutHiddenFeatures(samples, hidden, sampleLegendKey), [samples, hidden])
  const roadClick = onRoadClick
    ? (_id: string, event: { lngLat: [number, number] | null }) => {
        if (event.lngLat && !planBusy) onRoadClick(event.lngLat)
      }
    : undefined
  return (
    <>
      <SatelliteImagery visible={eye ? drive.imagery : planShow.basemap === 'satellite'} />
      {routeViewshed.enabled && routeViewshed.valid && (
        <>
          {routeViewshed.mode !== 'point' && (
            <MapLineLayer
              data={routeViewshed.selectedRoad}
              color="#2563eb"
              width={5}
              opacity={1}
              interactive={false}
              sourceKey="forestry-viewshed-selected-road"
            />
          )}
          {routeViewshed.mode !== 'point' && (
            <MapLineLayer
              data={routeViewshed.currentRadius}
              color={VIEWSHED_COLORS.visible}
              width={1}
              opacity={0.6}
              interactive={false}
              sourceKey="forestry-viewshed-moving-radius"
            />
          )}
          {!eye && (
            <MapMarker
              longitude={routeViewshed.observer.lng}
              latitude={routeViewshed.observer.lat}
              opacityWhenCovered="1"
            >
              <MarkerContent>
                <span
                  role="img"
                  aria-label="Road viewshed observer"
                  className="block h-4 w-4 rounded-full border-2 border-white shadow"
                  style={{ backgroundColor: VIEWSHED_COLORS.visible }}
                />
              </MarkerContent>
            </MapMarker>
          )}
          <ViewshedOverlay
            result={routeViewshed.analysis.overlayResult}
            mode="standing"
            opacity={0.6}
            showHidden={false}
            sourceKey="forestry-route-viewshed"
          />
          <MapLineLayer
            data={routeOutline}
            color={VIEWSHED_COLORS.visible}
            width={1.5}
            opacity={1}
            interactive={false}
            sourceTolerance={0}
            sourceKey="forestry-route-viewshed-outline"
          />
        </>
      )}
      {eye && (
        <>
          <MovingResolution active={drive.movingResolution === 'reduced'} />
          <ForestOverlay
            active={drive.forest}
            configuration={forestConfiguration}
            patches={forestPatches}
            background={data.forestBackground}
            backgroundPending={data.forestBackgroundPending}
            centre={driveEye}
            gapTarget={viewingGapTarget}
            terrainMessage={data.previewTerrainMessage}
            sun={data.treeSun}
            shadows={data.treeShadows}
            onStatus={setForestStatus}
          />
          {/* The drawn ground stays when the timber is switched off: it is what
        the ground is, not part of the trees. Satellite imagery is the real
        ground, so the drawn floor and soil stand aside for it rather than
        covering it at 82%. */}
          <MapFillLayer
            data={forestGround.floor}
            interactive={false}
            fillColor="#3a4f35"
            fillOpacity={0.82}
            lineWidth={0}
            visible={!drive.imagery}
          />
          {/* The floor under a closed stand is darker than under an open one: the canopy's own
        shade, by the closure the inventory records. */}
          <MapFillLayer
            data={forestGround.shade}
            interactive={false}
            fillColor="#16241a"
            fillOpacity={['interpolate', ['linear'], ['get', 'closure'], 25, 0, 80, 0.2]}
            lineWidth={0}
            visible={!drive.imagery}
          />
          <MapFillLayer
            data={forestGround.cover}
            fillColor={['match', ['get', 'cover'], ...GROUND_COVER_FILL, '#4a5a3c']}
            fillOpacity={0.9}
            lineWidth={0}
            visible={!drive.imagery}
          />
          <MapFillLayer
            data={forestGround.soil}
            interactive={false}
            fillColor="#a7977d"
            fillOpacity={0.95}
            lineWidth={0}
            visible={!drive.imagery}
          />
          {/* Cut banks read paler than the fill spilled below the road. */}
          <MapFillLayer
            data={previewRoadScar}
            fillColor={['match', ['get', 'kind'], 'cut', '#b9a888', '#9d8b6c']}
            fillOpacity={drive.imagery ? 0.6 : 0.95}
            interactive={false}
            lineWidth={0}
          />
          <MapFillLayer
            data={previewRoad}
            interactive={false}
            fillColor="#a7977d"
            fillOpacity={1}
            lineColor="#c0b397"
            lineWidth={1}
          />
          {/* Mapped lakes and rivers read as water from the road; over imagery only a tint. Above the road and
            its scar: a viewpoint on the shore or on the water (a boat launch, a sea view) starts its road there,
            and the road surface draped on the lake read as a tan slab across the foreground. */}
          <MapFillLayer
            data={forestGround.water}
            interactive={false}
            fillColor={ROAD_VIEW_WATER_COLOR}
            fillOpacity={drive.imagery ? 0.35 : 0.92}
            lineColor={ROAD_VIEW_SHORE_COLOR}
            lineWidth={drive.imagery ? 0 : 1}
            lineOpacity={0.8}
          />
        </>
      )}
      {!eye && (
        <>
          {/* Hectares and kilometres are the page's units. It clears the phone sheet. */}
          <MapScaleBar position="bottom-right" />
          {/* Read while the road view is closed, as before it had a map of its own: the road view's
            water and road class stay as they were when it opened. */}
          <BasemapContextProbe
            enabled={!drive.active}
            corridor={scene.viewpoint.coordinates}
            bounds={basemapBounds}
            onChange={setBasemap}
          />
          {data.landformVantage && (
            <MapMarker longitude={data.landformVantage.lng} latitude={data.landformVantage.lat} opacityWhenCovered="1">
              <MarkerContent>
                <span
                  role="img"
                  aria-label={data.landformVantage.label}
                  title={data.landformVantage.label}
                  data-testid="landform-vantage-marker"
                  className="relative flex h-5 w-5 items-center justify-center"
                >
                  <span className="fixed-palette absolute inset-0 animate-ping rounded-full bg-sky-400/50 [animation-iteration-count:2]" />
                  <span className="fixed-palette relative block h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-600 shadow" />
                </span>
              </MarkerContent>
            </MapMarker>
          )}
          {/* A viewpoint or a view of interest is one click; a road or an area is drawn as the measure tool
            draws: numbered points, a rubber band to the pointer, closed on its first point or a double-click. */}
          <MapDrawCapture active={drawMode === 'spot' || drawMode === 'view'} onPoint={handleMapPoint} />
          {drawMode !== 'none' && drawMode !== 'spot' && drawMode !== 'view' && (
            <MapSketchDraft
              shape={drawMode === 'corridor' ? 'line' : 'polygon'}
              points={draftCoordinates}
              onAdd={handleMapPoint}
              onFinish={finishDraft}
              onRemoveLast={removeLastDraftPoint}
              color={DRAFT_COLOR}
              testId="visuals-draft"
            />
          )}
          {/* A one-off point a sidebar tool asked for, such as where a landform is read from. */}
          <MapDrawCapture
            active={!!mapPick && drawMode === 'none'}
            onPoint={(point) => {
              mapPick?.onPoint(point)
              setMapPick(null)
            }}
          />
        </>
      )}

      {/* Inventory polygons sit under the scene's own, and units with nothing
        established are drawn back so the ones that constrain harvesting read first. */}
      <MapFillLayer
        data={planUnits}
        fillColor={SENSITIVITY_UNIT_COLOR as never}
        fillOpacity={['case', ['==', ['get', 'rated'], 1], 0.12, 0.03]}
        lineColor={SENSITIVITY_UNIT_COLOR as never}
        lineWidth={['case', ['==', ['get', 'rated'], 1], 1.6, 0.7]}
        lineOpacity={0.9}
        idProperty="id"
        // A unit is a large area holding the scene's blocks, viewpoints and arrows: they answer the pointer first.
        pickPriority={-1}
        visible={showInventory && inventory.units.length > 0 && (!eye || drive.showAnalysis)}
        // With the road view open a click on the plan moves it; adopting a unit is step 1's job.
        onFeatureClick={whenFree((id) => {
          if (eye || !drive.active) handleAdoptUnit(id)
        })}
        hoverHtml={inventoryHoverHtml}
      />
      {/* Both terrain readings, coloured by reading; the one in front filled and drawn heavier. */}
      {!eye && (
        <>
          <MapFillLayer
            data={planCandidates}
            fillColor={
              [
                'match',
                ['get', 'method'],
                'facing',
                FACE_CANDIDATE_COLOR,
                'visible-face',
                VISIBLE_FACE_CANDIDATE_COLOR,
                TERRAIN_CANDIDATE_COLOR,
              ] as never
            }
            fillOpacity={['case', ['==', ['get', 'selected'], 1], 0.08, 0] as never}
            lineWidth={0}
          />
          <MapLineLayer
            data={planCandidates}
            color={
              [
                'match',
                ['get', 'method'],
                'facing',
                FACE_CANDIDATE_COLOR,
                'visible-face',
                VISIBLE_FACE_CANDIDATE_COLOR,
                TERRAIN_CANDIDATE_COLOR,
              ] as never
            }
            width={['case', ['==', ['get', 'selected'], 1], 2.4, 1.4] as never}
            dashArray={[2, 1.5]}
            opacity={['case', ['==', ['get', 'selected'], 1], 0.95, 0.7] as never}
          />
        </>
      )}
      {/* The other ridge layers a ridge-layer candidate found, as the road sees them stack. */}
      <MapLineLayer
        data={ridgeLayerCollection}
        visible={eye ? drive.showLandform : shown('other-ridge-layers')}
        color={['case', ['==', ['get', 'own'], 1], TERRAIN_CANDIDATE_COLOR, OTHER_RIDGE_LAYER_COLOR]}
        width={['case', ['==', ['get', 'own'], 1], 0, eye ? 2.5 : 1.2]}
        opacity={0.75}
        interactive={false}
      />
      {/* BC's viewpoints, their arrows, rec sites and recorded screenings. */}
      {!eye && (
        <MapFillLayer
          data={viewpointLayers.screenings}
          visible={showInventory && shown('screening')}
          fillColor={INVENTORY_COLORS.screening}
          fillOpacity={0.12}
          lineColor={INVENTORY_COLORS.screening}
          lineWidth={0.8}
          lineOpacity={0.6}
        />
      )}
      <MapFillLayer
        // In the road view the arrows are a guide for looking, never part of a saved picture: every capture hides
        // the layers on this source (`mapCapture.ts`).
        {...(eye ? { sourceKey: ROAD_VIEW_GUIDE_SOURCE, interactive: false } : {})}
        data={eye ? standingArrows : viewpointLayers.arrows}
        visible={eye ? standingArrows.features.length > 0 : showInventory && shown('arrow')}
        fillColor={INVENTORY_COLORS.viewpoint}
        // Standing at the viewpoint puts its arrows under the eye, so in the
        // road view they are outlines over a faint fill, the faced one heavier.
        fillOpacity={
          eye
            ? (['case', ['==', ['get', 'faced'], 1], 0.18, 0.06] as never)
            : ['case', ['==', ['get', 'size'], 'large'], 0.45, 0.3]
        }
        lineColor={eye ? INVENTORY_COLORS.viewpoint : INVENTORY_COLORS.arrowOutline}
        lineWidth={eye ? (['case', ['==', ['get', 'faced'], 1], 3.5, 1.5] as never) : 0.8}
        lineOpacity={eye ? 0.95 : 0.8}
        {...(eye
          ? {}
          : {
              idProperty: 'id',
              hoverHtml: arrowHoverHtml,
              onFeatureClick: whenFree((_id: string, event: { lngLat: [number, number] | null }, properties) => {
                const key = String(properties.viewpoint ?? '')
                const arrowId = String(properties.arrowId ?? '')
                if (!viewpointCandidates.some((entry) => entry.key === key)) return
                // An arrow starts at its point, so one click can hit both: the point wins. The two layers' handlers run
                // in no set order, so the arrow's waits for both and stands aside when the point took this click.
                const at = event.lngLat
                queueMicrotask(() =>
                  setViewpointCardKey((current) =>
                    current?.pointClick && at && current.pointClick[0] === at[0] && current.pointClick[1] === at[1]
                      ? current
                      : { key, arrowId, at: at ?? undefined },
                  ),
                )
              }),
            })}
      />
      {!eye && (
        <>
          <MapCircleLayer
            data={planClues}
            // Up to 2,048 clues a landform, one per terrain sample: small and unringed until zoomed in, like the
            // sample points, or they cover the landform.
            radius={['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.6, 16, 3.5]}
            opacity={0.75}
            strokeWidth={0}
            color={[
              'match',
              ['get', 'position'],
              'ridge',
              LANDFORM_CLUE_COLORS.ridge,
              'hollow',
              LANDFORM_CLUE_COLORS.hollow,
              LANDFORM_CLUE_COLORS.other,
            ]}
          />
        </>
      )}
      {/* The landform holds the blocks, roads, sample points and the inventory's viewpoints and arrows: each of those
        answers a hover or click inside it first, rather than the landform as well (`pickPriority`). */}
      <MapFillLayer
        data={landscapeCollection}
        pickPriority={-1}
        visible={eye ? drive.showAnalysis || drive.showLandform : shown('landform')}
        fillColor={ROLE_COLORS.landscape}
        fillOpacity={eye && drive.showLandform ? 0.18 : 0.08}
        lineColor={ROLE_COLORS.landscape}
        lineWidth={eye ? 3 : 1.6}
        lineOpacity={0.8}
        idProperty="id"
        selectedId={selectedTargetId}
        onFeatureClick={whenFree((id) => setSelectedTargetId(id))}
        hoverHtml={targetHoverHtml}
      />
      {/* Private parcels found round the landform (step 3): candidates, dashed until ticked. A click ticks or
        unticks one; with the road view open a plan click moves it, so the parcels stand aside then. */}
      {!eye && (
        <>
          <MapFillLayer
            data={privateParcelCollection}
            visible={shown('candidate:private')}
            fillColor={MASK_COLORS.private}
            fillOpacity={['case', ['==', ['get', 'selected'], 1], 0.4, 0.06] as never}
            lineWidth={0}
            idProperty="id"
            hoverHtml={(properties) => {
              const area = Number(properties.areaHa)
              return mapTooltipHtml({
                title: String(properties.name ?? 'Private parcel'),
                subtitle: `ParcelMap BC · ${Number.isFinite(area) ? `${area.toFixed(1)} ha` : 'private'}`,
                footer: drive.active
                  ? 'Tick it in step 3 while the road view is open'
                  : properties.selected === 1
                    ? 'Ticked to add · click to untick'
                    : 'Click to tick it to add as private land',
              })
            }}
            onFeatureClick={whenFree((id) => {
              if (!drive.active) onTogglePrivateParcel?.(String(id))
            })}
          />
          <MapLineLayer
            data={privateParcelCollection}
            visible={shown('candidate:private')}
            color={MASK_COLORS.private}
            width={['case', ['==', ['get', 'selected'], 1], 2.4, 1.3] as never}
            dashArray={[2, 1.5]}
            opacity={0.95}
            interactive={false}
          />
        </>
      )}
      {/* The established VQO polygons draped under everything else in the road view. */}
      <MapFillLayer
        data={eye ? evqoCollection : planEvqo}
        visible={eye ? drive.showEvqo : planShow.evqo}
        fillColor={['match', ['get', 'code'], ...Object.entries(EVQO_COLORS).flat(), '#94a3b8'] as never}
        fillOpacity={0.3}
        lineColor={['match', ['get', 'code'], ...Object.entries(EVQO_COLORS).flat(), '#94a3b8'] as never}
        lineWidth={1.5}
        lineOpacity={0.9}
      />
      {/* Existing openings sit under the proposal, in a duller colour: they
        are context for the cumulative number, not the thing being assessed. */}
      <MapFillLayer
        data={harvestedCollection}
        visible={shown('opening')}
        fillColor={ROLE_COLORS.harvested}
        fillOpacity={0.22}
        lineColor={ROLE_COLORS.harvested}
        lineWidth={1}
        lineOpacity={0.8}
        idProperty="id"
        selectedId={selectedTargetId}
        onFeatureClick={whenFree((id) => setSelectedTargetId(id))}
        hoverHtml={targetHoverHtml}
      />
      <MapFillLayer
        data={eye && drive.harvestPhase === 'after' && !drive.showAnalysis ? previewBlockCollection : blockCollection}
        visible={eye ? drive.harvestPhase === 'after' || drive.showAnalysis : shown('block')}
        // A block's own colour wins wherever it is drawn; unset, it is cleared
        // ground in the road view, white in the note screenshot look.
        fillColor={[
          'coalesce',
          ['get', 'color'],
          eye && drive.reportLook ? '#ffffff' : eye && !drive.showAnalysis ? harvestedGroundColor : ROLE_COLORS.block,
        ]}
        fillOpacity={eye ? (drive.reportLook ? 1 : 0.85) : 0.3}
        lineColor={
          eye
            ? [
                'coalesce',
                ['get', 'color'],
                drive.reportLook ? '#ffffff' : drive.showAnalysis ? ROLE_COLORS.block : '#b69a70',
              ]
            : ROLE_COLORS.block
        }
        lineWidth={1.8}
        lineOpacity={0.95}
        idProperty="id"
        selectedId={selectedTargetId}
        selectionColor={eye && !drive.showAnalysis ? '#b69a70' : '#111827'}
        onFeatureClick={whenFree((id) => setSelectedTargetId(id))}
        hoverHtml={targetHoverHtml}
      />
      {/* Relief over the ground drawn so far, the block's cut ground with it: open slopes and cut ground
        take the hill's form. Not over imagery, which carries its own; nor where the ground is painted
        to be read flat, in the note screenshot look and under the analysis colours. */}
      {eye && (
        <GroundRelief
          active={!drive.imagery && !drive.reportLook && !drive.showAnalysis}
          light={data.treeSun ?? FIXED_TREE_SUN}
        />
      )}

      <MapFillLayer
        data={planMasks}
        visible={!eye || drive.showAnalysis}
        fillColor={[
          'match',
          ['get', 'kind'],
          'natural',
          MASK_COLORS.natural,
          'private',
          MASK_COLORS.private,
          'permanent',
          MASK_COLORS.permanent,
          MASK_COLORS.retained,
        ]}
        fillOpacity={0.15}
        lineColor="#475569"
        lineWidth={1}
      />
      {!eye && (
        <>
          <MapFillLayer
            data={data.treeFreeCollection}
            interactive={false}
            visible={shown('tree-free')}
            fillColor={TREE_FREE_COLOR}
            fillOpacity={0.1}
            lineWidth={0}
          />
          <MapLineLayer
            data={data.treeFreeCollection}
            visible={shown('tree-free')}
            color={TREE_FREE_COLOR}
            width={1.6}
            dashArray={[2, 1.5]}
            opacity={0.95}
            interactive={false}
          />
        </>
      )}
      {/* The stand profile's strip: the trees the dialog's side view is cut from. */}
      {!eye && (
        <MapLineLayer
          data={standStripCollection}
          visible={shown('stand:strip')}
          color={STAND_TREE_COLORS.strip}
          width={2}
          dashArray={[3, 2]}
          opacity={0.95}
          interactive={false}
        />
      )}
      {/* A stand prescription's trees: kept, cut, protected. A click protects or frees one. */}
      {!eye && (
        <MapCircleLayer
          data={planStandTrees}
          onFeatureClick={whenFree(
            (_id, _event, properties) =>
              !drive.active && onToggleProtectedTree?.(String(properties.targetId), Number(properties.key)),
          )}
          color={[
            'match',
            ['get', 'status'],
            'removed',
            STAND_TREE_COLORS.removed,
            'protected',
            STAND_TREE_COLORS.protected,
            STAND_TREE_COLORS.kept,
          ]}
          radius={['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 2.5, 19, 7]}
          opacity={['case', ['==', ['get', 'status'], 'removed'], 0.75, 0.95]}
          strokeWidth={['case', ['==', ['get', 'status'], 'protected'], 1, 0]}
          strokeColor="#1f2937"
          hoverHtml={standTreeHoverHtml}
        />
      )}
      {/* Distance haze: draped over the ground and the blocks, faded by real distance from the eye. */}
      {eye && (
        <MapFillLayer
          data={hazeCollection}
          interactive={false}
          visible={drive.haze}
          fillColor="#cbd8e5"
          fillOpacity={['get', 'opacity']}
          lineWidth={0}
        />
      )}
      {/* A VIA figure style, draped over everything but the sample points. Display only. */}
      {eye && drive.figureStyle && <FigureStyleLayers styleId={drive.figureStyle} data={data.figureStyleData} />}
      {/* Sample points carry the answer: red is ground the road can see. */}
      <MapCircleLayer
        data={planSamples}
        onFeatureClick={whenFree(
          (_id, _event, properties) =>
            // On the plan, a click moves the open road view instead.
            (eye || !drive.active) &&
            onInspectSample(
              String(properties.targetId),
              Number(properties.sampleIndex),
              eye ? driveStationIndex : (result?.assessmentStationIndex ?? 0),
            ),
        )}
        visible={!preliminaryDrive && (!eye || (drive.showAnalysis && drive.harvestPhase === 'after'))}
        color={[
          'case',
          ['==', ['get', 'visible'], 2],
          UNKNOWN_COLOR,
          ['==', ['get', 'visible'], 1],
          VISIBLE_COLOR,
          SCREENED_COLOR,
        ]}
        radius={['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 2.6, 15, 5]}
        opacity={['case', ['==', ['get', 'visible'], 1], 0.95, 0.35]}
        strokeWidth={0}
      />

      {/* The reverse answer sits on the roads themselves: a hot stretch is
        road the block is in view from, a cold one road where it is hidden.
        Drawn as the road rather than as the points it was sampled at. */}
      {!eye && (
        <>
          <MapLineLayer
            data={reverseRoadCollection}
            visible={shown('exposure')}
            color={['case', ['==', ['get', 'unknown'], 1], UNKNOWN_COLOR, EXPOSURE_RAMP] as never}
            width={['case', ['==', ['get', 'seen'], 1], 4.5, 2]}
            opacity={['case', ['==', ['get', 'seen'], 1], 0.95, 0.45]}
          />

          {/* From eye level the road is directly under the camera, where a line
        and its stations fill the frame instead of marking anything. */}
          <MapLineLayer
            data={corridorCollection}
            visible={shown('road')}
            color={ROAD_COLOR}
            width={3}
            opacity={0.9}
            onFeatureClick={roadClick}
          />
          {/* Once a run exists the corridor carries its own answer: how much of
        the block each stretch of road sees, graded along it. */}
          <MapLineLayer
            data={corridorExposureCollection}
            visible={shown('exposure')}
            onFeatureClick={roadClick}
            color={['case', ['==', ['get', 'unknown'], 1], UNKNOWN_COLOR, EXPOSURE_RAMP] as never}
            width={5}
            opacity={0.95}
          />
          {/* BC's viewpoints and rec sites sit over every area drawn under them, so the point under the pointer is the
        one hovered and clicked rather than the landform or block it stands in. */}
          <MapCircleLayer
            data={planInventoryPoints}
            visible={showInventory}
            radius={5}
            color={['case', ['==', ['get', 'kind'], 'rec-site'], INVENTORY_COLORS.recSite, INVENTORY_COLORS.viewpoint]}
            strokeColor="#ffffff"
            strokeWidth={1.5}
            idProperty="id"
            hoverHtml={viewpointCard ? noTooltip : viewpointHoverHtml}
            onFeatureClick={whenFree((id: string, event: { lngLat: [number, number] | null }) => {
              if (!viewpointCandidates.some((entry) => entry.key === id)) return
              setViewpointCardKey({ key: String(id), pointClick: event.lngLat })
            })}
          />
          {viewpointCard && (
            <MapPopup
              key={`${viewpointCard.key}:${viewpointCardOpen?.arrowId ?? ''}`}
              longitude={viewpointCardOpen?.at?.[0] ?? viewpointCard.lng}
              latitude={viewpointCardOpen?.at?.[1] ?? viewpointCard.lat}
              offset={10}
              onClose={() => setViewpointCardKey(null)}
            >
              <MapPopupCard
                // Wide enough for the longest stand choice, "Stand here, facing northwest, at the block", on one line.
                className="w-64"
                eyebrow={viewpointCard.kind === 'rec-site' ? 'Recreation site' : 'VLI viewpoint'}
                title={viewpointCard.name}
                subtitle={viewpointCandidateSummary(viewpointCard).split(' · ').slice(1).join(' · ')}
                onClose={() => setViewpointCardKey(null)}
                footerActions={viewpointStandChoices(viewpointCard, viewpointCardOpen?.arrowId).map((choice) => ({
                  label: choice.label,
                  primary: choice.primary,
                  onClick: () => {
                    setViewpointCardKey(null)
                    handleUseViewpoint(viewpointCard, choice.arrow)
                  },
                }))}
              />
            </MapPopup>
          )}
          {/* Only the assessment viewpoint keeps a marker — it is a single place,
        not a sample of a continuum. */}
          <MapCircleLayer
            data={stationCollection}
            visible={shown('viewpoint')}
            color={ASSESSMENT_VIEWPOINT_COLOR}
            radius={['case', ['==', ['get', 'assessment'], 1], 6, 0]}
            strokeColor="#ffffff"
            strokeWidth={['case', ['==', ['get', 'assessment'], 1], 1.5, 0]}
          />
          <MapCircleLayer
            data={spotCollection}
            visible={shown('road')}
            color={ROAD_COLOR}
            radius={7}
            strokeColor="#ffffff"
            strokeWidth={2}
          />
        </>
      )}
    </>
  )
}

const noTooltip = () => null

/**
 * The stand choices an inventory point's card offers, the first leading. The clicked arrow leads, else the arrow that
 * aims at the block, else the block itself; "facing the block" is left out when an arrow already does that, and every
 * other arrow follows as a facing.
 */
export function viewpointStandChoices(
  candidate: ViewpointCandidate,
  clickedArrowId?: string,
): Array<{ label: string; primary: boolean; arrow: CandidateArrow | null }> {
  const numbered = candidate.arrows.map((arrow, index) => ({ arrow, number: index + 1 }))
  const lead =
    numbered.find(({ arrow }) => arrow.id === clickedArrowId) ?? numbered.find(({ arrow }) => arrow.aims) ?? null
  const anyAims = numbered.some(({ arrow }) => arrow.aims)
  const facing = (arrow: CandidateArrow) => `${compassPoint(arrow.bearing)}${arrow.aims ? ', at the block' : ''}`
  return [
    lead
      ? { label: `Stand here, facing ${facing(lead.arrow)}`, primary: true, arrow: lead.arrow }
      : { label: 'Stand here, facing the block', primary: true, arrow: null },
    ...(lead && !anyAims ? [{ label: 'Face the block', primary: false, arrow: null }] : []),
    ...numbered
      .filter((entry) => entry !== lead)
      .map(({ arrow, number }) => ({ label: `Arrow ${number}: ${facing(arrow)}`, primary: false, arrow })),
  ]
}
