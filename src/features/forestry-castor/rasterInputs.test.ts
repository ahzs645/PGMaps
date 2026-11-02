import { describe, expect, it } from 'vitest'
import { createExampleProject } from './inputs'
import { encodeCastorGeoTiff } from './geotiff'
import { importCastorRaster } from './rasterInputs'
import type { CastorGrid } from './types'

function raster(grid: CastorGrid, values: Array<number | null>) {
  return new File([encodeCastorGeoTiff(grid, values, 'test')], 'local-input.tif', { type: 'image/tiff' })
}

describe('aligned local raster input', () => {
  it('imports salvage density without changing live volume, coordinates or the caller', async () => {
    const original = createExampleProject(),
      before = structuredClone(original)
    const values = original.pixels.map((_, i) => i + 0.125)
    const result = await importCastorRaster(original, raster(original.grid!, values), 'salvage')
    expect(result.pixels[10].salvageVolume).toBe(10.125)
    expect(result.pixels[10].volume).toBe(original.pixels[10].volume)
    expect(result.grid).toEqual(original.grid)
    expect(original).toEqual(before)
  })

  it('rejects a shifted grid and NoData within supplied inventory', async () => {
    const project = createExampleProject(),
      values = project.pixels.map(() => 12)
    await expect(
      importCastorRaster(project, raster({ ...project.grid!, originX: project.grid!.originX + 50 }, values), 'salvage'),
    ).rejects.toThrow(/origin or resolution/)
    const missing: Array<number | null> = [...values]
    missing[8] = null
    await expect(importCastorRaster(project, raster(project.grid!, missing), 'salvage')).rejects.toThrow(
      /NoData at inventory pixel 9/,
    )
  })

  it('removes stale block relationships and imports categorical zones', async () => {
    const project = createExampleProject(),
      values = project.pixels.map((_, i) => Math.floor(i / 8) + 1)
    const blocks = await importCastorRaster(project, raster(project.grid!, values), 'blocks')
    expect(blocks.pixels[9].blockId).toBe('2')
    expect(blocks.landings).toEqual([])
    expect(blocks.adjacency).toEqual([])
    const zones = await importCastorRaster(project, raster(project.grid!, values), 'zone', 'new-watershed')
    expect(zones.pixels[9].zones['new-watershed']).toBe('2')
    await expect(importCastorRaster(project, raster(project.grid!, values), 'zone', '__proto__')).rejects.toThrow(
      /zone name/,
    )
  })

  it('makes an explicit period schedule and retains the current planning horizon', async () => {
    const project = createExampleProject(),
      values = project.pixels.map((_, i) => (i === 20 ? 2 : i === 21 ? 4 : 0))
    const result = await importCastorRaster(project, raster(project.grid!, values), 'harvest-period')
    expect(result.schedule).toEqual([
      { period: 2, pixelIds: [21], type: 'live' },
      { period: 4, pixelIds: [22], type: 'live' },
    ])
    expect(result.config?.mode).toBe('schedule')
    expect(result.config?.periods).toBe(4)
    const shorter = await importCastorRaster(
      project,
      raster(
        project.grid!,
        project.pixels.map((_, i) => (i === 20 ? 1 : 0)),
      ),
      'harvest-period',
    )
    expect(shorter.config?.periods).toBe(4)
  })
})
