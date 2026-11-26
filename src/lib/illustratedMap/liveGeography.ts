/**
 * The geographic illustration's land, province and hatch coverage back on the ground, as longitude
 * and latitude, for a live map. `geography.generated.json` holds them as artboard paths: the fit is
 * undone (one uniform scale from BC Albers metres) and BC Albers is inverted with proj4. NAD83 is
 * taken as WGS84, within 2 m in BC. No DOM or network access.
 */
import proj4 from 'proj4'
import type { HatchTileAreas, LngLatRings } from '@pgmaps/geo-toolkit/patterns'
import data from './geography.generated.json'
import { NORTHERN_REFERENCE_COVERAGE, PAGE8_JOURNEY_REGION, type GeographicMapOptions } from './geographic'

proj4.defs(
  'EPSG:3005',
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs',
)
const toLngLat = proj4('EPSG:3005', 'EPSG:4326')

type Point = [number, number]

/** Rings of an absolute SVG path (`M L H V C Z`); cubic segments are flattened to 12 lines each. */
export function svgPathRings(d: string): Point[][] {
  const rings: Point[][] = []
  let ring: Point[] = []
  let current: Point = [0, 0]
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  let command = ''
  let i = 0
  const number = () => Number(tokens[i++])
  const close = () => {
    if (ring.length >= 3) rings.push(ring)
    ring = []
  }
  while (i < tokens.length) {
    if (/^[MLHVCZ]$/i.test(tokens[i])) command = tokens[i++].toUpperCase()
    if (command === 'Z') {
      close()
      command = ''
      continue
    }
    if (command === 'M') {
      close()
      current = [number(), number()]
      ring.push(current)
      command = 'L'
    } else if (command === 'L') {
      current = [number(), number()]
      ring.push(current)
    } else if (command === 'H') {
      current = [number(), current[1]]
      ring.push(current)
    } else if (command === 'V') {
      current = [current[0], number()]
      ring.push(current)
    } else if (command === 'C') {
      const [a, b, c]: Point[] = [
        [number(), number()],
        [number(), number()],
        [number(), number()],
      ]
      const start = current
      for (let k = 1; k <= 12; k++) {
        const t = k / 12
        const u = 1 - t
        ring.push([
          u * u * u * start[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0],
          u * u * u * start[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1],
        ])
      }
      current = c
    } else i++
  }
  close()
  return rings
}

const { scale, left, top, boundsMetres } = data.projection
/** An artboard point as longitude and latitude. */
export function artboardToLngLat([x, y]: Point): Point {
  const easting = boundsMetres[0] + (x - left) / scale
  const northing = boundsMetres[3] - (y - top) / scale
  const [lng, lat] = toLngLat.forward([easting, northing])
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]
}

const rings = (d: string): LngLatRings => svgPathRings(d).map((ring) => ring.map(artboardToLngLat))

let cache: {
  land: LngLatRings
  bcLand: LngLatRings
  coastal: LngLatRings
  northern: LngLatRings
  page8: LngLatRings
} | null = null
function geography() {
  cache ??= {
    land: rings(data.land.d),
    bcLand: rings(data.bcLand.d),
    coastal: rings(data.coastalCoverage.d),
    northern: rings(NORTHERN_REFERENCE_COVERAGE.d),
    // The frame less page 8's journey region, as one even-odd polygon: the frame and the region.
    page8: (
      [
        [
          [-32, -32],
          [data.artboard.width + 32, -32],
          [data.artboard.width + 32, data.artboard.height + 32],
          [-32, data.artboard.height + 32],
        ],
        PAGE8_JOURNEY_REGION.polygon.map(([x, y]) => [x, y]),
      ] as Point[][]
    ).map((ring) => ring.map(artboardToLngLat)),
  }
  return cache
}

function inside([x, y]: readonly [number, number], ring: LngLatRings[number]) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const signedArea = (ring: LngLatRings[number]) => {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    total += x1 * y2 - x2 * y1
  }
  return total / 2
}

/**
 * Rings as polygons with holes, for MapLibre, which fills polygons rather than even-odd paths.
 * The build writes outer rings and holes with opposite windings (6,015 and 1,153 for BC), so the
 * winding of the largest ring marks the outer ones; each hole joins the smallest outer ring round
 * it, found by a vote of a few of its vertices, since shared edges put some on a neighbour.
 */
export function nestRings(all: LngLatRings): number[][][][] {
  const areas = all.map(signedArea)
  const largest = areas.reduce((best, area, i) => (Math.abs(area) > Math.abs(areas[best]) ? i : best), 0)
  const outerSign = Math.sign(areas[largest]) || 1
  const boxes = all.map((ring) => {
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  })
  const outers = all.flatMap((_, i) => (Math.sign(areas[i]) === outerSign ? [i] : []))
  const polygons = new Map<number, number[][][]>(outers.map((i) => [i, [all[i].map((p) => [...p])]]))
  all.forEach((ring, i) => {
    if (Math.sign(areas[i]) === outerSign) return
    const [c0, d0, c1, d1] = boxes[i]
    const step = Math.max(1, Math.floor(ring.length / 7))
    let parent = -1
    for (const j of outers) {
      const [a0, b0, a1, b1] = boxes[j]
      if (c0 < a0 || d0 < b0 || c1 > a1 || d1 > b1) continue
      if (parent >= 0 && Math.abs(areas[j]) >= Math.abs(areas[parent])) continue
      let votes = 0
      let cast = 0
      for (let k = 0; k < ring.length && cast < 7; k += step, cast++) if (inside(ring[k], all[j])) votes++
      if (votes * 2 > cast) parent = j
    }
    polygons.get(parent)?.push(ring.map((p) => [...p]))
  })
  return [...polygons.values()]
}

const landCache = new Map<string, GeoJSON.FeatureCollection>()
/** Land in the frame (all of it, or BC's) as GeoJSON polygons with their lakes, for a basemap. */
export function liveLandGeoJson(kind: 'land' | 'bcLand'): GeoJSON.FeatureCollection {
  let collection = landCache.get(kind)
  if (!collection) {
    collection = {
      type: 'FeatureCollection',
      features: nestRings(geography()[kind]).map((coordinates) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates },
      })),
    }
    landCache.set(kind, collection)
  }
  return collection
}

const areaCache = new Map<string, HatchTileAreas>()
/**
 * Where the live hatch paints for a coverage choice: BC dry land (lakes as holes), intersected
 * with the coastal region, the coastal region and the northern extent together, or nothing more.
 * The same object for the same choice, so a map layer sends it once.
 */
export function liveHatchAreas(coverage: NonNullable<GeographicMapOptions['coverage']>): HatchTileAreas {
  let areas = areaCache.get(coverage)
  if (!areas) {
    const { bcLand, coastal, northern, page8 } = geography()
    areas =
      coverage === 'province'
        ? { land: bcLand }
        : {
            land: bcLand,
            coverage: coverage === 'northern' ? [coastal, northern] : coverage === 'page8' ? [page8] : [coastal],
          }
    areaCache.set(coverage, areas)
  }
  return areas
}

/** The artboard frame's longitude and latitude box, to open the live map on. */
export function liveFrameBounds(): [[number, number], [number, number]] {
  const corners = [
    artboardToLngLat([0, 0]),
    artboardToLngLat([data.artboard.width, 0]),
    artboardToLngLat([0, data.artboard.height - data.projection.footer]),
    artboardToLngLat([data.artboard.width, data.artboard.height - data.projection.footer]),
  ]
  const lngs = corners.map((c) => c[0])
  const lats = corners.map((c) => c[1])
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}
