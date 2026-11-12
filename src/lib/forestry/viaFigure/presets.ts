/**
 * VIA figure styles as data, in PGMaps' sheet-symbol shape (`src/lib/mapSheet/symbols.ts`): one
 * definition per drawn thing drives the figure overlay, the legend swatch and (through
 * `mapSymbols.ts`) the road view's MapLibre paint, as `src/lib/forestry/blockSheet/symbolCatalogue.ts`
 * does for block sheets. See docs/forestry-visual-quality.md, "Figure styles and analysis sheets".
 *
 * The values were measured from BC Visual Impact Assessment figures supplied for review in
 * November 2026, cited by document number only. Vector overlays were read from the PDF drawing
 * operators (exact colour, width, dash, cap); raster-only overlays were sampled from the embedded
 * image at native resolution (median of the ink's pixels; widths as run lengths across the stroke).
 * Every value's source is kept as `spec` text, as the catalogue does. Sizes are points at the
 * original print size.
 *
 * Names are generic: no company names, logos or wording that claims to be the original, and no
 * title-block artwork (the logo slot is the user's). No DOM or network access.
 */
import type { LeaderStyle, SheetTextStyle } from '@/lib/mapSheet/callouts'
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import type { AreaSymbol, LineSymbol, SheetSymbol } from '@/lib/mapSheet/symbols'

export type { LeaderStyle }

// ---------------------------------------------------------------- shared shapes

/** What a symbol stands for in a VIA figure. Each preset maps the roles it draws to symbols. */
export type ViaRole =
  | 'landform'
  | 'subLandform'
  | 'vsuLine'
  | 'proposedBlock'
  | 'existingNonVeg'
  | 'privateLand'
  | 'rockNonVeg'
  | 'treatedGround'
  | 'forceConvex'
  | 'forceConcave'
  | 'areaOfAlteration'
  | 'neighbouringWoodland'
  | 'measureGrid'

/** Type on a figure: size in points, optional halo and underline (`src/lib/mapSheet/callouts.ts`). */
export type TextStyle = SheetTextStyle

/**
 * A callout box. `wedge` is the ArcGIS balloon form: one closed outline made of the box and a
 * pointer whose base sits on the box edge and whose tip is the anchor (fill and outline as one
 * area symbol). `leader` draws a separate line instead.
 */
export interface CalloutStyle {
  box: AreaSymbol
  padding: { x: number; y: number }
  title: TextStyle
  body?: TextStyle
  pointer: { kind: 'wedge'; base: number } | { kind: 'leader'; leader: LeaderStyle }
  /** Where boxes go relative to their anchors. */
  placement: 'above-skyline' | 'above-feature' | 'below-feature' | 'outside-frame-top'
  /** Optional emphasis variant (yellow focus box on board triptychs). */
  focus?: { box: AreaSymbol; leader?: LeaderStyle }
}

export interface LegendStyle {
  where: 'footer-cell' | 'inset-top-right' | 'inset-top-left' | 'inset-right' | 'side-panel' | 'none'
  title?: TextStyle & { text: string }
  entry: TextStyle
  swatch: { w: number; h: number; gap: number }
  rowPitch: number
  /** Legend box (inset legends): fill and outline. */
  box?: AreaSymbol
  /** Roles in the order the source legend lists them. The label is the source wording. */
  order: { role: ViaRole; label: string }[]
  /** Printed only when `role` was drawn. */
  footnote?: TextStyle & { text: string; role?: ViaRole }
}

export interface PanelLabelStyle {
  /** Box behind the label (board tab); none draws bare text in the image corner. */
  box?: AreaSymbol
  text: TextStyle
  /** Text size as a share of the panel width, when the label scales with the panel. */
  sizeShare?: number
  labels: string[]
}

export interface CalcBlockStyle {
  title: TextStyle & { text: string }
  line: TextStyle
  emphasis?: TextStyle
  align: 'left' | 'center'
  /** Line templates; {name} fields are filled from the run. Wording follows the source. */
  lines: string[]
  footnote?: TextStyle & { text: string }
}

/** Page frame: paper in points and the page regions as fractions [x0, y0, x1, y1], as `layout.ts`. */
export interface SheetFrame {
  paper: { width: number; height: number; note: string }
  neatline?: { rect: readonly [number, number, number, number]; stroke: StrokeStyle }
  title?: readonly [number, number, number, number]
  image: readonly [number, number, number, number]
  /** Footer cells left to right (A sheets) or stacked panels (B/C/E). */
  cells?: readonly { id: string; rect: readonly [number, number, number, number] }[]
  rule: StrokeStyle
}

export interface Entry<S extends SheetSymbol = SheetSymbol> {
  symbol: S
  spec: string
  /** Where PGMaps would draw it from, or the data it lacks. */
  data: { source: string } | { missing: string }
}

export interface ViaStylePreset {
  id: string
  name: string
  family: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'
  /** Reference documents by number, with page and crop id. */
  sources: string[]
  /** How the base image is toned before symbols go on. */
  tone: 'colour' | 'greyscale'
  symbols: Partial<Record<ViaRole, Entry>>
  callout?: CalloutStyle
  /** Text labels drawn on the image ("Landform 1", rating code, VSU label). */
  labels?: {
    landform?: TextStyle & { template: string }
    rating?: TextStyle & { lines: string[]; spec: string }
    vsu?: TextStyle & { template: string; leader?: LeaderStyle }
    block?: TextStyle & { leader?: LeaderStyle; box?: AreaSymbol; spec: string }
  }
  /** The red-circle visual inventory key (A sheets). */
  vsuBadge?: {
    diameter: number
    stroke: StrokeStyle
    fill: string
    text: TextStyle
    lines: string[]
    key: TextStyle
    keyLines: string[]
  }
  legend: LegendStyle
  panelLabels?: PanelLabelStyle
  calc?: CalcBlockStyle
  /** Footer facts (A sheets: viewpoint, location, distance), bold italic in the originals. */
  facts?: TextStyle
  /** Title block text (A sheets) or figure title (B/D/E). */
  titles?: { lines: (TextStyle & { text: string })[]; align: 'center' | 'left' }
  sheet?: SheetFrame
  /** Class ramps with their legend labels (G). */
  ramps?: { id: string; title: string; classes: { label: string; color: string; pattern?: string }[]; spec: string }[]
  /** What the reference does that the preset cannot express yet. */
  gaps: string[]
}

// ---------------------------------------------------------------- helpers

