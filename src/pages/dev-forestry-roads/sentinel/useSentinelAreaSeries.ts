import { useEffect, useMemo, useRef, useState } from 'react'
import { findDrop, readAreaSeries, shortDips, thinScenes, type AreaGeometry, type SeriesPoint } from './areaSeries'
import { SENTINEL_INDICES, type SentinelIndex } from './indices'
import { SENTINEL_SERIES_MAX_SCENES } from './limits'
import { SentinelError, type SentinelScene } from './stac'
import type { RasterReader } from './window'

/** The area a series is read over: a cutblock or a drawn polygon. Kept for this map session only. */
export type SentinelArea = {
  id: string
  name: string
  geometry: AreaGeometry
  /** Planar area as drawn, for the card. */
  areaHa: number
}

type Failure = { message: string }
/** Areas × indices whose read scenes are kept in memory, so switching back does not read again. */
const SERIES_KEPT = 6
const NO_POINTS: SeriesPoint[] = []

/**
 * The chosen index through time over one area, for the scenes the panel offers, always including
 * the scenes in `keep` (the one the card shows). Reads run only while `visible`; a new area, index
 * or scene list cancels the reads in flight, and a scene read before for the same area and index is
 * not read again. A failed read is not kept, so it is tried again next time.
 */
export function useSentinelAreaSeries({
  visible,
  area,
  scenes,
  index,
  reader,
  keep,
}: {
  visible: boolean
  area: SentinelArea | null
  scenes: readonly SentinelScene[]
  index: SentinelIndex
  reader: RasterReader
  keep: readonly (string | null)[]
}) {
  const keepKey = keep.join(',')
  const chosen = useMemo(() => thinScenes(scenes, SENTINEL_SERIES_MAX_SCENES, keepKey.split(',')), [scenes, keepKey])
  const sceneKey = chosen.map((scene) => scene.id).join(',')
  const seriesKey = area ? `${area.id}|${index}` : ''
  const key = seriesKey && sceneKey ? `${seriesKey}|${sceneKey}` : ''
  const kept = useRef(new Map<string, Map<string, SeriesPoint>>())
  const [state, setState] = useState<{
    key: string
    points: SeriesPoint[]
    loading: boolean
    failure: Failure | null
  }>({ key: '', points: [], loading: false, failure: null })
  const latest = useRef({ chosen, area })
  useEffect(() => {
    latest.current = { chosen, area }
  })

  useEffect(() => {
    if (!visible || !key) return
    const { chosen: listed, area: target } = latest.current
    let known = kept.current.get(seriesKey)
    if (!known) {
      known = new Map()
      kept.current.set(seriesKey, known)
      while (kept.current.size > SERIES_KEPT) kept.current.delete(kept.current.keys().next().value!)
    }
    const store = known
    const ready = listed.flatMap((scene) => store.get(scene.id) ?? [])
    const byDate = (a: SeriesPoint, b: SeriesPoint) => a.datetime.localeCompare(b.datetime)
    if (ready.length === listed.length) {
      setState({ key, points: ready.sort(byDate), loading: false, failure: null })
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    setState({ key, points: ready.sort(byDate), loading: true, failure: null })
    readAreaSeries({
      scenes: listed,
      geometry: target!.geometry,
      index,
      reader,
      signal,
      known: store,
      onPoint: (point) => {
        if (point.gap?.reason !== 'read') store.set(point.sceneId, point)
        setState((previous) =>
          previous.key === key ? { ...previous, points: [...previous.points, point].sort(byDate) } : previous,
        )
      },
    }).then(
      (points) => {
        if (signal.aborted) return
        setState({ key, points, loading: false, failure: null })
      },
      (error: unknown) => {
        if (signal.aborted) return
        setState({
          key,
          points: [],
          loading: false,
          failure: {
            message: error instanceof SentinelError ? error.message : 'The area series could not be read.',
          },
        })
      },
    )
    return () => controller.abort()
  }, [visible, key, seriesKey, index, reader])

  const current = state.key === key && key ? state : null
  const points = current?.points ?? NO_POINTS
  const drop = useMemo(() => findDrop(points, SENTINEL_INDICES[index].drop), [points, index])
  const dips = useMemo(() => shortDips(points, SENTINEL_INDICES[index].drop), [points, index])
  return {
    index,
    points,
    drop,
    /** Scene-to-scene falls after which the level came back (not counted). */
    dips,
    /** Scenes the series reads (the list, thinned). */
    total: chosen.length,
    /** Scenes the panel offers before thinning. */
    offered: scenes.length,
    loading: visible && !!current?.loading,
    failure: current?.failure ?? null,
  }
}

export type SentinelAreaSeries = ReturnType<typeof useSentinelAreaSeries>
