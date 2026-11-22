import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { X } from 'lucide-react'
import { MapTimeline } from '@pgmaps/geo-toolkit/ui/map-timeline'
import { Button } from '@/components/ui/button'
import { ensureImageryProtocol } from '@/components/ui/imagery-protocols'
import { InlineAlert } from '@/components/ui/map-panels'
import { MapRasterHandoff, useMapLayerHandoff, type MapLayerHandoff } from '@/components/ui/map-raster-handoff'
import {
  formatResolution,
  MAX_FRAME_LAYERS,
  placeKeyOf,
  shownChange,
  todayIsoDate,
  type ImageryCapture,
  type ImageryFeed,
  type ImageryFeedContext,
  type ImageryFrame,
  type ImageryPlace,
  type ImageryTileLayer,
} from '@/lib/imageryFeeds/feed'
import { cn } from '@/lib/utils'

/**
 * A dated imagery timeline for any feed (`src/lib/imageryFeeds/feed.ts`): the strip along the map's
 * bottom (`ImageryTimeline`), the state behind it (`useImageryTimeline`) and the frame's tile layers
 * (`useImageryFrameHandoffs`, `ImageryFrameLayers`), which hand a new date over without blanking the
 * map. The road designer's Wayback timeline and the outdoors planner's dated imagery are its users.
 * Guide: `docs/imagery-feeds.md`.
 */

/** A capture record is asked for once the frame has stayed this long, so a scrub asks once, ms. */
export const IMAGERY_CAPTURE_DELAY_MS = 150
/** Places whose local changes are kept for the session, per feed. */
export const IMAGERY_PLACE_CACHE_SIZE = 64
/** Capture records kept for the session, per feed. */
export const IMAGERY_CAPTURE_CACHE_SIZE = 256

/** "Mar 28": a frame inside an opened period. Frame dates are UTC days. */
const DAY_LABEL = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
/** "Nov 2026": a month on the axis of a daily feed. */
const MONTH_LABEL = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })

type PlaceState = ImageryPlace & { key: string }

/** The map centre, read once the map stops moving, at the zoom the feed is drawn at there. */
function usePlace(feed: ImageryFeed, map: MapLibreMap | null, active: boolean): PlaceState | null {
  const [place, setPlace] = useState<PlaceState | null>(null)
  useEffect(() => {
    if (!map || !active) return
    const settle = () => {
      if (map.isMoving()) return
      const centre = map.getCenter()
      const zoom = Math.round(Math.min(map.getZoom(), feed.placeMaxZoom))
      // About 10 m: closer than that, no record a timeline shows can differ.
      const lon = Number(centre.lng.toFixed(4))
      const lat = Number(centre.lat.toFixed(4))
      setPlace((previous) =>
        previous && previous.lon === lon && previous.lat === lat && previous.zoom === zoom
          ? previous
          : { lon, lat, zoom, key: placeKeyOf(feed, { lon, lat, zoom }) },
      )
    }
    settle()
    map.on('moveend', settle)
    return () => {
      map.off('moveend', settle)
    }
  }, [feed, map, active])
  return active && map ? place : null
}

/** Insertion-ordered cache that forgets its oldest entry past `limit`. */
function remember<V>(cache: Map<string, V>, key: string, value: V, limit: number) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value as string)
}

const message = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback)

type CaptureState =
  | { key: string; state: 'read'; value: ImageryCapture | null }
  | { key: string; state: 'error'; message: string }

export type ImageryTimelineCapture =
  | null
  | { state: 'none' }
  | { state: 'reading'; previous: ImageryCapture | null }
  | CaptureState

/**
 * The timeline's state for one feed: its frames, the one chosen, the frames that change the picture
 * at the map centre (when the feed can say), and what the shown frame captured there (when it can).
 * A new feed starts again from its newest frame. `fetcher` is for tests.
 */
