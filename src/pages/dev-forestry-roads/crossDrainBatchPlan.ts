/**
 * Draft culverts on the plan: each previewed barrel where the engine placed it, and a small arrow
 * past its outlet for the flow direction the draft states. Violet while ready, red while something
 * refuses it, grey when excluded; never amber, the road's own colour, and never the blue of a
 * culvert in the road. Drawn on the culvert layer (`road-structures`), whose `arrow` features have
 * no gap between their walls.
 *
 * Free of DOM and network access.
 */
import { offsetCoordinate } from './engine'
import type { BatchRow } from './crossDrainBatch'
import type { Coordinate } from './types'

export const DRAFT_CULVERT_COLOURS = { ready: '#7c3aed', refused: '#dc2626', excluded: '#94a3b8' } as const
/** Arrow shaft past the outlet, m. */
const ARROW_M = 3
const HEAD_DEGREES = 28
const RAD = Math.PI / 180

function bearing(a: Coordinate, b: Coordinate): number {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD)
  return (((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) / RAD) % 360) + 360) % 360
}

const line = (coordinates: Coordinate[], properties: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates },
})

export function draftBarrelFeatures(rows: readonly BatchRow[]): GeoJSON.Feature[] {
  return rows.flatMap((row) => {
    const r = row.result
    if (!r) return []
    const color = !row.draft.included
      ? DRAFT_CULVERT_COLOURS.excluded
      : row.ready
        ? DRAFT_CULVERT_COLOURS.ready
        : DRAFT_CULVERT_COLOURS.refused
    const base = { id: row.draft.id, chainage: row.culvert.chainage, name: row.culvert.name, color, draft: true }
    // `start` is the inlet end and `end` the outlet end (`inletSide`).
    const heading = bearing(r.start, r.end)
    const tip = offsetCoordinate(r.end, heading, ARROW_M)
    const head = ARROW_M * 0.45
    return [
      line([r.start, r.end], { ...base, kind: 'barrel', selected: false }),
      line([r.end, tip], { ...base, kind: 'arrow', arrow: true }),
      line(
        [
          offsetCoordinate(tip, heading + 180 - HEAD_DEGREES, head),
          tip,
          offsetCoordinate(tip, heading + 180 + HEAD_DEGREES, head),
        ],
        { ...base, kind: 'arrow', arrow: true },
      ),
    ]
  })
}
