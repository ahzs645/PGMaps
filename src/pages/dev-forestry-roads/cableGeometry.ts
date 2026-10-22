import type { CableLine, Coordinate } from './types'

// Kept independent of engine.ts: the engine consumes this module. These use
// the same mean Earth radius and great-circle convention as road stationing.
const R = 6371008.8
const RAD = Math.PI / 180
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

function validCoordinate(point: Coordinate) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) >= 85
  )
    throw new Error('D-line supports require WGS84 coordinates between latitudes −85° and 85°.')
}
function span(a: Coordinate, b: Coordinate) {
  const dLat = (b[1] - a[1]) * RAD,
    dLng = (b[0] - a[0]) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(clamp(h, 0, 1)))
}
function heading(a: Coordinate, b: Coordinate) {
  const d = (b[0] - a[0]) * RAD,
    p = a[1] * RAD,
    q = b[1] * RAD
  return Math.atan2(Math.sin(d) * Math.cos(q), Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d))
}
function along(a: Coordinate, angle: number, distance: number): Coordinate {
  const d = distance / R,
    lat = a[1] * RAD,
    lng = a[0] * RAD
  const q = Math.asin(clamp(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(angle), -1, 1))
  const p = lng + Math.atan2(Math.sin(angle) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(q))
  return [((p / RAD + 540) % 360) - 180, q / RAD]
}
function inset(value: number | undefined, label: string) {
  const result = value ?? 0
  if (!Number.isFinite(result) || result < -200 || result > 200)
    throw new Error(`${label} offset must be between −200 m and 200 m.`)
  return result
}

/**
 * Original endpoints are stored unchanged. Positive offsets move each support
 * inward on the original great-circle line; negative values move it outward.
 * startHeight remains the yarder height and endHeight the tailhold height.
 * yarderAt assigns those roles to the physical start/end of the resolved line.
 *
 * The returned line has physical endpoint heights and cleared offset/orientation
 * controls, making resolution idempotent and safe for map/export/engine reuse.
 */
export function resolvedCableLine(line: CableLine): CableLine {
  validCoordinate(line.start)
  validCoordinate(line.end)
  const startOffset = inset(line.startOffsetM, 'Start'),
    endOffset = inset(line.endOffsetM, 'End')
  const yarderAt = line.yarderAt ?? 'start'
  if (yarderAt !== 'start' && yarderAt !== 'end')
    throw new Error('Choose the yarder at the start or end of the D-line.')
  if (![line.startHeight, line.endHeight].every((height) => Number.isFinite(height) && height >= 0 && height <= 100))
    throw new Error('D-line support heights must be between 0 m and 100 m.')
  const originalLength = span(line.start, line.end)
  const effectiveLength = originalLength - startOffset - endOffset
  // Preserve the engine's existing empty-span handling for an unchanged
  // coincident line; nonzero offsets cannot establish its missing direction.
  if (originalLength < 0.01 && (startOffset !== 0 || endOffset !== 0))
    throw new Error('D-line offsets require two distinct original endpoints.')
  if (originalLength >= 0.01 && effectiveLength < 0.01)
    throw new Error('D-line offsets collapse or reverse the support span. Keep the end support beyond the start.')
  const angle = heading(line.start, line.end)
  const start = startOffset === 0 ? ([...line.start] as Coordinate) : along(line.start, angle, startOffset)
  const end = endOffset === 0 ? ([...line.end] as Coordinate) : along(line.start, angle, originalLength - endOffset)
  validCoordinate(start)
  validCoordinate(end)
  return {
    ...line,
    start,
    end,
    startHeight: yarderAt === 'start' ? line.startHeight : line.endHeight,
    endHeight: yarderAt === 'start' ? line.endHeight : line.startHeight,
    startOffsetM: undefined,
    endOffsetM: undefined,
    yarderAt: undefined,
  }
}

/** A map cursor in the same physical direction as analyzeCable's profile axis. */
export function cableCoordinateAtDistance(line: CableLine, distanceM: number): Coordinate {
  const effective = resolvedCableLine(line)
  const length = span(effective.start, effective.end)
  const d = clamp(Number.isFinite(distanceM) ? distanceM : 0, 0, length)
  if (d === 0) return effective.start
  if (d === length) return effective.end
  return along(effective.start, heading(effective.start, effective.end), d)
}
