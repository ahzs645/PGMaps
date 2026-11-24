import { useEffect, useMemo, useRef } from 'react'
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type { StyleSpecification } from 'maplibre-gl'
import { fitMapToPoints } from '@pgmaps/geo-toolkit/map/map-fit'
import { Map, useMap } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { LegendItem, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { MapSketch, type MapSketchController } from '@/components/ui/map-sketch'
import { WORKSPACE_MAP_CONTROLS } from '@pgmaps/geo-toolkit/map/map-controls'
import { bins, table } from '../forest-patches/project'
import { CLASS_COLOURS, MAP_COLOURS, UNCLASSIFIED_COLOUR } from './colors'
import { entryOf, shapeOf, type Plan } from './plan'

const offline: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce5df' } }],
}
const OFFLINE_STYLES = { light: offline, dark: offline }
const PRINCE_GEORGE: [number, number] = [-122.75, 53.92]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

type BlockState = 'cut' | 'later' | 'uncut'

/** Every corner of every shape in the plan, for framing it. */
function planPoints(plan: Plan): [number, number][] {
  const shapes = [
    ...(plan.area.unit ? [plan.area.unit.geometry] : []),
    ...plan.baseline.map((d) => d.geometry),
    ...plan.blocks.flatMap((b) => b.shapes.map((s) => s.geometry)),
  ]
  const points: [number, number][] = []
  for (const g of shapes) {
    const polygons: Position[][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    for (const poly of polygons) for (const [x, y] of poly[0]) points.push([x, y])
  }
  return points
}

/** Frames the plan when `fitKey` changes (opening a plan, Fit to plan); never on an edit. */
function FitToPlan({ plan, fitKey }: { plan: Plan; fitKey: number }) {
  const { map, isLoaded } = useMap()
  const fitted = useRef<number | null>(null)
  useEffect(() => {
    if (!map || !isLoaded || fitted.current === fitKey) return
    if (fitMapToPoints(map, planPoints(plan), { padding: 48, maxZoom: 15, duration: 0, minSpan: 0.005 }))
      fitted.current = fitKey
  }, [map, isLoaded, fitKey, plan])
  return null
}

export interface PlanMapProps {
  plan: Plan
  /** The schedule and year drawn. */
  schedule: string
  year: number
  patches: Feature<MultiPolygon>[] | undefined
  selectedBlock: string | null
  onSelectBlock: (id: string) => void
  sketch: MapSketchController
  /** What the sketch is drawing, for its colour. */
  drawing: 'block' | 'shape' | 'disturbance' | null
  fitKey: number
}

/**
 * The plan on the map for one schedule and year: past disturbances, the blocks (cut by then,
 * cut later, or not cut in this schedule), the young-forest patches of that year coloured by size
 * class, and riparian zones. Clicking a block selects it.
 */
export function PlanMap({
  plan,
  schedule,
  year,
  patches,
  selectedBlock,
  onSelectBlock,
  sketch,
  drawing,
  fitKey,
}: PlanMapProps) {
  const blocks = useMemo<FeatureCollection<Polygon | MultiPolygon>>(
    () => ({
      type: 'FeatureCollection',
      features: plan.blocks.map((block) => {
        const entry = entryOf(plan, schedule, block.id)
        const state: BlockState = entry.year === null ? 'uncut' : entry.year <= year ? 'cut' : 'later'
        return {
          type: 'Feature',
          geometry: shapeOf(block, entry).geometry,
          properties: { id: block.id, name: block.name, state, year: entry.year },
        }
      }),
    }),
    [plan, schedule, year],
  )
  const baseline = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: plan.baseline.map((d) => ({
        type: 'Feature',
        geometry: d.geometry,
        properties: { id: d.id, name: d.name, year: d.year },
      })),
    }),
    [plan.baseline],
  )
  const patchLayer = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (patches ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, bin: f.properties?.bin ?? 'none' },
      })),
    }),
    [patches],
  )
  const unitOutline = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: plan.area.unit ? [{ type: 'Feature', geometry: plan.area.unit.geometry, properties: {} }] : [],
    }),
    [plan.area.unit],
  )
  const zones = (plan.zones?.layer as FeatureCollection | undefined) ?? EMPTY
  const classColour = [
    'match',
    ['get', 'bin'],
    ...bins.flatMap((bin) => [bin, CLASS_COLOURS[bin]]),
    UNCLASSIFIED_COLOUR,
  ]
  const sketchColour = drawing === 'disturbance' ? MAP_COLOURS.disturbance : MAP_COLOURS.block
  const later = (state: BlockState) => ['==', ['get', 'state'], state]
  return (
    <div className="relative h-full min-h-0 w-full" data-testid="block-planning-map">
      <Map
        center={PRINCE_GEORGE}
        zoom={9}
        fallbackStyles={OFFLINE_STYLES}
        styleTimeoutMs={4000}
        controls={WORKSPACE_MAP_CONTROLS}
      >
        <MapFillLayer
          data={patchLayer}
          sourceKey="planning-patches"
          fillColor={classColour as never}
          fillOpacity={0.4}
          lineColor={classColour as never}
          lineWidth={1.5}
          interactive={false}
        />
        <MapFillLayer
          data={baseline}
          sourceKey="planning-baseline"
          fillColor={MAP_COLOURS.disturbance}
          fillOpacity={0.12}
          lineColor={MAP_COLOURS.disturbance}
          lineWidth={1}
          hoverHtml={(p) => `${String(p.name)} · ${String(p.year)}`}
        />
        <MapFillLayer
          data={blocks}
          sourceKey="planning-blocks"
          filter={later('cut') as never}
          fillColor={MAP_COLOURS.block}
          fillOpacity={0.12}
          lineColor={MAP_COLOURS.block}
          lineWidth={3}
          selectedId={selectedBlock}
          onFeatureClick={(id) => onSelectBlock(String(id))}
          hoverHtml={(p) => `${String(p.name)} · cut ${String(p.year)}`}
        />
        <MapLineLayer
          data={blocks}
          sourceKey="planning-blocks-later"
          filter={later('later') as never}
          color={MAP_COLOURS.blockLater}
          width={2}
          dashArray={[2, 1.5]}
          selectedId={selectedBlock}
          onFeatureClick={(id) => onSelectBlock(String(id))}
          hoverHtml={(p) => `${String(p.name)} · cut ${String(p.year)}`}
        />
        <MapLineLayer
          data={blocks}
          sourceKey="planning-blocks-uncut"
          filter={later('uncut') as never}
          color={MAP_COLOURS.blockUncut}
          width={1.2}
          dashArray={[1, 2]}
          selectedId={selectedBlock}
          onFeatureClick={(id) => onSelectBlock(String(id))}
          hoverHtml={(p) => `${String(p.name)} · not cut in this schedule`}
        />
        <MapFillLayer
          data={zones}
          sourceKey="planning-zones"
          fillColor={MAP_COLOURS.zone}
          fillOpacity={0.25}
          lineColor={MAP_COLOURS.zone}
          interactive={false}
          visible={!!plan.zones}
        />
        <MapLineLayer
          data={unitOutline}
          sourceKey="planning-unit"
          color={MAP_COLOURS.unit}
          width={2}
          dashArray={[4, 2]}
          interactive={false}
          visible={!!plan.area.unit}
        />
        <MapSketch sketch={sketch} color={sketchColour} testId="block-planning-sketch" />
        <FitToPlan plan={plan} fitKey={fitKey} />
      </Map>
      <MapLegendPanel title={`Map · ${year}`} collapsible defaultCollapsed="mobile" width="md">
        <div className="space-y-1">
          <LegendItem color={MAP_COLOURS.block} swatchShape="square" label="Block cut by this year" />
          <LegendItem color={MAP_COLOURS.blockLater} swatchShape="line" label="Block cut later" />
          <LegendItem color={MAP_COLOURS.blockUncut} swatchShape="line" label="Not cut in this schedule" />
          <LegendItem color={MAP_COLOURS.disturbance} swatchShape="square" label="Past disturbance" />
          {plan.zones && <LegendItem color={MAP_COLOURS.zone} swatchShape="square" label="Mapped riparian zone" />}
          {plan.area.unit && <LegendItem color={MAP_COLOURS.unit} swatchShape="dashed-line" label="Reporting unit" />}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">Young patches by size (ha)</p>
        <MapSteppedLegend
          bands={bins.map((bin, i) => ({ color: CLASS_COLOURS[bin], label: table.labels[i].replace(' ha', '') }))}
        />
      </MapLegendPanel>
    </div>
  )
}
