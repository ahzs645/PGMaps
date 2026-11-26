/** Self-contained, editable SVG composition; no raster input, DOM, network or trace operation. */
import { buildHatchPaths, buildHatchSwatchSvg, DEFAULT_HATCH_OPTIONS, type HatchOptions } from './hatching'
import {
  ARTBOARD,
  CONNECTORS,
  FOREST_MAINLAND,
  HIGHWAYS,
  MAINLAND,
  MAP_LABELS,
  MAP_PALETTE,
  OCEAN,
  smoothPath,
  VANCOUVER_ISLAND,
} from './layout'
import { escapeXml, lettering } from './lettering'
import { ELEMENT_CATALOG as DRAWN_ELEMENTS, type ElementDef } from './symbols'
import { TITLE_STUDY } from './title'

export { buildHatchSwatchSvg, DEFAULT_HATCH_OPTIONS, type HatchOptions }
export { ARTBOARD, MAP_PALETTE } from './layout'
export type { ElementDef } from './symbols'

// A local SVG viewport clips boundary strokes without global clip-path IDs.
// The same symbol can therefore be embedded several times without ID collisions.
const hatchElementBody = (width: number, height: number) =>
  `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden" color="${MAP_PALETTE.hatch}">${buildHatchPaths(width, height)}</svg>`
const HATCH_ELEMENTS: readonly ElementDef[] = [
  {
    id: 'forest-hatch-square',
    title: 'Generated forest hatch square',
    category: 'drafting',
    width: 225,
    height: 225,
    svg: hatchElementBody(225, 225),
    construction:
      'Seeded cubic strokes follow locally varying contour bands, with spacing measured along each band and staggered ends. No raster contours or tiled source swatch.',
  },
  {
    id: 'forest-hatch-strip',
    title: 'Generated forest hatch strip',
    category: 'drafting',
    width: 320,
    height: 90,
    svg: hatchElementBody(320, 90),
    construction:
      'The same anchored stroke field as the square, clipped to a strip. Each mark remains an editable open stroke.',
  },
]
export const ELEMENT_CATALOG: readonly ElementDef[] = [...DRAWN_ELEMENTS, ...HATCH_ELEMENTS, TITLE_STUDY]

function documentStart(width: number, height: number, title: string, description: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>`
}

function layer(id: string, title: string, svg: string): string {
  return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(title)}" aria-label="${escapeXml(title)}">${svg}</g>`
}

export interface CompositionOptions {
  /** White outline outside each letter, in drawing units. */
  labelHalo: number
  /** Draw motifs over the pattern without reserving their rectangular bounds. */
  allowIllustrationOverlap: boolean
}

export const DEFAULT_COMPOSITION_OPTIONS: CompositionOptions = {
  labelHalo: 1.8,
  allowIllustrationOverlap: true,
}

export interface IllustratedMapOptions {
  hatch?: Partial<HatchOptions>
  layers?: { hatching?: boolean; roads?: boolean; symbols?: boolean; labels?: boolean }
  composition?: Partial<CompositionOptions>
  /** Ink-only comparison. This affects the background, never the exported route coordinates. */
  transparentBackground?: boolean
}