const round = { cap: 'round', join: 'round' } as const
const s = (color: string, width: number, more: Partial<StrokeStyle> = {}): StrokeStyle => ({ color, width, ...more })
const outlineArea = (label: string, color: string, width: number, more: Partial<StrokeStyle> = {}): AreaSymbol => ({
  kind: 'area',
  label,
  outline: [{ color, width, ...round, ...more }],
})
const fillArea = (
  label: string,
  fill: string,
  fillOpacity?: number,
  outline: AreaSymbol['outline'] = [],
): AreaSymbol => ({
  kind: 'area',
  label,
  fill,
  ...(fillOpacity !== undefined ? { fillOpacity } : {}),
  outline,
})
const line = (label: string, color: string, width: number, more: Partial<StrokeStyle> = {}): LineSymbol => ({
  kind: 'line',
  label,
  layers: [{ color, width, ...round, ...more }],
})
const WHITE = '#ffffff'
const BLACK = '#000000'
const HALO = { color: WHITE, width: 1.92 }

// ---------------------------------------------------------------- family A: Perspective Viewpoint Analysis

/** Tabloid landscape frame shared by the A sheets (1224 × 792 pt; doc 03 p1, 22 p25–70, 23 p15–21). */
const A_SHEET: SheetFrame = {
  paper: { width: 1224, height: 792, note: 'Tabloid 11 × 17 in landscape, = PGMaps REFERENCE_PAPER' },
  neatline: { rect: [14.4 / 1224, 14.4 / 792, 1209.6 / 1224, 777.6 / 792], stroke: s(BLACK, 0.96, round) },
  title: [14.4 / 1224, 14.4 / 792, 1209.6 / 1224, 144 / 792],
  image: [14.4 / 1224, 144 / 792, 1209.6 / 1224, 640.8 / 792],
  cells: [
    { id: 'facts', rect: [14.4 / 1224, 640.8 / 792, 266.4 / 1224, 777.6 / 792] },
    { id: 'inventory', rect: [266.4 / 1224, 640.8 / 792, 417.6 / 1224, 777.6 / 792] },
    { id: 'calc', rect: [417.6 / 1224, 640.8 / 792, 1014.5 / 1224, 777.6 / 792] },
    { id: 'legend', rect: [1014.5 / 1224, 640.8 / 792, 1209.6 / 1224, 777.6 / 792] },
  ],
  rule: s(BLACK, 0.96, round),
}

/** The footer facts cell (03 p1, 22 p27): Arial Bold Italic 12.96 pt. */
const A_FACTS: TextStyle = { size: 12.96, style: 'bolditalic', color: BLACK }

const A_TITLES = (subtitle: string): ViaStylePreset['titles'] => ({
  align: 'center',
  lines: [
    { text: 'Visual Impact Assessment', size: 25.92, style: 'bold', color: BLACK, underline: { width: 2.436 } },
    { text: 'Perspective Viewpoint Analysis', size: 21.84, style: 'bold', color: BLACK },
    { text: subtitle, size: 21.84, color: BLACK },
  ],
})

/** Cyan balloon callout: identical on docs 03, 22 and 23 (drawing ops: fill #00c5ff, stroke #9c9c9c 0.96). */
const A_CALLOUT: CalloutStyle = {
  box: {
    kind: 'area',
    label: 'Block callout',
    fill: '#00c5ff',
    outline: [{ color: '#9c9c9c', width: 0.96, ...round }],
  },
  padding: { x: 2.2, y: 2.4 },
  title: { size: 9.84, style: 'bold', color: BLACK },
  body: { size: 9.84, color: BLACK },
  // 22 p27: box 573.6–656.7 × 277.7–304.3; pointer base on the right edge 294.3–301.0 (6.7 pt), tip at the block.
  pointer: { kind: 'wedge', base: 6.7 },
  placement: 'above-skyline',
}

const A_BADGE: ViaStylePreset['vsuBadge'] = {
  diameter: 58.56, // 312.7–371.3 pt
  stroke: s('#ff0000', 0.96, round),
  fill: WHITE,
  text: { size: 7.92, color: '#ff0000' },
  lines: ['VSU #', 'VSC', 'VAC   /   EVC', 'VQO'],
  key: { size: 7.92, color: BLACK },
  keyLines: [
    'VSU - Visual Sensitivity Unit',
    'VAC - Visual Absorption Capability',
    'EVC - Existing Visual Condition',
    'VQO - Visual Quality Objective',
  ],
}

const A_CALC = (denominator: string): CalcBlockStyle => ({
  title: { text: 'Percent Alteration Calculation', size: 9.84, style: 'bold', color: BLACK },
  line: { size: 9.84, color: BLACK },
  emphasis: { size: 9.84, style: 'bold', color: BLACK },
  align: 'left',
  lines: [
    'Area of Landform {n} = {landformPx}',
    'Area of NonVEG Blocks = {nonVegPx} ({nonVegPct}%)',
    'Area of Proposed Blocks = {proposedPx} ({proposedPct}%)',
    '**Total % Alteration:',
    `**(NonVEG + Proposed Blocks) / ${denominator} = {totalPct}%*`,
  ],
  footnote: { text: '*Units of area measured in pixels', size: 6.96, color: BLACK },
})

const A_LEGEND = (order: LegendStyle['order'], footnote?: LegendStyle['footnote']): LegendStyle => ({
  where: 'footer-cell',
  title: { text: 'Legend', size: 10.8, style: 'bold', color: BLACK },
  entry: { size: 11.28, color: BLACK },
  // 22 p27 swatches: x 1049.5–1081.0 (31.5 pt), 15.4 pt tall, rows 20.4–20.9 pt apart, label 5.7 pt right of the swatch.
  swatch: { w: 31.5, h: 15.4, gap: 5.7 },
  rowPitch: 20.6,
  order,
  ...(footnote ? { footnote } : {}),
})

const PROPOSED_BLOCK_A: Entry = {
  symbol: outlineArea('Proposed Block', '#4ce600', 0.72),
  spec: '#4ce600 0.72 pt on the image, 0.96 pt in the legend, round caps; no fill (the block ground is in the render). 03 p1, 22 p27/p40, 23 p15',
  data: { source: 'Proposed blocks (role "block"), visible part from the run' },
}
const NONVEG_A: Entry = {
  symbol: outlineArea('NonV.E.G.', '#ffff00', 0.96),
  spec: '#ffff00 0.96 pt outline, no fill. Legend 03/22/23; on 23 p19 drawn round existing openings',
  data: { source: 'Existing openings still counting (role "harvested", alterationWeight > 0)' },
}

