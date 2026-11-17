/**
 * The layers that can be drawn over an own photo, and how each looks. See
 * docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, section 2.3.
 *
 * Every look is a shared symbol, never a colour typed here: the scene's VIA roles take the reviewer's figure style
 * (`presets.ts`, falling back to the first style that draws the role), so the photo and the analysis sheet look the
 * same; mapped features take the block-sheet catalogue (`symbolCatalogue.ts`); markers take the plan's colours
 * (`planMapStyle.ts`); the skyline and the reading aids take the catalogue's `photo-*` entries, haloed for a photograph.
 * On by default are what tells a camera right from wrong at a glance: the skyline, the proposed
 * blocks, recent cutblocks and openings, and lakes. Sub-landform dividers and lines of force are candidates: drawn,
 * never adopted, never picked.
 *
 * Free of DOM and network access.
 */
import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import { LABEL_HALO } from '@/lib/forestry/blockSheet/styles'
import { findPreset, VIA_STYLE_PRESETS, VQO_ZONE_ROLES, type ViaRole } from '@/lib/forestry/viaFigure/presets'
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import { scaleStroke, type PointSymbol, type SheetSymbol } from '@/lib/mapSheet/symbols'

import { INVENTORY_COLORS, VIEW_OF_INTEREST_COLORS } from './planMapStyle'

export type PhotoLayerId =
  | 'skyline'
  | 'proposedBlocks'
  | 'openings'
  | 'lakes'
  | 'landform'
  | 'sensitivityUnits'
  | 'evqo'
  | 'privateLand'
  | 'rock'
  | 'subLandforms'
  | 'linesOfForce'
  | 'streams'
  | 'roads'
  | 'vri'
  | 'inventoryViewpoints'
  | 'viewsOfInterest'
  | 'horizon'
  | 'bearingTicks'
  | 'distanceContours'

/** How the popover groups its rows. */
export type PhotoLayerGroup = 'scene' | 'inventory' | 'features' | 'candidates' | 'markers' | 'reading'

export const PHOTO_LAYER_GROUPS: readonly { id: PhotoLayerGroup; title: string }[] = [
  { id: 'scene', title: 'The scene' },
  { id: 'inventory', title: 'Inventory' },
  { id: 'features', title: 'Mapped features' },
  { id: 'candidates', title: 'Terrain candidates (drawn only)' },
  { id: 'markers', title: 'Viewpoints' },
  { id: 'reading', title: 'Reading aids' },
]

export type PhotoLayer = {
  id: PhotoLayerId
  label: string
  group: PhotoLayerGroup
  defaultOn: boolean
  /** What is drawn: outlines of areas, lines, markers, or a reading aid the overlay builds itself. */
  geometry: 'area' | 'line' | 'point' | 'aid'
  /** A terrain candidate: drawn, never adopted into the scene and never offered by a click. */
  candidate: boolean
  /** A click on the photo names the feature of this layer under the pixel (`photoPick.ts`). */
  pickable: boolean
  /** Where its features come from. */
  source: string
}

/** The figure style that draws `role`: the reviewer's, else the first in the catalogue that has it. */
export function roleSymbol(role: ViaRole, styleId?: string | null): SheetSymbol {
  const entry =
    findPreset(styleId)?.symbols[role] ?? VIA_STYLE_PRESETS.find((preset) => preset.symbols[role])?.symbols[role]
  if (!entry) throw Error(`No figure style draws "${role}".`)
  return entry.symbol
}

const marker = (label: string, color: string): PointSymbol => ({
  kind: 'point',
  label,
  icon: 'viewpoint',
  size: 9,
  color,
  halo: LABEL_HALO,
})

const VQO_ROLE_BY_CODE = new Map<string, ViaRole>(VQO_ZONE_ROLES.map(([role, code]) => [code, role]))

/** True for an FTEN road whose file type names it a forest service road. */
const isForestServiceRoad = (properties: Record<string, unknown>) =>
  properties.forestServiceRoad === true || /forest service road/i.test(String(properties.FILE_TYPE_DESCRIPTION ?? ''))

/**
 * The symbol a feature of `layer` is drawn with. `properties` chooses among a layer's classes: EVQO by objective
 * `code`, lines of force by `kind` ('convex' | 'concave'), water by `kind` ('wetland' else lake or river), roads by
 * forest service road or not.
 */
