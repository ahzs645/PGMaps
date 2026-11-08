import { withBrowserGdal } from '../dev-avast/gdal'
import { FIT_CRS, parseProject, type GeoreferenceProject, type Pixel, type Point } from './model'
import { fitTransformation, lngLatToMercator } from './transforms'

/** A browser memory limit, not an estimate of geographic accuracy. */
export const MAX_BROWSER_EXPORT_PIXELS = 64_000_000
const MAX_INPUT_BYTES = 256 * 1024 * 1024
const MAX_ESTIMATED_WORKING_BYTES = 768 * 1024 * 1024
const OWNER_CLI = 'Use the owner-side native raster export for this image.'

export interface BrowserGeoTiffExportOptions {
  onProgress?: (message: string) => void
  /** Cancellation is checked between GDAL worker calls, not during a native warp. */
  signal?: AbortSignal
  /** May lower, but never raise, the browser's 64-megapixel limit. */
  maxOutputPixels?: number
  resampling?: 'near' | 'bilinear'
}

export interface BrowserExportGcp {
  /** GDAL pixel/line coordinates address outer pixel corners. */
  pixel: Pixel
  projected: Point
}

export interface BrowserExportPlan {
  project: GeoreferenceProject
  gcps: BrowserExportGcp[]
  spacing: number
  sampledBounds: [number, number, number, number]
  maxOutputPixels: number
  translateArgs: string[]
  warpArgs: string[]
}

/** Optional native-file/header facts, available before downloading the full source. */
export interface BrowserExportSourceInfo {
  inputBytes?: number
  bandCount?: number
  /** Bytes per decoded GDAL sample, not compressed bytes or bytes per whole pixel. */
  bytesPerSample?: number
  hasAlpha?: boolean
}

export interface BrowserExportPreflight {
  plan: BrowserExportPlan
  sampledOutputPixels: number
  /** Null when file size or native sample metadata is unknown; GDAL still checks it later. */
  estimatedWorkingBytes: number | null
}

function budgetError(detail: string): Error {
  return new Error(`${detail} ${OWNER_CLI}`)
}

function estimateWorkingBytes(
  inputBytes: number,
  sourcePixels: number,
  sourceBands: number,
  outputPixels: number,
  outputBands: number,
  bytesPerSample: number,
): number {
  return (
    inputBytes * 2 +
    sourcePixels * sourceBands * bytesPerSample * 2 +
    outputPixels * outputBands * bytesPerSample * 3 +
    64 * 1024 * 1024
  )
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('GeoTIFF export was cancelled.', 'AbortError')
}

/** Pixel-centre coordinates in a portable project become GDAL pixel-edge coordinates. */
export function toGdalPixel(pixel: Pixel): Pixel {
  return [pixel[0] + 0.5, pixel[1] + 0.5]
}

