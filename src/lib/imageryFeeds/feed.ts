/**
 * A dated imagery feed: a source that offers the same ground at many dates, drawn as XYZ tiles, for
 * a map's imagery timeline (`src/components/ui/imagery-timeline.tsx`). Esri Wayback
 * (`waybackFeed.ts`) and NASA GIBS's daily Landsat and Sentinel-2 passes (`gibsHlsFeed.ts`) are the
 * first two; a new feed is one object meeting this contract, and every page with a timeline can
 * offer it. Guide: `docs/imagery-feeds.md`.
 *
 * What a feed must give: its frames, oldest first, each with the tile layers to draw it. What it may
 * give, when its service can answer: the frames that change the picture at a place
 * (`framesChangingAt`), and what a frame captured there (`captureAt`). The timeline offers each only
 * when the feed has it.
 *
 * No DOM access; `fetch` comes in through the context, so the feeds are tested without a browser.
 */

/** One tile layer of a frame. A frame may stack several (a feed with two satellites draws both). */
export interface ImageryTileLayer {
  /** An XYZ template, `{z}/{x}/{y}` in the order the service wants them. */
  tiles: string
  tileSize?: number
  /** What the layer is, where a frame has several (`Landsat`, `Sentinel-2`). */
  name?: string
  /** The shallowest zoom it is drawn at; shallower, the layer draws nothing. */
  minZoom?: number
  /** The deepest zoom the service has real tiles for; the map stretches beyond it. */
  maxZoom: number
  /** The credit, as text or the HTML MapLibre's attribution control takes. */
  attribution?: string
}

/** One date of a feed. `source` is the feed's own record, read only by the feed. */
export interface ImageryFrame<S = unknown> {
  /** Stable within the feed: the timeline, the caches and the hand-off key on it. */
  id: string
  /** YYYY-MM-DD, in UTC. */
  date: string
  /** Drawn bottom first. At most `MAX_FRAME_LAYERS`. */
  layers: readonly ImageryTileLayer[]
  source: S
}

/** Where the timeline reads a feed's local answers: the map centre, once the map stops. */
export interface ImageryPlace {
  lon: number
  lat: number
  /** The zoom the feed is drawn at here, already capped at the feed's `placeMaxZoom`. */
  zoom: number
}

/** What a frame's imagery is at a place, as its service records it. Every field may be unknown. */
export interface ImageryCapture {
  /** When the imagery was captured, YYYY-MM-DD. */
  date: string | null
  /** Ground resolution, metres. */
  resolutionM: number | null
  /** Stated horizontal accuracy, metres. */
  accuracyM: number | null
  /** Who supplied it. */
  provider: string | null
  /** The service's name for the source. */
  source: string | null
}

export interface ImageryFeedContext {
  signal: AbortSignal
  /** Callable as `context.fetch(…)`: a caller handing in the browser's own must bind it. */
  fetch: typeof fetch
  /** Today, YYYY-MM-DD in UTC, read once by the caller so a feed's dates cannot move mid-visit. */
  today: string
}