export const ANALYSIS_SHEET_MAGENTA: ViaStylePreset = {
  id: 'analysis-sheet-magenta',
  name: 'Analysis sheet · magenta landform',
  family: 'A',
  sources: ['03 p1 (three viewpoint PDFs), crops c017–c019, layout 03-p001'],
  tone: 'colour',
  symbols: {
    landform: {
      symbol: outlineArea('Landform', '#c500ff', 0.96),
      spec: '#c500ff 0.96 pt, solid, round caps and joins (03 p1 drawing 1, 74 segments). Reads magenta on the render; it is the same violet as 23. 0.107 % of the 900 pt image width',
      data: { source: 'Landform (role "landscape"), visible part' },
    },
    vsuLine: {
      symbol: outlineArea('VSU', '#e60000', 0.96, { dash: [6, 4.1], cap: 'butt', join: 'miter' }),
      spec: '#e60000 0.96 pt dashed 6.0 on / 4.1 off, butt caps (03 p1 legend, drawings 13–22)',
      data: { source: 'VSU polygons (REC_VISUAL_LANDSCAPE_INVENTORY, live WFS)' },
    },
    proposedBlock: PROPOSED_BLOCK_A,
    existingNonVeg: NONVEG_A,
  },
  callout: A_CALLOUT,
  labels: {
    landform: { template: 'Landform {n}', size: 9.84, color: '#c500ff', halo: HALO },
  },
  vsuBadge: A_BADGE,
  legend: A_LEGEND([
    { role: 'proposedBlock', label: 'Proposed Block' },
    { role: 'existingNonVeg', label: 'NonV.E.G.' },
    { role: 'vsuLine', label: 'VSU' },
    { role: 'landform', label: 'Landform' },
  ]),
  calc: A_CALC('VSU'),
  titles: A_TITLES('{area}'),
  sheet: A_SHEET,
  facts: A_FACTS,
  gaps: [
    'Footer facts are Arial Bold Italic 12.96 pt; the PDF prints Helvetica Bold Oblique.',
    'Proposed block ground in the original is a textured pink-grey render (median #9c817b), not a symbol fill.',
  ],
}

export const ANALYSIS_SHEET_ORANGE: ViaStylePreset = {
  id: 'analysis-sheet-orange',
  name: 'Analysis sheet · orange landform with rating code',
  family: 'A',
  sources: ['22 p23–70, layouts 22-p025/p027/p029; drawings read on p25, p27, p40'],
  tone: 'colour',
  symbols: {
    landform: {
      symbol: outlineArea('Landform', '#e69800', 0.96),
      spec: '#e69800 0.96 pt, solid, round caps/joins (22 p27 drawing 0, p40 drawing 1). 0.088 % of the 1086 pt strip width',
      data: { source: 'Landform (role "landscape"), visible part' },
    },
    proposedBlock: PROPOSED_BLOCK_A,
    existingNonVeg: NONVEG_A,
    privateLand: {
      symbol: fillArea('Private Land', '#d004ef'),
      spec: 'Fill #d004ef in the legend (22 p27 drawing 16); burned into the render as a flat magenta (median #b702d5 after shading). No outline',
      data: {
        source: 'Private-land assessment masks (kind "private"): ParcelMap BC parcels the reviewer adds, or drawn',
      },
    },
  },
  callout: A_CALLOUT,
  labels: {
    landform: { template: 'Landform {n}', size: 9.84, color: '#e69800', halo: HALO },
    rating: {
      lines: ['{vsc}', '{vac}  /  {evc}', '{vqo}'],
      size: 9.84,
      color: '#ff0000',
      halo: HALO,
      spec: 'Three centred lines under the landform label, Arial 9.84 #ff0000 with a white 1.92 pt halo (22 p27: "2", "L  /  R", "PR")',
    },
  },
  vsuBadge: { ...A_BADGE!, lines: ['Landform', 'VSC', 'VAC   /   EVC', 'VQO'] },
  legend: A_LEGEND(
    [
      { role: 'proposedBlock', label: 'Proposed Block' },
      { role: 'existingNonVeg', label: 'NonV.E.G.' },
      { role: 'landform', label: 'Landform' },
      { role: 'privateLand', label: 'Private Land' },
    ],
    {
      text: 'Forest cover on private land not modeled. Private land is artificially de-vegetated for purposes of analysis',
      size: 7.44,
      color: BLACK,
      role: 'privateLand',
    },
  ),
  calc: {
    ...A_CALC('(LF - PL)'),
    lines: [
      'Area of Landform (LF) = {landformPx}',
      'Area of Private Land (PL) = {privatePx}',
      'Area of NonVEG Blocks = {nonVegPx}',
      'Area of Proposed Blocks = {proposedPx}',
      '**Total % Alteration:',
      '**(NonVEG + Prop. Blk) / (LF - PL)  = {totalPct}%*',
    ],
  },
  titles: A_TITLES('{area} - Landform {n}'),
  sheet: A_SHEET,
  facts: A_FACTS,
  gaps: [
    'The landform label and rating code carry a white halo built from text outlines (243 line segments); jsPDF fillThenStroke reproduces it.',
    'Private land is a raster fill under the trees in the original; PGMaps drapes the mask as a flat fill.',
  ],
}

export const ANALYSIS_SHEET_PURPLE: ViaStylePreset = {
  id: 'analysis-sheet-purple',
  name: 'Analysis sheet · purple landform, dashed sub-landforms',
  family: 'A',
  sources: ['23 p14–21, layouts 23-p015/p016/p017; drawings read on p15 and p19'],
  tone: 'colour',
  symbols: {
    landform: {
      symbol: outlineArea('Landform', '#c500ff', 0.96),
      spec: '#c500ff 0.96 pt solid (23 legend drawing 16; on the image it is burned into the render)',
      data: { source: 'Landform (role "landscape"), visible part' },
    },
    subLandform: {
      symbol: line('Sub-landform', '#c500ff', 0.96, { dash: [9.8, 4.1] }),
      spec: '#c500ff 0.96 pt, dashes ≈ 9.8 on / 4.1 off as separate strokes (23 p19 drawings 0–25)',
      data: {
        missing: 'Sub-landform dividers: not in the run; would be reviewer-drawn lines or landformFromTerrain splits.',
      },
    },
    proposedBlock: PROPOSED_BLOCK_A,
    existingNonVeg: NONVEG_A,
    privateLand: {
      symbol: fillArea('Private Land', '#fff5d7', undefined, [{ color: '#ffe9bf', width: 0.96, ...round }]),
      spec: 'Fill #fff5d7, outline #ffe9bf 0.96 (23 p15 drawings 14–15); on the image a pale translucent tan',
      data: {
        source: 'Private-land assessment masks (kind "private"): ParcelMap BC parcels the reviewer adds, or drawn',
      },
    },
  },
  callout: A_CALLOUT,
  labels: { landform: { template: 'Landform {n}', size: 9.84, color: '#8400a8', halo: HALO } },
  vsuBadge: A_BADGE,
  legend: A_LEGEND(
    [
      { role: 'proposedBlock', label: 'Proposed Block' },
      { role: 'existingNonVeg', label: 'NonV.E.G.' },
      { role: 'landform', label: 'Landform' },
      { role: 'privateLand', label: 'Private Land' },
    ],
    { text: '*Private Land is only depicted within Landform 1', size: 6, color: '#9c9c9c', role: 'privateLand' },
  ),
  calc: { ...A_CALC('Landform'), lines: [...A_CALC('Landform').lines] },
  titles: A_TITLES('{area} - {viewpoint}'),
  sheet: A_SHEET,
  facts: A_FACTS,
  gaps: [
    'With sub-landforms the calc cell repeats per sub-landform at 7.92 pt (23 p19: three calc blocks side by side).',
  ],
}