/** Build the exact fitted model's GCPs and source-density sampling, without loading WASM. */
export function createBrowserExportPlan(
  input: GeoreferenceProject,
  options: BrowserGeoTiffExportOptions = {},
): BrowserExportPlan {
  const project = parseProject(input)
  const { width, height } = project.source
  if (width < 2 || height < 2) throw new Error('GeoTIFF export needs a two-dimensional native raster.')
  if (width * height > MAX_BROWSER_EXPORT_PIXELS) {
    throw budgetError("The native source exceeds the browser's 64-megapixel working limit.")
  }
  const limit = options.maxOutputPixels ?? MAX_BROWSER_EXPORT_PIXELS
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_BROWSER_EXPORT_PIXELS) {
    throw new Error('The output budget must be an integer between 1 and 64,000,000 pixels.')
  }
  const fitted = fitTransformation(project)
  if (fitted.diagnostics.folded) throw new Error('Revise the folded or singular TPS fit before exporting a raster.')

  // GDAL has no similarity constraint. Three synthetic, noncollinear points encode
  // the fitted similarity/affine itself instead of refitting noisy controls as affine.
  const anchors: Pixel[] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
  ]
  const native = fitted.nativeMatrix
  const nativeCrs = native?.crs ?? FIT_CRS
  const gcps = native
    ? anchors.map((pixel) => ({
        pixel: toGdalPixel(pixel),
        projected: [
          native.matrix[0][0] * pixel[0] + native.matrix[0][1] * pixel[1] + native.matrix[0][2],
          native.matrix[1][0] * pixel[0] + native.matrix[1][1] * pixel[1] + native.matrix[1][2],
        ] as Point,
      }))
    : project.transform === 'thin-plate-spline'
      ? project.points
          .filter((p) => p.enabled && p.role === 'control')
          .map((p) => ({
            pixel: toGdalPixel(p.pixel),
            projected: lngLatToMercator(p.coordinate),
          }))
      : anchors.map((pixel) => ({ pixel: toGdalPixel(pixel), projected: fitted.forwardProjected(pixel) }))

  const samples: Point[] = []
  const densities: number[] = []
  for (let row = 0; row <= 16; row += 1) {
    for (let column = 0; column <= 16; column += 1) {
      const pixel: Pixel = [-0.5 + (column * width) / 16, -0.5 + (row * height) / 16]
      const point = fitted.forwardProjected(pixel)
      samples.push(point)
      if (row < 16 && column < 16) {
        const x = fitted.forwardProjected([pixel[0] + 1, pixel[1]])
        const y = fitted.forwardProjected([pixel[0], pixel[1] + 1])
        const dx: Point = [x[0] - point[0], x[1] - point[1]]
        const dy: Point = [y[0] - point[0], y[1] - point[1]]
        const a = dx[0] ** 2 + dx[1] ** 2
        const d = dy[0] ** 2 + dy[1] ** 2
        const b = dx[0] * dy[0] + dx[1] * dy[1]
        // The smaller singular value preserves the finest fitted sampling axis,
        // even when shear makes both pixel vectors long and nearly parallel.
        const maximumSingular = Math.sqrt((a + d + Math.hypot(a - d, 2 * b)) / 2)
        const density = Math.abs(dx[0] * dy[1] - dx[1] * dy[0]) / maximumSingular
        if (!Number.isFinite(density) || density <= 0) throw new Error('The fitted source pixel spacing is invalid.')
        densities.push(density)
      }
    }
  }
  densities.sort((a, b) => a - b)
  const spacing = densities[Math.floor(densities.length / 2)]
  const sampledBounds: [number, number, number, number] = [
    Math.min(...samples.map((p) => p[0])),
    Math.min(...samples.map((p) => p[1])),
    Math.max(...samples.map((p) => p[0])),
    Math.max(...samples.map((p) => p[1])),
  ]
  const sampledPixels =
    Math.ceil((sampledBounds[2] - sampledBounds[0]) / spacing) *
    Math.ceil((sampledBounds[3] - sampledBounds[1]) / spacing)
  if (!Number.isFinite(sampledPixels) || sampledPixels > limit) {
    throw budgetError('The fitted raster exceeds the browser output pixel budget.')
  }

  // VRT keeps the original samples, alpha, mask, and nodata without copying a
  // full intermediate TIFF or losing an external .msk while remounting a File.
  const translateArgs = ['-of', 'VRT', '-a_srs', nativeCrs]
  for (const gcp of gcps) translateArgs.push('-gcp', ...gcp.pixel.map(String), ...gcp.projected.map(String))
  const method =
    !native && project.transform === 'thin-plate-spline'
      ? ['-to', 'SRC_METHOD=GCP_TPS', '-tps']
      : ['-to', 'SRC_METHOD=GCP_POLYNOMIAL', '-order', '1']
  const warpArgs = [
    '-overwrite',
    ...method,
    '-s_srs',
    nativeCrs,
    '-t_srs',
    FIT_CRS,
    '-tr',
    String(spacing),
    String(spacing),
    '-et',
    '0',
    '-r',
    options.resampling ?? 'bilinear',
    '-dstalpha',
    '-wm',
    '64',
  ]
  return { project, gcps, spacing, sampledBounds, maxOutputPixels: limit, translateArgs, warpArgs }
}

