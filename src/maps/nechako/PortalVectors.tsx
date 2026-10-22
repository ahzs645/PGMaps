import { useEffect, useMemo, useRef, useState } from 'react'
import area from '@turf/area'
import buffer from '@turf/buffer'
import difference from '@turf/difference'
import intersect from '@turf/intersect'
import kinks from '@turf/kinks'
import length from '@turf/length'
import lineSplit from '@turf/line-split'
import union from '@turf/union'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Feature, FeatureCollection, LineString, Polygon, MultiPolygon } from 'geojson'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { csvExport } from './data/monitoring'
import { exportGis } from './data/conversion'
import { normalizeGeojson, type VectorData } from './data/workspace'
import { categoryLabel, makeCategoryStyle } from './data/vectorStyle'
import { stylePaint, vectorStyleFor } from './data/vectorRules'
import { applyLocalDefaultStyle } from './data/styleLibrary'
import { PortalVectorStyleEditor } from './PortalVectorStyleEditor'
import { PortalStyleLibrary } from './PortalStyleLibrary'
import { splitPolygon } from './data/polygonSplit'

function featureCollection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features }
}

export function VectorLayers({
  vectors,
  onSelect,
}: {
  vectors: VectorData[]
  onSelect?: (id: string, index: number) => void
}) {
  return (
    <>
      {vectors
        .filter((item) => item.visible)
        .map((item) => (
          <VectorLayer key={item.id} vector={item} onSelect={onSelect} />
        ))}
    </>
  )
}
function VectorLayer({ vector, onSelect }: { vector: VectorData; onSelect?: (id: string, index: number) => void }) {
  const style = useMemo(() => vectorStyleFor(vector), [vector])
  const paint = useMemo(() => stylePaint(style), [style])
  const data = useMemo(() => {
    const flatten = (feature: Feature): Feature[] =>
      feature.geometry?.type === 'GeometryCollection'
        ? feature.geometry.geometries.flatMap((geometry) => flatten({ ...feature, geometry }))
        : [feature]
    return featureCollection(
      vector.data.features.flatMap((feature, index) =>
        flatten({ ...feature, properties: { ...feature.properties, __nechako_render_id: index } }),
      ),
    ) as FeatureCollection
  }, [vector.data])
  const polygons = useMemo(
    () => featureCollection(data.features.filter((item) => /Polygon$/.test(item.geometry?.type || ''))),
    [data],
  )
  const lines = useMemo(
    () => featureCollection(data.features.filter((item) => /LineString$/.test(item.geometry?.type || ''))),
    [data],
  )
  const points = useMemo(
    () => featureCollection(data.features.filter((item) => /Point$/.test(item.geometry?.type || ''))),
    [data],
  )
  return (
    <>
      {polygons.features.length > 0 && (style.geometry === 'any' || style.geometry === 'polygon') && (
        <MapFillLayer
          data={polygons}
          fillColor={paint.fillColor}
          fillOpacity={paint.fillOpacity}
          lineColor={paint.strokeColor}
          lineWidth={paint.strokeWidth}
          lineOpacity={1}
          idProperty="__nechako_render_id"
          onFeatureClick={(id) => onSelect?.(vector.id, Number(id))}
        />
      )}
      {lines.features.length > 0 && (style.geometry === 'any' || style.geometry === 'line') && (
        <MapLineLayer
          data={lines}
          color={paint.strokeColor}
          width={vector.style ? paint.strokeWidth : (vector.lineWidth ?? 3)}
          opacity={1}
          lineCap={vector.style ? 'butt' : 'round'}
          lineJoin={vector.style ? 'miter' : 'round'}
          sourceTolerance={0}
          interactive={!!onSelect}
          idProperty="__nechako_render_id"
          onFeatureClick={(id) => onSelect?.(vector.id, Number(id))}
        />
      )}
      {points.features.length > 0 && (style.geometry === 'any' || style.geometry === 'point') && (
        <MapCircleLayer
          data={points}
          color={paint.fillColor}
          radius={paint.pointRadius}
          opacity={paint.pointOpacity}
          strokeColor={vector.style ? paint.strokeColor : '#ffffff'}
          strokeWidth={vector.style ? paint.pointStrokeWidth : 1.25}
          hoverEnabled={false}
          idProperty="__nechako_render_id"
          onFeatureClick={(id) => onSelect?.(vector.id, Number(id))}
        />
      )}
    </>
  )
}