// ---------------------------------------------------------------- family B: existing / proposed / analysed

/** Calculations block under the three panels (07 p3 text: Arial 12, colour #0d0d0d, centred). */
const B_CALC: CalcBlockStyle = {
  title: { text: 'Calculations', size: 12, style: 'bold', color: '#0d0d0d', underline: { width: 0.8 } },
  line: { size: 12, color: '#0d0d0d' },
  align: 'center',
  lines: [
    'VLU= {landformPx} px',
    'Rock= {rockPx} px',
    'Net VLU= {netPx} px',
    'Proposed Development= {proposedPx} px',
    'Existing Non-Veg State= {nonVegPx} px',
    'Alteration= {totalPct}% ({class})',
  ],
}

const B_LEGEND_BOX: AreaSymbol = {
  kind: 'area',
  label: 'Legend box',
  fill: WHITE,
  outline: [{ color: '#7f7f7f', width: 0.5 }],
}
const RED_VLU = (width: number, color = '#ff0000'): Entry => ({
  symbol: outlineArea('VLU', color, width),
  spec: '',
  data: { source: 'Landform (role "landscape"), visible part' },
})

export const ANALYSED_PHOTO_HATCHED_ROCK: ViaStylePreset = {
  id: 'analysed-photo-hatched-rock',
  name: 'Existing / proposed / analysed · red VLU, hatched rock',
  family: 'B',
  sources: ['07 p3, p6, p9, p12, p15 (crops c080–c097, layout 07-p003); image xref 7 on p3 sampled at 2100 × 708'],
  tone: 'colour',
  symbols: {
    landform: {
      ...RED_VLU(1.2),
      spec: '#ff0000 (median #f60404), 5 px of 2100 = 0.24 % of the panel width = 1.2 pt on the 504 pt panel',
    },
    rockNonVeg: {
      symbol: {
        kind: 'area',
        label: 'Rock',
        hatches: [{ angleDeg: 150, spacing: 3.1, stroke: { color: '#c500ff', width: 1 } }],
        outline: [{ color: '#c500ff', width: 1.2, ...round }],
      },
      spec: 'Outline and hatch #c500ff (median #bb09e2); hatch lines ≈ 4 px (1.0 pt) every 13 px (3.1 pt) falling to the right ≈ 30° (FFT of the hatch: 151.8°); legend swatch shows one diagonal',
      data: { source: 'VRI rank-1 non-vegetated land (BCLCS_LEVEL_1 = N, BCLCS_LEVEL_2 = L), live from DataBC' },
    },
    proposedBlock: {
      symbol: outlineArea('DEV', '#55ff00', 1.2),
      spec: '#55ff00 (median #5ff218) outline ≈ 1.2 pt; no fill (the proposed panel above carries the tan)',
      data: { source: 'Proposed blocks, visible part' },
    },
    existingNonVeg: {
      symbol: outlineArea('Non-Veg', '#ffff00', 1.2),
      spec: '#ffff00 (median #fefd06) outline',
      data: { source: 'Existing openings still counting' },
    },
  },
  legend: {
    where: 'inset-right',
    entry: { size: 5, color: BLACK },
    swatch: { w: 10.5, h: 5.5, gap: 2 },
    rowPitch: 7.8,
    box: B_LEGEND_BOX,
    order: [
      { role: 'landform', label: 'VLU' },
      { role: 'rockNonVeg', label: 'Rock' },
      { role: 'proposedBlock', label: 'DEV' },
      { role: 'existingNonVeg', label: 'Non-Veg' },
    ],
  },
  panelLabels: {
    text: { size: 9, color: BLACK },
    sizeShare: 0.018,
    labels: ['Existing Condition', 'Proposed Development', 'Proposed Development'],
  },
  calc: B_CALC,
  sheet: {
    paper: {
      width: 612,
      height: 1008,
      note: 'Legal 8.5 × 14 in portrait (07 and 06 pages); layout.ts has no legal size yet',
    },
    image: [54 / 612, 38.8 / 1008, 576 / 612, 586 / 1008],
    cells: [
      { id: 'existing', rect: [54 / 612, 38.8 / 1008, 576 / 612, 206.6 / 1008] },
      { id: 'proposed', rect: [54 / 612, 225.6 / 1008, 576 / 612, 393.6 / 1008] },
      { id: 'analysed', rect: [63 / 612, 416.3 / 1008, 567 / 612, 586 / 1008] },
      { id: 'calc', rect: [180 / 612, 615 / 1008, 432 / 612, 740 / 1008] },
    ],
    rule: s(BLACK, 2.4),
  },
  gaps: [
    'Panels carry a 2.4 pt black frame burned into each photo (10 px of 2175).',
    'The original reports cm² measured on the print; PGMaps reports pixels of the captured view.',
  ],
}

