import type { Access, Point, TransitData } from './types'

export const STREET_MX = 111320 * Math.cos((53.92 * Math.PI) / 180)
export const STREET_MY = 111320
const BIN = 150
type AccessData = Pick<TransitData, 'walkNodes' | 'streetAccessNodes'>
const indices = new WeakMap<AccessData, ReturnType<typeof buildIndex>>()

export function markerAccessMeters(meta: Partial<TransitData['meta']>) {
  return meta.markerAccessMeters ?? meta.streetSnapMeters ?? 180
}

export function heatAccessMeters(meta: Partial<TransitData['meta']>) {
  return meta.gridAccessMeters ?? 150
}

function buildIndex(data: AccessData) {
  const xy = (p: Point) => [(p[0] + 122.8) * STREET_MX, (p[1] - 53.92) * STREET_MY]
  const positions = data.walkNodes.map(xy)
  const preferred = data.streetAccessNodes ? new Set(data.streetAccessNodes) : null
  const bins = new Map<string, number[]>()
  positions.forEach(([x, y], node) => {
    const key = `${Math.floor(x / BIN)}:${Math.floor(y / BIN)}`
    const bucket = bins.get(key) ?? []
    bucket.push(node)
    bins.set(key, bucket)
  })
  return (point: Point, radius: number): Access => {
    const [x, y] = xy(point)
    let node = -1,
      distance2 = radius * radius,
      preferredNode = -1,
      preferredDistance2 = radius * radius
    for (let gx = Math.floor((x - radius) / BIN); gx <= Math.floor((x + radius) / BIN); gx++)
      for (let gy = Math.floor((y - radius) / BIN); gy <= Math.floor((y + radius) / BIN); gy++)
        for (const candidate of bins.get(`${gx}:${gy}`) ?? []) {
          const [nx, ny] = positions[candidate]
          const d = (x - nx) ** 2 + (y - ny) ** 2
          if (d < distance2 || (d === distance2 && (node < 0 || candidate < node))) {
            node = candidate
            distance2 = d
          }
          if (
            preferred?.has(candidate) &&
            (d < preferredDistance2 || (d === preferredDistance2 && (preferredNode < 0 || candidate < preferredNode)))
          ) {
            preferredNode = candidate
            preferredDistance2 = d
          }
        }
    if (preferredNode >= 0) return [preferredNode, Math.sqrt(preferredDistance2)]
    return node < 0 ? null : [node, Math.sqrt(distance2)]
  }
}

/** One index per immutable snapshot, shared by marker routing and heat sampling. */
export function streetAccessIndex(data: AccessData) {
  let index = indices.get(data)
  if (!index) {
    index = buildIndex(data)
    indices.set(data, index)
  }
  return index
}
