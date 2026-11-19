/**
 * The plan's Meta CHM v2 layer, as its card reads it: the tiles' progress and failures in the view
 * (the tiles themselves are MapLibre's, `chmTileProtocol.ts`), the cell size and imagery years of the
 * view at rest and, on request, the active road's corridor at full resolution. The maths is
 * `src/lib/forestry/canopy/`; this file only fetches.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  chmImageryDates,
  CHM_CORRIDOR_MAX_PIXELS,
  corridorSummary,
  stationBounds,
  type ChmTileDates,
  type CorridorCanopySummary,
} from '@/lib/forestry/canopy/chmView'
import { chmTileCellM, chmTilesIn, CHM_TILE_MAX_ZOOM } from '@/lib/forestry/canopy/chmTiles'
import { readMetaChm } from '@/lib/forestry/canopy/metaChm'
import type { CorridorStation } from '@/lib/forestry/canopy/corridor'
import { openChmTiff } from './chmFiles'
import { chmTileStatus } from './chmTileProtocol'
import type { CanopyView } from './useCanopyView'

/** The card shows "loading" only once tiles have been reading this long, and drops it this long after. */
export const CANOPY_LOADING_HOLD_MS = 250

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
  /** Tiles are being read for the map. */
  loading: boolean
  /** Why tiles of the view at rest could not be read, or null. */
  error: string | null
  /** Ground size of the cells drawn in the view at rest, metres. */
  cellM: number | null
  dates: CanopyDates | null
  corridor: CanopyCorridor | null
  corridorStatus: 'idle' | 'loading' | 'error'
  corridorError: string | null
  readCorridor: () => void
}

let datesTable: Promise<ChmTileDates> | null = null
const loadDates = () =>
  (datesTable ??= import('@/lib/forestry/canopy/metaChmDates.bc.generated.json').then(
    (m) => m.default as unknown as ChmTileDates,
  ))

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The canopy height map could not be read from Source Cooperative.'

/** True once `on` has held for `holdMs`, false once it has been off for `holdMs`: no blink on quick loads. */
function useHeld(on: boolean, holdMs: number) {
  const [held, setHeld] = useState(on)
  useEffect(() => {
    if (on === held) return
    const timer = setTimeout(() => setHeld(on), holdMs)
    return () => clearTimeout(timer)
  }, [on, held, holdMs])
  return held
}

export function useCanopyHeight({
  visible,
  view,
  stations,
  roadKey,
}: {
  visible: boolean
  /** The view at rest (`useCanopyView`). */
  view: CanopyView
  /** The active road's stations, for the corridor read. */
  stations: readonly CorridorStation[]
  /** Changes whenever the road's stations do. */
  roadKey: string
}): CanopyHeightState {
  const tiles = useSyncExternalStore(chmTileStatus.subscribe, chmTileStatus.get)
  const loading = useHeld(visible && tiles.reading > 0, CANOPY_LOADING_HOLD_MS)
  const { bounds, zoom } = view
  const boundsKey = bounds?.join(',') ?? ''

  // The tiles MapLibre draws a view at rest with: its rounded zoom, overzoomed past the files' finest.
  const tileZoom = zoom === null ? null : Math.min(Math.round(zoom), CHM_TILE_MAX_ZOOM)
  const inView = useMemo(
    () => (bounds && tileZoom !== null ? new Set(chmTilesIn(bounds, tileZoom)) : new Set<string>()),
    // `bounds` is keyed by `boundsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundsKey, tileZoom],
  )
  let failedInView = 0
  let reason: string | null = null
  for (const [key, why] of tiles.failed)
    if (inView.has(key)) {
      failedInView++
      reason ??= why
    }
  const error =
    visible && failedInView
      ? `${failedInView} canopy ${failedInView === 1 ? 'tile' : 'tiles'} in view could not be read: ${reason}`
      : null
  const cellM = bounds && tileZoom !== null ? chmTileCellM(tileZoom, (bounds[1] + bounds[3]) / 2) : null

  const [dates, setDates] = useState<CanopyDates | null>(null)
  useEffect(() => {
    if (!visible || !bounds) return
    let cancelled = false
    loadDates().then(
      (table) => {
        if (!cancelled) setDates(chmImageryDates(bounds, table))
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
    // `bounds` is keyed by `boundsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, boundsKey])

  // A corridor read belongs to the road it was read for.
  const [corridor, setCorridor] = useState<CanopyCorridor | null>(null)
  const [corridorStatus, setCorridorStatus] = useState<CanopyHeightState['corridorStatus']>('idle')
  const [corridorError, setCorridorError] = useState<string | null>(null)
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
          readMetaChm(box, openChmTiff, { overview: 0, maxPixels: CHM_CORRIDOR_MAX_PIXELS }),
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
    loading: visible && loading,
    error,
    cellM: visible ? cellM : null,
    dates,
    corridor,
    corridorStatus,
    corridorError,
    readCorridor,
  }
}
