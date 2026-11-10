/**
 * Sheet layouts as fractions of the page, so one template prints on any paper of its orientation.
 * The fractions were measured from tabloid (11 × 17 in) ArcGIS block-map sheets; type and line sizes
 * scale with the page by `resolveSheet`'s `k`. No DOM or network access.
 */

export type PaperId = 'tabloid' | 'ansi-d' | 'letter' | 'a3' | 'a4'
export type Orientation = 'landscape' | 'portrait'

/**
 * Paper sizes in points, short side first. ANSI D (22 × 34 in) is exactly twice tabloid, so a sheet
 * on it is the tabloid sheet at `k` = 2: the same layout and twice the ground at a given scale.
 */
export const PAPER_SIZES: Record<PaperId, { label: string; short: number; long: number }> = {
  tabloid: { label: 'Tabloid 11 × 17 in', short: 792, long: 1224 },
  'ansi-d': { label: 'ANSI D 22 × 34 in', short: 1584, long: 2448 },
  letter: { label: 'Letter 8.5 × 11 in', short: 612, long: 792 },
  a3: { label: 'A3', short: 841.89, long: 1190.55 },
  a4: { label: 'A4', short: 595.28, long: 841.89 },
}
/** The paper the templates were measured on. Type sizes are given for it. */
export const REFERENCE_PAPER: PaperId = 'tabloid'
/** Smallest type a scaled sheet prints, points; below this a Letter sheet stops being legible. */
export const MIN_SHEET_FONT_PT = 4.5

export function paperSize(paper: PaperId, orientation: Orientation): { width: number; height: number } {
  const size = PAPER_SIZES[paper]
  return orientation === 'landscape'
    ? { width: size.long, height: size.short }
    : { width: size.short, height: size.long }
}

/** [x0, y0, x1, y1] as fractions of page width and height, origin top-left. */
export type FractionRect = readonly [number, number, number, number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type PanelId = 'blockInfo' | 'source' | 'legend' | 'roadTable' | 'footer' | 'comments' | 'notes'

export interface SheetTemplate {
  id: string
  orientation: Orientation
  neatline: FractionRect
  title: FractionRect
  frame: FractionRect
  /** Boxes outside the map, each drawn with a header bar unless `bare`. */
  panels: readonly { id: PanelId; rect: FractionRect; title?: string; bare?: boolean }[]
}

export interface ResolvedSheet {
  template: SheetTemplate
  width: number
  height: number
  /** Type and line scale against the reference paper; 1 on tabloid. */
  k: number
  neatline: Rect
  title: Rect
  frame: Rect
  panels: { id: PanelId; rect: Rect; title?: string; bare?: boolean }[]
}

export function resolveRect(rect: FractionRect, width: number, height: number): Rect {
  return { x: rect[0] * width, y: rect[1] * height, w: (rect[2] - rect[0]) * width, h: (rect[3] - rect[1]) * height }
}

export function resolveSheet(template: SheetTemplate, paper: PaperId): ResolvedSheet {
  const { width, height } = paperSize(paper, template.orientation)
  const reference = paperSize(REFERENCE_PAPER, template.orientation)
  const k = Math.min(width / reference.width, height / reference.height)
  return {
    template,
    width,
    height,
    k,
    neatline: resolveRect(template.neatline, width, height),
    title: resolveRect(template.title, width, height),
    frame: resolveRect(template.frame, width, height),
    panels: template.panels.map((panel) => ({ ...panel, rect: resolveRect(panel.rect, width, height) })),
  }
}

/** A type size for the resolved sheet: the reference size scaled, never below `MIN_SHEET_FONT_PT`. */
export const fontSize = (sheet: Pick<ResolvedSheet, 'k'>, referencePt: number) =>
  Math.max(MIN_SHEET_FONT_PT, referencePt * sheet.k)

/**
 * Landscape with a column of panels on the right: the LiDAR design sheets (slope, canopy height,
 * hillshade). Measured from the tabloid sheets.
 */
export const LIDAR_SIDE_PANEL: SheetTemplate = {
  id: 'lidar-side-panel',
  orientation: 'landscape',
  neatline: [0.0176, 0.0273, 0.9824, 0.9779],
  title: [0.0235, 0.0366, 0.9765, 0.0638],
  frame: [0.0235, 0.0638, 0.7361, 0.9729],
  panels: [
    { id: 'blockInfo', rect: [0.7412, 0.0729, 0.9765, 0.1407], title: 'Block Information' },
    { id: 'source', rect: [0.7412, 0.1409, 0.9765, 0.1569], bare: true },
    { id: 'legend', rect: [0.7412, 0.1569, 0.9765, 0.8976], title: 'Legend' },
    { id: 'footer', rect: [0.7412, 0.9001, 0.9765, 0.9729], bare: true },
  ],
}

/** Landscape with panels on the right and a road table: the field layout sheet. */
export const FIELD_SIDE_PANEL: SheetTemplate = {
  id: 'field-side-panel',
  orientation: 'landscape',
  neatline: [0.0176, 0.0182, 0.9824, 0.9727],
  title: [0.0235, 0.0273, 0.9765, 0.0545],
  frame: [0.0235, 0.0545, 0.7882, 0.9636],
  panels: [
    { id: 'blockInfo', rect: [0.7941, 0.0636, 0.9765, 0.1667], title: 'Block Information' },
    { id: 'legend', rect: [0.7941, 0.1667, 0.9765, 0.7356], title: 'Legend' },
    { id: 'roadTable', rect: [0.7941, 0.7356, 0.9765, 0.8914], title: 'Road Information' },
    { id: 'footer', rect: [0.7941, 0.8973, 0.9765, 0.9636], bare: true },
  ],
}

/** Landscape with three panels under the map: the 1:50,000 general block access sheet. */
export const ACCESS_BOTTOM_PANEL: SheetTemplate = {
  id: 'access-bottom-panel',
  orientation: 'landscape',
  neatline: [0.0235, 0.0273, 0.9765, 0.9727],
  title: [0.0294, 0.0364, 0.9706, 0.0636],
  frame: [0.0294, 0.0636, 0.9706, 0.7727],
  panels: [
    { id: 'blockInfo', rect: [0.0294, 0.7909, 0.2412, 0.9636], title: 'Block Information' },
    { id: 'comments', rect: [0.2471, 0.7909, 0.4588, 0.9636], title: 'Block Access Comments' },
    { id: 'legend', rect: [0.4647, 0.7909, 0.9706, 0.9636], title: 'Legend' },
  ],
}

/** Portrait with two panels under the map and ruled note space: the field ops imagery sheet. */
export const IMAGERY_PORTRAIT: SheetTemplate = {
  id: 'imagery-portrait',
  orientation: 'portrait',
  neatline: [0.0278, 0.0128, 0.9722, 0.9882],
  title: [0.0364, 0.0187, 0.9625, 0.0364],
  frame: [0.0364, 0.0364, 0.9625, 0.8555],
  panels: [
    { id: 'blockInfo', rect: [0.0364, 0.8589, 0.3633, 0.9823], title: 'Block Information' },
    { id: 'legend', rect: [0.3723, 0.8589, 0.6477, 0.9823], title: 'Legend' },
    { id: 'notes', rect: [0.6477, 0.8589, 0.9625, 0.9823], title: 'Notes' },
  ],
}

export const SHEET_TEMPLATES: readonly SheetTemplate[] = [
  LIDAR_SIDE_PANEL,
  FIELD_SIDE_PANEL,
  ACCESS_BOTTOM_PANEL,
  IMAGERY_PORTRAIT,
]
