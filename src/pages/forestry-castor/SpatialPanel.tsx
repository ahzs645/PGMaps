import { useEffect, useMemo, useState } from 'react'
import type { StyleSpecification } from 'maplibre-gl'
import { Download, Scan } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { Map, useMap } from '@/components/ui/map'
import { MapCircleLayer, MapFillLayer } from '@/components/ui/map-layers'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { downloadBlob, downloadText } from '@/lib/download'
import { escapeHtml } from '@/lib/escapeHtml'
import {
  castorGeoTiff,
  castorLandingsGeoJson,
  castorSpatialGeoJson,
  type CastorMetric,
} from '@/features/forestry-castor/outputs'
import type { CastorProject, CastorResult } from '@/features/forestry-castor/types'
import { number, Section } from './common'

const METRICS: Array<{ value: CastorMetric; label: string; unit: string }> = [
  { value: 'harvestYear', label: 'Most recent harvest year', unit: 'year' },
  { value: 'constrainedYears', label: 'Years constrained', unit: 'years' },
  { value: 'constrainedPeriods', label: 'Periods constrained', unit: 'periods' },
  { value: 'constrained', label: 'Constrained this period', unit: '0 / 1' },
  { value: 'harvestVolume', label: 'Cumulative harvested volume', unit: 'm³ / cell' },
  { value: 'age', label: 'Stand age', unit: 'years' },
  { value: 'volume', label: 'Standing volume', unit: 'm³/ha' },
  { value: 'height', label: 'Stand height', unit: 'm' },
  { value: 'eca', label: 'Equivalent clearcut area', unit: 'fraction' },
]
const LOCAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'castor-local-background', type: 'background', paint: { 'background-color': '#e9efea' } }],
}

function MapEvidence({
  bounds,
  fitNonce,
  onRendered,
}: {
  bounds: [number, number, number, number] | null
  fitNonce: number
  onRendered: (count: number) => void
}) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || !bounds) return
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 40, duration: 0, maxZoom: 17 },
    )
  }, [map, isLoaded, bounds, fitNonce])
  useEffect(() => {
    if (!map || !isLoaded) return
    const inspect = () => {
      const layers = map
        .getStyle()
        .layers.filter(
          (layer) =>
            (layer.type === 'fill' || layer.type === 'circle') &&
            'source' in layer &&
            (layer.source === 'fill-shared-castor-pixels' || layer.source === 'circle-shared-castor-pixels'),
        )
        .map((layer) => layer.id)
      if (!layers.length) return
      const ids = new Set(map.queryRenderedFeatures(undefined, { layers }).map((feature) => feature.properties.id))
      onRendered(ids.size)
    }
    map.on('idle', inspect)
    map.on('moveend', inspect)
    inspect()
    return () => {
      map.off('idle', inspect)
      map.off('moveend', inspect)
    }
  }, [isLoaded, map, onRendered])
  return null
}

function collectionBounds(collection: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  const visit = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return
    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      west = Math.min(west, coordinates[0])
      east = Math.max(east, coordinates[0])
      south = Math.min(south, coordinates[1])
      north = Math.max(north, coordinates[1])
    } else coordinates.forEach(visit)
  }
  for (const feature of collection.features)
    if (feature.geometry && 'coordinates' in feature.geometry) visit(feature.geometry.coordinates)
  return Number.isFinite(west) ? [west, south, east, north] : null
}

