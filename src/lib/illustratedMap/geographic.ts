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
import { escapeXml, lettering, letteringSize, type LetteringFont, type LetteringSource } from './lettering'
import {
  COMPASS_INSET_FROM_ALBERS,
  compassWithInsetAccent,
  compassWithLettering,
  ELEMENT_CATALOG,
  evergreenMarkup,
  mossTreeMarkup,
} from './symbols'
import { TITLE_STUDY } from './title'

export interface GeographicMapOptions extends IllustratedMapOptions {
  /**
   * `page8` hatches all of BC west and north of page 8's journey region and leaves that region
   * white, as the reference does; the compass inset colours the same region.
   */
  coverage?: 'coastal' | 'northern' | 'province' | 'page8'
  /** `page8` draws only the place names page 8 prints; `all` (the default) adds the secondary towns. */
  labelSet?: 'all' | 'page8'
  /**
   * `contour` (the default) is the continuous banded field every earlier export used. `patch` is
   * the page 8 reference's own texture, drawn patch by patch with `patchHatch` settings.
   */
  hatchStyle?: 'contour' | 'patch'
  patchHatch?: Partial<PatchHatchStyleOptions>
  /**
   * Drawing units of water kept along every shore, half each side of the coastline, so channels
   * narrower than a pixel at this scale still read as water: Vancouver Island is apart from the
   * mainland, the Discovery Islands from each other. It masks the land and its hatch; the land
   * path itself is unchanged. 0 (the default) is the geometry as it is.
   */
  channelGap?: number
  /**
   * Draw the channel gap, the compass clearance and the illustration clearances with clip paths
   * and a water-coloured stroke instead of SVG masks. It looks the same, but print and PDF
   * converters (Chromium among them) keep it as vectors: masks there become images. Off by
   * default, so earlier exports stay byte for byte as they were.
   */
  vectorMasks?: boolean
  /**
   * `false` fills every lake as dry land: no lake holes in the land, its hatch or the channel gap.
   * The coastline and the islands stay. `true` (the default) keeps the lakes as water.
   */
  lakes?: boolean
  /**
   * Leave out islands smaller than this many square kilometres (land, its hatch and the channel
   * gap). At this scale a square kilometre is about one drawing unit square: 94% of the frame's
   * 6,289 land rings are smaller, together 0.03% of the land. 0 (the default) keeps them all.
   */
  minIslandKm2?: number
  /** Fill lakes smaller than this many square kilometres as land. 0 (the default) keeps them all. */
  minLakeKm2?: number
  /**
   * Road stretches left off the map: each names a road (`bc-1`) and a place, and the road's parts
   * on the landmass holding that place are not drawn. `{ road: 'bc-1', landmassOf: 'victoria' }`
   * is Highway 1 on Vancouver Island, Victoria to Nanaimo.
   */
  hiddenRoads?: readonly HiddenRoadStretch[]
  /** `smallcaps` sets the compass's BC in Great Forest Small Caps; `badge` (the default) in its badge letters. */
  compassLettering?: 'badge' | 'smallcaps'
  /**
   * Fonts the map letters in, from a map theme (`mapTheme.ts`). `places`: place names, ALBERTA and
   * USA, and the compass's Small Caps BC (Great Forest Small Caps when absent). `regions`:
   * RAINFOREST and CANADIAN ROCKIES (Great Forest Simplified). Both are drawn as outlines. `body`:
   * the footer's text, embedded in the SVG as a font (Arial when absent).
   */
  lettering?: { places?: LetteringFont; regions?: LetteringFont; body?: { family: string; src: string } }
}

export interface HiddenRoadStretch {
  road: string
  landmassOf: string
}

/** Highway 1 on Vancouver Island, from Victoria north to Nanaimo. */
export const VANCOUVER_ISLAND_HIGHWAY_1: HiddenRoadStretch = { road: 'bc-1', landmassOf: 'victoria' }

/** The channel gap the workshop starts with: about a kilometre on the ground at this scale. */
export const DEFAULT_CHANNEL_GAP = 1.2

/** Page 8 as a whole: its coverage, its patch hatch, its labels, with channels kept open. */
export const PAGE8_EDITION = {
  coverage: 'page8',
  hatchStyle: 'patch',
  channelGap: DEFAULT_CHANNEL_GAP,
  labelSet: 'page8',
  vectorMasks: true,
  hiddenRoads: [VANCOUVER_ISLAND_HIGHWAY_1],
  compassLettering: 'smallcaps',
  minIslandKm2: 1,
  minLakeKm2: 2,
} as const satisfies GeographicMapOptions

/** A rounded rectangle as one path, so it can be cut out of an even-odd clip. */
const roundedRectPath = (x: number, y: number, w: number, h: number, r: number) =>
  `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`

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

