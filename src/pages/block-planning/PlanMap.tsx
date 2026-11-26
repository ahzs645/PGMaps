import { useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson'
import type { StyleSpecification } from 'maplibre-gl'
import { fitMapToPoints } from '@pgmaps/geo-toolkit/map/map-fit'
import { Map, useMap } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { HANDOFF_NOTE_DELAY_MS } from '@/components/ui/map-raster-handoff'
import { LegendItem, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { MapSketch, type MapSketchController } from '@/components/ui/map-sketch'
import { WORKSPACE_MAP_CONTROLS } from '@pgmaps/geo-toolkit/map/map-controls'
import { bins, table } from '../forest-patches/project'
import { CLASS_COLOURS, MAP_COLOURS, OLD_FOREST_COLOURS, UNCLASSIFIED_COLOUR } from './colors'
import { DRAWN_KINDS, DRAWN_LABELS, MAP_SIMPLIFY_METRES, type DrawnKind } from './oldForest/drawing'
import { entryOf, shapeOf, type Plan } from './plan'
import type { OldForestMap } from './useOldForestMap'

const offline: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce5df' } }],
}
const OFFLINE_STYLES = { light: offline, dark: offline }
const PRINCE_GEORGE: [number, number] = [-122.75, 53.92]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const haFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** How each old forest kind is drawn: a fill, an outline only (D.1), or a line (corridors). */
const OLD_FOREST_LOOK: Record<DrawnKind, { fill: number; line: number; width: number }> = {
  excluded: { fill: 0.3, line: 0.8, width: 1 },
  'edge-band': { fill: 0.22, line: 0, width: 0 },
  'old-edge': { fill: 0.55, line: 0, width: 0 },
  'old-narrow': { fill: 0.6, line: 0, width: 0 },
  interior: { fill: 0.62, line: 0, width: 0 },
  younger: { fill: 0.45, line: 0.9, width: 1 },
  counted: { fill: 0, line: 1, width: 2 },
  corridor: { fill: 0, line: 1, width: 2 },
}

/**
 * The old forest layer: every kind on one source, so a new year or schedule replaces them all in
 * one `setData`, never one kind before another. Mounted first, under the plan's own layers.
 */
function OldForestLayers({ oldForest }: { oldForest: OldForestMap | null }) {
  const data = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (oldForest?.drawing?.features ?? []).map((f, i) => ({
        type: 'Feature',
        id: i,
        geometry: f.geometry,
        properties: { kind: f.kind, unit: f.unit },
      })),
    }),
    [oldForest?.drawing],
  )
  return (
    <>
      {DRAWN_KINDS.map((kind) => (
        <MapFillLayer
          key={kind}
          data={data}
          sourceKey="planning-old-forest"
          filter={['==', ['get', 'kind'], kind] as never}
          fillColor={OLD_FOREST_COLOURS[kind]}
          fillOpacity={OLD_FOREST_LOOK[kind].fill}
          lineColor={OLD_FOREST_COLOURS[kind]}
          lineWidth={OLD_FOREST_LOOK[kind].width}
          lineOpacity={OLD_FOREST_LOOK[kind].line}
          interactive={false}
          visible={!!oldForest?.drawing}
        />
      ))}
    </>
  )
}

/** The old forest rows of the legend: what is drawn, its hectares, and whether the map has caught up. */
function OldForestLegend({ oldForest, schedules }: { oldForest: OldForestMap; schedules: Record<string, string> }) {
  const { drawing, pending, note, disagrees } = oldForest
  // As the hand-off's note: a quick redraw says nothing; one that keeps the old year up says so.
  const [late, setLate] = useState(false)
  if (!pending && late) setLate(false)
  const waitingFor = pending ? `${pending.schedule}|${pending.year}` : null
  useEffect(() => {
    if (!waitingFor) return
    const timer = setTimeout(() => setLate(true), HANDOFF_NOTE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [waitingFor])
  const drawnHa = (kind: DrawnKind) => drawing?.units.reduce((s, u) => s + (u.drawnHa[kind] ?? 0), 0) ?? 0
  const kinds = DRAWN_KINDS.filter((k) => drawing?.features.some((f) => f.kind === k))
  return (
    <div className="mt-2 space-y-1" data-testid="block-planning-old-forest-legend">
      <p className="text-2xs text-muted-foreground">
        Old forest
        {drawing
          ? ` · ${schedules[drawing.schedule] ?? drawing.schedule} · ${drawing.year} · ${drawing.units.map((u) => u.unit).join(' + ')}`
          : ''}
      </p>
      {kinds.map((kind) => (
        <LegendItem
          key={kind}
          color={OLD_FOREST_COLOURS[kind]}
          swatchShape={kind === 'corridor' || kind === 'counted' ? 'line' : 'square'}
          label={DRAWN_LABELS[kind]}
          value={
            kind === 'corridor' ? undefined : drawnHa(kind) < 0.5 ? '< 1 ha' : `${haFormat.format(drawnHa(kind))} ha`
          }
        />
      ))}
      {pending && (late || !drawing) && (
        <p className="text-2xs text-warning" role="status" data-testid="block-planning-old-forest-pending">
          {drawing
            ? `The map still shows ${schedules[drawing.schedule] ?? drawing.schedule}, ${drawing.year}. ${pending.progress}`
            : pending.progress}
        </p>
      )}
      {note && <p className="text-2xs text-muted-foreground">{note}</p>}
      {disagrees && <p className="text-2xs text-warning">{disagrees}</p>}
      {drawing && (
        <p className="text-2xs text-muted-foreground">
          An edge is a young stand, a reset or a corridor as the{' '}
          {drawing.method === '2004' ? '2004 method (anything younger than old)' : '2005 method'} draws it; too narrow
          is old forest away from edges but 200 m wide or less. Hectares of ground drawn, measured before the shapes
          were simplified by {MAP_SIMPLIFY_METRES} m for display
          {drawing.units.length > 1 ? '; each unit is drawn as it is calculated alone' : ''}. The figures are the
          panel’s.
        </p>
      )}
    </div>
  )
}

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
  /** The old forest layer (`useOldForestMap`); null while it is off. */
  oldForest?: OldForestMap | null
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
  oldForest = null,
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
        <OldForestLayers oldForest={oldForest} />
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
          hoverHtml={(p) => mapTooltipHtml({ title: String(p.name), lines: [String(p.year)] })}
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
          hoverHtml={(p) => mapTooltipHtml({ title: String(p.name), lines: [`Cut ${String(p.year)}`] })}
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
          hoverHtml={(p) => mapTooltipHtml({ title: String(p.name), lines: [`Cut ${String(p.year)}`] })}
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
          hoverHtml={(p) => mapTooltipHtml({ title: String(p.name), lines: ['Not cut in this schedule'] })}
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
        {oldForest && (
          <OldForestLegend
            oldForest={oldForest}
            schedules={Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))}
          />
        )}
      </MapLegendPanel>
    </div>
  )
}
