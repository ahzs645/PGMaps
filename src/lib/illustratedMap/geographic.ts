/** Geographic land/roads with the reconstructed page 8 illustration style. */
import data from './geography.generated.json'
import {
  buildHatchPaths,
  buildPatchHatchPaths,
  DEFAULT_HATCH_OPTIONS,
  DEFAULT_PAGE8_HATCH_OPTIONS,
  type PatchHatchStyleOptions,
} from './hatching'
import { DEFAULT_COMPOSITION_OPTIONS, type IllustratedMapOptions } from './index'
import { MAP_PALETTE } from './layout'
import { escapeXml, lettering, letteringSize } from './lettering'
import { ELEMENT_CATALOG, evergreenMarkup, mossTreeMarkup } from './symbols'
import { TITLE_STUDY } from './title'

export interface GeographicMapOptions extends IllustratedMapOptions {
  coverage?: 'coastal' | 'northern' | 'province'
  /**
   * `contour` (the default) is the continuous banded field every earlier export used. `patch` is
   * the page 8 reference's own texture, drawn patch by patch with `patchHatch` settings.
   */
  hatchStyle?: 'contour' | 'patch'
  patchHatch?: Partial<PatchHatchStyleOptions>
}

export const DEFAULT_GEOGRAPHIC_OPTIONS = { coverage: 'coastal' as const }
export const GEOGRAPHIC_MAP_INFO = {
  projection: 'EPSG:3005 — NAD83 / BC Albers',
  coverageDescription:
    'Coastal style uses the broad CWH, MH and CDF biogeoclimatic regions. Northern BC adds a broad authored northwestern field like the page 8 reference, within the same regional map frame. All BC land fills the visible province. Every coverage uses the same geographic land mask; the hatch is decorative.',
  attribution: [
    'Shoreline: GSHHG. Inland water: GSHHG and BC Freshwater Atlas.',
    'Province boundaries and Canadian highways: Statistics Canada. I-5: Washington State Department of Transportation.',
    'Place names: Canadian Geographical Names Database and US Census Bureau.',
    'Coastal style region: British Columbia BEC v13.1.',
  ],
  sources: [
    { title: 'GSHHG shoreline data', url: 'https://www.soest.hawaii.edu/pwessel/gshhg/' },
    {
      title: 'BC Freshwater Atlas lakes',
      url: 'https://catalogue.data.gov.bc.ca/dataset/cb1e3aba-d3fe-4de1-a2d4-b8b6650fb1f6',
    },
    { title: 'Statistics Canada geographic data', url: 'https://www.statcan.gc.ca/en/subjects-start/geography' },
    { title: 'Canadian Geographical Names Database', url: 'https://geonames.nrcan.gc.ca/' },
    { title: 'WSDOT state route data', url: 'https://data.wsdot.wa.gov/geospatial/DOT_TDO/LRS/24kLRS.htm' },
  ],
} as const

export const GEOGRAPHIC_MAP_RECORD = {
  projection: data.projection,
  info: GEOGRAPHIC_MAP_INFO,
  provenance: data.provenance,
  counts: {
    landPolygons: data.land.polygons,
    lakeHoles: data.land.holes,
    routeGroups: data.roads.length,
    placeAnchors: data.places.length,
  },
  shields: data.shields,
  checkpoints: data.checkpoints,
}

const { width, height } = data.artboard
const n = (value: number) => Number(value.toFixed(3))
const elementById = new Map(ELEMENT_CATALOG.map((element) => [element.id, element]))
type Point = readonly number[]

function layer(id: string, title: string, body: string) {
  return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(title)}" aria-label="${escapeXml(title)}">${body}</g>`
}