export function photoLayerSymbol(
  layer: PhotoLayerId,
  properties: Record<string, unknown> = {},
  styleId?: string | null,
): SheetSymbol {
  switch (layer) {
    case 'skyline':
      return catalogueEntry('photo-skyline').symbol
    case 'proposedBlocks':
      return roleSymbol('proposedBlock', styleId)
    case 'openings':
      return roleSymbol('existingNonVeg', styleId)
    case 'lakes':
      return catalogueEntry(properties.kind === 'wetland' ? 'wetland' : 'lake').symbol
    case 'landform':
      return roleSymbol('landform', styleId)
    case 'sensitivityUnits':
      return roleSymbol('vsuLine', styleId)
    case 'evqo':
      return roleSymbol(VQO_ROLE_BY_CODE.get(String(properties.code ?? '')) ?? 'vqoModification', styleId)
    case 'privateLand':
      return roleSymbol('privateLand', styleId)
    case 'rock':
      return roleSymbol('rockNonVeg', styleId)
    case 'subLandforms':
      return roleSymbol('subLandform', styleId)
    case 'linesOfForce':
      return roleSymbol(properties.kind === 'concave' ? 'forceConcave' : 'forceConvex', styleId)
    case 'streams':
      return catalogueEntry('stream').symbol
    case 'roads':
      return catalogueEntry(isForestServiceRoad(properties) ? 'road-gravel-main' : 'road-spur').symbol
    case 'vri':
      return catalogueEntry('vri-polygon').symbol
    case 'inventoryViewpoints':
      return marker('Inventory viewpoint', INVENTORY_COLORS.viewpoint)
    case 'viewsOfInterest':
      return marker('View of interest', VIEW_OF_INTEREST_COLORS.view)
    case 'horizon':
      return catalogueEntry('photo-level-line').symbol
    case 'distanceContours':
      return catalogueEntry('photo-distance-contour').symbol
    case 'bearingTicks':
      return catalogueEntry('photo-bearing-tick').symbol
  }
}

/** Every symbol a layer can draw, for its legend row. */
export function photoLayerLegend(layer: PhotoLayerId, styleId?: string | null): SheetSymbol[] {
  switch (layer) {
    case 'evqo':
      return VQO_ZONE_ROLES.map(([role]) => roleSymbol(role, styleId))
    case 'linesOfForce':
      return [roleSymbol('forceConvex', styleId), roleSymbol('forceConcave', styleId)]
    case 'lakes':
      return [catalogueEntry('lake').symbol, catalogueEntry('wetland').symbol]
    case 'roads':
      return [catalogueEntry('road-gravel-main').symbol, catalogueEntry('road-spur').symbol]
    default:
      return [photoLayerSymbol(layer, {}, styleId)]
  }
}

export const PHOTO_LAYERS: readonly PhotoLayer[] = [
  {
    id: 'skyline',
    label: 'Skyline',
    group: 'scene',
    defaultOn: true,
    geometry: 'line',
    candidate: false,
    pickable: false,
    source: "The terrain's skyline for the camera as it stands",
  },
  {
    id: 'proposedBlocks',
    label: 'Proposed blocks',
    group: 'scene',
    defaultOn: true,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: "The scene's proposed blocks",
  },
  {
    id: 'openings',
    label: 'Recent cutblocks and openings',
    group: 'scene',
    defaultOn: true,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: "The scene's existing openings, and consolidated cutblocks read for the photo's view",
  },
  {
    id: 'lakes',
    label: 'Lakes and wetlands',
    group: 'features',
    defaultOn: true,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: "Freshwater Atlas lakes, rivers and wetlands read for the photo's view",
  },
  {
    id: 'landform',
    label: 'Landform',
    group: 'scene',
    defaultOn: false,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: "The scene's landform",
  },
  {
    id: 'sensitivityUnits',
    label: 'Visual sensitivity units',
    group: 'inventory',
    defaultOn: false,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: 'Visual landscape inventory (REC_VISUAL_LANDSCAPE_INVENTORY, live WFS)',
  },
  {
    id: 'evqo',
    label: 'Established VQOs',
    group: 'inventory',
    defaultOn: false,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: 'Established visual quality objectives (live WFS)',
  },
  {
    id: 'privateLand',
    label: 'Private land',
    group: 'scene',
    defaultOn: false,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: 'Private-land assessment masks',
  },
  {
    id: 'rock',
    label: 'Rock and non-vegetated',
    group: 'inventory',
    defaultOn: false,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: 'VRI rock and non-vegetated ground (display only)',
  },
  {
    id: 'subLandforms',
    label: 'Sub-landform dividers',
    group: 'candidates',
    defaultOn: false,
    geometry: 'line',
    candidate: true,
    pickable: false,
    source: 'Candidate dividers (`subLandforms.ts`): drawn, never adopted',
  },
  {
    id: 'linesOfForce',
    label: 'Lines of force',
    group: 'candidates',
    defaultOn: false,
    geometry: 'line',
    candidate: true,
    pickable: false,
    source: 'Candidate lines of force (`terrainLines.ts`): drawn, never adopted',
  },
  {
    id: 'streams',
    label: 'Streams',
    group: 'features',
    defaultOn: false,
    geometry: 'line',
    candidate: false,
    pickable: false,
    source: "Freshwater Atlas streams of order 2 and up, read for the photo's view",
  },
  {
    id: 'roads',
    label: 'Roads',
    group: 'features',
    defaultOn: false,
    geometry: 'line',
    candidate: false,
    pickable: false,
    source: "FTEN road sections, read for the photo's view",
  },
  {
    id: 'vri',
    label: 'VRI stands',
    group: 'inventory',
    defaultOn: false,
    geometry: 'area',
    candidate: false,
    pickable: true,
    source: 'Vegetation resources inventory (live WFS)',
  },
  {
    id: 'inventoryViewpoints',
    label: 'Inventory viewpoints',
    group: 'markers',
    defaultOn: false,
    geometry: 'point',
    candidate: false,
    pickable: false,
    source: 'Visual landscape inventory viewpoints (live WFS)',
  },
  {
    id: 'viewsOfInterest',
    label: 'Views of interest',
    group: 'markers',
    defaultOn: false,
    geometry: 'point',
    candidate: false,
    pickable: false,
    source: "The scene's planned views of interest",
  },
  {
    id: 'horizon',
    label: 'Level line',
    group: 'reading',
    defaultOn: false,
    geometry: 'aid',
    candidate: false,
    pickable: false,
    source: "The eye's own height 10 km out, with the earth's curve",
  },
  {
    id: 'bearingTicks',
    label: 'Bearing ticks (5°)',
    group: 'reading',
    defaultOn: false,
    geometry: 'aid',
    candidate: false,
    pickable: false,
    source: 'Compass bearings through the camera',
  },
  {
    id: 'distanceContours',
    label: 'Distance (1, 2, 5, 10 km)',
    group: 'reading',
    defaultOn: false,
    geometry: 'aid',
    candidate: false,
    pickable: false,
    source: 'Distance along each pixel’s ray to the ground it meets',
  },
]