/**
 * Reject known oversized jobs before fetching source bytes or loading WASM.
 * Sampled bounds cannot replace GDAL's actual output-size and memory checks.
 */
export function preflightBrowserGeoTiffExport(
  project: GeoreferenceProject,
  sourceInfo: BrowserExportSourceInfo = {},
  options: BrowserGeoTiffExportOptions = {},
): BrowserExportPreflight {
  const { inputBytes, bandCount, bytesPerSample, hasAlpha } = sourceInfo
  if (inputBytes !== undefined) {
    if (!Number.isSafeInteger(inputBytes) || inputBytes < 0) {
      throw new Error('The known source byte length must be a nonnegative safe integer.')
    }
    if (inputBytes > MAX_INPUT_BYTES) throw budgetError('The source file exceeds the 256 MiB browser input budget.')
  }
  for (const [label, value] of [
    ['band count', bandCount],
    ['decoded bytes per sample', bytesPerSample],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`The native ${label} must be a positive safe integer.`)
    }
  }
  if (hasAlpha !== undefined && typeof hasAlpha !== 'boolean') {
    throw new Error('Native alpha presence must be a boolean when known.')
  }
  const plan = createBrowserExportPlan(project, options)
  const [west, south, east, north] = plan.sampledBounds
  const sampledOutputPixels = Math.ceil((east - west) / plan.spacing) * Math.ceil((north - south) / plan.spacing)
  let estimatedWorkingBytes: number | null = null
  if (inputBytes !== undefined && bandCount !== undefined && bytesPerSample !== undefined && hasAlpha !== undefined) {
    estimatedWorkingBytes = estimateWorkingBytes(
      inputBytes,
      plan.project.source.width * plan.project.source.height,
      bandCount,
      sampledOutputPixels,
      bandCount + (hasAlpha ? 0 : 1),
      bytesPerSample,
    )
    if (!Number.isFinite(estimatedWorkingBytes) || estimatedWorkingBytes > MAX_ESTIMATED_WORKING_BYTES) {
      throw budgetError('This native raster needs more working memory than the browser export budget.')
    }
  }
  return { plan, sampledOutputPixels, estimatedWorkingBytes }
}

/** Hash the exact selected file; a same-sized preview is never sufficient identity. */
export async function verifyOriginalFile(project: GeoreferenceProject, original: File): Promise<void> {
  if (original.size > MAX_INPUT_BYTES) throw budgetError('The source file exceeds the 256 MiB browser input budget.')
  const tiffHash = project.source.frame.kind === 'geotiff-pixel-grid' ? project.source.geotiff?.sha256 : null
  if (project.source.sha256 && tiffHash && project.source.sha256 !== tiffHash) {
    throw new Error('The project records conflicting SHA-256 identities for its native TIFF pixel frame.')
  }
  const expected = project.source.sha256 ?? tiffHash
  if (!expected) throw new Error("Record the original source file's SHA-256 before exporting a native GeoTIFF.")
  const digest = await crypto.subtle.digest('SHA-256', await original.arrayBuffer())
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== expected)
    throw new Error(
      "The selected file does not match the project's source SHA-256. Select the exact native source, not a preview.",
    )
}

interface RasterInfo {
  width?: number
  height?: number
  bandCount?: number
  type?: string
}

