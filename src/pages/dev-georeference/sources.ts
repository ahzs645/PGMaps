import { addDecoder, fromBlob, fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff'
import proj4 from 'proj4'
import { crsDefinition } from '@/lib/geo/projectedCrs'
import { httpsURL, type Bounds, type RasterRecord } from '../dev-view/catalogue'
import type { GeoreferenceSource, Pixel, Coordinate } from './model'
import { nativeOrientationBlob } from './orientation'

export const PREVIEW_MAX_SIDE = 2048
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024
export type SourcePlacement = {
  corners: [Coordinate, Coordinate, Coordinate, Coordinate]
  bounds: Bounds
  pixelToCoordinate: (pixel: Pixel) => Coordinate
}
export type LoadedSource = {
  descriptor: GeoreferenceSource
  title: string
  canvas: HTMLCanvasElement
  imageUrl: string
  file?: File
  /** Header metadata for export preflight; the GDAL export repeats actual validation. */
  exportInfo?: { inputBytes?: number; bandCount?: number; bytesPerSample?: number; hasAlpha?: boolean }
  placement?: SourcePlacement
  record?: RasterRecord
  /** Native TIFF detail for precision point picking; never changes the source frame. */
  detail?: (window: [number, number, number, number], signal?: AbortSignal) => Promise<string>
}
type Directory = Record<string, unknown>

/** TIFF horizontal predictor, for byte imagery. Native data are never changed. */
export function undoBytePredictor(data: Uint8Array, width: number, samples: number): Uint8Array {
  const stride = width * samples
  for (let row = 0; row < data.length; row += stride)
    for (let i = samples; i < Math.min(stride, data.length - row); i++)
      data[row + i] = (data[row + i] + data[row + i - samples]) & 255
  return data
}
let zstdReady = false
function registerZstd() {
  if (zstdReady) return
  zstdReady = true
  addDecoder(50000, async () => {
    const { ZSTDDecoder } = await import('zstddec')
    const decoder = new ZSTDDecoder()
    await decoder.init()
    return class {
      async decode(directory: Directory, buffer: ArrayBuffer): Promise<ArrayBuffer> {
        const bits = Array.from(directory.BitsPerSample as ArrayLike<number>)
        if (bits.some((value) => value !== 8)) throw Error('ZSTD previews currently support 8-bit map imagery.')
        const samples = directory.PlanarConfiguration === 2 ? 1 : bits.length
        const width = Number(directory.TileWidth || directory.ImageWidth)
        const height = Number(directory.TileLength || directory.RowsPerStrip || directory.ImageLength)
        const bytes = decoder.decode(new Uint8Array(buffer), width * height * samples)
        const predictor = Number(directory.Predictor || 1)
        if (predictor === 2) undoBytePredictor(bytes, width, samples)
        else if (predictor !== 1) throw Error('Unsupported TIFF predictor for this source.')
        return bytes.slice().buffer as ArrayBuffer
      }
    }
  })
}

export async function fileSha256(file: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join('')
}
export function sourcePixelToWorld(directory: Directory, pixel: Pixel, pixelIsArea: boolean): Pixel {
  const i = pixel[0] + (pixelIsArea ? 0.5 : 0)
  const j = pixel[1] + (pixelIsArea ? 0.5 : 0)
  const matrix = directory.ModelTransformation as ArrayLike<number> | undefined
  if (matrix?.length === 16)
    return [matrix[0] * i + matrix[1] * j + matrix[3], matrix[4] * i + matrix[5] * j + matrix[7]]
  const tie = directory.ModelTiepoint as ArrayLike<number> | undefined
  const scale = directory.ModelPixelScale as ArrayLike<number> | undefined
  if (!tie || tie.length !== 6 || !scale) throw Error('The TIFF has no supported original affine placement.')
  return [tie[3] + (i - tie[0]) * scale[0], tie[4] - (j - tie[1]) * scale[1]]
}

function embeddedPlacement(image: GeoTIFFImage): { placement?: SourcePlacement; crs?: string } {
  const keys = image.getGeoKeys() || {}
  const epsg = Number(keys.GTModelTypeGeoKey === 1 ? keys.ProjectedCSTypeGeoKey : keys.GeographicTypeGeoKey)
  const definition = crsDefinition(epsg)
  if (!definition) return { crs: Number.isInteger(epsg) && epsg !== 32767 ? `EPSG:${epsg}` : undefined }
  try {
    const w = image.getWidth(),
      h = image.getHeight()
    const pixelToCoordinate = (pixel: Pixel): Coordinate =>
      proj4(
        definition,
        'EPSG:4326',
        sourcePixelToWorld(image.getFileDirectory(), pixel, keys.GTRasterTypeGeoKey !== 2),
      ) as Coordinate
    const corners = (
      [
        [-0.5, -0.5],
        [w - 0.5, -0.5],
        [w - 0.5, h - 0.5],
        [-0.5, h - 0.5],
      ] as Pixel[]
    ).map(pixelToCoordinate)
    if (corners.some((p) => !p.every(Number.isFinite))) return { crs: `EPSG:${epsg}` }
    return {
      crs: `EPSG:${epsg}`,
      placement: {
        corners: corners as SourcePlacement['corners'],
        pixelToCoordinate,
        bounds: [
          Math.min(...corners.map((p) => p[0])),
          Math.min(...corners.map((p) => p[1])),
          Math.max(...corners.map((p) => p[0])),
          Math.max(...corners.map((p) => p[1])),
        ],
      },
    }
  } catch {
    return { crs: `EPSG:${epsg}` }
  }
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}
async function fromTiff(
  tiff: GeoTIFF,
  title: string,
  url: string | null,
  sha256: string | null,
  file?: File,
  signal?: AbortSignal,
): Promise<LoadedSource> {
  registerZstd()
  const native = await tiff.getImage()
  const width = native.getWidth(),
    height = native.getHeight()
  if (!width || !height || width > 200000 || height > 200000) throw Error('This raster has unsupported dimensions.')
  const ratio = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height))
  const pw = Math.max(1, Math.round(width * ratio)),
    ph = Math.max(1, Math.round(height * ratio))
  let chosen = native
  const count = await tiff.getImageCount()
  for (let i = 1; i < count; i++) {
    const overview = await tiff.getImage(i)
    const subfileType = Number(overview.getFileDirectory().NewSubfileType) || 0
    if (subfileType & 4 || !(subfileType & 1)) continue
    if (
      overview.getWidth() >= pw * 0.75 &&
      overview.getHeight() >= ph * 0.75 &&
      overview.getWidth() < chosen.getWidth()
    )
      chosen = overview
  }
  const fd = chosen.getFileDirectory()
  if (fd.PhotometricInterpretation === 2 && Array.from(fd.BitsPerSample as ArrayLike<number>).some((v) => v !== 8))
    throw Error('Import byte RGB map imagery; numeric rasters need a documented display stretch.')
  const rgb = (await chosen.readRGB({
    width: pw,
    height: ph,
    enableAlpha: true,
    interleave: true,
    resampleMethod: 'bilinear',
    signal,
  })) as Uint8Array
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  const channels = rgb.length / (pw * ph)
  if (channels !== 3 && channels !== 4) throw Error('This TIFF cannot be read as RGB or RGBA map imagery.')
  const rgba = new Uint8ClampedArray(pw * ph * 4)
  for (let i = 0; i < pw * ph; i++) {
    rgba[i * 4] = rgb[i * channels]
    rgba[i * 4 + 1] = rgb[i * channels + 1]
    rgba[i * 4 + 2] = rgb[i * channels + 2]
    rgba[i * 4 + 3] = channels === 4 ? rgb[i * channels + 3] : 255
  }
  const maskFor = async (image: GeoTIFFImage): Promise<GeoTIFFImage | null> => {
    for (let i = 1; i < count; i++) {
      const candidate = await tiff.getImage(i)
      if (
        (Number(candidate.getFileDirectory().NewSubfileType) || 0) & 4 &&
        candidate.getWidth() === image.getWidth() &&
        candidate.getHeight() === image.getHeight()
      )
        return candidate
    }
    return null
  }
  const previewMask = await maskFor(chosen)
  if (previewMask) {
    const mask = (await previewMask.readRasters({
      samples: [0],
      interleave: true,
      width: pw,
      height: ph,
      signal,
    })) as Uint8Array
    for (let i = 0; i < pw * ph; i++) if (!mask[i]) rgba[i * 4 + 3] = 0
  }
  const canvas = makeCanvas(pw, ph)
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, pw, ph), 0, 0)
  const { placement, crs } = embeddedPlacement(native)
  const detail = async (window: [number, number, number, number], detailSignal?: AbortSignal) => {
    const w = window[2] - window[0],
      h = window[3] - window[1],
      ratio = Math.min(1, PREVIEW_MAX_SIDE / Math.max(w, h))
    const dw = Math.max(1, Math.round(w * ratio)),
      dh = Math.max(1, Math.round(h * ratio))
    const values = (await native.readRGB({
      window,
      width: dw,
      height: dh,
      enableAlpha: true,
      interleave: true,
      resampleMethod: 'bilinear',
      signal: detailSignal,
    })) as Uint8Array
    const channels = values.length / (dw * dh)
    if (channels !== 3 && channels !== 4) throw Error('Unsupported detail-view channels.')
    const pixels = new Uint8ClampedArray(dw * dh * 4)
    for (let i = 0; i < dw * dh; i++) {
      pixels[i * 4] = values[i * channels]
      pixels[i * 4 + 1] = values[i * channels + 1]
      pixels[i * 4 + 2] = values[i * channels + 2]
      pixels[i * 4 + 3] = channels === 4 ? values[i * channels + 3] : 255
    }
    const nativeMask = await maskFor(native)
    if (nativeMask) {
      const mask = (await nativeMask.readRasters({
        window,
        samples: [0],
        interleave: true,
        width: dw,
        height: dh,
        signal: detailSignal,
      })) as Uint8Array
      for (let i = 0; i < dw * dh; i++) if (!mask[i]) pixels[i * 4 + 3] = 0
    }
    const patch = makeCanvas(dw, dh)
    patch.getContext('2d')!.putImageData(new ImageData(pixels, dw, dh), 0, 0)
    return patch.toDataURL('image/png')
  }
  return {
    descriptor: {
      id: title,
      url,
      sha256,
      width,
      height,
      frame: {
        kind: 'geotiff-pixel-grid',
        description:
          'Exact native GeoTIFF pixel centres. The reading image is downsampled; control coordinates are not.',
        ...(crs ? { crs } : {}),
      },
      ...(url ? { geotiff: { url, sha256 } } : {}),
    },
    title,
    canvas,
    imageUrl: canvas.toDataURL('image/png'),
    placement,
    file,
    exportInfo: {
      inputBytes: file?.size,
      bandCount:
        Number(native.getFileDirectory().SamplesPerPixel) ||
        Array.from(native.getFileDirectory().BitsPerSample as ArrayLike<number>).length,
      bytesPerSample: Math.max(
        1,
        Math.max(...Array.from(native.getFileDirectory().BitsPerSample as ArrayLike<number>)) / 8,
      ),
      hasAlpha: Array.from((native.getFileDirectory().ExtraSamples || []) as ArrayLike<number>).some(
        (sample) => sample === 1 || sample === 2,
      ),
    },
    detail,
  }
}

