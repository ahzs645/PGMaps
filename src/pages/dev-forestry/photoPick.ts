/**
 * Click the photo to read the map: what ground a photo pixel shows, how far, how high and how steep, and which block,
 * stand, sensitivity unit or objective it lies in. Also the mask of a feature's pixels, so hovering a layer row can
 * tint it in the photo. See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, section 2.3.
 *
 * Everything is read from the hit buffer (`photoHitBuffer.ts`), the ground each working pixel's ray meets, so a
 * reading is the terrain's answer for the camera as it stands: no canopy, no run. Polygons are tested through
 * `preparePolygons`, never `pointInPolygon` in a loop: a mask tests every pixel of the buffer.
 *
 * Free of DOM and network access.
 */
import { hitAt, type HitBuffer } from './photoHitBuffer'
import { normalizeBearing } from './photoPose'
import { preparePolygons, type Bounds, type PolygonGeometry, type PreparedPolygons } from './visibility'

const RAD = Math.PI / 180
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos(lat * RAD)

/** One polygon layer to name features from, prepared once for many pixels. */
export type PhotoPickLayer = {
  /** A photo layer id (`photoLayers.ts`). */
  id: string
  prepared: PreparedPolygons
  /** In the order the polygons were prepared: `prepared.indexAt` indexes this list. */
  features: ReadonlyArray<{ id?: string | number; label?: string }>
}

/** Prepares a layer's polygons for picking. `within` leaves out parts outside the box the photo sees. */
export function preparePickLayer(
  id: string,
  features: ReadonlyArray<{ id?: string | number; label?: string; geometry: PolygonGeometry }>,
  within?: Bounds,
): PhotoPickLayer {
  return {
    id,
    prepared: preparePolygons(
      features.map((feature) => feature.geometry),
      within,
    ),
    features: features.map(({ id: featureId, label }) => ({
      ...(featureId !== undefined ? { id: featureId } : {}),
      ...(label !== undefined ? { label } : {}),
    })),
  }
}

export type PhotoPixelReading = {
  lng: number
  lat: number
  /** Metres along the ray to the ground. */
  distanceMeters: number
  /** Metres above sea level. */
  elevation: number
  /** Ground slope from the neighbouring hits; null where too few of them lie on the same surface. */
  slopePercent: number | null
  /** Compass direction the slope faces (downhill), degrees; null on flat ground or with no slope. */
  aspectDegrees: number | null
  /** The feature of each layer the ground lies in, in the layers' order; a layer with none is left out. */
  features: Array<{ layer: string; index: number; id?: string | number; label?: string }>
}

/** Working-buffer column and row of a photo pixel. */
function cellOf(buf: HitBuffer, x: number, y: number): [number, number] | null {
  const col = Math.floor((x / buf.photoWidth) * buf.width),
    row = Math.floor((y / buf.photoHeight) * buf.height)
  return col >= 0 && row >= 0 && col < buf.width && row < buf.height ? [col, row] : null
}

/**
 * Neighbours further along their rays than this share of the centre's distance belong to another surface (a ridge
 * behind, a valley below the edge), so they stay out of the slope.
 */
const SAME_SURFACE_SHARE = 0.1

/**
 * Ground slope at a working pixel: a least-squares plane through the hits of its 3×3 neighbourhood (5×5 when too few
 * of those are on the same surface), in local metres. Null with fewer than three points or when they lie on a line.
 */
function slopeAt(buf: HitBuffer, col: number, row: number) {
  const centre = row * buf.width + col
  const lng0 = buf.lng[centre],
    lat0 = buf.lat[centre],
    d0 = buf.distance[centre]
  const mx = metresPerDegreeLng(lat0)
  for (const radius of [1, 2]) {
    const points: Array<[number, number, number]> = []
    for (let r = row - radius; r <= row + radius; r++)
      for (let c = col - radius; c <= col + radius; c++) {
        if (r < 0 || c < 0 || r >= buf.height || c >= buf.width) continue
        const i = r * buf.width + c
        const lng = buf.lng[i],
          lat = buf.lat[i],
          z = buf.elevation[i],
          d = buf.distance[i]
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(z)) continue
        if (Math.abs(d - d0) > SAME_SURFACE_SHARE * d0) continue
        points.push([(lng - lng0) * mx, (lat - lat0) * METRES_PER_DEGREE_LAT, z])
      }
    const plane = fitPlane(points)
    if (plane) return plane
  }
  return null
}

/** z = a·east + b·north + c by least squares; null when the points do not span an area. */
function fitPlane(points: ReadonlyArray<[number, number, number]>): { a: number; b: number } | null {
  if (points.length < 3) return null
  let se = 0,
    sn = 0,
    sz = 0
  for (const [e, n, z] of points) {
    se += e
    sn += n
    sz += z
  }
  const count = points.length
  const me = se / count,
    mn = sn / count,
    mz = sz / count
  let ee = 0,
    nn = 0,
    en = 0,
    ez = 0,
    nz = 0
  for (const [e, n, z] of points) {
    const de = e - me,
      dn = n - mn,
      dz = z - mz
    ee += de * de
    nn += dn * dn
    en += de * dn
    ez += de * dz
    nz += dn * dz
  }
  const det = ee * nn - en * en
  // Collinear points (a single column at a grazing angle) leave the cross-slope undetermined.
  if (!(det > 1e-6 * Math.max(1, ee * nn))) return null
  return { a: (ez * nn - nz * en) / det, b: (nz * ee - ez * en) / det }
}

/** What the map says about the ground at photo pixel (x, y); null for sky, missing terrain or off the photo. */
export function readPhotoPixel(
  buf: HitBuffer,
  x: number,
  y: number,
  layers: readonly PhotoPickLayer[] = [],
): PhotoPixelReading | null {
  const cell = cellOf(buf, x, y)
  const hit = cell ? hitAt(buf, x, y) : null
  if (!cell || !hit) return null
  const plane = slopeAt(buf, cell[0], cell[1])
  const gradient = plane ? Math.hypot(plane.a, plane.b) : null
  const features = layers.flatMap((layer) => {
    const index = layer.prepared.indexAt(hit.lng, hit.lat)
    return index >= 0 ? [{ layer: layer.id, index, ...layer.features[index] }] : []
  })
  return {
    lng: hit.lng,
    lat: hit.lat,
    distanceMeters: hit.distanceMeters,
    elevation: hit.elevation,
    slopePercent: gradient === null ? null : gradient * 100,
    aspectDegrees: plane && gradient! > 1e-6 ? normalizeBearing(Math.atan2(-plane.a, -plane.b) / RAD) : null,
    features,
  }
}

/**
 * The working pixels whose ground lies in the prepared polygons (in polygon `index` alone when given): 1 inside, 0
 * elsewhere, row-major over the hit buffer. Only ground the camera sees is in it, so a tint drawn from it never
 * paints a block's hidden part.
 */
export function pixelsInFeature(buf: HitBuffer, prepared: PreparedPolygons, index?: number): Uint8Array {
  const mask = new Uint8Array(buf.width * buf.height)
  for (let i = 0; i < mask.length; i++) {
    const lng = buf.lng[i],
      lat = buf.lat[i]
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    const at = prepared.indexAt(lng, lat)
    if (index === undefined ? at >= 0 : at === index) mask[i] = 1
  }
  return mask
}
