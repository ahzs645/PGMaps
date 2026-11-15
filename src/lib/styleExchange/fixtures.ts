/**
 * A document, its data, a library and a layout that exercise every part of the symbol model the
 * writers carry: multi-stroke and offset lines, dashes, markers along lines, single and double
 * hatches, staggered marker fills, inner casings, icons with halos, labels, and eq / in / range /
 * else rules. The format tests and the QGIS check in `scripts/style-exchange/` read it. Test data
 * only; no DOM or network access.
 */
import {
  CONSTRAINT_AREA,
  EXISTING_ROAD,
  FOREST_SERVICE_ROAD,
  LABEL_HALO,
  NCD_STREAM,
  OTHER_BLOCK,
  proposedRoad,
  RIPARIAN_MANAGEMENT_ZONE,
  ROAD_DEACTIVATION,
  ROAD_LABEL,
  STREAM,
} from '@/lib/forestry/blockSheet/styles'
import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import { FIELD_SIDE_PANEL } from '@/lib/mapSheet/layout'
import type { LineSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'
import { STYLE_EXCHANGE_SCHEMA, type LayoutDocument, type StyleDocument, type SymbolLibrary } from './model'

const sym = (id: string): SheetSymbol => catalogueEntry(id).symbol
const deactivated: LineSymbol = {
  kind: 'line',
  label: 'Deactivated road',
  layers: [...EXISTING_ROAD.detail.layers],
  markers: [...(ROAD_DEACTIVATION.markers ?? [])],
}

export const FIXTURE_DOCUMENT: StyleDocument = {
  schema: STYLE_EXCHANGE_SCHEMA,
  name: 'Fixture road project',
  extent: [-122.62, 53.9, -122.58, 53.92],
  layers: [
    {
      id: 'context_areas',
      name: 'Constraints and other blocks',
      geometry: 'polygon',
      fields: [
        { name: 'NAME', type: 'string' },
        { name: 'SHEET_KEY', type: 'string' },
      ],
      rules: [
        {
          label: 'Constraint area',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'constraint' },
          symbol: CONSTRAINT_AREA,
        },
        {
          label: 'Riparian management zone',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'riparianManagement' },
          symbol: RIPARIAN_MANAGEMENT_ZONE,
        },
        {
          label: 'Old growth management area',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'ogma' },
          symbol: sym('ogma'),
        },
        { label: 'Wetland', filter: { field: 'SHEET_KEY', op: 'eq', value: 'wetland' }, symbol: sym('wetland') },
        {
          label: 'Alpine forest',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'alpine' },
          symbol: sym('alpine-forest'),
        },
        { label: 'Other blocks', filter: null, symbol: OTHER_BLOCK },
      ],
    },
    {
      id: 'context_lines',
      name: 'Streams and existing roads',
      geometry: 'line',
      fields: [
        { name: 'NAME', type: 'string' },
        { name: 'SHEET_KEY', type: 'string' },
      ],
      rules: [
        { label: 'Stream', filter: { field: 'SHEET_KEY', op: 'eq', value: 'stream' }, symbol: STREAM.detail },
        { label: 'NCD stream', filter: { field: 'SHEET_KEY', op: 'eq', value: 'ncd' }, symbol: NCD_STREAM.detail },
        {
          label: 'Forest service road',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'fsr' },
          symbol: FOREST_SERVICE_ROAD.detail,
        },
        {
          label: 'Deactivated road',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'deactivated' },
          symbol: deactivated,
        },
        {
          label: 'Licensee road permit',
          filter: { field: 'SHEET_KEY', op: 'eq', value: 'permit' },
          symbol: sym('road-permit-line'),
        },
        { label: 'Existing road', filter: null, symbol: EXISTING_ROAD.detail },
      ],
    },
    {
      id: 'road_centrelines',
      name: 'Road centrelines',
      geometry: 'line',
      fields: [
        { name: 'NAME', type: 'string' },
        { name: 'MAXGRADE', type: 'number' },
      ],
      rules: [
        {
          label: 'Main line',
          filter: { field: 'NAME', op: 'eq', value: 'Main line' },
          symbol: proposedRoad('#d97706', 'detail', 'Main line'),
        },
        {
          label: 'Spur A / Spur B',
          filter: { field: 'NAME', op: 'in', values: ['Spur A', "Spur B's"] },
          symbol: proposedRoad('#7c3aed', 'detail', 'Spurs'),
        },
        {
          label: 'Steep (12 % and over)',
          filter: { field: 'MAXGRADE', op: 'range', min: 12 },
          symbol: proposedRoad('#dc2626', 'detail', 'Steep'),
        },
        { label: 'Proposed road', filter: null, symbol: proposedRoad('#ff0000', 'detail') },
      ],
      label: { field: 'NAME', size: ROAD_LABEL.size, color: ROAD_LABEL.color, halo: LABEL_HALO, placement: 'line' },
    },
    {
      id: 'road_points',
      name: 'Crossings',
      geometry: 'point',
      fields: [
        { name: 'NAME', type: 'string' },
        { name: 'TYPE', type: 'string' },
      ],
      rules: [
        {
          label: 'Proposed culvert',
          filter: { field: 'TYPE', op: 'eq', value: 'culvert' },
          symbol: sym('culvert-proposed'),
        },
        {
          label: 'Existing bridge',
          filter: { field: 'TYPE', op: 'eq', value: 'bridge' },
          symbol: sym('bridge-existing'),
        },
        {
          label: 'Station',
          filter: null,
          symbol: { kind: 'point', label: 'Station', icon: 'dot', size: 2.5, color: '#1c1917' },
        },
      ],
      label: { field: 'NAME', size: 7, color: '#000000', halo: LABEL_HALO, placement: 'point' },
    },
  ],
}