function start(title: string, description: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>`
}

function resources(coverage: NonNullable<GeographicMapOptions['coverage']>) {
  // These exact path objects paint the land and clip its hatching. They never
  // carry an inset, stroke, smoothing curve or independently fitted coastline.
  // Sibling clip shapes form a union. Combining their d strings in one
  // even-odd path would instead cut holes where the two style regions overlap.
  const styleClip =
    coverage === 'province'
      ? ''
      : `<clipPath id="geo-style-clip" clipPathUnits="userSpaceOnUse"><path d="${data.coastalCoverage.d}" fill-rule="evenodd" clip-rule="evenodd"/>${coverage === 'northern' ? `<path id="geo-northern-style-extent" d="${NORTHERN_REFERENCE_COVERAGE.d}"/>` : ''}</clipPath>`
  return `<defs><path id="geo-land-geometry" d="${data.land.d}" fill-rule="evenodd" clip-rule="evenodd"/><path id="geo-bc-land-geometry" d="${data.bcLand.d}" fill-rule="evenodd" clip-rule="evenodd"/><clipPath id="geo-land-clip" clipPathUnits="userSpaceOnUse"><use href="#geo-bc-land-geometry" xlink:href="#geo-bc-land-geometry" fill-rule="evenodd" clip-rule="evenodd"/></clipPath>${styleClip}<clipPath id="geo-frame-clip"><rect width="${width}" height="${height - data.projection.footer}"/></clipPath></defs>`
}

function symbol(id: string, point: Point, scale: number, offset: Point = [0, 0], anchor: Point = [0.5, 0.5]) {
  const element = elementById.get(id)
  if (!element) throw new Error(`Missing geographic illustration: ${id}`)
  const x = point[0] + offset[0] - element.width * scale * anchor[0]
  const y = point[1] + offset[1] - element.height * scale * anchor[1]
  return `<g data-symbol="${id}" transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})">${element.svg}</g>`
}

type Place = (typeof data.places)[number]
function place(id: string): Place | undefined {
  return data.places.find((p) => p.id === id)
}

/**
 * A composed northern field, not a forest boundary or traced source contour.
 * Three broad cubic bends connect the north cap, the area west of Mount Robson,
 * and the bear/Whistler transition. The existing coast region continues south.
 * Only the outer geographic land clip supplies coastlines and water holes.
 */
export const NORTHERN_REFERENCE_COVERAGE = (() => {
  const robson = (place('mount-robson-peak') ?? place('mount-robson'))!.point
  const kamloops = place('kamloops')!.point
  const whistler = place('whistler')!.point
  const p = (x: number, y: number) => `${n(x)} ${n(y)}`
  return {
    kind: 'authored-reference-style',
    anchors: ['mount-robson', 'kamloops', 'whistler'],
    right: robson[0] - 42,
    d: `M-32 -32 H${n(robson[0] - 70)} C${p(robson[0] - 42, robson[1] - 190)} ${p(robson[0] - 105, robson[1] - 64)} ${p(robson[0] - 85, robson[1] + 28)} C${p(robson[0] - 56, robson[1] + 145)} ${p(kamloops[0] - 80, kamloops[1] - 127)} ${p(kamloops[0] - 151, kamloops[1] - 97)} C${p(whistler[0] + 24, kamloops[1] - 34)} ${p(whistler[0] - 61, whistler[1] - 110)} ${p(whistler[0] - 90, whistler[1] - 36)} H-32 Z`,
  } as const
})()

function label(
  text: string,
  point: Point,
  offset: Point,
  halo: number,
  align: 'left' | 'center' | 'right' = 'left',
  emSize = 23.923,
  face: 'smallcaps' | 'regular' = 'smallcaps',
  glyphText = text.toUpperCase(),
) {
  const size = letteringSize(text, emSize, face, glyphText)
  const x = point[0] + offset[0] - size.width * (align === 'left' ? 0 : align === 'center' ? 0.5 : 1)
  const y = point[1] + offset[1]
  return lettering(text, [x, y, size.width, size.height], face, 0, halo, glyphText)
}

