import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createCogReader } from './cogReader'
import { createSentinelSearch } from './searchCache'
import {
  SENTINEL_BAND_CACHE_ENTRIES,
  SENTINEL_CLOUD_MAX_PERCENT,
  SENTINEL_LIST_CONCURRENCY,
  SENTINEL_RECENT_DAYS,
} from './limits'
import { defaultPair, defaultScene, type RatedScene } from './sceneChoice'
import { firstSeenLabel, ndviChange, ndviChangeRgba, ndviRgba, ndviValues, trueColourRgba } from './render'
import {
  recentRange,
  sentinelCredit,
  SentinelError,
  seasonRange,
  type FetchLike,
  type LonLatBounds,
  type SentinelScene,
} from './stac'
import {
  readSceneClearShare,
  sceneWindow,
  terrainZoneEpsg,
  windowQuad,
  type ClearShare,
  type RasterBands,
  type RasterReader,
  type RasterRequest,
  type SceneWindow,
} from './window'

export type SentinelMode = 'true-colour' | 'ndvi' | 'change'
/** Which scenes a search lists: the last two years, or one year's June–September season. */
export type SentinelRange = 'recent' | number

export type SentinelImage = {
  rgba: Uint8ClampedArray
  width: number
  height: number
  quad: [[number, number], [number, number], [number, number], [number, number]]
  /** Dates shown, for the Copernicus credit. */
  dates: string[]
  key: string
}

export type ChangeSummary = {
  label: string
  clearedHa: number
  comparedShare: number
}

type Failure = { message: string; retry: boolean }
const NO_SCENES: RatedScene[] = []
const NO_KNOWN: Record<string, RatedScene> = {}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
const message = (error: unknown) =>
  error instanceof SentinelError ? error.message : 'The Sentinel-2 imagery could not be prepared.'

const rangeLabel = (range: SentinelRange) =>
  range === 'recent' ? `the last ${SENTINEL_RECENT_DAYS / 365} years` : `June–September ${range}`

/**
 * The Sentinel-2 layer's state: the scene search over the terrain, each scene's clear share, the
 * picked scenes and the pixels to draw. Nothing runs while the layer is off.
 */
