import type { RoadSelectionRange } from './roadSelection'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap, GeoJSONSource, ImageSource, MapMouseEvent } from 'maplibre-gl'
import { CircleHelp, LocateFixed, Mountain, Plus, Settings2, X } from 'lucide-react'
import { Map, MapControls, MapMarker, MapScaleBar, MarkerContent, useMap } from '@/components/ui/map'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { PlanLegend } from './PlanLegend'
import { RoadMapTools } from './RoadMapTools'
import { buildPlanLegend, PLAN_CONTEXT_STYLES, PLAN_DRAINAGE_STYLES } from './planLegend'
import {
  distance,
  horizontalCurveSummary,
  isBeyondReachFlag,
  nearestStation,
  offsetCoordinate,
  positionAt,
} from './engine'
import { labelChainages, labelOffset, metresPerPixel, stationLabelInterval, tickChainages } from './planAnnotations'
import { terrainBounds } from './terrain'
import { roadPlanFitCoordinates } from './planFit'
import { buildTerrainDisplay } from './terrainDisplay'
import { formatRoadStation } from './Charts'
import { cableCoordinateAtDistance, resolvedCableLine } from './cableGeometry'
import { sectionCodePoints } from './sectionGeometry'
import { safeAnalyzeRoad } from './analysisResult'
import type {
  Alignment,
  ContextFeature,
  Coordinate,
  RoadAnalysis,
  RoadProject,
  RoadStation,
  TerrainSource,
} from './types'

export type DrawMode = 'inspect' | 'edit' | 'road' | 'profile' | 'cable' | 'stream' | 'avoid'
type TerrainLayer = 'hillshade' | 'slope' | 'aspect' | 'elevation' | 'none'
type FitRequest = { revision: number; target: 'roads' | 'active' | 'terrain' }
const CONTEXT_LABELS: Record<ContextFeature['kind'], string> = {
  stream: 'Streams',
  'existing-road': 'Existing roads',
  harvest: 'Harvest areas',
  avoid: 'Review areas',
}
interface PlanProps {
  selectedRange?: RoadSelectionRange
  onMapReady?: (map: MapLibreMap | null) => void
  project: RoadProject
  alignment: Alignment
  analyses: Map<string, RoadAnalysis>
  source: TerrainSource
  station: number
  onStation: (station: number) => void
  onSelectAlignment: (id: string) => void
  mode: DrawMode
  onMode?: (mode: DrawMode) => void
  draft: Coordinate[]
  onDraw: (coordinate: Coordinate) => void
  onMovePoint: (id: string, coordinate: Coordinate) => void
  onInsertPoint?: (afterId: string, coordinate: Coordinate) => void
  onHover: (coordinate: Coordinate | null) => void
  onSelectPoint: (id: string) => void
  selectedPoint: string | null
  fitRevision: number
  terrainOnly?: boolean
  activeCableId?: string
  onSelectCable?: (id: string) => void
  cableDistance?: number
  onCableDistance?: (distance: number) => void
  overlay?: GeoJSON.FeatureCollection
  /** Drainage results: features carry `role` ('stream-existing' | 'stream-design' | 'diversion' | 'pond' | 'low-point'). */
  drainage?: GeoJSON.FeatureCollection
  onOverlaySelect?: (properties: GeoJSON.GeoJsonProperties) => void
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
}
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const line = (
  coordinates: Coordinate[],
  properties: GeoJSON.GeoJsonProperties = {},
): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties,
})

/** Project a map click onto the same great-circle span used by the cable profile. */
function cableDistanceAt(start: Coordinate, end: Coordinate, coordinate: Coordinate) {
  const rad = Math.PI / 180
  const heading = (a: Coordinate, b: Coordinate) =>
    Math.atan2(
      Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad),
      Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
        Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad),
    )
  const angularDistance = distance(start, coordinate) / 6371008.8
  const along =
    Math.atan2(
      Math.sin(angularDistance) * Math.cos(heading(start, coordinate) - heading(start, end)),
      Math.cos(angularDistance),
    ) * 6371008.8
  return Math.max(0, Math.min(distance(start, end), along))
}

function placeOn(alignment: Alignment, chainage: number) {
  try {
    return positionAt(alignment, chainage)
  } catch {
    return null
  }
}