export async function loadLocalSource(file: File, signal?: AbortSignal): Promise<LoadedSource> {
  if (file.size > MAX_SOURCE_BYTES)
    throw Error('Use an image up to 256 MB, or use the owner command for a larger original.')
  const sha = await fileSha256(file)
  if (/\.tiff?$/i.test(file.name) || /tiff/i.test(file.type))
    return fromTiff(await fromBlob(file, signal), file.name, null, sha, file, signal)
  const bitmap = await createImageBitmap(await nativeOrientationBlob(file), { imageOrientation: 'from-image' })
  const width = bitmap.width,
    height = bitmap.height
  const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height))
  const canvas = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return {
    descriptor: {
      id: file.name,
      url: null,
      sha256: sha,
      width,
      height,
      frame: {
        kind: 'original-image',
        description:
          'Encoded native image pixel centres, x right and y down. The reading preview neutralizes EXIF orientation without changing the original file or its compressed pixels.',
      },
    },
    title: file.name,
    canvas,
    imageUrl: canvas.toDataURL('image/png'),
    file,
    exportInfo: { inputBytes: file.size, bandCount: 4, bytesPerSample: 1, hasAlpha: true },
  }
}

export async function loadRemoteSource(
  input: string,
  options: { id?: string; sha256?: string; title?: string; record?: RasterRecord } = {},
  signal?: AbortSignal,
): Promise<LoadedSource> {
  const url = httpsURL(input)
  const title = options.title || new URL(url).pathname.split('/').pop() || 'Source image'
  let result: LoadedSource
  if (/\.tiff?$/i.test(new URL(url).pathname)) {
    const head = await fetch(url, { method: 'HEAD', signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    const reported = head.headers.get('X-Content-SHA256')
    if (options.sha256 && reported && reported !== options.sha256)
      throw Error('The current TIFF does not match the saved source checksum. Reload the original project source.')
    result = await fromTiff(
      await fromUrl(url, { allowFullFile: false, credentials: 'omit', blockSize: 65536, cacheSize: 64 }, signal),
      title,
      url,
      options.sha256 || reported,
      undefined,
      signal,
    )
    const inputBytes = Number(head.headers.get('Content-Length'))
    if (Number.isFinite(inputBytes) && inputBytes > 0) result.exportInfo = { ...result.exportInfo, inputBytes }
  } else {
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!response.ok)
      throw Error('The source image could not be loaded. Its server must allow cross-origin image access.')
    const blob = await response.blob()
    result = await loadLocalSource(new File([blob], title, { type: blob.type }), signal)
    if (options.sha256 && result.descriptor.sha256 !== options.sha256)
      throw Error('The image checksum differs from the saved project source.')
    result.descriptor.url = url
  }
  result.descriptor.id = options.id || result.descriptor.id
  result.record = options.record
  return result
}

export async function originalSourceFile(source: LoadedSource): Promise<File> {
  if (source.file) return source.file
  if (!source.descriptor.url) throw Error('Select the original source file again before exporting a GeoTIFF.')
  const response = await fetch(source.descriptor.url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw Error('Could not download the native source for export.')
  const reportedSize = Number(response.headers.get('Content-Length'))
  if (reportedSize > MAX_SOURCE_BYTES)
    throw Error('This original exceeds the browser export budget. Download the edit project and use the owner command.')
  const blob = await response.blob()
  if (blob.size > MAX_SOURCE_BYTES) throw Error('This original exceeds the browser export budget.')
  const file = new File([blob], source.descriptor.frame.kind === 'geotiff-pixel-grid' ? 'original.tif' : source.title, {
    type: blob.type,
  })
  if (source.descriptor.sha256 && (await fileSha256(file)) !== source.descriptor.sha256)
    throw Error('Original source checksum mismatch. Export stopped.')
  return file
}
