import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import { Map, MapControls, MapScaleBar, type MapRef } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapOverlay } from '@/components/ui/map-panels'
import { PG_CENTER } from '@/components/ui/map-styles'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { escapeHtml } from '@/lib/escapeHtml'

import {
  clampQueryBounds,
  fetchCanopyStands,
  fetchHarvestedAreas,
  unitsToGeoJson,
  type BcSensitivityUnit,
} from './dev-forestry/bcVisualInventory'
import { queryVisualInventorySnapshot } from './dev-forestry/visualInventorySnapshot'
import { LandformDesignPanel } from './dev-forestry/LandformDesignPanel'
import { LandformSuggestions } from './dev-forestry/LandformSuggestions'
import { TerrainLandformFinder, type TerrainCandidate } from './dev-forestry/TerrainLandformFinder'
import type { CanopyStand } from './dev-forestry/canopy'
import { createRoadsideDriveScene, ROADSIDE_DEMO_ID, roadsideDriveCue } from './dev-forestry/driveScenario'
import { PreviewWorkflow } from './dev-forestry/PreviewWorkflow'
import { candidateDriveViews, parsePreview, PREVIEW_STORAGE_KEY, previewInputError, serializePreview, type SavedDriveView } from './dev-forestry/previewState'
import type { DriveStatus } from './dev-forestry/driveController'
import { DriveCamera } from './dev-forestry/DriveCamera'
import { AssessmentPanel } from './dev-forestry/AssessmentPanel'
import { buildSceneInput, sceneFingerprint, findSceneLandform } from './dev-forestry/sceneInput'
import { alterationWeight, resultMatchesInput } from './dev-forestry/integrity'
import { useForestHistory } from './dev-forestry/useForestHistory'
import { RegrowthControls } from './dev-forestry/RegrowthControls'
import { buildRegrowthStands, DEFAULT_REGROWTH, type ForestHistoryRecord } from './dev-forestry/regrowth'
import { useDriveTerrain } from './dev-forestry/useDriveTerrain'
import { ForestOverlay, type ForestStatus } from './dev-forestry/ForestOverlay'
import { blockThinning, bufferLine, speciesFromCode, type InventoryStand } from './dev-forestry/forest'
import { MapDrawCapture } from './dev-forestry/MapDrawCapture'
import { BasemapContextProbe, type BasemapContext } from './dev-forestry/BasemapContextProbe'
import { FieldPhotoPanel, PhotoOverlay, StreetPhotoInset } from './dev-forestry/FieldPhoto'
import { useFieldPhoto } from './dev-forestry/useFieldPhoto'
import type { MapillaryImage } from './dev-forestry/mapillary'
import { clearingWidthForRoadClass } from './dev-forestry/basemapContext'
import { buildReport } from './dev-forestry/report'
import { reverseRoadsToGeoJson } from './dev-forestry/reverseViewshed'
import { collectRoadsFromMap, nearestPointOnLine, snapCorridorToRoad, type RoadCandidate } from './dev-forestry/roadSnap'
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
import type { ReverseInput, TargetPolygon, Viewpoint } from './dev-forestry/types'
import { useVisibilityAnalysis } from './dev-forestry/useVisibilityAnalysis'
import { assessVia, fs1252ReviewFromVia, viaStepStatuses, type ViaReview } from './dev-forestry/via'
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
  existingForest: true,
  ...DEFAULT_REGROWTH,
  active: false,
  playing: false,
  speedKmh: 60,
  positionMeters: 0,
  lookAtTargetId: null,
  exaggeration: 1,
  forest: false,
  // The region's mature median (REGIONAL_STAND, from VRI).
  treeHeightMeters: 25,
  // Illustrative clearing only; this control never changes sightline screening.
  roadClearWidthMeters: 20,
  // Facing a block from the road otherwise shows the roadside trees, not the block.
  viewingGap: true,
  treeStyle: 'hybrid',
  harvestPhase: 'after',
  showAnalysis: false,
  quality: 'auto',
}

const HARVEST_PHASE_OPTIONS = [
  { value: 'before', label: 'Before harvest' },
  { value: 'after', label: 'After harvest' },
] as const satisfies ReadonlyArray<{ value: DriveState['harvestPhase']; label: string }>

const FIT_PADDING = { top: 72, bottom: 72, left: 48, right: 48 }

/**
 * Cleared width assumed for a road added as site disturbance. A forest service
 * road's running surface plus its cut-and-fill slopes is wider than the
 * driving surface, and it is the cleared ground that reads as alteration.
 */
const ROAD_DISTURBANCE_WIDTH_METERS = 20

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