export function SpatialPanel({ project, result }: { project: CastorProject; result: CastorResult }) {
  const [period, setPeriod] = useState(result.snapshots[result.snapshots.length - 1]?.period ?? 0)
  const [metric, setMetric] = useState<CastorMetric>('harvestYear')
  const [landingsVisible, setLandingsVisible] = useState(true)
  const [fitNonce, setFitNonce] = useState(0)
  const [rendered, setRendered] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [exportError, setExportError] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const selectedPeriod = result.snapshots.some((item) => item.period === period)
    ? period
    : (result.snapshots[result.snapshots.length - 1]?.period ?? 0)
  const spatial = useMemo(() => {
    try {
      return {
        collection: castorSpatialGeoJson(project, result, selectedPeriod, metric),
        landings: castorLandingsGeoJson(project, result, selectedPeriod),
        error: '',
      }
    } catch (cause: unknown) {
      return {
        collection: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        landings: { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection,
        error: cause instanceof Error ? cause.message : 'The spatial output could not be prepared.',
      }
    }
  }, [project, result, selectedPeriod, metric])
  const { collection, landings } = spatial
  const polygons = useMemo(
    () => ({
      ...collection,
      features: collection.features.filter(
        (feature) => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon',
      ),
    }),
    [collection],
  )
  const points = useMemo(
    () => ({ ...collection, features: collection.features.filter((feature) => feature.geometry.type === 'Point') }),
    [collection],
  )
  const boundsValue = collectionBounds(collection)
  const boundsKey = boundsValue?.join(',') ?? ''
  const bounds = useMemo(
    () => (boundsKey ? (boundsKey.split(',').map(Number) as [number, number, number, number]) : null),
    [boundsKey],
  )
  const values = collection.features
    .map((feature) => feature.properties?.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const minimum = values.reduce((value, next) => Math.min(value, next), Infinity)
  const maximum = values.reduce((value, next) => Math.max(value, next), -Infinity)
  const selectedFeature = collection.features.find((feature) => Number(feature.properties?.id) === selected)
  const details = METRICS.find((entry) => entry.value === metric) ?? METRICS[0]
  const color: unknown[] =
    values.length === 0
      ? ['literal', '#94a3b8']
      : [
          'case',
          ['==', ['get', 'value'], null],
          '#94a3b8',
          [
            'interpolate',
            ['linear'],
            ['to-number', ['get', 'value']],
            minimum,
            '#d1fae5',
            maximum > minimum ? maximum : minimum + 1,
            '#065f46',
          ],
        ]
  if (spatial.error)
    return (
      <InlineAlert tone="warning" title="Spatial output unavailable">
        {spatial.error} Tabular reports remain available.
      </InlineAlert>
    )
  if (!collection.features.length)
    return (
      <InlineAlert title="No spatial grid attached">
        This scenario can produce tabular results, but its inputs do not provide a complete georeferenced pixel grid.
        Supply the grid's origin, cell size, projected CRS and each pixel's gridIndex to view or export spatial results.
      </InlineAlert>
    )
  return (
    <Section
      title="Spatial results"
      description={
        project.provenance.synthetic
          ? 'Synthetic grid and forest conditions. The displayed location is illustrative and does not describe an observed forest.'
          : `Local scenario grid · ${project.grid?.crs ?? 'supplied coordinates'} · displayed in geographic coordinates.`
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField
          label="Map period"
          value={selectedPeriod}
          onChange={(event) => setPeriod(Number(event.target.value))}
        >
          {result.snapshots.map((snapshot) => (
            <option key={snapshot.period} value={snapshot.period}>
              {snapshot.period === 0 ? 'Initial forest' : `Period ${snapshot.period}`} · {snapshot.year}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Map output"
          value={metric}
          onChange={(event) => setMetric(event.target.value as CastorMetric)}
        >
          {METRICS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end">
          <ToggleRow
            active={landingsVisible}
            label={`Candidate landings (${landings.features.length})`}
            onClick={() => setLandingsVisible(!landingsVisible)}
          />
        </div>
      </div>
      <div
        className="relative h-[420px] overflow-hidden rounded-lg border sm:h-[540px]"
        aria-label="Castor spatial results map"
        data-testid="castor-map"
      >
        <Map
          center={bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [-122.75, 53.9]}
          zoom={12}
          styles={{ light: LOCAL_STYLE, dark: LOCAL_STYLE }}
        >
          <MapFillLayer
            data={polygons}
            sourceKey="castor-pixels"
            fillColor={color as never}
            fillOpacity={0.9}
            lineColor="#547567"
            lineWidth={0.5}
            idProperty="id"
            selectedId={selected}
            onFeatureClick={(id) => setSelected(Number(id))}
            hoverHtml={(properties) =>
              `<strong>Pixel ${escapeHtml(properties.pixelId)}</strong><br>Block ${escapeHtml(properties.blockId)}<br>${escapeHtml(details.label)}: ${properties.value === null ? 'Not recorded' : escapeHtml(number(Number(properties.value), 2))} ${escapeHtml(details.unit)}`
            }
          />
          <MapCircleLayer
            data={points}
            sourceKey="castor-pixels"
            color={color as never}
            radius={5}
            strokeColor="#547567"
            strokeWidth={0.5}
            selectedId={selected}
            onFeatureClick={(id) => setSelected(Number(id))}
          />
          <MapCircleLayer
            data={landings}
            color="#c2410c"
            radius={5}
            strokeColor="#ffffff"
            strokeWidth={1.5}
            visible={landingsVisible}
            hoverHtml={(properties) =>
              `<strong>Candidate landing</strong><br>Block ${escapeHtml(properties.blockId)}<br>Year ${escapeHtml(properties.year)}`
            }
          />
          <MapEvidence bounds={bounds} fitNonce={fitNonce} onRendered={setRendered} />
        </Map>
        <div className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm">
          <strong className="block">{details.label}</strong>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-3 w-24 rounded bg-gradient-to-r from-emerald-100 to-emerald-800" />
            <span>{values.length ? `${number(minimum, 1)}–${number(maximum, 1)} ${details.unit}` : 'No values'}</span>
          </div>
          <p className="mt-1 text-muted-foreground">Grey: not recorded · Orange: candidate landing</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="castor-map-rendered">
          {number(rendered)} pixels drawn in view · {number(collection.features.length)} total
        </span>
        <Button variant="ghost" size="sm" onClick={() => setFitNonce((value) => value + 1)}>
          <Scan className="size-4" /> Fit grid
        </Button>
      </div>
      {selectedFeature && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
          <strong>Pixel {String(selectedFeature.properties?.pixelId)}</strong> · Block{' '}
          {String(selectedFeature.properties?.blockId)} · {details.label}:{' '}
          {selectedFeature.properties?.value === null
            ? 'Not recorded'
            : `${number(Number(selectedFeature.properties?.value), 3)} ${details.unit}`}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadText(
              JSON.stringify(collection),
              `castor-${metric}-period-${selectedPeriod}.geojson`,
              'application/geo+json',
            )
          }
        >
          <Download className="size-4" /> Download map GeoJSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={exportBusy || !project.grid}
          onClick={async () => {
            setExportBusy(true)
            setExportError('')
            try {
              downloadBlob(
                await castorGeoTiff(project, result, selectedPeriod, metric),
                `castor-${metric}-period-${selectedPeriod}.tif`,
              )
            } catch (cause: unknown) {
              setExportError(cause instanceof Error ? cause.message : 'The raster could not be exported.')
            } finally {
              setExportBusy(false)
            }
          }}
        >
          <Download className="size-4" /> {exportBusy ? 'Writing raster…' : 'Download GeoTIFF'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!landings.features.length}
          onClick={() =>
            downloadText(
              JSON.stringify(landings),
              `castor-landings-period-${selectedPeriod}.geojson`,
              'application/geo+json',
            )
          }
        >
          <Download className="size-4" /> Download landing points
        </Button>
      </div>
      {exportError && (
        <InlineAlert tone="error" className="mt-3">
          {exportError}
        </InlineAlert>
      )}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        GeoTIFF keeps the source grid, projected CRS and no-data cells. The interactive view uses projected cell
        polygons transformed for map display. Candidate landings require a separate access and engineering assessment.
      </p>
    </Section>
  )
}
