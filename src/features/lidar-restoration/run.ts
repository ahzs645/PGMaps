import type { LazPerf } from 'laz-perf'
import { readPointCloudHeader, type PointCloudHeader } from '@/lib/lidar/lasHeader'
import { openPointReader } from './reader'
import { pemStructureAccumulator } from './pemStructure'
import {
  groundAccumulator,
  accepted,
  makeGrid,
  metricsAccumulator,
  slopeRaster,
  MAX_INPUT_BYTES,
  MAX_SOURCE_POINTS,
  type RestorationOptions,
  type RestorationResult,
} from './model'

export interface PointFile extends Blob {
  name: string
}
export type Progress = { stage: 'ground' | 'terrain' | 'metrics'; file: string; done: number; total: number }
export function isMetricCrs(epsg: number) {
  return (
    epsg === 3005 ||
    (epsg >= 3154 && epsg <= 3161) ||
    (epsg >= 26901 && epsg <= 26923) ||
    (epsg >= 32601 && epsg <= 32660) ||
    (epsg >= 32701 && epsg <= 32760)
  )
}

export async function runRestoration(
  files: PointFile[],
  options: RestorationOptions,
  createLaz: () => Promise<LazPerf>,
  onProgress?: (p: Progress) => void,
): Promise<RestorationResult> {
  if (!files.length) throw Error('Choose at least one LAS or LAZ file.')
  if (files.reduce((n, f) => n + f.size, 0) > MAX_INPUT_BYTES)
    throw Error('Inputs exceed 768 MiB. Crop the clouds or process fewer tiles at once.')
  // Read public header + ordinary VLRs without bringing a full file onto the page.
  const headers: PointCloudHeader[] = []
  for (const file of files) {
    const prefix = await file.slice(0, 375).arrayBuffer()
    if (prefix.byteLength < 227) throw Error(`${file.name}: truncated LAS header.`)
    const pointOffset = new DataView(prefix).getUint32(96, true)
    if (pointOffset < 227 || pointOffset > 16 * 1024 * 1024 || pointOffset > file.size)
      throw Error(`${file.name}: invalid or oversized LAS metadata.`)
    const metadata = await file.slice(0, pointOffset).arrayBuffer()
    const h = readPointCloudHeader(metadata, { headerOnly: true })
    if (!h.points) throw Error(`${file.name}: the point cloud is empty.`)
    // WKT may be in an extended VLR after the points. Read only that bounded metadata.
    if ((!h.epsg || !h.verticalEpsg) && h.version === '1.4') {
      const view = new DataView(metadata),
        at = Number(view.getBigUint64(235, true))
      if (at > 0 && at < file.size) {
        const tail = new Uint8Array(await file.slice(at, Math.min(file.size, at + 1024 * 1024)).arrayBuffer())
        const joined = new Uint8Array(metadata.byteLength + tail.length)
        joined.set(new Uint8Array(metadata))
        joined.set(tail, metadata.byteLength)
        new DataView(joined.buffer).setBigUint64(235, BigInt(metadata.byteLength), true)
        const extended = readPointCloudHeader(joined, { headerOnly: true })
        h.epsg ??= extended.epsg
        h.verticalEpsg ??= extended.verticalEpsg
      }
    }
    if (!h.epsg || !isMetricCrs(h.epsg))
      throw Error(
        `${file.name}: use a supported metre-based UTM or BC Albers CRS with an EPSG code. Convert the cloud in GIS first.`,
      )
    if (![...h.scale, ...h.offset, ...h.min, ...h.max].every(Number.isFinite) || h.scale.some((s) => s <= 0))
      throw Error(`${file.name}: invalid coordinate scales or bounds.`)
    if (!h.compressed && h.pointOffset + h.points * h.pointLength > file.size)
      throw Error(`${file.name}: truncated LAS point records.`)
    if (headers.some((other) => other.epsg !== h.epsg || other.verticalEpsg !== h.verticalEpsg))
      throw Error('All tiles must have the same horizontal and vertical CRS. Reproject in GIS before mosaicking.')
    if (
      headers.some(
        (other) =>
          Math.min(other.max[0], h.max[0]) > Math.max(other.min[0], h.min[0]) &&
          Math.min(other.max[1], h.max[1]) > Math.max(other.min[1], h.min[1]),
      )
    )
      throw Error('Tile bounds overlap. Clip overlaps in GIS first so return densities are not double-counted.')
    headers.push(h)
  }
  if (headers.reduce((n, h) => n + h.points, 0) > MAX_SOURCE_POINTS)
    throw Error('Inputs exceed 150 million returns. Process fewer tiles at once.')
  const bounds: [number, number, number, number] = [
    Math.min(...headers.map((h) => h.min[0])),
    Math.min(...headers.map((h) => h.min[1])),
    Math.max(...headers.map((h) => h.max[0])),
    Math.max(...headers.map((h) => h.max[1])),
  ]
  const terrainGrid = makeGrid(bounds, options.terrainCellM),
    densityGrid = makeGrid(bounds, options.densityCellM),
    meanGrid = makeGrid(bounds, options.meanCellM),
    structureGrid = makeGrid(bounds, options.structureCellM)
  const ground = groundAccumulator(terrainGrid)
  async function scan(
    stage: 'ground' | 'metrics',
    visit: Parameters<Awaited<ReturnType<typeof openPointReader>>['scan']>[0],
  ) {
    for (const file of files) {
      onProgress?.({ stage, file: file.name, done: 0, total: 1 })
      const reader = await openPointReader(new Uint8Array(await file.arrayBuffer()), createLaz)
      try {
        reader.scan(visit, (done, total) => onProgress?.({ stage, file: file.name, done, total }))
      } finally {
        reader.dispose()
      }
    }
  }
  await scan('ground', ground.add)
  onProgress?.({ stage: 'terrain', file: '', done: 0, total: 1 })
  const { terrain, filled } = ground.finish()
  const metrics = metricsAccumulator(terrain, densityGrid, meanGrid)
  const structure = pemStructureAccumulator(structureGrid)
  await scan('metrics', (point) => {
    const height = metrics.add(point)
    if (accepted(point)) structure.add(point.x, point.y, height, point.classification, point.first)
  })
  return {
    epsg: headers[0].epsg!,
    verticalEpsg: headers[0].verticalEpsg,
    options,
    sources: files.map((f, i) => ({ name: f.name, bytes: f.size, points: headers[i].points })),
    counts: { ...metrics.counts, filled },
    rasters: { terrain, slope: slopeRaster(terrain), ...metrics.finish(), ...structure.finish() },
  }
}