/** Full native-file warp in the existing exclusive GDAL worker; no source upload. */
export async function exportRectifiedGeoTiff(
  project: GeoreferenceProject,
  original: File,
  options: BrowserGeoTiffExportOptions = {},
): Promise<Blob> {
  checkCancelled(options.signal)
  const { plan } = preflightBrowserGeoTiffExport(project, { inputBytes: original.size }, options)
  options.onProgress?.('Verifying the original source file')
  await verifyOriginalFile(plan.project, original)
  checkCancelled(options.signal)
  options.onProgress?.('Loading the raster export engine')
  return withBrowserGdal(async (gdal) => {
    type Dataset = Awaited<ReturnType<typeof gdal.open>>['datasets'][number]
    const handles: Dataset[] = []
    const openInternal = async (path: string): Promise<Dataset> => {
      // /output paths bypass WORKERFS remounting; the original File stays mounted.
      const opened = await gdal.open(path)
      const handle = opened.datasets[0]
      if (!handle) throw new Error('GDAL could not reopen its temporary raster.')
      handles.push(handle)
      return handle
    }
    try {
      checkCancelled(options.signal)
      const opened = await gdal.open(original)
      const source = opened.datasets[0]
      if (!source) throw new Error('GDAL could not read the original raster.')
      handles.push(...opened.datasets)
      const sourceInfo = (await gdal.getInfo(source)) as RasterInfo
      if (
        sourceInfo.type !== 'raster' ||
        sourceInfo.width !== plan.project.source.width ||
        sourceInfo.height !== plan.project.source.height
      ) {
        throw new Error("The original raster dimensions do not match the project's native pixel frame.")
      }
      checkCancelled(options.signal)
      options.onProgress?.('Preparing the fitted native raster')
      // Stable names overwrite previous job outputs: gdal3.js exposes no unlink
      // API and unique large COG filenames would accumulate in its WASM filesystem.
      const stamped = await gdal.gdal_translate(source, plan.translateArgs, 'pgmaps-rectification-gcps')
      const fitted = await openInternal(stamped.local)
      const preview = await gdal.gdalwarp(fitted, [...plan.warpArgs, '-of', 'VRT'], 'pgmaps-rectification-plan')
      const outputPlan = await openInternal(preview.local)
      const outputInfo = (await gdal.getInfo(outputPlan)) as RasterInfo
      const pixels = (outputInfo.width ?? 0) * (outputInfo.height ?? 0)
      if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > plan.maxOutputPixels) {
        throw budgetError("GDAL's fitted raster exceeds the browser output pixel budget.")
      }
      // Account for sample types, decoded data, output/COG buffers, the previous
      // output retained by GDAL's filesystem, and the hash/file byte buffers.
      const bandMetadata = (source.info as { bands?: Array<{ type?: string }> } | undefined)?.bands ?? []
      const sampleBytes: Record<string, number> = {
        Byte: 1,
        Int8: 1,
        UInt16: 2,
        Int16: 2,
        UInt32: 4,
        Int32: 4,
        Float32: 4,
        UInt64: 8,
        Int64: 8,
        Float64: 8,
        CInt16: 4,
        CInt32: 8,
        CFloat32: 8,
        CFloat64: 16,
      }
      const bytesPerSample = bandMetadata.length
        ? Math.max(...bandMetadata.map((band) => sampleBytes[band.type ?? ''] ?? 8))
        : 8
      const estimatedBytes = estimateWorkingBytes(
        original.size,
        plan.project.source.width * plan.project.source.height,
        sourceInfo.bandCount ?? 4,
        pixels,
        outputInfo.bandCount ?? 4,
        bytesPerSample,
      )
      if (estimatedBytes > MAX_ESTIMATED_WORKING_BYTES) {
        throw budgetError('This native raster needs more working memory than the browser export budget.')
      }
      await gdal.close(outputPlan)
      handles.splice(handles.indexOf(outputPlan), 1)
      checkCancelled(options.signal)
      options.onProgress?.('Writing the full-resolution Cloud Optimized GeoTIFF')
      const output = await gdal.gdalwarp(
        fitted,
        [...plan.warpArgs, '-of', 'COG', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=IF_SAFER'],
        'pgmaps-rectification-output',
      )
      checkCancelled(options.signal)
      const bytes = await gdal.getFileBytes(output)
      options.onProgress?.('GeoTIFF download ready')
      return new Blob([bytes as BlobPart], { type: 'image/tiff' })
    } finally {
      for (const handle of handles.reverse()) {
        try {
          await gdal.close(handle)
        } catch {
          /* A failed native operation may already have closed it. */
        }
      }
    }
  })
}
