/**
 * Every feature symbol on the reference block-map sheets (ArcGIS Pro block-map sheets supplied by a
 * BC licensee, November 2026), as one definition each. The sheet's map, its legend, the road tool's
 * map and the symbol gallery read these. Where a sheet's legend and its map disagreed the map's value
 * is used (`symbolMismatches.ts`). Labels are generic; point icons are PGMaps' own drawings
 * (`src/lib/mapSheet/icons.ts`), not the sheets' symbol-font glyphs.
 *
 * `spec` keeps the source's values as text so the gallery can show them beside the drawing; `data`
 * says where PGMaps draws the feature from, or what it would need. No DOM or network access.
 */
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import type { IconId } from '@/lib/mapSheet/icons'
import type {
  AreaSymbol,
  Hatch,
  LineLayer,
  LineMarker,
  LineSymbol,
  OutlineLayer,
  PointSymbol,
  SheetSymbol,
} from '@/lib/mapSheet/symbols'
import {
  BLOCK_OF_INTEREST,
  CANOPY_HEIGHT_CLASSES,
  CANOPY_HEIGHT_OPACITY,
  classLegend,
  CONSTRAINT_AREA,
  CONTOUR_STYLES,
  EXISTING_ROAD,
  FOREST_SERVICE_ROAD,
  NCD_STREAM,
  OTHER_BLOCK,
  proposedRoad,
  PROPOSED_ROAD_COLOR,
  RESERVE_HATCHED,
  reviewArea,
  reviewLine,
  reviewPin,
  RIPARIAN_MANAGEMENT_ZONE,
  ROAD_DEACTIVATION,
  SLOPE_CLASS_OPACITY,
  SLOPE_CLASSES,
  SLOPE_STEEP_OVERLAY,
  STREAM,
} from './styles'

export type CatalogueGroupId =
  | 'classes'
  | 'contours'
  | 'blocks'
  | 'hydrology'
  | 'roads'
  | 'points'
  | 'final-layout'
  | 'design-polygons'
  | 'pgmaps'

/** Groups in the order of the source catalogue's §2. */
export const CATALOGUE_GROUPS: readonly { id: CatalogueGroupId; title: string }[] = [
  { id: 'classes', title: 'Slope and canopy height classes' },
  { id: 'contours', title: 'Contours' },
  { id: 'blocks', title: 'Blocks and management areas' },
  { id: 'hydrology', title: 'Hydrology' },
  { id: 'roads', title: 'Roads and linear features' },
  { id: 'points', title: 'Point features' },
  { id: 'final-layout', title: 'Final layout map features' },
  { id: 'design-polygons', title: 'GPS and design polygons' },
  { id: 'pgmaps', title: 'PGMaps additions' },
]

export interface CatalogueEntry {
  id: string
  group: CatalogueGroupId
  symbol: SheetSymbol
  /** The source sheet's value: colour, width (pt), dash, angle, spacing. */
  spec: string
  /** Where PGMaps draws it from (`source`) or what data it lacks (`missing`). */
  data: { source: string } | { missing: string }
  /** Swatch background, for symbols drawn over imagery. */
  background?: string
}

const WHITE = '#ffffff'
const BLACK = '#000000'
const HALO = { color: WHITE, width: 1 }

const stroke = (color: string, width: number, more: Partial<LineLayer> = {}): LineLayer => ({ color, width, ...more })
const line = (label: string, layers: LineLayer[], markers?: LineMarker[]): LineSymbol => ({
  kind: 'line',
  label,
  layers,
  ...(markers ? { markers } : {}),
})
const hatch = (color: string, width: number, angleDeg: number, spacing: number, phase?: number): Hatch => ({
  angleDeg,
  spacing,
  stroke: { color, width } satisfies StrokeStyle,
  ...(phase ? { phase } : {}),
})
const area = (label: string, parts: Omit<AreaSymbol, 'kind' | 'label' | 'outline'> & { outline?: OutlineLayer[] }) =>
  ({ kind: 'area', label, outline: [], ...parts }) as AreaSymbol
const point = (label: string, icon: IconId, size: number, color: string, secondary?: string): PointSymbol => ({
  kind: 'point',
  label,
  icon,
  size,
  color,
  ...(secondary ? { secondary } : {}),
  halo: HALO,
})
const outline = (color: string, width: number, more: Partial<OutlineLayer> = {}): OutlineLayer => ({
  color,
  width,
  join: 'round',
  ...more,
})
const centreDash = (width = 1): LineLayer => stroke(WHITE, width, { dash: [5, 5] })
const contourLine = (label: string, layer: StrokeStyle) => line(label, [layer])

const NO_ADMIN = 'No land-designation layer (parks, UWR, WHA, OGMA, tenure) is loaded; needs its provincial layer.'
const NO_RESULTS = 'RESULTS openings are loaded for road history, but not classed by silviculture status for the sheet.'
const NO_FIELD =
  'A field or design (GPS) layer the tools do not import yet; it would come from a traverse or design file.'
const NO_POINTS = 'No structure or point inventory is loaded; would come from a road structure or field point import.'
const NO_FWA_WATER = 'No FWA lakes and wetlands layer is loaded in the forestry tools.'
const NO_ROAD_CLASS = 'Mapped roads carry tenure status, not surface or use class, so they are not told apart.'
const SHEET_SOURCE = 'Road design block sheet'

const classEntries = (): CatalogueEntry[] => [
  ...classLegend(SLOPE_CLASSES, SLOPE_CLASS_OPACITY, SLOPE_STEEP_OVERLAY).map(
    (symbol): CatalogueEntry => ({
      id: `slope-${symbol.label.replace(/\W+/g, '-').replace(/-+$/, '')}`,
      group: 'classes',
      symbol: { ...symbol, label: `Slope ${symbol.label} %` },
      spec: `${symbol.color}, opacity ${symbol.opacity === 1 ? '1 (drawn over 85 +)' : '216/255'}`,
      data: { source: 'Slope sheet, classed from the terrain grid' },
    }),
  ),
  ...classLegend(CANOPY_HEIGHT_CLASSES, CANOPY_HEIGHT_OPACITY).map(
    (symbol): CatalogueEntry => ({
      id: `canopy-${symbol.label.replace(/\W+/g, '-').replace(/-+$/, '')}`,
      group: 'classes',
      symbol: { ...symbol, label: `Canopy ${symbol.label} m` },
      spec: `${symbol.color}, opaque`,
      data: { source: 'Canopy height sheet, classed from a canopy height grid' },
    }),
  ),
]