function Layers(
  props: PlanProps & {
    terrainLayer: TerrainLayer
    showContours: boolean
    showLabels: boolean
    showEarthwork: boolean
    hiddenContextKinds: ContextFeature['kind'][]
    onPointDragStart: (id: string) => void
    onPointDragEnd: (id: string, coordinate: Coordinate) => void
    fitRequest: FitRequest
  },
) {
  const { map, isLoaded } = useMap()
  const onMapReady = props.onMapReady
  useEffect(() => {
    if (!map || !isLoaded) return
    onMapReady?.(map)
    return () => onMapReady?.(null)
  }, [map, isLoaded, onMapReady])
  const {
    mode,
    onDraw,
    onStation,
    onSelectAlignment,
    onHover,
    onSelectCable,
    onCableDistance,
    onOverlaySelect,
    onSelectCulvert,
  } = props
  const projectCables = props.project.cables
  const resolvedCables = useMemo(
    () =>
      projectCables.flatMap((cable) => {
        try {
          return [resolvedCableLine(cable)]
        } catch {
          return []
        }
      }),
    [projectCables],
  )
  const activeAlignmentId = props.alignment.id
  const previousFit = useRef('')
  const previousManualFit = useRef(0)
  const analysis = props.analyses.get(props.alignment.id)!
  useEffect(() => {
    if (!map || !isLoaded) return
    const range = props.selectedRange
    const samples = range
      ? analysis.stations.filter((s) => s.chainage > range.start && s.chainage < range.end).map((s) => s.coordinate)
      : []
    const start = range ? placeOn(props.alignment, range.start)?.coordinate : null
    const end = range ? placeOn(props.alignment, range.end)?.coordinate : null
    const coordinates = start && end ? [start, ...samples, end] : []
    const data = fc(
      coordinates.length
        ? [
            line(coordinates, { label: range?.label }),
            ...(range?.start === range?.end && start
              ? [
                  {
                    type: 'Feature' as const,
                    properties: { label: range?.label },
                    geometry: { type: 'Point' as const, coordinates: start },
                  },
                ]
              : []),
          ]
        : [],
    )
    const source = map.getSource('road-selection') as GeoJSONSource | undefined
    if (source) source.setData(data)
    else map.addSource('road-selection', { type: 'geojson', data })
    if (!map.getLayer('road-selection-highlight'))
      map.addLayer({
        id: 'road-selection-highlight',
        type: 'line',
        source: 'road-selection',
        paint: { 'line-color': '#e11d48', 'line-width': 12, 'line-opacity': 0.65 },
      })
    if (!map.getLayer('road-selection-point'))
      map.addLayer({
        id: 'road-selection-point',
        type: 'circle',
        source: 'road-selection',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#e11d48',
          'circle-radius': 10,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
    map.moveLayer('road-selection-highlight')
    map.moveLayer('road-selection-point')
    if (range && start && end)
      map.fitBounds(
        [
          [
            Math.min(start[0], end[0], ...samples.map((p) => p[0])),
            Math.min(start[1], end[1], ...samples.map((p) => p[1])),
          ],
          [
            Math.max(start[0], end[0], ...samples.map((p) => p[0])),
            Math.max(start[1], end[1], ...samples.map((p) => p[1])),
          ],
        ],
        { padding: 70, maxZoom: 17, duration: 350 },
      )
  }, [map, isLoaded, analysis, props.alignment, props.selectedRange])

  const bounds = useMemo(() => terrainBounds(props.project.terrain), [props.project.terrain])
  const display = useMemo(
    () => (bounds ? buildTerrainDisplay(props.source, bounds, 192) : null),
    [bounds, props.source],
  )
  const chosen = nearestStation(analysis.stations, props.station)
  const activeCable = resolvedCables.find((c) => c.id === props.activeCableId)
  const originalCable = projectCables.find((c) => c.id === props.activeCableId)
  const cableCursor = useMemo(() => {
    if (!activeCable || props.cableDistance === undefined) return null
    try {
      return cableCoordinateAtDistance(activeCable, props.cableDistance)
    } catch {
      return null
    }
  }, [activeCable, props.cableDistance])
  // Labels and ticks follow the zoom: an overview shows a few stations, zooming in adds more.
  const [view, setView] = useState<{ zoom: number; bearing: number } | null>(null)
  useEffect(() => {
    if (!map || !isLoaded) return
    const update = () => setView({ zoom: Math.round(map.getZoom() * 8) / 8, bearing: map.getBearing() })
    update()
    map.on('zoomend', update)
    map.on('rotateend', update)
    return () => {
      map.off('zoomend', update)
      map.off('rotateend', update)
    }
  }, [map, isLoaded])
  const pixelMetres =
    view && analysis.stations.length ? metresPerPixel(view.zoom, analysis.stations[0].coordinate[1]) : null
  const labelInterval = pixelMetres === null ? null : stationLabelInterval(pixelMetres)
  const annotationStations = useMemo(() => {
    if (!analysis.stations.length || labelInterval === null) return []
    return labelChainages(analysis.length, labelInterval).flatMap((chainage) => {
      const at = placeOn(props.alignment, chainage)
      return at ? [{ chainage, ...at }] : []
    })
  }, [analysis, labelInterval, props.alignment])
  const ticks = useMemo(() => {
    if (!props.showLabels || !analysis.stations.length || labelInterval === null || pixelMetres === null) return fc([])
    return fc(
      tickChainages(analysis.length, labelInterval, pixelMetres).flatMap(({ chainage, major }) => {
        const at = placeOn(props.alignment, chainage)
        if (!at) return []
        const half = (major ? 7 : 3.5) * pixelMetres
        return [
          line(
            [
              offsetCoordinate(at.coordinate, at.bearing - 90, half),
              offsetCoordinate(at.coordinate, at.bearing + 90, half),
            ],
            { major },
          ),
        ]
      }),
    )
  }, [analysis, labelInterval, pixelMetres, props.alignment, props.showLabels])
  const radiusLabels = useMemo(() => {
    if (props.terrainOnly || pixelMetres === null) return []
    try {
      return horizontalCurveSummary(props.alignment).flatMap((curve, index) => {
        // A curve label appears once its arc is long enough on screen to belong to it.
        if (curve.length / pixelMetres < 28) return []
        const at = placeOn(props.alignment, (curve.start + curve.end) / 2)
        return at ? [{ id: `curve-${index}`, label: `C${index + 1} R=${curve.radius.toFixed(1)}`, at, curve }] : []
      })
    } catch {
      return []
    }
  }, [props.alignment, props.terrainOnly, pixelMetres])
  const allLines = useMemo(
    () =>
      fc(
        props.project.alignments.flatMap((a) => {
          const result = props.analyses.get(a.id)
          if (!result) return []
          if (a.id !== props.alignment.id)
            return [line(result.centerline, { id: a.id, color: a.color, selected: false })]
          return result.stations.slice(1).map((p, i) =>
            line([result.stations[i].coordinate, p.coordinate], {
              id: a.id,
              selected: true,
              chainage: p.chainage,
              color:
                props.terrainOnly && a.id === props.alignment.id
                  ? '#0284c7'
                  : p.groundElevation === null
                    ? '#9ca3af'
                    : p.gradePercent !== null && Math.abs(p.gradePercent) > props.project.settings.maxGradePercent
                      ? '#dc2626'
                      : '#d97706',
            }),
          )
        }),
      ),
    [
      props.project.alignments,
      props.project.settings.maxGradePercent,
      props.analyses,
      props.alignment.id,
      props.terrainOnly,
    ],
  )
  const corridor = useMemo(() => {
    const reach = props.project.settings.crossSectionHalfWidth
    // A side whose batter ran past the section reach is drawn out to the reach, in red, rather
    // than dropped: the road is still there, the section just cannot close it.
    const extent = (s: RoadStation, side: 'Left' | 'Right') => {
      const daylight = side === 'Left' ? s.leftDaylightM : s.rightDaylightM
      if (daylight !== null) return { offset: Math.abs(daylight), beyond: false }
      if (s.groundElevation === null || !s.flags.some((f) => f.startsWith(side) && isBeyondReachFlag(f))) return null
      return { offset: reach, beyond: true }
    }
    return fc(
      (props.terrainOnly ? [] : analysis.stations.slice(1)).flatMap((b, i) => {
        const a = analysis.stations[i]
        const al = extent(a, 'Left'),
          bl = extent(b, 'Left'),
          br = extent(b, 'Right'),
          ar = extent(a, 'Right')
        if (!al || !bl || !br || !ar) return []
        const beyond = al.beyond || bl.beyond || br.beyond || ar.beyond
        if (!beyond && (!a.complete || !b.complete)) return []
        const points = [
          offsetCoordinate(a.coordinate, a.bearing - 90, al.offset),
          offsetCoordinate(b.coordinate, b.bearing - 90, bl.offset),
          offsetCoordinate(b.coordinate, b.bearing + 90, br.offset),
          offsetCoordinate(a.coordinate, a.bearing + 90, ar.offset),
        ]
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Polygon' as const, coordinates: [[...points, points[0]]] },
            properties: {
              chainage: (a.chainage + b.chainage) / 2,
              beyond,
              color: beyond
                ? '#dc2626'
                : (a.cutAreaM2 ?? 0) + (b.cutAreaM2 ?? 0) >= (a.fillAreaM2 ?? 0) + (b.fillAreaM2 ?? 0)
                  ? '#d97706'
                  : '#3b82f6',
            },
          },
        ]
      }),
    )
  }, [analysis, props.terrainOnly, props.project.settings.crossSectionHalfWidth])
  const formation = useMemo(
    () =>
      fc(
        (props.terrainOnly ? [] : analysis.stations.slice(1)).flatMap((b, i) => {
          const a = analysis.stations[i]
          if (
            a.groundElevation === null ||
            b.groundElevation === null ||
            a.designElevation === null ||
            b.designElevation === null
          )
            return []
          const coordinates = [
            offsetCoordinate(a.coordinate, a.bearing - 90, a.leftWidth),
            offsetCoordinate(b.coordinate, b.bearing - 90, b.leftWidth),
            offsetCoordinate(b.coordinate, b.bearing + 90, b.rightWidth),
            offsetCoordinate(a.coordinate, a.bearing + 90, a.rightWidth),
          ]
          return [
            {
              type: 'Feature' as const,
              geometry: { type: 'Polygon' as const, coordinates: [[...coordinates, coordinates[0]]] },
              properties: { chainage: (a.chainage + b.chainage) / 2 },
            },
          ]
        }),
      ),
    [analysis, props.terrainOnly],
  )
  const roadEdges = useMemo(
    () =>
      fc(
        (props.terrainOnly ? [] : analysis.stations.slice(1)).flatMap((b, i) => {
          const a = analysis.stations[i]
          if (
            a.groundElevation === null ||
            b.groundElevation === null ||
            a.designElevation === null ||
            b.designElevation === null
          )
            return []
          return [-1, 1].map((side) =>
            line(
              [
                offsetCoordinate(a.coordinate, a.bearing + side * 90, side < 0 ? a.leftWidth : a.rightWidth),
                offsetCoordinate(b.coordinate, b.bearing + side * 90, side < 0 ? b.leftWidth : b.rightWidth),
              ],
              { chainage: (a.chainage + b.chainage) / 2 },
            ),
          )
        }),
      ),
    [analysis, props.terrainOnly],
  )
  const context = useMemo(
    () =>
      fc(
        props.project.context
          .filter((feature) => !props.hiddenContextKinds.includes(feature.kind))
          .map((feature) => ({
            type: 'Feature',
            geometry: feature.geometry,
            properties: { ...feature, geometry: undefined },
          })),
      ),
    [props.project.context, props.hiddenContextKinds],
  )
  const ditches = useMemo(() => {
    if (props.terrainOnly) return fc([])
    const templates = new globalThis.Map(analysis.engineering?.stations.map((s) => [s.chainage, s.template]))
    const points = analysis.stations.map((s) =>
      sectionCodePoints(s, templates.get(s.chainage) ?? props.alignment.template),
    )
    return fc(
      analysis.stations.slice(1).flatMap((b, index) => {
        const a = analysis.stations[index]
        return (['left', 'right'] as const).flatMap((side) => {
          const pa = points[index].find((p) => p.code === `${side}-ditch-bottom`),
            pb = points[index + 1].find((p) => p.code === `${side}-ditch-bottom`)
          if (!pa || !pb || pa.ground === null || pb.ground === null || pa.design === null || pb.design === null)
            return []
          return [
            line(
              [
                offsetCoordinate(a.coordinate, a.bearing + (side === 'left' ? -90 : 90), Math.abs(pa.offset)),
                offsetCoordinate(b.coordinate, b.bearing + (side === 'left' ? -90 : 90), Math.abs(pb.offset)),
              ],
              { chainage: (a.chainage + b.chainage) / 2, kind: `${side}-ditch-bottom` },
            ),
          ]
        })
      }),
    )
  }, [analysis, props.alignment.template, props.terrainOnly])
  const cable = useMemo(
    () =>
      fc(
        resolvedCables.map((c) =>
          line([c.start, c.end], { id: c.id, name: c.name, selected: c.id === props.activeCableId }),
        ),
      ),
    [resolvedCables, props.activeCableId],
  )
  const draft = useMemo(() => fc(props.draft.length > 1 ? [line(props.draft)] : []), [props.draft])
  const structures = useMemo(
    () =>
      fc(
        (props.terrainOnly ? [] : (analysis.engineering?.culverts ?? [])).map((culvert) =>
          line([culvert.start, culvert.end], {
            id: culvert.id,
            chainage: culvert.chainage,
            name: culvert.name,
            color: culvert.id === props.selectedCulvertId ? '#e11d48' : culvert.warnings.length ? '#d97706' : '#0284c7',
            selected: culvert.id === props.selectedCulvertId,
          }),
        ),
      ),
    [analysis, props.terrainOnly, props.selectedCulvertId],
  )
  const section = useMemo(
    () =>
      fc(
        chosen
          ? [
              line([
                offsetCoordinate(chosen.coordinate, chosen.bearing - 90, props.project.settings.crossSectionHalfWidth),
                offsetCoordinate(chosen.coordinate, chosen.bearing + 90, props.project.settings.crossSectionHalfWidth),
              ]),
            ]
          : [],
      ),
    [chosen, props.project.settings.crossSectionHalfWidth],
  )

  useEffect(() => {
    if (!map || !isLoaded) return
    const key = `${props.project.terrain.sha256 ?? props.project.terrain.name}:${props.fitRevision}:${props.fitRequest.revision}`
    if (key === previousFit.current) return
    const activeCoordinates = props.alignment.points.map((p) => p.coordinate)
    const extent = (coordinates: Coordinate[]) =>
      [
        [Math.min(...coordinates.map((p) => p[0])), Math.min(...coordinates.map((p) => p[1]))],
        [Math.max(...coordinates.map((p) => p[0])), Math.max(...coordinates.map((p) => p[1]))],
      ] as [Coordinate, Coordinate]
    const activeBounds = activeCoordinates.length ? extent(activeCoordinates) : null
    const intersects =
      bounds &&
      activeBounds &&
      activeBounds[0][0] <= bounds[2] &&
      activeBounds[1][0] >= bounds[0] &&
      activeBounds[0][1] <= bounds[3] &&
      activeBounds[1][1] >= bounds[1]
    const manual = previousManualFit.current !== props.fitRequest.revision
    // A new DEM may be hundreds of kilometres from the existing roads. Reveal its
    // coverage rather than silently refitting those unrelated controls.
    const target = manual
      ? props.fitRequest.target
      : bounds && !intersects
        ? 'terrain'
        : props.project.totalCostPlanning
          ? 'roads'
          : 'active'
    const coordinates = target === 'terrain' ? [] : roadPlanFitCoordinates(props.project, target, props.alignment)
    const fitBounds =
      target === 'terrain' && bounds
        ? ([
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ] as [Coordinate, Coordinate])
        : coordinates.length
          ? extent(coordinates)
          : null
    if (fitBounds) map.fitBounds(fitBounds, { padding: 45, maxZoom: 16, duration: 0 })
    previousFit.current = key
    previousManualFit.current = props.fitRequest.revision
  }, [map, isLoaded, bounds, props.alignment, props.project, props.fitRevision, props.fitRequest])

  useEffect(() => {
    if (!map || !isLoaded) return
    const inputs: Record<string, GeoJSON.FeatureCollection> = {
      roads: allLines,
      corridor,
      formation,
      edges: roadEdges,
      ditches,
      context,
      cable,
      structures,
      draft,
      section,
      ticks,
      contours: display?.contours ?? fc([]),
      overlay: props.overlay ?? fc([]),
      drainage: props.drainage ?? fc([]),
    }
    for (const [name, data] of Object.entries(inputs)) {
      const id = `road-${name}`
      const existing = map.getSource(id) as GeoJSONSource | undefined
      if (existing) existing.setData(data)
      else map.addSource(id, { type: 'geojson', data })
    }
    if (display && props.terrainLayer !== 'none') {
      const url = display[props.terrainLayer]
      const existing = map.getSource('road-terrain') as ImageSource | undefined
      const coordinates = display.coordinates as [Coordinate, Coordinate, Coordinate, Coordinate]
      if (existing) existing.updateImage({ url, coordinates })
      else map.addSource('road-terrain', { type: 'image', url, coordinates })
      if (!map.getLayer('road-terrain'))
        map.addLayer({
          id: 'road-terrain',
          type: 'raster',
          source: 'road-terrain',
          paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 },
        })
    }
    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer)
    }
    add({
      id: 'road-contours',
      type: 'line',
      source: 'road-contours',
      paint: { 'line-color': '#57534e', 'line-width': 0.65, 'line-opacity': 0.45 },
    })
    add({
      id: 'road-context-fill',
      type: 'fill',
      source: 'road-context',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': [
          'match',
          ['get', 'kind'],
          'harvest',
          PLAN_CONTEXT_STYLES.harvest.color,
          PLAN_CONTEXT_STYLES.avoid.color,
        ],
        'fill-opacity': 0.18,
      },
    })
    add({
      id: 'road-context-line',
      type: 'line',
      source: 'road-context',
      paint: {
        'line-color': [
          'match',
          ['get', 'kind'],
          'stream',
          PLAN_CONTEXT_STYLES.stream.color,
          'existing-road',
          PLAN_CONTEXT_STYLES['existing-road'].color,
          'harvest',
          PLAN_CONTEXT_STYLES.harvest.color,
          PLAN_CONTEXT_STYLES.avoid.color,
        ],
        'line-width': 2,
        'line-dasharray': [3, 2],
      },
    })
    add({
      id: 'road-corridor',
      type: 'fill',
      source: 'road-corridor',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 },
    })
    add({
      id: 'road-corridor-reach',
      type: 'line',
      source: 'road-corridor',
      filter: ['==', ['get', 'beyond'], true],
      paint: { 'line-color': '#dc2626', 'line-width': 1.2, 'line-dasharray': [2, 2] },
    })
    add({
      id: 'road-formation',
      type: 'fill',
      source: 'road-formation',
      paint: { 'fill-color': '#fef3c7', 'fill-opacity': 0.55 },
    })
    add({
      id: 'road-edges',
      type: 'line',
      source: 'road-edges',
      paint: { 'line-color': '#78716c', 'line-width': 1.2, 'line-dasharray': [3, 2] },
    })
    add({
      id: 'road-alignments-halo',
      type: 'line',
      source: 'road-roads',
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.7 },
    })
    add({
      id: 'road-ditches',
      type: 'line',
      source: 'road-ditches',
      paint: { 'line-color': '#0369a1', 'line-width': 1.6, 'line-dasharray': [3, 2] },
    })
    add({
      id: 'road-alignments',
      type: 'line',
      source: 'road-roads',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 4, 2.5] },
    })
    add({
      id: 'road-ticks',
      type: 'line',
      source: 'road-ticks',
      paint: {
        'line-color': '#1c1917',
        'line-width': ['case', ['get', 'major'], 1.6, 1],
        'line-opacity': 0.8,
      },
    })
    add({
      id: 'road-cable',
      type: 'line',
      source: 'road-cable',
      paint: { 'line-color': '#7c3aed', 'line-width': ['case', ['get', 'selected'], 4, 2], 'line-dasharray': [2, 2] },
    })
    add({
      id: 'road-section',
      type: 'line',
      source: 'road-section',
      paint: { 'line-color': '#e11d48', 'line-width': 2 },
    })
    add({
      id: 'road-structures',
      type: 'line',
      source: 'road-structures',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], true], 6, 4] },
    })
    add({
      id: 'road-draft',
      type: 'line',
      source: 'road-draft',
      paint: { 'line-color': '#0d9488', 'line-width': 3, 'line-dasharray': [2, 1] },
    })
    // Existing-ground streams dashed and pale, design-surface streams solid and widening with
    // contributing area, so a stream the road turns shows as the two lines parting.
    add({
      id: 'road-drainage-existing',
      type: 'line',
      source: 'road-drainage',
      filter: ['==', ['get', 'role'], 'stream-existing'],
      paint: {
        'line-color': PLAN_DRAINAGE_STYLES['stream-existing'].color,
        'line-width': 1.5,
        'line-dasharray': [2, 1.5],
      },
    })
    add({
      id: 'road-drainage-line',
      type: 'line',
      source: 'road-drainage',
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'role'], 'stream-existing']],
      paint: {
        'line-color': [
          'match',
          ['get', 'role'],
          'diversion',
          PLAN_DRAINAGE_STYLES.diversion.color,
          PLAN_DRAINAGE_STYLES['stream-design'].color,
        ],
        'line-width': [
          'case',
          ['==', ['get', 'role'], 'diversion'],
          3,
          ['interpolate', ['linear'], ['coalesce', ['get', 'areaHa'], 0], 0, 1.2, 5, 2.5, 50, 4.5],
        ],
      },
    })
    add({
      id: 'road-drainage-point',
      type: 'circle',
      source: 'road-drainage',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': [
          'match',
          ['get', 'role'],
          'pond',
          PLAN_DRAINAGE_STYLES.pond.color,
          'low-point',
          PLAN_DRAINAGE_STYLES['low-point'].color,
          '#dc2626',
        ],
        'circle-radius': ['match', ['get', 'role'], 'pond', 3, 6],
        'circle-stroke-width': ['match', ['get', 'role'], 'pond', 0, 2],
        'circle-stroke-color': '#ffffff',
      },
    })
    add({
      id: 'road-exploration-line',
      type: 'line',
      source: 'road-overlay',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#7c3aed'],
        'line-width': ['case', ['==', ['get', 'selected'], true], 5, 3],
        'line-offset': ['match', ['get', 'pathRole'], 'loaded', 3, 'return', -3, 0],
        'line-dasharray': [3, 1],
      },
    })
    add({
      id: 'road-exploration-point',
      type: 'circle',
      source: 'road-overlay',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#7c3aed'],
        'circle-radius': 5,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
    if (map.getLayer('road-terrain'))
      map.setLayoutProperty('road-terrain', 'visibility', props.terrainLayer === 'none' ? 'none' : 'visible')
    map.setLayoutProperty('road-contours', 'visibility', props.showContours ? 'visible' : 'none')
    for (const id of ['road-corridor', 'road-corridor-reach', 'road-formation', 'road-edges', 'road-ditches'])
      map.setLayoutProperty(id, 'visibility', props.showEarthwork && !props.terrainOnly ? 'visible' : 'none')
    // Keep all analytical overlays above a replaced terrain image/style.
    for (const id of [
      'road-contours',
      'road-context-fill',
      'road-context-line',
      'road-corridor',
      'road-corridor-reach',
      'road-formation',
      'road-edges',
      'road-ditches',
      'road-alignments-halo',
      'road-alignments',
      'road-ticks',
      'road-cable',
      'road-structures',
      'road-section',
      'road-draft',
      'road-drainage-existing',
      'road-drainage-line',
      'road-drainage-point',
      'road-exploration-line',
      'road-exploration-point',
    ])
      map.moveLayer(id)
    for (const id of ['road-selection-highlight', 'road-selection-point']) if (map.getLayer(id)) map.moveLayer(id)
  }, [
    map,
    isLoaded,
    allLines,
    corridor,
    formation,
    roadEdges,
    ditches,
    context,
    cable,
    structures,
    draft,
    section,
    ticks,
    display,
    props.terrainLayer,
    props.showContours,
    props.showEarthwork,
    props.terrainOnly,
    props.overlay,
    props.drainage,
  ])

  useEffect(() => {
    if (!map || !isLoaded) return
    const click = (e: MapMouseEvent) => {
      if (!['inspect', 'edit'].includes(mode)) {
        onDraw([e.lngLat.lng, e.lngLat.lat])
        return
      }
      if ((e.originalEvent.target as Element)?.closest('.maplibregl-marker')) return
      const preview = map.queryRenderedFeatures(e.point, {
        layers: ['road-exploration-line', 'road-exploration-point'],
      })[0]
      if (preview && onOverlaySelect) {
        onOverlaySelect(preview.properties)
        return
      }
      const structure = map.queryRenderedFeatures(e.point, { layers: ['road-structures'] })[0]?.properties
      if (structure?.chainage !== undefined) {
        if (structure.id) onSelectCulvert?.(String(structure.id))
        onStation(Number(structure.chainage))
        return
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: ['road-alignments'] })
      const hit = hits[0]?.properties
      if (hit?.id && hit.id !== activeAlignmentId) onSelectAlignment(String(hit.id))
      else if (hit?.chainage !== undefined) onStation(Number(hit.chainage))
      else if (onSelectCable && map.queryRenderedFeatures(e.point, { layers: ['road-cable'] })[0]?.properties?.id) {
        const cableId = String(map.queryRenderedFeatures(e.point, { layers: ['road-cable'] })[0].properties.id)
        onSelectCable(cableId)
        const selected = resolvedCables.find((c) => c.id === cableId)
        if (selected && onCableDistance) {
          onCableDistance(cableDistanceAt(selected.start, selected.end, [e.lngLat.lng, e.lngLat.lat]))
        }
      } else if (mode === 'inspect' && analysis.stations.length) {
        const nearest = analysis.stations.reduce((best, s) =>
          distance(s.coordinate, [e.lngLat.lng, e.lngLat.lat]) < distance(best.coordinate, [e.lngLat.lng, e.lngLat.lat])
            ? s
            : best,
        )
        onStation(nearest.chainage)
      }
    }
    const move = (e: MapMouseEvent) => {
      if (!['inspect', 'edit'].includes(mode)) onHover([e.lngLat.lng, e.lngLat.lat])
      else {
        // Match click precedence: hovering a spoke above the road must not
        // move the landing station and invalidate the fan before its click.
        if (
          onOverlaySelect &&
          map.queryRenderedFeatures(e.point, { layers: ['road-exploration-line', 'road-exploration-point'] }).length
        )
          return
        const hit = map.queryRenderedFeatures(e.point, { layers: ['road-alignments'] })[0]?.properties
        if (hit?.id === activeAlignmentId && hit.chainage !== undefined) onStation(Number(hit.chainage))
      }
    }
    map.getCanvas().style.cursor = ['inspect', 'edit'].includes(mode) ? '' : 'crosshair'
    map.doubleClickZoom.disable()
    map.on('click', click)
    map.on('mousemove', move)
    return () => {
      map.off('click', click)
      map.off('mousemove', move)
      map.getCanvas().style.cursor = ''
    }
  }, [
    map,
    isLoaded,
    mode,
    onDraw,
    onStation,
    onSelectAlignment,
    onHover,
    activeAlignmentId,
    analysis,
    onSelectCable,
    onCableDistance,
    resolvedCables,
    onOverlaySelect,
    onSelectCulvert,
  ])

  return (
    <>
      {props.overlay?.features
        .filter((feature): feature is GeoJSON.Feature<GeoJSON.Point> => feature.geometry.type === 'Point')
        .map((feature, index) => (
          <MapMarker
            key={`overlay-${feature.id ?? index}`}
            longitude={feature.geometry.coordinates[0]}
            latitude={feature.geometry.coordinates[1]}
          >
            <MarkerContent>
              <button
                className="translate-y-5 rounded border bg-background/95 px-1 py-0.5 text-[10px] shadow-sm"
                onClick={() => props.onOverlaySelect?.(feature.properties)}
                title={String(feature.properties?.label ?? 'Planning candidate')}
              >
                {String(feature.properties?.label ?? 'Candidate')}
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      {cableCursor && (
        <MapMarker longitude={cableCursor[0]} latitude={cableCursor[1]}>
          <MarkerContent>
            <div
              className="pointer-events-none rounded border-2 border-white bg-violet-700 px-1 py-0.5 text-[10px] text-white shadow"
              data-testid="road-active-cable-position"
              data-distance={props.cableDistance}
            >
              D-line {props.cableDistance?.toFixed(1)} m
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      {activeCable &&
        [
          {
            coordinate: activeCable.start,
            distance: 0,
            role: originalCable?.yarderAt === 'end' ? 'Tailhold' : 'Yarder',
            height: activeCable.startHeight,
          },
          {
            coordinate: activeCable.end,
            distance: distance(activeCable.start, activeCable.end),
            role: originalCable?.yarderAt === 'end' ? 'Yarder' : 'Tailhold',
            height: activeCable.endHeight,
          },
        ].map((support, index) => (
          <MapMarker key={`cable-support-${index}`} longitude={support.coordinate[0]} latitude={support.coordinate[1]}>
            <MarkerContent>
              <button
                className="-translate-y-5 rounded border border-violet-400 bg-violet-50 px-1 py-0.5 text-[10px] text-violet-800 shadow-sm"
                title={`${support.role}: ${support.height.toFixed(1)} m above the selected terrain`}
                aria-label={`Inspect ${support.role.toLowerCase()} support`}
                onClick={() => props.onCableDistance?.(support.distance)}
              >
                {support.role}
                {props.showLabels ? ` · ${support.height.toFixed(1)} m` : ''}
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      {props.showLabels &&
        annotationStations
          .filter((s) => Math.abs(s.chainage - (chosen?.chainage ?? -1)) > (labelInterval ?? 0) * 0.3)
          .map((s) => {
            const text = formatRoadStation(s.chainage).replace(/\.0$/, '')
            const [dx, dy] = labelOffset(s.bearing, view?.bearing ?? 0, text.length)
            return (
              <MapMarker key={`station-${s.chainage}`} longitude={s.coordinate[0]} latitude={s.coordinate[1]}>
                <MarkerContent>
                  <button
                    style={{ transform: `translate(${dx}px, ${dy}px)` }}
                    className="whitespace-nowrap rounded-sm bg-background/80 px-1 text-[10px] font-medium leading-4 tabular-nums text-foreground"
                    aria-label={`Inspect plan station ${s.chainage.toFixed(1)} metres`}
                    data-plan-station-label={s.chainage}
                    onClick={() => props.onStation(s.chainage)}
                  >
                    {text}
                  </button>
                </MarkerContent>
              </MapMarker>
            )
          })}
      {props.showLabels &&
        radiusLabels.map(({ id, label, at, curve }) => {
          const [dx, dy] = labelOffset(at.bearing, view?.bearing ?? 0, label.length, -1)
          return (
            <MapMarker key={`radius-${id}`} longitude={at.coordinate[0]} latitude={at.coordinate[1]}>
              <MarkerContent>
                <button
                  style={{ transform: `translate(${dx}px, ${dy}px)` }}
                  className="whitespace-nowrap rounded-sm bg-violet-50/85 px-1 text-[10px] font-medium leading-4 text-violet-800"
                  title={`Horizontal curve ${id.replace('curve-', 'C')}: radius ${curve.radius.toFixed(1)} m, arc ${curve.length.toFixed(1)} m, ${formatRoadStation(curve.start)}–${formatRoadStation(curve.end)}`}
                  aria-label={`Inspect horizontal curve radius ${curve.radius.toFixed(1)} metres`}
                  onClick={() => props.onStation((curve.start + curve.end) / 2)}
                >
                  {label}
                </button>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {props.mode === 'edit' &&
        props.alignment.points.map((p, index) => (
          <MapMarker
            key={p.id}
            className="z-10"
            longitude={p.coordinate[0]}
            latitude={p.coordinate[1]}
            draggable
            onDragStart={() => props.onPointDragStart(p.id)}
            onDrag={({ lng, lat }) => props.onMovePoint(p.id, [lng, lat])}
            onDragEnd={({ lng, lat }) => props.onPointDragEnd(p.id, [lng, lat])}
            onClick={() => props.onSelectPoint(p.id)}
          >
            <MarkerContent>
              <button
                aria-label={`Horizontal point ${index + 1}`}
                title={`${index === 0 ? 'Start' : index === props.alignment.points.length - 1 ? 'End' : `Control ${index + 1}`} · drag to move`}
                aria-pressed={props.selectedPoint === p.id}
                className={`size-7 cursor-grab touch-none rounded-full border-2 bg-background text-[10px] font-bold shadow active:cursor-grabbing ${props.selectedPoint === p.id ? 'border-rose-500 text-rose-600' : 'border-amber-600 text-amber-700'}`}
              >
                {index + 1}
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      {props.mode === 'edit' &&
        props.onInsertPoint &&
        props.alignment.points.length < 2000 &&
        props.alignment.points.slice(1).map((end, index) => {
          const start = props.alignment.points[index]
          const length = distance(start.coordinate, end.coordinate)
          if (length <= 0.4) return null
          const coordinate = positionAt({ ...props.alignment, points: [start, end] }, length / 2).coordinate
          return (
            <MapMarker
              className="z-10"
              key={`insert-${start.id}-${end.id}`}
              longitude={coordinate[0]}
              latitude={coordinate[1]}
            >
              <MarkerContent>
                <button
                  type="button"
                  aria-label={`Add control between points ${index + 1} and ${index + 2}`}
                  title="Add a middle control, then drag it to shape the road"
                  className="flex size-6 cursor-cell items-center justify-center rounded-full border border-dashed border-blue-600 bg-background/95 p-0 leading-none text-blue-700 shadow"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onInsertPoint?.(start.id, coordinate)
                  }}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              </MarkerContent>
            </MapMarker>
          )
        })}
      {chosen && (
        <MapMarker className="pointer-events-none" longitude={chosen.coordinate[0]} latitude={chosen.coordinate[1]}>
          <MarkerContent>
            <div
              data-testid="road-active-map-station"
              data-chainage={chosen.chainage}
              className="pointer-events-none relative size-3 rounded-full border-2 border-white bg-rose-600 shadow"
            >
              {props.showLabels && (
                <span
                  data-testid="road-active-map-label"
                  className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-sm border border-rose-500 bg-background/95 px-1 text-[10px] font-medium leading-4 tabular-nums text-rose-700 shadow-sm dark:text-rose-300"
                  style={(() => {
                    const text = `${formatRoadStation(chosen.chainage)} · ${chosen.gradePercent === null ? '—' : chosen.gradePercent.toFixed(1)}% · Z ${chosen.groundElevation === null ? '—' : chosen.groundElevation.toFixed(1)}`
                    const [dx, dy] = labelOffset(chosen.bearing, view?.bearing ?? 0, text.length, -1, 12)
                    return { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }
                  })()}
                >
                  {formatRoadStation(chosen.chainage)} ·{' '}
                  {chosen.gradePercent === null ? '—' : `${chosen.gradePercent.toFixed(1)}%`} · Z{' '}
                  {chosen.groundElevation === null ? '—' : chosen.groundElevation.toFixed(1)}
                </span>
              )}
            </div>
          </MarkerContent>
        </MapMarker>
      )}
      {props.draft.map((coordinate, i) => (
        <MapMarker key={i} longitude={coordinate[0]} latitude={coordinate[1]}>
          <MarkerContent>
            <span className="block size-3 rounded-full border-2 border-white bg-teal-600" />
          </MarkerContent>
        </MapMarker>
      ))}
      {analysis.crossings
        .filter((c) => c.kind === 'stream' && !props.hiddenContextKinds.includes('stream'))
        .map((crossing) => (
          <MapMarker key={crossing.id} longitude={crossing.coordinate[0]} latitude={crossing.coordinate[1]}>
            <MarkerContent>
              <button
                title={`${crossing.name} — crossing review`}
                aria-label={`Select crossing ${crossing.name}`}
                onClick={() => props.onStation(crossing.chainage)}
                className="rounded border border-sky-700 bg-sky-50 px-1 text-xs text-sky-800"
              >
                ≈
              </button>
            </MarkerContent>
          </MapMarker>
        ))}
      <span data-testid="road-map-ready" data-ready={isLoaded} className="sr-only">
        {isLoaded ? 'Road map ready' : 'Loading road map'}
      </span>
      {!props.terrainOnly &&
        analysis.engineering?.culverts.map((culvert, index, culverts) => {
          const design = props.alignment.engineering?.culverts.find((c) => c.id === culvert.id)
          const selected = props.selectedCulvertId === culvert.id
          const labelOffset =
            culverts.slice(0, index).filter((c) => Math.abs(c.chainage - culvert.chainage) < 0.001).length * 24
          return (
            <MapMarker
              key={`culvert-${culvert.id}`}
              longitude={culvert.coordinate[0]}
              latitude={culvert.coordinate[1]}
              offset={[0, labelOffset]}
            >
              <MarkerContent>
                <button
                  className={`rounded border bg-background/95 px-1 py-0.5 text-[10px] shadow-sm ${selected ? 'border-rose-600 text-rose-700 ring-2 ring-rose-400/50' : culvert.warnings.length ? 'border-amber-600 text-amber-800' : 'border-sky-600 text-sky-800'}`}
                  aria-label={`Inspect structure ${culvert.name}`}
                  aria-pressed={selected}
                  onClick={() => {
                    props.onSelectCulvert?.(culvert.id)
                    props.onStation(culvert.chainage)
                  }}
                  title={`${culvert.name} · ${formatRoadStation(culvert.chainage)} · cover ${culvert.coverM?.toFixed(2) ?? 'unknown'} m. ${culvert.warnings.join(' ')}`}
                >
                  Ø{props.showLabels && design ? ` ${Math.round(design.diameterM * 1000)} mm · ${culvert.name}` : ''}
                </button>
              </MarkerContent>
            </MapMarker>
          )
        })}
      <PlanLegend
        sections={buildPlanLegend({
          sources: {
            roads: allLines,
            context,
            corridor,
            formation,
            edges: roadEdges,
            ditches,
            cable,
            structures,
            draft,
            section,
            ticks,
            overlay: props.overlay,
            drainage: props.drainage,
          },
          alignments: props.project.alignments,
          maxGradePercent: props.project.settings.maxGradePercent,
          terrainOnly: !!props.terrainOnly,
          showEarthwork: props.showEarthwork,
          selection:
            !!props.selectedRange &&
            !!placeOn(props.alignment, props.selectedRange.start) &&
            !!placeOn(props.alignment, props.selectedRange.end),
          draftPoints: props.draft.length > 0,
          editing: props.mode === 'edit' && props.alignment.points.length > 0,
          insertControls:
            props.mode === 'edit' &&
            !!props.onInsertPoint &&
            props.alignment.points
              .slice(1)
              .some((point, index) => distance(props.alignment.points[index].coordinate, point.coordinate) > 0.4),
          crossingMarkers:
            !props.hiddenContextKinds.includes('stream') &&
            analysis.crossings.some((crossing) => crossing.kind === 'stream'),
          curveLabels: props.showLabels && radiusLabels.length > 0,
          cableCursor: !!cableCursor,
          cableSupports: !!activeCable,
        })}
        display={display}
        terrainLayer={props.terrainLayer}
        showContours={props.showContours}
        terrainName={props.project.terrain.name}
      />
    </>
  )
}

export function PlanView(props: PlanProps) {
  const [drag, setDrag] = useState<{ original: Alignment; id: string; coordinate: Coordinate } | null>(null)
  const previewAlignment = useMemo(
    () =>
      drag && drag.original === props.alignment && props.mode === 'edit'
        ? {
            ...props.alignment,
            points: props.alignment.points.map((point) =>
              point.id === drag.id ? { ...point, coordinate: drag.coordinate } : point,
            ),
          }
        : null,
    [drag, props.alignment, props.mode],
  )
  const previewAnalyses = useMemo(() => {
    if (!previewAlignment) return props.analyses
    const analyses = new globalThis.Map(props.analyses)
    analyses.set(
      previewAlignment.id,
      safeAnalyzeRoad(previewAlignment, props.source, props.project.settings, props.project.context),
    )
    return analyses
  }, [previewAlignment, props.analyses, props.source, props.project.settings, props.project.context])
  const [terrainLayer, setTerrainLayer] = useState<TerrainLayer>('hillshade')
  const [showContours, setShowContours] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showEarthwork, setShowEarthwork] = useState(true)
  const [editHelpVisible, setEditHelpVisible] = useState(() => {
    try {
      return localStorage.getItem('pgmaps-road-edit-help') !== 'hidden'
    } catch {
      return true
    }
  })
  const showEditHelp = (visible: boolean) => {
    setEditHelpVisible(visible)
    try {
      localStorage.setItem('pgmaps-road-edit-help', visible ? 'visible' : 'hidden')
    } catch {
      /* The preference still works when browser storage is unavailable. */
    }
  }
  const [hiddenContextKinds, setHiddenContextKinds] = useState<ContextFeature['kind'][]>([])
  const contextKinds = (Object.keys(CONTEXT_LABELS) as ContextFeature['kind'][]).filter((kind) =>
    props.project.context.some((feature) => feature.kind === kind),
  )
  const [fitRequest, setFitRequest] = useState<FitRequest>({ revision: 0, target: 'roads' })
  const fit = (target: FitRequest['target']) =>
    setFitRequest((previous) => ({ revision: previous.revision + 1, target }))
  const hasTerrainBounds = !!terrainBounds(props.project.terrain)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const dismiss = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setSettingsOpen(false)
      settingsButton.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [settingsOpen])
  const drawing = !['inspect', 'edit'].includes(props.mode)
  const center = props.alignment.points[0]?.coordinate ?? [-122.82, 53.89]
  return (
    <div
      className={`isolate relative h-full min-h-0 overflow-hidden rounded-lg ${drawing ? '[&_.maplibregl-marker]:pointer-events-none [&_.maplibregl-marker_*]:pointer-events-none' : ''}`}
      data-testid="road-plan-view"
      data-drawing={drawing}
    >
      <Map
        center={center}
        zoom={14}
        controls={
          <>
            <div className="absolute right-2 top-2 z-30 flex gap-1">
              <Button
                size="icon"
                variant="outline"
                className="size-8 bg-background shadow-sm"
                aria-label="Fit road alignments"
                title="Fit all road alignments"
                onClick={() => fit('roads')}
              >
                <LocateFixed className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="size-8 bg-background shadow-sm"
                aria-label="Fit terrain coverage"
                title="Fit the loaded DEM coverage"
                disabled={!hasTerrainBounds}
                onClick={() => fit('terrain')}
              >
                <Mountain className="size-4" />
              </Button>
            </div>
            <MapControls position="top-right" showZoom showCompass={false} className="road-map-controls top-12" />
          </>
        }
        showLoadingOverlay={false}
      >
        <Layers
          {...props}
          alignment={previewAlignment ?? props.alignment}
          analyses={previewAnalyses}
          onPointDragStart={(id) => props.onSelectPoint(id)}
          onMovePoint={(id, coordinate) => setDrag({ original: props.alignment, id, coordinate })}
          onPointDragEnd={(id, coordinate) => {
            setDrag(null)
            props.onMovePoint(id, coordinate)
          }}
          fitRequest={fitRequest}
          terrainLayer={terrainLayer}
          showContours={showContours}
          showLabels={showLabels}
          showEarthwork={showEarthwork}
          hiddenContextKinds={hiddenContextKinds}
        />
        <MapScaleBar position="bottom-left" className="road-map-scale left-2 bottom-2" />
      </Map>
      <div
        className="absolute left-2 top-2 z-30 flex max-w-[calc(100%-110px)] items-center gap-1"
        data-map-export-ignore
      >
        <AppSelect
          value={terrainLayer}
          onValueChange={(value) => setTerrainLayer(value as TerrainLayer)}
          triggerAriaLabel="Terrain display"
          contentClassName="z-[1600] text-xs"
          triggerClassName="h-8 w-24 min-w-0 bg-background/95 text-xs shadow-sm sm:w-32"
          options={[
            { value: 'hillshade', label: 'Hillshade' },
            { value: 'slope', label: 'Slope' },
            { value: 'aspect', label: 'Aspect' },
            { value: 'elevation', label: 'Elevation' },
            { value: 'none', label: 'Basemap' },
          ]}
        />
        <div className="relative shrink-0" ref={settingsRef}>
          <Button
            ref={settingsButton}
            size="icon"
            variant="outline"
            className="size-8 bg-background/95 shadow-sm"
            aria-label="Map display settings"
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 className="size-4" />
          </Button>
          {settingsOpen && (
            <div
              role="dialog"
              aria-label="Map display settings"
              className="absolute left-0 top-10 z-40 w-60 max-w-[calc(100vw-3rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold">Map settings</h3>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label="Close map settings"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X className="size-3" />
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mb-2 w-full"
                onClick={() => {
                  fit('active')
                  setSettingsOpen(false)
                }}
              >
                Fit selected road
              </Button>
              {(
                [
                  ['Contours', showContours, setShowContours],
                  ['Labels', showLabels, setShowLabels],
                  ...(!props.terrainOnly ? [['Earthworks', showEarthwork, setShowEarthwork] as const] : []),
                ] as const
              ).map(([label, checked, set]) => (
                <label key={label} className="flex items-center justify-between py-2 text-xs">
                  {label}
                  <input type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} />
                </label>
              ))}
              {contextKinds.length > 0 && (
                <fieldset className="mt-2 border-t pt-2" data-testid="road-context-visibility">
                  <legend className="text-xs font-medium">Context</legend>
                  {contextKinds.map((kind) => (
                    <label key={kind} className="flex items-center justify-between gap-2 py-2 text-xs">
                      {CONTEXT_LABELS[kind]}
                      <input
                        type="checkbox"
                        aria-label={`Show ${CONTEXT_LABELS[kind].toLowerCase()} context`}
                        checked={!hiddenContextKinds.includes(kind)}
                        onChange={(event) =>
                          setHiddenContextKinds((previous) =>
                            event.target.checked ? previous.filter((value) => value !== kind) : [...previous, kind],
                          )
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          )}
        </div>
        <RoadMapTools mode={props.mode} disabled={!props.onMode} onMode={(mode) => props.onMode?.(mode)} />
      </div>
      {props.mode === 'edit' &&
        (editHelpVisible ? (
          <div
            className="absolute left-2 top-12 z-20 flex max-w-[calc(100%-4rem)] items-center gap-2 rounded-md border bg-background/95 px-2 py-1 text-[11px] shadow"
            data-testid="road-edit-help"
          >
            <span className="min-w-0 flex-1">
              Drag numbered controls to move the start, end or path. Click + to add a middle control.
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              aria-label="Hide editing hint"
              title="Hide editing hint"
              onClick={() => showEditHelp(false)}
            >
              <X className="size-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            variant="outline"
            className="absolute left-2 top-12 z-20 size-7 bg-background/95 shadow-sm"
            aria-label="Show editing hint"
            title="Show editing hint"
            onClick={() => showEditHelp(true)}
          >
            <CircleHelp className="size-4" />
          </Button>
        ))}
    </div>
  )
}