/** The signed area of a subpath's points (`x,y` pairs); outer rings and lake holes have opposite signs. */
function subpathArea(subpath: string) {
  const values = subpath.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
  let area = 0
  for (let i = 0; i + 1 < values.length; i += 2) {
    const j = i + 2 < values.length - 1 ? i + 2 : 0
    area += values[i] * values[j + 1] - values[j] * values[i + 1]
  }
  return area / 2
}

/** What a land path keeps: its lakes, and its islands and lakes by size. */
export interface LandFilter {
  /** `false` fills every lake as land. */
  lakes?: boolean
  /** Islands (outer rings) smaller than this many square kilometres are left out. */
  minIslandKm2?: number
  /** Lakes smaller than this many square kilometres are filled as land. */
  minLakeKm2?: number
}

/** Square kilometres to square drawing units at the map's one scale. */
const km2ToUnits = (km2: number) => km2 * 1e6 * data.projection.scale ** 2

const filteredPaths = new Map<string, string>()
/**
 * A land path as drawn: as built (lakes as holes), or filtered. The build writes outer rings and
 * holes with opposite windings (`polygons` and `holes` in the data count them), so a lake is a
 * subpath whose winding is the other way. A filled lake also takes the islands in it, which would
 * otherwise keep a shoreline (and a channel gap) in the middle of dry land; an island left out
 * takes its own lakes. `true` / `false` are `{ lakes }`.
 */
export function landPath(kind: 'land' | 'bcLand', filter: boolean | LandFilter = {}): string {
  const { lakes = true, minIslandKm2 = 0, minLakeKm2 = 0 } = typeof filter === 'boolean' ? { lakes: filter } : filter
  if (lakes && minIslandKm2 <= 0 && minLakeKm2 <= 0) return data[kind].d
  const key = `${kind}:${lakes}:${minIslandKm2}:${minLakeKm2}`
  let d = filteredPaths.get(key)
  if (d === undefined) {
    const [minIsland, minLake] = [km2ToUnits(minIslandKm2), km2ToUnits(minLakeKm2)]
    const subpaths = data[kind].d.split(/(?=M)/).map((text) => {
      const values = text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
      for (let i = 0; i + 1 < values.length; i += 2) {
        x0 = Math.min(x0, values[i])
        x1 = Math.max(x1, values[i])
        y0 = Math.min(y0, values[i + 1])
        y1 = Math.max(y1, values[i + 1])
      }
      return { text, values, area: subpathArea(text), box: [x0, y0, x1, y1] }
    })
    type Subpath = (typeof subpaths)[number]
    const within = ([x, y]: number[], rings: Subpath[]) =>
      rings.some(({ values, box }) => {
        if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return false
        let hit = false
        for (let i = 0, j = values.length - 2; i + 1 < values.length; j = i, i += 2)
          if (
            values[i + 1] > y !== values[j + 1] > y &&
            x < ((values[j] - values[i]) * (y - values[i + 1])) / (values[j + 1] - values[i + 1]) + values[i]
          )
            hit = !hit
        return hit
      })
    const filled = subpaths.filter(({ area }) => area < 0 && (!lakes || -area < minLake))
    const dropped = subpaths.filter(({ area }) => area > 0 && area < minIsland)
    d = subpaths
      .filter((subpath) =>
        subpath.area > 0
          ? subpath.area >= minIsland && !within(subpath.values, filled)
          : lakes && -subpath.area >= minLake && !within(subpath.values, filled) && !within(subpath.values, dropped),
      )
      .map((subpath) => subpath.text)
      .join('')
    filteredPaths.set(key, d)
  }
  return d
}

