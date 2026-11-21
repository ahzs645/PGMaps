import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { X } from 'lucide-react'
import { MapTimeline } from '@pgmaps/geo-toolkit/ui/map-timeline'
import { InlineAlert } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  formatWaybackResolution,
  loadWaybackReleases,
  parseWaybackCapture,
  parseWaybackTilemap,
  waybackCaptureUrl,
  waybackLocalChanges,
  waybackMetadataLayer,
  waybackShownChange,
  waybackTileAt,
  waybackTileKey,
  waybackTilemapUrl,
  WAYBACK_CAPTURE_CACHE_SIZE,
  WAYBACK_LOCAL_CACHE_SIZE,
  WAYBACK_MAX_TILE_ZOOM,
  type WaybackCapture,
  type WaybackRelease,
  type WaybackTile,
} from '@/lib/wayback'
import { ROAD_DESIGN_DEPLOYMENT } from './deployment'
import { isLocalPlane } from './localPlane'
import type { TerrainMetadata } from './types'

export function waybackTimelineAvailable(terrain: Pick<TerrainMetadata, 'epsg'>) {
  return ROAD_DESIGN_DEPLOYMENT.waybackTimeline && !isLocalPlane(terrain)
}

/** Play shows each release this long before the next, ms. */
export const WAYBACK_PLAYBACK_MS = 2_000
/** One tile-map or capture request gives up after this long, ms. */
export const WAYBACK_SPOT_TIMEOUT_MS = 10_000
/** A capture record is asked for once the release has stayed this long, so a scrub asks once, ms. */
export const WAYBACK_CAPTURE_DELAY_MS = 150
const playbackSpeeds = [{ intervalMs: WAYBACK_PLAYBACK_MS, label: '1×' }]
/** "Mar 28": a release date inside an opened year. Release dates are UTC days. */
const DAY_LABEL = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The map centre the timeline reads Wayback at, once the map stops moving. */
interface WaybackSpot {
  lon: number
  lat: number
  /** The zoom the plan draws Wayback tiles at here (deeper views stretch z18). */
  zoom: number
  tile: WaybackTile
  key: string
}

function useWaybackSpot(map: MapLibreMap | null, active: boolean) {
  const [spot, setSpot] = useState<WaybackSpot | null>(null)
  useEffect(() => {
    if (!map || !active) return
    const settle = () => {
      if (map.isMoving()) return
      const centre = map.getCenter()
      const zoom = Math.round(Math.min(map.getZoom(), WAYBACK_MAX_TILE_ZOOM))
      // About 10 m: closer than that, the capture record cannot differ in a way the card shows.
      const lon = Number(centre.lng.toFixed(4))
      const lat = Number(centre.lat.toFixed(4))
      const tile = waybackTileAt(lon, lat, zoom)
      setSpot((previous) =>
        previous && previous.lon === lon && previous.lat === lat && previous.zoom === zoom
          ? previous
          : { lon, lat, zoom, tile, key: waybackTileKey(tile) },
      )
    }
    settle()
    map.on('moveend', settle)
    return () => {
      map.off('moveend', settle)
    }
  }, [map, active])
  return active && map ? spot : null
}

/** Insertion-ordered cache that forgets its oldest entry past `limit`. */
function remember<V>(cache: Map<string, V>, key: string, value: V, limit: number) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value as string)
}

async function readJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(WAYBACK_SPOT_TIMEOUT_MS)]) })
  if (!response.ok) throw new Error(`Esri returned HTTP ${response.status}.`)
  return response.json() as Promise<unknown>
}

const message = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback)

type CaptureState =
  | { key: string; state: 'read'; value: WaybackCapture | null }
  | { key: string; state: 'error'; message: string }

