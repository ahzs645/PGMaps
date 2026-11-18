/**
 * SCANFI v2 (NRCan, January 2026): Canada-wide 30 m rasters of land cover, forest height, crown
 * closure, biomass, age and species crown closure every five years 1985–2025, imputed from Landsat
 * and the National Forest Inventory photo plots. NRCan states it is for regional to national work,
 * not plot-level validation, and not a replacement for provincial inventories (VRI in BC).
 *
 * The files are tiled GeoTIFFs of about 3 GB each on `ftp.maps.canada.ca`, which answers byte
 * ranges but sends no CORS headers: scripts read windows directly, a browser cannot.
 * DOM and network free: the caller opens the GeoTIFF.
 */
import proj4 from 'proj4'

export const SCANFI_BASE_URL = 'https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2'
export const SCANFI_CREDIT =
  'SCANFI v2, Natural Resources Canada (Guindon et al. 2026), Open Government Licence – Canada'
export const SCANFI_YEARS = [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025] as const
export const SCANFI_PROJ =
  '+proj=lcc +lat_0=0 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs'
export const SCANFI_ORIGIN: [number, number] = [-2_341_500, 9_436_500]
export const SCANFI_CELL_M = 30
export const SCANFI_NODATA = 255
export const SCANFI_MAX_WINDOW_CELLS = 4_000_000

export const SCANFI_LAYERS = {
  height: { file: 'att_height', unit: 'm', label: 'Forest height' },
  closure: { file: 'att_closure', unit: '%', label: 'Total crown closure' },
  biomass: { file: 'att_biomass', unit: 't/ha', label: 'Live aboveground dry tree biomass' },
  landcover: { file: 'att_nfiLandcover', unit: 'class', label: 'NFI land cover' },
  age: { file: 'age_median', unit: 'years', label: 'Median stand age' },
  lodgepolePine: { file: 'spsCC_lodgepolePine', unit: '%', label: 'Lodgepole pine crown closure' },
  blackSpruce: { file: 'spsCC_blackSpruce', unit: '%', label: 'Black spruce crown closure' },
  balsamFir: { file: 'spsCC_balsamFir', unit: '%', label: 'Balsam fir crown closure' },
  douglasFir: { file: 'spsCC_douglasFir', unit: '%', label: 'Douglas-fir crown closure' },
  otherConiferous: { file: 'spsCC_otherConiferous', unit: '%', label: 'Other coniferous crown closure' },
  broadleaf: { file: 'spsCC_broadleaf', unit: '%', label: 'Broadleaf crown closure' },
} as const
export type ScanfiLayer = keyof typeof SCANFI_LAYERS

/** NFI land cover codes, from the palette NRCan publishes beside each file (`SCANFI_att_nfiLandcover_*.qml`). */
export const SCANFI_LANDCOVER: Record<number, string> = {
  1: 'Bryoids',
  2: 'Herbs',
  3: 'Rock',
  4: 'Shrubs',
  5: 'Treed broadleaf',
  6: 'Treed conifer',
  7: 'Treed mixed',
  8: 'Water',
}

export function scanfiUrl(layer: ScanfiLayer, year: (typeof SCANFI_YEARS)[number], base = SCANFI_BASE_URL) {
  return `${base}/SCANFI_${SCANFI_LAYERS[layer].file}_${year}_v2_20260119.tif`
}

const toLcc = proj4('EPSG:4326', SCANFI_PROJ)

export interface ScanfiGrid {
  layer: ScanfiLayer
  year: number
  col0: number
  row0: number
  width: number
  height: number
  /** NaN where the file holds no data (255). */
  data: Float32Array
  source: string
}

/** Cell window (in the national grid) covering a lon/lat box, its edges densified before projecting. */
export function scanfiWindow([w, s, e, n]: [number, number, number, number]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i <= 8; i++)
    for (const [lon, lat] of [
      [w + ((e - w) * i) / 8, s],
      [w + ((e - w) * i) / 8, n],
      [w, s + ((n - s) * i) / 8],
      [e, s + ((n - s) * i) / 8],
    ]) {
      const [x, y] = toLcc.forward([lon, lat])
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  const col0 = Math.floor((minX - SCANFI_ORIGIN[0]) / SCANFI_CELL_M),
    row0 = Math.floor((SCANFI_ORIGIN[1] - maxY) / SCANFI_CELL_M)
  const col1 = Math.ceil((maxX - SCANFI_ORIGIN[0]) / SCANFI_CELL_M),
    row1 = Math.ceil((SCANFI_ORIGIN[1] - minY) / SCANFI_CELL_M)
  return { col0, row0, width: col1 - col0, height: row1 - row0 }
}

export interface ScanfiTiff {
  getImage(index?: number): Promise<{
    getOrigin(): number[]
    getResolution(): number[]
    readRasters(options: {
      window: [number, number, number, number]
      samples: number[]
      interleave: true
    }): Promise<ArrayLike<number>>
  }>
}

export async function readScanfi(
  layer: ScanfiLayer,
  year: (typeof SCANFI_YEARS)[number],
  bounds: [number, number, number, number],
  openTiff: (url: string) => Promise<ScanfiTiff>,
  base?: string,
): Promise<ScanfiGrid> {
  const source = scanfiUrl(layer, year, base)
  const image = await (await openTiff(source)).getImage()
  const [ox, oy] = image.getOrigin(),
    [rx, ry] = image.getResolution()
  if (ox !== SCANFI_ORIGIN[0] || oy !== SCANFI_ORIGIN[1] || rx !== SCANFI_CELL_M || ry !== -SCANFI_CELL_M)
    throw Error(`${source} is not on the SCANFI v2 grid (origin ${ox}, ${oy}; cell ${rx}, ${ry}).`)
  const win = scanfiWindow(bounds)
  if (win.width * win.height > SCANFI_MAX_WINDOW_CELLS) throw Error('The SCANFI window is too large.')
  const raw = await image.readRasters({
    window: [win.col0, win.row0, win.col0 + win.width, win.row0 + win.height],
    samples: [0],
    interleave: true,
  })
  const data = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = raw[i] === SCANFI_NODATA ? NaN : raw[i]
  return { layer, year, ...win, data, source }
}

/** Value of the cell holding a point, or NaN outside the window or where there is no data. */
export function scanfiAt(grid: ScanfiGrid, lon: number, lat: number) {
  const [x, y] = toLcc.forward([lon, lat])
  const c = Math.floor((x - SCANFI_ORIGIN[0]) / SCANFI_CELL_M) - grid.col0,
    r = Math.floor((SCANFI_ORIGIN[1] - y) / SCANFI_CELL_M) - grid.row0
  return c < 0 || r < 0 || c >= grid.width || r >= grid.height ? NaN : grid.data[r * grid.width + c]
}

/** Centre of a window cell, lon/lat. */
export function scanfiCellCentre(grid: Pick<ScanfiGrid, 'col0' | 'row0'>, col: number, row: number) {
  return toLcc.inverse([
    SCANFI_ORIGIN[0] + (grid.col0 + col + 0.5) * SCANFI_CELL_M,
    SCANFI_ORIGIN[1] - (grid.row0 + row + 0.5) * SCANFI_CELL_M,
  ]) as [number, number]
}
