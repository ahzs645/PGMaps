import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ViewWindow } from '@/components/ui/map-view-window'
import { catalogueServes, sceneReaches, type SceneCatalogue } from './catalogue'
import { createCogReader } from '@/lib/sentinel2/cogReader'
import { createSentinelSearch } from './searchCache'
import {
  SENTINEL_BAND_CACHE_ENTRIES,
  SENTINEL_CLOUD_MAX_PERCENT,
  SENTINEL_LIST_CONCURRENCY,
  SENTINEL_RECENT_DAYS,
} from '@/lib/sentinel2/limits'
import { defaultPair, defaultScene, type RatedScene } from './sceneChoice'
import { firstSeenLabel, trueColourRgba } from './render'
import { indexChange, indexChangeRgba, indexRgba, indexValues, SENTINEL_INDICES, type SentinelIndex } from './indices'
import { readIndexBands } from './resample'
import { useSentinelAreaSeries, type SentinelArea } from './useSentinelAreaSeries'
import {
  recentRange,
  sentinelCredit,
  SentinelError,
  seasonRange,
  type FetchLike,
  type SentinelScene,
} from '@/lib/sentinel2/stac'
import {
  readSceneClearShare,
  sceneWindow,
  terrainZoneEpsg,
  windowKm,
  windowQuad,
  type ClearShare,
  type RasterBands,
  type RasterReader,
  type RasterRequest,
  type SceneWindow,
} from '@/lib/sentinel2/window'

/** True colour, one index on one scene, or an index's change between two scenes. */
export type SentinelMode = 'true-colour' | SentinelIndex | `${SentinelIndex}-change`

export const isChangeMode = (mode: SentinelMode): mode is `${SentinelIndex}-change` => mode.endsWith('-change')
/** The index a mode draws; true colour has none. */
export const modeIndex = (mode: SentinelMode): SentinelIndex | null =>
  mode === 'true-colour' ? null : (mode.replace('-change', '') as SentinelIndex)
/** Which scenes a search lists: the last two years, or one year's June–September season. */
export type SentinelRange = 'recent' | number

export type SentinelImage = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  quad: [[number, number], [number, number], [number, number], [number, number]]
  /** Dates shown, for the Copernicus credit. */
  dates: string[]
  /** The read window's ground size, width × height in km: the area every figure for it covers. */
  areaKm: [number, number]
  key: string
}

export type ChangeSummary = {
  index: SentinelIndex
  label: string
  /** Ground in the read window whose index fell by at least the index's counted drop. */
  changedHa: number
  /** Share of the read window where both scenes see clear ground. */
  comparedShare: number
}

type Failure = { message: string; retry: boolean }
type Rating = { window: string; value: ClearShare | null }
type Catalogue = SceneCatalogue & { key: string }
const NO_SCENES: RatedScene[] = []

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const message = (error: unknown) =>
  error instanceof SentinelError ? error.message : 'The Sentinel-2 imagery could not be prepared.'

const rangeLabel = (range: SentinelRange) =>
  range === 'recent' ? `the last ${SENTINEL_RECENT_DAYS / 365} years` : `June–September ${range}`

const newestFirst = (a: SentinelScene, b: SentinelScene) => b.datetime.localeCompare(a.datetime)

/**
 * The Sentinel-2 layer's state: the scene search, each scene's clear share over the read window,
 * the picked scenes and the pixels to draw. Nothing runs while the layer is off.
 *
 * `window` is the view window (`useViewWindow`): the view grown by the overscan. A new window reads
 * the picked scenes' pixels straight away and keeps the last picture, at its own corners, until the
 * new one is ready. It searches the catalogue again only when the listed tiles no longer hold it
 * (`catalogueServes`), and keeps the reviewer's scene and pair while they are still offered. Scene
 * ratings are read once the map stops (`moving` false); the previous ones show meanwhile.
 */