type Box = { x: number; y: number; w: number; h: number }
/** A run of a ring's edges (vertex indices `from` to `to`, each joined to the vertex before it) and their box. */
type EdgeRun = { from: number; to: number; box: Box }
let outerLandRings: { ring: number[]; box: Box; runs: EdgeRun[] }[] | null = null
const EDGE_RUN = 64
const boxOf = (ring: number[], from: number, to: number): Box => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = from; i < to; i += 2) {
    x0 = Math.min(x0, ring[i])
    x1 = Math.max(x1, ring[i])
    y0 = Math.min(y0, ring[i + 1])
    y1 = Math.max(y1, ring[i + 1])
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
/** Every outer ring of the frame's land (lakes count as land here), indexed by runs of edges. */
function landOutlines() {
  outerLandRings ??= landPath('land', false)
    .split(/(?=M)/)
    .map((subpath) => subpath.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [])
    .filter((ring) => ring.length >= 6)
    .map((ring) => {
      const runs: EdgeRun[] = []
      for (let from = 0; from < ring.length; from += 2 * EDGE_RUN) {
        const to = Math.min(ring.length, from + 2 * EDGE_RUN)
        // The run's first edge comes from the vertex before it (the last vertex for the first run).
        const box = boxOf(ring, from, to)
        const previous = from ? from - 2 : ring.length - 2
        const joined = boxOf([ring[previous], ring[previous + 1], box.x, box.y, box.x + box.w, box.y + box.h], 0, 6)
        runs.push({ from, to, box: joined })
      }
      return { ring, box: boxOf(ring, 0, ring.length), runs }
    })
  return outerLandRings
}

const overlaps = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
const segmentsCross = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
) => {
  const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const d1 = cross(cx, cy, dx, dy, ax, ay)
  const d2 = cross(cx, cy, dx, dy, bx, by)
  const d3 = cross(ax, ay, bx, by, cx, cy)
  const d4 = cross(ax, ay, bx, by, dx, dy)
  return d1 * d2 <= 0 && d3 * d4 <= 0
}

/** Whether a rectangle touches any dry land (or a lake): a ring vertex or edge in it, or it inside a ring. */
export function boxTouchesLand(box: Box): boolean {
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ]
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2]
  for (const { ring, box: ringBox, runs } of landOutlines()) {
    if (!overlaps(box, ringBox)) continue
    let inside = false
    for (const run of runs) {
      const near = overlaps(box, run.box)
      // A ray from the centre to the right crosses only runs that span its height and reach right of it.
      const ray = run.box.y <= cy && cy <= run.box.y + run.box.h && run.box.x + run.box.w >= cx
      if (!near && !ray) continue
      for (let i = run.from; i < run.to; i += 2) {
        const j = i >= 2 ? i - 2 : ring.length - 2
        const [x1, y1, x2, y2] = [ring[i], ring[i + 1], ring[j], ring[j + 1]]
        if (ray && y1 > cy !== y2 > cy && cx < ((x2 - x1) * (cy - y1)) / (y2 - y1) + x1) inside = !inside
        if (!near) continue
        if (x1 >= box.x && x1 <= box.x + box.w && y1 >= box.y && y1 <= box.y + box.h) return true
        for (let k = 0; k < 4; k++) {
          const [px, py] = corners[k]
          const [qx, qy] = corners[(k + 1) % 4]
          if (segmentsCross(x1, y1, x2, y2, px, py, qx, qy)) return true
        }
      }
    }
    if (inside) return true
  }
  return false
}

const pointInRing = (x: number, y: number, ring: number[]) => {
  let hit = false
  for (let i = 0, j = ring.length - 2; i + 1 < ring.length; j = i, i += 2)
    if (
      ring[i + 1] > y !== ring[j + 1] > y &&
      x < ((ring[j] - ring[i]) * (y - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]
    )
      hit = !hit
  return hit
}

type Road = (typeof data.roads)[number]
/**
 * The roads as drawn: each hidden stretch takes out its road's parts (subpaths) whose middle
 * point lies on the outer land ring that holds the named place. The rest of the road is as built.
 */
export function drawnRoads(hidden: readonly HiddenRoadStretch[] = []): Road[] {
  if (!hidden.length) return data.roads
  return data.roads.map((road) => {
    const stretches = hidden.filter((stretch) => stretch.road === road.id)
    if (!stretches.length) return road
    const landmasses = stretches.map(({ landmassOf }) => {
      const where = place(landmassOf)
      if (!where) throw new Error(`No place ${landmassOf} to find a landmass by`)
      const [x, y] = where.point
      const ring = landOutlines().find(
        ({ ring, box }) =>
          x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h && pointInRing(x, y, ring),
      )
      if (!ring) throw new Error(`${landmassOf} is not on land`)
      return ring.ring
    })
    const parts = road.d.split(/(?=M)/).filter((part) => {
      const values = part.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
      const middle = 2 * Math.floor(values.length / 4)
      return !landmasses.some((ring) => pointInRing(values[middle], values[middle + 1], ring))
    })
    return { ...road, d: parts.join('') }
  })
}

/** Room kept between a wave and the nearest shore, drawing units. */
const WAVE_SHORE_CLEARANCE = 3
type Motif = (typeof data.motifs)[number]
let placedMotifs: Motif[] | null = null
/**
 * The motifs as drawn. A wave belongs on open water, but its placement is a rounded coordinate
 * and at this scale a coast is full of islands: each wave moves to the nearest spot, in rings of
 * 3 units out to 150, where its box and a 3-unit margin touch no land. Other motifs are as built.
 */
export function drawnMotifs(): Motif[] {
  placedMotifs ??= data.motifs.map((motif) => {
    if (!motif.id.startsWith('wave-')) return motif
    const element = elementById.get(motif.id)!
    const [w, h] = [element.width * motif.scale, element.height * motif.scale]
    const box = (dx: number, dy: number): Box => ({
      x: motif.point[0] + motif.offset[0] + dx - w / 2 - WAVE_SHORE_CLEARANCE,
      y: motif.point[1] + motif.offset[1] + dy - h / 2 - WAVE_SHORE_CLEARANCE,
      w: w + 2 * WAVE_SHORE_CLEARANCE,
      h: h + 2 * WAVE_SHORE_CLEARANCE,
    })
    for (let radius = 0; radius <= 150; radius += 3) {
      const steps = radius ? Math.max(8, Math.round((2 * Math.PI * radius) / 3)) : 1
      for (let step = 0; step < steps; step++) {
        const angle = (2 * Math.PI * step) / steps
        const [dx, dy] = [n(radius * Math.cos(angle)), n(radius * Math.sin(angle))]
        if (!boxTouchesLand(box(dx, dy)))
          return radius ? { ...motif, offset: [motif.offset[0] + dx, motif.offset[1] + dy] } : motif
      }
    }
    return motif
  })
  return placedMotifs
}

function layer(id: string, title: string, body: string) {
  return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(title)}" aria-label="${escapeXml(title)}">${body}</g>`
}

