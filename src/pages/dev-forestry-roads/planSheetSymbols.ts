/**
 * The road tool's context drawn with the block sheet's symbols: which symbol each context feature
 * takes, and the MapLibre layers that draw it on the plan. The plan, its legend and the block sheet
 * all classify through `contextSheetKey`, so the three agree. Module scope has no DOM or network access.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification } from 'maplibre-gl'
import { areaSymbolPaint, lineMarkerLayers, lineSymbolLayout, lineSymbolPaint } from '@/lib/mapSheet/mapSymbols'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import {
  CONSTRAINT_AREA,
  EXISTING_ROAD,
  FOREST_SERVICE_ROAD,
  NCD_STREAM,
  OTHER_BLOCK,
  RIPARIAN_SCREEN,
  ROAD_DEACTIVATION,
  STREAM,
} from '@/lib/forestry/blockSheet/styles'
import type { ContextFeature } from './types'

export type PlanSheetKey =
  | 'constraint'
  | 'riparianReserve'
  | 'riparianManagement'
  | 'otherBlock'
  | 'stream'
  | 'ncd'
  | 'fsr'
  | 'existingRoad'
  | 'deactivated'

/** Each key's symbol, at the sheets' 1:10,000 widths. Drawn bottom first in this order. */
export const PLAN_SHEET_SYMBOLS: Record<PlanSheetKey, SheetSymbol> = {
  constraint: CONSTRAINT_AREA,
  riparianReserve: RIPARIAN_SCREEN.reserve,
  riparianManagement: RIPARIAN_SCREEN.management,
  otherBlock: OTHER_BLOCK,
  stream: STREAM.detail,
  ncd: NCD_STREAM.detail,
  fsr: FOREST_SERVICE_ROAD.detail,
  existingRoad: EXISTING_ROAD.detail,
  deactivated: ROAD_DEACTIVATION,
}
export const PLAN_SHEET_KEYS = Object.keys(PLAN_SHEET_SYMBOLS) as PlanSheetKey[]

/** A stream draws dashed as NCD only when its imported class says so; an unassessed reach is a stream. */
export const isNcdStream = (feature: ContextFeature) =>
  feature.streamAssessment?.importedClass?.trim().toUpperCase() === 'NCD'
/** A mapped road with a recorded deactivation. */
export const isDeactivatedRoad = (feature: ContextFeature) =>
  feature.roadEvidence?.deactivation?.status === 'deactivated'

/** The sheet symbol a context feature takes; a deactivated road also takes `deactivated` on top. */
export function contextSheetKey(feature: ContextFeature): PlanSheetKey | null {
  switch (feature.kind) {
    case 'avoid':
      return 'constraint'
    case 'harvest':
      return 'otherBlock'
    case 'stream':
      return isNcdStream(feature) ? 'ncd' : 'stream'
    case 'existing-road':
      return feature.roadEvidence?.roadClass === 'fsr' ? 'fsr' : 'existingRoad'
    default:
      return null
  }
}

/** The riparian screen's bands: an unresolved extent draws as a management zone. */
export const riparianSheetKey = (band: unknown): PlanSheetKey | null =>
  band === 'reserve' ? 'riparianReserve' : band === 'management' || band === 'uncertain' ? 'riparianManagement' : null

/** Flat properties the plan's sheet layers filter on: MapLibre cannot read nested evidence. */
export function sheetProperties(feature: ContextFeature) {
  return {
    sheetKey: contextSheetKey(feature),
    sheetDeactivated: feature.kind === 'existing-road' && isDeactivatedRoad(feature),
  }
}

/** Symbols a person chose for some of the plan's sheet keys (`roleOverrides`, `styleLibrary.ts`). */
export type PlanSheetOverrides = Partial<Record<PlanSheetKey, SheetSymbol>>

/**
 * The sheet symbols with a person's own in place of those they chose; one of the wrong kind for its
 * feature is left out. `wholeDeactivated`: a chosen `deactivated` style is the whole deactivated road,
 * as the styled GIS exports and the block sheet draw it, so that road draws with it alone rather than
 * with crosses over its own symbol.
 */
export function planSheetSymbolSet(own: PlanSheetOverrides = {}): {
  symbols: Record<PlanSheetKey, SheetSymbol>
  wholeDeactivated: boolean
} {
  const symbols = { ...PLAN_SHEET_SYMBOLS }
  for (const key of PLAN_SHEET_KEYS) {
    const chosen = own[key]
    if (chosen && chosen.kind === PLAN_SHEET_SYMBOLS[key].kind) symbols[key] = chosen
  }
  return { symbols, wholeDeactivated: symbols.deactivated !== PLAN_SHEET_SYMBOLS.deactivated }
}