export const ANALYSED_PHOTO_ROCK_OUTLINE: ViaStylePreset = {
  id: 'analysed-photo-rock-outline',
  name: 'Existing / proposed / analysed · red VLU, violet rock outline, white leader labels',
  family: 'B',
  sources: ['05 p9–p14 (c036–c048, layouts 05-p009/p010/p011); image xref 226 on p13 sampled at 2297 × 1017'],
  tone: 'colour',
  symbols: {
    landform: {
      ...RED_VLU(1.92),
      spec: '#ff0000 (median #f80103), 4 px of 2297 = 0.17 % of width = 1.92 pt on the 1103 pt panel',
    },
    rockNonVeg: {
      symbol: outlineArea('Rock Area', '#c500ff', 2.4),
      spec: '#c500ff (median #c401f8), 5 px = 2.4 pt, no hatch (05 p13); interior keeps the photo',
      data: { source: 'VRI rank-1 non-vegetated land (BCLCS_LEVEL_1 = N, BCLCS_LEVEL_2 = L), live from DataBC' },
    },
    proposedBlock: {
      symbol: outlineArea('Proposed Alteration', '#55ff00', 1.92),
      spec: '#55ff00 (median #55fd08), 4 px = 1.92 pt',
      data: { source: 'Proposed blocks, visible part' },
    },
  },
  labels: {
    block: {
      size: 10.5,
      color: WHITE,
      leader: { stroke: s(BLACK, 0.5) },
      spec: '"405-4": white Arial ≈ 22 px of 2297 (1 % of width), thin black leader ≈ 1 px to the block',
    },
  },
  legend: {
    where: 'inset-top-right',
    title: { text: 'Legend', size: 9, style: 'bold', color: BLACK },
    entry: { size: 5.5, color: BLACK },
    swatch: { w: 20, h: 8.5, gap: 3.5 },
    rowPitch: 12.8,
    box: { kind: 'area', label: 'Legend box', fill: WHITE, outline: [] },
    order: [
      { role: 'landform', label: 'Visual Landscape Unit' },
      { role: 'rockNonVeg', label: 'Rock Area' },
      { role: 'proposedBlock', label: 'Proposed Alteration' },
    ],
  },
  panelLabels: {
    text: { size: 18, color: BLACK },
    sizeShare: 0.017,
    labels: ['Existing Condition', 'Proposed Alteration'],
  },
  calc: B_CALC,
  gaps: ['05 pages print the analysed photo at 1584 × 1584 pt with a 10 pt black frame.'],
}

export const ANALYSED_PHOTO_PRIVATE_LAND: ViaStylePreset = {
  id: 'analysed-photo-private-land',
  name: 'Existing / proposed / analysed · red VLU, orange private land, black callout',
  family: 'B',
  sources: ['06 p2–p15 (c051–c077, layouts 06-p004/p006/p007/p011); image xref 35 on p5 sampled at 1118 × 548'],
  tone: 'colour',
  symbols: {
    landform: {
      ...RED_VLU(1.64, '#e60000'),
      spec: '#e60000 (median #e10d0c), 4 px of 1118 = 0.36 % of width = 1.64 pt on the 459 pt panel',
    },
    proposedBlock: {
      symbol: outlineArea('Proposed Alteration', '#55ff00', 2.05),
      spec: '#55ff00 (median #6aee1d), 5 px = 2.05 pt; the block ground is the proposed panel tan (sampled ≈ #c8b9a0)',
      data: { source: 'Proposed blocks, visible part' },
    },
    privateLand: {
      symbol: outlineArea('Private Land', '#ffaa00', 2.46),
      spec: '#ffaa00 (median #faaa08), 6 px = 2.46 pt, outline only',
      data: {
        source: 'Private-land assessment masks (kind "private"): ParcelMap BC parcels the reviewer adds, or drawn',
      },
    },
  },
  labels: {
    block: {
      size: 12.5,
      color: BLACK,
      leader: { stroke: s(BLACK, 0.4) },
      spec: '"421-3": black Arial ≈ 30 px of 1118 (2.7 % of width), two hairline black leaders from one label to two parts',
    },
  },
  legend: {
    where: 'inset-top-left',
    title: { text: 'Legend', size: 7, style: 'bold', color: BLACK },
    entry: { size: 6, color: BLACK },
    swatch: { w: 20, h: 8, gap: 3 },
    rowPitch: 11.5,
    box: { kind: 'area', label: 'Legend box', fill: WHITE, outline: [{ color: '#595959', width: 0.9 }] },
    order: [
      { role: 'landform', label: 'VLU' },
      { role: 'proposedBlock', label: 'Proposed Alteration' },
      { role: 'privateLand', label: 'Private Land' },
    ],
  },
  panelLabels: { text: { size: 10, color: BLACK }, labels: ['Photo', 'Simulation'] },
  calc: B_CALC,
  gaps: [
    '06 sets a header attribute table (Distance, VLI No., VSC, VAC, EVQO, lat/long, View Duration) in Arial Bold 14.04 #595959 above the panels.',
  ],
}

// ---------------------------------------------------------------- family C: board triptych

export const BOARD_TRIPTYCH: ViaStylePreset = {
  id: 'board-triptych',
  name: 'Board triptych · tab labels, white callouts, yellow focus',
  family: 'C',
  sources: [
    '21 p7, p13, p14 (c428, c430, c431, layout 21-p007); image xref 29 on p7 sampled at 720 × 869 (0.72 pt/px)',
  ],
  tone: 'colour',
  symbols: {
    proposedBlock: {
      symbol: fillArea('Proposed block', '#b9a77e', 0.85),
      spec: 'Flat tan/olive patch painted on the slope (approximate: low-resolution raster); no outline',
      data: { source: 'Proposed blocks, visible part' },
    },
    privateLand: {
      symbol: fillArea('Private land', '#9e978a', 0.85),
      spec: 'Grey-tan patch with a tiny "private land" word on it; approximate',
      data: {
        source: 'Private-land assessment masks (kind "private"): ParcelMap BC parcels the reviewer adds, or drawn',
      },
    },
  },
  callout: {
    box: { kind: 'area', label: 'Callout', fill: WHITE, outline: [{ color: BLACK, width: 0.72 }] },
    padding: { x: 4, y: 2.5 },
    title: { size: 9, style: 'bold', color: BLACK },
    pointer: {
      kind: 'leader',
      leader: { stroke: s(WHITE, 1.4, { cap: 'round' }), head: { length: 5, width: 4.5, filled: true } },
    },
    placement: 'above-feature',
    focus: {
      box: { kind: 'area', label: 'Focus callout', fill: '#ffff00', outline: [{ color: BLACK, width: 0.72 }] },
      leader: {
        stroke: s('#ffff00', 1.4, { cap: 'round' }),
        head: { length: 5, width: 4.5, filled: true, color: '#ffff00' },
      },
    },
  },
  legend: { where: 'none', entry: { size: 9, color: BLACK }, swatch: { w: 0, h: 0, gap: 0 }, rowPitch: 0, order: [] },
  panelLabels: {
    box: { kind: 'area', label: 'Tab', fill: WHITE, outline: [{ color: BLACK, width: 0.72 }] },
    text: { size: 10.5, style: 'bold', color: BLACK },
    labels: ['Pre-harvest', 'Simulation', 'Post-harvest'],
  },
  sheet: {
    paper: { width: 612, height: 792, note: 'Letter portrait' },
    image: [36 / 612, 50.4 / 792, 552.6 / 612, 674 / 792],
    cells: [
      { id: 'pre', rect: [36 / 612, 50.4 / 792, 552.6 / 612, 240 / 792] },
      { id: 'simulation', rect: [36 / 612, 267 / 792, 552.6 / 612, 457 / 792] },
      { id: 'post', rect: [36 / 612, 484 / 792, 552.6 / 612, 674 / 792] },
    ],
    rule: s('#7f7f7f', 0.72),
  },
  gaps: [
    'Callout text is a humanist sans (Open Sans-like); PDF standard fonts print Helvetica.',
    'Box 59 × 19 px = 42 × 13.7 pt, 1 px black border, bold 9 pt; arrows ≈ 2 px white with a filled head.',
  ],
}