function downloadFile(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
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
  const [pendingPreview, setPendingPreview] = useState<{ key: string; view?: SavedDriveView } | null>(null)
  const [saved, setSaved] = useState<{ key: string | null; views: SavedDriveView[] }>(() => {
    try { const stored = parsePreview(JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY) ?? 'null')); if (stored) return { key: sceneFingerprint(stored.scene), views: stored.views } } catch { /* Unavailable or old storage is recoverable by importing a preview. */ }
    return { key: sceneFingerprint(scene), views: [] }
  })
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)
  const [cameraStatus, setCameraStatus] = useState<DriveStatus>('waiting-for-terrain')
  const [lowFrameRate, setLowFrameRate] = useState(false)
  const [restoreLook, setRestoreLook] = useState({ yaw: 0, tilt: 0 })
  const cameraLook = useRef({ yaw: 0, tilt: 0 })
  const [drive, setDrive] = useState<DriveState>(DEFAULT_DRIVE)
  const driveRef = useRef(drive)
  driveRef.current = drive
  const [cameraEye, setCameraEye] = useState<{ lng: number; lat: number } | null>(null)
  const runSnapshotRef = useRef<{ scene: ForestryScene; inventoryUnits: BcSensitivityUnit[]; key: string } | null>(null)
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
  const [forestStatus, setForestStatus] = useState<ForestStatus | null>(null)
  // The roads the last reverse run was scored against, so a result can be
  // turned back into a corridor without re-querying a map that has since moved.
  const reverseRoadsRef = useRef<RoadCandidate[]>([])


  const analysis = useVisibilityAnalysis()
  const rawResult = analysis.state.result
  const key = sceneFingerprint(scene)
  const isStale = !!rawResult && (!key || runSnapshotRef.current?.key !== key || !resultMatchesInput(rawResult, buildSceneInput(scene)))
  const result = isStale ? null : rawResult
  const savedViews = saved.key === key ? saved.views : []
  // Handbook step 2 is done once the road has been looked at from eye level,
  // or a view saved from it. A visit belongs to the road and the proposal, not
  // to one run: re-running with other settings does not undo it, while moving
  // the road or a cutblock does.
  const visitKey = JSON.stringify([
    scene.viewpoint.coordinates,
    scene.targets.filter((target) => target.role === 'block').map((target) => target.geometry),
  ])
  const [visitedKey, setVisitedKey] = useState<string | null>(null)
  if (drive.active && result && visitedKey !== visitKey) setVisitedKey(visitKey)
  // Water and the road's class, read from the basemap while the overview shows.
  // Timber is kept off mapped water, and the roadside clearing follows the
  // road's class until the reviewer sets a width of their own.
  const [basemap, setBasemap] = useState<BasemapContext>({ water: [], roadClass: null })
  const [seenRoadClass, setSeenRoadClass] = useState<string | null>(null)
  const [autoClearing, setAutoClearing] = useState(DEFAULT_DRIVE.roadClearWidthMeters)
  if (basemap.roadClass !== seenRoadClass) {
    setSeenRoadClass(basemap.roadClass)
    const width = clearingWidthForRoadClass(basemap.roadClass)
    if (drive.roadClearWidthMeters === autoClearing) setDrive((current) => ({ ...current, roadClearWidthMeters: width }))
    setAutoClearing(width)
  }
  const basemapBounds = useMemo(() => {
    const bounds = sceneBounds(scene)
    return bounds ? ([bounds[0] - 0.12, bounds[1] - 0.07, bounds[2] + 0.12, bounds[3] + 0.07] as [number, number, number, number]) : null
  }, [scene])
  const sceneLandform = findSceneLandform(scene)
  const viaAssessment = useMemo(
    () => (sceneLandform ? assessVia({ objectiveId: sceneLandform.objectiveId, result, review: scene.viaReview, blocks: scene.targets.filter((target) => target.role === 'block') }) : null),
    [sceneLandform, result, scene.viaReview, scene.targets],
  )
  const viaStatuses = viaStepStatuses({
    hasViewpoint: scene.viewpoint.coordinates.length > 0,
    blockCount: scene.targets.filter((target) => target.role === 'block').length,
    hasLandform: !!sceneLandform,
    hasResult: !!result,
    visited: !!result && (visitedKey === visitKey || savedViews.length > 0),
    numericalReady: !!result?.quality?.numericalReady,
    assessment: viaAssessment,
  })
  const updateViaReview = useCallback((patch: Partial<ViaReview>) => {
    setScene((current) => ({ ...current, viaReview: { ...current.viaReview, ...patch } }))
  }, [])
  useEffect(() => {
    if (saved.key !== key) return
    try { localStorage.setItem(PREVIEW_STORAGE_KEY, serializePreview(scene, saved.views)); setStorageWarning(null) }
    catch { setStorageWarning('Browser storage is unavailable. Download the preview to keep your comparisons.') }
  }, [key, saved, scene])
  useEffect(() => { if (isStale) setDrive((current) => ({ ...current, active: false, playing: false })) }, [isStale])

  const fitBounds = useCallback((bounds: [number, number, number, number] | null, maxZoom = 13) => {
    const map = mapRef.current
    if (!map || !bounds || driveRef.current.active) return
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
    if (patch.active && !result) return
    if (patch.positionMeters !== undefined || patch.lookAtTargetId !== undefined || patch.active) setRestoreLook({ yaw: 0, tilt: 0 })
    if (patch.active) { setDrawMode('none'); setDraftCoordinates([]) }
    setDrive((current) => {
      const entering = patch.active === true && !current.active
      return { ...current, ...patch, exaggeration: 1,
        ...(entering && result ? {
          positionMeters: patch.positionMeters ?? (scene.viewpoint.id === ROADSIDE_DEMO_ID ? 200 : result.stations[result.assessmentStationIndex]?.distanceAlongMeters ?? 0),
          lookAtTargetId: patch.lookAtTargetId ?? null,
          forest: true,
        } : {}),
      }
    })
    if (patch.positionMeters !== undefined || patch.active) setSeekVersion((version) => version + 1)
  }, [result, scene.viewpoint.id])

  const setViewpoint = useCallback((viewpoint: Viewpoint) => {
    setScene((current) => ({ ...current, viewpoint }))
    setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
  }, [])

  const addTarget = useCallback((target: TargetPolygon) => {
    setScene((current) => ({ ...current, targets: [...current.targets, target], activeLandformId: target.role === 'landscape' ? target.id : current.activeLandformId }))
    setSelectedTargetId(target.id)
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
    setDrive((current) => ({ ...current, active: false, playing: false }))
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
  const lookupEpoch = useRef(0)
  const handleLookupInventory = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    if (driveRef.current.active) { setImportMessage('Return to the plan map before looking up inventory.'); return }
    const epoch = ++lookupEpoch.current
    const sceneAtStart = sceneRef.current
    const view = map.getBounds()
    const bounds = clampQueryBounds([view.getWest(), view.getSouth(), view.getEast(), view.getNorth()])
    setInventory((current) => ({ ...current, status: 'loading', error: null }))
    setShowInventory(true)
    const abort = new AbortController()
    const timer = window.setTimeout(() => abort.abort(), 30000)
    const results = await Promise.allSettled([
      queryVisualInventorySnapshot(bounds, abort.signal),
      fetchHarvestedAreas(bounds, { signal: abort.signal }),
      fetchCanopyStands(bounds, { signal: abort.signal }),
    ])
    window.clearTimeout(timer)
    if (epoch !== lookupEpoch.current) return
    if (sceneRef.current !== sceneAtStart) { setInventory((current) => ({ ...current, status: 'error', error: 'Scene changed during lookup. Previous data retained; look up again.' })); return }
    const [units, harvest, stands] = results
    const errors = results.flatMap((r, i) => r.status === 'rejected' ? [`${['Visual inventory', 'Existing harvest', 'Forest cover'][i]} unavailable: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : [])
    setScene((current) => {
      if (current !== sceneAtStart) return current
      if (harvest.status !== 'fulfilled') return { ...current, harvestInventory: { status: 'unavailable', bounds, source: HARVEST_SOURCE, retrievedAt: new Date().toISOString() } }
      const kept = current.targets.filter((t) => !(t.role === 'harvested' && t.source === HARVEST_SOURCE))
      return { ...current,
        harvestInventory: { status: harvest.value.truncated ? 'partial' : 'complete', bounds, source: HARVEST_SOURCE, retrievedAt: new Date().toISOString() },
        targets: [...kept, ...harvest.value.areas.map((area) => ({ id: createId('harvested'), name: area.name, role: 'harvested' as const, objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID, vac: null, harvestYear: area.harvestYear, clearcutPercent: area.clearcutPercent, geometry: area.geometry, source: HARVEST_SOURCE }))],
      }
    })
    setInventory((current) => ({ ...current,
      status: errors.length ? 'error' : 'ready', error: errors.length ? errors.join(' · ') + '. Existing data are retained for failed sources.' : null,
      units: units.status === 'fulfilled' ? units.value.units : current.units,
      truncated: results.some((r) => r.status === 'fulfilled' && r.value.truncated),
      harvestCount: harvest.status === 'fulfilled' ? harvest.value.areas.length : current.harvestCount,
      stands: stands.status === 'fulfilled' ? stands.value.stands : current.stands,
    }))
  }, [])

  /** Adopts an inventory polygon as the landform, carrying its rating across. */
  const adoptCandidate = useCallback(
    (unit: BcSensitivityUnit) => {
      setInventory(current => ({ ...current, units: [...current.units.filter(u => u.id !== unit.id), unit] }))
      const existing = sceneRef.current.targets.find(t => t.role === 'landscape' && t.inventoryUnitId === unit.id)
      if (existing) {
        setScene(current => ({ ...current, activeLandformId: existing.id }))
        setSelectedTargetId(existing.id)
        return
      }
      const objectiveId = unit.objectiveId ?? unit.recommendedId ?? DEFAULT_VISUAL_QUALITY_CLASS_ID
      const label = unit.objectiveId ? 'established' : unit.recommendedId ? 'recommended' : 'unrated'
      const adoptedId = createId('landform')
      addTarget({
        id: adoptedId,
        name: `${unit.name} · ${visualQualityClass(objectiveId).code} (${label})`,
        role: 'landscape',
        objectiveId,
        vac: unit.vac,
        harvestYear: null,
        clearcutPercent: null,
        geometry: unit.geometry,
        source: 'BC visual landscape inventory',
        inventoryUnitId: unit.id,
      })
      setSelectedTargetId(adoptedId)
    },
    [addTarget],
  )
  const handleAdoptUnit = useCallback((id: string) => {
    const unit = inventory.units.find(entry => entry.id === id)
    if (unit) adoptCandidate(unit)
  }, [inventory.units, adoptCandidate])
  // A landform read from the terrain, shown dashed until the reviewer adopts it.
  const [storedTerrainCandidate, setTerrainCandidate] = useState<TerrainCandidate | null>(null)
  // Only while its block is still there as it was read: a candidate for a block
  // since moved, edited or deleted is not one to adopt.
  const terrainCandidate =
    storedTerrainCandidate &&
    scene.targets.find((target) => target.id === storedTerrainCandidate.blockId)?.geometry === storedTerrainCandidate.blockGeometry
      ? storedTerrainCandidate
      : null
  const terrainCandidateCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: terrainCandidate ? [{ type: 'Feature', properties: {}, geometry: terrainCandidate.geometry }] : [] }),
    [terrainCandidate],
  )
  // The landform a terrain suggestion replaced, kept until the next scene
  // change so the reviewer can put it back.
  const [replacedLandform, setReplacedLandform] = useState<{ previous: TargetPolygon; adoptedId: string } | null>(null)
  const adoptTerrainCandidate = useCallback((candidate: TerrainCandidate) => {
    // It replaces the landform the reviewer was assessing against — two
    // overlapping landforms of the same colour read as one muddle — and
    // inherits that one's objective and VAC.
    const current = findSceneLandform(sceneRef.current)
    const adopted: TargetPolygon = {
      id: createId('landform'),
      name: `Terrain landform around ${candidate.blockName}`,
      role: 'landscape',
      objectiveId: current?.objectiveId ?? DEFAULT_VISUAL_QUALITY_CLASS_ID,
      vac: current?.vac ?? null,
      harvestYear: null,
      clearcutPercent: null,
      geometry: candidate.geometry,
      source: 'Suggested from terrain; review against the view',
    }
    setScene((scene) => ({
      ...scene,
      targets: [...scene.targets.filter((target) => target.id !== current?.id), adopted],
      activeLandformId: adopted.id,
    }))
    setSelectedTargetId(adopted.id)
    setReplacedLandform(current ? { previous: current, adoptedId: adopted.id } : null)
    setTerrainCandidate(null)
  }, [])
  const undoTerrainLandform = useCallback(() => {
    if (!replacedLandform) return
    const { previous, adoptedId } = replacedLandform
    setScene((scene) => ({
      ...scene,
      targets: [...scene.targets.filter((target) => target.id !== adoptedId), previous],
      activeLandformId: previous.id,
    }))
    setSelectedTargetId(previous.id)
    setReplacedLandform(null)
  }, [replacedLandform])

  const showCandidate = useCallback((unit: BcSensitivityUnit) => {
    setInventory(current => ({ ...current, units: [...current.units.filter(u => u.id !== unit.id), unit] }))
    setShowInventory(true)
    fitBounds(polygonBounds(unit.geometry))
  }, [fitBounds])

  const runForScene = useCallback((nextScene: ForestryScene) => {
    try {
      const input = buildSceneInput(nextScene)
      const nextKey = sceneFingerprint(nextScene)
      if (!nextKey) throw new Error('The scenario contains invalid numeric inputs.')
      runSnapshotRef.current = { scene: structuredClone(nextScene), inventoryUnits: structuredClone(inventory.units), key: nextKey }
      setCameraEye(null)
      setDrive(current => ({ ...current, active: false, playing: false, positionMeters: 0 }))
      analysis.run(input)
    } catch (error) {
      setPendingPreview(null)
      setImportMessage(error instanceof Error ? error.message : String(error))
    }
  }, [analysis.run, inventory.units])
  const handleRun = useCallback(() => { setPendingPreview(null); runForScene(scene) }, [runForScene, scene])
  const cancelPreview = useCallback(() => { setPendingPreview(null); analysis.cancel() }, [analysis.cancel])
  const openPreview = useCallback((view?: SavedDriveView) => {
    const error = previewInputError(scene)
    if (error || !key) { setPreviewMessage(error ?? 'Check the scenario geometry.'); return }
    setPreviewMessage(null)
    if (result) {
      updateDrive({ active: true, playing: false, ...(view ?? {}) })
      if (view) setRestoreLook({ yaw: view.yaw, tilt: view.tilt })
    } else {
      setPendingPreview({ key, view })
      runForScene(scene)
    }
  }, [scene, key, result, updateDrive, runForScene])
  useEffect(() => {
    if (!pendingPreview) return
    if (pendingPreview.key !== key) { cancelPreview(); return }
    if (analysis.state.status === 'error') { setPendingPreview(null); return }
    if (!result) return
    updateDrive({ active: true, playing: false, ...(pendingPreview.view ?? {}) })
    if (pendingPreview.view) setRestoreLook({ yaw: pendingPreview.view.yaw, tilt: pendingPreview.view.tilt })
    setPendingPreview(null)
  }, [pendingPreview, key, result, analysis.state.status, updateDrive, cancelPreview])

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
    if (!map || scene.viewpoint.coordinates.length === 0 || driveRef.current.active) return

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
    if (!map || driveRef.current.active) return

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
      if (target) {
        setDrive((current) => ({ ...current, active: false, playing: false }))
        window.setTimeout(() => fitBounds(targetBounds(target), 14), 50)
      }
    },
    [fitBounds, scene.targets],
  )

  const handleExport = useCallback(() => {
    downloadFile('forestry-visual-quality-scene.json', serializeScene(scene), 'application/json')
  }, [scene])

  /**
   * Adds the roads the basemap is drawing inside the landform as site
   * disturbance — FS1252 line 2.3.2 (b), which the worksheet otherwise leaves
   * blank. A road is a line, so it is buffered to a right-of-way width; that
   * width is an assumption and is named in the polygon so it travels with it.
   */
  const handleAddRoadDisturbance = useCallback(() => {
    const map = mapRef.current
    const landform = findSceneLandform(scene)
    if (!map || !landform || driveRef.current.active) {
      setSnapMessage('Add a landform first — site disturbance is measured against it.')
      return
    }

    const roads = collectRoadsFromMap(map)
    if (roads.length === 0) {
      setSnapMessage('No roads drawn at this zoom. Zoom in until they show, then try again.')
      return
    }

    // Only the parts inside the landform matter: the figure divides by it.
    const bounds = polygonBounds(landform.geometry)
    const inside = roads.filter((road) =>
      road.coordinates.some(
        ([lng, lat]) => lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3],
      ),
    )
    if (inside.length === 0) {
      setSnapMessage('No roads on screen fall inside the landform.')
      return
    }

    const added = inside.flatMap((road) => {
      const polygon = bufferLine(road.coordinates, ROAD_DISTURBANCE_WIDTH_METERS / 2)
      if (!polygon) return []
      return [
        {
          id: createId('disturbance'),
          name: `${road.name || road.roadClass || 'Road'} — ${ROAD_DISTURBANCE_WIDTH_METERS} m right-of-way`,
          role: 'harvested' as const,
          objectiveId: landform.objectiveId,
          vac: null,
          harvestYear: null,
          clearcutPercent: 100,
          siteDisturbance: true,
          geometry: polygon,
          source: 'Basemap roads',
        },
      ]
    })
    if (added.length === 0) {
      setSnapMessage('Those roads were too short to buffer into polygons.')
      return
    }

    setScene((current) => ({ ...current, targets: [...current.targets, ...added] }))
    setSnapMessage(
      `Added ${added.length} road${added.length === 1 ? '' : 's'} as site disturbance at ${ROAD_DISTURBANCE_WIDTH_METERS} m wide. Run again to count them on line (b).`,
    )
  }, [scene])

  /** The run written up on FS1252, for somebody to check every figure in. */
  const handleExportReport = useCallback(() => {
    const saved = runSnapshotRef.current
    if (!result || !saved || saved.key !== sceneFingerprint(scene)) return
    const landform = findSceneLandform(saved.scene)
    const unit = landform?.inventoryUnitId ? saved.inventoryUnits.find((entry) => entry.id === landform.inventoryUnitId) : null
    downloadFile(`visual-quality-worksheet-${new Date().toISOString().slice(0, 10)}.md`, buildReport({
      result, targets: saved.scene.targets, thresholds: saved.scene.thresholds,
      viewpointName: saved.scene.viewpoint.name || 'Unnamed viewpoint', generatedAt: new Date(),
      inventorySource: unit ? 'BC visual landscape inventory (DataBC)' : null,
      inventoryUnit: unit ? { polygonNumber: unit.polygonNumber, vsc: unit.vsc, scenicArea: unit.scenicArea } : null,
    }), 'text/markdown')
  }, [result, scene])

  const importPreviewGeometry = useCallback(async (file: File, kind: 'road' | 'blocks' | 'preview') => {
    setImportMessage('Reading file…')
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Use a file smaller than 30 MB.')
      if (kind === 'preview') {
        const restored = parsePreview(JSON.parse(await file.text()))
        if (!restored) throw new Error('Choose a file made with Download preview.')
        cancelPreview(); setDrive(DEFAULT_DRIVE); setCameraEye(null)
        setScene(restored.scene); setSaved({ key: sceneFingerprint(restored.scene), views: restored.views })
        setSelectedTargetId(restored.scene.targets.find(t => t.role === 'block')?.id ?? null)
        setImportMessage(`Opened ${file.name}. Choose Preview drive or a saved comparison.`)
        window.setTimeout(() => fitBounds(sceneBounds(restored.scene)), 50)
        return
      }
      const imported = await readShapeFile(file)
      const road = imported.lines.reduce<(typeof imported.lines)[number] | null>((best, line) => !best || lineLengthMeters(line.coordinates) > lineLengthMeters(best.coordinates) ? line : best, null)
      if (kind === 'road' && !road) throw new Error('No road line was found. Use a LineString or a line shapefile.')
      if (kind === 'blocks' && !imported.polygons.length) throw new Error('No cutblock polygons were found.')
      const targets: TargetPolygon[] = imported.polygons.map(p => ({ id: createId('block'), name: p.name, role: 'block', objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID, vac: null, harvestYear: null, clearcutPercent: null, geometry: p.geometry, source: file.name }))
      const base = scene.targets.length && scene.targets.every(t => t.source === 'Sample scenario' || t.source.startsWith('Illustrative driving demo')) ? createEmptyScene() : scene
      const next = kind === 'road' ? { ...base, viewpoint: { id: createId('road'), name: road!.name, mode: 'corridor' as const, coordinates: road!.coordinates } } : { ...base, targets: [...base.targets.filter(t => t.role !== 'block'), ...targets] }
      cancelPreview(); setScene(next); setCameraEye(null)
      if (kind === 'blocks') setSelectedTargetId(targets[0].id)
      setImportMessage(kind === 'road' ? `Road imported from ${file.name}.${imported.lines.length > 1 ? ' Used the longest line; import a single route to choose another.' : ''}` : `${targets.length} cutblocks imported from ${file.name}.`)
      window.setTimeout(() => fitBounds(sceneBounds(next)), 50)
    } catch (error) { setImportMessage(`Could not import: ${error instanceof Error ? error.message : String(error)}`) }
  }, [scene, cancelPreview, fitBounds])

  const handleLoadSample = useCallback((roadside = false, preview = false) => {
    const sample = roadside ? createRoadsideDriveScene() : createSampleScene()
    analysis.reset()
    setTerrainCandidate(null)
    setReplacedLandform(null)
    setPendingPreview(null)
    setPreviewMessage(null)
    setScene(sample)
    setSelectedTargetId(sample.targets.find((target) => target.role === 'block')?.id ?? null)
    setDrive({ ...DEFAULT_DRIVE, speedKmh: roadside ? 40 : 60 })
    setCameraEye(null)
    setImportMessage(null)
    window.setTimeout(() => fitBounds(sceneBounds(sample)), 50)
    if (preview) { setPendingPreview({ key: sceneFingerprint(sample)! }); runForScene(sample) }
  }, [analysis, fitBounds, runForScene])

  const handleClearScene = useCallback(() => {
    analysis.reset()
    setTerrainCandidate(null)
    setReplacedLandform(null)
    setPendingPreview(null)
    setPreviewMessage(null)
    setCameraEye(null)
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
  const landformClues = useMemo<GeoJSON.FeatureCollection>(() => ({ type: 'FeatureCollection', features: (result?.landformDesign?.markers ?? []).map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { position: p.position } })) }), [result])
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
    if (drive.active && cameraEye) return cameraEye
    const station = result?.stations[driveStationIndex]
    return station ? { lng: station.lng, lat: station.lat } : null
  }, [cameraEye, drive.active, driveStationIndex, result])

  const previewPolygons = useMemo(() => scene.targets.map(target => target.geometry), [scene.targets])
  const previewTerrain = useDriveTerrain(drive.active, scene.viewpoint.coordinates, previewPolygons)
  // A street-level field photo to line the road view up with (handbook 3.2, 3.3.4).
  const fieldPhoto = useFieldPhoto({ scene, result, ground: previewTerrain.source, eyeHeightMeters: result?.settings.observerHeightMeters ?? 1.6 })
  // The comparison holds the view on the photo's pose, so it ends when the
  // drive plays on or is closed.
  if (fieldPhoto.match && (drive.playing || (!drive.active && !pendingPreview && analysis.state.status !== 'running'))) fieldPhoto.setMatch(null)
  const photoLook = drive.active ? fieldPhoto.look : null
  const [lookBearing, setLookBearing] = useState(0)
  const lineUpPhoto = (image: MapillaryImage | null = fieldPhoto.image) => {
    const onRoad = image && scene.viewpoint.coordinates.length > 1 ? nearestPointOnLine(scene.viewpoint.coordinates, image) : null
    if (!image || !onRoad) return
    fieldPhoto.setMatch(fieldPhoto.startMatch(image))
    openPreview({
      id: 'field-photo', name: 'Field photo', positionMeters: onRoad.distanceAlongMeters, lookAtTargetId: null, yaw: 0, tilt: 0,
      treeHeightMeters: drive.treeHeightMeters, roadClearWidthMeters: drive.roadClearWidthMeters, harvestPhase: 'before',
    })
  }
  const liveForest = useForestHistory(drive.active && drive.existingForest, scene.viewpoint.coordinates, previewPolygons)
  const visualYear = scene.assessmentYear ?? new Date().getFullYear()
  const regrowth = useMemo(() => {
    const supplied: ForestHistoryRecord[] = scene.targets.filter(t => t.role === 'harvested' && !t.siteDisturbance).map(t => ({ id: `scene-${t.id}`, kind: 'harvest', geometry: t.geometry, year: t.harvestYear, clearcutPercent: t.clearcutPercent, heightMeters: null, speciesCode: null }))
    return buildRegrowthStands([...supplied, ...(liveForest.data?.records ?? [])], { year: visualYear, growthMetersPerYear: drive.growthMetersPerYear, regenerationLagYears: drive.regenerationLagYears, matureHeightMeters: drive.treeHeightMeters, projectRecordedHeights: drive.projectRecordedHeights })
  }, [scene.targets, liveForest.data, visualYear, drive.growthMetersPerYear, drive.regenerationLagYears, drive.treeHeightMeters, drive.projectRecordedHeights])

  const previewRoad = useMemo<GeoJSON.FeatureCollection>(() => {
    const shape = bufferLine(scene.viewpoint.coordinates, Math.min(8, drive.roadClearWidthMeters / 2))
    return { type: 'FeatureCollection', features: shape ? [{ type: 'Feature', properties: {}, geometry: shape }] : [] }
  }, [scene.viewpoint.coordinates, drive.roadClearWidthMeters])

  // Timber fills the view and the openings take it off. Not the landform: that
  // is an assessment unit drawn around a hill, not a stand boundary, and the
  // road an assessment is written from is usually outside it.
  const forestStands = useMemo<GeoJSON.Polygon[]>(() => [], [])
  // What the province recorded on this ground, reduced to what the drawing
  // needs. Coverage is managed openings only, so most of a view falls through
  // to the regional mix — which is why the panel reports how much did not.
  const forestInventory = useMemo<InventoryStand[]>(
    () =>
      [...regrowth.stands, ...(result?.renderStands ?? inventory.stands).map((stand) => ({
        geometry: stand.geometry,
        species: speciesFromCode(stand.speciesCode),
        heightMeters: stand.heightMeters > 0 ? stand.heightMeters : null,
        crownClosurePercent: stand.crownClosurePercent,
        stemsPerHa: 'stemsPerHa' in stand ? stand.stemsPerHa : null,
      }))],
    [regrowth.stands, inventory.stands, result?.renderStands],
  )

  // Retention and partial-cut blocks are thinned in the road view, not cleared.
  const forestThinnings = useMemo(
    () =>
      drive.harvestPhase === 'after'
        ? scene.targets.flatMap((target) => {
            const thinning = target.role === 'block' ? blockThinning(target) : null
            return thinning ? [thinning] : []
          })
        : [],
    [drive.harvestPhase, scene.targets],
  )

  // Ground actually cut: the block after harvest, and disturbance still counting.
  const forestOpenings = useMemo<Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(
    () =>
      scene.targets
        .filter((target) => (target.role === 'block' && drive.harvestPhase === 'after' && !blockThinning(target)) || (target.role === 'harvested' && target.siteDisturbance && alterationWeight(target, result?.inputSnapshot?.assessmentYear ?? scene.assessmentYear ?? new Date().getFullYear(), scene.settings.greenUpAgeYears) >= 1))
        .map((target) => target.geometry),
    [drive.harvestPhase, scene.targets, scene.assessmentYear, scene.settings.greenUpAgeYears, result],
  )

  const forestClearings = useMemo(() => {
    const openings = forestOpenings

    // The road is a clearing too. Without it the camera stands inside the timber
    // and the drive shows a trunk, which is not what a road looks like.
    const corridor =
      scene.viewpoint.mode === 'corridor'
        ? bufferLine(scene.viewpoint.coordinates, drive.roadClearWidthMeters / 2)
        : null
    return [...openings, ...basemap.water, ...(corridor ? [corridor] : [])]
  }, [forestOpenings, drive.roadClearWidthMeters, scene.viewpoint, basemap.water])

  // Harvested ground in the road view: bare soil under a clearcut; under
  // retention or a partial cut, disturbed but still vegetated forest floor.
  const harvestedGroundColor = useMemo(() => {
    const thinned = scene.targets.filter((target) => target.role === 'block' && blockThinning(target)).map((target) => target.id)
    return thinned.length ? ['match', ['get', 'id'], thinned, '#6f6a4b', '#b69a70'] : '#b69a70'
  }, [scene.targets])

  // From across a valley the ground between crowns is shaded forest floor, not
  // the pale basemap. However far out the cards thin, the stand's ground is
  // drawn dark where the stand is, bare soil in its clearings, water as water.
  const forestGround = useMemo(() => {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    const bounds = sceneBounds(scene)
    if (!drive.active || !drive.forest || !bounds) return { floor: empty, soil: empty, water: empty }
    const padLat = previewTerrain.radius / 111_320
    const padLng = padLat / Math.max(0.2, Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180))
    const [w, s, e, n] = [bounds[0] - padLng, bounds[1] - padLat, bounds[2] + padLng, bounds[3] + padLat]
    const feature = (geometry: GeoJSON.Geometry): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry })
    return {
      floor: { type: 'FeatureCollection', features: [feature({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] })] } as GeoJSON.FeatureCollection,
      // Soil on cut ground only. The road clearing is a viewing aid, not a
      // cutblock: widened to see past the roadside timber it stays forest floor.
      soil: { type: 'FeatureCollection', features: forestOpenings.map(feature) } as GeoJSON.FeatureCollection,
      water: { type: 'FeatureCollection', features: basemap.water.map(feature) } as GeoJSON.FeatureCollection,
    }
  }, [drive.active, drive.forest, scene, previewTerrain.radius, forestOpenings, basemap.water])

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
    if (counted === 0) return null
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
      // A target re-roled to a landform becomes the active one; the active landform re-roled to anything else is dropped.
      activeLandformId: patch.role === 'landscape' ? targetId : current.activeLandformId === targetId && patch.role ? null : current.activeLandformId,
    }))
  }, [])

  const handleRemoveTarget = useCallback((targetId: string) => {
    setScene((current) => ({
      ...current,
      targets: current.targets.filter((target) => target.id !== targetId),
      activeLandformId: current.activeLandformId === targetId ? null : current.activeLandformId,
    }))
    setSelectedTargetId((current) => (current === targetId ? null : current))
  }, [])

  const stops = useMemo(() => candidateDriveViews(result, drive.lookAtTargetId ?? selectedTargetId), [result, drive.lookAtTargetId, selectedTargetId])
  const currentExposure = (result?.targets.find(t => t.targetId === (drive.lookAtTargetId ?? selectedTargetId) && t.role === 'block') ?? result?.targets.find(t => t.role === 'block'))?.stations[driveStationIndex]
  const canSaveView = drive.active && !liveForest.loading && cameraStatus === 'ready' && !!forestStatus?.ready && !forestStatus.error
  const saveView = () => {
    if (!canSaveView) return
    if (savedViews.length >= 12) { setPreviewMessage('Twelve comparisons are saved. Remove one or download this preview before starting another.'); return }
    const view: SavedDriveView = { id: createId('view'), name: `View ${savedViews.length + 1}`, positionMeters: drive.positionMeters, lookAtTargetId: drive.lookAtTargetId, ...cameraLook.current, treeHeightMeters: drive.treeHeightMeters, roadClearWidthMeters: drive.roadClearWidthMeters, harvestPhase: drive.harvestPhase, existingForest: drive.existingForest, projectRecordedHeights: drive.projectRecordedHeights, growthMetersPerYear: drive.growthMetersPerYear, regenerationLagYears: drive.regenerationLagYears }
    updateDrive({ playing: false, positionMeters: view.positionMeters })
    setRestoreLook({ yaw: view.yaw, tilt: view.tilt })
    setSaved({ key, views: [...savedViews, view] })
    setPreviewMessage(`Saved ${view.name}. Download preview to keep or share this comparison.`)
  }
  const reopenPreviousPreview = () => {
    try {
      const previous = localStorage.getItem(PREVIEW_STORAGE_KEY)
      if (!previous) throw new Error('No saved preview is available in this browser.')
      void importPreviewGeometry(new File([previous], 'saved-preview.json', { type: 'application/json' }), 'preview')
    } catch { setPreviewMessage('The previous preview could not be read. Open a downloaded preview file instead.') }
  }
  const exportPreview = () => downloadFile('forestry-driving-preview.json', serializePreview(scene, savedViews), 'application/json')
  const saveImage = () => {
    const map = mapRef.current
    if (!map || !canSaveView) return
    updateDrive({ playing: false })
    const capture = () => {
      try {
        const canvas = document.createElement('canvas'), source = map.getCanvas()
        canvas.width = source.width; canvas.height = source.height + 90
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(source, 0, 0)
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, source.height, canvas.width, 90)
        ctx.fillStyle = '#111827'; ctx.font = '18px sans-serif'
        ctx.fillText(`${drive.harvestPhase === 'before' ? 'Before' : 'After'} harvest · ${(drive.positionMeters / 1000).toFixed(2)} km · ${scene.viewpoint.name}`, 16, source.height + 28, canvas.width - 32)
        ctx.font = '14px sans-serif'; ctx.fillText('Illustrative forest; recorded heights + age estimates. Not a calibrated impact assessment.', 16, source.height + 55, canvas.width - 32)
        ctx.fillText('Terrain: AWS Open Data / SRTM / CDEM. Basemap © CARTO, © OpenStreetMap contributors.', 16, source.height + 78, canvas.width - 32)
        const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `forestry-${drive.harvestPhase}-${Math.round(drive.positionMeters)}m.png`; a.click()
        setPreviewMessage('Image downloaded. Save this viewpoint to replay the comparison later.')
      } catch { setPreviewMessage('The browser could not capture this map. Download preview to preserve the viewpoint instead.') }
    }
    map.once('render', capture); map.triggerRepaint()
  }

  const previewProps = {
    scene, analysis: analysis.state, active: drive.active, preparing: !!pendingPreview,
    onPreview: () => openPreview(), onCancel: cancelPreview, onSample: () => handleLoadSample(true, true), onNew: handleClearScene,
    onImport: importPreviewGeometry, onDraw: handleDrawModeChange, drawMode, pointCount: draftCoordinates.length, onFinish: finishDraft,
    onReopenPrevious: saved.key !== key && saved.views.length ? reopenPreviousPreview : undefined,
    message: previewMessage ?? importMessage, views: savedViews, onRestore: openPreview, onExport: exportPreview, storageWarning,
    onRemoveView: (id: string) => setSaved({ key, views: savedViews.filter(v => v.id !== id) }),
  }
  const assessmentProps = {
    scene, onChange: setScene, result, stale: isStale,
    snapshot: result ? runSnapshotRef.current?.scene ?? null : null,
    currentStation: driveStationIndex,
  }
  const sidebar = (
    <Sidebar
      via={{
        assessment: viaAssessment,
        stale: isStale,
        statuses: viaStatuses,
        review: scene.viaReview ?? {},
        onReviewChange: updateViaReview,
        landformName: sceneLandform?.name ?? null,
      }}
      setup={<PreviewWorkflow part="setup" {...previewProps} />}
      landformFinder={
        !drive.active && (
          <div className="space-y-3">
            <TerrainLandformFinder
              scene={scene}
              result={result}
              water={basemap.water}
              candidate={terrainCandidate}
              onCandidate={(candidate) => {
                setTerrainCandidate(candidate)
                if (candidate) fitBounds(polygonBounds(candidate.geometry))
              }}
              onAdopt={adoptTerrainCandidate}
              replaced={
                replacedLandform && scene.targets.some((target) => target.id === replacedLandform.adoptedId)
                  ? replacedLandform.previous.name
                  : null
              }
              onUndo={undoTerrainLandform}
            />
            <LandformSuggestions scene={scene} onShow={showCandidate} onAdopt={adoptCandidate} />
          </div>
        )
      }
      visit={<PreviewWorkflow part="visit" {...previewProps} />}
      landformScope={<AssessmentPanel part="scope" {...assessmentProps} />}
      designReview={<LandformDesignPanel result={result} onView={(station, blockId) => updateDrive({ active: true, playing: false, lookAtTargetId: blockId, positionMeters: result?.stations[station].distanceAlongMeters ?? 0 })} />}
      fieldPhoto={<FieldPhotoPanel photo={fieldPhoto} canLineUp={!!fieldPhoto.image && !!fieldPhoto.onRoad && fieldPhoto.onRoad.offsetMeters <= 60 && !previewInputError(scene)} onLineUp={() => lineUpPhoto()} />}
      report={<AssessmentPanel part="report" {...assessmentProps} viaReview={viaAssessment ? fs1252ReviewFromVia(viaAssessment, scene.viaReview) : null} />}
      scene={scene}
      onViewpointChange={setViewpoint}
      onSettingsChange={(settings) => setScene((current) => ({ ...current, settings }))}
      onThresholdsChange={(thresholds) => setScene((current) => ({ ...current, thresholds }))}
      onTargetChange={handleTargetChange}
      onRemoveTarget={handleRemoveTarget}
      onZoomToTarget={handleZoomToTarget}
      drawMode={drawMode}
      onDrawModeChange={handleDrawModeChange}
      onSnapToRoad={handleSnapToRoad}
      snapMessage={snapMessage}
      analysis={{ ...analysis.state, result }}
      onRun={handleRun}
      onCancel={cancelPreview}
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
      onLoadSample={() => handleLoadSample()}
      // A road-view demo with no landform to assess: straight into the drive.
      onLoadDriveSample={() => handleLoadSample(true, true)}
      onImportRoad={(file) => void importPreviewGeometry(file, 'road')}
      onActivateLandform={(id) => setScene((current) => ({ ...current, activeLandformId: id }))}
      roadViewOpening={!!pendingPreview || drive.active}
      onClearScene={handleClearScene}
      onExport={handleExport}
      onExportReport={result ? handleExportReport : null}
      onAddRoadDisturbance={handleAddRoadDisturbance}
      roadClearing={{ roadClass: basemap.roadClass, widthMeters: autoClearing, waterPolygons: basemap.water.length }}
    />
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={400}
      mobileInitialSheetState="full"
      // On a phone the sheet covers the map, so entering the road view with it
      // up looks like nothing happened. Drop it to the peek for the drive and
      // hand the sidebar back on the way out.
      mobileSnapTo={drive.active || drawMode !== 'none' ? 'collapsed' : 'full'}
      mobileSnapKey={drive.active ? 'road-view' : drawMode !== 'none' ? 'drawing' : 'setup'}
      selectedFeatureMobilePeek={{
        title: 'Visual quality',
        subtitle: viaAssessment?.rating
          ? `${viaAssessment.rating.label} · ${viaAssessment.objective.code} objective`
          : result
            ? `${result.targets.filter((target) => target.role === 'block').length} block(s) simulated · not rated yet`
            : 'Choose a road and cutblock',
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
          exaggeration={1}
          hillshade
          hillshadeIntensity={drive.active ? 0.25 : 0.45}
        />
        <ForestOverlay
          active={drive.active && drive.forest && !liveForest.loading}
          anchorLatitude={scene.viewpoint.coordinates[0]?.[1]}
          centre={driveEye}
          stands={forestStands}
          clearings={forestClearings}
          thinnings={forestThinnings}
          gapTarget={drive.viewingGap && drive.lookAtTargetId ? scene.targets.find((target) => target.id === drive.lookAtTargetId)?.geometry ?? null : null}
          standHeightMeters={drive.treeHeightMeters}
          inventory={forestInventory}
          style={drive.quality === 'fast' ? 'billboard' : drive.quality === 'detailed' ? 'hybrid' : drive.treeStyle}
          elevation={previewTerrain.source}
          terrainMessage={previewTerrain.message}
          farRadiusMeters={previewTerrain.radius}
          onStatus={setForestStatus}
        />
        <MapFillLayer data={forestGround.floor} fillColor="#3a4f35" fillOpacity={0.82} lineWidth={0} visible={drive.active && drive.forest} />
        <MapFillLayer data={forestGround.soil} fillColor="#a7977d" fillOpacity={0.95} lineWidth={0} visible={drive.active && drive.forest} />
        <MapFillLayer data={forestGround.water} fillColor="#8fb0c4" fillOpacity={1} lineWidth={0} visible={drive.active && drive.forest} />
        <MapFillLayer data={previewRoad} fillColor="#a7977d" fillOpacity={1} lineColor="#c0b397" lineWidth={1} visible={drive.active} />
        {/* Hectares and kilometres are the page's units; on a phone the corner
            belongs to the zoom controls. Hides itself in the pitched road view. */}
        <MapScaleBar position="bottom-right" className="max-md:hidden" />
        <BasemapContextProbe
          enabled={!drive.active}
          corridor={scene.viewpoint.coordinates}
          bounds={basemapBounds}
          onChange={setBasemap}
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
          visible={showInventory && inventory.units.length > 0 && (!drive.active || drive.showAnalysis)}
          onFeatureClick={(id) => handleAdoptUnit(id)}
          hoverHtml={inventoryHoverHtml}
        />
        <MapFillLayer data={terrainCandidateCollection} visible={!drive.active} fillColor="#16a34a" fillOpacity={0.06} lineWidth={0} />
        <MapLineLayer data={terrainCandidateCollection} visible={!drive.active} color="#15803d" width={2} dashArray={[2, 1.5]} opacity={0.95} />
        <MapCircleLayer data={landformClues} visible={!drive.active} radius={3} color={['match', ['get', 'position'], 'ridge', '#ea580c', 'hollow', '#0284c7', '#9333ea']} />
        <MapFillLayer
          data={landscapeCollection}
          visible={!drive.active || drive.showAnalysis}
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
          visible={!drive.active || drive.harvestPhase === 'after' || drive.showAnalysis}
          fillColor={drive.active && !drive.showAnalysis ? harvestedGroundColor : ROLE_COLORS.block}
          fillOpacity={drive.active ? 0.85 : 0.3}
          lineColor={drive.active && !drive.showAnalysis ? '#b69a70' : ROLE_COLORS.block}
          lineWidth={1.8}
          lineOpacity={0.95}
          idProperty="id"
          selectedId={selectedTargetId}
          selectionColor={drive.active && !drive.showAnalysis ? '#b69a70' : '#111827'}
          onFeatureClick={(id) => setSelectedTargetId(id)}
          hoverHtml={targetHoverHtml}
        />

        {/* Sample points carry the answer: red is ground the road can see. */}
        <MapCircleLayer
          data={sampleCollection}
          visible={!drive.active || (drive.showAnalysis && drive.harvestPhase === 'after')}
          color={['case', ['==', ['get', 'visible'], 2], '#71717a', ['==', ['get', 'visible'], 1], VISIBLE_COLOR, SCREENED_COLOR]}
          radius={['interpolate', ['linear'], ['zoom'], 9, 1.5, 12, 2.6, 15, 5]}
          opacity={['case', ['==', ['get', 'visible'], 1], 0.95, 0.35]}
          strokeWidth={0}
        />

        {/* The reverse answer sits on the roads themselves: a hot stretch is
            road the block is in view from, a cold one road where it is hidden.
            Drawn as the road rather than as the points it was sampled at. */}
        <MapLineLayer
          data={reverseRoadCollection}
          color={['case', ['==', ['get', 'unknown'], 1], '#71717a', EXPOSURE_RAMP] as never}
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
          color={['case', ['==', ['get', 'unknown'], 1], '#71717a', EXPOSURE_RAMP] as never}
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

        {drive.active && photoLook && <PhotoOverlay photo={fieldPhoto} />}
        {drive.active && (
          <StreetPhotoInset
            photo={fieldPhoto}
            positionMeters={drive.positionMeters}
            lookBearing={lookBearing}
            onLineUp={(id) => {
              setDrive((current) => ({ ...current, playing: false }))
              void fieldPhoto.load(id, { onLoaded: (image) => lineUpPhoto(image) })
            }}
          />
        )}

        {drawMode !== 'none' && <div className="absolute top-3 left-3 right-14 z-10 rounded-lg border bg-background/95 p-3 shadow md:hidden" role="region" aria-label="Map drawing controls">
          <p className="text-xs">Tap the map to trace the {drawMode === 'corridor' ? 'road' : drawMode === 'spot' ? 'viewpoint' : 'polygon'}. {draftCoordinates.length} points added.</p>
          <div className="mt-2 flex gap-2">
            {drawMode !== 'spot' && <Button variant="outline" size="sm" className="touch:h-10" disabled={draftCoordinates.length < (drawMode === 'corridor' ? 2 : 3)} onClick={finishDraft}>Finish drawing</Button>}
            <Button variant="outline" size="sm" className="touch:h-10" onClick={() => handleDrawModeChange('none')}>Cancel drawing</Button>
          </div>
        </div>}

        {result && (
          <DriveCamera
            restoredLook={restoreLook}
            onLookChange={look => { cameraLook.current = look }}
            onStatusChange={setCameraStatus}
            onSlowFrames={drive.quality === 'auto' ? () => setLowFrameRate(true) : undefined}
            forestReady={!drive.forest || (!liveForest.loading && !!forestStatus?.ready)}
            routeLengthMeters={result.corridorLengthMeters}
            onSeek={distance => updateDrive({ positionMeters: distance, playing: false })}
            speedKmh={drive.speedKmh}
            onSpeedChange={speedKmh => updateDrive({ speedKmh })}
            comparison={
              <div className="space-y-2" aria-label="Harvest comparison">
                {liveForest.loading && <p role="status" className="text-xs">Loading existing forest along the route…</p>}
                {!!liveForest.data?.issues.length && <p className="text-xs">Existing forest data are incomplete. See Viewpoints, save & display to retry.</p>}
                <SegmentedControl
                  label="Harvest phase"
                  variant="solid"
                  size="sm"
                  value={drive.harvestPhase}
                  options={HARVEST_PHASE_OPTIONS}
                  onChange={phase => updateDrive({ harvestPhase: phase, playing: false, forest: true })}
                />
                <div className="flex flex-wrap gap-2 text-xs">
                  <Button variant="outline" size="sm" className="touch:h-10" onClick={() => updateDrive({ lookAtTargetId: drive.lookAtTargetId ? null : scene.targets.find(t => t.role === 'block' && t.id === selectedTargetId)?.id ?? scene.targets.find(t => t.role === 'block')?.id ?? null })}>
                    {drive.lookAtTargetId ? 'Look along road' : 'Face cutblock'}
                  </Button>
                  {drive.lookAtTargetId && drive.forest && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="touch:h-10"
                      aria-pressed={drive.viewingGap}
                      title="Leaves the drawn timber out of the line of sight to the block, as a pullout or a gap in the roadside trees would. A drawing aid only; no number moves."
                      onClick={() => updateDrive({ viewingGap: !drive.viewingGap })}
                    >
                      Viewing gap: {drive.viewingGap ? 'on' : 'off'}
                    </Button>
                  )}
                  {scene.viewpoint.id === ROADSIDE_DEMO_ID && <Button variant="outline" size="sm" className="touch:h-10" onClick={() => updateDrive({ positionMeters: 600, lookAtTargetId: scene.targets.find(t => t.role === 'block')?.id ?? null, playing: false })}>View opening</Button>}
                  {scene.viewpoint.id === ROADSIDE_DEMO_ID && <Button variant="outline" size="sm" className="touch:h-10" onClick={() => updateDrive({ positionMeters: 200, lookAtTargetId: null, playing: true })}>Replay approach</Button>}
                  <label className="flex items-center gap-1"><input type="checkbox" checked={drive.showAnalysis} onChange={e => updateDrive({ showAnalysis: e.target.checked })} />Analysis overlay</label>
                </div>
                <details className="text-xs"><summary className="cursor-pointer py-1">Viewpoints, save & display</summary>
                  <div className="mt-2 space-y-2">
                    <label className="block">Candidate viewpoints <select aria-label="Candidate viewpoint" className="mt-1 w-full rounded border bg-background p-1" value="" onChange={e => { const stop = stops[Number(e.target.value)]; if (stop) updateDrive({ positionMeters: stop.positionMeters, lookAtTargetId: stop.targetId, playing: false }) }}><option value="">{stops.length ? 'Choose a ground view…' : 'No visible ground candidates'}</option>{stops.map((stop, i) => <option key={stop.index} value={i}>{(stop.positionMeters / 1000).toFixed(2)} km · {Math.round(stop.visiblePercent)}% of block ground</option>)}</select></label>
                    <p className="text-[11px] text-muted-foreground">Candidates use terrain sightlines. Foreground trees can still hide the opening.</p>
                    <div className="flex gap-2"><Button variant="outline" size="sm" className="touch:h-10" disabled={!canSaveView} onClick={saveView}>Save viewpoint</Button><Button variant="outline" size="sm" className="touch:h-10" disabled={!canSaveView} onClick={saveImage}>Download image</Button></div>
                    {savedViews.length > 0 && <select aria-label="Saved viewpoint" className="w-full rounded border bg-background p-1" value="" onChange={e => { const view = savedViews.find(v => v.id === e.target.value); if (view) openPreview(view) }}><option value="">Reopen saved comparison…</option>{savedViews.map(v => <option key={v.id} value={v.id}>{v.name} · {(v.positionMeters / 1000).toFixed(2)} km</option>)}</select>}
                    <RegrowthControls drive={drive} update={updateDrive} year={visualYear} loading={liveForest.loading} data={liveForest.data} stands={regrowth.stands} unknown={regrowth.unknown} retry={liveForest.retry} />
                    <label className="flex items-center justify-between">Display quality <select aria-label="Display quality" className="rounded border bg-background p-1" value={drive.quality} onChange={e => updateDrive({ quality: e.target.value as DriveState['quality'] })}><option value="auto">Default</option><option value="detailed">Detailed</option><option value="fast">Faster</option></select></label>
                    {lowFrameRate && drive.quality === 'auto' && <p className="text-[11px]">Frame rate is low. Pause to inspect, or choose Faster before replaying.</p>}
                  </div>
                </details>
                {(previewTerrain.loading || previewTerrain.message || !forestStatus?.ready) && <div className="text-[11px]" role="status">{previewTerrain.loading ? `Loading terrain · ${previewTerrain.progress}%` : previewTerrain.message ?? forestStatus?.error ?? 'Drawing forest…'}{!previewTerrain.loading && previewTerrain.message && <button className="ml-2 underline" onClick={previewTerrain.retry}>Retry terrain</button>}</div>}
                {previewMessage && <p className="text-[11px]" role="status">{previewMessage}</p>}
              </div>
            }
            fixedLook={photoLook}
            verticalFovDegrees={photoLook ? fieldPhoto.viewFov : null}
            elevation={previewTerrain.source}
            active={drive.active}
            playing={drive.playing}
            stations={result.stations}
            roadCoordinates={result.inputSnapshot?.viewpoint.coordinates}
            seekMeters={drive.positionMeters}
            seekVersion={seekVersion}
            speedMetersPerSecond={(drive.speedKmh * 1000) / 3600}
            eyeHeightMeters={result.settings.observerHeightMeters}
            lookAt={lookAtTarget}
            spotBearing={spotBearing}
            onPosition={({ distanceMeters, stationIndex, lng, lat, bearing }) => {
              setDriveStationIndex(stationIndex)
              // Rounded, so a slow turn does not re-render the page every report.
              setLookBearing((current) => (Math.abs(((bearing - current + 540) % 360) - 180) < 5 ? current : Math.round(bearing)))
              setCameraEye((current) => current?.lng === lng && current?.lat === lat ? current : { lng, lat })
              setDrive((current) => Math.abs(current.positionMeters - distanceMeters) < 0.0001 ? current : { ...current, positionMeters: distanceMeters })
            }}
            onPause={() => setDrive((current) => ({ ...current, playing: false }))}
            onPlay={() => setDrive((current) => ({ ...current, playing: true }))}
            onExit={() => setDrive((current) => ({ ...current, active: false, playing: false }))}
            onReachEnd={() => setDrive((current) => ({ ...current, playing: false }))}
          />
        )}
      </Map>

      {result && !drive.active && (
        <MapOverlay
          position="bottom-left"
          className="bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] max-w-[15rem] md:bottom-3"
        >
          <p className="mb-1.5 text-xs font-semibold text-foreground">Seen from the road</p>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VISIBLE_COLOR }} />
              Visible ground
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full opacity-50" style={{ backgroundColor: SCREENED_COLOR }} />
              Occluded / outside analysis range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-500" />
              Unknown (missing data)
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
        <MapOverlay
          position="top-left"
          className="top-[calc(env(safe-area-inset-top)+3.75rem)] max-w-[16rem] md:top-3"
        >
          <p className="text-xs font-semibold text-foreground">Standing on the road · {drive.harvestPhase === 'before' ? 'Before harvest' : 'After harvest'}</p>
          {currentExposure && <p className="mt-1 text-[11px] leading-4">{(currentExposure.unknownPercent ?? 0) > 0 ? 'Some terrain is missing; visibility is uncertain.' : currentExposure.visiblePercent === 0 ? 'No cutblock ground is visible in the sampled sightlines within the analysis range.' : 'Ground sightlines reach the block. Foreground trees can still screen your view.'}</p>}
          <details className="mt-1 text-[11px]"><summary className="cursor-pointer">Data & assumptions</summary>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {drive.harvestPhase === 'before' ? 'Before harvest: proposed openings are filled with the same illustrative forest.' : 'After harvest: trees inside the proposed cutblock are removed, revealing the opening and its edges.'}
            {' '}Illustrative tree positions; heights/species {forestInventory.length ? 'use dated inventory and labelled regrowth estimates, with a regional fallback.' : 'use an assumed regional stand.'}
          </p>
          </details>
          {scene.viewpoint.id === ROADSIDE_DEMO_ID && <p className="mt-2 text-[11px] leading-4 font-medium">Roadside demo · hypothetical harvest on real terrain. {roadsideDriveCue(drive.positionMeters)}</p>}
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {drive.showAnalysis ? 'Red points show ground visibility at the nearest calculated station, not visibility through the illustrated trees.' : 'Terrain follows elevation data; road width and forest layout are assumptions.'}
          </p>
        </MapOverlay>
      )}
    </MapSectionLayout>
  )
}

export default DevForestryVisuals
