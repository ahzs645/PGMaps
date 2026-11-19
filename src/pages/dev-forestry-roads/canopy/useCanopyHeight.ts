/**
 * The plan's Meta CHM v2 layer: reads the canopy under the settled view from Source Cooperative's COGs
 * (CORS, byte ranges) at an overview that fits the screen, and, on request, the active road's corridor
 * at full resolution. The maths is `src/lib/forestry/canopy/chmView.ts`; this file only fetches.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fromUrl, type GeoTIFF } from 'geotiff'
import {
  canopyPicture,
  canopyQuad,
  chmImageryDates,
  chmOverviewFor,
  CHM_CORRIDOR_MAX_PIXELS,
  corridorSummary,
  stationBounds,
  type ChmTileDates,
  type CorridorCanopySummary,
} from '@/lib/forestry/canopy/chmView'
import { readMetaChm, type ChmTiff, type LonLatBounds } from '@/lib/forestry/canopy/metaChm'
import type { CorridorStation } from '@/lib/forestry/canopy/corridor'

export interface CanopyImage {
  key: string
  rgba: Uint8ClampedArray
  width: number
  height: number
  quad: [[number, number], [number, number], [number, number], [number, number]]
  cellM: number
}

export interface CanopyDates {
  from: string
  to: string
  tiles: number
  listed: number
}

export interface CanopyCorridor {
  key: string
  summary: CorridorCanopySummary
  dates: CanopyDates | null
  cellM: number
}

export interface CanopyHeightState {
  image: CanopyImage | null
  dates: CanopyDates | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  corridor: CanopyCorridor | null
  corridorStatus: 'idle' | 'loading' | 'error'
  corridorError: string | null
  readCorridor: () => void
}

const FILE_CACHE = 8
const files = new Map<string, Promise<GeoTIFF>>()
function openTiff(url: string): Promise<ChmTiff> {
  let file = files.get(url)
  if (!file) {
    file = fromUrl(url, { allowFullFile: false, credentials: 'omit', blockSize: 65536, cacheSize: 64 })
    files.set(url, file)
    while (files.size > FILE_CACHE) files.delete(files.keys().next().value!)
    file.catch(() => {
      if (files.get(url) === file) files.delete(url)
    })
  }
  return file as unknown as Promise<ChmTiff>
}

let datesTable: Promise<ChmTileDates> | null = null
const loadDates = () =>
  (datesTable ??= import('@/lib/forestry/canopy/metaChmDates.bc.generated.json').then(
    (m) => m.default as unknown as ChmTileDates,
  ))

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The canopy height map could not be read from Source Cooperative.'

export function useCanopyHeight({
  visible,
  bounds,
  stations,
  roadKey,
}: {
  visible: boolean
  bounds: LonLatBounds | null
  /** The active road's stations, for the corridor read. */
  stations: readonly CorridorStation[]
  /** Changes whenever the road's stations do. */
  roadKey: string
}): CanopyHeightState {
  const [image, setImage] = useState<CanopyImage | null>(null)
  const [dates, setDates] = useState<CanopyDates | null>(null)
  const [status, setStatus] = useState<CanopyHeightState['status']>('idle')
  const [error, setError] = useState<string | null>(null)
  const [corridor, setCorridor] = useState<CanopyCorridor | null>(null)
  const [corridorStatus, setCorridorStatus] = useState<CanopyHeightState['corridorStatus']>('idle')
  const [corridorError, setCorridorError] = useState<string | null>(null)
  const boundsKey = bounds?.join(',') ?? ''

  useEffect(() => {
    if (!visible || !bounds) return
    let cancelled = false
    const overview = chmOverviewFor(bounds)
    const key = `${boundsKey}@${overview}`
    setStatus('loading')
    setError(null)
    ;(async () => {
      try {
        const [grid, table] = await Promise.all([readMetaChm(bounds, openTiff, { overview }), loadDates()])
        if (cancelled) return
        setImage({
          key,
          rgba: canopyPicture(grid),
          width: grid.width,
          height: grid.height,
          quad: canopyQuad(grid),
          cellM: grid.cellM,
        })
        setDates(chmImageryDates(bounds, table))
        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(message(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // `bounds` is keyed by `boundsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, boundsKey])

  // A corridor read belongs to the road it was read for.
  const latest = useRef({ stations, roadKey })
  latest.current = { stations, roadKey }
  const [readFor, setReadFor] = useState<string | null>(null)
  if (corridor && corridor.key !== roadKey) {
    setCorridor(null)
    setCorridorStatus('idle')
  }
  const readCorridor = useCallback(() => setReadFor(latest.current.roadKey), [])
  useEffect(() => {
    if (!visible || readFor === null || readFor !== latest.current.roadKey) return
    const { stations: road, roadKey: key } = latest.current
    if (road.length < 2) return
    let cancelled = false
    setCorridorStatus('loading')
    setCorridorError(null)
    ;(async () => {
      try {
        const box = stationBounds(road.map((s) => s.coordinate))
        const [grid, table] = await Promise.all([
          readMetaChm(box, openTiff, { overview: 0, maxPixels: CHM_CORRIDOR_MAX_PIXELS }),
          loadDates(),
        ])
        if (cancelled) return
        setCorridor({
          key,
          summary: corridorSummary(road, grid),
          dates: chmImageryDates(box, table),
          cellM: grid.cellM,
        })
        setCorridorStatus('idle')
      } catch (e) {
        if (cancelled) return
        setCorridorStatus('error')
        setCorridorError(message(e))
      } finally {
        if (!cancelled) setReadFor(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible, readFor])

  return {
    image: visible ? image : null,
    dates,
    status: visible ? status : 'idle',
    error,
    corridor,
    corridorStatus,
    corridorError,
    readCorridor,
  }
}