function start(title: string, description: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeXml(title)}</title><desc>${escapeXml(description)}</desc>`
}

function resources(coverage: NonNullable<GeographicMapOptions['coverage']>, land: LandFilter = {}) {
  // These exact path objects paint the land and clip its hatching. They never
  // carry an inset, stroke, smoothing curve or independently fitted coastline.
  // Sibling clip shapes form a union. Combining their d strings in one
  // even-odd path would instead cut holes where the two style regions overlap.
  const styleClip =
    coverage === 'province'
      ? ''
      : coverage === 'page8'
        ? // The frame less the journey region: a rectangle and the region, even-odd.
          `<clipPath id="geo-style-clip" clipPathUnits="userSpaceOnUse"><path id="geo-page8-journey-region" d="M-32 -32 H${width + 32} V${height + 32} H-32 Z ${PAGE8_JOURNEY_REGION.d}" fill-rule="evenodd" clip-rule="evenodd"/></clipPath>`
        : `<clipPath id="geo-style-clip" clipPathUnits="userSpaceOnUse"><path d="${data.coastalCoverage.d}" fill-rule="evenodd" clip-rule="evenodd"/>${coverage === 'northern' ? `<path id="geo-northern-style-extent" d="${NORTHERN_REFERENCE_COVERAGE.d}"/>` : ''}</clipPath>`
  return `<defs><path id="geo-land-geometry" d="${landPath('land', land)}" fill-rule="evenodd" clip-rule="evenodd"/><path id="geo-bc-land-geometry" d="${landPath('bcLand', land)}" fill-rule="evenodd" clip-rule="evenodd"/><clipPath id="geo-land-clip" clipPathUnits="userSpaceOnUse"><use href="#geo-bc-land-geometry" xlink:href="#geo-bc-land-geometry" fill-rule="evenodd" clip-rule="evenodd"/></clipPath>${styleClip}<clipPath id="geo-frame-clip"><rect width="${width}" height="${height - data.projection.footer}"/></clipPath></defs>`
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

/**
 * Page 8's journey region: the southern interior its routes cross, left white while the rest of
 * BC is hatched. Like the northern extent it is composed, not mapped: one smooth curve through
 * real anchors (just left of Mount Robson, through the Wells Gray waterfall, west of Lillooet and
 * the Whistler gondola, west of Vancouver), then everything east and south of it in the frame.
 * Vancouver Island, the Sunshine Coast and all of BC north and west of the curve stay hatched.
 */
export const PAGE8_JOURNEY_REGION = (() => {
  const robson = (place('mount-robson-peak') ?? place('mount-robson'))!.point
  const vancouver = place('vancouver')!.point
  const lillooet = place('lillooet')!.point
  const waterfall = data.motifs.find((motif) => motif.id === 'waterfall')!
  const gondola = data.motifs.find((motif) => motif.id === 'gondola')!
  const at = (motif: typeof waterfall): Point => [
    motif.point[0] + ('offset' in motif ? motif.offset[0] : 0),
    motif.point[1] + ('offset' in motif ? motif.offset[1] : 0),
  ]
  const [wx, wy] = at(waterfall)
  const [gx, gy] = at(gondola)
  const curve: Point[] = [
    [robson[0] - 16, -32],
    [robson[0] - 24, robson[1] + 8],
    [wx, wy + 10],
    [lillooet[0] - 24, lillooet[1] - 30],
    [gx - 26, gy + 6],
    [vancouver[0] - 11, vancouver[1] - 26],
    [vancouver[0] + 4, vancouver[1] + 34],
    [vancouver[0] + 16, height + 32],
  ]
  // Catmull-Rom through the anchors, as cubic segments.
  const point = (k: number) => curve[Math.max(0, Math.min(curve.length - 1, k))]
  const p = (q: Point) => `${n(q[0])} ${n(q[1])}`
  let d = `M${p(curve[0])}`
  const flat: Point[] = [curve[0]]
  for (let k = 0; k < curve.length - 1; k++) {
    const [a, b, c, e] = [point(k - 1), point(k), point(k + 1), point(k + 2)]
    const c1: Point = [b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6]
    const c2: Point = [c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6]
    d += ` C${p(c1)} ${p(c2)} ${p(c)}`
    for (let t = 1; t <= 12; t++) {
      const s = t / 12
      const u = 1 - s
      flat.push([
        u * u * u * b[0] + 3 * u * u * s * c1[0] + 3 * u * s * s * c2[0] + s * s * s * c[0],
        u * u * u * b[1] + 3 * u * u * s * c1[1] + 3 * u * s * s * c2[1] + s * s * s * c[1],
      ])
    }
  }
  const corners: Point[] = [
    [width + 32, height + 32],
    [width + 32, -32],
  ]
  d += ` L${p(corners[0])} L${p(corners[1])} Z`
  return {
    kind: 'authored-reference-style',
    anchors: ['mount-robson', 'waterfall', 'lillooet', 'gondola', 'vancouver'],
    /** The curve's right-most reach: the hatch field need not run past it. */
    right: Math.max(...flat.map((q) => q[0])),
    d,
    polygon: [...flat, ...corners],
  } as const
})()

/** The journey region in the compass inset's units, as path data, for its accent. */
export function journeyInsetAccent(): string {
  const { scale: artScale, left, top, boundsMetres } = data.projection
  const { scale, x, y } = COMPASS_INSET_FROM_ALBERS
  const points = PAGE8_JOURNEY_REGION.polygon.map(([px, py]) => {
    const easting = boundsMetres[0] + (px - left) / artScale
    const northing = boundsMetres[3] - (py - top) / artScale
    return `${n(scale * easting + x)},${n(-scale * northing + y)}`
  })
  return `M ${points.join(' L ')} Z`
}

/** Room kept between a name and the frame's edge, drawing units. */
const LABEL_MARGIN = 12

function label(
  text: string,
  point: Point,
  offset: Point,
  halo: number,
  align: 'left' | 'center' | 'right' = 'left',
  emSize = 23.923,
  face: LetteringSource = 'smallcaps',
  authoredGlyphs = text.toUpperCase(),
) {
  // Mixed-case glyph text picks Great Forest's capital-shaped alternates; another font sets capitals.
  const glyphText = typeof face === 'string' || face.capitalAlternates ? authoredGlyphs : text.toUpperCase()
  const size = letteringSize(text, emSize, face, glyphText)
  const placed = point[0] + offset[0] - size.width * (align === 'left' ? 0 : align === 'center' ? 0.5 : 1)
  // A theme's font may set a name wider than Great Forest does: keep it inside the frame.
  const x = Math.min(Math.max(placed, LABEL_MARGIN), Math.max(LABEL_MARGIN, width - LABEL_MARGIN - size.width))
  const y = point[1] + offset[1]
  return lettering(text, [x, y, size.width, size.height], face, 0, halo, glyphText)
}

export const PLACE_LABELS = [
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

function locations(
  halo: number,
  drawSymbols: boolean,
  drawLabels: boolean,
  labelSet: 'all' | 'page8' = 'all',
  face: LetteringSource = 'smallcaps',
) {
  let symbols = '',
    labels = ''
  const destinationFlags: Record<string, string> = { golden: 'flag-golden', fernie: 'flag-fernie' }
  for (const definition of PLACE_LABELS) {
    const p = place(definition.id)
    if (!p || (labelSet === 'page8' && 'secondary' in definition)) continue
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
      labels += `<g id="geo-label-${p.id}">${label(definition.text, p.point, definition.offset, halo, 'align' in definition ? definition.align : 'left', 'secondary' in definition ? 19 : 23.923, face)}</g>`
  }
  const robson = place('mount-robson-peak') ?? place('mount-robson')
  if (robson) {
    if (drawSymbols)
      symbols += `<g id="geo-place-mount-robson">${symbol('flag-mount-robson', robson.point, 0.66, [0, 0], [18 / 68, 82 / 95])}</g>`
    if (drawLabels)
      labels += `<g id="geo-label-mount-robson">${label('MOUNT', robson.point, [-13, -26], halo, 'right', undefined, face)}${label('ROBSON', robson.point, [-13, -10], halo, 'right', undefined, face)}</g>`
  }
  return { symbols, labels }
}

function footer(body?: { family: string; src: string }) {
  // A theme's body font, embedded so the file carries it; Arial otherwise.
  const family = body ? `'${body.family.replace(/['\\<>&"]/g, '')}',Arial,sans-serif` : 'Arial,sans-serif'
  const face = body
    ? `<defs><style>@font-face{font-family:'${body.family.replace(/['\\<>&"]/g, '')}';src:url(${body.src.replace(/[^A-Za-z0-9+/=:;,.-]/g, '')})}</style></defs>`
    : ''
  const y = height - data.projection.footer
  const scaleBar = 100000 * data.projection.scale
  return layer(
    'geo-cartographic-furniture',
    'Cartographic scale and sources',
    `${face}<rect y="${y}" width="${width}" height="${data.projection.footer}" fill="white"/><g fill="${MAP_PALETTE.canopy}" font-family="${family}" font-size="10"><text x="18" y="${y + 15}">Coast: GSHHG · Lakes: GSHHG / BC FWA · Roads: StatCan / WSDOT · Places: CGNDB / US Census · Coastal style: BEC</text><text x="18" y="${y + 29}">BC Albers · Geographic features share one projection and scale · Illustrations are regional motifs</text></g><g transform="translate(${width - scaleBar - 24} ${y + 15})" fill="none" stroke="${MAP_PALETTE.canopy}" stroke-width="1.5"><path d="M0 -4V3H${n(scaleBar)}V-4 M${n(scaleBar / 2)} 0V3"/></g><g fill="${MAP_PALETTE.canopy}" font-family="${family}" font-size="10"><text x="${width - scaleBar - 24}" y="${y + 29}">0</text><text x="${width - 24}" y="${y + 29}" text-anchor="end">100 km</text></g>`,
  )
}