// ---------------------------------------------------------------- family D: district greyscale analysis

export const DISTRICT_GREYSCALE: ViaStylePreset = {
  id: 'district-greyscale',
  name: 'District greyscale analysis · labels above, VSU drape, lines of force',
  family: 'D',
  sources: ['04 p138–p146 (c026–c034, layouts 04-p138/p139/p141); 200 dpi scans, 0.36 pt/px'],
  tone: 'greyscale',
  symbols: {
    landform: {
      symbol: fillArea('VSU (drape)', '#8c8c8c', 0.55),
      spec: 'Terrain-only drape: VSUs as flat grey tones (scan: dark terrain ≈ #484848, units ≈ #888888–#989898, NVS ≈ #e8e8e8); no outlines',
      data: { source: 'VSU polygons (live WFS)' },
    },
    forceConvex: {
      symbol: line('Visual Force Convexity', '#a8a8a8', 0.7),
      spec: 'Grey ≈ #a8a8a8 (legend tone 168), ≈ 2 px = 0.7 pt, filled arrowhead; drawn freehand along convex ridges',
      data: {
        missing:
          'Lines of force are a designer judgement; a terrain-derived ridge/valley line (curvature of the DEM) could seed candidates.',
      },
    },
    forceConcave: {
      symbol: line('Visual Force Concavity', '#a8a8a8', 0.7, { dash: [3, 2] }),
      spec: 'Same grey in the scan; PGMaps dashes concavity so the two read apart (the scan cannot tell them apart)',
      data: { missing: 'As convexity: designer-drawn or derived from DEM curvature.' },
    },
    areaOfAlteration: {
      symbol: outlineArea('Area of Alteration', BLACK, 0.75),
      spec: 'Black ellipse ≈ 2 px = 0.75 pt round the proposed blocks, label above with a down arrow (04 p139)',
      data: { source: "Bounding ellipse of the proposed blocks' visible pixels" },
    },
  },
  labels: {
    block: {
      size: 7.5,
      color: BLACK,
      leader: { stroke: s(BLACK, 0.5), head: { length: 4, width: 3.5, filled: false } },
      spec: 'Block id Arial ≈ 7.5 pt above the image, vertical 0.5 pt leader with an open arrowhead down onto the block (04 p138/p141)',
    },
    vsu: {
      template: 'VSU {vsu}-{evqo}',
      size: 7.5,
      color: BLACK,
      leader: { stroke: s(BLACK, 0.5), head: { length: 4, width: 3.5, filled: false } },
    },
  },
  legend: {
    where: 'footer-cell',
    entry: { size: 7.5, color: BLACK },
    swatch: { w: 30, h: 6, gap: 12 },
    rowPitch: 10,
    order: [
      { role: 'forceConvex', label: 'Visual Force Convexity' },
      { role: 'forceConcave', label: 'Visual Force Concavity' },
    ],
  },
  titles: { align: 'center', lines: [{ text: 'Viewpoint {viewpoint} Analysis', size: 11.5, color: BLACK }] },
  calc: {
    title: { text: '', size: 7, color: BLACK },
    line: { size: 7, color: BLACK },
    align: 'center',
    lines: [
      'scaled to viewing distance ({distanceKm} km) for comparison with other viewpoints with {hfov} deg. field of view',
    ],
  },
  sheet: {
    paper: { width: 612, height: 792, note: 'Letter portrait (scanned at 200 dpi)' },
    image: [29.5 / 612, 50 / 792, 584 / 612, 742 / 792],
    rule: s(BLACK, 0.5),
  },
  gaps: ['Lines of force are designer-drawn; PGMaps offers terrain candidates only (see docs).'],
}

// ---------------------------------------------------------------- family E: referral montage

export const REFERRAL_MONTAGE: ViaStylePreset = {
  id: 'referral-montage',
  name: 'Referral montage · tan treated ground with retained-tree stipple',
  family: 'E',
  sources: ['13 p7 (c128–c133, layout 13-p007), 14 p6–7, 15 p4–7, 11 p9–11; 12 p10 (c123)'],
  tone: 'colour',
  symbols: {
    treatedGround: {
      symbol: {
        kind: 'area',
        label: 'Treated ground',
        fill: '#c59864',
        fillOpacity: 0.92,
        markerFill: { icon: 'dot', size: 1.1, color: '#36452f', spacingX: 3.2, spacingY: 3.2, stagger: true },
        outline: [],
      },
      spec: 'Fill #c59864 (median of 1,284 px, 13 p7 image xref 65), straw-textured, retained trees standing in it as dark stems (≈ #36452f); no outline, no legend',
      data: { source: 'Proposed treatment units (role "block")' },
    },
    proposedBlock: {
      symbol: fillArea('Simulated block', '#c8b478', 0.5),
      spec: '12 p10: muted olive-tan patches (median #a7a397 under haze) laid over the photo at partial opacity; approximate',
      data: { source: 'Proposed blocks' },
    },
  },
  legend: {
    where: 'none',
    entry: { size: 9.95, color: BLACK },
    swatch: { w: 0, h: 0, gap: 0 },
    rowPitch: 0,
    order: [],
  },
  titles: {
    align: 'center',
    lines: [
      { text: '{licence} Visual Simulations', size: 9.95, style: 'bold', color: '#c00000', underline: { width: 0.6 } },
      { text: 'Viewpoint #{n}:  {viewpoint}', size: 9.95, style: 'bold', color: BLACK },
    ],
  },
  panelLabels: { text: { size: 11, color: BLACK }, labels: ['Photo', 'Simulation'] },
  sheet: {
    paper: { width: 612, height: 792, note: 'Letter portrait' },
    image: [71 / 612, 92 / 792, 541 / 612, 729 / 792],
    rule: s(BLACK, 0.75),
  },
  gaps: ['Fonts are Calibri (Bold 9.95 pt titles); PDF standard fonts print Helvetica.'],
}

