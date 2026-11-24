/**
 * Which of a block sheet's map layers print. A layer switched off leaves the map and the legend; the
 * block of interest is the sheet's subject and always prints (choose *Block* to change it), and the
 * frame is fitted to every layer before any is left out, so switching one off never moves the map.
 * No DOM or network access.
 */
import type { SheetLayers } from './composeSheet'

export type SheetLayerId =
  | 'contours'
  | 'roads'
  | 'existingRoads'
  | 'streams'
  | 'riparian'
  | 'constraints'
  | 'otherBlocks'
  | 'notes'

/** Every layer a sheet can leave out, in the order the setup lists them. */
export const SHEET_LAYER_IDS: readonly SheetLayerId[] = [
  'contours',
  'roads',
  'existingRoads',
  'streams',
  'riparian',
  'otherBlocks',
  'constraints',
  'notes',
]

export const SHEET_LAYER_LABELS: Record<SheetLayerId, string> = {
  contours: 'Contours',
  roads: 'Designed roads',
  existingRoads: 'Existing roads',
  streams: 'Streams',
  riparian: 'Riparian zones',
  otherBlocks: 'Other blocks',
  constraints: 'Constraint areas',
  notes: 'Review markup',
}

/** The layers the setup lists, in groups. */
export const SHEET_LAYER_GROUPS: readonly { id: string; title: string; layers: readonly SheetLayerId[] }[] = [
  { id: 'terrain', title: 'Terrain', layers: ['contours'] },
  { id: 'roads', title: 'Roads', layers: ['roads', 'existingRoads'] },
  { id: 'water', title: 'Water', layers: ['streams', 'riparian'] },
  { id: 'areas', title: 'Areas', layers: ['otherBlocks', 'constraints'] },
  { id: 'review', title: 'Review', layers: ['notes'] },
]

/** Reads a stored list of layers left out: known ids only, each once, in the setup's order. */
export function parseHiddenLayers(raw: unknown): SheetLayerId[] {
  if (!Array.isArray(raw)) return []
  return SHEET_LAYER_IDS.filter((id) => raw.includes(id))
}

/** `layers` without the vector layers in `hidden`. Contours are not a vector layer: the adapter leaves them out. */
export function withoutHiddenLayers(layers: SheetLayers, hidden: readonly SheetLayerId[]): SheetLayers {
  if (!hidden.length) return layers
  const kept: SheetLayers = { ...layers }
  for (const id of hidden) if (id !== 'contours') delete kept[id]
  return kept
}

/** How many features of each layer `layers` holds; contours are not counted here. */
export function sheetLayerCounts(layers: SheetLayers): Record<Exclude<SheetLayerId, 'contours'>, number> {
  return {
    roads: layers.roads?.length ?? 0,
    existingRoads: layers.existingRoads?.length ?? 0,
    streams: layers.streams?.length ?? 0,
    riparian: layers.riparian?.length ?? 0,
    otherBlocks: layers.otherBlocks?.length ?? 0,
    constraints: layers.constraints?.length ?? 0,
    notes: layers.notes?.length ?? 0,
  }
}
