/**
 * EGM2008 geoid heights from PROJ's grid on its CDN (`us_nga_egm08_25.tif`: 2.5′ nodes, PixelIsPoint,
 * float32, CORS open), read a small window at a time. Turns an ellipsoid height (ITRF2014 or WGS84,
 * which agree at the centimetre) into an EGM2008 orthometric height: H = h − N.
 *
 * EGM2008 sat within 3 cm of CGVD2013 over the 093G086 LiDAR tile; elsewhere in BC the two can differ
 * by a few decimetres, so a figure built on this says EGM2008. Bilinear between nodes matched PROJ's own
 * transformation to 0.1 mm at Prince George. DOM and network free: the caller opens the GeoTIFF.
 */
export const EGM2008_URL = 'https://cdn.proj.org/us_nga_egm08_25.tif'
const STEP_DEG = 1 / 24
const NODES_ACROSS = 8640
const NODES_DOWN = 4321

export interface GeoidTiff {
  getImage(index?: number): Promise<{
    getWidth(): number
    getHeight(): number
    getOrigin(): number[]
    getResolution(): number[]
    readRasters(options: { window: [number, number, number, number] }): Promise<ArrayLike<ArrayLike<number>>>
  }>
}

export interface GeoidGrid {
  /** Node column and row of the window's first node. */
  col0: number
  row0: number
  width: number
  height: number
  values: Float64Array
}

/** Reads the nodes round a lon/lat box (one node beyond each side, for interpolation). */
export async function readGeoid(bounds: [number, number, number, number], tiff: GeoidTiff): Promise<GeoidGrid> {
  const image = await tiff.getImage(0)
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()
  if (
    image.getWidth() !== NODES_ACROSS ||
    image.getHeight() !== NODES_DOWN ||
    Math.abs(ox + 180) > 1e-9 ||
    Math.abs(oy - 90) > 1e-9 ||
    Math.abs(rx - STEP_DEG) > 1e-12 ||
    Math.abs(ry + STEP_DEG) > 1e-12
  )
    throw new Error('The geoid file is not the 2.5′ EGM2008 grid this reader expects.')
  const [w, s, e, n] = bounds
  const col0 = Math.max(0, Math.floor((w + 180) / STEP_DEG) - 1)
  const col1 = Math.min(NODES_ACROSS - 1, Math.ceil((e + 180) / STEP_DEG) + 1)
  const row0 = Math.max(0, Math.floor((90 - n) / STEP_DEG) - 1)
  const row1 = Math.min(NODES_DOWN - 1, Math.ceil((90 - s) / STEP_DEG) + 1)
  const width = col1 - col0 + 1,
    height = row1 - row0 + 1
  const bands = await image.readRasters({ window: [col0, row0, col1 + 1, row1 + 1] })
  return { col0, row0, width, height, values: Float64Array.from(bands[0]) }
}

/** Geoid height N (metres) at a point, bilinear between nodes; NaN outside the window. */
export function geoidAt(grid: GeoidGrid, lon: number, lat: number): number {
  const x = (lon + 180) / STEP_DEG - grid.col0
  const y = (90 - lat) / STEP_DEG - grid.row0
  const c = Math.floor(x),
    r = Math.floor(y)
  if (c < 0 || r < 0 || c + 1 >= grid.width || r + 1 >= grid.height) return NaN
  const fx = x - c,
    fy = y - r
  const v = (cc: number, rr: number) => grid.values[rr * grid.width + cc]
  const top = v(c, r) + fx * (v(c + 1, r) - v(c, r))
  const bottom = v(c, r + 1) + fx * (v(c + 1, r + 1) - v(c, r + 1))
  return top + fy * (bottom - top)
}
