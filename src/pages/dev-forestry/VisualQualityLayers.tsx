import { useMemo, type ComponentProps } from 'react'
import { MapMarker, MapScaleBar, MarkerContent } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { ViewshedOverlay, VIEWSHED_COLORS } from '@/features/terrain-viewshed'
import { BasemapContextProbe, type BasemapContext } from './BasemapContextProbe'
import { ForestOverlay, type ForestStatus } from './ForestOverlay'
import { MapDrawCapture } from './MapDrawCapture'
import { SatelliteImagery } from './SatelliteImagery'
import type { LandformVantagePoint } from './TerrainLandformFinder'
import type { BcSensitivityUnit } from './bcVisualInventory'
import {
  candidateLegendKey,
  clueLegendKey,
  evqoLegendKey,
  inventoryPointLegendKey,
  maskLegendKey,
  sampleLegendKey,
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
  TERRAIN_CANDIDATE_COLOR,
  UNKNOWN_COLOR,
  VISIBLE_COLOR,
} from './planMapStyle'
import { ROLE_COLORS, type ForestryScene } from './scene'
import type { DriveState } from './Sidebar'
import type { AnalysisResult } from './types'
import type { useRouteViewshed } from './useRouteViewshed'
import type { ViewpointCandidate } from './viewpointInventory'
import { EVQO_COLORS } from './visualsNarrative'

