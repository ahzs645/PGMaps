import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Map, MapControls, type MapRef } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapOverlay } from '@/components/ui/map-panels'
import { PG_CENTER } from '@/components/ui/map-styles'
import { escapeHtml } from '@/lib/escapeHtml'

import {
  clampQueryBounds,
  fetchCanopyStands,
  fetchHarvestedAreas,
  fetchSensitivityUnits,
  unitsToGeoJson,
  type BcSensitivityUnit,
} from './dev-forestry/bcVisualInventory'
import type { CanopyStand } from './dev-forestry/canopy'
import { DriveCamera } from './dev-forestry/DriveCamera'
import { ForestOverlay } from './dev-forestry/ForestOverlay'
import { bufferLine, speciesFromCode, type InventoryStand } from './dev-forestry/forest'
import { MapDrawCapture } from './dev-forestry/MapDrawCapture'
import { reverseRoadsToGeoJson } from './dev-forestry/reverseViewshed'
import { collectRoadsFromMap, snapCorridorToRoad, type RoadCandidate } from './dev-forestry/roadSnap'
import { Sidebar, type DrawMode, type DriveState } from './dev-forestry/Sidebar'
import { TerrainSupport } from './dev-forestry/TerrainSupport'
import { readShapeFile } from './dev-forestry/shapeImport'
import {
  ROLE_COLORS,
  createEmptyScene,
  createId,
  createSampleScene,
  corridorExposureToGeoJson,
  draftLineToGeoJson,
  loadStoredScene,
  pointsToGeoJson,
  samplesToGeoJson,
  sceneBounds,
  serializeScene,
  stationsToGeoJson,
  storeScene,
  targetBounds,
  targetsToGeoJson,
  type ForestryScene,
} from './dev-forestry/scene'
import type { AnalysisInput, ReverseInput, TargetPolygon, Viewpoint } from './dev-forestry/types'
import { useVisibilityAnalysis } from './dev-forestry/useVisibilityAnalysis'
import { DEFAULT_VISUAL_QUALITY_CLASS_ID, visualQualityClass } from './dev-forestry/vqo'
import { bearingDegrees, lineLengthMeters, polygonBounds } from './dev-forestry/visibility'

const VISIBLE_COLOR = '#ef4444'
const SCREENED_COLOR = '#0f766e'

/**
 * Exposure, cold to hot. Sequential in one hue family from slate through amber
 * to the same red the visible ground uses, so a hot road and red ground read as
 * the same thing.
 */
const EXPOSURE_RAMP = [
  'interpolate',
  ['linear'],
  ['get', 'visiblePercent'],
  0,
  '#94a3b8',
  1,
  '#fcd34d',
  15,
  '#f59e0b',
  40,
  '#ea580c',
  70,
  VISIBLE_COLOR,
] as const

const DEFAULT_DRIVE: DriveState = {
  active: false,
  playing: false,
  speedKmh: 60,
  positionMeters: 0,
  lookAtTargetId: null,
  exaggeration: 1,
  forest: true,
  treeHeightMeters: 28,
  // Wider than a road, deliberately: at a true right-of-way width the near
  // timber fills the frame and nothing beyond it can be judged.
  roadClearWidthMeters: 90,
  treeStyle: 'billboard',
}

const FIT_PADDING = { top: 72, bottom: 72, left: 48, right: 48 }

type InventoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  units: BcSensitivityUnit[]
  error: string | null
  truncated: boolean
  harvestCount: number
  /** Surveyed stands, for drawing the 3D timber as what is recorded there. */
  stands: CanopyStand[]
}

/** Marks openings pulled from DataBC, so a re-lookup replaces them cleanly. */
const HARVEST_SOURCE = 'BC consolidated cutblocks'

/** Closes a traced ring and rejects anything too small to be a polygon. */
function ringToPolygon(coordinates: Array<[number, number]>): GeoJSON.Polygon | null {
  if (coordinates.length < 3) return null
  const ring = [...coordinates]
  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat])
  return { type: 'Polygon', coordinates: [ring] }
}