export function useSentinel2({
  visible,
  bounds,
  fetch: fetchImpl,
  reader: readerImpl,
}: {
  visible: boolean
  bounds: LonLatBounds | null
  fetch?: FetchLike
  reader?: RasterReader
}) {
  const reader = useMemo(() => readerImpl ?? createCogReader(), [readerImpl])
  const fetcher = useMemo<FetchLike>(() => fetchImpl ?? ((input, init) => globalThis.fetch(input, init)), [fetchImpl])
  const search = useMemo(() => createSentinelSearch(fetcher), [fetcher])
  const boundsKey = bounds ? bounds.map((v) => v.toFixed(6)).join(',') : ''
  const stableBounds = useMemo<LonLatBounds | null>(
    () => (boundsKey ? (boundsKey.split(',').map(Number) as LonLatBounds) : null),
    [boundsKey],
  )
  const [range, setRange] = useState<SentinelRange>('recent')
  const [mode, setMode] = useState<SentinelMode>('true-colour')
  const [catalog, setCatalog] = useState<{ area: string; scenes: RatedScene[]; known: Record<string, RatedScene> }>({
    area: '',
    scenes: [],
    known: {},
  })
  const scenes = catalog.area === boundsKey ? catalog.scenes : NO_SCENES
  const known = catalog.area === boundsKey ? catalog.known : NO_KNOWN
  const selectionArea = useRef('')
  const [searching, setSearching] = useState(false)
  const [searchFailure, setSearchFailure] = useState<Failure | null>(null)
  const [searchRevision, setSearchRevision] = useState(0)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const [pair, setPair] = useState<{ before: string | null; after: string | null }>({ before: null, after: null })
  const [image, setImage] = useState<SentinelImage | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageFailure, setImageFailure] = useState<Failure | null>(null)
  const [imageRevision, setImageRevision] = useState(0)
  const [change, setChange] = useState<ChangeSummary | null>(null)
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

  // Terrain checks that need no network: a stated reason before any request.
  const terrainProblem = useMemo<Failure | null>(() => {
    if (!stableBounds) return null
    try {
      const epsg = terrainZoneEpsg(stableBounds)
      sceneWindow(stableBounds!, epsg)
      return null
    } catch (error) {
      return { message: message(error), retry: false }
    }
  }, [stableBounds])

  useEffect(() => {
    if (!visible || !stableBounds || terrainProblem) return
    const controller = new AbortController()
    const { signal } = controller
    const epsg = terrainZoneEpsg(stableBounds)
    setSearching(true)
    setSearchFailure(null)
    setImageFailure(null)
    setCatalog((previous) => ({
      area: boundsKey,
      scenes: [],
      known: previous.area === boundsKey ? previous.known : {},
    }))
    const sameArea = selectionArea.current === boundsKey
    const publishScenes = (scenes: RatedScene[]) => setCatalog((previous) => ({ ...previous, area: boundsKey, scenes }))
    ;(async () => {
      try {
        const found = await search({
          window: stableBounds,
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
        let rated: RatedScene[] = found
        publishScenes(rated)
        // Rate each scene from a coarse read of its scene classification, a few at a time.
        let next = 0
        const worker = async () => {
          while (next < found.length && !signal.aborted) {
            const scene = found[next++]
            let rating: ClearShare | null
            try {
              const window = sceneWindow(stableBounds, scene.epsg)
              rating = await readSceneClearShare(scene, window, { read: (href, r) => read(href, r, signal) }, signal)
            } catch (error) {
              if (signal.aborted) return
              if (isAbort(error)) return
              rating = null
            }
            rated = rated.map((s) => (s.id === scene.id ? { ...s, rating } : s))
            publishScenes(rated)
          }
        }
        await Promise.all(Array.from({ length: SENTINEL_LIST_CONCURRENCY }, worker))
        if (signal.aborted) return
        if (rated.every((scene) => scene.rating === null))
          throw new SentinelError('read', 'None of the listed scenes could be read from the AWS archive.')
        setCatalog((previous) => ({
          ...previous,
          known: { ...previous.known, ...Object.fromEntries(rated.map((scene) => [scene.id, scene])) },
        }))
        selectionArea.current = boundsKey
        setSceneId((current) =>
          sameArea && current && rated.some((s) => s.id === current) ? current : (defaultScene(rated)?.id ?? null),
        )
        setPair((current) => {
          if (sameArea && current.before && current.after) return current
          const fallback = defaultPair(rated)
          return fallback ? { before: fallback[0].id, after: fallback[1].id } : current
        })
      } catch (error) {
        if (signal.aborted || isAbort(error)) return
        setSearchFailure({ message: message(error), retry: true })
      } finally {
        if (!signal.aborted) setSearching(false)
      }
    })()
    return () => controller.abort()
  }, [visible, stableBounds, boundsKey, terrainProblem, range, searchRevision, search, read])

  // Ratings arrive one scene at a time and replace the scene objects; the image effect reads the
  // picked scenes through this ref so a rating does not restart a read.
  const lookup = useRef<(id: string | null) => RatedScene | undefined>(() => undefined)
  useEffect(() => {
    lookup.current = (id) => (id ? (scenes.find((s) => s.id === id) ?? known[id]) : undefined)
  })
  const ready = (id: string | null) =>
    selectionArea.current === boundsKey && !!id && (scenes.some((s) => s.id === id) || !!known[id])
  const sceneReady = ready(sceneId),
    pairReady = ready(pair.before) && ready(pair.after)

  useEffect(() => {
    if (!visible || !stableBounds || terrainProblem) return
    if (mode === 'change' ? !pairReady : !sceneReady) return
    const shown = lookup.current(sceneId),
      before = lookup.current(pair.before),
      after = lookup.current(pair.after)
    const controller = new AbortController()
    const { signal } = controller
    setImageLoading(true)
    setImageFailure(null)
    ;(async () => {
      try {
        if (mode === 'change') {
          const [a, b] = [before!, after!].sort((x, y) => x.datetime.localeCompare(y.datetime))
          if (a.id === b.id) throw new SentinelError('no-scene', 'Pick two different scenes to compare.')
          if (a.epsg !== b.epsg)
            throw new SentinelError(
              'zones',
              `The two scenes come from tiles in different UTM zones (EPSG:${a.epsg} and EPSG:${b.epsg}), so their pixels do not line up. Pick two scenes from the same tile.`,
            )
          const window = sceneWindow(stableBounds, a.epsg)
          const ndvi = async (scene: SentinelScene) => {
            const [red, nir, scl] = await Promise.all(
              [scene.assets.red, scene.assets.nir, scene.assets.scl].map((href) => read(href, window, signal)),
            )
            return ndviValues({ red: red.bands[0], nir: nir.bands[0], scl: scl.bands[0] }, scene.scaling)
          }
          const [earlier, later] = await Promise.all([ndvi(a), ndvi(b)])
          const result = ndviChange(earlier, later)
          if (signal.aborted) return
          setChange({
            label: firstSeenLabel(a.date, b.date),
            clearedHa: (result.cleared * window.pixelM * window.pixelM) / 10_000,
            comparedShare: result.compared / (window.width * window.height),
          })
          setImage(drawn(window, ndviChangeRgba(result.delta), [a.date, b.date], `change|${a.id}|${b.id}|${boundsKey}`))
        } else {
          const scene = shown!
          const window = sceneWindow(stableBounds, scene.epsg)
          let rgba: Uint8ClampedArray
          if (mode === 'true-colour') {
            const bands = await read(scene.assets.visual, window, signal)
            rgba = trueColourRgba(bands.bands, window.width, window.height)
          } else {
            const [red, nir, scl] = await Promise.all(
              [scene.assets.red, scene.assets.nir, scene.assets.scl].map((href) => read(href, window, signal)),
            )
            rgba = ndviRgba(ndviValues({ red: red.bands[0], nir: nir.bands[0], scl: scl.bands[0] }, scene.scaling))
          }
          if (signal.aborted) return
          setChange(null)
          setImage(drawn(window, rgba, [scene.date], `${mode}|${scene.id}|${boundsKey}`))
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
    return () => controller.abort()
  }, [
    visible,
    stableBounds,
    boundsKey,
    terrainProblem,
    mode,
    sceneId,
    pair.before,
    pair.after,
    sceneReady,
    pairReady,
    imageRevision,
    read,
  ])

  const failure = visible ? (terrainProblem ?? searchFailure ?? imageFailure) : null
  const shownImage = visible && image?.key.endsWith(`|${boundsKey}`) && !failure ? image : null
  const retry = useCallback(() => {
    if (searchFailure) setSearchRevision((n) => n + 1)
    else setImageRevision((n) => n + 1)
  }, [searchFailure])
  const pickable = useMemo(
    () =>
      Object.values({ ...known, ...Object.fromEntries(scenes.map((s) => [s.id, s])) }).sort((a, b) =>
        b.datetime.localeCompare(a.datetime),
      ),
    [known, scenes],
  )
  return {
    range,
    setRange,
    mode,
    setMode,
    scenes,
    pickable,
    searching: visible && searching,
    sceneId,
    setSceneId,
    pair,
    setPair,
    image: shownImage,
    imageLoading: visible && imageLoading,
    change: shownImage && mode === 'change' ? change : null,
    failure,
    retry,
    credit: shownImage ? sentinelCredit(shownImage.dates) : null,
  }
}

function drawn(window: SceneWindow, rgba: Uint8ClampedArray, dates: string[], key: string): SentinelImage {
  return { rgba, width: window.width, height: window.height, quad: windowQuad(window), dates, key }
}

export type Sentinel2State = ReturnType<typeof useSentinel2>
export type { RatedScene }
