/**
 * The six block map sheet presets: which layout, which base layer, which block information fields
 * and which extras (road table, access comments, note lines) each prints. No DOM or network access.
 */
import {
  ACCESS_BOTTOM_PANEL,
  FIELD_SIDE_PANEL,
  IMAGERY_PORTRAIT,
  LIDAR_SIDE_PANEL,
  type SheetTemplate,
} from '@/lib/mapSheet/layout'

export type SheetKind =
  | 'field-layout'
  | 'lidar-slope'
  | 'lidar-canopy-height'
  | 'lidar-hillshade'
  | 'general-access'
  | 'field-imagery'

/** What fills the map frame under the vectors. */
export type SheetBase = 'white' | 'imagery' | 'slope' | 'canopy-height' | 'hillshade'

/** Block facts the sheet works out, and fields the user types. */
export type InfoFieldId =
  | 'mapsheet'
  | 'grossArea'
  | 'minElev'
  | 'maxElev'
  | 'operatingArea'
  | 'merchArea'
  | 'timbermark'
  | 'fiz'
  | 'forestDistrict'
  | 'forestRegion'
  | 'tsa'
  | 'nar'
  | 'nearestCommunity'

/** Fields typed by the user: the title bar's licence, permit and block, and the block information. */
export type EnteredFieldId =
  | 'forestLicence'
  | 'cuttingPermit'
  | 'blockId'
  | 'operatingArea'
  | 'merchArea'
  | 'timbermark'
  | 'fiz'
  | 'forestDistrict'
  | 'forestRegion'
  | 'tsa'
  | 'nar'
  | 'nearestCommunity'

export type SheetFields = Partial<Record<EnteredFieldId, string>>
/** Longest value a typed field keeps. */
export const MAX_SHEET_FIELD_LENGTH = 120
/** Longest Block Access Comments text. */
export const MAX_SHEET_COMMENTS_LENGTH = 2000

/** Where a block information value comes from. */
export type FieldOrigin = 'geometry' | 'terrain' | 'entered'
export const INFO_FIELD_ORIGIN: Record<InfoFieldId, FieldOrigin> = {
  mapsheet: 'geometry',
  grossArea: 'geometry',
  minElev: 'terrain',
  maxElev: 'terrain',
  operatingArea: 'entered',
  merchArea: 'entered',
  timbermark: 'entered',
  fiz: 'entered',
  forestDistrict: 'entered',
  forestRegion: 'entered',
  tsa: 'entered',
  nar: 'entered',
  nearestCommunity: 'entered',
}

export const ENTERED_FIELD_LABELS: Record<EnteredFieldId, string> = {
  forestLicence: 'F.L.',
  cuttingPermit: 'CP',
  blockId: 'Block ID',
  operatingArea: 'Operating Area',
  merchArea: 'Block Merch Area (ha)',
  timbermark: 'Timbermark',
  fiz: 'FIZ',
  forestDistrict: 'Forest District',
  forestRegion: 'Forest Region',
  tsa: 'Timber Supply Area',
  nar: 'NAR (ha)',
  nearestCommunity: 'Nearest Community',
}

export interface SheetPreset {
  kind: SheetKind
  /** Name in the export dialog. */
  label: string
  /** Text in the title bar. */
  title: string
  description: string
  template: SheetTemplate
  defaultScale: number
  base: SheetBase
  contours: 'default' | 'onImagery' | null
  blockStyle: 'default' | 'lidar'
  /** Decimal places of the title bar's latitude and longitude. */
  latLngDecimals: number
  /** The title bar's block field label. */
  blockLabel: 'Block ID' | 'Block'
  /** Block information, two columns, top to bottom. */
  info: { columns: readonly [readonly InfoFieldId[], readonly InfoFieldId[]]; size: number; boldValues: boolean }
  /** Heading of the class legend for a classed base. */
  classTitle?: string
  roadTable: boolean
  comments: boolean
  notesLines: boolean
  /** Legend columns for map features. */
  legendColumns: number
  /** Reference type sizes, points on tabloid. */
  type: { title: number; header: number; section: number; legend: number; footer: number }
  northArrowPt: number
}

const SIDE_TYPE = { title: 16, header: 12, section: 9, legend: 6.4, footer: 6.5 }

const LIDAR_INFO = {
  columns: [
    ['mapsheet', 'operatingArea', 'grossArea'],
    ['minElev', 'maxElev', 'merchArea'],
  ],
  size: 7,
  boldValues: false,
} as const