const ring = (x: number, y: number, w: number, h: number): number[][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
]
const line = (x: number, y: number, dx: number, dy: number): number[][] =>
  Array.from({ length: 6 }, (_, i) => [x + (dx * i) / 5, y + (dy * i) / 5 + (i % 2 ? 0.0006 : 0)])

/** GeoJSON for each fixture layer, one feature per rule, laid out in a small grid round Prince George. */
export const FIXTURE_DATA: Record<string, GeoJSON.FeatureCollection> = {
  context_areas: {
    type: 'FeatureCollection',
    features: ['constraint', 'riparianManagement', 'ogma', 'wetland', 'alpine', 'other'].map((key, i) => ({
      type: 'Feature',
      properties: { NAME: key, SHEET_KEY: key },
      geometry: {
        type: 'Polygon',
        coordinates: [ring(-122.62 + (i % 3) * 0.013, 53.9 + Math.floor(i / 3) * 0.008, 0.011, 0.006)],
      },
    })),
  },
  context_lines: {
    type: 'FeatureCollection',
    features: ['stream', 'ncd', 'fsr', 'deactivated', 'permit', 'existing'].map((key, i) => ({
      type: 'Feature',
      properties: { NAME: key, SHEET_KEY: key },
      geometry: { type: 'LineString', coordinates: line(-122.618, 53.9165 + i * 0.0006, 0.036, 0) },
    })),
  },
  road_centrelines: {
    type: 'FeatureCollection',
    features: [
      { NAME: 'Main line', MAXGRADE: 8 },
      { NAME: "Spur B's", MAXGRADE: 9 },
      { NAME: 'Steep spur', MAXGRADE: 14.5 },
      { NAME: 'Other', MAXGRADE: 3 },
    ].map((properties, i) => ({
      type: 'Feature',
      properties,
      geometry: { type: 'LineString', coordinates: line(-122.618 + i * 0.009, 53.9005, 0.004, 0.014) },
    })),
  },
  road_points: {
    type: 'FeatureCollection',
    features: [
      { NAME: 'C1', TYPE: 'culvert' },
      { NAME: 'B1', TYPE: 'bridge' },
      { NAME: '0+100', TYPE: 'station' },
    ].map((properties, i) => ({
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: [-122.606 + i * 0.006, 53.9148] },
    })),
  },
}

export const FIXTURE_LIBRARY: SymbolLibrary = {
  name: 'Fixture library',
  symbols: ['ogma', 'wetland', 'road-permit-line', 'culvert-proposed', 'alpine-forest'].map((id) => ({
    id,
    name: sym(id).label,
    category: 'Fixture',
    tags: ['fixture'],
    symbol: sym(id),
  })),
}

export const FIXTURE_LAYOUT: LayoutDocument = {
  name: 'Field layout',
  paper: 'tabloid',
  template: FIELD_SIDE_PANEL,
  title: 'Fixture road project',
  subtitle: 'Proposed roads',
  scale: 10000,
  extent: FIXTURE_DOCUMENT.extent,
}
