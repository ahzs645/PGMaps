import { useEffect, useMemo } from 'react'
import { Map, MapControls, MapScaleBar, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { LegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { slopeClassLabel } from './slope'

export type MapView = 'density' | 'slope' | 'coverage'

/** m³/ha classes shared by the piece layer and its legend. */
export const DENSITY_STEPS: Array<{ min: number; color: string; label: string }> = [
  { min: 0, color: '#f1f5f9', label: '0' },
  { min: 1, color: '#d9f0d3', label: '1–100' },
  { min: 100, color: '#a6dba0', label: '100–150' },
  { min: 150, color: '#5aae61', label: '150–200' },
  { min: 200, color: '#1b7837', label: '200–300' },
  { min: 300, color: '#00441b', label: '300+' },
]
export const SLOPE_COLORS = { 1: '#1a9850', 2: '#f59e0b', 3: '#d73027' } as const
export const COVERAGE_COLORS = {
  good: '#15803d', moderate: '#ca8a04', low: '#ea580c', none: '#b91c1c', pending: '#94a3b8', lidar: '#7c3aed',
} as const

const densityColor: unknown[] = ['step', ['coalesce', ['get', 'density'], 0], DENSITY_STEPS[0].color,
  ...DENSITY_STEPS.slice(1).flatMap((step) => [step.min, step.color])]

export type AvastMapProps = {
  candidates: GeoJSON.FeatureCollection
  pieces: GeoJSON.FeatureCollection
  slope: GeoJSON.FeatureCollection
  context: GeoJSON.FeatureCollection
  bounds: [number, number, number, number] | null
  focus: [number, number, number, number] | null
  view: MapView
  onViewChange: (view: MapView) => void
  selectedKey: string | null
  onSelect: (key: string | null) => void
  slopeBreaks: [number, number]
  slopeAvailable: boolean
}

function CameraFit({ bounds, focus }: { bounds: AvastMapProps['bounds']; focus: AvastMapProps['focus'] }) {
  const { map, isLoaded } = useMap()
  const key = bounds?.join(',')
  useEffect(() => {
    if (!map || !isLoaded || !bounds) return
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60, duration: 600, maxZoom: 14 })
    // Refit only when the candidate set changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, key])
  const focusKey = focus?.join(',')
  useEffect(() => {
    if (!map || !isLoaded || !focus) return
    map.fitBounds([[focus[0], focus[1]], [focus[2], focus[3]]], { padding: 120, duration: 600, maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, focusKey])
  return null
}

const number = (value: unknown, digits = 0) =>
  typeof value === 'number' ? value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—'

export function AvastMap(props: AvastMapProps) {
  const { view, slopeBreaks } = props
  const candidateFill = useMemo<unknown>(() => view === 'coverage'
    ? ['match', ['get', 'state'],
        'good', COVERAGE_COLORS.good, 'moderate', COVERAGE_COLORS.moderate, 'low', COVERAGE_COLORS.low,
        'none', COVERAGE_COLORS.none, 'lidar', COVERAGE_COLORS.lidar, COVERAGE_COLORS.pending]
    : ['match', ['get', 'state'], 'current', '#38bdf8', 'pending', '#94a3b8', '#ffffff'], [view])
  const candidateOpacity = view === 'coverage' ? 0.55 : (['match', ['get', 'state'], 'current', 0.45, 'pending', 0.25, 0.02] as unknown)
  const legend = view === 'density'
    ? DENSITY_STEPS.map((step) => <LegendItem key={step.label} color={step.color} label={`${step.label} m³/ha`} swatchShape="square" />)
    : view === 'slope'
      ? ([1, 2, 3] as const).map((slopeClass) => <LegendItem key={slopeClass} color={SLOPE_COLORS[slopeClass]} label={`${slopeClassLabel(slopeClass, slopeBreaks)} slope`} swatchShape="square" />)
      : ([['good', 'Good AVAST coverage'], ['moderate', 'Moderate'], ['low', 'Low'], ['none', 'Little/no'], ['lidar', 'Direct LiDAR'], ['pending', 'Not processed yet']] as const)
          .map(([key, label]) => <LegendItem key={key} color={COVERAGE_COLORS[key]} label={label} swatchShape="square" />)

  return (
    <Map center={[-123.4, 54.2]} zoom={6} controls={<MapControls showCompass showFullscreen />}>
      <CameraFit bounds={props.bounds} focus={props.focus} />
      <MapFillLayer
        data={props.context}
        fillColor={densityColor as never}
        fillOpacity={0.18}
        lineColor="#64748b"
        lineWidth={0.3}
        lineOpacity={0.35}
        visible={view === 'density'}
        hoverHtml={(properties) => mapTooltipHtml({ title: 'AVAST polygon', rows: [['m³/ha', number(properties.density, 1)]] })}
      />
      <MapFillLayer
        data={props.pieces}
        fillColor={densityColor as never}
        fillOpacity={0.85}
        lineColor="#0f172a"
        lineWidth={0.4}
        lineOpacity={0.5}
        visible={view === 'density'}
        hoverHtml={(properties) => mapTooltipHtml({
          title: String(properties.blockId || 'Piece'),
          subtitle: 'Block ∩ AVAST piece',
          rows: [
            ['m³/ha', number(properties.density, 1)],
            ['Piece area', `${number(properties.areaHa, 2)} ha`],
            ['Piece volume', `${number(properties.volume)} m³`],
          ],
        })}
      />
      <MapFillLayer
        data={props.slope}
        fillColor={['match', ['get', 'slopeClass'], 1, SLOPE_COLORS[1], 2, SLOPE_COLORS[2], 3, SLOPE_COLORS[3], '#cbd5e1'] as never}
        fillOpacity={0.75}
        lineWidth={0.2}
        lineOpacity={0.3}
        visible={view === 'slope'}
        hoverHtml={(properties) => mapTooltipHtml({
          title: String(properties.blockId || 'Slope class'),
          rows: [
            ['Slope', typeof properties.slopeClass === 'number' ? slopeClassLabel(properties.slopeClass as 1 | 2 | 3, slopeBreaks) : 'No data'],
            ['Area', properties.areaHa === undefined ? null : `${number(properties.areaHa, 2)} ha`],
            ['Volume', properties.volume === undefined ? null : `${number(properties.volume)} m³`],
          ],
        })}
      />
      <MapFillLayer
        data={props.candidates}
        fillColor={candidateFill as never}
        fillOpacity={candidateOpacity as never}
        // Fuchsia reads on both basemap themes and stays clear of the green m³/ha ramp.
        lineColor={['match', ['get', 'state'], 'current', '#0284c7', '#d946ef'] as never}
        // Blocks are a few pixels wide at the overview zoom; a heavier outline there keeps them findable.
        lineWidth={['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'state'], 'current', 5, 3.5], 12, ['match', ['get', 'state'], 'current', 3, 1.6]] as never}
        lineOpacity={0.9}
        idProperty="key"
        selectedId={props.selectedKey}
        onFeatureClick={(id) => props.onSelect(id === props.selectedKey ? null : id)}
        hoverHtml={(properties) => mapTooltipHtml({
          title: String(properties.blockId || '(no Block ID)'),
          subtitle: String(properties.operatingArea || ''),
          rows: [
            ['Merch area', `${number(properties.grossHa, 1)} ha`],
            ['AVAST coverage', properties.coveragePct === undefined ? null : `${number(properties.coveragePct, 1)}%`],
            ['Volume', properties.volume === undefined ? null : `${number(properties.volume)} m³`],
          ],
        })}
      />
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
        <div className="pointer-events-auto rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur">
          <SegmentedControl
            label="Map colours"
            value={view}
            onChange={props.onViewChange}
            options={[
              { value: 'density', label: 'm³/ha' },
              { value: 'slope', label: 'Slope class', disabled: !props.slopeAvailable },
              { value: 'coverage', label: 'Coverage' },
            ]}
          />
        </div>
      </div>
      <div className="absolute bottom-10 right-3 z-10">
        <MapLegendPanel title={view === 'density' ? 'AVAST volume density' : view === 'slope' ? 'Slope class' : 'Block status'} defaultCollapsed="mobile" collapsible width="sm">
          <div className="space-y-1">{legend}</div>
        </MapLegendPanel>
      </div>
      <MapScaleBar position="bottom-left" />
    </Map>
  )
}