export const SYMBOL_CATALOGUE: readonly CatalogueEntry[] = [
  ...classEntries(),

  // ---- Contours ----
  {
    id: 'contour-index',
    group: 'contours',
    symbol: contourLine('Index contour (20 m)', CONTOUR_STYLES.default.index),
    spec: '#4e4e4e 0.35, solid, round caps; label 6 pt #000000, white halo',
    data: { source: 'Contours traced from the terrain at 10 m' },
  },
  {
    id: 'contour-intermediate',
    group: 'contours',
    symbol: contourLine('Intermediate contour (10 m)', CONTOUR_STYLES.default.intermediate),
    spec: '#b2b2b2 0.25, solid; label 6 pt #828282 (legend showed #828282 0.1)',
    data: { source: 'Contours traced from the terrain at 10 m' },
  },
  {
    id: 'contour-index-imagery',
    group: 'contours',
    symbol: contourLine('Index contour on imagery', CONTOUR_STYLES.onImagery.index),
    spec: '#ffffff 0.35; label 6 pt #ffffff (legend showed #cccccc 0.5)',
    data: { source: 'Imagery sheet contours' },
    background: '#3d5236',
  },
  {
    id: 'contour-intermediate-imagery',
    group: 'contours',
    symbol: contourLine('Intermediate contour on imagery', CONTOUR_STYLES.onImagery.intermediate),
    spec: '#ffffff 0.25',
    data: { source: 'Imagery sheet contours' },
    background: '#3d5236',
  },
  {
    id: 'spot-height',
    group: 'contours',
    symbol: point('Spot height', 'spot-height', 5.4, '#4e4e4e'),
    spec: 'Marker 5.4 pt #4e4e4e; label Times Italic 4.5 pt',
    data: { missing: 'No spot heights are loaded; peaks could be picked from the terrain later.' },
  },

  // ---- Blocks and management areas ----
  {
    id: 'block-of-interest',
    group: 'blocks',
    symbol: BLOCK_OF_INTEREST.default,
    spec: '#ffaa00 2.5 over a white 3.0 casing, no fill (field legend showed 1.5)',
    data: { source: `${SHEET_SOURCE}: the chosen harvest or reference area` },
  },
  {
    id: 'block-of-interest-lidar',
    group: 'blocks',
    symbol: { ...BLOCK_OF_INTEREST.lidar, label: 'Block of interest (LiDAR sheets)' },
    spec: '#000000 2.5 over a white 3.0 casing',
    data: { source: `${SHEET_SOURCE}: the chosen area, on the LiDAR presets` },
  },
  {
    id: 'other-blocks',
    group: 'blocks',
    symbol: OTHER_BLOCK,
    spec: '#000000 1.0 outline, no fill',
    data: { source: "Road tool's other harvest areas" },
  },
  {
    id: 'adjacent-licensee-block',
    group: 'blocks',
    symbol: area('Adjacent licensee blocks', { outline: [outline('#734c00', 0.4)] }),
    spec: '#734c00 0.4 outline; label 5 pt',
    data: { missing: 'Other licensees’ blocks are not told apart from the project’s harvest areas.' },
  },
  {
    id: 'common-boundary',
    group: 'blocks',
    symbol: line('Common boundary (GPS)', [stroke(BLACK, 3), stroke('#f759f5', 2.29, { dash: [5, 5] })]),
    spec: '#000000 3.0 under #f759f5 2.29 dash 5/5',
    data: { missing: NO_FIELD },
  },
  {
    id: 'operating-area',
    group: 'blocks',
    symbol: area('Operating areas', { outline: [outline('#38a800', 1.5)] }),
    spec: '#38a800 1.5 outline (2.0 on the access sheet); label Arial Bold 10 pt #38a800',
    data: { missing: 'Operating areas are typed as a name; no boundary layer is loaded.' },
  },
  {
    id: 'reserve',
    group: 'blocks',
    symbol: area('Reserves', { fill: '#38a800', outline: [outline(BLACK, 0.4)] }),
    spec: 'Fill #38a800, outline #000000 0.4 (field, slope, canopy, access)',
    data: { missing: 'No reserve polygons are imported as reserves; riparian reserves use the hatched form.' },
  },
  {
    id: 'reserve-hatched',
    group: 'blocks',
    symbol: RESERVE_HATCHED,
    spec: 'Hatch #38a800 0.5 at 45°, 5 pt apart; outline #38a800 1.2 (hillshade, imagery)',
    data: { source: "Riparian reserve zones from the road tool's preliminary riparian screen" },
  },
  {
    id: 'non-productive',
    group: 'blocks',
    symbol: area('Non-productive', { outline: [outline('#6dbb43', 0.4)] }),
    spec: '#6dbb43 0.4 outline',
    data: { missing: 'No forest-cover non-productive polygons are loaded.' },
  },
  {
    id: 'previously-harvested',
    group: 'blocks',
    symbol: area('Previously harvested', { fill: '#ffffbe', outline: [outline('#6e6e6e', 0.1)] }),
    spec: 'Fill #ffffbe, outline #6e6e6e 0.1 (legend showed #9c9c9c 0.4)',
    data: { missing: NO_RESULTS },
  },
  {
    id: 'satisfactorily-restocked',
    group: 'blocks',
    symbol: area('Satisfactorily restocked', { fill: '#dee6ca', outline: [outline('#b2b2b2', 0.1)] }),
    spec: 'Fill #dee6ca, outline #b2b2b2 0.1',
    data: { missing: NO_RESULTS },
  },
  {
    id: 'free-growing',
    group: 'blocks',
    symbol: area('Free growing', { fill: '#b4d79e', outline: [outline('#b2b2b2', 0.1)] }),
    spec: 'Fill #b4d79e, outline #b2b2b2 0.1',
    data: { missing: NO_RESULTS },
  },
  {
    id: 'opening',
    group: 'blocks',
    symbol: area('Other openings', { outline: [outline(BLACK, 0.4, { dash: [8, 1, 2, 1] })] }),
    spec: '#000000 0.4 outline, dash 8/1/2/1',
    data: { missing: NO_RESULTS },
  },
  {
    id: 'cable-harvest-area',
    group: 'blocks',
    symbol: area('Cable harvest area', { hatches: [hatch(BLACK, 0.5, 45, 5)], outline: [outline(BLACK, 1)] }),
    spec: 'Hatch #000000 0.5 at 45°, 5 pt apart; outline #000000 1.0',
    data: { missing: 'Cable corridors are drawn as lines; no harvest-system polygons are passed to the sheet.' },
  },
  {
    id: 'road-permit-area',
    group: 'blocks',
    symbol: area('Right of way / road permit', { fill: '#ffbee8', outline: [outline('#ff00c5', 0.4)] }),
    spec: 'Fill #ffbee8, outline #ff00c5 0.4',
    data: { missing: 'No road permit or right-of-way polygons are loaded.' },
  },
  {
    id: 'ncbr',
    group: 'blocks',
    symbol: area('NCBR', { outline: [outline(BLACK, 0.4)] }),
    spec: '#000000 0.4 outline',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'archaeological-potential',
    group: 'blocks',
    symbol: area('Archaeological potential', {
      hatches: [hatch('#00a884', 0.5, 45, 5)],
      outline: [outline('#00a884', 0.4)],
    }),
    spec: 'Hatch #00a884 0.5 at 45°, 5 pt apart; outline #00a884 0.4',
    data: { missing: 'No archaeological potential layer is loaded.' },
  },
  {
    id: 'parks',
    group: 'blocks',
    symbol: area('Parks and protected areas', {
      hatches: [hatch('#ffd37f', 0.5, 90, 5), hatch('#ffd37f', 0.5, 0, 5)],
      outline: [outline('#ffaa00', 1)],
    }),
    spec: 'Grid #ffd37f 0.5, vertical and horizontal, 5 pt; outline #ffaa00 1.0',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'eco-rec-reserve',
    group: 'blocks',
    symbol: area('Ecological / recreation reserve', {
      hatches: [hatch('#55ff00', 0.5, 90, 7), hatch('#55ff00', 0.5, 0, 7)],
      outline: [outline('#894444', 0.4)],
    }),
    spec: 'Grid #55ff00 0.5, 7 pt; outline #894444 0.4',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'recreation-site',
    group: 'blocks',
    symbol: area('Recreation site', {
      hatches: [hatch('#0070ff', 0.5, 90, 7), hatch('#55ff00', 0.5, 0, 7)],
      outline: [outline('#704489', 0.4)],
    }),
    spec: 'Grid #0070ff 0.5 (7 pt) with #55ff00 lines; outline #704489 0.4',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'woodlot',
    group: 'blocks',
    symbol: area('Woodlot', {
      hatches: [hatch('#ff7f7f', 0.5, 90, 7), hatch('#0070ff', 0.5, 0, 7)],
      outline: [outline('#ff0000', 0.5)],
    }),
    spec: 'Vertical #ff7f7f 0.5 (7 pt) and horizontal #0070ff; outline #ff0000 0.5',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'community-forest',
    group: 'blocks',
    symbol: area('Community forest licence', {
      hatches: [hatch('#ff7f7f', 0.5, 0, 7)],
      outline: [outline(WHITE, 3), outline('#a80000', 2), outline('#ff7f7f', 1, { dash: [10, 5] })],
    }),
    spec: 'White 3.0, #a80000 2.0, #ff7f7f 1.0 dash 10/5; horizontal #ff7f7f 0.5, 7 pt',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'community-forest-access',
    group: 'blocks',
    symbol: area('Community forest licence (1:50,000)', {
      outline: [outline('#ff7f7f', 2), outline('#a80000', 1, { dash: [5, 3] })],
    }),
    spec: '#ff7f7f 2.0 with #a80000 1.0 dash 5/3',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'scenic-area',
    group: 'blocks',
    symbol: area('Scenic areas', { hatches: [hatch('#e8beff', 0.5, 45, 7)], outline: [outline('#df73ff', 0.4)] }),
    spec: 'Hatch #e8beff 0.5 at 45°, 7 pt apart; outline #df73ff 0.4; "P" marker; label 8 pt #df73ff',
    data: { missing: 'Visual sensitivity units are loaded in the visual quality tool, not passed to the sheet.' },
  },
  {
    id: 'rare-ecosystem',
    group: 'blocks',
    symbol: area('Rare ecosystem', {
      hatches: [hatch('#e60000', 0.7, 45, 8), hatch('#a900e6', 0.8, 135, 8)],
      outline: [outline('#a900e6', 0.5)],
    }),
    spec: 'Cross-hatch #e60000 0.7 at 45° and #a900e6 0.8 at 135°, 8 pt; outline #a900e6 0.5',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'uncommon-ecosystem',
    group: 'blocks',
    symbol: area('Uncommon ecosystem', { hatches: [hatch('#ffa77f', 0.5, 45, 5)], outline: [outline('#ff5500', 0.1)] }),
    spec: 'Hatch #ffa77f 0.5 at 45°, 5 pt; outline #ff5500 0.1',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'ogma',
    group: 'blocks',
    symbol: area('Old growth management area', {
      markerFill: { icon: 'dot', size: 1.75, color: '#38a800', spacingX: 6, spacingY: 6, stagger: true },
      outline: [outline('#38a800', 1)],
    }),
    spec: '#38a800 dots 1.5–2 pt on a grid (pitch not recorded; 6 pt staggered used); outline #38a800 1.0',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'landscape-retention',
    group: 'blocks',
    symbol: area('Landscape level retention', { outline: [outline('#55ff00', 0.4)] }),
    spec: '#55ff00 0.4 outline',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'landscape-retention-imagery',
    group: 'blocks',
    symbol: area('Landscape level retention (imagery)', {
      hatches: [hatch('#38a800', 0.5, 45, 5)],
      outline: [outline('#4ce600', 0.1)],
    }),
    spec: '#4ce600 0.1 outline with a #38a800 hatch (angle and spacing not recorded; 45°, 5 pt used)',
    data: { missing: NO_ADMIN },
    background: '#3d5236',
  },
  {
    id: 'ancient-forest',
    group: 'blocks',
    symbol: area('Ancient forest', { fill: '#ff00c5' }),
    spec: 'Fill #ff00c5',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'private-land',
    group: 'blocks',
    symbol: area('Private land', { fill: '#cccccc', outline: [outline('#9c9c9c', 0.4)] }),
    spec: 'Fill #cccccc, outline #9c9c9c 0.4',
    data: { missing: 'No parcel or tenure layer is loaded.' },
  },
  {
    id: 'native-reserve',
    group: 'blocks',
    symbol: area('Native reserve', { outline: [outline('#c3621f', 0.4)] }),
    spec: '#c3621f 0.4 outline',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'uwr-modified',
    group: 'blocks',
    symbol: area('UWR modified harvest', {
      hatches: [hatch('#0070ff', 0.5, 90, 5), hatch('#cdaa66', 0.5, 0, 5)],
      outline: [outline('#cdaa66', 1.2)],
    }),
    spec: 'Vertical #0070ff 0.5 and horizontal #cdaa66 0.5, 5 pt; outline #cdaa66 1.2',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'uwr-no-harvest',
    group: 'blocks',
    symbol: area('UWR no harvest', {
      hatches: [hatch('#ff0000', 0.5, 90, 5), hatch('#cdaa66', 0.5, 0, 5)],
      outline: [outline('#cdaa66', 1.2)],
    }),
    spec: 'Vertical #ff0000 0.5 and horizontal #cdaa66 0.5, 5 pt; outline #cdaa66 1.2',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'caribou',
    group: 'blocks',
    symbol: area('Caribou s.7 (preliminary)', {
      hatches: [hatch('#ff7f7f', 1.2, 45, 6), hatch('#9c9c9c', 1.2, 45, 6, 3)],
      outline: [outline('#9c9c9c', 0.4)],
    }),
    spec: 'Alternating #ff7f7f and #9c9c9c 1.2 at 45°, about 3 pt apart; outline #9c9c9c 0.4',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'wildlife-habitat-area',
    group: 'blocks',
    symbol: area('Wildlife habitat area', {
      hatches: [hatch('#e60000', 0.5, 0, 5)],
      outline: [outline('#a80000', 1.2)],
    }),
    spec: 'Horizontal #e60000 0.5, 5 pt; outline #a80000 1.2',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'range-tenure',
    group: 'blocks',
    symbol: area('Range tenure', { outline: [outline('#70a800', 2, { dash: [10.8, 7.2, 3.6, 0] })] }),
    spec: '#70a800 2.0 outline, dash 10.8/7.2/3.6/0; label Arial Bold 5 pt',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'migratory-bird',
    group: 'blocks',
    symbol: area('Migratory bird habitat (rank 6)', { fill: '#ff2600', outline: [outline('#6e6e6e', 0.4)] }),
    spec: 'Fill #ff2600, outline #6e6e6e 0.4',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'alpine-zone',
    group: 'blocks',
    symbol: area('Alpine zone', { fill: '#ffff00', outline: [outline(WHITE, 3, { inside: true })] }),
    spec: 'Fill #ffff00 with a 3.0 white inner casing',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'alpine-forest',
    group: 'blocks',
    symbol: area('Alpine forest', {
      fill: '#9c9c9c',
      outline: [outline(WHITE, 3, { inside: true }), outline('#828282', 1)],
    }),
    spec: 'Fill #9c9c9c, outline #828282 1.0, 3.0 white inner casing',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'riparian-zone-plan',
    group: 'blocks',
    symbol: area('Riparian zone (land use plan)', { fill: '#00c5ff', outline: [outline(WHITE, 3, { inside: true })] }),
    spec: 'Fill #00c5ff with a 3.0 white inner casing',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'remnant-old',
    group: 'blocks',
    symbol: area('Remnant old ecosystems', { fill: '#0070ff' }),
    spec: 'Fill #0070ff',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'vri-polygon',
    group: 'blocks',
    symbol: area('VRI polygons', {
      outline: [outline(WHITE, 1.2), outline('#734c00', 1.2, { dash: [6, 1, 1, 1, 1, 1, 1, 1] })],
    }),
    spec: '#734c00 1.2 dash 6/1/1/1/1/1/1/1 over a white 1.2 casing (identified visually); labels 6 pt #734c00',
    data: { missing: 'VRI is read live in the visual quality tool; it is not passed to the sheet.' },
  },

  // ---- Hydrology ----
  {
    id: 'stream',
    group: 'hydrology',
    symbol: STREAM.detail,
    spec: '#00a9e6 1.0 solid at 1:10,000 (legend showed 0.4)',
    data: { source: "Road tool's stream context lines" },
  },
  {
    id: 'stream-overview',
    group: 'hydrology',
    symbol: { ...STREAM.overview, label: 'Stream (1:50,000)' },
    spec: '#00a9e6 0.1 at 1:50,000',
    data: { source: "Road tool's stream context lines, on the access sheet" },
  },
  {
    id: 'ncd-stream',
    group: 'hydrology',
    symbol: NCD_STREAM.detail,
    spec: '#00a9e6 1.0 dash 5/2 at 1:10,000 (legend showed 0.4)',
    data: { source: 'Streams whose imported class is NCD' },
  },
  {
    id: 'ncd-stream-overview',
    group: 'hydrology',
    symbol: { ...NCD_STREAM.overview, label: 'NCD stream (1:50,000)' },
    spec: '#00a9e6 0.1 dash 2/2 at 1:50,000',
    data: { source: 'Streams whose imported class is NCD, on the access sheet' },
  },
  {
    id: 'lidar-stream',
    group: 'hydrology',
    symbol: line('LiDAR stream', [stroke('#005ce6', 0.5, { cap: 'round', join: 'round' })]),
    spec: '#005ce6 0.5 (legend showed 1.0)',
    data: { missing: "The road tool's existing-ground drainage lines are not passed to the sheet." },
  },
  {
    id: 'lake',
    group: 'hydrology',
    symbol: area('Lake / river', { fill: '#97dbf2', outline: [outline('#4065eb', 0.4)] }),
    spec: 'Fill #97dbf2, outline #4065eb 0.4 (0.2 at 1:50,000)',
    data: { missing: NO_FWA_WATER },
  },
  {
    id: 'wetland',
    group: 'hydrology',
    symbol: area('Wetland', {
      markerFill: { icon: 'marsh', size: 8, color: '#005ce6', spacingX: 14, spacingY: 10, stagger: true },
      outline: [outline('#4065eb', 0.45)],
    }),
    spec: 'Outline #4065eb 0.4–0.5; marsh marks #005ce6 8 and 12 pt in a staggered grid (pitch not recorded; 14 × 10 pt used)',
    data: { missing: NO_FWA_WATER },
  },
  {
    id: 'reach-break',
    group: 'hydrology',
    symbol: { ...point('Reach break', 'diamond', 2.8, '#ff0000', BLACK), halo: { color: WHITE, width: 1.5 } },
    spec: '2.8 pt diamond, fill #ff0000, outline #000000 0.5, white 1.5 halo',
    data: { missing: 'Stream reaches are single lines; reach breaks are not recorded.' },
  },
  {
    id: 'fish-observation',
    group: 'hydrology',
    symbol: point('Fish observation', 'fish', 8, '#0099d7', '#ff0000'),
    spec: 'Symbol-font glyph #0099d7 and #ff0000 (drawn as PGMaps’ own fish)',
    data: { missing: 'Fish observations inform stream class review but are not passed to the sheet.' },
  },
  {
    id: 'fish-barrier',
    group: 'hydrology',
    symbol: point('Fish barrier', 'fish-barrier', 8, '#ff0000'),
    spec: 'Symbol-font glyph #ff0000',
    data: { missing: 'No fish barrier points are loaded.' },
  },
  {
    id: 'point-of-diversion',
    group: 'hydrology',
    symbol: point('Point of diversion', 'diversion', 8, '#bee8ff', '#004da8'),
    spec: 'Symbol-font glyph #bee8ff and #004da8',
    data: { missing: 'No water licence points of diversion are loaded.' },
  },
  {
    id: 'fisheries-sensitive-watershed',
    group: 'hydrology',
    symbol: area('Fisheries sensitive watershed', {
      outline: [outline('#ffff00', 4), outline('#004da8', 3, { dash: [5, 2] })],
    }),
    spec: '#ffff00 4.0 under #004da8 3.0 dash 5/2',
    data: { missing: NO_ADMIN },
  },
  {
    id: 'riparian-management-zone',
    group: 'hydrology',
    symbol: RIPARIAN_MANAGEMENT_ZONE,
    spec: 'Hatch #97dbf2 1.6 at 45° with a #4065eb 0.4 hatch, 5 pt apart; outline #4065eb 0.4',
    data: { source: "Riparian management zones from the road tool's preliminary riparian screen" },
  },

  // ---- Roads and linear features ----
  {
    id: 'road-paved',
    group: 'roads',
    symbol: line('Paved road', [stroke('#686868', 4, { join: 'round' }), stroke('#ffff00', 0.67, { dash: [5, 5] })]),
    spec: '#686868 4.0 (2.0) with #ffff00 0.67 (0.5) dash 5/5',
    data: { missing: NO_ROAD_CLASS },
  },
  {
    id: 'road-gravel-main',
    group: 'roads',
    symbol: FOREST_SERVICE_ROAD.detail,
    spec: 'Gravel main: #000000 4.0 (2.0) with white 1.0 dash 5/5',
    data: { source: 'Mapped roads whose evidence names them forest service roads' },
  },
  {
    id: 'road-operational',
    group: 'roads',
    symbol: line('Operational road', [stroke('#267300', 4, { join: 'round' }), centreDash()]),
    spec: '#267300 4.0 (2.0) with white 1.0 dash 5/5',
    data: { missing: NO_ROAD_CLASS },
  },
  {
    id: 'road-spur',
    group: 'roads',
    symbol: EXISTING_ROAD.detail,
    spec: 'Spur: #734c00 2.5 (1.5) with white 1.0 (0.75) dash 5/5',
    data: { source: 'Every other mapped road' },
  },
  {
    id: 'road-proposed',
    group: 'roads',
    symbol: proposedRoad(PROPOSED_ROAD_COLOR, 'detail'),
    spec: '#ff0000 2.5 (1.5) with white 1.0 (0.75) dash 5/5',
    data: { source: 'Designed roads, each in its own colour so the road table can tell them apart' },
  },
  {
    id: 'road-temp-constructed',
    group: 'roads',
    symbol: line('Temporary road, constructed', [stroke('#734c00', 2.5, { join: 'round' }), stroke(WHITE, 1)]),
    spec: '#734c00 2.5 (2.0) with white 1.0 solid',
    data: { missing: NO_ROAD_CLASS },
  },
  {
    id: 'road-temp-proposed',
    group: 'roads',
    symbol: line('Temporary road, proposed', [stroke('#ff0000', 2.5, { join: 'round' }), stroke(WHITE, 1)]),
    spec: '#ff0000 2.5 (2.0) with white 1.0 solid',
    data: { missing: 'Designed roads carry no temporary flag yet.' },
  },
  {
    id: 'road-other',
    group: 'roads',
    symbol: line('Other road', [stroke('#9c9c9c', 2.5, { join: 'round' }), centreDash()]),
    spec: '#9c9c9c 2.5 (1.5) with white 1.0 (0.75) dash 5/5',
    data: { missing: NO_ROAD_CLASS },
  },
  {
    id: 'road-barge',
    group: 'roads',
    symbol: line('Barge crossing', [stroke('#828282', 2.5), centreDash()]),
    spec: '#828282 2.5 with white 1.0 dash 5/5',
    data: { missing: NO_ROAD_CLASS },
  },
  {
    id: 'road-deactivation',
    group: 'roads',
    symbol: ROAD_DEACTIVATION,
    spec: 'Black × marker 7 pt repeated along the road (spacing not recorded; 24 pt used)',
    data: { source: 'Mapped roads with a recorded deactivation, over the road’s own symbol' },
  },
  {
    id: 'trail',
    group: 'roads',
    symbol: line('Trail / operational trail', [stroke('#4e4e4e', 1.5, { dash: [3, 3] })]),
    spec: '#4e4e4e 1.5 dash 3/3',
    data: { missing: NO_FIELD },
  },
  {
    id: 'recreation-trail',
    group: 'roads',
    symbol: line(
      'Recreation trail',
      [stroke('#fa6302', 2, { dash: [3, 3] })],
      [{ icon: 'dot', spacing: 30, size: 3.5, color: '#fa6302' }],
    ),
    spec: '#fa6302 2.0 dash 3/3 with a #fa6302 marker (marker spacing not recorded; 30 pt used)',
    data: { missing: 'No recreation trail layer is loaded.' },
  },
  {
    id: 'cultural-trail',
    group: 'roads',
    symbol: line('Cultural trail', [stroke('#ffff00', 2), stroke('#734c00', 1.75, { dash: [3, 3] })]),
    spec: '#ffff00 2.0 with #734c00 1.75 dash 3/3',
    data: { missing: 'No cultural trail layer is loaded.' },
  },
  {
    id: 'road-permit-line',
    group: 'roads',
    symbol: line('Licensee road permit', [
      stroke('#e60000', 0.8, { offset: -1.5 }),
      stroke('#e60000', 0.8, { offset: 1.5 }),
    ]),
    spec: 'Two parallel #e60000 0.8 lines, 3 pt apart',
    data: { missing: 'Road permits are not told apart from other mapped roads.' },
  },
  {
    id: 'road-centerline-gps',
    group: 'roads',
    symbol: line('Road centreline (GPS)', [stroke('#ff0000', 2), stroke(BLACK, 2, { dash: [4, 1] })]),
    spec: '#ff0000 2.0 with #000000 2.0 dash 4/1',
    data: { missing: NO_FIELD },
  },
  {
    id: 'road-centerline-prework',
    group: 'roads',
    symbol: line('Road centreline (prework)', [stroke('#00ffc5', 2), stroke('#ff0000', 2, { dash: [5, 5] })]),
    spec: '#00ffc5 2.0 with #ff0000 2.0 dash 5/5',
    data: { missing: NO_FIELD },
  },
  {
    id: 'block-boundary-gps',
    group: 'roads',
    symbol: line('Block boundary (GPS)', [stroke('#f759f5', 2)]),
    spec: '#f759f5 2.0',
    data: { missing: NO_FIELD },
  },
  {
    id: 'block-boundary-prework',
    group: 'roads',
    symbol: line('Block boundary (prework)', [stroke('#00ffc5', 3), stroke('#f759f5', 2.29, { dash: [5, 5] })]),
    spec: '#00ffc5 3.0 with #f759f5 2.29 dash 5/5',
    data: { missing: NO_FIELD },
  },
  {
    id: 'prework-possible-stream',
    group: 'roads',
    symbol: line('Possible stream (prework)', [stroke('#00ffc5', 2), stroke('#0070ff', 2, { dash: [5, 5] })]),
    spec: '#00ffc5 2.0 with #0070ff 2.0 dash 5/5',
    data: { missing: NO_FIELD },
  },
  {
    id: 'stream-gps',
    group: 'roads',
    symbol: line('Stream (GPS)', [stroke('#0070ff', 2)]),
    spec: '#0070ff 2.0',
    data: { missing: NO_FIELD },
  },
  {
    id: 'reserve-gps-line',
    group: 'roads',
    symbol: line('Reserve boundary (GPS)', [stroke('#38a800', 2)]),
    spec: '#38a800 2.0',
    data: { missing: NO_FIELD },
  },
  {
    id: 'np-gps-line',
    group: 'roads',
    symbol: line('Non-productive boundary (GPS)', [stroke('#55d5e6', 2)]),
    spec: '#55d5e6 2.0',
    data: { missing: NO_FIELD },
  },
  {
    id: 'sss-line',
    group: 'roads',
    symbol: line('SSS boundary', [stroke('#c500ff', 3), stroke(BLACK, 0.3, { dash: [6, 1, 2, 1, 2, 1] })]),
    spec: '#c500ff 3.0 with #000000 0.3 dash 6/1/2/1/2/1',
    data: { missing: NO_FIELD },
  },
  {
    id: 'skid-trail',
    group: 'roads',
    symbol: line('Skid trail', [stroke('#ffa77f', 2)]),
    spec: '#ffa77f 2.0',
    data: { missing: NO_FIELD },
  },
  {
    id: 'machine-free-zone-line',
    group: 'roads',
    symbol: line('Machine free zone (line)', [stroke(BLACK, 2.5), stroke('#ffff00', 1.91, { dash: [5, 5] })]),
    spec: '#000000 2.5 with #ffff00 1.91 dash 5/5',
    data: { missing: NO_FIELD },
  },
  {
    id: 'timber-type-line',
    group: 'roads',
    symbol: line('Timber type line', [stroke('#267300', 1, { dash: [6, 1, 2, 1, 2, 1] })]),
    spec: '#267300 1.0 dash 6/1/2/1/2/1',
    data: { missing: NO_FIELD },
  },
  {
    id: 'fence',
    group: 'roads',
    symbol: line('Fence', [stroke('#9c7a50', 0.4)], [{ icon: 'tick-side', spacing: 10, size: 4, color: '#9c7a50' }]),
    spec: '#9c7a50 0.4 with tick markers (tick size and spacing not recorded; 4 pt every 10 pt used)',
    data: { missing: 'No fence lines are loaded.' },
  },
  {
    id: 'rail',
    group: 'roads',
    symbol: line('Rail line', [stroke(BLACK, 0.8)], [{ icon: 'tick', spacing: 9, size: 4, color: BLACK }]),
    spec: '#000000 0.8 with 0.4 × 4 pt cross ticks every 9 pt',
    data: { missing: 'No railway layer is loaded in the forestry tools.' },
  },
  {
    id: 'seismic-line',
    group: 'roads',
    symbol: line('Seismic / cut line', [stroke('#a80000', 1, { dash: [4, 4] })]),
    spec: '#a80000 1.0 dash 4/4 (0.4 on the LiDAR sheets)',
    data: { missing: 'No seismic line layer is loaded.' },
  },
  {
    id: 'pipeline',
    group: 'roads',
    symbol: line('Pipeline', [stroke('#a900e6', 0.4)], [{ icon: 'dot', spacing: 20, size: 2.5, color: '#a900e6' }]),
    spec: '#a900e6 0.4 with #a900e6 markers (marker shape and spacing not recorded; dots every 20 pt used)',
    data: { missing: 'No pipeline layer is loaded.' },
  },
  {
    id: 'transmission-line',
    group: 'roads',
    symbol: line('Transmission line', [stroke(BLACK, 0.4)], [{ icon: 'tower', spacing: 25, size: 3, color: BLACK }]),
    spec: '#000000 0.4 with black markers (marker shape and spacing not recorded; towers every 25 pt used)',
    data: { missing: 'No transmission line layer is loaded.' },
  },

  // ---- Point features ----
  ...(
    [
      ['bridge-existing', 'Existing bridge', 'bridge', BLACK],
      ['bridge-proposed', 'Proposed bridge', 'bridge', '#e60000'],
      ['bridge-unknown', 'Unknown bridge', 'bridge', '#ffaa00'],
      ['culvert-existing', 'Existing culvert', 'culvert', BLACK],
      ['culvert-proposed', 'Proposed culvert', 'culvert', '#e60000'],
      ['culvert-unknown', 'Unknown culvert', 'culvert', '#ffaa00'],
    ] as const
  ).map(
    ([id, label, icon, color]): CatalogueEntry => ({
      id,
      group: 'points',
      symbol: point(label, icon, 9, color),
      spec: `Symbol-font glyph ${color}, white halo`,
      data: { missing: NO_POINTS },
    }),
  ),
  ...(
    [
      ['pipe-arch-existing', 'Existing pipe arch', BLACK],
      ['pipe-arch-proposed', 'Proposed pipe arch', '#e60000'],
      ['pipe-arch-unknown', 'Unknown pipe arch', '#ffaa00'],
    ] as const
  ).map(
    ([id, label, color]): CatalogueEntry => ({
      id,
      group: 'points',
      symbol: point(label, 'pipe-arch', 9, color, '#d2d3c7'),
      spec: `Symbol-font glyph ${color} over #d2d3c7`,
      data: { missing: NO_POINTS },
    }),
  ),
  {
    id: 'structure-nonfunctioning',
    group: 'points',
    symbol: point('Non-functioning structure', 'structure-nonfunctioning', 9, '#ffff00'),
    spec: 'Yellow #ffff00 circle with a black glyph',
    data: { missing: NO_POINTS },
  },
  {
    id: 'structure-removed',
    group: 'points',
    symbol: point('Removed structure', 'structure-removed', 9, '#ff0000'),
    spec: 'Red glyph over a black culvert glyph',
    data: { missing: NO_POINTS },
  },
  {
    id: 'gate',
    group: 'points',
    symbol: point('Gate', 'gate', 8, '#734c00'),
    spec: 'Symbol-font glyph #734c00',
    data: { missing: NO_POINTS },
  },
  {
    id: 'cattle-guard',
    group: 'points',
    symbol: point('Cattle guard', 'cattle-guard', 8, '#734c00'),
    spec: 'Symbol-font glyph (colour not recorded; the gate’s #734c00 used)',
    data: { missing: NO_POINTS },
  },
  {
    id: 'access-control',
    group: 'points',
    symbol: point('Access control', 'access-control', 8, '#734c00'),
    spec: 'Symbol-font glyph (colour not recorded; the gate’s #734c00 used)',
    data: { missing: NO_POINTS },
  },
  {
    id: 'railway-crossing',
    group: 'points',
    symbol: point('Railway crossing', 'railway-crossing', 8, BLACK),
    spec: 'Symbol-font glyph, black',
    data: { missing: NO_POINTS },
  },
  {
    id: 'pipeline-crossing',
    group: 'points',
    symbol: point('Pipeline crossing', 'pipeline-crossing', 8, '#ff0000'),
    spec: 'Symbol-font glyph #ff0000',
    data: { missing: NO_POINTS },
  },
  {
    id: 'pipeline-crossing-multiple',
    group: 'points',
    symbol: point('Pipeline crossing, multiple', 'pipeline-crossing', 8, '#c500ff'),
    spec: 'Symbol-font glyph #c500ff',
    data: { missing: NO_POINTS },
  },
  {
    id: 'skid-crossing',
    group: 'points',
    symbol: point('Skid / backspar crossing', 'skid-crossing', 8, '#0000ff'),
    spec: 'Symbol-font glyph #0000ff',
    data: { missing: NO_POINTS },
  },
  {
    id: 'gravel-pit',
    group: 'points',
    symbol: point('Gravel pit', 'pit', 8, '#4e4e4e', '#cccccc'),
    spec: 'Symbol-font glyph, greys #4e4e4e and #cccccc',
    data: { missing: NO_POINTS },
  },
  {
    id: 'old-gravel-source',
    group: 'points',
    symbol: point('Old gravel source', 'pit', 8, '#9c9c9c', WHITE),
    spec: 'Symbol-font glyph, greys',
    data: { missing: NO_POINTS },
  },
  {
    id: 'rock-quarry',
    group: 'points',
    symbol: point('Rock quarry', 'quarry', 8, '#4e4e4e'),
    spec: 'Symbol-font glyph, greys',
    data: { missing: NO_POINTS },
  },
  {
    id: 'sand-pit',
    group: 'points',
    symbol: point('Sand pit', 'sand-pit', 8, '#4e4e4e', '#cccccc'),
    spec: 'Symbol-font glyph, greys',
    data: { missing: NO_POINTS },
  },
  {
    id: 'shale-pit',
    group: 'points',
    symbol: point('Shale pit', 'shale-pit', 8, '#4e4e4e', '#cccccc'),
    spec: 'Symbol-font glyph, greys',
    data: { missing: NO_POINTS },
  },
  {
    id: 'growth-yield-plot',
    group: 'points',
    symbol: point('Growth and yield plot', 'plot-circle', 8.4, '#ff0000', '#38a800'),
    spec: '8.4 pt circle, fill #ff0000, outline #38a800 1.2',
    data: { missing: NO_POINTS },
  },
  {
    id: 'culturally-modified-tree',
    group: 'points',
    symbol: point('Culturally modified tree', 'tree', 8, '#3aac6a'),
    spec: 'Symbol-font glyph #3aac6a',
    data: { missing: NO_POINTS },
  },
  {
    id: 'invasive-plants',
    group: 'points',
    symbol: point('Invasive plants', 'warning', 8, '#ffff00', BLACK),
    spec: 'Symbol-font glyph, yellow and black',
    data: { missing: NO_POINTS },
  },
  {
    id: 'wellsite',
    group: 'points',
    symbol: point('Wellsite', 'wellsite', 8, '#a80000'),
    spec: '#a80000 marker',
    data: { missing: 'No oil and gas wellsite layer is loaded.' },
  },
  {
    id: 'wellsite-area',
    group: 'points',
    symbol: area('Wellsite area', { fill: '#d9b8e6', outline: [outline('#a80000', 0.4, { dash: [6, 2, 1, 2] })] }),
    spec: 'Polygon #d9b8e6 with a dash-dot outline (outline colour and dash not recorded; #a80000 6/2/1/2 used)',
    data: { missing: 'No oil and gas wellsite layer is loaded.' },
  },
  {
    id: 'scenic-marker',
    group: 'points',
    symbol: point('Scenic area marker', 'scenic-p', 8, '#df73ff'),
    spec: '"P" marker, #df73ff',
    data: { missing: 'Visual sensitivity units are loaded in the visual quality tool, not passed to the sheet.' },
  },

  // ---- Final layout map features (each swatch has a 1 pt black outline) ----
  {
    id: 'final-machine-free-zone',
    group: 'final-layout',
    symbol: area('Machine free zone', { fill: '#ffff73', outline: [outline(BLACK, 1)] }),
    spec: 'Fill #ffff73',
    data: { missing: NO_FIELD },
  },
  {
    id: 'final-crawler-adverse',
    group: 'final-layout',
    symbol: area('Crawler adverse', { hatches: [hatch('#ff0000', 1, 0, 3)], outline: [outline(BLACK, 1)] }),
    spec: 'Horizontal #ff0000 1.0 lines, 3 pt apart',
    data: { missing: NO_FIELD },
  },
  {
    id: 'final-no-decking',
    group: 'final-layout',
    symbol: line('No decking', [stroke('#ff0000', 1)], [{ icon: 'cross', spacing: 5, size: 4, color: '#ff0000' }]),
    spec: 'Red "XXX" (8.6 pt text) over a #ff0000 1.0 line; drawn as × markers every 5 pt',
    data: { missing: NO_FIELD },
  },
  {
    id: 'final-skid-distance',
    group: 'final-layout',
    symbol: area('Skid distance > 300 m', { fill: '#ffaa00', outline: [outline(BLACK, 1)] }),
    spec: 'Fill #ffaa00',
    data: { missing: 'Extraction reach classes are drawn on the road map, not passed to the sheet.' },
  },
  {
    id: 'final-slope-35-49',
    group: 'final-layout',
    symbol: area('Slope 35–49 %', { hatches: [hatch('#ff0000', 1, 90, 5)], outline: [outline(BLACK, 1)] }),
    spec: 'Vertical #ff0000 1.0 lines, 5 pt apart',
    data: { missing: 'Slope is drawn as classes on the slope sheet, not as these layout polygons.' },
  },
  {
    id: 'final-slope-50',
    group: 'final-layout',
    symbol: area('Slope > 50 %', {
      hatches: [hatch('#ff0000', 1, 45, 5), hatch('#ff0000', 1, 135, 5)],
      outline: [outline(BLACK, 1)],
    }),
    spec: '#ff0000 1.0 cross-hatch at 45° and 135°, 5 pt apart',
    data: { missing: 'Slope is drawn as classes on the slope sheet, not as these layout polygons.' },
  },
  {
    id: 'final-block-hazard',
    group: 'final-layout',
    symbol: area('Block hazard', { fill: '#df73ff', outline: [outline(BLACK, 1)] }),
    spec: 'Fill #df73ff',
    data: { missing: NO_FIELD },
  },
  {
    id: 'final-special-rmz',
    group: 'final-layout',
    symbol: area('Special or riparian management zone', { fill: '#55ff00', outline: [outline(BLACK, 1)] }),
    spec: 'Fill #55ff00',
    data: { missing: NO_FIELD },
  },

  // ---- GPS and design polygons (LiDAR sheets) ----
  {
    id: 'design-special-harvest',
    group: 'design-polygons',
    symbol: area('Special harvest area', { fill: '#ffff00', hatches: [hatch('#6e6e6e', 1, 55, 5)] }),
    spec: 'Fill #ffff00 with a #6e6e6e 1.0 hatch at 55°, 5 pt',
    data: { missing: NO_FIELD },
  },
  ...(
    [
      ['design-ecology-units', 'Ecology units', '#e8beff', 'Fill #e8beff (or #cccccc)'],
      ['design-special-management', 'Special management zone', '#ffaa00', 'Fill #ffaa00'],
      ['design-machine-free', 'Machine free zone (design)', '#99b9f0', 'Fill #99b9f0'],
      ['design-archaeology', 'Archaeology (design)', '#464f82', 'Fill #464f82'],
      ['design-non-productive', 'Non-productive (design)', '#855c31', 'Fill #855c31'],
      ['design-deleted-gps', 'Deleted GPS', '#638a41', 'Fill #638a41'],
      ['design-previously-harvested', 'Previously harvested (design)', '#e38da1', 'Fill #e38da1'],
      ['design-gps-line-raw', 'GPS line raw', '#59c0c2', 'Fill #59c0c2'],
      ['design-reserve-boundary', 'Reserve boundary (design)', '#f05454', 'Fill #f05454'],
      ['design-gps-point-raw', 'GPS point raw', '#993666', 'Fill #993666'],
      ['design-trail', 'Trail (design)', '#8cfaab', 'Fill #8cfaab'],
      ['design-gps-reference-raw', 'GPS reference raw', '#bf56f0', 'Fill #bf56f0'],
      ['design-block-boundary', 'Block boundary (design)', '#f5fa9d', 'Fill #f5fa9d'],
      ['design-lake', 'Lake (design)', '#00a9e6', 'Fill #00a9e6'],
    ] as const
  ).map(
    ([id, label, fill, spec]): CatalogueEntry => ({
      id,
      group: 'design-polygons',
      symbol: area(label, { fill }),
      spec,
      data: { missing: NO_FIELD },
    }),
  ),
  {
    id: 'design-steep-slope',
    group: 'design-polygons',
    symbol: area('Steep slope (design)', {
      hatches: [hatch('#e60000', 0.5, 45, 5), hatch('#e60000', 0.5, 135, 5)],
      outline: [outline('#a80000', 0.4)],
    }),
    spec: '#e60000 0.5 cross-hatch (angles and spacing not recorded; 45°/135°, 5 pt used), outline #a80000 0.4',
    data: { missing: NO_FIELD },
  },
  {
    id: 'design-timber-type',
    group: 'design-polygons',
    symbol: area('Timber type (design)', { outline: [outline(BLACK, 0.4)] }),
    spec: 'Outline only (colour and width not recorded; #000000 0.4 used)',
    data: { missing: NO_FIELD },
  },
  {
    id: 'design-other',
    group: 'design-polygons',
    symbol: area('Other (design)', { outline: [outline('#ff0000', 2)] }),
    spec: 'Outline #ff0000 2.0',
    data: { missing: NO_FIELD },
  },

  // ---- PGMaps additions: things the road tool draws that the reference sheets had no symbol for ----
  {
    id: 'constraint-area',
    group: 'pgmaps',
    symbol: CONSTRAINT_AREA,
    spec: 'PGMaps: #e60000 0.5 hatch at 45°, 5 pt; #a80000 0.4 outline',
    data: { source: "Road tool's avoid and review areas" },
  },
  {
    id: 'review-line',
    group: 'pgmaps',
    symbol: reviewLine('#e11d48'),
    spec: 'PGMaps: each map note’s colour, 2.0',
    data: { source: "Road tool's map notes" },
  },
  {
    id: 'review-area',
    group: 'pgmaps',
    symbol: reviewArea('#d97706'),
    spec: 'PGMaps: note colour at 0.35 with a 1.0 outline',
    data: { source: "Road tool's map notes" },
  },
  {
    id: 'review-pin',
    group: 'pgmaps',
    symbol: reviewPin('#e11d48'),
    spec: 'PGMaps: 6.6 pt dot in the note colour, white 1.0 halo',
    data: { source: "Road tool's map notes" },
  },
]

/**
 * Features the reference legends listed with no symbol to read (no colour or glyph recorded). They
 * have no definition until one is chosen.
 */
export const UNSPECIFIED_FEATURES: readonly string[] = [
  'Landing',
  'Yard tower',
  'High value snag',
  'Wildlife point',
  'Beetle trap',
  'Borrow pit',
  'Measure plot',
  'Count plot',
  'Research installation',
]

const BY_ID = new Map(SYMBOL_CATALOGUE.map((entry) => [entry.id, entry]))
export function catalogueEntry(id: string): CatalogueEntry {
  const entry = BY_ID.get(id)
  if (!entry) throw Error(`No symbol "${id}" in the catalogue.`)
  return entry
}