export function useWaybackTimeline(active: boolean, map: MapLibreMap | null) {
  const [releases, setReleases] = useState<WaybackRelease[]>([])
  const [error, setError] = useState('')
  // The release the person chose; null follows the newest. In "changes here" mode the plan shows
  // the change in effect at that release's date, which is the same picture.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localOnly, setLocalOnly] = useState(true)
  const spot = useWaybackSpot(map, active)

  useEffect(() => {
    if (!active || releases.length || error) return
    const controller = new AbortController()
    loadWaybackReleases(controller.signal).then(
      (newestFirst) => {
        if (!controller.signal.aborted) setReleases(newestFirst.reverse())
      },
      (reason) => {
        if (!controller.signal.aborted) setError(message(reason, 'Could not load releases.'))
      },
    )
    return () => controller.abort()
  }, [active, releases.length, error])

  // ------ the releases that change the picture at the map centre ------------

  const localCache = useRef(new Map<string, WaybackRelease[]>())
  // The last finished place is kept while the next one is checked, so the list never empties.
  const [local, setLocal] = useState<{ key: string; changes: WaybackRelease[] } | null>(null)
  const [localError, setLocalError] = useState<{ key: string; message: string } | null>(null)
  const [localAttempt, setLocalAttempt] = useState(0)
  const spotKey = spot?.key
  const spotTile = spot?.tile
  useEffect(() => {
    if (!active || !releases.length || !spotKey || !spotTile) return
    const cached = localCache.current.get(spotKey)
    const controller = new AbortController()
    if (cached) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setLocal({ key: spotKey, changes: cached })
      })
      return () => controller.abort()
    }
    const newestFirst = [...releases].reverse()
    waybackLocalChanges(
      newestFirst,
      async (release) =>
        parseWaybackTilemap(await readJson(waybackTilemapUrl(release.id, spotTile), controller.signal), release.id),
      controller.signal,
    ).then(
      (changes) => {
        if (controller.signal.aborted) return
        remember(localCache.current, spotKey, changes, WAYBACK_LOCAL_CACHE_SIZE)
        setLocal({ key: spotKey, changes })
      },
      (reason) => {
        if (!controller.signal.aborted)
          setLocalError({ key: spotKey, message: message(reason, 'Could not read the tile map.') })
      },
    )
    return () => controller.abort()
  }, [active, releases, spotKey, spotTile, localAttempt])

  const localFailed = localError && localError.key === spotKey && local?.key !== spotKey ? localError : null
  const localChecking = !!spotKey && !!releases.length && local?.key !== spotKey && !localFailed
  // Oldest first, like the catalog list.
  const changes = useMemo(() => (local?.changes.length ? [...local.changes].reverse() : null), [local])
  const filtering = localOnly && !!changes
  const shown = filtering ? changes : releases

  const selected = releases.find((release) => release.id === selectedId) ?? releases[releases.length - 1]
  const release = selected && (filtering ? waybackShownChange(shown, selected.date) : selected)

  // A year the timeline is opened on (an axis year clicked). It holds only while that year has two
  // or more entries and the shown release is in it; otherwise the timeline shows every year.
  const [openYear, setOpenYear] = useState<string | null>(null)
  const yearEntries = useMemo(
    () => (openYear ? shown.filter((entry) => entry.date.startsWith(openYear)) : shown),
    [shown, openYear],
  )
  const year = openYear && yearEntries.length > 1 && release?.date.startsWith(openYear) ? openYear : null
  const entries = year ? yearEntries : shown

  const frame = release ? Math.max(0, entries.indexOf(release)) : 0
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  })
  const setFrame = useCallback((index: number) => {
    const next = entriesRef.current[index]
    if (next) setSelectedId(next.id)
  }, [])

  // An axis label: in all years, a year opens it on its first entry (a year with one entry is
  // just selected); in an opened year, a date selects that release.
  const selectTick = useCallback(
    (index: number) => {
      const entry = entriesRef.current[index]
      if (!entry) return
      setSelectedId(entry.id)
      if (year) return
      const tickYear = entry.date.slice(0, 4)
      const many = entriesRef.current.filter((e) => e.date.startsWith(tickYear)).length > 1
      setOpenYear(many ? tickYear : null)
    },
    [year],
  )

  const buckets = useMemo(
    () =>
      entries.map(({ id, date }, i) => {
        const day = new Date(date)
        const entryYear = date.slice(0, 4)
        // In an opened year every release is labelled with its day; across years, each year once.
        const periodStart = year ? true : entryYear !== entries[i - 1]?.date.slice(0, 4)
        return {
          key: id,
          label: date,
          tickLabel: year ? DAY_LABEL.format(day) : periodStart ? entryYear : date.slice(5),
          periodStart,
          start: day,
          end: day,
        }
      }),
    [entries, year],
  )

  // ------ what the shown release captured at the map centre -----------------

  const captureCache = useRef(new Map<string, WaybackCapture | null>())
  const [capture, setCapture] = useState<CaptureState | null>(null)
  const captureUrl = release && spot ? waybackCaptureUrl(release, spot.lon, spot.lat, spot.zoom) : null
  const captureKey = release && spot ? `${release.id}|${waybackMetadataLayer(spot.zoom)}|${spot.lon},${spot.lat}` : null
  useEffect(() => {
    if (!active || !captureUrl || !captureKey) return
    const controller = new AbortController()
    const cached = captureCache.current.get(captureKey)
    const delay = cached !== undefined ? 0 : WAYBACK_CAPTURE_DELAY_MS
    const timer = setTimeout(() => {
      if (cached !== undefined) return setCapture({ key: captureKey, state: 'read', value: cached })
      readJson(captureUrl, controller.signal)
        .then(parseWaybackCapture)
        .then(
          (value) => {
            if (controller.signal.aborted) return
            remember(captureCache.current, captureKey, value, WAYBACK_CAPTURE_CACHE_SIZE)
            setCapture({ key: captureKey, state: 'read', value })
          },
          (reason) => {
            if (!controller.signal.aborted)
              setCapture({ key: captureKey, state: 'error', message: message(reason, 'Could not read the record.') })
          },
        )
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [active, captureUrl, captureKey])

  return {
    /** The release the plan draws. */
    release,
    frame,
    setFrame,
    buckets,
    selectTick,
    /** The year the timeline is opened on, or null for every year. */
    year,
    closeYear: () => setOpenYear(null),
    error,
    retry: () => setError(''),
    releaseCount: releases.length,
    /** Releases that change the picture at the map centre, once read there; null before. */
    changeCount: local ? local.changes.length : null,
    localOnly,
    setLocalOnly,
    filtering,
    localChecking,
    localError: localFailed?.message ?? null,
    retryLocal: () => {
      setLocalError(null)
      setLocalAttempt((n) => n + 1)
    },
    capture: !release
      ? null
      : !release.metadataUrl
        ? ({ state: 'none' } as const)
        : capture && capture.key === captureKey
          ? capture
          : ({
              state: 'reading',
              // Another release's record would date the wrong imagery: only the same release's is kept.
              previous: capture?.state === 'read' && capture.key.startsWith(`${release.id}|`) ? capture.value : null,
            } as const),
  }
}

export type WaybackTimelineState = ReturnType<typeof useWaybackTimeline>

/** "Captured 2023-05-15 · 7.5 cm", with the supplier and source in its tooltip. */
function captureText(timeline: WaybackTimelineState) {
  const { capture } = timeline
  if (!capture || capture.state === 'none' || capture.state === 'error') return null
  const record = capture.state === 'read' ? capture.value : capture.previous
  if (!record && capture.state === 'reading') return { text: 'Captured …', detail: '', reading: true }
  if (!record?.date) return null
  const text = [`Captured ${record.date}`, record.resolutionM ? formatWaybackResolution(record.resolutionM) : null]
  const detail = [record.provider, record.source].filter(Boolean).join(' · ')
  return { text: text.filter(Boolean).join(' · '), detail, reading: capture.state === 'reading' }
}

const ONLY_HERE_TITLE =
  'Only the releases that brought new imagery to the map centre. A release dates the mosaic, not the photograph; most reuse the imagery already there.'

function WaybackSummary({ timeline }: { timeline: WaybackTimelineState }) {
  const captured = captureText(timeline)
  const pill =
    'ml-2 inline-flex rounded border px-1.5 align-baseline text-2xs tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'
  return (
    <>
      {timeline.year && (
        <button
          type="button"
          className={cn(pill, 'ml-0 mr-2 border-primary/40 bg-primary/10 text-foreground')}
          title={`Back from ${timeline.year} to every year`}
          onClick={timeline.closeYear}
          data-testid="road-wayback-year"
        >
          ‹ All years
        </button>
      )}
      {captured && (
        <span
          title={captured.detail || undefined}
          className={cn(captured.reading && 'opacity-60')}
          data-testid="road-wayback-captured"
        >
          {captured.text}
        </span>
      )}
      {timeline.changeCount ? (
        <button
          type="button"
          role="switch"
          aria-checked={timeline.localOnly}
          aria-label="Only releases that change this spot"
          title={ONLY_HERE_TITLE}
          className={cn(pill, timeline.localOnly && 'border-primary/40 bg-primary/10 text-foreground')}
          onClick={() => timeline.setLocalOnly(!timeline.localOnly)}
          data-testid="road-wayback-count"
        >
          {timeline.localOnly ? `${timeline.changeCount} of ${timeline.releaseCount}` : `All ${timeline.releaseCount}`}
        </button>
      ) : null}
      {timeline.localError ? (
        <button
          type="button"
          className={pill}
          title={`Could not check this spot: ${timeline.localError}`}
          onClick={timeline.retryLocal}
        >
          Retry check
        </button>
      ) : timeline.localChecking ? (
        <span className="ml-2" aria-live="polite">
          Checking this spot…
        </span>
      ) : null}
    </>
  )
}

/**
 * The plan's Wayback timeline: one strip along the bottom of the map. It lists, by default, only
 * the releases that change the picture at the map centre, and names what the shown release
 * captured there. The map's own bottom chrome stacks above it (`--map-timeline-height`).
 */
export function WaybackTimeline({ timeline, onClose }: { timeline: WaybackTimelineState; onClose: () => void }) {
  if (!timeline.release)
    return (
      <section
        data-map-export-ignore
        aria-label="Historical imagery timeline"
        className="absolute inset-x-2.5 bottom-2.5 z-30 flex items-center gap-2 rounded-xl border bg-background/95 p-2 text-xs shadow-xl"
      >
        <InlineAlert tone={timeline.error ? 'error' : 'info'} loading={!timeline.error} className="min-w-0 flex-1">
          {timeline.error || 'Loading Wayback releases…'}
        </InlineAlert>
        {timeline.error && (
          <Button size="sm" variant="outline" onClick={timeline.retry}>
            Retry Wayback catalog
          </Button>
        )}
        <Button size="icon-2xs" variant="ghost" aria-label="Close timeline" onClick={onClose}>
          <X />
        </Button>
      </section>
    )
  return (
    // `contents`: the timeline places itself on the map and publishes its height to the map's corners.
    <section data-map-export-ignore aria-label="Historical imagery timeline" className="contents">
      <MapTimeline
        placement="map-overlay"
        label="Esri Wayback mosaic release date"
        summary={<WaybackSummary timeline={timeline} />}
        buckets={timeline.buckets}
        value={timeline.frame}
        onValueChange={timeline.setFrame}
        speeds={playbackSpeeds}
        loop={false}
        onClose={onClose}
        onTickSelect={timeline.selectTick}
        tickSelectLabel={(bucket) => (timeline.year ? `Show ${bucket.label}` : `Show ${bucket.tickLabel}`)}
        // All the way across, however few releases there are.
        className="max-w-none"
      />
    </section>
  )
}
