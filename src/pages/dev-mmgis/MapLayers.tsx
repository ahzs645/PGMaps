import { memo, useCallback, useMemo } from 'react'
import { MapCircleLayer, MapFillLayer, MapLineLayer, MapRasterLayer } from '@/components/ui/map-layers'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { colorExpression, sizeExpression } from '@/lib/layerStyle'
import { effectiveStyle, FEATURE_ID_KEY, filteredCollection, type LoadedLayer } from '../dev-data/layerData'
import {
  drawingGeometry,
  geometryVertices,
  moveVertex,
  renderableCollection,
  type Coordinate,
  type Mission,
  type MissionLayer,
  type Tool,
} from './model'
import type { Geometry } from 'geojson'

const VectorLayer = memo(function VectorLayer({
  layer,
  loaded,
  order,
  selected,
  onSelect,
  interactive,
}: {
  layer: MissionLayer
  loaded: LoadedLayer
  order: number
  selected: string | null
  onSelect: (layer: string, id: string) => void
  interactive: boolean
}) {
  const style = effectiveStyle(layer, loaded),
    data = renderableCollection(filteredCollection(loaded.collection, layer, style))
  const color = colorExpression(style)
  const hover = useCallback(
    (p: Record<string, unknown>) =>
      mapTooltipHtml({ title: String(p.name ?? p.title ?? layer.label), subtitle: layer.label }),
    [layer.label],
  )
  const click = useCallback((id: string) => onSelect(layer.id, id), [layer.id, onSelect])
  const selectedId = selected?.startsWith(`${layer.id}:`) ? selected : null
  // Draw each geometry family from mixed uploads instead of dropping minority geometries.
  const geometries = {
    points: { ...data, features: data.features.filter((f) => f.geometry?.type.includes('Point')) },
    lines: { ...data, features: data.features.filter((f) => f.geometry?.type.includes('LineString')) },
    polygons: { ...data, features: data.features.filter((f) => f.geometry?.type.includes('Polygon')) },
  }
  const common = {
    visible: layer.visible,
    idProperty: FEATURE_ID_KEY,
    selectedId,
    layerOrder: order,
    hoverHtml: interactive ? hover : undefined,
    onFeatureClick: interactive ? click : undefined,
  }
  return (
    <>
      <MapFillLayer
        {...common}
        data={geometries.polygons}
        fillColor={color}
        fillOpacity={layer.opacity * (layer.geometry === 'fill' ? 1 : 0.3)}
        lineColor={color}
        lineWidth={1.4}
      />
      <MapLineLayer
        {...common}
        data={geometries.lines}
        color={color}
        opacity={layer.opacity}
        width={sizeExpression(style, 3)}
        interactive={interactive}
      />
      <MapCircleLayer
        {...common}
        data={geometries.points}
        color={color}
        radius={sizeExpression(style, 6)}
        opacity={layer.opacity}
        strokeColor="#ffffff"
        strokeWidth={1.5}
        hoverEnabled={interactive}
      />
    </>
  )
})
export function MissionLayers({
  mission,
  getLayer,
  selected,
  onSelect,
  interactive,
}: {
  mission: Mission
  getLayer: (id: string) => LoadedLayer
  selected: string | null
  onSelect: (layer: string, id: string) => void
  interactive: boolean
}) {
  return (
    <>
      {mission.tiles.map((l, i) => (
        <MapRasterLayer
          key={`${l.id}:${l.tiles.join()}`}
          tiles={l.tiles}
          visible={l.visible}
          opacity={l.opacity}
          attribution={l.attribution}
          layerOrder={i}
        />
      ))}
      {mission.layers.map((layer, i) => (
        <VectorLayer
          key={layer.id}
          layer={layer}
          loaded={getLayer(layer.id)}
          order={20 + i}
          selected={selected}
          onSelect={onSelect}
          interactive={interactive}
        />
      ))}
    </>
  )
}
export function DrawingOverlay({
  tool,
  points,
  pointer,
}: {
  tool: Tool
  points: Coordinate[]
  pointer: Coordinate | null
}) {
  const data = useMemo(() => {
    const g = drawingGeometry(tool, points, tool === 'polygon' && points.length >= 3)
    return {
      type: 'FeatureCollection' as const,
      features: g ? [{ type: 'Feature' as const, geometry: g, properties: {} }] : [],
    }
  }, [points, tool])
  const vertices = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: points.map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: p },
        properties: {},
      })),
    }),
    [points],
  )
  const preview = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features:
        pointer && points.length && ['line', 'polygon', 'measure'].includes(tool)
          ? [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'LineString' as const,
                  coordinates: [
                    points[points.length - 1],
                    pointer,
                    ...(tool === 'polygon' && points.length > 1 ? [points[0]] : []),
                  ],
                },
              },
            ]
          : [],
    }),
    [points, pointer, tool],
  )
  return (
    <>
      {tool === 'polygon' && points.length >= 3 ? (
        <MapFillLayer data={data} fillColor="#e5a23e" fillOpacity={0.18} lineColor="#e5a23e" layerOrder={200} />
      ) : (
        <MapLineLayer data={data} color="#e5a23e" width={3} layerOrder={200} interactive={false} />
      )}
      <MapCircleLayer
        data={vertices}
        color="#ffffff"
        strokeColor="#d49138"
        strokeWidth={2}
        radius={4}
        layerOrder={201}
        hoverEnabled={false}
      />
      <MapLineLayer data={preview} color="#e5a23e" width={2} dashArray={[3, 2]} layerOrder={202} interactive={false} />
    </>
  )
}
export function VertexEditor({ geometry, onChange }: { geometry: Geometry; onChange: (g: Geometry) => void }) {
  return (
    <>
      {geometryVertices(geometry).map((p, i) => (
        <MapMarker
          key={i}
          longitude={p[0]}
          latitude={p[1]}
          draggable
          onDragEnd={(v) => onChange(moveVertex(geometry, i, [v.lng, v.lat]))}
        >
          <MarkerContent>
            <button
              type="button"
              className="mm-vertex"
              aria-label={`Move vertex ${i + 1}`}
              title="Drag, or use arrow keys (Shift for larger steps)"
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
                e.preventDefault()
                e.stopPropagation()
                const d = e.shiftKey ? 0.0001 : 0.00001
                onChange(
                  moveVertex(geometry, i, [
                    p[0] + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0),
                    p[1] + (e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0),
                  ]),
                )
              }}
            />
          </MarkerContent>
        </MapMarker>
      ))}
    </>
  )
}