export function buildIllustratedMapSvg(options: IllustratedMapOptions = {}): string {
  const layers = { hatching: true, roads: true, symbols: true, labels: true, ...options.layers }
  const hatch = { ...DEFAULT_HATCH_OPTIONS, ...options.hatch }
  const composition = { ...DEFAULT_COMPOSITION_OPTIONS, ...options.composition }
  const placed = DRAWN_ELEMENTS.filter((element) => element.sourceBox && element.category !== 'drafting')
  const inkBox = (box: readonly [number, number, number, number], pad = 2) =>
    `<rect x="${box[0] - pad}" y="${box[1] - pad}" width="${box[2] + pad * 2}" height="${box[3] + pad * 2}" rx="4"/>`
  const clearIcons =
    layers.symbols && !composition.allowIllustrationOverlap
      ? placed
          .filter((element) => element.category === 'illustration')
          .map((element) => inkBox(element.sourceBox!, 2))
          .join('')
      : ''
  let svg = documentStart(
    ARTBOARD.width,
    ARTBOARD.height,
    'Rainforest to Rockies — geometric reconstruction',
    'Reconstructed from semantic drawing components and a procedural hatch field. Reference: Destination BC brand guidelines, page 8. Schematic artwork coordinates, not geographic data. Title is a drawn study, not an official logo master. Place names use supplied Great Forest glyphs.',
  )
  svg += `<metadata>${escapeXml(JSON.stringify({ generator: 'pgmaps-illustrated-map', version: 3, sourcePage: 8, trace: false, coordinates: 'schematic-artboard', hatch, composition }))}</metadata>`
  // Forest coverage and land are independent masks. Their intersection prevents
  // any hatch stroke entering the ocean, even where the two authored edges differ.
  // This clips a freely flowing field; the outline never changes stroke direction.
  svg += `<defs><clipPath id="land-region"><path d="${MAINLAND}"/><path d="${VANCOUVER_ISLAND}"/></clipPath><clipPath id="forest-region"><path d="${FOREST_MAINLAND}"/><path d="${VANCOUVER_ISLAND}"/></clipPath>${clearIcons ? `<mask id="forest-clearances" maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="945"><rect width="1536" height="945" fill="white"/><g fill="black">${clearIcons}</g></mask>` : ''}</defs>`
  if (!options.transparentBackground) {
    svg += layer(
      'surroundings',
      '01 Surrounding land and ocean',
      `<rect width="1536" height="945" fill="${MAP_PALETTE.surrounding}"/><path d="${OCEAN}" fill="${MAP_PALETTE.ocean}"/>`,
    )
    svg += layer(
      'land',
      '02 Mainland and Vancouver Island',
      `<path d="${MAINLAND}" fill="white"/><path d="${VANCOUVER_ISLAND}" fill="white"/>`,
    )
  }
  if (layers.hatching)
    svg += layer(
      'forest-hatching',
      '03 Generated forest strokes',
      `<g clip-path="url(#land-region)"><g clip-path="url(#forest-region)"${clearIcons ? ' mask="url(#forest-clearances)"' : ''} color="${MAP_PALETTE.hatch}">${buildHatchPaths(790, 945, hatch)}</g></g>`,
    )
  if (!options.transparentBackground)
    svg += layer(
      'boundary',
      '04 Southern boundary',
      '<path d="M1440 811H1536" fill="none" stroke="white" stroke-width="3" stroke-dasharray="8 9"/>',
    )
  if (layers.roads) {
    svg += layer(
      'connections',
      '05 Dashed scenic connections',
      `<g fill="none" stroke="${MAP_PALETTE.canopy}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="9 8">${CONNECTORS.map((route) => `<path id="${route.id}" aria-label="${escapeXml(route.title)}" d="${smoothPath(route.points)}"/>`).join('')}</g><g fill="none" stroke="${MAP_PALETTE.emerald}" stroke-width="3.5" stroke-linecap="round"><path d="M950 88L956 93L950 99 M1397 426L1403 431L1397 437 M505 859L514 863L516 854"/></g>`,
    )
    svg += layer(
      'highways',
      '06 Continuous highway centrelines',
      `<g fill="none" stroke="${MAP_PALETTE.emerald}" stroke-width="6.8" stroke-linecap="round" stroke-linejoin="round">${HIGHWAYS.map((route) => `<path id="${route.id}" aria-label="${escapeXml(route.title)}" d="${smoothPath(route.points)}"/>`).join('')}</g><path d="M423 617Q459 616 488 602" fill="none" stroke="${MAP_PALETTE.moss}" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 4"/>`,
    )
  }
  if (layers.symbols) {
    for (const [category, title] of [
      ['tree', '07 Trees from branch and crown rules'],
      ['illustration', '08 Scenic and activity drawings'],
      ['navigation', '09 Compass and route markers'],
    ] as const) {
      svg += layer(
        category,
        title,
        placed
          .filter((element) => element.category === category)
          .map((element) => {
            const [x, y, w, h] = element.sourceBox!
            return `<g id="${element.id}" aria-label="${escapeXml(element.title)}" transform="translate(${x} ${y}) scale(${w / element.width} ${h / element.height})">${element.svg}</g>`
          })
          .join(''),
      )
    }
  }
  if (layers.labels) {
    svg += layer(
      'lettering',
      '10 Great Forest lettering from font glyphs',
      `<g fill="${MAP_PALETTE.canopy}">${MAP_LABELS.map((label) => `<g id="label-${label.id}">${lettering(label.text, label.box, label.face ?? 'smallcaps', label.tracking ?? (label.face === 'regular' ? 35 : 120), composition.labelHalo, label.glyphText)}</g>`).join('')}</g>`,
    )
    svg += layer(
      'title-study',
      '11 Reconstructed title study',
      `<g transform="translate(1057 65)">${TITLE_STUDY.svg}</g>`,
    )
  }
  return svg + '</svg>'
}

export function buildElementSvg(id: string): string {
  const element = ELEMENT_CATALOG.find((entry) => entry.id === id)
  if (!element) throw new Error(`Unknown illustrated-map element: ${id}`)
  // A three-unit margin also contains round caps, so standalone files do not clip their ink.
  return (
    documentStart(element.width + 6, element.height + 6, element.title, element.construction) +
    `<g transform="translate(3 3)">${element.svg}</g></svg>`
  )
}

export function buildElementSheetSvg(): string {
  const cols = 6
  const cellWidth = 250
  const cellHeight = 190
  const height = 104 + Math.ceil(ELEMENT_CATALOG.length / cols) * cellHeight
  let svg = documentStart(
    cols * cellWidth + 48,
    height,
    'Reconstructed map element catalogue',
    'Every motif is rebuilt from geometric components. Hatching is generated. No image tracing is used.',
  )
  svg +=
    '<rect width="100%" height="100%" fill="#F6F7F3"/><g font-family="Arial,sans-serif" fill="#00392F"><text x="32" y="39" font-size="25" font-weight="700">Rainforest to Rockies / reconstructed elements</text><text x="32" y="65" font-size="14">Geometric components · editable strokes · generated hatching · no traced contours</text></g>'
  ELEMENT_CATALOG.forEach((element, i) => {
    const x = 24 + (i % cols) * cellWidth
    const y = 86 + Math.floor(i / cols) * cellHeight
    const scale = Math.min(205 / element.width, 115 / element.height, 2.1)
    const bg = element.id.startsWith('wave-') ? MAP_PALETTE.ocean : '#FFFFFF'
    svg += `<g transform="translate(${x} ${y})"><rect width="238" height="178" rx="8" fill="${bg}" stroke="#D8DFD9"/><g transform="translate(${119 - (element.width * scale) / 2} ${12 + (118 - element.height * scale) / 2}) scale(${scale})">${element.svg}</g><g fill="#00392F" font-family="Arial,sans-serif"><text x="12" y="148" font-size="12" font-weight="700">${escapeXml(element.title)}</text><text x="12" y="166" font-size="11" fill="#52665B">${escapeXml(element.category)} · ${escapeXml(element.id)}</text></g></g>`
  })
  return svg + '</svg>'
}

/** Preserve the swatch's colour and local viewport when embedding it in another SVG. */
export const hatchSwatchBody = (options?: Partial<HatchOptions>) => buildHatchSwatchSvg(options)