export const SHEET_PRESETS: Record<SheetKind, SheetPreset> = {
  'field-layout': {
    kind: 'field-layout',
    label: 'Field Layout',
    title: 'Field Layout',
    description: 'Side panel, contours, road table. Default 1:10,000.',
    template: FIELD_SIDE_PANEL,
    defaultScale: 10000,
    base: 'white',
    contours: 'default',
    blockStyle: 'default',
    latLngDecimals: 4,
    blockLabel: 'Block ID',
    info: {
      columns: [
        ['grossArea', 'merchArea', 'timbermark', 'forestDistrict', 'forestRegion', 'tsa'],
        ['minElev', 'maxElev', 'fiz', 'mapsheet', 'operatingArea'],
      ],
      size: 6,
      boldValues: false,
    },
    roadTable: true,
    comments: false,
    notesLines: false,
    legendColumns: 2,
    type: SIDE_TYPE,
    northArrowPt: 70,
  },
  'lidar-slope': {
    kind: 'lidar-slope',
    label: 'LiDAR Design Slope',
    title: 'LiDAR Design Slope Map',
    description: 'Slope classes in percent over the terrain, contours and design lines. Default 1:10,000.',
    template: LIDAR_SIDE_PANEL,
    defaultScale: 10000,
    base: 'slope',
    contours: 'default',
    blockStyle: 'lidar',
    latLngDecimals: 6,
    blockLabel: 'Block ID',
    info: LIDAR_INFO,
    classTitle: 'Slope Class (%)',
    roadTable: false,
    comments: false,
    notesLines: false,
    legendColumns: 2,
    type: SIDE_TYPE,
    northArrowPt: 64,
  },
  'lidar-canopy-height': {
    kind: 'lidar-canopy-height',
    label: 'LiDAR Design Canopy Height',
    title: 'LiDAR Design Canopy Height Map',
    description: 'Canopy height in 5 m classes from a canopy height grid. Default 1:10,000.',
    template: LIDAR_SIDE_PANEL,
    defaultScale: 10000,
    base: 'canopy-height',
    contours: 'default',
    blockStyle: 'lidar',
    latLngDecimals: 6,
    blockLabel: 'Block ID',
    info: LIDAR_INFO,
    classTitle: 'Canopy Height (m)',
    roadTable: false,
    comments: false,
    notesLines: false,
    legendColumns: 2,
    type: SIDE_TYPE,
    northArrowPt: 64,
  },
  'lidar-hillshade': {
    kind: 'lidar-hillshade',
    label: 'LiDAR Design Hillshade',
    title: 'LiDAR Design Hillshade',
    description: 'Greyscale hillshade, sun from the north-west at 45°. Default 1:10,000.',
    template: LIDAR_SIDE_PANEL,
    defaultScale: 10000,
    base: 'hillshade',
    contours: 'default',
    blockStyle: 'lidar',
    latLngDecimals: 6,
    blockLabel: 'Block ID',
    info: LIDAR_INFO,
    roadTable: false,
    comments: false,
    notesLines: false,
    legendColumns: 2,
    type: SIDE_TYPE,
    northArrowPt: 64,
  },
  'general-access': {
    kind: 'general-access',
    label: 'General Block Access 1:50,000',
    title: 'General Block Access Map',
    description: 'Overview at 1:50,000 with block information, access comments and the legend underneath.',
    template: ACCESS_BOTTOM_PANEL,
    defaultScale: 50000,
    base: 'white',
    contours: null,
    blockStyle: 'default',
    latLngDecimals: 4,
    blockLabel: 'Block',
    info: {
      columns: [
        ['grossArea', 'mapsheet', 'operatingArea', 'nearestCommunity'],
        ['timbermark', 'maxElev', 'minElev'],
      ],
      size: 8,
      boldValues: true,
    },
    roadTable: false,
    comments: true,
    notesLines: false,
    legendColumns: 4,
    type: { title: 16, header: 12, section: 10, legend: 6.5, footer: 6 },
    northArrowPt: 90,
  },
  'field-imagery': {
    kind: 'field-imagery',
    label: 'Field Ops Imagery',
    title: 'Field Ops Imagery',
    description: 'Portrait over satellite imagery with white contours and ruled note space. Default 1:10,000.',
    template: IMAGERY_PORTRAIT,
    defaultScale: 10000,
    base: 'imagery',
    contours: 'onImagery',
    blockStyle: 'default',
    latLngDecimals: 6,
    blockLabel: 'Block',
    info: {
      columns: [
        ['grossArea', 'timbermark', 'mapsheet', 'operatingArea', 'nearestCommunity'],
        ['nar', 'maxElev', 'minElev'],
      ],
      size: 7,
      boldValues: true,
    },
    roadTable: false,
    comments: false,
    notesLines: true,
    legendColumns: 2,
    type: { title: 16, header: 11, section: 10, legend: 6.5, footer: 6 },
    northArrowPt: 80,
  },
}

export const SHEET_KINDS = Object.keys(SHEET_PRESETS) as SheetKind[]

/** Labels for the block information grid; the access and imagery sheets use the short elevation labels. */
export function infoFieldLabel(id: InfoFieldId, kind: SheetKind): string {
  const short = kind === 'general-access' || kind === 'field-imagery'
  switch (id) {
    case 'mapsheet':
      return 'Mapsheet'
    case 'grossArea':
      return 'Gross Block Area (ha)'
    case 'minElev':
      return short ? 'Min. Elev. (m)' : 'Min. Block Elev. (m)'
    case 'maxElev':
      return short ? 'Max. Elev. (m)' : 'Max. Block Elev. (m)'
    default:
      return ENTERED_FIELD_LABELS[id]
  }
}

/** Satellite imagery for the field imagery sheet, and the credit it must print. */
export const IMAGERY_BASEMAP = {
  tiles: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  tileSize: 256,
  maxzoom: 19,
  attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
} as const

/** Validates typed fields read back from storage or a project; unknown keys are dropped. */
export function parseSheetFields(raw: unknown): SheetFields {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const fields: SheetFields = {}
  for (const id of Object.keys(ENTERED_FIELD_LABELS) as EnteredFieldId[]) {
    const value = (raw as Record<string, unknown>)[id]
    if (typeof value === 'string' && value.trim()) fields[id] = value.slice(0, MAX_SHEET_FIELD_LENGTH)
  }
  return fields
}