// ---------------------------------------------------------------- family F: calculation on photo

export const CALCULATION_ON_PHOTO: ViaStylePreset = {
  id: 'calculation-on-photo',
  name: 'Calculation on photo · grid, numbered polygons, area table',
  family: 'F',
  sources: ['09 pages 03–05 (c573–c575); page JPEG 1139 × 1474 (≈ 134 dpi)'],
  tone: 'colour',
  symbols: {
    measureGrid: {
      symbol: line('Grid', '#d2d2d2', 0.5),
      spec: 'Light grey lines every 17.4 px = 9.35 pt (≈ 3.3 mm) over the photo and its margin; background #f2f2f2',
      data: { source: 'Generated over the frame' },
    },
    landform: {
      symbol: fillArea('1 = VLU', '#1d1d9a', 0.55, [{ color: '#cf212e', width: 0.75, ...round }]),
      spec: 'Outline red (median #cf212e) ≈ 1 px; interior tinted dark blue (sky reads #2a2d7a)',
      data: { source: 'Landform' },
    },
    proposedBlock: {
      symbol: fillArea('2 = Proposed Alteration', '#9ec6e6', 0.5, [{ color: '#2ab146', width: 0.75, ...round }]),
      spec: 'Outline green (median #2ab146), light blue-grey tint (#718eab over the photo)',
      data: { source: 'Proposed blocks' },
    },
    existingNonVeg: {
      symbol: fillArea('3 / 4 = Non Veg State', '#e8a6f0', 0.4, [{ color: '#bf26d3', width: 0.9, ...round }]),
      spec: 'Outline magenta (median #bf26d3), pink tint',
      data: { source: 'Existing openings' },
    },
    rockNonVeg: {
      symbol: fillArea('5 = Rock', '#c9a6e8', 0.4, [{ color: '#b025c5', width: 0.9, ...round }]),
      spec: 'Outline purple (median #b025c5)',
      data: { source: 'VRI rank-1 non-vegetated land (BCLCS_LEVEL_1 = N, BCLCS_LEVEL_2 = L), live from DataBC' },
    },
  },
  labels: {
    block: {
      size: 6,
      color: WHITE,
      box: { kind: 'area', label: 'Number tag', fill: '#1f0a2b', outline: [] },
      spec: 'Number tag: dark box ≈ 12 px (6.5 pt) with the number in the polygon colour; legend chip dark #222 with coloured numbers and white "241.32 cm²"',
    },
  },
  legend: {
    where: 'inset-top-left',
    entry: { size: 5.5, color: WHITE },
    swatch: { w: 0, h: 0, gap: 4 },
    rowPitch: 10.5,
    box: { kind: 'area', label: 'Area chip', fill: '#222222', outline: [] },
    order: [
      { role: 'landform', label: '1  {landformArea}' },
      { role: 'proposedBlock', label: '2  {proposedArea}' },
      { role: 'existingNonVeg', label: '3  {nonVegArea}' },
      { role: 'rockNonVeg', label: '5  {rockArea}' },
    ],
  },
  calc: {
    title: { text: 'VP {n}', size: 9.5, style: 'bold', color: BLACK },
    line: { size: 9.5, style: 'bold', color: BLACK },
    align: 'left',
    lines: [
      '1 = VLU | {landformArea}',
      '2 = Proposed Alteration | {proposedArea}',
      '3 / 4 = Non Veg State | {nonVegArea}',
      '5 = Rock | {rockArea}',
      'Net VLU | {netArea}',
      'Alteration | {alterationArea} | {totalPct}',
    ],
  },
  gaps: [
    'Table header row grey (#c0c0c0); cells 0.75 pt black rules. PGMaps composes the area table but not the grid margin.',
  ],
}

// ---------------------------------------------------------------- family G: forest-plan time-step sheets

export const TIME_STEP_RAMPS: ViaStylePreset = {
  id: 'time-step-ramps',
  name: 'Forest-plan time-step sheet · felling-phase and species ramps',
  family: 'G',
  sources: ['25 p1–18 (Appendix 10, legend on p1), 24 p1–4 (legend on p2); swatches sampled from 150 dpi renders'],
  tone: 'colour',
  symbols: {
    neighbouringWoodland: {
      symbol: fillArea('Neighbouring woodland', '#838a86'),
      spec: '#838a86 (25) / #848a88 (24). Title strip: "Woodland outside the landholding is shown in GREY." Times Bold with GREY in the swatch grey',
      data: { missing: 'Ownership boundary of the planning unit.' },
    },
  },
  legend: {
    where: 'side-panel',
    entry: { size: 6.5, color: '#231f20' },
    swatch: { w: 22, h: 15, gap: 7 },
    rowPitch: 19.5,
    box: { kind: 'area', label: 'Legend panel', fill: WHITE, outline: [{ color: '#231f20', width: 0.75 }] },
    order: [],
  },
  ramps: [
    {
      id: 'felling-phase',
      title: 'Felling Phases @ {year}',
      spec: 'Sixteen classes, 25 p1 legend (sampled; the "Clearfell with seed trees" swatch is a dot pattern)',
      classes: [
        { label: 'Felled or fell year requires review', color: '#d6358e' },
        { label: 'Phase 1: < 5 years', color: '#e71d26' },
        { label: 'Phase 2: between 5 and 9 years', color: '#f69f25' },
        { label: 'Phase 3: between 10 and 14 years', color: '#f9ed0d' },
        { label: 'Phase 4: between 15 and 19 years', color: '#88c545' },
        { label: 'Phase 5: between 20 and 24 years', color: '#2e824b' },
        { label: 'Phase 6: between 25 and 29 years', color: '#0094bf' },
        { label: 'Phase 7: between 30 and 34 years', color: '#835a35' },
        { label: 'Phase 8: 35 years and greater', color: '#d0edfa' },
        { label: 'Clearfell with seed trees', color: '#c5a4ca', pattern: 'dots #a0559a on #c5a4ca' },
        { label: 'Low Impact Silviculture', color: '#c19bc7' },
        { label: 'Minimum Intervention', color: '#a91e85' },
        { label: 'Natural Reserve', color: '#203676' },
        { label: 'Long Term Retention', color: '#492a7b' },
        { label: 'Other/Open land', color: '#ebedc8' },
        { label: 'Neighbouring woodland', color: '#838a86' },
      ],
    },
    {
      id: 'species',
      title: 'Visualisation of Future Habitat and Species',
      spec: 'Fourteen classes, 24 p2 legend (sampled). The render itself uses darker, shaded versions of these',
      classes: [
        { label: 'Sitka spruce', color: '#54bfe1' },
        { label: 'Norway spruce', color: '#a4d2ef' },
        { label: 'Scots pine', color: '#83b86b' },
        { label: 'Lodgepole pine', color: '#b3d25a' },
        { label: 'Larch', color: '#fcc646' },
        { label: 'Douglas fir', color: '#e6eaa5' },
        { label: 'Mixed conifers', color: '#5883ba' },
        { label: 'Ash', color: '#fae8bf' },
        { label: 'Oak', color: '#b7669f' },
        { label: 'Beech', color: '#f08a53' },
        { label: 'Birch', color: '#f9d1cd' },
        { label: 'Mixed broadleaves', color: '#dcb361' },
        { label: 'Native mixed broadleaves', color: '#aa696c' },
        { label: 'Neighbouring woodland', color: '#848a88' },
      ],
    },
  ],
  gaps: [
    'Needs per-stand phase or species attributes, which BC VRI (species) can supply but felling phase cannot (a licensee plan attribute).',
    'The panel layout and the agency branding are not reproduced; only the ramps and the legend form.',
  ],
}

