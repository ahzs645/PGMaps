import { useEffect } from 'react'
import { Map, MapControls, MapScaleBar, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { LegendItem, MapLegendPanel, ToggleChip } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { slopeClassLabel } from './slope'

export type MapView = 'density' | 'slope' | 'coverage'

/** m³/ha classes shared by the piece layers and their legend. */
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
  good: '#15803d',
  moderate: '#ca8a04',
  low: '#ea580c',
  none: '#b91c1c',
  pending: '#94a3b8',
  lidar: '#7c3aed',
} as const
/** Block outline: fuchsia reads on both basemap themes and stays clear of the green m³/ha ramp. */
const BLOCK = '#d946ef'
const BLOCK_DIM = 'rgba(217, 70, 239, 0.35)'
const CURRENT = '#0284c7'
const HIGHLIGHT = '#facc15'
const VRI_EDGE = '#f97316'

const densityColor: unknown[] = [
  'step',
  ['coalesce', ['get', 'density'], 0],
  DENSITY_STEPS[0].color,
  ...DENSITY_STEPS.slice(1).flatMap((step) => [step.min, step.color]),
]

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
  /** VRI pieces filling AVAST's gaps (what-if only), drawn over the m³/ha and slope views when `showVri`. */
  vriFill: GeoJSON.FeatureCollection
  showVri: boolean
  onShowVriChange: (show: boolean) => void
  /** Outline blocks whose `flagged` property is true in yellow and dim the rest. */
  highlight: boolean
  highlightLabel: string
}

