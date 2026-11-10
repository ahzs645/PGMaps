/**
 * Where the reference sheets' legends drew a symbol differently from their maps. PGMaps uses the
 * map's value in every case and draws its legend from that same symbol, so its own legend cannot
 * disagree. The gallery shows both renderings side by side. No DOM or network access.
 */
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { catalogueEntry } from './symbolCatalogue'

export interface SymbolMismatch {
  id: string
  feature: string
  /** What the reference legend showed, and as a symbol. */
  legendSpec: string
  legend: SheetSymbol
  /** What the reference map drew. */
  mapSpec: string
  map: SheetSymbol
  /** The catalogue entry PGMaps draws, map and legend alike. */
  uses: string
  background?: string
}

export const SYMBOL_MISMATCHES: readonly SymbolMismatch[] = [
  {
    id: 'field-intermediate-contour',
    feature: 'Intermediate contour (field layout)',
    legendSpec: '#828282 0.1',
    legend: { kind: 'line', label: 'Intermediate contour', layers: [{ color: '#828282', width: 0.1 }] },
    mapSpec: '#b2b2b2 0.25, round caps',
    map: {
      kind: 'line',
      label: 'Intermediate contour (10 m)',
      layers: [{ color: '#b2b2b2', width: 0.25, cap: 'round', join: 'round' }],
    },
    uses: 'contour-intermediate',
  },
  {
    id: 'imagery-contour',
    feature: 'Contour (imagery sheet)',
    legendSpec: '#cccccc 0.5',
    legend: { kind: 'line', label: 'Contour', layers: [{ color: '#cccccc', width: 0.5 }] },
    mapSpec: '#ffffff 0.35 index, 0.25 intermediate',
    map: {
      kind: 'line',
      label: 'Index contour on imagery',
      layers: [{ color: '#ffffff', width: 0.35, cap: 'round', join: 'round' }],
    },
    uses: 'contour-index-imagery',
    background: '#3d5236',
  },
  {
    id: 'lidar-stream',
    feature: 'LiDAR stream',
    legendSpec: '#005ce6 1.0',
    legend: { kind: 'line', label: 'LiDAR stream', layers: [{ color: '#005ce6', width: 1 }] },
    mapSpec: '#005ce6 0.5',
    map: {
      kind: 'line',
      label: 'LiDAR stream',
      layers: [{ color: '#005ce6', width: 0.5, cap: 'round', join: 'round' }],
    },
    uses: 'lidar-stream',
  },
  {
    id: 'block-of-interest',
    feature: 'Block of interest (field layout)',
    legendSpec: '#ffaa00 1.5, no casing',
    legend: { kind: 'area', label: 'Block of interest', outline: [{ color: '#ffaa00', width: 1.5 }] },
    mapSpec: '#ffaa00 2.5 over a white 3.0 casing',
    map: {
      kind: 'area',
      label: 'Block of interest',
      outline: [
        { color: '#ffffff', width: 3, join: 'round' },
        { color: '#ffaa00', width: 2.5, join: 'round' },
      ],
    },
    uses: 'block-of-interest',
  },
  {
    id: 'classified-stream',
    feature: 'Classified stream (1:10,000)',
    legendSpec: '#00a9e6 0.4',
    legend: { kind: 'line', label: 'Stream', layers: [{ color: '#00a9e6', width: 0.4 }] },
    mapSpec: '#00a9e6 1.0',
    map: { kind: 'line', label: 'Stream', layers: [{ color: '#00a9e6', width: 1, cap: 'round', join: 'round' }] },
    uses: 'stream',
  },
  {
    id: 'ncd-stream',
    feature: 'NCD stream (1:10,000)',
    legendSpec: '#00a9e6 0.4 dash 5/2',
    legend: { kind: 'line', label: 'NCD stream', layers: [{ color: '#00a9e6', width: 0.4, dash: [5, 2] }] },
    mapSpec: '#00a9e6 1.0 dash 5/2',
    map: { kind: 'line', label: 'NCD stream', layers: [{ color: '#00a9e6', width: 1, dash: [5, 2] }] },
    uses: 'ncd-stream',
  },
  {
    id: 'previously-harvested',
    feature: 'Previously harvested',
    legendSpec: 'Fill #ffffbe, outline #9c9c9c 0.4',
    legend: {
      kind: 'area',
      label: 'Previously harvested',
      fill: '#ffffbe',
      outline: [{ color: '#9c9c9c', width: 0.4, join: 'round' }],
    },
    mapSpec: 'Fill #ffffbe, outline #6e6e6e 0.1',
    map: {
      kind: 'area',
      label: 'Previously harvested',
      fill: '#ffffbe',
      outline: [{ color: '#6e6e6e', width: 0.1, join: 'round' }],
    },
    uses: 'previously-harvested',
  },
]

/** The symbol PGMaps draws for a mismatch. */
export const mismatchSymbol = (mismatch: SymbolMismatch) => catalogueEntry(mismatch.uses).symbol

/** Key order does not matter: two symbols are the same when every value is. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

/** True when PGMaps draws the reference map's value for this feature. */
export const usesMapValue = (mismatch: SymbolMismatch) => sameValue(mismatchSymbol(mismatch), mismatch.map)