function downloadJson(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoking synchronously cancels the download in WebKit and embedded shells.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * The last scene the browser saved, or the worked example — the page opening on
 * a blank map teaches nothing about what it does.
 */
function loadInitialScene(): ForestryScene {
  const stored = loadStoredScene()
  return stored && stored.targets.length > 0 ? stored : createSampleScene()
}

function DevForestryVisuals() {
  const mapRef = useRef<MapRef>(null)
  const [scene, setScene] = useState<ForestryScene>(loadInitialScene)
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [draftCoordinates, setDraftCoordinates] = useState<Array<[number, number]>>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(
    () => scene.targets.find((target) => target.role === 'block')?.id ?? null,
  )
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [drive, setDrive] = useState<DriveState>(DEFAULT_DRIVE)
  const [inventory, setInventory] = useState<InventoryState>({
    status: 'idle',
    units: [],
    error: null,
    truncated: false,
    harvestCount: 0,
    stands: [],
  })
  const [showInventory, setShowInventory] = useState(true)
  const [driveStationIndex, setDriveStationIndex] = useState(0)
  const [seekVersion, setSeekVersion] = useState(0)
  const [snapMessage, setSnapMessage] = useState<string | null>(null)
  const [forestStatus, setForestStatus] = useState<{
    treeCount: number
    trianglesPerTree: number
    error: string | null
  } | null>(null)
  // The roads the last reverse run was scored against, so a result can be
  // turned back into a corridor without re-querying a map that has since moved.
  const reverseRoadsRef = useRef<RoadCandidate[]>([])
  const preDriveViewport = useRef<{
    center: [number, number]
    zoom: number
    bearing: number
    pitch: number
  } | null>(null)

  const analysis = useVisibilityAnalysis()
  const result = analysis.state.result

  const fitBounds = useCallback((bounds: [number, number, number, number] | null, maxZoom = 13) => {
    const map = mapRef.current
    if (!map || !bounds) return
    map.fitBounds(bounds, { padding: FIT_PADDING, duration: 700, maxZoom })
  }, [])

  useEffect(() => {
    storeScene(scene)
  }, [scene])

  const sceneRef = useRef(scene)
  useEffect(() => {
    sceneRef.current = scene
  })

  useEffect(() => {
    // The map needs a frame to mount before it can be fitted, and this runs
    // once for the scene the page opened with.
    const timer = window.setTimeout(() => fitBounds(sceneBounds(sceneRef.current)), 350)
    return () => window.clearTimeout(timer)
  }, [fitBounds])

  const updateDrive = useCallback((patch: Partial<DriveState>) => {
    setDrive((current) => {
      const next = { ...current, ...patch }
      return next
    })
    if (patch.positionMeters !== undefined) setSeekVersion((version) => version + 1)
  }, [])

  // Entering drive mode hands the camera to DriveCamera; leaving puts the map
  // back where the user left it rather than stranding them at ground level.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (drive.active) {
      if (!preDriveViewport.current) {
        const center = map.getCenter()
        preDriveViewport.current = {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        }
      }
      return
    }
    const previous = preDriveViewport.current
    preDriveViewport.current = null
    if (previous) map.easeTo({ ...previous, duration: 600 })
  }, [drive.active])

  const setViewpoint = useCallback((viewpoint: Viewpoint) => {
    setScene((current) => ({ ...current, viewpoint }))
    setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
  }, [])

  const addTarget = useCallback((target: TargetPolygon) => {
    setScene((current) => ({ ...current, targets: [...current.targets, target] }))
    if (target.role === 'block') setSelectedTargetId(target.id)
  }, [])

  const handleMapPoint = useCallback(
    (position: [number, number]) => {
      if (drawMode === 'spot') {
        setScene((current) => ({
          ...current,
          viewpoint: { ...current.viewpoint, mode: 'spot', coordinates: [position] },
        }))
        setDrawMode('none')
        return
      }
      if (drawMode === 'none') return
      setDraftCoordinates((current) => [...current, position])
    },
    [drawMode],
  )

  const finishDraft = useCallback(() => {
    if (drawMode === 'corridor') {
      if (draftCoordinates.length >= 2) {
        setScene((current) => ({
          ...current,
          viewpoint: { ...current.viewpoint, mode: 'corridor', coordinates: draftCoordinates },
        }))
      }
    } else if (drawMode === 'block' || drawMode === 'landscape') {
      const geometry = ringToPolygon(draftCoordinates)
      if (geometry) {
        addTarget({
          id: createId(drawMode),
          name: drawMode === 'block' ? 'Traced block' : 'Traced landform',
          role: drawMode,
          objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
          vac: null,
          harvestYear: null,
          clearcutPercent: null,
          geometry,
          source: 'Drawn here',
        })
      }
    }
    setDraftCoordinates([])
    setDrawMode('none')
  }, [addTarget, draftCoordinates, drawMode])

  const handleDrawModeChange = useCallback((mode: DrawMode) => {
    setDraftCoordinates([])
    setDrawMode(mode)
  }, [])

  const handleImportFile = useCallback(
    async (file: File) => {
      setImportMessage('Reading…')
      try {
        const imported = await readShapeFile(file)
        if (imported.polygons.length === 0 && imported.lines.length === 0) {
          setImportMessage(`Could not find any polygons or lines in ${file.name}.`)
          return
        }

        const newTargets: TargetPolygon[] = imported.polygons.map((polygon) => ({
          id: createId('block'),
          name: polygon.name,
          role: 'block' as const,
          objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
          vac: null,
          harvestYear: null,
          clearcutPercent: null,
          geometry: polygon.geometry,
          source: file.name,
        }))

        // A planning package often carries the road as well as the blocks. The
        // longest line becomes the corridor, but only when none is set yet.
        const longestLine = imported.lines.reduce<(typeof imported.lines)[number] | null>(
          (longest, line) =>
            !longest || lineLengthMeters(line.coordinates) > lineLengthMeters(longest.coordinates) ? line : longest,
          null,
        )

        let usedLine = false
        setScene((current) => {
          const takeLine = longestLine !== null && current.viewpoint.coordinates.length === 0
          usedLine = takeLine
          return {
            ...current,
            targets: [...current.targets, ...newTargets],
            viewpoint: takeLine
              ? {
                  ...current.viewpoint,
                  name: longestLine.name,
                  mode: 'corridor',
                  coordinates: longestLine.coordinates,
                }
              : current.viewpoint,
          }
        })

        if (newTargets.length > 0) setSelectedTargetId(newTargets[0].id)
        const parts = [
          newTargets.length > 0 && `${newTargets.length} polygon${newTargets.length === 1 ? '' : 's'}`,
          usedLine && 'a road centreline',
          imported.skippedCount > 0 && `${imported.skippedCount} skipped`,
        ].filter(Boolean)
        setImportMessage(`Imported ${parts.join(', ')} from ${file.name}.`)

        const bounds = newTargets.length > 0 ? polygonBounds(newTargets[0].geometry) : null
        window.setTimeout(() => fitBounds(bounds as [number, number, number, number] | null), 50)
      } catch (error) {
        setImportMessage(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [fitBounds],
  )

  /**
   * Asks DataBC what the inventory says about the area on screen. Coverage is
   * patchy, so "nothing here" is a real and common answer rather than a fault.
   */
  const handleLookupInventory = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const view = map.getBounds()
    const bounds = clampQueryBounds([view.getWest(), view.getSouth(), view.getEast(), view.getNorth()])

    setInventory({ status: 'loading', units: [], error: null, truncated: false, harvestCount: 0, stands: [] })
    setShowInventory(true)
    try {
      // Existing openings come back in the same pass: the objective is met or
      // missed by what is on the ground plus what is proposed, not by the
      // proposal alone. They settle independently — losing the openings should
      // cost the cumulative figure, not the objective lookup as well.
      // Forest cover comes back in the same pass. It is what lets the 3D stand
      // draw the species and height the province recorded rather than a
      // regional mix, and like the openings it settles on its own — losing it
      // should cost the drawing, not the objective lookup.
      const [inventorySettled, harvestSettled, standsSettled] = await Promise.allSettled([
        fetchSensitivityUnits(bounds),
        fetchHarvestedAreas(bounds),
        fetchCanopyStands(bounds),
      ])
      if (inventorySettled.status === 'rejected') throw inventorySettled.reason
      const inventoryResult = inventorySettled.value
      const harvestResult = harvestSettled.status === 'fulfilled' ? harvestSettled.value : { areas: [] }
      const standsResult = standsSettled.status === 'fulfilled' ? standsSettled.value : { stands: [] }

      setScene((current) => {
        const kept = current.targets.filter(
          (target) => !(target.role === 'harvested' && target.source === HARVEST_SOURCE),
        )
        return {
          ...current,
          targets: [
            ...kept,
            ...harvestResult.areas.map((area) => ({
              id: createId('harvested'),
              name: area.name,
              role: 'harvested' as const,
              objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
              vac: null,
              harvestYear: area.harvestYear,
              clearcutPercent: area.clearcutPercent,
              geometry: area.geometry,
              source: HARVEST_SOURCE,
            })),
          ],
        }
      })

      setInventory({
        status: 'ready',
        units: inventoryResult.units,
        error: null,
        truncated: inventoryResult.truncated,
        harvestCount: harvestResult.areas.length,
        stands: standsResult.stands,
      })
    } catch (error) {
      setInventory({
        status: 'error',
        units: [],
        error: error instanceof Error ? error.message : String(error),
        truncated: false,
        harvestCount: 0,
        stands: [],
      })
    }
  }, [])

  /** Adopts an inventory polygon as the landform, carrying its rating across. */
  const handleAdoptUnit = useCallback(
    (unitId: string) => {
      const unit = inventory.units.find((entry) => entry.id === unitId)
      if (!unit) return

      const objectiveId = unit.objectiveId ?? unit.recommendedId ?? DEFAULT_VISUAL_QUALITY_CLASS_ID
      const label = unit.objectiveId ? 'established' : unit.recommendedId ? 'recommended' : 'unrated'
      addTarget({
        id: createId('landform'),
        name: `${unit.name} · ${visualQualityClass(objectiveId).code} (${label})`,
        role: 'landscape',
        objectiveId,
        vac: unit.vac,
        harvestYear: null,
        clearcutPercent: null,
        geometry: unit.geometry,
        source: 'BC visual landscape inventory',
      })
      setSelectedTargetId(unitId)
    },
    [addTarget, inventory.units],
  )

  const handleRun = useCallback(() => {
    const input: AnalysisInput = {
      viewpoint: { mode: scene.viewpoint.mode, coordinates: scene.viewpoint.coordinates },
      targets: scene.targets.map((target) => ({
        id: target.id,
        name: target.name,
        role: target.role,
        geometry: target.geometry,
        harvestYear: target.harvestYear,
        clearcutPercent: target.clearcutPercent,
      })),
      settings: scene.settings,
      assessmentYear: new Date().getFullYear(),
    }
    setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
    analysis.run(input)
  }, [analysis, scene])

  /**
   * Replaces the drawn viewpoint with the road it was tracing.
   *
   * A hand-drawn line puts viewing stations wherever the click landed, which in
   * steep ground is often over the bank or in the ditch — and a station in the
   * ditch reports seeing nothing. The road the basemap draws is where a driver
   * actually is.
   */
  const handleSnapToRoad = useCallback(() => {
    const map = mapRef.current
    if (!map || scene.viewpoint.coordinates.length === 0) return

    const roads = collectRoadsFromMap(map)
    if (roads.length === 0) {
      setSnapMessage('No roads drawn at this zoom. Zoom in until the road shows, then try again.')
      return
    }

    const snapped = snapCorridorToRoad(scene.viewpoint.coordinates, roads)
    if (!snapped) {
      setSnapMessage('Nothing within 250 m of the line. Draw closer to the road, or zoom in.')
      return
    }

    setScene((current) => ({
      ...current,
      viewpoint: {
        ...current.viewpoint,
        name: snapped.road.name,
        mode: 'corridor',
        coordinates: snapped.coordinates,
      },
    }))
    setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
    setSnapMessage(
      `Locked onto ${snapped.road.name} — ${(lineLengthMeters(snapped.coordinates) / 1000).toFixed(2)} km, ` +
        `moved about ${snapped.meanOffsetMeters.toFixed(0)} m.`,
    )
  }, [scene.viewpoint.coordinates])

  /** Scores every road on screen by how much of the selected block it can see. */
  const handleRunReverse = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    const selected = scene.targets.find((target) => target.id === selectedTargetId && target.role === 'block')
    const blocks = selected ? [selected] : scene.targets.filter((target) => target.role === 'block')
    if (blocks.length === 0) return

    const roads = collectRoadsFromMap(map)
    reverseRoadsRef.current = roads

    const input: ReverseInput = {
      blocks: blocks.map((block) => ({ id: block.id, name: block.name, geometry: block.geometry })),
      roads: roads.map((road) => ({
        id: road.id,
        name: road.name,
        roadClass: road.roadClass,
        coordinates: road.coordinates,
      })),
      settings: scene.settings,
    }
    setDrive((current) => ({ ...current, active: false, playing: false }))
    analysis.runReverse(input)
  }, [analysis, scene.settings, scene.targets, selectedTargetId])

  /** Turns one of the ranked roads into the corridor the assessment runs along. */
  const handleUseRoad = useCallback(
    (roadId: string) => {
      const road = reverseRoadsRef.current.find((entry) => entry.id === roadId)
      if (!road || road.coordinates.length < 2) return

      setScene((current) => ({
        ...current,
        viewpoint: { ...current.viewpoint, name: road.name, mode: 'corridor', coordinates: road.coordinates },
      }))
      setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
      setSnapMessage(`Corridor set to ${road.name}. Run the visibility assessment for the full figures.`)
      fitBounds(
        road.coordinates.reduce<[number, number, number, number]>(
          (box, [lng, lat]) => [
            Math.min(box[0], lng),
            Math.min(box[1], lat),
            Math.max(box[2], lng),
            Math.max(box[3], lat),
          ],
          [Infinity, Infinity, -Infinity, -Infinity],
        ),
      )
    },
    [fitBounds],
  )

  const handleZoomToTarget = useCallback(
    (targetId: string) => {
      const target = scene.targets.find((entry) => entry.id === targetId)
      if (target) fitBounds(targetBounds(target), 14)
    },
    [fitBounds, scene.targets],
  )

  const handleExport = useCallback(() => {
    downloadJson('forestry-visual-quality-scene.json', serializeScene(scene))
  }, [scene])

  const handleLoadSample = useCallback(() => {
    const sample = createSampleScene()
    analysis.reset()
    setScene(sample)
    setSelectedTargetId(sample.targets.find((target) => target.role === 'block')?.id ?? null)
    setDrive(DEFAULT_DRIVE)
    setImportMessage(null)
    window.setTimeout(() => fitBounds(sceneBounds(sample)), 50)
  }, [analysis, fitBounds])

  const handleClearScene = useCallback(() => {
    analysis.reset()
    setScene(createEmptyScene())
    setSelectedTargetId(null)
    setDrive(DEFAULT_DRIVE)
    setImportMessage(null)
    setDrawMode('none')
    setDraftCoordinates([])
  }, [analysis])

  const blockCollection = useMemo(() => targetsToGeoJson(scene.targets, 'block'), [scene.targets])
  const landscapeCollection = useMemo(() => targetsToGeoJson(scene.targets, 'landscape'), [scene.targets])
  const harvestedCollection = useMemo(() => targetsToGeoJson(scene.targets, 'harvested'), [scene.targets])
  const corridorCollection = useMemo(
    () =>
      scene.viewpoint.mode === 'corridor'
        ? draftLineToGeoJson(scene.viewpoint.coordinates)
        : { type: 'FeatureCollection' as const, features: [] },
    [scene.viewpoint],
  )
  const spotCollection = useMemo(
    () =>
      scene.viewpoint.mode === 'spot'
        ? pointsToGeoJson(scene.viewpoint.coordinates, { kind: 'viewpoint' })
        : { type: 'FeatureCollection' as const, features: [] },
    [scene.viewpoint],
  )
  const draftLine = useMemo(() => draftLineToGeoJson(draftCoordinates), [draftCoordinates])
  const draftVertices = useMemo(() => pointsToGeoJson(draftCoordinates), [draftCoordinates])
  const stationCollection = useMemo(() => stationsToGeoJson(result), [result])
  const inventoryCollection = useMemo(() => unitsToGeoJson(inventory.units), [inventory.units])
  const reverseRoadCollection = useMemo(
    () => reverseRoadsToGeoJson(analysis.reverseState.result),
    [analysis.reverseState.result],
  )
  // The road graded by what it sees, rather than the stations it was sampled at.
  const corridorExposureCollection = useMemo(
    () => corridorExposureToGeoJson(result, selectedTargetId),
    [result, selectedTargetId],
  )

  // Where the eye is on the road. The map's centre is no use for this: pitched
  // at the horizon from ground level, it sits kilometres out at the skyline.
  const driveEye = useMemo(() => {
    const station = result?.stations[driveStationIndex]
    return station ? { lng: station.lng, lat: station.lat } : null
  }, [driveStationIndex, result])

  // Timber fills the view and the openings take it off. Not the landform: that
  // is an assessment unit drawn around a hill, not a stand boundary, and the
  // road an assessment is written from is usually outside it.
  const forestStands = useMemo<GeoJSON.Polygon[]>(() => [], [])
  // What the province recorded on this ground, reduced to what the drawing
  // needs. Coverage is managed openings only, so most of a view falls through
  // to the regional mix — which is why the panel reports how much did not.
  const forestInventory = useMemo<InventoryStand[]>(
    () =>
      inventory.stands.map((stand) => ({
        geometry: stand.geometry,
        species: speciesFromCode(stand.speciesCode),
        heightMeters: stand.heightMeters > 0 ? stand.heightMeters : null,
      })),
    [inventory.stands],
  )

  const forestClearings = useMemo(() => {
    const openings: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon> = scene.targets
      .filter((target) => target.role === 'block' || target.role === 'harvested')
      .map((target) => target.geometry)

    // The road is a clearing too. Without it the camera stands inside the timber
    // and the drive shows a trunk, which is not what a road looks like.
    const corridor =
      scene.viewpoint.mode === 'corridor'
        ? bufferLine(scene.viewpoint.coordinates, drive.roadClearWidthMeters / 2)
        : null
    return corridor ? [...openings, corridor] : openings
  }, [drive.roadClearWidthMeters, scene.targets, scene.viewpoint])

  // On the map, show what the whole road can see. Driving narrows it to the one
  // point the camera is standing at, which is the thing worth watching change.
  const sampleCollection = useMemo(
    () => samplesToGeoJson(result, { stationIndex: drive.active ? driveStationIndex : null }),
    [driveStationIndex, drive.active, result],
  )

  const lookAtTarget = useMemo(() => {
    if (!drive.lookAtTargetId || !result) return null
    const target = result.targets.find((entry) => entry.targetId === drive.lookAtTargetId)
    if (!target || target.sampleCount === 0) return null

    let lngTotal = 0
    let latTotal = 0
    let elevationTotal = 0
    let counted = 0
    for (let index = 0; index < target.sampleCount; index += 1) {
      lngTotal += target.positions[index * 2]
      latTotal += target.positions[index * 2 + 1]
      const elevation = target.elevations[index]
      if (Number.isFinite(elevation)) {
        elevationTotal += elevation
        counted += 1
      }
    }
    return {
      lng: lngTotal / target.sampleCount,
      lat: latTotal / target.sampleCount,
      elevationMeters: counted > 0 ? elevationTotal / counted : 0,
    }
  }, [drive.lookAtTargetId, result])

  // A spot viewpoint has no direction of travel, so it faces the first block.
  const spotBearing = useMemo(() => {
    if (!result || result.stations.length === 0) return 0
    const block = result.targets.find((target) => target.role === 'block' && target.sampleCount > 0)
    if (!block) return 0
    return bearingDegrees(result.stations[0], {
      lng: block.positions[0],
      lat: block.positions[1],
    })
  }, [result])

  const inventoryHoverHtml = useCallback((properties: Record<string, unknown>) => {
    const name = escapeHtml(String(properties.name ?? 'Sensitivity unit'))
    const objective = String(properties.objectiveId ?? '')
    const vac = String(properties.vac ?? '')
    const vsc = String(properties.vsc ?? '')
    const rows = [
      objective ? `Objective: ${escapeHtml(visualQualityClass(objective as never).label)}` : 'No established objective',
      vac ? `VAC: ${escapeHtml(vac)}` : 'VAC not rated',
      vsc ? `Sensitivity class ${escapeHtml(vsc)}` : null,
      Number(properties.scenicArea) === 1 ? 'Scenic area' : null,
    ].filter(Boolean)
    return `<strong>${name}</strong><br/>${rows.join('<br/>')}<br/><em>Click to use as the landform</em>`
  }, [])

  const targetHoverHtml = useCallback((properties: Record<string, unknown>) => {
    const name = escapeHtml(String(properties.name ?? 'Polygon'))
    const area = Number(properties.areaHectares ?? 0).toFixed(1)
    return `<strong>${name}</strong><br/>${area} ha`
  }, [])

  const handleTargetChange = useCallback((targetId: string, patch: Partial<TargetPolygon>) => {
    setScene((current) => ({
      ...current,
      targets: current.targets.map((target) => (target.id === targetId ? { ...target, ...patch } : target)),
    }))
  }, [])

  const handleRemoveTarget = useCallback((targetId: string) => {
    setScene((current) => ({
      ...current,
      targets: current.targets.filter((target) => target.id !== targetId),
    }))
    setSelectedTargetId((current) => (current === targetId ? null : current))
  }, [])

  const sidebar = (
    <Sidebar
      scene={scene}
      onViewpointChange={setViewpoint}
      onSettingsChange={(settings) => setScene((current) => ({ ...current, settings }))}
      onThresholdsChange={(thresholds) => setScene((current) => ({ ...current, thresholds }))}
      onTargetChange={handleTargetChange}
      onRemoveTarget={handleRemoveTarget}
      onZoomToTarget={handleZoomToTarget}
      drawMode={drawMode}
      onDrawModeChange={handleDrawModeChange}
      draftCoordinates={draftCoordinates}
      onFinishDraft={finishDraft}
      onSnapToRoad={handleSnapToRoad}
      snapMessage={snapMessage}
      analysis={analysis.state}
      onRun={handleRun}
      onCancel={analysis.cancel}
      reverse={analysis.reverseState}
      onRunReverse={handleRunReverse}
      onUseRoad={handleUseRoad}
      forestStatus={forestStatus}
      selectedTargetId={selectedTargetId}
      onSelectTarget={setSelectedTargetId}
      drive={drive}
      onDriveChange={updateDrive}
      onImportFile={(file) => void handleImportFile(file)}
      importMessage={importMessage}
      inventory={inventory}
      showInventory={showInventory}
      onToggleInventory={() => setShowInventory((current) => !current)}
      onLookupInventory={() => void handleLookupInventory()}
      onAdoptUnit={handleAdoptUnit}
      onLoadSample={handleLoadSample}
      onClearScene={handleClearScene}
      onExport={handleExport}
    />
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={400}
      mobileInitialSheetState="half"
      selectedFeatureMobilePeek={{
        title: 'Visual quality',
        subtitle: result
          ? `${result.targets.filter((target) => target.role === 'block').length} block(s) assessed`
          : 'Place a viewpoint and run',
      }}
    >
      <Map
        ref={mapRef}
        center={PG_CENTER}
        zoom={9}
        maxPitch={85}
        controls={<MapControls position="top-right" mobilePosition="bottom-right" />}
      >
        <TerrainSupport
          terrain={drive.active}
          exaggeration={drive.exaggeration}
          hillshade
          hillshadeIntensity={drive.active ? 0.25 : 0.45}
        />
        <ForestOverlay
          active={drive.active && drive.forest}
          centre={driveEye}
          stands={forestStands}
          clearings={forestClearings}
          standHeightMeters={drive.treeHeightMeters}
          inventory={forestInventory}
          style={drive.treeStyle}
          exaggeration={drive.exaggeration}
          onStatus={setForestStatus}
        />
        <MapDrawCapture
          active={drawMode !== 'none'}
          onPoint={handleMapPoint}
          onFinish={drawMode === 'spot' ? undefined : finishDraft}
        />

        {/* Inventory polygons sit under the scene's own, and units with nothing
            established are drawn back so the ones that constrain harvesting read first. */}
        <MapFillLayer
          data={inventoryCollection}
          fillColor="#0ea5e9"
          fillOpacity={['case', ['==', ['get', 'rated'], 1], 0.1, 0.03]}
          lineColor={['case', ['==', ['get', 'rated'], 1], '#0284c7', '#94a3b8']}
          lineWidth={['case', ['==', ['get', 'rated'], 1], 1.6, 0.7]}
          lineOpacity={0.9}
          idProperty="id"
          visible={showInventory && inventory.units.length > 0}
          onFeatureClick={(id) => handleAdoptUnit(id)}
          hoverHtml={inventoryHoverHtml}
        />
        <MapFillLayer
          data={landscapeCollection}
          fillColor={ROLE_COLORS.landscape}
          fillOpacity={0.08}
          lineColor={ROLE_COLORS.landscape}
          lineWidth={1.6}
          lineOpacity={0.8}
          idProperty="id"
          selectedId={selectedTargetId}
          onFeatureClick={(id) => setSelectedTargetId(id)}
          hoverHtml={targetHoverHtml}
        />
        {/* Existing openings sit under the proposal, in a duller colour: they
            are context for the cumulative number, not the thing being assessed. */}
        <MapFillLayer
          data={harvestedCollection}
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
          data={blockCollection}
          fillColor={ROLE_COLORS.block}
          fillOpacity={drive.active ? 0.55 : 0.3}
          lineColor={ROLE_COLORS.block}
          lineWidth={1.8}
          lineOpacity={0.95}
          idProperty="id"
          selectedId={selectedTargetId}
          selectionColor="#111827"
          onFeatureClick={(id) => setSelectedTargetId(id)}
          hoverHtml={targetHoverHtml}
        />

        {/* Sample points carry the answer: red is ground the road can see. */}
        <MapCircleLayer
          data={sampleCollection}
          color={['case', ['==', ['get', 'visible'], 1], VISIBLE_COLOR, SCREENED_COLOR]}
          radius={['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 2.6, 15, 5]}
          opacity={['case', ['==', ['get', 'visible'], 1], 0.95, 0.35]}
          strokeWidth={0}
        />

        {/* The reverse answer sits on the roads themselves: a hot stretch is
            road the block is in view from, a cold one road where it is hidden.
            Drawn as the road rather than as the points it was sampled at. */}
        <MapLineLayer
          data={reverseRoadCollection}
          color={EXPOSURE_RAMP as never}
          width={['case', ['==', ['get', 'seen'], 1], 4.5, 2]}
          opacity={['case', ['==', ['get', 'seen'], 1], 0.95, 0.45]}
          visible={!drive.active}
        />

        {/* From eye level the road is directly under the camera, where a line
            and its stations fill the frame instead of marking anything. */}
        <MapLineLayer data={corridorCollection} color="#1d4ed8" width={3} opacity={0.9} visible={!drive.active} />
        {/* Once a run exists the corridor carries its own answer: how much of
            the block each stretch of road sees, graded along it. */}
        <MapLineLayer
          data={corridorExposureCollection}
          color={EXPOSURE_RAMP as never}
          width={5}
          opacity={0.95}
          visible={!drive.active}
        />
        {/* Only the assessment viewpoint keeps a marker — it is a single place,
            not a sample of a continuum. */}
        <MapCircleLayer
          data={stationCollection}
          color="#facc15"
          radius={['case', ['==', ['get', 'assessment'], 1], 6, 0]}
          strokeColor="#ffffff"
          strokeWidth={['case', ['==', ['get', 'assessment'], 1], 1.5, 0]}
          visible={!drive.active}
        />
        <MapCircleLayer
          data={spotCollection}
          color="#1d4ed8"
          radius={7}
          strokeColor="#ffffff"
          strokeWidth={2}
          visible={!drive.active}
        />

        <MapLineLayer data={draftLine} color="#111827" width={2} dashArray={[2, 1.5]} opacity={0.9} />
        <MapCircleLayer data={draftVertices} color="#111827" radius={4} strokeColor="#ffffff" strokeWidth={1.2} />

        {result && (
          <DriveCamera
            active={drive.active}
            playing={drive.playing}
            stations={result.stations}
            seekMeters={drive.positionMeters}
            seekVersion={seekVersion}
            speedMetersPerSecond={(drive.speedKmh * 1000) / 3600}
            eyeHeightMeters={scene.settings.observerHeightMeters}
            lookAt={lookAtTarget}
            spotBearing={spotBearing}
            onPosition={({ distanceMeters, stationIndex }) => {
              setDriveStationIndex(stationIndex)
              setDrive((current) => (current.playing ? { ...current, positionMeters: distanceMeters } : current))
            }}
            onReachEnd={() => setDrive((current) => ({ ...current, playing: false }))}
          />
        )}
      </Map>

      {result && !drive.active && (
        <MapOverlay position="bottom-left" className="max-w-[15rem]">
          <p className="mb-1.5 text-xs font-semibold text-foreground">Seen from the road</p>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VISIBLE_COLOR }} />
              Visible ground
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full opacity-50" style={{ backgroundColor: SCREENED_COLOR }} />
              Screened by terrain
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
              Assessment viewpoint
            </span>
            {/* The ramp itself, so a grey stretch of road reads as "sees
                nothing from here" rather than as an unstyled line. */}
            <span className="flex items-center gap-1.5 pt-0.5">
              <span
                className="h-1.5 w-10 shrink-0 rounded-full"
                style={{ backgroundImage: `linear-gradient(to right, #94a3b8, #fcd34d, #f59e0b, ${VISIBLE_COLOR})` }}
              />
              Road: none → most in view
            </span>
          </div>
        </MapOverlay>
      )}

      {drive.active && (
        <MapOverlay position="top-left" className="max-w-[16rem]">
          <p className="text-xs font-semibold text-foreground">Standing on the road</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            Red ground is what this point can see. Anything the terrain hides drops out as you move.
          </p>
        </MapOverlay>
      )}
    </MapSectionLayout>
  )
}

export default DevForestryVisuals