const PLACE_LABELS = [
  { id: 'vancouver', text: 'VANCOUVER', offset: [-17, 10], align: 'right' },
  { id: 'victoria', text: 'VICTORIA', offset: [17, 10] },
  { id: 'kamloops', text: 'KAMLOOPS', offset: [15, -3] },
  { id: 'golden', text: 'GOLDEN', offset: [-16, 12], align: 'right' },
  { id: 'fernie', text: 'FERNIE', offset: [15, 8] },
  { id: 'jasper', text: 'JASPER', offset: [12, -18] },
  { id: 'edmonton', text: 'EDMONTON', offset: [11, 9] },
  { id: 'banff', text: 'BANFF', offset: [11, -16] },
  { id: 'calgary', text: 'CALGARY', offset: [12, 9] },
  { id: 'seattle', text: 'SEATTLE', offset: [12, -8] },
  { id: 'hope', text: 'HOPE', offset: [-10, 12], align: 'right', secondary: true },
  { id: 'whistler', text: 'WHISTLER', offset: [-12, 4], align: 'right', secondary: true },
  { id: 'revelstoke', text: 'REVELSTOKE', offset: [15, 4], secondary: true },
  { id: 'kelowna', text: 'KELOWNA', offset: [11, 10], secondary: true },
  { id: 'cranbrook', text: 'CRANBROOK', offset: [-8, 12], align: 'right', secondary: true },
] as const

function locations(halo: number, drawSymbols: boolean, drawLabels: boolean) {
  let symbols = '',
    labels = ''
  const destinationFlags: Record<string, string> = { golden: 'flag-golden', fernie: 'flag-fernie' }
  for (const definition of PLACE_LABELS) {
    const p = place(definition.id)
    if (!p) continue
    if (drawSymbols) {
      let mark = ''
      if (p.id === 'vancouver') mark = symbol('pin-vancouver', p.point, 0.72, [0, 0], [0.5, 0.94])
      else if (p.id === 'victoria') mark = symbol('mile-zero-leaf', p.point, 0.7, [0, -4], [0.5, 0.82])
      else if (p.id === 'kamloops') mark = symbol('dot-kamloops', p.point, 0.7)
      else if (destinationFlags[p.id]) mark = symbol(destinationFlags[p.id], p.point, 0.66, [0, 0], [18 / 68, 82 / 95])
      else
        mark = `<circle cx="${p.point[0]}" cy="${p.point[1]}" r="3.3" fill="${MAP_PALETTE.canopy}" stroke="white" stroke-width="2"/>`
      symbols += `<g id="geo-place-${p.id}" data-longitude="${p.coordinate[0]}" data-latitude="${p.coordinate[1]}" aria-label="${escapeXml(p.name)}">${mark}</g>`
    }
    if (drawLabels)
      labels += `<g id="geo-label-${p.id}">${label(definition.text, p.point, definition.offset, halo, 'align' in definition ? definition.align : 'left', 'secondary' in definition ? 19 : 23.923)}</g>`
  }
  const robson = place('mount-robson-peak') ?? place('mount-robson')
  if (robson) {
    if (drawSymbols)
      symbols += `<g id="geo-place-mount-robson">${symbol('flag-mount-robson', robson.point, 0.66, [0, 0], [18 / 68, 82 / 95])}</g>`
    if (drawLabels)
      labels += `<g id="geo-label-mount-robson">${label('MOUNT', robson.point, [-13, -26], halo, 'right')}${label('ROBSON', robson.point, [-13, -10], halo, 'right')}</g>`
  }
  return { symbols, labels }
}

function footer() {
  const y = height - data.projection.footer
  const scaleBar = 100000 * data.projection.scale
  return layer(
    'geo-cartographic-furniture',
    'Cartographic scale and sources',
    `<rect y="${y}" width="${width}" height="${data.projection.footer}" fill="white"/><g fill="${MAP_PALETTE.canopy}" font-family="Arial,sans-serif" font-size="10"><text x="18" y="${y + 15}">Coast: GSHHG · Lakes: GSHHG / BC FWA · Roads: StatCan / WSDOT · Places: CGNDB / US Census · Coastal style: BEC</text><text x="18" y="${y + 29}">BC Albers · Geographic features share one projection and scale · Illustrations are regional motifs</text></g><g transform="translate(${width - scaleBar - 24} ${y + 15})" fill="none" stroke="${MAP_PALETTE.canopy}" stroke-width="1.5"><path d="M0 -4V3H${n(scaleBar)}V-4 M${n(scaleBar / 2)} 0V3"/></g><g fill="${MAP_PALETTE.canopy}" font-family="Arial,sans-serif" font-size="10"><text x="${width - scaleBar - 24}" y="${y + 29}">0</text><text x="${width - 24}" y="${y + 29}" text-anchor="end">100 km</text></g>`,
  )
}