export function useSentinel2({
  visible,
  window: view,
  moving = false,
  fetch: fetchImpl,
  reader: readerImpl,
}: {
  visible: boolean
  window: ViewWindow | null
  moving?: boolean
  fetch?: FetchLike
  reader?: RasterReader
}) {
  const reader = useMemo(() => readerImpl ?? createCogReader(), [readerImpl])
  const fetcher = useMemo<FetchLike>(() => fetchImpl ?? ((input, init) => globalThis.fetch(input, init)), [fetchImpl])
  const search = useMemo(() => createSentinelSearch(fetcher), [fetcher])
  // `useViewWindow` hands out one object per window, so effects that follow it rerun only for a new one.
  const win = view
  const windowKey = win?.key ?? ''
  const [range, setRange] = useState<SentinelRange>('recent')
  const rangeKey = String(range)
  const [mode, setMode] = useState<SentinelMode>('true-colour')
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  /** Every scene any search this session listed, by id: the change view's lists draw on it. */
  const [known, setKnown] = useState<Record<string, SentinelScene>>({})
  /** Each scene's latest clear share and the window it was read over. */
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [ratingRevision, setRatingRevision] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchFailure, setSearchFailure] = useState<(Failure & { key: string }) | null>(null)
  const [searchRevision, setSearchRevision] = useState(0)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [pair, setPair] = useState<{ before: string | null; after: string | null }>({ before: null, after: null })
  const [image, setImage] = useState<SentinelImage | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageFailure, setImageFailure] = useState<Failure | null>(null)
  const [imageRevision, setImageRevision] = useState(0)
  const [change, setChange] = useState<ChangeSummary | null>(null)
  const [area, setArea] = useState<SentinelArea | null>(null)
  const cache = useRef(new Map<string, { promise: Promise<RasterBands>; signal: AbortSignal; complete: boolean }>())

  /**
   * A cached band read. A read is shared while the effect that started it is alive; when that
   * effect goes away mid-read, a caller still waiting reads again under its own signal.
   */
  const read = useCallback(
    async (href: string, request: RasterRequest, signal: AbortSignal): Promise<RasterBands> => {
      const key = `${href}|${request.bbox.join(',')}|${request.width}x${request.height}`
      const entries = cache.current
      for (let attempt = 0; ; attempt++) {
        let entry = entries.get(key)
        if (entry && !entry.complete && entry.signal.aborted) entry = undefined
        if (entry) {
          entries.delete(key)
          entries.set(key, entry)
        } else {
          const promise = reader.read(href, { ...request, signal })
          const started = { promise, signal, complete: false }
          entry = started
          entries.set(key, started)
          void promise.then(
            () => {
              started.complete = true
            },
            () => {
              if (entries.get(key) === started) entries.delete(key)
            },
          )
          while (entries.size > SENTINEL_BAND_CACHE_ENTRIES) entries.delete(entries.keys().next().value!)
        }
        try {
          return await entry.promise
        } catch (error) {
          if (signal.aborted || !entry.signal.aborted || attempt > 1) throw error
        }
      }
    },
    [reader],
  )

  // The view's zone, and checks that need no network: a stated reason before any request.
  const { epsg, terrainProblem } = useMemo<{ epsg: number | null; terrainProblem: Failure | null }>(() => {
    if (!win) return { epsg: null, terrainProblem: null }
    try {
      const zone = terrainZoneEpsg(win.view)
      sceneWindow(win.bounds, zone, { view: win.view })
      return { epsg: zone, terrainProblem: null }
    } catch (error) {
      return { epsg: null, terrainProblem: { message: message(error), retry: false } }
    }
  }, [win])
  const problem = terrainProblem?.message ?? ''

  // A pan inside the listed tiles keeps the catalogue; otherwise the window needs its own search.
  const served = !!win && !!epsg && catalogueServes(catalogue, win.bounds, epsg, rangeKey)
  const searchKey = !win ? '' : served ? catalogue!.key : `${rangeKey}|${windowKey}`
  const latest = useRef({ win, epsg, range, rangeKey, catalogue })
  useEffect(() => {
    latest.current = { win, epsg, range, rangeKey, catalogue }
  })

  useEffect(() => {
    const { win, epsg, range, rangeKey, catalogue } = latest.current
    if (!visible || !searchKey || !win || !epsg || problem || catalogue?.key === searchKey) return
    const controller = new AbortController()
    const { signal } = controller
    setSearching(true)
    setSearchFailure(null)
    ;(async () => {
      try {
        const found = await search({
          window: win.bounds,
          range: range === 'recent' ? recentRange(new Date(), SENTINEL_RECENT_DAYS) : seasonRange(range),
          signal,
          preferEpsg: epsg,
        })
        if (signal.aborted) return
        if (!found.length)
          throw new SentinelError(
            'no-scene',
            `No Sentinel-2 scene under ${SENTINEL_CLOUD_MAX_PERCENT}% cloud covers this view in ${rangeLabel(range)}.`,
          )
        setCatalogue({ key: searchKey, searched: win.bounds, epsg, range: rangeKey, scenes: found })
        setKnown((previous) => ({ ...previous, ...Object.fromEntries(found.map((scene) => [scene.id, scene])) }))
      } catch (error) {
        if (signal.aborted || isAbort(error)) return
        setSearchFailure({ key: searchKey, message: message(error), retry: true })
      } finally {
        if (!signal.aborted) setSearching(false)
      }
    })()
    return () => {
      controller.abort()
      setSearching(false)
    }
  }, [visible, searchKey, searchRevision, problem, search])

  // The list shown: the catalogue's scenes while it is for this date range (kept through a search
  // for a new area, so the list does not empty), each with its latest rating.
  const listed = catalogue && catalogue.range === rangeKey ? catalogue.scenes : NO_SCENES
  const scenes = useMemo<RatedScene[]>(
    () => listed.map((scene) => (ratings[scene.id] ? { ...scene, rating: ratings[scene.id].value } : scene)),
    [listed, ratings],
  )
  // The scenes the change view offers: the list, then scenes listed before whose tile reaches the window.
  const pickable = useMemo<RatedScene[]>(() => {
    if (!win) return scenes
    const ids = new Set(scenes.map((scene) => scene.id))
    const others = Object.values(known)
      .filter((scene) => !ids.has(scene.id) && scene.bbox && sceneReaches(scene, win.bounds))
      .map((scene) => (ratings[scene.id] ? { ...scene, rating: ratings[scene.id].value } : scene))
    return [...scenes, ...others].sort(newestFirst)
  }, [scenes, known, ratings, win])
  const listCurrent = served && catalogue?.key === searchKey
  const ratedHere = (id: string) => ratings[id]?.window === windowKey
  const listRatedHere = listCurrent && listed.length > 0 && listed.every((scene) => ratedHere(scene.id))
  const listUnread = listRatedHere && listed.every((scene) => ratings[scene.id].value === null)

  // A picked scene can be drawn over this window when its tile reaches it; the image effect reads
  // the scenes through this ref so ratings landing do not restart a read.
  const lookup = useRef<(id: string | null) => SentinelScene | undefined>(() => undefined)
  useEffect(() => {
    lookup.current = (id) => (id ? known[id] : undefined)
  })
  const drawable = (id: string | null) => !!win && !!id && !!known[id] && sceneReaches(known[id], win.bounds)
  const sceneReady = drawable(sceneId),
    pairReady = drawable(pair.before) && drawable(pair.after)

  // The picture for this window, read straight away. Declared before the ratings so its reads queue
  // first. The last picture stays in state, at its own corners, until this one replaces it.
  useEffect(() => {
    if (!visible || !win || problem) return
    const comparing = isChangeMode(mode)
    if (comparing ? !pairReady : !sceneReady) return
    const shown = lookup.current(sceneId),
      before = lookup.current(pair.before),
      after = lookup.current(pair.after)
    const controller = new AbortController()
    const { signal } = controller
    setImageLoading(true)
    setImageFailure(null)
    ;(async () => {
      try {
        const cached = { read: (href: string, request: RasterRequest) => read(href, request, signal) }
        if (comparing) {
          const index = modeIndex(mode)!
          const spec = SENTINEL_INDICES[index]
          const [a, b] = [before!, after!].sort((x, y) => x.datetime.localeCompare(y.datetime))
          if (a.id === b.id) throw new SentinelError('no-scene', 'Pick two different scenes to compare.')
          if (a.epsg !== b.epsg)
            throw new SentinelError(
              'zones',
              `The two scenes come from tiles in different UTM zones (EPSG:${a.epsg} and EPSG:${b.epsg}), so their pixels do not line up. Pick two scenes from the same tile.`,
            )
          const window = sceneWindow(win.bounds, a.epsg, { view: win.view })
          const values = async (scene: SentinelScene) =>
            indexValues(index, await readIndexBands(scene, index, window, cached, signal), scene.scaling)
          const [earlier, later] = await Promise.all([values(a), values(b)])
          const result = indexChange(earlier, later, spec.drop)
          if (signal.aborted) return
          setChange({
            index,
            label: firstSeenLabel(a.date, b.date),
            changedHa: (result.changed * window.pixelM * window.pixelM) / 10_000,
            comparedShare: result.compared / (window.width * window.height),
          })
          setImage(
            drawn(
              window,
              indexChangeRgba(result.delta, spec.changeStops, spec.drop, spec.quiet),
              [a.date, b.date],
              `${mode}|${a.id}|${b.id}`,
            ),
          )
        } else {
          const scene = shown!
          const window = sceneWindow(win.bounds, scene.epsg, { view: win.view })
          let rgba: Uint8ClampedArray
          if (mode === 'true-colour') {
            const bands = await read(scene.assets.visual, window, signal)
            rgba = trueColourRgba(bands.bands, window.width, window.height)
          } else {
            const index = modeIndex(mode)!
            const bands = await readIndexBands(scene, index, window, cached, signal)
            rgba = indexRgba(indexValues(index, bands, scene.scaling), SENTINEL_INDICES[index].stops)
          }
          if (signal.aborted) return
          setChange(null)
          setImage(drawn(window, rgba, [scene.date], `${mode}|${scene.id}`))
        }
      } catch (error) {
        if (signal.aborted || isAbort(error)) return
        setImageFailure({
          message: message(error),
          retry: !(error instanceof SentinelError && (error.kind === 'zones' || error.kind === 'no-scene')),
        })
      } finally {
        if (!signal.aborted) setImageLoading(false)
      }
    })()
    return () => {
      controller.abort()
      setImageLoading(false)
    }
  }, [visible, win, problem, mode, sceneId, pair.before, pair.after, sceneReady, pairReady, imageRevision, read])

  // Rate the offered scenes over this window from a coarse read of their scene classification, once
  // the map has stopped: the list first, then the scenes kept from earlier searches. Ratings bypass
  // the band cache, so they never push the picture's bands out of it.
  const toRate = useMemo(() => {
    const ids = new Set(listed.map((scene) => scene.id))
    return [...listed, ...pickable.filter((scene) => !ids.has(scene.id))]
  }, [listed, pickable])
  const rateKey = listCurrent ? toRate.map((scene) => scene.id).join(',') : ''
  const ratingsRef = useRef(ratings)
  const toRateRef = useRef(toRate)
  useEffect(() => {
    ratingsRef.current = ratings
    toRateRef.current = toRate
  })
  useEffect(() => {
    if (!visible || moving || !win || problem || !rateKey) return
    const todo = toRateRef.current.filter((scene) => ratingsRef.current[scene.id]?.window !== windowKey)
    if (!todo.length) return
    const controller = new AbortController()
    const { signal } = controller
    const direct = { read: (href: string, request: RasterRequest) => reader.read(href, { ...request, signal }) }
    let next = 0
    const worker = async () => {
      while (next < todo.length && !signal.aborted) {
        const scene = todo[next++]
        let value: ClearShare | null
        try {
          value = await readSceneClearShare(
            scene,
            sceneWindow(win.bounds, scene.epsg, { view: win.view }),
            direct,
            signal,
          )
        } catch (error) {
          if (signal.aborted || isAbort(error)) return
          value = null
        }
        setRatings((previous) => ({ ...previous, [scene.id]: { window: windowKey, value } }))
      }
    }
    void Promise.all(Array.from({ length: SENTINEL_LIST_CONCURRENCY }, worker))
    return () => controller.abort()
  }, [visible, moving, win, windowKey, problem, rateKey, ratingRevision, reader])

  // Defaults, once the list is rated over this window: only where the reviewer's choice is no longer
  // offered (a scene not in the list, a pair whose scenes no longer reach the window).
  const pickableKey = pickable.map((scene) => scene.id).join(',')
  const ratedList = useMemo(
    () => (listRatedHere ? listed.map((scene) => ({ ...scene, rating: ratings[scene.id].value })) : null),
    [listRatedHere, listed, ratings],
  )
  useEffect(() => {
    if (!visible || !ratedList || listUnread) return
    const offered = new Set(pickableKey.split(','))
    setSceneId((current) =>
      current && ratedList.some((scene) => scene.id === current) ? current : (defaultScene(ratedList)?.id ?? null),
    )
    setPair((current) => {
      if (current.before && current.after && offered.has(current.before) && offered.has(current.after)) return current
      const fallback = defaultPair(ratedList)
      return fallback ? { before: fallback[0].id, after: fallback[1].id } : current
    })
  }, [visible, ratedList, listUnread, pickableKey])

  const currentSearchFailure = searchFailure && searchFailure.key === searchKey ? searchFailure : null
  const ratingFailure: Failure | null = listUnread
    ? { message: 'None of the listed scenes could be read from the AWS archive.', retry: true }
    : null
  const failure = visible ? (terrainProblem ?? currentSearchFailure ?? ratingFailure ?? imageFailure) : null
  const shownImage = visible && image && !failure ? image : null
  const retry = useCallback(() => {
    if (currentSearchFailure) setSearchRevision((n) => n + 1)
    else if (listUnread) {
      setRatings((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([id]) => !listed.some((scene) => scene.id === id))),
      )
      setRatingRevision((n) => n + 1)
    } else setImageRevision((n) => n + 1)
  }, [currentSearchFailure, listUnread, listed])
  const searchingNow = visible && (searching || (!!searchKey && !listCurrent && !currentSearchFailure && !problem))
  // The area series reads the scenes the panel offers once the list is in, so a rating landing does
  // not restart it.
  const seriesIndex = modeIndex(mode) ?? 'ndvi'
  const series = useSentinelAreaSeries({
    visible: visible && !terrainProblem && !searchingNow && !currentSearchFailure,
    area,
    scenes: pickable,
    index: seriesIndex,
    reader,
    keep: isChangeMode(mode) ? [pair.before, pair.after] : [sceneId],
  })
  return {
    range,
    setRange,
    mode,
    setMode,
    scenes,
    pickable,
    searching: searchingNow,
    /** Ratings for this window still being read (the previous ones show meanwhile). */
    rating: visible && listCurrent && !listRatedHere,
    sceneId,
    setSceneId,
    pair,
    setPair,
    image: shownImage,
    imageLoading: visible && imageLoading,
    change: shownImage && isChangeMode(mode) ? change : null,
    area,
    setArea,
    series,
    failure,
    retry,
    credit: shownImage ? sentinelCredit(shownImage.dates) : null,
  }
}

function drawn(window: SceneWindow, rgba: Uint8ClampedArray, dates: string[], label: string): SentinelImage {
  // The key names the window's own grid, so an encoded picture is never placed on another window.
  const key = `${label}|${window.epsg}:${window.bbox.join(',')}:${window.pixelM}`
  return {
    rgba,
    width: window.width,
    height: window.height,
    quad: windowQuad(window),
    dates,
    areaKm: windowKm(window),
    key,
  }
}

export type Sentinel2State = ReturnType<typeof useSentinel2>
export type { RatedScene }