type Operation = 'buffer' | 'union' | 'intersection' | 'difference' | 'clip' | 'split-line' | 'split-polygon'
export function processGeometry(
  a: Feature,
  b: Feature | undefined,
  operation: Operation,
  meters: number,
): FeatureCollection {
  if (!a.geometry) throw new Error('The primary feature has no geometry.')
  if (operation === 'buffer') {
    if (!Number.isFinite(meters) || meters <= 0 || meters > 100000)
      throw new Error('Buffer distance must be > 0 and ≤ 100,000 metres.')
    const output = buffer(a, meters, { units: 'meters' })
    if (!output) throw new Error('The buffer produced no geometry.')
    return featureCollection([{ ...output, properties: { ...a.properties, operation, buffer_m: meters } }])
  }
  if (!b?.geometry) throw new Error('Choose a secondary feature with geometry.')
  if (operation === 'split-polygon') {
    if (
      !['Polygon', 'MultiPolygon'].includes(a.geometry.type) ||
      !['LineString', 'MultiLineString'].includes(b.geometry.type)
    )
      throw new Error('Split polygon needs a polygon primary feature and a line cutter.')
    return splitPolygon(a as Feature<Polygon | MultiPolygon>, b as Feature<LineString | GeoJSON.MultiLineString>)
  }
  if (operation === 'clip' && !['Polygon', 'MultiPolygon'].includes(a.geometry.type)) {
    if (!['Polygon', 'MultiPolygon'].includes(b.geometry.type))
      throw new Error('Clip needs a polygon boundary as the secondary feature.')
    const boundary = b as Feature<Polygon | MultiPolygon>
    const inside = (coordinate: GeoJSON.Position) =>
      booleanPointInPolygon({ type: 'Point', coordinates: coordinate }, boundary)
    if (a.geometry.type === 'Point') return featureCollection(inside(a.geometry.coordinates) ? [a] : [])
    if (a.geometry.type === 'MultiPoint') {
      const coordinates = a.geometry.coordinates.filter(inside)
      return featureCollection(coordinates.length ? [{ ...a, geometry: { type: 'MultiPoint', coordinates } }] : [])
    }
    if (a.geometry.type === 'LineString' || a.geometry.type === 'MultiLineString') {
      const lines = a.geometry.type === 'LineString' ? [a.geometry.coordinates] : a.geometry.coordinates
      const output: Feature[] = []
      for (const coordinates of lines) {
        const line: Feature<LineString> = { ...a, geometry: { type: 'LineString', coordinates } }
        const split = lineSplit(line, boundary)
        for (const part of split.features.length ? split.features : [line]) {
          const [p, q] = part.geometry.coordinates
          if (inside([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]))
            output.push({ ...part, properties: { ...a.properties, operation: 'clip' } })
        }
      }
      return featureCollection(output)
    }
    throw new Error('Flatten GeometryCollections into separate features before clipping.')
  }
  if (operation === 'split-line') {
    if (
      a.geometry.type !== 'LineString' ||
      !['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'Point', 'MultiPoint'].includes(b.geometry.type)
    )
      throw new Error('Split line needs a LineString cut by a point, line or polygon.')
    const output = lineSplit(a as Feature<LineString>, b as Parameters<typeof lineSplit>[1])
    if (!output.features.length) throw new Error('The cutter does not split this line.')
    return featureCollection(
      output.features.map((feature, index) => ({
        ...feature,
        properties: { ...a.properties, operation, part: index + 1 },
      })),
    )
  }
  for (const feature of [a, b]) {
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type || ''))
      throw new Error('Union, intersection, difference and clip currently support polygon features.')
    if (kinks(feature as Feature<Polygon | MultiPolygon>).features.length)
      throw new Error('Resolve self-intersecting polygons before processing.')
  }
  const left = a as Feature<Polygon | MultiPolygon>,
    right = b as Feature<Polygon | MultiPolygon>
  const output =
    operation === 'union'
      ? union(left, right)
      : operation === 'difference'
        ? difference(left, right)
        : intersect(left, right)
  return featureCollection(
    output ? [{ ...output, properties: { ...a.properties, operation, secondary_properties: b.properties } }] : [],
  )
}

