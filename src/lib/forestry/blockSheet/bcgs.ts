/**
 * BCGS 1:20,000 mapsheet names (e.g. "093I003") from longitude/latitude, by arithmetic on the NTS
 * grid rather than a lookup of the provincial grid layer. No DOM or network access.
 *
 * - NTS series: 8° of longitude by 4° of latitude; west of 112°W and north of 48°N the number is
 *   (tens from longitude, units from latitude), so 093 covers 120–128°W, 52–56°N.
 * - Letter: sixteen 2° × 1° blocks in four rows from the south, snaking: A–D run east to west on the
 *   bottom row, E–H west to east, I–L east to west, M–P west to east.
 * - Sheet: one hundred 0.2° × 0.1° cells numbered 001–100 from the south-west corner, west to east,
 *   rows northward.
 *
 * Checked against the published grid at two places: (−121.5254, 54.0595) is 093I003 and
 * (−122.71, 53.895) is 093G087.
 */

/** Latitudes and longitudes the arithmetic covers: British Columbia's NTS series 082–114. */
export const BCGS_BOUNDS = { west: -144, east: -112, south: 48, north: 60 } as const
const LETTERS = 'ABCDEFGHIJKLMNOP'
/** Absorbs floating-point error so a point on a cell line falls in the cell north or east of it. */
const EDGE = 1e-9

/** Series column (0 = 136–144°W … 3 = 112–120°W) and row (0 = 48–52°N …) of a point inside the bounds. */
function seriesCell(lng: number, lat: number) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < BCGS_BOUNDS.west || lng >= BCGS_BOUNDS.east || lat < BCGS_BOUNDS.south || lat >= BCGS_BOUNDS.north)
    return null
  const column = Math.min(3, Math.floor((lng - BCGS_BOUNDS.west) / 8 + EDGE))
  const row = Math.min(2, Math.floor((lat - BCGS_BOUNDS.south) / 4 + EDGE))
  return { column, row, west: BCGS_BOUNDS.west + column * 8, south: BCGS_BOUNDS.south + row * 4 }
}

/** "093" for a point in NTS series 93, or null outside `BCGS_BOUNDS`. */
export function ntsSeries(lng: number, lat: number): string | null {
  const cell = seriesCell(lng, lat)
  // Tens count 8 to 11 westward from 112°W; units 2 to 4 northward from 48°N.
  return cell ? String((11 - cell.column) * 10 + cell.row + 2).padStart(3, '0') : null
}

/** "093I003", or null outside `BCGS_BOUNDS`. */
export function bcgsMapsheet(lng: number, lat: number): string | null {
  const series = ntsSeries(lng, lat)
  const cell = seriesCell(lng, lat)
  if (!series || !cell) return null
  const row = Math.min(3, Math.floor(lat - cell.south + EDGE))
  const fromWest = Math.min(3, Math.floor((lng - cell.west) / 2 + EDGE))
  // Rows 0 and 2 letter east to west, rows 1 and 3 west to east.
  const letter = LETTERS[row * 4 + (row % 2 === 0 ? 3 - fromWest : fromWest)]
  const blockWest = cell.west + fromWest * 2
  const blockSouth = cell.south + row
  const sheetRow = Math.min(9, Math.floor((lat - blockSouth) / 0.1 + EDGE))
  const sheetColumn = Math.min(9, Math.floor((lng - blockWest) / 0.2 + EDGE))
  return `${series}${letter}${String(sheetRow * 10 + sheetColumn + 1).padStart(3, '0')}`
}
