// SPDX-License-Identifier: Apache-2.0
import { fromArrayBuffer } from 'geotiff'
import { CASTOR_IMPORT_LIMIT_BYTES } from './inputTables'
import { requireCastorProject } from './inputs'
import type { CastorProject, CastorScheduledHarvest } from './types'

export type CastorRasterRole = 'salvage' | 'blocks' | 'zone' | 'harvest-period' | 'harvest-schedule'

/** Imports aligned rasters only. Resolution, projection and NoData are never guessed. */
export async function importCastorRaster(
  project: CastorProject,
  file: File,
  role: CastorRasterRole,
  zoneName = 'imported-zone',
): Promise<CastorProject> {
  const grid = project.grid
  if (!grid) throw new Error('Load an inventory with a regular projected grid before adding a raster.')
  if (file.size > CASTOR_IMPORT_LIMIT_BYTES) throw new Error('GeoTIFF input exceeds 64 MB.')
  if (!['salvage', 'blocks', 'zone', 'harvest-period', 'harvest-schedule'].includes(role))
    throw new Error('Unknown raster input role.')
  if (
    role === 'zone' &&
    (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(zoneName) || ['constructor', 'prototype', '__proto__'].includes(zoneName))
  )
    throw new Error(
      'Use a zone name starting with a letter and containing only letters, digits, hyphens or underscores.',
    )
  const tiff = await fromArrayBuffer(await file.arrayBuffer())
  const image = await tiff.getImage()
  if (image.getWidth() !== grid.width || image.getHeight() !== grid.height)
    throw new Error(
      'Raster dimensions do not match the inventory grid. Reproject and align it before import; the browser will not resample silently.',
    )
  const keys = image.getGeoKeys()
  const epsg = Number(/^EPSG:(\d+)$/i.exec(grid.crs)?.[1] ?? 0)
  if (
    !epsg ||
    keys.ProjectedCSTypeGeoKey !== epsg ||
    keys.GTRasterTypeGeoKey === 2 ||
    image.getFileDirectory().ModelTransformation
  )
    throw new Error('Raster must use the same projected EPSG code and north-up pixel-area grid as the inventory.')
  const origin = image.getOrigin(),
    resolution = image.getResolution()
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, grid.cellSize * 1e-8)
  if (
    !close(origin[0], grid.originX) ||
    !close(origin[1], grid.originY) ||
    !close(resolution[0], grid.cellSize) ||
    !close(resolution[1], -grid.cellSize)
  )
    throw new Error('Raster origin or resolution differs from the inventory. Use an exactly aligned grid.')
  const samples = image.getSamplesPerPixel()
  if (samples < 1 || samples > 100 || grid.width * grid.height * samples > 2_000_000)
    throw new Error('Raster exceeds the 100-band or 2,000,000 cell-band browser limit.')
  if (role !== 'harvest-schedule' && samples !== 1)
    throw new Error('This raster role needs one band. Use Harvest schedule for one band per period.')
  const bands = await image.readRasters({ interleave: false })
  const noData = image.getGDALNoData()
  const next = structuredClone(project)
  const byPeriod = new Map<number, number[]>()
  const scheduledLabels = new Set<string>()
  for (const pixel of next.pixels) {
    if (pixel.gridIndex === undefined) throw new Error(`Pixel ${pixel.id} has no grid placement.`)
    for (let band = 0; band < samples; band++) {
      const array = bands[band]
      if (!ArrayBuffer.isView(array)) throw new Error('The GeoTIFF did not return numeric raster bands.')
      const value = Number((array as Float64Array)[pixel.gridIndex])
      const missing = !Number.isFinite(value) || (noData !== null && value === noData)
      if (missing)
        throw new Error(
          `Raster has NoData at inventory pixel ${pixel.id}${samples > 1 ? `, band ${band + 1}` : ''}. Supply explicit values or remove that inventory cell; missing data are not interpreted as zero.`,
        )
      if (role === 'salvage') {
        if (value < 0) throw new Error('Salvage volume must be nonnegative m³/ha.')
        pixel.salvageVolume = value
      } else if (role === 'blocks') {
        if (!Number.isSafeInteger(value) || value <= 0)
          throw new Error('A block raster must contain positive integer IDs at every inventory cell.')
        pixel.blockId = String(value)
      } else if (role === 'zone') {
        if (!Number.isSafeInteger(value)) throw new Error('Zone raster IDs must be integers.')
        pixel.zones[zoneName] = String(value)
      } else {
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error('Schedule rasters require nonnegative integer values; zero is explicitly unscheduled.')
        if (value === 0) continue
        const period = role === 'harvest-period' ? value : band + 1
        if (period > 100) throw new Error('Harvest periods must be between 1 and 100.')
        const ids = byPeriod.get(period) ?? []
        ids.push(pixel.id)
        byPeriod.set(period, ids)
        if (role === 'harvest-schedule') scheduledLabels.add(String(value))
      }
    }
  }
  if (role === 'blocks') {
    next.adjacency = []
    next.landings = []
    // Source blocks must not retain spatial relationships from the old block set.
    if (next.schedule?.some((row) => row.blockIds?.length))
      throw new Error(
        'This project contains a block-ID harvest schedule. Convert it to pixel IDs or remove it before replacing the block raster.',
      )
    next.provenance.notes.push(
      'Imported block IDs replaced the old block set. Old adjacency and landing tables were removed; supply relationships for these new blocks before enabling adjacency.',
    )
  }
  if (role === 'harvest-period' || role === 'harvest-schedule') {
    next.schedule = [...byPeriod.entries()]
      .sort(([a], [b]) => a - b)
      .map(([period, pixelIds]): CastorScheduledHarvest => ({ period, pixelIds, type: 'live' }))
    const periods = Math.max(next.config?.periods ?? 1, ...byPeriod.keys())
    next.config = { ...next.config, mode: 'schedule', periods }
    if (role === 'harvest-schedule')
      next.provenance.notes.push(
        `Imported ${samples} schedule bands and ${scheduledLabels.size} positive source labels. Bands select pixels by period; existing inventory block IDs are retained for reporting. Import a block raster separately to define harvest-unit grouping.`,
      )
  }
  next.provenance.notes.push(
    `Imported local ${role} raster ${file.name} on the unchanged ${grid.cellSize} m ${grid.crs} grid${role === 'zone' ? ` as zone ${zoneName}` : ''}.`,
  )
  return requireCastorProject(next)
}
