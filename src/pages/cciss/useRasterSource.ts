import { useEffect, useState } from 'react'
import type { GeoTIFF } from 'geotiff'
import { fetchBytes, FetchError } from '@/lib/fetchJson'
import { sampleCcissRaster, type GeoTIFFImage, type RasterSample } from './raster'

export type SampleState = { status: 'empty' | 'loading' | 'error'; message?: string } | RasterSample

type RasterLoad = { source: File | string; image: GeoTIFFImage; origin: 'hosted' | 'file' } | null

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** A hosted path that answers with something other than a TIFF (an HTML fallback page) counts as missing. */
async function readHostedTiff(url: string, signal: AbortSignal) {
  const { bytes } = await fetchBytes(url, signal)
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a
  if (bytes.length < 4 || !(littleEndian || bigEndian)) throw new FetchError(url, 404)
  return new Blob([bytes as BlobPart], { type: 'image/tiff' })
}

/**
 * Opens a local GeoTIFF, or else the hosted one (then its fallback on a 404). A local file always wins.
 * `missing` means the hosted file is not published here, which is not an error.
 */
export function useRasterSource(file: File | null, hostedUrl: string | null, fallbackHostedUrl?: string) {
  const [loaded, setLoaded] = useState<RasterLoad>(null)
  const [error, setError] = useState<{ source: File | string; message: string } | null>(null)
  const [missing, setMissing] = useState<File | string | null>(null)
  const source = file ?? hostedUrl

  useEffect(() => {
    if (!source) return
    let current = true
    let tiff: GeoTIFF | undefined
    const controller = new AbortController()
    import('geotiff')
      .then(async ({ fromBlob }) => {
        let blob: Blob
        if (file) {
          blob = file
        } else {
          try {
            blob = await readHostedTiff(hostedUrl!, controller.signal)
          } catch (cause) {
            if (!fallbackHostedUrl || !(cause instanceof FetchError) || cause.status !== 404) throw cause
            blob = await readHostedTiff(fallbackHostedUrl, controller.signal)
          }
        }
        tiff = await fromBlob(blob)
        if (!current) {
          await tiff.close()
          return
        }
        const image = await tiff.getImage()
        if (current) {
          setLoaded({ source, image, origin: file ? 'file' : 'hosted' })
          setError(null)
          setMissing(null)
        }
      })
      .catch((cause) => {
        if (!current) return
        if (!file && cause instanceof FetchError && cause.status === 404) setMissing(source)
        else setError({ source, message: errorText(cause) })
      })
    return () => {
      current = false
      controller.abort()
      if (tiff) void tiff.close()
    }
  }, [fallbackHostedUrl, file, hostedUrl, source])

  return {
    image: loaded?.source === source ? loaded.image : null,
    origin: loaded?.source === source ? loaded.origin : null,
    error: error?.source === source ? error.message : '',
    missing: missing === source,
  }
}

/** The numeric cell under `point` ([longitude, latitude]); never a rendered colour. */
export function useRasterSample(image: GeoTIFFImage | null, point: [number, number]): SampleState {
  const [result, setResult] = useState<{
    image: GeoTIFFImage
    longitude: number
    latitude: number
    value: SampleState
  } | null>(null)
  useEffect(() => {
    if (!image) return
    let current = true
    const settle = (value: SampleState) => {
      if (current) setResult({ image, longitude: point[0], latitude: point[1], value })
    }
    sampleCcissRaster(image, point[1], point[0])
      .then(settle)
      .catch((cause) => settle({ status: 'error', message: errorText(cause) }))
    return () => {
      current = false
    }
  }, [image, point])
  if (!image) return { status: 'empty' }
  if (result && result.image === image && result.longitude === point[0] && result.latitude === point[1]) {
    return result.value
  }
  return { status: 'loading' }
}