export function buildGeographicMapSvg(options: GeographicMapOptions = {}): string {
  const coverage = options.coverage ?? DEFAULT_GEOGRAPHIC_OPTIONS.coverage
  const layers = { hatching: true, roads: true, symbols: true, labels: true, ...options.layers }
  const composition = { ...DEFAULT_COMPOSITION_OPTIONS, ...options.composition }
  const hatchStyle = options.hatchStyle ?? 'contour'
  const hatch = { ...DEFAULT_HATCH_OPTIONS, ...options.hatch }
  const patchHatch = { ...DEFAULT_PAGE8_HATCH_OPTIONS, ...options.patchHatch }
  const lakes = options.lakes ?? true
  let svg = start(
    'Rainforest to Rockies — geographic illustration',
    'Real geographic shoreline, lake holes, province regions, highway centrelines and place coordinates projected together to BC Albers. Reconstructed page 8 symbols, glyph lettering and generated hatching provide the illustration style. Motifs are decorative regional illustrations. The title is a reconstructed study.',
  )
  svg += `<metadata>${escapeXml(JSON.stringify({ generator: 'pgmaps-geographic-illustrated-map', version: 1, trace: false, coordinates: 'EPSG:3005', projection: data.projection, coverage, ...(hatchStyle === 'patch' ? { hatchStyle, patchHatch } : { hatch }), composition, provenance: data.provenance, ...(coverage === 'northern' ? { coverageStyle: NORTHERN_REFERENCE_COVERAGE } : {}), ...(coverage === 'page8' ? { coverageStyle: { kind: PAGE8_JOURNEY_REGION.kind, anchors: PAGE8_JOURNEY_REGION.anchors, d: PAGE8_JOURNEY_REGION.d }, labelSet: options.labelSet ?? 'all' } : {}), ...(lakes ? {} : { lakes: false }), ...(options.minIslandKm2 ? { minIslandKm2: options.minIslandKm2 } : {}), ...(options.minLakeKm2 ? { minLakeKm2: options.minLakeKm2 } : {}) }))}</metadata>`
  const landFilter: LandFilter = {
    lakes,
    minIslandKm2: Math.max(0, options.minIslandKm2 ?? 0),
    minLakeKm2: Math.max(0, options.minLakeKm2 ?? 0),
  }
  svg += resources(coverage, landFilter)
  const channelGap = Math.max(0, options.channelGap ?? 0)
  // The coastline stroked out of the land and its hatch. Its frame edges are kept: the stroke is
  // clipped to the frame less the gap, so land running off the map gets no water line.
  // With vector masks the same line is drawn in the water's colour over land and hatch instead
  // (only over an opaque ocean: a transparent background needs the mask to show through).
  const vector = options.vectorMasks === true
  const gapStroke = channelGap > 0 && vector && !options.transparentBackground
  const gapMask = channelGap > 0 && !gapStroke ? ' mask="url(#geo-channel-gap)"' : ''
  const gapFrame = `<clipPath id="geo-channel-gap-frame"><rect x="${n(channelGap)}" y="${n(channelGap)}" width="${n(width - 2 * channelGap)}" height="${n(height - data.projection.footer - 2 * channelGap)}"/></clipPath>`
  if (gapStroke) svg += `<defs>${gapFrame}</defs>`
  else if (channelGap > 0)
    svg += `<defs>${gapFrame}<mask id="geo-channel-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><g clip-path="url(#geo-channel-gap-frame)"><use href="#geo-land-geometry" xlink:href="#geo-land-geometry" fill="none" stroke="black" stroke-width="${n(channelGap)}" stroke-linejoin="round"/></g></mask></defs>`
  if (!options.transparentBackground) {
    svg += layer(
      'geo-ocean',
      '01 Ocean and inland water',
      `<rect width="${width}" height="${height}" fill="${MAP_PALETTE.ocean}"/>`,
    )
    svg += layer(
      'geo-land',
      '02 Geographic dry land',
      (gapMask ? `<g${gapMask}>` : '') +
        `<use href="#geo-land-geometry" xlink:href="#geo-land-geometry" fill="${MAP_PALETTE.surrounding}"/><use href="#geo-bc-land-geometry" xlink:href="#geo-bc-land-geometry" fill="white"/>` +
        (gapMask ? '</g>' : ''),
    )
  }
  svg += '<g clip-path="url(#geo-frame-clip)">'
  if (layers.hatching) {
    const bounds = coverage === 'coastal' ? data.coastalLand.bounds : data.bcLand.bounds
    const right =
      coverage === 'northern'
        ? Math.max(data.coastalLand.bounds[2], NORTHERN_REFERENCE_COVERAGE.right)
        : coverage === 'page8'
          ? PAGE8_JOURNEY_REGION.right
          : bounds[2]
    const fieldWidth = Math.max(1, Math.min(width, Math.ceil(right + 8)))
    const clearances =
      !composition.allowIllustrationOverlap && layers.symbols
        ? drawnMotifs()
            .map((motif) => {
              const element = elementById.get(motif.id)!
              const offset = 'offset' in motif ? motif.offset : [0, 0]
              return `<rect x="${n(motif.point[0] + offset[0] - (element.width * motif.scale) / 2 - 2)}" y="${n(motif.point[1] + offset[1] - (element.height * motif.scale) / 2 - 2)}" width="${n(element.width * motif.scale + 4)}" height="${n(element.height * motif.scale + 4)}" rx="3"/>`
            })
            .join('')
        : ''
    // Vector form: one even-odd clip per clearance (the frame less that rectangle), nested, so
    // overlapping clearances stay cut out.
    const clearanceRects =
      vector && clearances
        ? [...clearances.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="3"\/>/g)]
        : []
    if (clearanceRects.length)
      svg += `<defs>${clearanceRects.map(([, x, y, w, h], i) => `<clipPath id="geo-illustration-clearance-${i}" clipPathUnits="userSpaceOnUse"><path clip-rule="evenodd" d="M0 0H${width}V${height}H0Z${roundedRectPath(Number(x), Number(y), Number(w), Number(h), 3)}"/></clipPath>`).join('')}</defs>`
    const clearanceOpen = clearanceRects.map((_, i) => `<g clip-path="url(#geo-illustration-clearance-${i})">`).join('')
    const clearanceClose = '</g>'.repeat(clearanceRects.length)
    if (clearances && !clearanceRects.length)
      svg += `<defs><mask id="geo-illustration-clearances" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><g fill="black">${clearances}</g></mask></defs>`
    svg += layer(
      'geo-forest-hatching',
      '03 Generated hatching clipped to geographic land',
      `<g clip-path="url(#geo-land-clip)"${gapMask}><g${coverage !== 'province' ? ' clip-path="url(#geo-style-clip)"' : ''}${clearances && !clearanceRects.length ? ' mask="url(#geo-illustration-clearances)"' : ''} color="${MAP_PALETTE.hatch}">${clearanceOpen}${hatchStyle === 'patch' ? buildPatchHatchPaths(fieldWidth, height - data.projection.footer, patchHatch) : buildHatchPaths(fieldWidth, height - data.projection.footer, hatch)}${clearanceClose}</g></g>`,
    )
  }
  if (gapStroke) {
    svg += layer(
      'geo-channel-gap',
      '03b Channels kept open along every shore',
      `<g clip-path="url(#geo-channel-gap-frame)"><use href="#geo-land-geometry" xlink:href="#geo-land-geometry" fill="none" stroke="${MAP_PALETTE.ocean}" stroke-width="${n(channelGap)}" stroke-linejoin="round"/></g>`,
    )
  }
  if (layers.roads) {
    const roads = drawnRoads(options.hiddenRoads)
    // Page 8 draws its compass over clear hatch: roads stop at the compass ring.
    const clearCompass = coverage === 'page8' && layers.symbols
    if (clearCompass)
      svg += vector
        ? `<defs><clipPath id="geo-compass-clearance" clipPathUnits="userSpaceOnUse"><path clip-rule="evenodd" d="M0 0H${width}V${height}H0Z M217 165A62 62 0 1 0 93 165A62 62 0 1 0 217 165Z"/></clipPath></defs>`
        : `<defs><mask id="geo-compass-clearance" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><circle cx="155" cy="165" r="62" fill="black"/></mask></defs>`
    const masked = (body: string) =>
      clearCompass ? `<g ${vector ? 'clip-path' : 'mask'}="url(#geo-compass-clearance)">${body}</g>` : body
    const paths = (role: string) =>
      roads
        .filter((road) => road.role === role)
        .map(
          (road) =>
            `<path id="geo-road-${road.id}" data-route="${escapeXml(road.route)}" data-jurisdiction="${road.jurisdiction}" d="${road.d}"/>`,
        )
        .join('')
    svg += layer(
      'geo-supporting-highways',
      '04 Supporting highways from NRN and WSDOT',
      masked(
        `<g fill="none" stroke="white" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round">${roads
          .filter((road) => road.role === 'supporting')
          .map((road) => `<path d="${road.d}"/>`)
          .join(
            '',
          )}</g><g fill="none" stroke="${MAP_PALETTE.canopy}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="6 6">${paths('supporting')}</g>`,
      ),
    )
    svg += layer(
      'geo-primary-highways',
      '05 Primary highways from NRN',
      masked(
        `<g fill="none" stroke="white" stroke-width="7.8" stroke-linecap="round" stroke-linejoin="round">${roads
          .filter((road) => road.role === 'primary')
          .map((road) => `<path d="${road.d}"/>`)
          .join(
            '',
          )}</g><g fill="none" stroke="${MAP_PALETTE.emerald}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">${paths('primary')}</g>`,
      ),
    )
  }
  const places = options.lettering?.places ?? 'smallcaps'
  const regions = options.lettering?.regions ?? 'regular'
  const placed = locations(composition.labelHalo, layers.symbols, layers.labels, options.labelSet, places)
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
      drawnMotifs()
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
      `<g transform="rotate(${n(data.projection.northArrowRotationDegrees)} 155 165)">${
        coverage === 'page8'
          ? // The inset colours the journey region the map leaves white, as page 8's does.
            `<g data-symbol="compass-bc" data-inset-accent="page8-journey-region" transform="translate(${n(155 - 232 * 0.36)} ${n(165 - 229 * 0.36)}) scale(0.72)">${compassWithInsetAccent(journeyInsetAccent(), options.compassLettering, options.lettering?.places)}</g>`
          : options.compassLettering === 'smallcaps'
            ? `<g data-symbol="compass-bc" transform="translate(${n(155 - 232 * 0.36)} ${n(165 - 229 * 0.36)}) scale(0.72)">${compassWithLettering('smallcaps', options.lettering?.places)}</g>`
            : symbol('compass-bc', [155, 165], 0.72)
      }</g>`,
    )
  }
  if (layers.labels) {
    svg += layer(
      'geo-lettering',
      '11 Great Forest place lettering',
      `<g fill="${MAP_PALETTE.canopy}">${placed.labels}${label('RAINFOREST', [260, 790], [0, 0], composition.labelHalo, 'center', 36.728, regions, 'RaInFOrEsT')}${label('CANADIAN', [1270, 525], [0, 0], composition.labelHalo, 'center', 36.728, regions, 'cANaDIAn')}${label('ROCKIES', [1270, 568], [0, 0], composition.labelHalo, 'center', 36.728, regions, 'RoCkIeS')}${label('ALBERTA', [1390, 395], [0, 0], composition.labelHalo, 'center', undefined, places)}${label('USA', [1070, 935], [0, 0], composition.labelHalo, 'center', undefined, places)}</g>`,
    )
    svg += layer(
      'geo-title-study',
      '12 Reconstructed title study',
      `<g transform="translate(1110 38) scale(.88)">${TITLE_STUDY.svg}</g>`,
    )
  }
  svg += '</g>'
  if (!options.transparentBackground) svg += footer(options.lettering?.body)
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
