/**
 * The look the road tool's GIS exports carry into other applications: each exported layer styled
 * with the symbols the plan and the block sheet already draw, read from `styles.ts` and
 * `planSheetSymbols.ts` rather than copied. Roads take the proposed-road symbol in each road's own
 * colour, the context takes its sheet symbol through `contextSheetKey`, and culverts and stations
 * take the plan's colours. The style writers (`src/lib/styleExchange`) turn the document into QGIS,
 * ArcGIS Pro, SLD, MapLibre and GeoLibre files. No DOM or network access.
 */
import {
  LABEL_HALO,
  PROPOSED_ROAD_COLOR,
  proposedRoad,
  ROAD_LABEL,
  EXISTING_ROAD,
} from '@/lib/forestry/blockSheet/styles'
import type { LineSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'
import { STYLE_EXCHANGE_SCHEMA, type StyledLayer, type StyleDocument, type StyleRule } from '@/lib/styleExchange/model'
import { contextSheetKey, isDeactivatedRoad, PLAN_SHEET_SYMBOLS, type PlanSheetKey } from './planSheetSymbols'
import type { ShapeField, ShapeLayer } from './shapefile'
import type { StyleRole } from './styleLibrary'
import type { Coordinate, ContextFeature, RoadProject } from './types'

/** The plan's culvert colour (`PlanView.tsx`, a culvert without warnings). */
export const CULVERT_COLOR = '#0284c7'
/** The plan's station tick colour. */
export const STATION_COLOR = '#1c1917'

const DEACTIVATED_KEY = 'deactivated'

/** An existing road with crosses on it: the two symbols the plan draws one over the other, as one. */
export function deactivatedRoadSymbol(): LineSymbol {
  const deactivation = PLAN_SHEET_SYMBOLS.deactivated as LineSymbol
  return {
    kind: 'line',
    label: 'Deactivated road',
    layers: [...EXISTING_ROAD.detail.layers, ...deactivation.layers],
    markers: [...(EXISTING_ROAD.detail.markers ?? []), ...(deactivation.markers ?? [])],
  }
}

/** The sheet key a context feature is exported with; a deactivated road takes its combined symbol. */
export function contextExportKey(feature: ContextFeature): PlanSheetKey | null {
  const key = contextSheetKey(feature)
  return key === 'existingRoad' && isDeactivatedRoad(feature) ? DEACTIVATED_KEY : key
}

const LINE_KEYS: PlanSheetKey[] = ['stream', 'ncd', 'fsr', 'existingRoad', 'deactivated']
const AREA_KEYS: PlanSheetKey[] = ['constraint', 'otherBlock', 'riparianReserve', 'riparianManagement']

/** Symbols from the browser's style library that replace PGMaps' own, by the feature they draw. */
export type StyleOverrides = Partial<Record<StyleRole, SheetSymbol>>

const symbolFor = (key: PlanSheetKey, overrides: StyleOverrides): SheetSymbol =>
  overrides[key] ?? (key === DEACTIVATED_KEY ? deactivatedRoadSymbol() : PLAN_SHEET_SYMBOLS[key])

const CONTEXT_FIELDS: ShapeField[] = [
  { name: 'NAME', type: 'C', length: 80 },
  { name: 'KIND', type: 'C', length: 20 },
  { name: 'SHEET_KEY', type: 'C', length: 20 },
]

/** Context lines (streams, existing roads) and areas (constraints, other blocks) as shapefile layers. */
export function contextShapefileLayers(context: readonly ContextFeature[]): ShapeLayer[] {
  const attributes = (feature: ContextFeature) => ({
    NAME: feature.name,
    KIND: feature.kind,
    SHEET_KEY: contextExportKey(feature) ?? '',
  })
  const lines = context.filter((f) => f.geometry.type === 'LineString')
  const areas = context.filter((f) => f.geometry.type === 'Polygon')
  const layers: ShapeLayer[] = []
  if (lines.length)
    layers.push({
      name: 'context_lines',
      type: 'polyline',
      fields: CONTEXT_FIELDS,
      features: lines.map((f) => ({
        parts: [(f.geometry as GeoJSON.LineString).coordinates as Coordinate[]],
        attributes: attributes(f),
      })),
    })
  if (areas.length)
    layers.push({
      name: 'context_areas',
      type: 'polygon',
      fields: CONTEXT_FIELDS,
      features: areas.map((f) => ({
        parts: (f.geometry as GeoJSON.Polygon).coordinates as Coordinate[][],
        attributes: attributes(f),
      })),
    })
  return layers
}

const fieldsOf = (layer: ShapeLayer): StyledLayer['fields'] =>
  layer.fields.map((field) => ({ name: field.name, type: field.type === 'N' ? 'number' : 'string' }))

const LAYER_NAMES: Record<string, string> = {
  road_centrelines: 'Road centrelines',
  road_stations: 'Road stations',
  road_culverts: 'Culverts',
  context_lines: 'Streams and existing roads',
  context_areas: 'Constraints and other blocks',
}

/** The sheet-key rules a context layer needs: only keys its features use, in drawing order. */
function contextRules(layer: ShapeLayer, keys: PlanSheetKey[], overrides: StyleOverrides): StyleRule[] {
  const used = new Set(layer.features.map((f) => String(f.attributes.SHEET_KEY ?? '')))
  const rules: StyleRule[] = keys
    .filter((key) => used.has(key))
    .map((key) => {
      const symbol = symbolFor(key, overrides)
      return { label: symbol.label, filter: { field: 'SHEET_KEY', op: 'eq', value: key }, symbol }
    })
  // Features without a sheet key (a review line, an unclassed area) still draw, as the plan's default.
  const fallback: SheetSymbol =
    layer.type === 'polygon'
      ? { kind: 'area', label: 'Other context', outline: [{ color: '#57534e', width: 0.75 }] }
      : { kind: 'line', label: 'Other context', layers: [{ color: '#57534e', width: 0.75 }] }
  return [...rules, { label: fallback.label, filter: null, symbol: fallback }]
}

/**
 * The style document for a set of exported shapefile layers: one styled layer per shapefile, with
 * the roads in their own colours. `roads` are the exported roads, in project order. `overrides`
 * replace the symbols of the features they name; roads keep the proposed-road symbol in their colour.
 */
export function roadExportStyleDocument(
  name: string,
  layers: readonly ShapeLayer[],
  roads: readonly { name: string; color: string }[],
  overrides: StyleOverrides = {},
): StyleDocument {
  const styled: StyledLayer[] = []
  for (const layer of layers) {
    const base = { id: layer.name, name: LAYER_NAMES[layer.name] ?? layer.name, fields: fieldsOf(layer) }
    if (layer.name === 'context_areas')
      styled.push({ ...base, geometry: 'polygon', rules: contextRules(layer, AREA_KEYS, overrides) })
    else if (layer.name === 'context_lines')
      styled.push({ ...base, geometry: 'line', rules: contextRules(layer, LINE_KEYS, overrides) })
    else if (layer.name === 'road_centrelines') {
      const seen = new Set<string>()
      const rules: StyleRule[] = []
      for (const road of roads) {
        if (seen.has(road.name)) continue
        seen.add(road.name)
        rules.push({
          label: road.name,
          filter: { field: 'NAME', op: 'eq', value: road.name },
          symbol: proposedRoad(road.color, 'detail', road.name),
        })
      }
      rules.push({ label: 'Proposed road', filter: null, symbol: proposedRoad(PROPOSED_ROAD_COLOR, 'detail') })
      styled.push({
        ...base,
        geometry: 'line',
        rules,
        label: { field: 'NAME', size: ROAD_LABEL.size, color: ROAD_LABEL.color, halo: LABEL_HALO, placement: 'line' },
      })
    } else if (layer.name === 'road_culverts')
      styled.push({
        ...base,
        geometry: 'line',
        rules: [
          {
            label: 'Culvert',
            filter: null,
            symbol: overrides.culvert ?? {
              kind: 'line',
              label: 'Culvert',
              layers: [{ color: CULVERT_COLOR, width: 3, cap: 'butt' }],
            },
          },
        ],
      })
    else if (layer.name === 'road_stations')
      styled.push({
        ...base,
        geometry: 'point',
        rules: [
          {
            label: 'Station',
            filter: null,
            symbol: overrides.station ?? {
              kind: 'point',
              label: 'Station',
              icon: 'dot',
              size: 2.5,
              color: STATION_COLOR,
            },
          },
        ],
      })
    else
      styled.push({
        ...base,
        geometry: layer.type === 'point' ? 'point' : layer.type === 'polygon' ? 'polygon' : 'line',
        rules: [
          {
            label: base.name,
            filter: null,
            symbol:
              layer.type === 'point'
                ? { kind: 'point', label: base.name, icon: 'dot', size: 4, color: '#57534e' }
                : layer.type === 'polygon'
                  ? { kind: 'area', label: base.name, outline: [{ color: '#57534e', width: 0.75 }] }
                  : { kind: 'line', label: base.name, layers: [{ color: '#57534e', width: 0.75 }] },
          },
        ],
      })
  }
  const points = layers.flatMap((layer) =>
    layer.type === 'point' ? layer.features.map((f) => f.point) : layer.features.flatMap((f) => f.parts.flat()),
  )
  const extent: StyleDocument['extent'] = points.length
    ? [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ]
    : undefined
  // Areas under lines under points, as the plan draws them.
  const order = (layer: StyledLayer) => (layer.geometry === 'polygon' ? 0 : layer.geometry === 'line' ? 1 : 2)
  return {
    schema: STYLE_EXCHANGE_SCHEMA,
    name,
    layers: styled.sort((a, b) => order(a) - order(b)),
    ...(extent ? { extent } : {}),
  }
}

/** Roads of a project as the style document reads them. */
export const exportedRoadStyles = (project: Pick<RoadProject, 'alignments'>) =>
  project.alignments.map((alignment) => ({ name: alignment.name, color: alignment.color }))
