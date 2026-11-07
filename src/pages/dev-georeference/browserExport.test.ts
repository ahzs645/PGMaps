import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withBrowserGdal } from '../dev-avast/gdal'
import {
  createBrowserExportPlan,
  exportRectifiedGeoTiff,
  preflightBrowserGeoTiffExport,
  toGdalPixel,
  verifyOriginalFile,
} from './browserExport'
import { FIT_CRS, GEOREFERENCE_SCHEMA, PIXEL_CONVENTION, type GeoreferenceProject, type Point } from './model'
import { fitTransformation, mercatorToLngLat } from './transforms'

vi.mock('../dev-avast/gdal', () => ({ withBrowserGdal: vi.fn() }))

function project(transform: GeoreferenceProject['transform'] = 'affine'): GeoreferenceProject {
  const pixels: Point[] = [
    [0, 0],
    [99, 0],
    [0, 79],
    [99, 79],
    [50, 40],
  ]
  return {
    schema: GEOREFERENCE_SCHEMA,
    pixelConvention: PIXEL_CONVENTION,
    fitCrs: FIT_CRS,
    transform,
    source: {
      id: 'native-test-image',
      url: null,
      sha256: 'a'.repeat(64),
      width: 100,
      height: 80,
      frame: { kind: 'original-image', description: 'Exact native source pixels.' },
    },
    points: pixels.map((pixel, index) => ({
      id: `p${index}`,
      pixel,
      coordinate: mercatorToLngLat([-13900000 + 10 * pixel[0], 7100000 - 10 * pixel[1]]),
      enabled: true,
      role: 'control',
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('crypto', webcrypto)
})

describe('native-pixel GDAL export planning', () => {
  it('converts centre coordinates once, including fractional native positions', () => {
    expect(toGdalPixel([0, 0])).toEqual([0.5, 0.5])
    expect(toGdalPixel([31.25, 9.75])).toEqual([31.75, 10.25])
  })

  it('encodes the fitted similarity rather than refitting its noisy pairs as affine', () => {
    const input = project('similarity')
    input.points[4].coordinate = mercatorToLngLat([-13900000 + 502, 7100000 - 398])
    const fitted = fitTransformation(input)
    const plan = createBrowserExportPlan(input)
    expect(plan.gcps).toHaveLength(3)
    expect(plan.gcps.map((p) => p.pixel)).toEqual([
      [0.5, 0.5],
      [99.5, 0.5],
      [0.5, 79.5],
    ])
    for (const gcp of plan.gcps) {
      const predicted = fitted.forwardProjected([gcp.pixel[0] - 0.5, gcp.pixel[1] - 0.5])
      expect(gcp.projected).toEqual(predicted)
    }
    expect(plan.spacing).toBeCloseTo(10, 1)
    expect(plan.warpArgs).toContain('SRC_METHOD=GCP_POLYNOMIAL')
    expect(plan.warpArgs).toContain('-overwrite')
    expect(plan.warpArgs).toContain('-dstalpha')
    expect(plan.translateArgs.slice(0, 4)).toEqual(['-of', 'VRT', '-a_srs', 'EPSG:3857'])
  })

  it('keeps TPS controls, excludes disabled/check points, and forces real TPS warping', () => {
    const input = project('thin-plate-spline')
    input.points.push({
      id: 'sixth-control',
      pixel: [70, 60],
      coordinate: mercatorToLngLat([-13899300, 7099400]),
      enabled: true,
      role: 'control',
    })
    input.points.push({
      ...input.points[0],
      id: 'check',
      pixel: [30, 20],
      coordinate: mercatorToLngLat([-13899700, 7099800]),
      role: 'check',
    })
    input.points.push({ ...input.points[0], id: 'disabled', pixel: [20, 30], enabled: false })
    const plan = createBrowserExportPlan(input)
    expect(plan.gcps).toHaveLength(6)
    expect(plan.gcps[4].pixel).toEqual([50.5, 40.5])
    expect(plan.warpArgs).toContain('SRC_METHOD=GCP_TPS')
    expect(plan.warpArgs).toContain('-tps')
    expect(plan.warpArgs).not.toContain('-order')
    expect(plan.warpArgs).not.toContain('-srcnodata')
  })

  it('rejects unsafe native/output sizes without loading the raster engine', () => {
    const input = project()
    input.source.width = 10000
    input.source.height = 10000
    expect(() => createBrowserExportPlan(input)).toThrow(/64-megapixel.*owner-side/)
    expect(() => createBrowserExportPlan(project(), { maxOutputPixels: 50 })).toThrow(/output pixel budget/)
    expect(() => createBrowserExportPlan(project(), { maxOutputPixels: 65_000_000 })).toThrow(/64,000,000/)
    expect(withBrowserGdal).not.toHaveBeenCalled()
  })

  it('does not mistake nearly parallel sheared pixel vectors for coarse native spacing', () => {
    const input = project()
    for (const p of input.points) {
      p.coordinate = mercatorToLngLat([-13900000 + 100 * p.pixel[0] + 99 * p.pixel[1], 7100000 - p.pixel[1]])
    }
    const plan = createBrowserExportPlan(input)
    expect(plan.spacing).toBeGreaterThan(0.5)
    expect(plan.spacing).toBeLessThan(1)
  })
})

describe('export preflight before downloading source bytes', () => {
  it('plans a small known RGBA source without borrowing GDAL or reading a File', () => {
    const result = preflightBrowserGeoTiffExport(project(), {
      inputBytes: 12000,
      bandCount: 4,
      bytesPerSample: 1,
      hasAlpha: true,
    })
    expect(result.plan.project.source.width).toBe(100)
    expect(result.sampledOutputPixels).toBeGreaterThanOrEqual(8000)
    expect(result.sampledOutputPixels).toBeLessThan(8500)
    expect(result.estimatedWorkingBytes).toBeGreaterThan(64 * 1024 * 1024)
    expect(result.estimatedWorkingBytes).toBeLessThan(65 * 1024 * 1024)
    expect(withBrowserGdal).not.toHaveBeenCalled()
  })

  it('rejects known input, native and output pixel limits before a native download', () => {
    expect(() => preflightBrowserGeoTiffExport(project(), { inputBytes: 256 * 1024 * 1024 + 1 })).toThrow(
      /256 MiB.*owner-side/,
    )
    const large = project()
    large.source.width = 10000
    large.source.height = 10000
    expect(() => preflightBrowserGeoTiffExport(large)).toThrow(/64-megapixel.*owner-side/)
    expect(() => preflightBrowserGeoTiffExport(project(), {}, { maxOutputPixels: 50 })).toThrow(
      /output pixel budget.*owner-side/,
    )
    expect(withBrowserGdal).not.toHaveBeenCalled()
  })

  it('rejects a large compressed RGBA source on known working memory before downloading it', () => {
    const input = project()
    input.source.width = 7000
    input.source.height = 7000
    expect(() =>
      preflightBrowserGeoTiffExport(input, {
        inputBytes: 90_000_000,
        bandCount: 4,
        bytesPerSample: 1,
        hasAlpha: true,
      }),
    ).toThrow(/working memory.*owner-side/)
    expect(withBrowserGdal).not.toHaveBeenCalled()
  })

  it('does not invent a sample type when only file size or partial metadata is known', () => {
    const input = project()
    input.source.width = 7000
    input.source.height = 7000
    const result = preflightBrowserGeoTiffExport(input, { inputBytes: 90_000_000, bandCount: 4 })
    expect(result.estimatedWorkingBytes).toBeNull()
    expect(result.sampledOutputPixels).toBeLessThan(64_000_000)
    expect(withBrowserGdal).not.toHaveBeenCalled()
  })

  it('rejects invalid known header metadata instead of bypassing its budget', () => {
    for (const metadata of [{ inputBytes: NaN }, { inputBytes: -1 }, { bandCount: 0 }, { bytesPerSample: 0.5 }]) {
      expect(() => preflightBrowserGeoTiffExport(project(), metadata)).toThrow()
    }
  })
})

describe('exact native source verification', () => {
  it('rejects a same-size file with a different digest before borrowing GDAL', async () => {
    const input = project()
    const original = new File(['wrong native bytes'], 'native.png', { type: 'image/png' })
    await expect(exportRectifiedGeoTiff(input, original)).rejects.toThrow(/source SHA-256/)
    expect(withBrowserGdal).not.toHaveBeenCalled()
  })

  it('accepts the exact recorded source and rejects ambiguous TIFF identity', async () => {
    const original = new File(['native source bytes'], 'native.tif', { type: 'image/tiff' })
    const digest = await crypto.subtle.digest('SHA-256', await original.arrayBuffer())
    const input = project()
    input.source.sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    await expect(verifyOriginalFile(input, original)).resolves.toBeUndefined()
    input.source.frame.kind = 'geotiff-pixel-grid'
    input.source.geotiff = { url: 'https://example.org/native.tif', sha256: 'b'.repeat(64) }
    await expect(verifyOriginalFile(input, original)).rejects.toThrow(/conflicting SHA-256/)
  })

  it('requires a recorded source digest instead of trusting dimensions alone', async () => {
    const input = project()
    input.source.sha256 = null
    await expect(verifyOriginalFile(input, new File(['bytes'], 'preview.png'))).rejects.toThrow(/Record.*SHA-256/)
  })

  it('rejects a verified file whose native decoder dimensions disagree, and closes its handle', async () => {
    const original = new File(['native source bytes'], 'native.png', { type: 'image/png' })
    const digest = await crypto.subtle.digest('SHA-256', await original.arrayBuffer())
    const input = project()
    input.source.sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    const source = { pointer: 1, path: 'native.png', type: 'raster', info: {} }
    const gdal = {
      open: vi.fn().mockResolvedValue({ datasets: [source] }),
      getInfo: vi.fn().mockResolvedValue({ type: 'raster', width: 99, height: 80 }),
      close: vi.fn().mockResolvedValue(undefined),
      gdal_translate: vi.fn(),
    }
    vi.mocked(withBrowserGdal).mockImplementation(async (work) => work(gdal as never))
    await expect(exportRectifiedGeoTiff(input, original)).rejects.toThrow(/dimensions.*native pixel frame/)
    expect(gdal.gdal_translate).not.toHaveBeenCalled()
    expect(gdal.close).toHaveBeenCalledWith(source)
  })

  it('stops at a virtual GDAL plan when the actual proposed output is oversized', async () => {
    const original = new File(['native source bytes'], 'native.png', { type: 'image/png' })
    const digest = await crypto.subtle.digest('SHA-256', await original.arrayBuffer())
    const input = project()
    input.source.sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    const handles = [1, 2, 3].map((pointer) => ({ pointer, path: `raster-${pointer}`, type: 'raster', info: {} }))
    const gdal = {
      open: vi
        .fn()
        .mockResolvedValueOnce({ datasets: [handles[0]] })
        .mockResolvedValueOnce({ datasets: [handles[1]] })
        .mockResolvedValueOnce({ datasets: [handles[2]] }),
      getInfo: vi
        .fn()
        .mockResolvedValueOnce({ type: 'raster', width: 100, height: 80, bandCount: 3 })
        .mockResolvedValueOnce({ type: 'raster', width: 100000, height: 100000, bandCount: 4 }),
      gdal_translate: vi.fn().mockResolvedValue({ local: '/output/gcps.vrt' }),
      gdalwarp: vi.fn().mockResolvedValue({ local: '/output/plan.vrt' }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(withBrowserGdal).mockImplementation(async (work) => work(gdal as never))
    await expect(exportRectifiedGeoTiff(input, original)).rejects.toThrow(/GDAL's fitted raster.*owner-side/)
    expect(gdal.gdalwarp).toHaveBeenCalledTimes(1)
    expect(gdal.close).toHaveBeenCalledTimes(3)
  })
})