type Collection = GeoJSON.FeatureCollection
const EMPTY_COLLECTION: Collection = { type: 'FeatureCollection', features: [] }
const NOTHING_HIDDEN: PlanShow['hidden'] = new Set()
/** Lakes and rivers in the road view: a still-water blue, with a lighter shoreline. */
const ROAD_VIEW_WATER_COLOR = '#3f6f99'
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
  facedArrowGeometry: GeoJSON.Polygon | null
  previewTerrainMessage: string | null
  /** Where "Find a landform from the terrain" reads from: a picked point or an inventory viewpoint. */
  landformVantage: LandformVantagePoint | null
  /** Ground the road view draws without timber, outlined on the plan. */
  treeFreeCollection: Collection
  forestGround: { floor: Collection; soil: Collection; water: Collection }
  previewRoad: Collection
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
  /** Every station's union, for the plan; the road view's own station, for the eye. */
  sampleCollection: Collection
  eyeSampleCollection: Collection
  reverseRoadCollection: Collection
  corridorCollection: Collection
  corridorExposureCollection: Collection
  stationCollection: Collection
  spotCollection: Collection
  draftLine: Collection
  draftVertices: Collection
  inventoryHoverHtml: (properties: Record<string, unknown>) => string | null
  viewpointHoverHtml: (properties: Record<string, unknown>) => string | null
  targetHoverHtml: (properties: Record<string, unknown>) => string | null
  setForestStatus: (status: ForestStatus) => void
  setBasemap: (context: BasemapContext) => void
  setMapPick: (pick: null) => void
  setSelectedTargetId: (id: string) => void
  handleMapPoint: (point: [number, number]) => void
  finishDraft: () => void
  handleAdoptUnit: (id: string) => void
  handleUseViewpoint: (candidate: ViewpointCandidate) => void
  onInspectSample: (targetId: string, sampleIndex: number, stationIndex: number) => void
  /** A click on the plan's road line, while the road view can seek along it. */
  onRoadClick?: (lngLat: [number, number]) => void
}

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
    facedArrowGeometry,
    forestGround,
    previewRoad,
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
    draftLine,
    draftVertices,
    inventoryHoverHtml,
    viewpointHoverHtml,
    targetHoverHtml,
    setForestStatus,
    setBasemap,
    setMapPick,
    setSelectedTargetId,
    handleMapPoint,
    finishDraft,
    handleAdoptUnit,
    handleUseViewpoint,
    onInspectSample,
    onRoadClick,
  } = data
  // The plan's legend rows hide features by class; the road view draws every feature.
  const hidden = eye ? NOTHING_HIDDEN : planShow.hidden
  const shown = (key: Parameters<typeof hidden.has>[0]) => !hidden.has(key)
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
        if (event.lngLat) onRoadClick(event.lngLat)
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
          <ForestOverlay
            active={drive.forest}
            configuration={forestConfiguration}
            patches={forestPatches}
            centre={driveEye}
            gapTarget={
              !drive.viewingGap
                ? null
                : drive.lookAtTargetId
                  ? (scene.targets.find((target) => target.id === drive.lookAtTargetId)?.geometry ?? null)
                  : facedArrowGeometry
            }
            terrainMessage={data.previewTerrainMessage}
            onStatus={setForestStatus}
          />
          {/* Satellite imagery is the real ground, so the drawn floor and soil
        stand aside for it rather than covering it at 82%. */}
          <MapFillLayer
            data={forestGround.floor}
            interactive={false}
            fillColor="#3a4f35"
            fillOpacity={0.82}
            lineWidth={0}
            visible={drive.forest && !drive.imagery}
          />
          <MapFillLayer
            data={forestGround.soil}
            interactive={false}
            fillColor="#a7977d"
            fillOpacity={0.95}
            lineWidth={0}
            visible={drive.forest && !drive.imagery}
          />
          {/* Mapped lakes and rivers read as water from the road; over imagery only a tint. */}
          <MapFillLayer
            data={forestGround.water}
            interactive={false}
            fillColor={ROAD_VIEW_WATER_COLOR}
            fillOpacity={drive.imagery ? 0.35 : 0.92}
            lineColor={ROAD_VIEW_SHORE_COLOR}
            lineWidth={drive.imagery ? 0 : 1}
            lineOpacity={0.8}
          />
          <MapFillLayer
            data={previewRoad}
            interactive={false}
            fillColor="#a7977d"
            fillOpacity={1}
            lineColor="#c0b397"
            lineWidth={1}
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
                  <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/50 [animation-iteration-count:2]" />
                  <span className="relative block h-3.5 w-3.5 rounded-full border-2 border-white bg-sky-600 shadow" />
                </span>
              </MarkerContent>
            </MapMarker>
          )}
          <MapDrawCapture
            active={drawMode !== 'none'}
            onPoint={handleMapPoint}
            onFinish={drawMode === 'spot' ? undefined : finishDraft}
          />
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
        visible={showInventory && inventory.units.length > 0 && (!eye || drive.showAnalysis)}
        // With the road view open a click on the plan moves it; adopting a unit is step 1's job.
        onFeatureClick={(id) => {
          if (eye || !drive.active) handleAdoptUnit(id)
        }}
        hoverHtml={inventoryHoverHtml}
      />
      {/* Both terrain readings, coloured by reading; the one in front filled and drawn heavier. */}
      {!eye && (
        <>
          <MapFillLayer
            data={planCandidates}
            fillColor={['match', ['get', 'method'], 'facing', FACE_CANDIDATE_COLOR, TERRAIN_CANDIDATE_COLOR] as never}
            fillOpacity={['case', ['==', ['get', 'selected'], 1], 0.08, 0] as never}
            lineWidth={0}
          />
          <MapLineLayer
            data={planCandidates}
            color={['match', ['get', 'method'], 'facing', FACE_CANDIDATE_COLOR, TERRAIN_CANDIDATE_COLOR] as never}
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
      />
      {!eye && (
        <>
          <MapCircleLayer
            data={planInventoryPoints}
            visible={showInventory}
            radius={5}
            color={['case', ['==', ['get', 'kind'], 'rec-site'], INVENTORY_COLORS.recSite, INVENTORY_COLORS.viewpoint]}
            strokeColor="#ffffff"
            strokeWidth={1.5}
            idProperty="id"
            hoverHtml={viewpointHoverHtml}
            onFeatureClick={(id) => {
              const candidate = viewpointCandidates.find((entry) => entry.key === id)
              if (candidate) handleUseViewpoint(candidate)
            }}
          />
          <MapCircleLayer
            data={planClues}
            radius={3}
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
      <MapFillLayer
        data={landscapeCollection}
        visible={eye ? drive.showAnalysis || drive.showLandform : shown('landform')}
        fillColor={ROLE_COLORS.landscape}
        fillOpacity={eye && drive.showLandform ? 0.18 : 0.08}
        lineColor={ROLE_COLORS.landscape}
        lineWidth={eye ? 3 : 1.6}
        lineOpacity={0.8}
        idProperty="id"
        selectedId={selectedTargetId}
        onFeatureClick={(id) => setSelectedTargetId(id)}
        hoverHtml={targetHoverHtml}
      />
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
        onFeatureClick={(id) => setSelectedTargetId(id)}
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
        onFeatureClick={(id) => setSelectedTargetId(id)}
        hoverHtml={targetHoverHtml}
      />

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
      {/* Sample points carry the answer: red is ground the road can see. */}
      <MapCircleLayer
        data={planSamples}
        onFeatureClick={(_id, _event, properties) =>
          // On the plan, a click moves the open road view instead.
          (eye || !drive.active) &&
          onInspectSample(
            String(properties.targetId),
            Number(properties.sampleIndex),
            eye ? driveStationIndex : (result?.assessmentStationIndex ?? 0),
          )
        }
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

          <MapLineLayer data={draftLine} color="#111827" width={2} dashArray={[2, 1.5]} opacity={0.9} />
          <MapCircleLayer data={draftVertices} color="#111827" radius={4} strokeColor="#ffffff" strokeWidth={1.2} />
        </>
      )}
    </>
  )
}