export function buildGeographicMapSvg(options: GeographicMapOptions = {}): string {
  const coverage = options.coverage ?? DEFAULT_GEOGRAPHIC_OPTIONS.coverage
  const layers = { hatching: true, roads: true, symbols: true, labels: true, ...options.layers }
  const composition = { ...DEFAULT_COMPOSITION_OPTIONS, ...options.composition }
  const hatchStyle = options.hatchStyle ?? 'contour'
  const hatch = { ...DEFAULT_HATCH_OPTIONS, ...options.hatch }
  const patchHatch = { ...DEFAULT_PAGE8_HATCH_OPTIONS, ...options.patchHatch }
  let svg = start(
    'Rainforest to Rockies — geographic illustration',
    'Real geographic shoreline, lake holes, province regions, highway centrelines and place coordinates projected together to BC Albers. Reconstructed page 8 symbols, glyph lettering and generated hatching provide the illustration style. Motifs are decorative regional illustrations. The title is a reconstructed study.',
  )
  svg += `<metadata>${escapeXml(JSON.stringify({ generator: 'pgmaps-geographic-illustrated-map', version: 1, trace: false, coordinates: 'EPSG:3005', projection: data.projection, coverage, ...(hatchStyle === 'patch' ? { hatchStyle, patchHatch } : { hatch }), composition, provenance: data.provenance, ...(coverage === 'northern' ? { coverageStyle: NORTHERN_REFERENCE_COVERAGE } : {}) }))}</metadata>`
  svg += resources(coverage)
  if (!options.transparentBackground) {
    svg += layer(
      'geo-ocean',
      '01 Ocean and inland water',
      `<rect width="${width}" height="${height}" fill="${MAP_PALETTE.ocean}"/>`,
    )
    svg += layer(
      'geo-land',
      '02 Geographic dry land',
      `<use href="#geo-land-geometry" xlink:href="#geo-land-geometry" fill="${MAP_PALETTE.surrounding}"/><use href="#geo-bc-land-geometry" xlink:href="#geo-bc-land-geometry" fill="white"/>`,
    )
  }
  svg += '<g clip-path="url(#geo-frame-clip)">'
  if (layers.hatching) {
    const bounds = coverage === 'coastal' ? data.coastalLand.bounds : data.bcLand.bounds
    const right =
      coverage === 'northern' ? Math.max(data.coastalLand.bounds[2], NORTHERN_REFERENCE_COVERAGE.right) : bounds[2]
    const fieldWidth = Math.max(1, Math.min(width, Math.ceil(right + 8)))
    const clearances =
      !composition.allowIllustrationOverlap && layers.symbols
        ? data.motifs
            .map((motif) => {
              const element = elementById.get(motif.id)!
              const offset = 'offset' in motif ? motif.offset : [0, 0]
              return `<rect x="${n(motif.point[0] + offset[0] - (element.width * motif.scale) / 2 - 2)}" y="${n(motif.point[1] + offset[1] - (element.height * motif.scale) / 2 - 2)}" width="${n(element.width * motif.scale + 4)}" height="${n(element.height * motif.scale + 4)}" rx="3"/>`
            })
            .join('')
        : ''
    if (clearances)
      svg += `<defs><mask id="geo-illustration-clearances" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><g fill="black">${clearances}</g></mask></defs>`
    svg += layer(
      'geo-forest-hatching',
      '03 Generated hatching clipped to geographic land',
      `<g clip-path="url(#geo-land-clip)"><g${coverage !== 'province' ? ' clip-path="url(#geo-style-clip)"' : ''}${clearances ? ' mask="url(#geo-illustration-clearances)"' : ''} color="${MAP_PALETTE.hatch}">${hatchStyle === 'patch' ? buildPatchHatchPaths(fieldWidth, height - data.projection.footer, patchHatch) : buildHatchPaths(fieldWidth, height - data.projection.footer, hatch)}</g></g>`,
    )
  }
  if (layers.roads) {
    const paths = (role: string) =>
      data.roads
        .filter((road) => road.role === role)
        .map(
          (road) =>
            `<path id="geo-road-${road.id}" data-route="${escapeXml(road.route)}" data-jurisdiction="${road.jurisdiction}" d="${road.d}"/>`,
        )
        .join('')
    svg += layer(
      'geo-supporting-highways',
      '04 Supporting highways from NRN and WSDOT',
      `<g fill="none" stroke="white" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round">${data.roads
        .filter((road) => road.role === 'supporting')
        .map((road) => `<path d="${road.d}"/>`)
        .join(
          '',
        )}</g><g fill="none" stroke="${MAP_PALETTE.canopy}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 6">${paths('supporting')}</g>`,
    )
    svg += layer(
      'geo-primary-highways',
      '05 Primary highways from NRN',
      `<g fill="none" stroke="white" stroke-width="7.8" stroke-linecap="round" stroke-linejoin="round">${data.roads
        .filter((road) => road.role === 'primary')
        .map((road) => `<path d="${road.d}"/>`)
        .join(
          '',
        )}</g><g fill="none" stroke="${MAP_PALETTE.emerald}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">${paths('primary')}</g>`,
    )
  }
  const placed = locations(composition.labelHalo, layers.symbols, layers.labels)
  if (layers.symbols) {
    svg += layer(
      'geo-trees',
      '06 Decorative trees',
      data.trees
        .map(
          (tree) =>
            `<g id="${tree.id}" transform="translate(${n(tree.point[0] - 12)} ${n(tree.point[1] - 18)})">${tree.moss ? mossTreeMarkup(24, 33, tree.phase, MAP_PALETTE.moss, true) : evergreenMarkup(24, 33, tree.phase)}</g>`,
        )
        .join(''),
    )
    svg += layer(
      'geo-illustrations',
      '07 Decorative regional illustrations',
      data.motifs
        .map(
          (motif) =>
            `<g id="geo-motif-${motif.id}">${symbol(motif.id, motif.point, motif.scale, 'offset' in motif ? motif.offset : [0, 0])}</g>`,
        )
        .join(''),
    )
    svg += layer(
      'geo-route-markers',
      '08 Route markers on real centrelines',
      data.shields
        .map(
          (shield) =>
            `<g id="geo-${shield.id}" data-route="${shield.route}" data-longitude="${shield.coordinate[0]}" data-latitude="${shield.coordinate[1]}">${symbol(shield.id, shield.point, 0.72)}</g>`,
        )
        .join(''),
    )
    svg += layer('geo-destinations', '09 Geographic destination markers', placed.symbols)
    svg += layer(
      'geo-compass',
      '10 Compass and geographic BC inset',
      `<g transform="rotate(${n(data.projection.northArrowRotationDegrees)} 155 165)">${symbol('compass-bc', [155, 165], 0.72)}</g>`,
    )
  }
  if (layers.labels) {
    svg += layer(
      'geo-lettering',
      '11 Great Forest place lettering',
      `<g fill="${MAP_PALETTE.canopy}">${placed.labels}${label('RAINFOREST', [260, 790], [0, 0], composition.labelHalo, 'center', 36.728, 'regular', 'RaInFOrEsT')}${label('CANADIAN', [1270, 525], [0, 0], composition.labelHalo, 'center', 36.728, 'regular', 'cANaDIAn')}${label('ROCKIES', [1270, 568], [0, 0], composition.labelHalo, 'center', 36.728, 'regular', 'RoCkIeS')}${label('ALBERTA', [1390, 395], [0, 0], composition.labelHalo, 'center')}${label('USA', [1070, 935], [0, 0], composition.labelHalo, 'center')}</g>`,
    )
    svg += layer(
      'geo-title-study',
      '12 Reconstructed title study',
      `<g transform="translate(1110 38) scale(.88)">${TITLE_STUDY.svg}</g>`,
    )
  }
  svg += '</g>'
  if (!options.transparentBackground) svg += footer()
  return svg + '</svg>'
}

/** A literal binary dry-land mask, including inland water holes and islands. */
export function buildGeographicLandMaskSvg(): string {
  return (
    start(
      'Geographic dry-land mask',
      'Black is dry land; white is ocean or inland water. This is the same geographic path used by the styled map, with no inward offset.',
    ) +
    `<rect width="${width}" height="${height}" fill="white"/><path d="${data.land.d}" fill="black" fill-rule="evenodd" clip-rule="evenodd"/></svg>`
  )
}