const BY_ID = new Map(PHOTO_LAYERS.map((layer) => [layer.id, layer]))

export function photoLayer(id: PhotoLayerId): PhotoLayer {
  const layer = BY_ID.get(id)
  if (!layer) throw Error(`No photo layer "${id}".`)
  return layer
}

export const isPhotoLayerId = (value: unknown): value is PhotoLayerId =>
  typeof value === 'string' && BY_ID.has(value as PhotoLayerId)

/** Which layers are on: the defaults, with any saved choices for layers that still exist laid over them. */
export function photoLayerVisibility(saved?: unknown): Record<PhotoLayerId, boolean> {
  const visibility = Object.fromEntries(PHOTO_LAYERS.map((layer) => [layer.id, layer.defaultOn])) as Record<
    PhotoLayerId,
    boolean
  >
  if (saved && typeof saved === 'object')
    for (const [id, on] of Object.entries(saved as Record<string, unknown>))
      if (isPhotoLayerId(id) && typeof on === 'boolean') visibility[id] = on
  return visibility
}

/**
 * Symbol sizes are points at print, measured on figures whose image was 900 pt wide (`presets.ts`). Scaling them by
 * the photo's width over that keeps a stroke the same share of the picture on the photo as on the sheet.
 */
export const PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS = 900
export const photoSymbolScale = (photoWidth: number) => photoWidth / PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS

/**
 * The strokes an overlay run is drawn with, scaled to the photo: a line's layers, an area's outline (or its fill
 * colour as a line, for a style that marks blocks by fill alone), a marker's colour. The overlay's runs are open
 * pieces of an outline, so an area's fill and hatches are not drawn by these; a tint goes through `pixelsInFeature`.
 * Hidden runs are dotted, as the photo-matching bench draws them: the same colour and width, a round dot every two
 * widths.
 */
/** Width a run takes from a symbol with no stroke of its own: the A sheets' outline width, points. */
const RUN_WIDTH_POINTS = 0.96

export function photoStrokes(symbol: SheetSymbol, k: number, hidden = false): StrokeStyle[] {
  const base: StrokeStyle[] =
    symbol.kind === 'line'
      ? symbol.layers.map(({ offset: _offset, ...stroke }) => stroke)
      : symbol.kind === 'area'
        ? symbol.outline.length
          ? symbol.outline.map(({ inside: _inside, ...stroke }) => stroke)
          : symbol.fill
            ? [{ color: symbol.fill, width: RUN_WIDTH_POINTS, opacity: symbol.fillOpacity }]
            : []
        : symbol.kind === 'point'
          ? [{ color: symbol.color, width: RUN_WIDTH_POINTS }]
          : [{ color: symbol.color, width: RUN_WIDTH_POINTS, opacity: symbol.opacity }]
  return base.map((stroke) => {
    const scaled = scaleStroke(stroke, k)
    if (!hidden) return scaled
    return { ...scaled, dash: [0, scaled.width * 2], cap: 'round' }
  })
}
