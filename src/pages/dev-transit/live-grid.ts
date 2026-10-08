import type { Access, HeatGridSpec, TransitData } from './types'
import { heatAccessMeters, streetAccessIndex, STREET_MX, STREET_MY } from './street-access'

const MX = STREET_MX
const MY = STREET_MY
const MAX_CELLS = 120000

export function viewportGrid(study: HeatGridSpec['bbox'], view: HeatGridSpec['bbox'], zoom: number): HeatGridSpec {
  const paddingX = (view[2] - view[0]) * 0.15,
    paddingY = (view[3] - view[1]) * 0.15
  const bbox: HeatGridSpec['bbox'] = [
    Math.max(study[0], view[0] - paddingX),
    Math.max(study[1], view[1] - paddingY),
    Math.min(study[2], view[2] + paddingX),
    Math.min(study[3], view[3] + paddingY),
  ]
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return viewportGrid(study, study, zoom)
  const width = (bbox[2] - bbox[0]) * MX,
    height = (bbox[3] - bbox[1]) * MY
  const spacing = Math.max(
    12.5,
    Math.min(50, ((MX * 360) / (512 * 2 ** zoom)) * 3),
    Math.sqrt((width * height) / (MAX_CELLS - 1000)),
  )
  return { bbox, cols: Math.max(2, Math.ceil(width / spacing)), rows: Math.max(2, Math.ceil(height / spacing)) }
}

/** Spatially indexed access sampling, generated in the browser worker. */
export function liveGridBuilder(
  data: Pick<TransitData, 'walkNodes' | 'streetAccessNodes'> & {
    meta: Pick<TransitData['meta'], 'bbox' | 'gridAccessMeters'>
  },
) {
  const access = streetAccessIndex(data)
  const radius = heatAccessMeters(data.meta)
  return (spec: HeatGridSpec): TransitData['grid'] => {
    const cells: Access[] = []
    const [west, south, east, north] = spec.bbox
    for (let row = 0; row < spec.rows; row++) {
      const latitude = north - ((row + 0.5) * (north - south)) / spec.rows
      for (let col = 0; col < spec.cols; col++) {
        const longitude = west + ((col + 0.5) * (east - west)) / spec.cols
        cells.push(access([longitude, latitude], radius))
      }
    }
    return { cols: spec.cols, rows: spec.rows, cells }
  }
}
