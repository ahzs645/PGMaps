import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { StyledSelect } from '@/components/ui/styled-select'
import { todayIsoDate, type ImageryFeed, type ImageryFeedContext, type ImageryFrame } from '@/lib/imageryFeeds/feed'
import { IMAGERY_FEEDS } from '@/lib/imageryFeeds'
import { iconemViewUrl } from './iconem'
import { MAX_TILE_OVERLAYS, uid, type Mission, type TileOverlay } from './model'

/**
 * A mission's overlays are saved and shared as plain HTTPS tile addresses (`missionCodec.ts`), so
 * only feeds whose tiles are plain HTTPS can be added; a feed drawn through PGMaps' own tile
 * protocol (Sentinel-2) cannot leave PGMaps in a mission.
 */
export const MISSION_IMAGERY_FEEDS = IMAGERY_FEEDS.filter((feed) => !feed.tileProtocol)
const LOCAL_ONLY_FEEDS = IMAGERY_FEEDS.filter((feed) => feed.tileProtocol)

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The mission overlays one frame adds: one a tile layer, named by the feed, the date and the layer. */
export function frameOverlays(feed: ImageryFeed, frame: ImageryFrame): TileOverlay[] {
  return frame.layers.map((layer) => ({
    id: uid(),
    name: [feed.shortLabel, frame.date, frame.layers.length > 1 ? layer.name : undefined].filter(Boolean).join(' · '),
    tiles: [layer.tiles],
    attribution: layer.attribution ?? feed.label,
    maxZoom: layer.maxZoom,
    visible: true,
    opacity: 1,
  }))
}

/**
 * Historical imagery for a mission: choose a source and a date from it, and add that date as raster
 * overlays. Sources are the shared imagery feeds (`src/lib/imageryFeeds/`); a source whose dates
 * depend on place is listed at the mission's camera.
 */
export function DatedImageryPanel({
  mission,
  change,
}: {
  mission: Mission
  change: (fn: (m: Mission) => Mission) => void
}) {
  const [feedId, setFeedId] = useState(MISSION_IMAGERY_FEEDS[0].id)
  const feed = MISSION_IMAGERY_FEEDS.find((entry) => entry.id === feedId) ?? MISSION_IMAGERY_FEEDS[0]
  const [attempt, setAttempt] = useState(0)
  const [listed, setListed] = useState<{ feedId: string; frames: ImageryFrame[] } | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const { many, one } = feed.frameNoun

  useEffect(() => {
    if (!attempt) return
    const controller = new AbortController()
    const context: ImageryFeedContext = {
      signal: controller.signal,
      fetch: (input, init) => fetch(input, init),
      today: todayIsoDate(),
    }
    const [lon, lat] = mission.camera.center
    const place = { lon, lat, zoom: Math.min(mission.camera.zoom, feed.placeMaxZoom) }
    const list = feed.listFramesAt ? feed.listFramesAt(place, context) : feed.listFrames!(context)
    list.then(
      (oldestFirst) => {
        if (controller.signal.aborted) return
        // Newest first, as the picker has always listed them.
        const frames = [...oldestFirst].reverse()
        setListed({ feedId: feed.id, frames })
        setSelected(frames[0]?.id ?? '')
      },
      (reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : `Could not load ${feed.label}.`)
      },
    )
    return () => controller.abort()
    // Listed when asked (Browse, Retry, a new source), at the camera of that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, feed])

  const frames = useMemo(() => (listed?.feedId === feed.id ? listed.frames : []), [listed, feed.id])
  const frame = frames.find((item) => item.id === selected)
  const full = mission.tiles.length + (frame?.layers.length ?? 1) > MAX_TILE_OVERLAYS
  const added = !!frame && frame.layers.every((layer) => mission.tiles.some((t) => t.tiles.includes(layer.tiles)))
  function add() {
    if (!frame) return
    const overlays = frameOverlays(feed, frame)
    change((m) =>
      m.tiles.length + overlays.length > MAX_TILE_OVERLAYS ||
      overlays.every((o) => m.tiles.some((t) => t.tiles.includes(o.tiles[0])))
        ? m
        : { ...m, tiles: [...m.tiles, ...overlays.filter((o) => !m.tiles.some((t) => t.tiles.includes(o.tiles[0])))] },
    )
  }
  const chooseFeed = (id: string) => {
    setFeedId(id)
    setError('')
    setSelected('')
    // A source already browsed lists again at once; the first stays a click.
    if (attempt) setAttempt((n) => n + 1)
  }

  return (
    <SidebarSection title="Historical imagery">
      <p className="mm-help">{feed.description}</p>
      {MISSION_IMAGERY_FEEDS.length > 1 && (
        <label className="mm-field">
          Imagery source
          <StyledSelect value={feed.id} onChange={(e) => chooseFeed(e.target.value)}>
            {MISSION_IMAGERY_FEEDS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </StyledSelect>
        </label>
      )}
      {frame ? (
        <>
          <label className="mm-field">
            {`${feed.shortLabel} ${one}`}
            <StyledSelect value={selected} onChange={(e) => setSelected(e.target.value)}>
              {frames.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.date}
                </option>
              ))}
            </StyledSelect>
          </label>
          <Button size="sm" disabled={added || full} onClick={add}>
            {added
              ? `${capital(one)} added`
              : full
                ? `${MAX_TILE_OVERLAYS} raster layers in use`
                : `Add ${feed.shortLabel} layer`}
          </Button>
        </>
      ) : (
        <>
          {error && (
            <p role="alert" className="mm-help">
              {error}
            </p>
          )}
          <Button
            size="sm"
            disabled={attempt > 0 && !error}
            onClick={() => {
              setError('')
              setAttempt((n) => n + 1)
            }}
          >
            {error ? feed.retryLabel : attempt ? feed.loadingText : `Browse ${feed.shortLabel} ${many}`}
          </Button>
        </>
      )}
      {LOCAL_ONLY_FEEDS.length > 0 && (
        <p className="mm-help">
          {LOCAL_ONLY_FEEDS.map((entry) => entry.label).join(', ')}: not offered here. PGMaps draws them through its own
          tile reader, which a saved mission cannot carry; the outdoors planner's dated imagery shows them.
        </p>
      )}
      <a
        className="mm-help underline"
        target="_blank"
        rel="noopener noreferrer"
        href={iconemViewUrl(mission.camera, 'historical', frame?.date)}
      >
        Open this location in Iconem historical imagery ↗
      </a>
    </SidebarSection>
  )
}