// ---------------------------------------------------------------- family H: small extras

export const EXTRAS: ViaStylePreset = {
  id: 'extras',
  name: 'Small extras · label boxes, flat pink blocks, default-palette outlines, globe-view yellow',
  family: 'H',
  sources: [
    '01 p8–11 (c008–c014)',
    '08 p10–12 (c106–c108)',
    '10, two viewpoints (c576, c577)',
    '16 slide 21 (c599, c600)',
    '17 p18 (c157), p48 (c195)',
  ],
  tone: 'colour',
  symbols: {
    proposedBlock: {
      symbol: fillArea('Block (flat pink)', '#d27fa8'),
      spec: '08: flat pink block fill (median #d27fa8 of 7,049 px), no outline',
      data: { source: 'Proposed blocks' },
    },
    landform: {
      symbol: outlineArea('Landform (default-palette purple)', '#7030a0', 1.5),
      spec: '10: purple ridge/landform line (median #6735a8 ≈ #7030a0); existing openings red (median #d10f14 ≈ #c00000); proposed blocks blue (median #4976c7 ≈ #4472c4)',
      data: { source: 'Landform' },
    },
    existingNonVeg: {
      symbol: outlineArea('Existing (red)', '#c00000', 1.5),
      spec: '10: red outlines on existing openings (median #d10f14)',
      data: { source: 'Existing openings' },
    },
    vsuLine: {
      symbol: outlineArea('Boundary (globe view)', '#edf42d', 1.5, { dash: [2, 2] }),
      spec: '17: yellow dotted boundary (median #edf42d); 16: yellow cutblock outlines on a globe view',
      data: { source: 'Any boundary' },
    },
  },
  labels: {
    block: {
      size: 9,
      style: 'bold',
      color: BLACK,
      box: { kind: 'area', label: 'Label box', fill: '#f2bcbc', outline: [{ color: '#8b6f6f', width: 0.75 }] },
      leader: { stroke: s(BLACK, 1) },
      spec: '01: "FP4" bold black in a light-red box (#f2bcbc, dark border) with a black 1 pt leader',
    },
  },
  legend: { where: 'none', entry: { size: 9, color: BLACK }, swatch: { w: 0, h: 0, gap: 0 }, rowPitch: 0, order: [] },
  gaps: ['Values sampled from JPEG crops, so colours are ±10 per channel.'],
}

export const VIA_STYLE_PRESETS: readonly ViaStylePreset[] = [
  ANALYSIS_SHEET_MAGENTA,
  ANALYSIS_SHEET_ORANGE,
  ANALYSIS_SHEET_PURPLE,
  ANALYSED_PHOTO_HATCHED_ROCK,
  ANALYSED_PHOTO_ROCK_OUTLINE,
  ANALYSED_PHOTO_PRIVATE_LAND,
  BOARD_TRIPTYCH,
  DISTRICT_GREYSCALE,
  REFERRAL_MONTAGE,
  CALCULATION_ON_PHOTO,
  TIME_STEP_RAMPS,
  EXTRAS,
]

export const presetById = (id: string) => {
  const preset = VIA_STYLE_PRESETS.find((p) => p.id === id)
  if (!preset) throw Error(`No VIA style preset "${id}".`)
  return preset
}

/** The symbols a preset's legend lists, in its order, restricted to roles the scene drew. */
export function legendEntries(preset: ViaStylePreset, drawn: ReadonlySet<ViaRole>) {
  return preset.legend.order.flatMap(({ role, label }) => {
    const entry = preset.symbols[role]
    return entry && drawn.has(role) ? [{ role, label, symbol: { ...entry.symbol, label } as SheetSymbol }] : []
  })
}

/** The preset with `id`, or null: for ids read back from saved state, which may predate a rename. */
export const findPreset = (id: string | null | undefined): ViaStylePreset | null =>
  (id && VIA_STYLE_PRESETS.find((p) => p.id === id)) || null

/** What each role is called wherever PGMaps lists it, independent of any preset's legend wording. */
export const ROLE_NAMES: Record<ViaRole, string> = {
  landform: 'Landform',
  subLandform: 'Sub-landform divider',
  vsuLine: 'Visual sensitivity unit boundary',
  proposedBlock: 'Proposed block',
  existingNonVeg: 'Existing opening (not greened up)',
  privateLand: 'Private land',
  rockNonVeg: 'Rock / non-vegetated',
  treatedGround: 'Treated ground',
  forceConvex: 'Line of force (convex)',
  forceConcave: 'Line of force (concave)',
  areaOfAlteration: 'Area of alteration',
  neighbouringWoodland: 'Neighbouring woodland',
  measureGrid: 'Measurement grid',
}

/**
 * Roles the page has data for and drapes on the road view, in draw order (bottom first). The others
 * (sub-landforms, lines of force, grids, ramps) are export-only or still need data; see the doc.
 */
export const LIVE_ROLES: readonly ViaRole[] = [
  'landform',
  'vsuLine',
  'rockNonVeg',
  'privateLand',
  'existingNonVeg',
  'treatedGround',
  'proposedBlock',
]

/** Presets with at least one role the road view can drape: what the road view's picker offers. */
export const LIVE_PRESETS: readonly ViaStylePreset[] = VIA_STYLE_PRESETS.filter((preset) =>
  LIVE_ROLES.some((role) => preset.symbols[role]),
)

/** Every symbol a preset defines, for registering map images and drawing the gallery. */
export const presetSymbols = (preset: ViaStylePreset): SheetSymbol[] =>
  Object.values(preset.symbols).flatMap((entry) => (entry ? [entry.symbol] : []))