export interface ImageryFeed<S = unknown> {
  id: string
  /** The feed's name in a chooser: "Esri Wayback". */
  label: string
  /** A short name for labels and layer names: "Wayback". */
  shortLabel: string
  /** What one date of the feed is called: release, day, scene. */
  frameNoun: { one: string; many: string }
  /** One line on what it is and how far to trust its dates. */
  description: string
  /** The timeline's accessible name: what a frame's date means ("Esri Wayback mosaic release date"). */
  dateMeaning: string
  /** Shown while the frames load: "Loading Wayback releases…". */
  loadingText: string
  /** The button that asks again after a failed load: "Retry Wayback catalog". */
  retryLabel: string
  /**
   * How the timeline groups frames on its axis: a feed with a few frames a year by year, a daily
   * feed by month. Clicking a group's label opens it, one label a frame.
   */
  period: 'year' | 'month'
  /** Play shows each frame this long before the next, ms. */
  playbackMs: number
  /**
   * Every frame, oldest first. Throws with a message a person can act on. A feed gives this or
   * `listFramesAt`, never neither.
   */
  listFrames?(context: ImageryFeedContext): Promise<ImageryFrame<S>[]>
  /**
   * For a feed whose dates depend on where the map is (scenes searched over a place): the frames
   * covering the map centre, oldest first. The timeline lists again only when the centre moves to
   * another `listAreaKey`, keeping the last list (and the shown date) meanwhile.
   */
  listFramesAt?(place: ImageryPlace, context: ImageryFeedContext): Promise<ImageryFrame<S>[]>
  /** Places with one key share a list. Required with `listFramesAt`. */
  listAreaKey?(place: ImageryPlace): string
  /**
   * The MapLibre protocol the feed's tiles are served through (`pgmaps-s2`), when they are not plain
   * HTTPS: the map registers its handler before drawing them (`imagery-protocols.ts`).
   */
  tileProtocol?: string
  /** The deepest zoom a place is read at (the feed's deepest real tiles). */
  placeMaxZoom: number
  /**
   * A key for a place: two places with one key get one answer. Defaults to the place rounded to
   * about 10 m and its zoom.
   */
  placeKey?(place: ImageryPlace): string
  /** The frames, oldest first, that change the picture at a place. Absent: every frame is offered. */
  framesChangingAt?(
    frames: readonly ImageryFrame<S>[],
    place: ImageryPlace,
    context: ImageryFeedContext,
  ): Promise<ImageryFrame<S>[]>
  /** The "only changes here" switch's name: "Only releases that change this spot". */
  changesLabel?: string
  /** Why a frame might not change the picture, for that switch's tooltip. */
  changesHint?: string
  /** Whether a frame can say what it captured; `captureAt` is asked only when it can. */
  describes?(frame: ImageryFrame<S>): boolean
  /** What a frame captured at a place; null where the service records nothing there. */
  captureAt?(frame: ImageryFrame<S>, place: ImageryPlace, context: ImageryFeedContext): Promise<ImageryCapture | null>
}

/** The most tile layers one frame may stack; the map keeps one hand-off a layer. */
export const MAX_FRAME_LAYERS = 4

export function defaultPlaceKey(place: ImageryPlace): string {
  return `${place.lon.toFixed(4)},${place.lat.toFixed(4)},${Math.round(place.zoom)}`
}

export const placeKeyOf = (feed: Pick<ImageryFeed, 'placeKey'>, place: ImageryPlace) =>
  feed.placeKey ? feed.placeKey(place) : defaultPlaceKey(place)

/**
 * The frame among `changes` that a date shows: the newest not after it, or the oldest when the date
 * is before every change. A frame that reuses earlier imagery shows that earlier change.
 */
export function shownChange<T extends { date: string }>(changes: readonly T[], date: string): T | undefined {
  let shown: T | undefined
  for (const change of changes) if (change.date <= date && (!shown || change.date > shown.date)) shown = change
  return (
    shown ?? changes.reduce<T | undefined>((oldest, c) => (!oldest || c.date < oldest.date ? c : oldest), undefined)
  )
}

/** Checks a feed's answer: frames oldest first, unique ids, real dates and at most `MAX_FRAME_LAYERS` layers. */
export function checkFrames<S>(
  feed: Pick<ImageryFeed, 'label'>,
  frames: readonly ImageryFrame<S>[],
): ImageryFrame<S>[] {
  if (!frames.length) throw new Error(`${feed.label} returned no imagery dates.`)
  const ids = new Set<string>()
  for (const [i, frame] of frames.entries()) {
    if (ids.has(frame.id)) throw new Error(`${feed.label} listed ${frame.id} twice.`)
    ids.add(frame.id)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(frame.date) || !Number.isFinite(Date.parse(frame.date)))
      throw new Error(`${feed.label} gave ${frame.id} no readable date.`)
    if (i > 0 && frame.date < frames[i - 1].date) throw new Error(`${feed.label} listed its dates out of order.`)
    if (!frame.layers.length || frame.layers.length > MAX_FRAME_LAYERS)
      throw new Error(
        `${feed.label} gave ${frame.id} ${frame.layers.length} layers; 1 to ${MAX_FRAME_LAYERS} can be drawn.`,
      )
  }
  return [...frames]
}

/** yyyy-mm-dd, `days` away from `date`, in UTC so a time zone cannot shift the day. */
export function shiftIsoDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** "7.5 cm", "60 cm", "1.2 m", "15 m": a capture's ground resolution. */
export function formatResolution(metres: number) {
  if (metres < 1) return `${Number((metres * 100).toPrecision(2))} cm`
  return `${Number(metres.toPrecision(2))} m`
}

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
