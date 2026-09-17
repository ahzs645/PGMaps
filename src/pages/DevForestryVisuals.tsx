import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Map, MapControls, type MapRef } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapOverlay } from '@/components/ui/map-panels'
import { PG_CENTER } from '@/components/ui/map-styles'
import { escapeHtml } from '@/lib/escapeHtml'

import { DriveCamera } from './dev-forestry/DriveCamera'
import { MapDrawCapture } from './dev-forestry/MapDrawCapture'
import { Sidebar, type DrawMode, type DriveState } from './dev-forestry/Sidebar'
import { TerrainSupport } from './dev-forestry/TerrainSupport'
import { readShapeFile } from './dev-forestry/shapeImport'
import {
  ROLE_COLORS,
  createEmptyScene,
  createId,
  createSampleScene,
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
import type { AnalysisInput, TargetPolygon, Viewpoint } from './dev-forestry/types'
import { useVisibilityAnalysis } from './dev-forestry/useVisibilityAnalysis'
import { DEFAULT_VISUAL_QUALITY_CLASS_ID } from './dev-forestry/vqo'
import { bearingDegrees, lineLengthMeters, polygonBounds } from './dev-forestry/visibility'

const VISIBLE_COLOR = '#ef4444'
const SCREENED_COLOR = '#0f766e'

const DEFAULT_DRIVE: DriveState = {
  active: false,
  playing: false,
  speedKmh: 60,
  positionMeters: 0,
  lookAtTargetId: null,
  exaggeration: 1,
}

const FIT_PADDING = { top: 72, bottom: 72, left: 48, right: 48 }

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
  const [driveStationIndex, setDriveStationIndex] = useState(0)
  const [seekVersion, setSeekVersion] = useState(0)
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
          name: drawMode === 'block' ? 'Traced block' : 'Traced landscape unit',
          role: drawMode,
          objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
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

  const handleRun = useCallback(() => {
    const input: AnalysisInput = {
      viewpoint: { mode: scene.viewpoint.mode, coordinates: scene.viewpoint.coordinates },
      targets: scene.targets.map((target) => ({
        id: target.id,
        name: target.name,
        role: target.role,
        geometry: target.geometry,
      })),
      settings: scene.settings,
    }
    setDrive((current) => ({ ...current, active: false, playing: false, positionMeters: 0 }))
    analysis.run(input)
  }, [analysis, scene])

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
      analysis={analysis.state}
      onRun={handleRun}
      onCancel={analysis.cancel}
      selectedTargetId={selectedTargetId}
      onSelectTarget={setSelectedTargetId}
      drive={drive}
      onDriveChange={updateDrive}
      onImportFile={(file) => void handleImportFile(file)}
      importMessage={importMessage}
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
        <MapDrawCapture
          active={drawMode !== 'none'}
          onPoint={handleMapPoint}
          onFinish={drawMode === 'spot' ? undefined : finishDraft}
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

        {/* From eye level the road is directly under the camera, where a line
            and its stations fill the frame instead of marking anything. */}
        <MapLineLayer data={corridorCollection} color="#1d4ed8" width={3} opacity={0.9} visible={!drive.active} />
        <MapCircleLayer
          data={stationCollection}
          color={['case', ['==', ['get', 'assessment'], 1], '#facc15', '#1d4ed8']}
          radius={['case', ['==', ['get', 'assessment'], 1], 5, 3]}
          strokeColor="#ffffff"
          strokeWidth={1.2}
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