export function useImageryTimeline<S>(
  feed: ImageryFeed<S>,
  active: boolean,
  map: MapLibreMap | null,
  fetcher: typeof fetch = fetch,
) {
  // Everything below belongs to one feed; a new feed starts clean in the same render.
  const [owner, setOwner] = useState(feed)
  // The last list and the area it was made for ('all' for a feed whose dates do not depend on place).
  const [listed, setListed] = useState<{ area: string; frames: ImageryFrame<S>[] } | null>(null)
  // The render that notices a new feed still holds the old feed's list: never hand it to the new feed.
  const ownList = owner === feed ? listed : null
  const frames = useMemo(() => ownList?.frames ?? [], [ownList])
  const [failure, setFailure] = useState<{ area: string; message: string } | null>(null)
  // The frame the person chose; null follows the newest. In "changes here" mode the map shows the
  // change in effect at that frame's date, which is the same picture. Its date carries the choice
  // across a new list, where a located feed's ids change.
  const [selected, setSelected] = useState<{ id: string; date: string } | null>(null)
  const [localOnly, setLocalOnly] = useState(true)
  const [openPeriod, setOpenPeriod] = useState<string | null>(null)
  if (owner !== feed) {
    setOwner(feed)
    setListed(null)
    setFailure(null)
    setSelected(null)
    setOpenPeriod(null)
  }
  // Before any layer of this feed is drawn; registering is idempotent.
  ensureImageryProtocol(feed.tileProtocol)
  const place = usePlace(feed, map, active)
  const placeRef = useRef(place)
  useEffect(() => {
    placeRef.current = place
  })
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })
  const context = useCallback(
    (signal: AbortSignal): ImageryFeedContext => ({
      signal,
      // Called as `context.fetch(…)` by a feed: the browser's fetch refuses any `this` but the window.
      fetch: (input, init) => {
        const fetcher = fetcherRef.current
        return fetcher(input, init)
      },
      today: todayIsoDate(),
    }),
    [],
  )

  // A located feed lists at the map centre and again only in another area; the rest list once.
  const located = !!feed.listFramesAt
  const area = !located ? 'all' : place && feed.listAreaKey ? `${feed.id}|${feed.listAreaKey(place)}` : null
  const listedArea = listed?.area ?? null
  const failedArea = failure?.area ?? null
  useEffect(() => {
    const at = placeRef.current
    if (!active || !area || area === listedArea || area === failedArea) return
    const controller = new AbortController()
    const list = feed.listFramesAt
      ? at
        ? feed.listFramesAt(at, context(controller.signal))
        : Promise.resolve([])
      : feed.listFrames
        ? feed.listFrames(context(controller.signal))
        : Promise.reject(new Error(`${feed.label} lists no imagery dates.`))
    list.then(
      (oldestFirst) => {
        if (controller.signal.aborted) return
        if (oldestFirst.length) {
          setListed({ area, frames: oldestFirst })
          setFailure(null)
        } else
          setFailure({
            area,
            message: located ? `${feed.label} has no imagery here.` : `${feed.label} offers no imagery dates.`,
          })
      },
      (reason) => {
        if (!controller.signal.aborted) setFailure({ area, message: message(reason, `Could not load ${feed.label}.`) })
      },
    )
    return () => controller.abort()
  }, [active, feed, area, listedArea, failedArea, located, context])
  // A failure here reads as an error only while there is nothing to show; otherwise the last list stays.
  const error = failure && failure.area === area ? failure.message : ''

  // ------ the frames that change the picture at the map centre --------------

  // Keyed by feed and place, so feeds never share an answer.
  const localCache = useRef(new Map<string, ImageryFrame<S>[]>())
  // The last finished place is kept while the next one is checked, so the list never empties.
  const [local, setLocal] = useState<{ key: string; changes: ImageryFrame<S>[] } | null>(null)
  const [localError, setLocalError] = useState<{ key: string; message: string } | null>(null)
  const [localAttempt, setLocalAttempt] = useState(0)
  const checksPlaces = !!feed.framesChangingAt
  const placeKey = place ? `${feed.id}|${place.key}` : undefined
  useEffect(() => {
    const at = placeRef.current
    if (!active || !checksPlaces || !frames.length || !placeKey || !at || !feed.framesChangingAt) return
    const controller = new AbortController()
    const cached = localCache.current.get(placeKey)
    if (cached) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setLocal({ key: placeKey, changes: cached })
      })
      return () => controller.abort()
    }
    feed.framesChangingAt(frames, at, context(controller.signal)).then(
      (changes) => {
        if (controller.signal.aborted) return
        remember(localCache.current, placeKey, changes, IMAGERY_PLACE_CACHE_SIZE)
        setLocal({ key: placeKey, changes })
      },
      (reason) => {
        if (!controller.signal.aborted)
          setLocalError({ key: placeKey, message: message(reason, 'Could not check this spot.') })
      },
    )
    return () => controller.abort()
  }, [active, checksPlaces, feed, frames, placeKey, localAttempt, context])

  const localFailed = localError && localError.key === placeKey && local?.key !== placeKey ? localError : null
  const localChecking = checksPlaces && !!placeKey && !!frames.length && local?.key !== placeKey && !localFailed
  const ownLocal = local && local.key.startsWith(`${feed.id}|`) ? local : null
  const changes = ownLocal?.changes.length ? ownLocal.changes : null
  const filtering = localOnly && !!changes
  const shown = filtering ? changes : frames

  const chosen =
    (selected &&
      (frames.find((entry) => entry.id === selected.id) ??
        (located ? shownChange(frames, selected.date) : undefined))) ??
    frames[frames.length - 1]
  const frame = chosen && (filtering ? shownChange(shown, chosen.date) : chosen)

  // A period (a year, or a month for a daily feed) the timeline is opened on by clicking its label.
  // It holds only while that period has two or more entries and the shown frame is in it.
  const periodOf = useCallback((date: string) => date.slice(0, feed.period === 'year' ? 4 : 7), [feed.period])
  const periodEntries = useMemo(
    () => (openPeriod ? shown.filter((entry) => periodOf(entry.date) === openPeriod) : shown),
    [shown, openPeriod, periodOf],
  )
  const period =
    openPeriod && periodEntries.length > 1 && frame && periodOf(frame.date) === openPeriod ? openPeriod : null
  const entries = period ? periodEntries : shown

  const index = frame ? Math.max(0, entries.indexOf(frame)) : 0
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  })
  const setIndex = useCallback((next: number) => {
    const entry = entriesRef.current[next]
    if (entry) setSelected({ id: entry.id, date: entry.date })
  }, [])

  // An axis label: across periods, a period opens on its first entry (one with a single entry is
  // just selected); in an opened period, a date selects that frame.
  const selectTick = useCallback(
    (next: number) => {
      const entry = entriesRef.current[next]
      if (!entry) return
      setSelected({ id: entry.id, date: entry.date })
      if (period) return
      const tickPeriod = periodOf(entry.date)
      const many = entriesRef.current.filter((e) => periodOf(e.date) === tickPeriod).length > 1
      setOpenPeriod(many ? tickPeriod : null)
    },
    [period, periodOf],
  )

  const buckets = useMemo(
    () =>
      entries.map(({ id, date }, i) => {
        const day = new Date(date)
        const entryPeriod = periodOf(date)
        const periodStart = period ? true : entryPeriod !== (i > 0 ? periodOf(entries[i - 1].date) : null)
        const periodLabel = feed.period === 'year' ? entryPeriod : MONTH_LABEL.format(day)
        return {
          key: id,
          label: date,
          tickLabel: period ? DAY_LABEL.format(day) : periodStart ? periodLabel : date.slice(5),
          periodStart,
          start: day,
          end: day,
        }
      }),
    [entries, period, periodOf, feed.period],
  )

  // ------ what the shown frame captured at the map centre -------------------

  const captureCache = useRef(new Map<string, ImageryCapture | null>())
  const [capture, setCapture] = useState<CaptureState | null>(null)
  const describable = !!frame && !!feed.captureAt && (feed.describes?.(frame) ?? true)
  const captureKey =
    describable && frame && place ? `${feed.id}|${frame.id}|${place.lon},${place.lat},${place.zoom}` : null
  const frameRef = useRef(frame)
  useEffect(() => {
    frameRef.current = frame
  })
  useEffect(() => {
    const at = placeRef.current
    const shownFrame = frameRef.current
    if (!active || !captureKey || !at || !shownFrame || !feed.captureAt) return
    const controller = new AbortController()
    const cached = captureCache.current.get(captureKey)
    const timer = setTimeout(
      () => {
        if (cached !== undefined) return setCapture({ key: captureKey, state: 'read', value: cached })
        feed.captureAt!(shownFrame, at, context(controller.signal)).then(
          (value) => {
            if (controller.signal.aborted) return
            remember(captureCache.current, captureKey, value, IMAGERY_CAPTURE_CACHE_SIZE)
            setCapture({ key: captureKey, state: 'read', value })
          },
          (reason) => {
            if (!controller.signal.aborted)
              setCapture({ key: captureKey, state: 'error', message: message(reason, 'Could not read the record.') })
          },
        )
      },
      cached !== undefined ? 0 : IMAGERY_CAPTURE_DELAY_MS,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [active, feed, captureKey, context])

  const captureState: ImageryTimelineCapture = !frame
    ? null
    : !describable
      ? { state: 'none' }
      : capture && capture.key === captureKey
        ? capture
        : {
            state: 'reading',
            // Another frame's record would date the wrong imagery: only the same frame's is kept.
            previous:
              capture?.state === 'read' && capture.key.startsWith(`${feed.id}|${frame.id}|`) ? capture.value : null,
          }

  return {
    feed: feed as ImageryFeed<unknown>,
    /** The frame the map draws. */
    frame,
    index,
    setIndex,
    buckets,
    selectTick,
    /** The period the timeline is opened on, or null for all of them. */
    period,
    closePeriod: () => setOpenPeriod(null),
    error,
    retry: () => setFailure(null),
    frameCount: frames.length,
    /** Frames that change the picture at the map centre, once read there; null before, or when the feed cannot say. */
    changeCount: ownLocal ? ownLocal.changes.length : null,
    localOnly,
    setLocalOnly,
    filtering,
    localChecking,
    localError: localFailed?.message ?? null,
    retryLocal: () => {
      setLocalError(null)
      setLocalAttempt((n) => n + 1)
    },
    capture: captureState,
  }
}

export type ImageryTimelineState = ReturnType<typeof useImageryTimeline>

// ---------------------------------------------------------------------------
// The frame on the map

/**
 * One hand-off for each tile layer a frame may stack (`MAX_FRAME_LAYERS`), so a new date loads
 * behind the one shown and swaps in one frame. Slot 0's layer id is `id`; slot n's is `${id}-n`
 * (and each hand-off alternates with its `-handoff` id). Call it where a shown layer's id is needed,
 * such as to keep the imagery in its place in the stack; render the layers with `ImageryFrameLayers`.
 */
export function useImageryFrameHandoffs(id: string, frame: ImageryFrame | null | undefined) {
  const request = (slot: number) => {
    const layer = frame?.layers[slot]
    return frame && layer ? { key: frame.id, value: layer } : null
  }
  // A fixed number of calls, so hooks run in the same order whatever the feed.
  const slots = [
    useMapLayerHandoff(id, request(0)),
    useMapLayerHandoff(`${id}-1`, request(1)),
    useMapLayerHandoff(`${id}-2`, request(2)),
    useMapLayerHandoff(`${id}-3`, request(3)),
  ] satisfies MapLayerHandoff<ImageryTileLayer>[]
  if (slots.length !== MAX_FRAME_LAYERS) throw new Error('One hand-off a frame layer slot.')
  return slots
}

export type ImageryFrameHandoffs = ReturnType<typeof useImageryFrameHandoffs>

/** The frame's tile layers, each in its own hand-off, bottom first, all under `beforeId`. */
export function ImageryFrameLayers({
  handoffs,
  beforeId,
  fadeDuration = 0,
}: {
  handoffs: ImageryFrameHandoffs
  beforeId?: string
  fadeDuration?: number
}) {
  return (
    <>
      {handoffs.map((handoff, slot) => (
        <MapRasterHandoff
          key={slot}
          handoff={handoff}
          layer={(layer) => ({
            tiles: [layer.tiles],
            tileSize: layer.tileSize ?? 256,
            minZoom: layer.minZoom,
            maxZoom: layer.maxZoom,
            attribution: layer.attribution,
            beforeId,
            fadeDuration,
          })}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// The strip

/** "Captured 2023-05-15 · 7.5 cm", with the supplier and source in its tooltip. */
function captureText(capture: ImageryTimelineCapture) {
  if (!capture || capture.state === 'none' || capture.state === 'error') return null
  const record = capture.state === 'read' ? capture.value : capture.previous
  if (!record && capture.state === 'reading') return { text: 'Captured …', detail: '', reading: true }
  if (!record?.date) return null
  const text = [`Captured ${record.date}`, record.resolutionM ? formatResolution(record.resolutionM) : null]
  const detail = [record.provider, record.source].filter(Boolean).join(' · ')
  return { text: text.filter(Boolean).join(' · '), detail, reading: capture.state === 'reading' }
}

function TimelineSummary({ timeline, testId }: { timeline: ImageryTimelineState; testId: string }) {
  const captured = captureText(timeline.capture)
  const pill =
    'ml-2 inline-flex rounded border px-1.5 align-baseline text-2xs tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'
  return (
    <>
      {timeline.period && (
        <button
          type="button"
          className={cn(pill, 'ml-0 mr-2 border-primary/40 bg-primary/10 text-foreground')}
          title={`Back from ${timeline.period} to the whole timeline`}
          onClick={timeline.closePeriod}
          data-testid={`${testId}-year`}
        >
          {timeline.feed.period === 'year' ? '‹ All years' : '‹ All months'}
        </button>
      )}
      {captured && (
        <span
          title={captured.detail || undefined}
          className={cn(captured.reading && 'opacity-60')}
          data-testid={`${testId}-captured`}
        >
          {captured.text}
        </span>
      )}
      {timeline.changeCount ? (
        <button
          type="button"
          role="switch"
          aria-checked={timeline.localOnly}
          aria-label={timeline.feed.changesLabel ?? 'Only dates that change this spot'}
          title={timeline.feed.changesHint}
          className={cn(pill, timeline.localOnly && 'border-primary/40 bg-primary/10 text-foreground')}
          onClick={() => timeline.setLocalOnly(!timeline.localOnly)}
          data-testid={`${testId}-count`}
        >
          {timeline.localOnly ? `${timeline.changeCount} of ${timeline.frameCount}` : `All ${timeline.frameCount}`}
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
 * The strip along the bottom of the map: the feed's dates, by default only the ones that change the
 * picture at the map centre when the feed can say, and what the shown date captured there. The
 * map's own bottom chrome stacks above it (`--map-timeline-height`). `testId` prefixes the strip's
 * test ids (`-count`, `-captured`, `-year`).
 */
export function ImageryTimeline({
  timeline,
  onClose,
  label = 'Historical imagery timeline',
  testId = 'imagery-timeline',
}: {
  timeline: ImageryTimelineState
  onClose: () => void
  /** The region's accessible name. */
  label?: string
  testId?: string
}) {
  const { feed } = timeline
  const speeds = useMemo(() => [{ intervalMs: feed.playbackMs, label: '1×' }], [feed.playbackMs])
  if (!timeline.frame)
    return (
      <section
        data-map-export-ignore
        aria-label={label}
        className="absolute inset-x-2.5 bottom-2.5 z-30 flex items-center gap-2 rounded-xl border bg-background/95 p-2 text-xs shadow-xl"
      >
        <InlineAlert tone={timeline.error ? 'error' : 'info'} loading={!timeline.error} className="min-w-0 flex-1">
          {timeline.error || feed.loadingText}
        </InlineAlert>
        {timeline.error && (
          <Button size="sm" variant="outline" onClick={timeline.retry}>
            {feed.retryLabel}
          </Button>
        )}
        <Button size="icon-2xs" variant="ghost" aria-label="Close timeline" onClick={onClose}>
          <X />
        </Button>
      </section>
    )
  return (
    // `contents`: the timeline places itself on the map and publishes its height to the map's corners.
    <section data-map-export-ignore aria-label={label} className="contents">
      <MapTimeline
        placement="map-overlay"
        label={feed.dateMeaning}
        summary={<TimelineSummary timeline={timeline} testId={testId} />}
        buckets={timeline.buckets}
        value={timeline.index}
        onValueChange={timeline.setIndex}
        speeds={speeds}
        loop={false}
        onClose={onClose}
        onTickSelect={timeline.selectTick}
        tickSelectLabel={(bucket) => (timeline.period ? `Show ${bucket.label}` : `Show ${bucket.tickLabel}`)}
        // All the way across, however few dates there are.
        className="max-w-none"
      />
    </section>
  )
}