const POLYGON: ExpressionSpecification = ['==', ['geometry-type'], 'Polygon']
const LINE: ExpressionSpecification = ['==', ['geometry-type'], 'LineString']

/**
 * MapLibre layers drawing `source`'s features with the sheet symbols, bottom first. Paints, dashes,
 * pattern tiles and marker icons all come from the symbols (`PLAN_SHEET_SYMBOLS` unless a set from
 * `planSheetSymbolSet` is given) through `mapSymbols.ts`; the images are added with `keepSymbolImages`.
 */
export function planSheetLayers(
  source: string,
  symbols: Record<PlanSheetKey, SheetSymbol> = PLAN_SHEET_SYMBOLS,
  wholeDeactivated = false,
): LayerSpecification[] {
  const layers: LayerSpecification[] = []
  const DEACTIVATED: ExpressionSpecification = ['==', ['get', 'sheetDeactivated'], true]
  for (const key of PLAN_SHEET_KEYS) {
    const symbol = symbols[key]
    const id = `road-sheet-${key}`
    const ofKey: ExpressionSpecification = ['==', ['get', 'sheetKey'], key]
    const match: ExpressionSpecification =
      key === 'deactivated'
        ? DEACTIVATED
        : // A deactivated road with a style of its own is drawn by that style's layers alone.
          wholeDeactivated && (key === 'fsr' || key === 'existingRoad')
          ? ['all', ofKey, ['!', DEACTIVATED]]
          : ofKey
    if (symbol.kind === 'area') {
      const paint = areaSymbolPaint(symbol)
      const filter: FilterSpecification = ['all', POLYGON, match]
      if (paint.fill) layers.push({ id: `${id}-fill`, type: 'fill', source, filter, paint: paint.fill })
      if (paint.pattern) layers.push({ id: `${id}-pattern`, type: 'fill', source, filter, paint: paint.pattern })
      paint.outline.forEach((outline, i) =>
        layers.push({ id: `${id}-outline-${i}`, type: 'line', source, filter, paint: outline }),
      )
    } else if (symbol.kind === 'line') {
      const filter: FilterSpecification = ['all', LINE, match]
      const layouts = lineSymbolLayout(symbol)
      lineSymbolPaint(symbol).forEach((paint, i) =>
        layers.push({ id: `${id}-${i}`, type: 'line', source, filter, layout: layouts[i], paint }),
      )
      lineMarkerLayers(symbol).forEach((marker, i) =>
        layers.push({ id: `${id}-marker-${i}`, type: 'symbol', source, filter, layout: marker.layout }),
      )
    }
  }
  return layers
}

/** Ids of the sheet layers in drawing order. */
export const PLAN_SHEET_LAYER_IDS = planSheetLayers('road-context').map((layer) => layer.id)
/** Layers a click on a mapped road can hit while the sheet symbols are on: each road's base stroke. */
export const PLAN_SHEET_ROAD_HIT_LAYER_IDS = ['road-sheet-fsr-0', 'road-sheet-existingRoad-0']

/** The plan's sheet layers for one set of symbols: what the plan adds, orders, hides and queries. */
export interface PlanSheetLayerSet {
  symbols: Record<PlanSheetKey, SheetSymbol>
  wholeDeactivated: boolean
  layers: LayerSpecification[]
  ids: string[]
  /** The layers a click on a mapped road can hit: each road's base stroke that this set draws. */
  roadHitIds: string[]
}

/** The sheet layers of `source` with a person's chosen symbols; without any, the sheet's own. */
export function planSheetLayerSet(source: string, own: PlanSheetOverrides = {}): PlanSheetLayerSet {
  const { symbols, wholeDeactivated } = planSheetSymbolSet(own)
  const layers = planSheetLayers(source, symbols, wholeDeactivated)
  const ids = layers.map((layer) => layer.id)
  const hit = [...PLAN_SHEET_ROAD_HIT_LAYER_IDS, ...(wholeDeactivated ? ['road-sheet-deactivated-0'] : [])]
  return { symbols, wholeDeactivated, layers, ids, roadHitIds: hit.filter((id) => ids.includes(id)) }
}