export function PortalVectors({
  vectors,
  setVectors,
  map,
  onDrawing,
  onSketch,
  picked,
}: {
  vectors: VectorData[]
  setVectors: (value: VectorData[]) => void
  map: React.RefObject<MapLibreMap>
  onDrawing: (active: boolean) => void
  onSketch: (sketch: FeatureCollection) => void
  picked?: { id: string; index: number }
}) {
  const [selectedId, setSelectedId] = useState(''),
    [secondaryId, setSecondaryId] = useState('')
  const selected = vectors.find((item) => item.id === selectedId) || vectors[0],
    secondary = vectors.find((item) => item.id === secondaryId)
  const [featureIndex, setFeatureIndex] = useState(0),
    [secondaryIndex, setSecondaryIndex] = useState(0)
  const [operation, setOperation] = useState<Operation>('buffer'),
    [meters, setMeters] = useState(100)
  const [error, setError] = useState(''),
    [edit, setEdit] = useState(''),
    [page, setPage] = useState(0)
  const [draw, setDraw] = useState<'off' | 'Point' | 'LineString' | 'Polygon'>('off')
  const [positions, setPositions] = useState<[number, number][]>([])
  const [exporting, setExporting] = useState(false),
    [format, setFormat] = useState('gpkg')
  const [exportWarnings, setExportWarnings] = useState<string[]>([])
  const history = useRef<VectorData[][]>([])
  const selectedFeature = selected?.data.features[featureIndex]
  useEffect(() => {
    const features: Feature[] = positions.map((coordinates) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates },
    }))
    if (positions.length >= 2 && draw !== 'Point')
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: positions } })
    if (positions.length >= 3 && draw === 'Polygon')
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...positions, positions[0]]] },
      })
    onSketch(featureCollection(features))
  }, [positions, draw, onSketch])
  useEffect(() => {
    setEdit('')
    setPage(0)
    setExportWarnings([])
  }, [selected?.id])
  useEffect(() => {
    if (picked) {
      setSelectedId(picked.id)
      setFeatureIndex(picked.index)
    }
  }, [picked])
  useEffect(() => {
    onDrawing(draw !== 'off')
    const instance = map.current
    if (!instance || draw === 'off') return
    const click = (event: MapMouseEvent) => setPositions((values) => [...values, [event.lngLat.lng, event.lngLat.lat]])
    instance.getCanvas().style.cursor = 'crosshair'
    const doubleClick = instance.doubleClickZoom.isEnabled()
    instance.doubleClickZoom.disable()
    instance.on('click', click)
    return () => {
      instance.off('click', click)
      instance.getCanvas().style.cursor = ''
      if (doubleClick) instance.doubleClickZoom.enable()
    }
  }, [draw, map, onDrawing])
  useEffect(() => () => onDrawing(false), [onDrawing])
  const replace = (next: VectorData[]) => {
    history.current = [...history.current.slice(-4), vectors]
    setVectors(next)
    setError('')
  }
  const add = async (data: FeatureCollection, name: string) => {
    const id = crypto.randomUUID()
    const vector = await applyLocalDefaultStyle({ id, name, data, color: '#c2410c', visible: true })
    replace([...vectors, vector])
    setSelectedId(id)
    setFeatureIndex(0)
    setPositions([])
    setDraw('off')
  }
  const finishDrawing = async () => {
    try {
      if (draw === 'Point' && positions.length !== 1)
        throw new Error('Place exactly one point, or undo extra vertices.')
      if (draw === 'LineString' && positions.length < 2) throw new Error('A line needs at least two vertices.')
      if (draw === 'Polygon' && positions.length < 3) throw new Error('A polygon needs at least three vertices.')
      if (draw === 'off') return
      const coordinates =
        draw === 'Point' ? positions[0] : draw === 'LineString' ? positions : [[...positions, positions[0]]]
      const data = normalizeGeojson({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { origin: 'local drawing' }, geometry: { type: draw, coordinates } }],
      })
      if (draw === 'Polygon' && kinks(data.features[0] as Feature<Polygon>).features.length)
        throw new Error('Drawing self-intersects; undo vertices and redraw.')
      await add(data, `Drawn ${draw.toLowerCase()}`)
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const keys = [...new Set(selected?.data.features.flatMap((item) => Object.keys(item.properties || {})) || [])]
  const pages = Math.max(1, Math.ceil((selected?.data.features.length || 0) / 25)),
    current = Math.min(page, pages - 1)
  const metrics = useMemo(() => {
    if (!selectedFeature?.geometry) return ''
    try {
      if (/Polygon$/.test(selectedFeature.geometry.type)) return `${(area(selectedFeature) / 10000).toFixed(3)} ha`
      if (/LineString$/.test(selectedFeature.geometry.type))
        return `${length(selectedFeature as Feature<LineString>, { units: 'kilometers' }).toFixed(3)} km`
    } catch {
      return 'Measurement unavailable for this geometry.'
    }
    return 'Point feature'
  }, [selectedFeature])
  return (
    <details className="space-y-3 rounded-lg border p-3" open={vectors.length > 0 || draw !== 'off'}>
      <summary className="cursor-pointer font-semibold">
        Vectors, drawing and processing ({vectors.length} layers)
      </summary>
      <p className="mt-3 text-xs text-muted-foreground">
        Imported data and edits are local. Export a workspace before leaving. Geometry operations create a new layer and
        retain inputs; undo covers the last five local edits. Measurements use geodesic lengths and spherical areas,
        suitable for exploration.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="text-sm">
          Draw
          <select
            aria-label="Drawing mode"
            value={draw}
            className="ml-2 rounded-md border bg-background p-2"
            onChange={(event) => {
              setDraw(event.target.value as typeof draw)
              setPositions([])
              setError('')
            }}
          >
            <option value="off">Off</option>
            <option value="Point">Point</option>
            <option value="LineString">Line</option>
            <option value="Polygon">Polygon</option>
          </select>
        </label>
        {draw !== 'off' && (
          <>
            <p className="text-sm">{positions.length} vertices; click the map to place them.</p>
            <Button size="sm" variant="outline" onClick={() => setPositions((values) => values.slice(0, -1))}>
              Undo vertex
            </Button>
            <Button size="sm" onClick={finishDrawing}>
              Finish drawing
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!history.current.length}
          onClick={() => {
            const previous = history.current.pop()
            if (previous) setVectors(previous)
          }}
        >
          Undo vector edit
        </Button>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {positions.length > 0 && (
        <p className="break-words text-xs">
          Vertices: {positions.map((point) => point.map((value) => value.toFixed(5)).join(', ')).join(' · ')}
        </p>
      )}
      {vectors.map((item) => (
        <div key={item.id} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label>
            <input
              type="checkbox"
              checked={item.visible}
              onChange={(event) =>
                setVectors(
                  vectors.map((value) => (value.id === item.id ? { ...value, visible: event.target.checked } : value)),
                )
              }
            />{' '}
            {item.name} ({item.data.features.length})
          </label>
          <input
            aria-label={`Color for ${item.name}`}
            type="color"
            disabled={!!item.style}
            value={item.color}
            onChange={(event) =>
              setVectors(
                vectors.map((value) => (value.id === item.id ? { ...value, color: event.target.value } : value)),
              )
            }
          />
          <details className="w-full rounded border p-2">
            <summary>Style {item.name}</summary>
            <div hidden={!!item.style}>
              <label className="block">
                Color categories by field
                <select
                  className="ml-2 max-w-full rounded border bg-background p-2"
                  aria-label={`Category field for ${item.name}`}
                  value={item.categories?.property ?? ''}
                  onChange={(event) => {
                    try {
                      const categories = event.target.value
                        ? makeCategoryStyle(item.data, event.target.value, item.color)
                        : undefined
                      replace(vectors.map((value) => (value.id === item.id ? { ...value, categories } : value)))
                      setError('')
                    } catch (reason) {
                      setError(errorText(reason))
                    }
                  }}
                >
                  <option value="">Single color</option>
                  {[...new Set(item.data.features.flatMap((feature) => Object.keys(feature.properties ?? {})))]
                    .sort()
                    .map((field) => (
                      <option key={field}>{field}</option>
                    ))}
                </select>
              </label>
              {item.categories?.rules.map((rule, index) => (
                <label key={index} className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Category ${categoryLabel(rule.value)} for ${item.name}`}
                    value={rule.color}
                    onChange={(event) =>
                      replace(
                        vectors.map((value) =>
                          value.id === item.id
                            ? {
                                ...value,
                                categories: {
                                  ...item.categories!,
                                  rules: item.categories!.rules.map((entry, i) =>
                                    i === index ? { ...entry, color: event.target.value } : entry,
                                  ),
                                },
                              }
                            : value,
                        ),
                      )
                    }
                  />
                  {categoryLabel(rule.value)}
                </label>
              ))}
              {item.categories && (
                <label className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Fallback color for ${item.name}`}
                    value={item.categories.fallback}
                    onChange={(event) =>
                      replace(
                        vectors.map((value) =>
                          value.id === item.id
                            ? { ...value, categories: { ...item.categories!, fallback: event.target.value } }
                            : value,
                        ),
                      )
                    }
                  />
                  Other values
                </label>
              )}
              {(
                [
                  ['lineWidth', 'Line width (pixels)', 20, 2],
                  ['pointRadius', 'Point radius (pixels)', 30, 6],
                  ['fillOpacity', 'Fill opacity', 1, 0.35],
                ] as const
              ).map(([key, title, max, initial]) => (
                <label key={key} className="mt-2 block">
                  {title}
                  <input
                    type="range"
                    className="w-full"
                    min="0"
                    max={max}
                    step={max === 1 ? 0.05 : 1}
                    aria-label={`${title} for ${item.name}`}
                    value={item[key] ?? initial}
                    onChange={(event) =>
                      replace(
                        vectors.map((value) =>
                          value.id === item.id ? { ...value, [key]: Number(event.target.value) } : value,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                Category colors preserve number, text and boolean values separately. Missing values share the null
                category. Up to 40 categories.
              </p>
            </div>
            <PortalVectorStyleEditor
              vector={item}
              onChange={(next) => replace(vectors.map((value) => (value.id === next.id ? next : value)))}
            />
          </details>
          <Button size="sm" variant="outline" onClick={() => replace(vectors.filter((value) => value.id !== item.id))}>
            Remove vector {item.name}
          </Button>
        </div>
      ))}
      <PortalStyleLibrary
        vectors={vectors}
        onApply={(next) => replace(vectors.map((value) => (value.id === next.id ? next : value)))}
      />
      {selected && (
        <>
          <label className="mt-3 block text-sm">
            Primary vector
            <select
              aria-label="Primary vector"
              value={selected.id}
              className="ml-2 max-w-full rounded-md border bg-background p-2"
              onChange={(event) => {
                setSelectedId(event.target.value)
                setFeatureIndex(0)
              }}
            >
              {vectors.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Primary feature
            <input
              aria-label="Primary feature index"
              type="number"
              min="0"
              max={Math.max(0, selected.data.features.length - 1)}
              value={featureIndex}
              className="ml-2 w-24 rounded-md border bg-background p-2"
              onChange={(event) => setFeatureIndex(Number(event.target.value))}
            />{' '}
            (zero-based) · {metrics}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadText(JSON.stringify(selected.data), 'vectors.geojson', 'application/geo+json')}
            >
              Export vector GeoJSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  csvExport(
                    ['feature_index', 'source_id', 'geometry_type', ...keys],
                    selected.data.features.map((item, index) => [
                      index,
                      item.id,
                      item.geometry?.type || '',
                      ...keys.map((key) => item.properties?.[key]),
                    ]),
                  ),
                  'vector-attributes.csv',
                  'text/csv',
                )
              }
            >
              Export vector attributes
            </Button>
            <select
              aria-label="Vector export format"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              className="rounded-md border bg-background p-2 text-sm"
            >
              <option value="gpkg">GeoPackage</option>
              <option value="shapefile">Shapefile ZIP</option>
              <option value="sqlite">SQLite</option>
              <option value="spatialite">SpatiaLite</option>
              <option value="gml">GML</option>
              <option value="kml">KML</option>
              <option value="kmz">KMZ</option>
              <option value="gpx">GPX (points/lines)</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={exporting}
              onClick={async () => {
                setExporting(true)
                setExportWarnings([])
                try {
                  const exported = await exportGis(selected.data, format)
                  setExportWarnings(exported.warnings)
                  setError('')
                } catch (reason) {
                  setError(errorText(reason))
                } finally {
                  setExporting(false)
                }
              }}
            >
              {exporting ? 'Exporting…' : 'Convert GIS export'}
            </Button>
          </div>
          {exportWarnings.map((warning, index) => (
            <InlineAlert key={index} tone="warning">
              {warning}
            </InlineAlert>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous vector records
            </Button>
            <p className="text-xs">
              Page {current + 1} of {pages}
            </p>
            <Button size="sm" variant="outline" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              Next vector records
            </Button>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="text-left text-xs">
              <thead>
                <tr>
                  <th className="p-2">Feature</th>
                  <th className="p-2">Geometry</th>
                  {keys.map((key) => (
                    <th key={key} className="p-2">
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.data.features.slice(current * 25, (current + 1) * 25).map((item, index) => (
                  <tr key={index} className="border-t">
                    <td className="p-2">
                      <button className="text-primary underline" onClick={() => setFeatureIndex(current * 25 + index)}>
                        {current * 25 + index}
                      </button>
                    </td>
                    <td className="p-2">{item.geometry?.type || 'None'}</td>
                    {keys.map((key) => (
                      <td key={key} className="max-w-72 break-words p-2">
                        {typeof item.properties?.[key] === 'object'
                          ? JSON.stringify(item.properties[key])
                          : String(item.properties?.[key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Edit geometry and properties (GeoJSON)</summary>
            <Button size="sm" variant="outline" onClick={() => setEdit(JSON.stringify(selected.data, null, 2))}>
              Load current GeoJSON
            </Button>
            <textarea
              aria-label="Vector GeoJSON editor"
              value={edit}
              onChange={(event) => setEdit(event.target.value)}
              className="mt-2 h-48 w-full rounded-md border bg-background p-2 font-mono text-xs"
            />
            <Button
              size="sm"
              disabled={!edit}
              onClick={() => {
                try {
                  if (edit.length > 20 * 1024 * 1024) throw new Error('Edited GeoJSON exceeds 20 MB.')
                  const data = normalizeGeojson(JSON.parse(edit))
                  replace(
                    vectors.map((item) =>
                      item.id === selected.id ? { ...item, data, original: item.original || selected.data } : item,
                    ),
                  )
                  setEdit('')
                } catch (reason) {
                  setError(errorText(reason))
                }
              }}
            >
              Apply local edit
            </Button>
          </details>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Geometry operation"
              value={operation}
              onChange={(event) => setOperation(event.target.value as Operation)}
              className="rounded-md border bg-background p-2 text-sm"
            >
              {['buffer', 'union', 'intersection', 'difference', 'clip', 'split-line', 'split-polygon'].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            {operation === 'buffer' ? (
              <label className="text-sm">
                Metres
                <input
                  aria-label="Buffer metres"
                  type="number"
                  value={meters}
                  onChange={(event) => setMeters(Number(event.target.value))}
                  className="ml-2 w-28 rounded-md border bg-background p-2"
                />
              </label>
            ) : (
              <>
                <select
                  aria-label="Secondary vector"
                  value={secondaryId}
                  onChange={(event) => {
                    setSecondaryId(event.target.value)
                    setSecondaryIndex(0)
                  }}
                  className="max-w-full rounded-md border bg-background p-2 text-sm"
                >
                  <option value="">Choose a cutter/second layer</option>
                  {vectors.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Secondary feature index"
                  type="number"
                  min="0"
                  value={secondaryIndex}
                  onChange={(event) => setSecondaryIndex(Number(event.target.value))}
                  className="w-24 rounded-md border bg-background p-2 text-sm"
                />
              </>
            )}
            <Button
              size="sm"
              onClick={async () => {
                try {
                  if (!selectedFeature) throw new Error('Choose a valid primary feature.')
                  const output = processGeometry(
                    selectedFeature,
                    secondary?.data.features[secondaryIndex],
                    operation,
                    meters,
                  )
                  if (!output.features.length)
                    throw new Error('Operation produced empty geometry; no output layer created.')
                  await add(output, `${operation}: ${selected.name}`)
                } catch (reason) {
                  setError(errorText(reason))
                }
              }}
            >
              Run geometry operation
            </Button>
          </div>
        </>
      )}
    </details>
  )
}