function CameraFit({ bounds, focus }: { bounds: AvastMapProps['bounds']; focus: AvastMapProps['focus'] }) {
  const { map, isLoaded } = useMap()
  const key = bounds?.join(',')
  useEffect(() => {
    if (!map || !isLoaded || !bounds) return
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 60, duration: 600, maxZoom: 14 },
    )
    // Refit only when the candidate set changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, key])
  const focusKey = focus?.join(',')
  useEffect(() => {
    if (!map || !isLoaded || !focus) return
    map.fitBounds(
      [
        [focus[0], focus[1]],
        [focus[2], focus[3]],
      ],
      { padding: 120, duration: 600, maxZoom: 15 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, focusKey])
  return null
}

const number = (value: unknown, digits = 0) =>
  typeof value === 'number'
    ? value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : null
const m3 = (value: unknown) => (typeof value === 'number' ? `${number(value)} m³` : null)

/** A zoom ramp whose stops can differ per feature: thin zoomed out, full width zoomed in. */
const byZoom = (zoomedOut: unknown, zoomedIn: unknown) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  7,
  zoomedOut,
  12,
  zoomedIn,
]

export function AvastMap(props: AvastMapProps) {
  const { view, slopeBreaks, highlight } = props
  const isCurrent = ['==', ['get', 'state'], 'current']
  const isFlagged = ['==', ['get', 'flagged'], true]
  // Zoomed out a block is a few pixels across: a light fill at its true shape
  // finds it, where a thick outline swells it into a blob.
  const candidateFill =
    view === 'coverage'
      ? [
          'match',
          ['get', 'state'],
          'good',
          COVERAGE_COLORS.good,
          'moderate',
          COVERAGE_COLORS.moderate,
          'low',
          COVERAGE_COLORS.low,
          'none',
          COVERAGE_COLORS.none,
          'lidar',
          COVERAGE_COLORS.lidar,
          COVERAGE_COLORS.pending,
        ]
      : [
          'case',
          isCurrent,
          '#38bdf8',
          ...(highlight ? [isFlagged, HIGHLIGHT] : []),
          ['==', ['get', 'state'], 'pending'],
          '#94a3b8',
          BLOCK,
        ]
  const candidateOpacity = view === 'coverage' ? 0.55 : ['interpolate', ['linear'], ['zoom'], 7, 0.6, 10, 0.3, 12, 0.04]
  const lineColor = ['case', isCurrent, CURRENT, ...(highlight ? [isFlagged, HIGHLIGHT, BLOCK_DIM] : [BLOCK])]
  const lineWidth = byZoom(
    ['case', isCurrent, 2.5, ...(highlight ? [isFlagged, 2] : []), 0.6],
    ['case', isCurrent, 3, ...(highlight ? [isFlagged, 3.5] : []), 1.6],
  )
  const vriVisible = props.showVri && view !== 'coverage' && props.vriFill.features.length > 0

  const legend =
    view === 'density'
      ? DENSITY_STEPS.map((step) => (
          <LegendItem key={step.label} color={step.color} label={`${step.label} m³/ha`} swatchShape="square" />
        ))
      : view === 'slope'
        ? ([1, 2, 3] as const).map((slopeClass) => (
            <LegendItem
              key={slopeClass}
              color={SLOPE_COLORS[slopeClass]}
              label={`${slopeClassLabel(slopeClass, slopeBreaks)} slope`}
              swatchShape="square"
            />
          ))
        : (
            [
              ['good', 'Good AVAST coverage'],
              ['moderate', 'Moderate'],
              ['low', 'Low'],
              ['none', 'Little/no'],
              ['lidar', 'Direct LiDAR'],
              ['pending', 'Not processed yet'],
            ] as const
          ).map(([key, label]) => (
            <LegendItem key={key} color={COVERAGE_COLORS[key]} label={label} swatchShape="square" />
          ))

  return (
    <Map center={[-123.4, 54.2]} zoom={6} controls={<MapControls showCompass showFullscreen />}>
      <CameraFit bounds={props.bounds} focus={props.focus} />
      {/* Only the block layer has a hover card: every layer under the pointer would otherwise open its own. */}
      <MapFillLayer
        data={props.context}
        fillColor={densityColor as never}
        fillOpacity={0.18}
        lineColor="#64748b"
        lineWidth={0.3}
        lineOpacity={0.35}
        visible={view === 'density'}
      />
      <MapFillLayer
        data={props.pieces}
        fillColor={densityColor as never}
        fillOpacity={0.85}
        lineColor="#0f172a"
        lineWidth={0.4}
        lineOpacity={0.5}
        visible={view === 'density'}
      />
      <MapFillLayer
        data={props.slope}
        fillColor={
          [
            'match',
            ['get', 'slopeClass'],
            1,
            SLOPE_COLORS[1],
            2,
            SLOPE_COLORS[2],
            3,
            SLOPE_COLORS[3],
            '#cbd5e1',
          ] as never
        }
        fillOpacity={0.75}
        lineWidth={0.2}
        lineOpacity={0.3}
        visible={view === 'slope'}
      />
      {/* Orange edges set VRI fill apart from AVAST pieces drawn on the same ramp. */}
      <MapFillLayer
        data={props.vriFill}
        fillColor={densityColor as never}
        fillOpacity={0.85}
        lineColor={VRI_EDGE}
        lineWidth={1.4}
        lineOpacity={0.9}
        visible={vriVisible}
      />
      <MapFillLayer
        data={props.candidates}
        fillColor={candidateFill as never}
        fillOpacity={candidateOpacity as never}
        lineColor={lineColor as never}
        lineWidth={lineWidth as never}
        lineOpacity={0.95}
        idProperty="key"
        selectedId={props.selectedKey}
        onFeatureClick={(id) => props.onSelect(id === props.selectedKey ? null : id)}
        hoverHtml={(p) =>
          mapTooltipHtml({
            title: String(p.blockId || '(no Block ID)'),
            subtitle: String(p.operatingArea || ''),
            rows: [
              ['Merch area', p.grossHa === undefined ? null : `${number(p.grossHa, 1)} ha`],
              ['AVAST coverage', p.coveragePct === undefined ? null : `${number(p.coveragePct, 1)}%`],
              ['AVAST volume', m3(p.volume)],
              ...(view === 'slope' && typeof p.class1 === 'number'
                ? ([
                    [`${slopeClassLabel(1, slopeBreaks)} slope`, m3(p.class1)],
                    [`${slopeClassLabel(2, slopeBreaks)} slope`, m3(p.class2)],
                    [`${slopeClassLabel(3, slopeBreaks)} slope`, m3(p.class3)],
                  ] as Array<[string, string | null]>)
                : []),
              ...(vriVisible && typeof p.vriFill === 'number'
                ? ([
                    ['+ VRI fill', m3(p.vriFill)],
                    ['With VRI', `${m3(p.withVri)} · ${number(p.m3haWithVri)} m³/ha`],
                    ['Coverage with VRI', `${number(p.coverageWithVri, 1)}%`],
                  ] as Array<[string, string | null]>)
                : []),
            ],
            footer: highlight && p.flagged === true ? props.highlightLabel : undefined,
          })
        }
      />
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur">
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
          {props.vriFill.features.length > 0 && (
            <ToggleChip
              active={props.showVri}
              onClick={() => props.onShowVriChange(!props.showVri)}
              tone="orange"
              className="whitespace-nowrap"
              title="Draw the VRI what-if fill over the m³/ha and slope views"
            >
              VRI fill
            </ToggleChip>
          )}
        </div>
      </div>
      <div className="absolute bottom-10 right-3 z-10">
        <MapLegendPanel
          title={view === 'density' ? 'AVAST volume density' : view === 'slope' ? 'Slope class' : 'Block status'}
          defaultCollapsed="mobile"
          collapsible
          width="sm"
        >
          <div className="space-y-1">
            {legend}
            {vriVisible && <LegendItem color={VRI_EDGE} label="VRI fill (what-if)" swatchShape="line" />}
            {highlight && <LegendItem color={HIGHLIGHT} label={props.highlightLabel} swatchShape="line" />}
          </div>
        </MapLegendPanel>
      </div>
      <MapScaleBar position="bottom-left" />
    </Map>
  )
}
