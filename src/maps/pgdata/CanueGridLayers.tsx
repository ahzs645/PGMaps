import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { CANUE_GRID_FILL_OPACITY, canueV2Paint, selectionsAround, type CanueColorScale } from './canueCore'
import type { CanueVariableSelection } from './canueV2'

/** Every CANUE archive starts here; below it a source has no tiles to draw. */
const CANUE_GRID_MIN_ZOOM = 5
/** Archives kept loaded on each side of the shown period while on a timeline. */
const CANUE_GRID_PRELOAD_RADIUS = 2
/** Outlasts MapLibre's default 300 ms paint transition, so the fade can finish. */
const CANUE_GRID_OUTGOING_MS = 400

/** The fields of MapLibre's `sourcedata` event this layer reads. MapLibre 6 types `source` as the full source spec. */
interface SourceDataEvent {
  tile?: unknown
  sourceId?: string
  source?: object
}

interface CanueGridLayersProps {
  selection: CanueVariableSelection
  timelineSelections: readonly CanueVariableSelection[]
  scale: CanueColorScale | null
}

/**
 * The grid as one layer per archive. A period's tiles live in that year's own
 * archive, so a plain swap would blank the map until they arrive. Instead the
 * shown period stays until the requested one has its tiles, and nearby periods
 * load invisibly: fully transparent, because MapLibre loads no tiles for a
 * source whose layers are hidden with `visibility: none`.
 */
export function CanueGridLayers({ selection, timelineSelections, scale }: CanueGridLayersProps) {
  const { map, isLoaded } = useMap()
  const [{ shown, outgoing }, setDisplay] = useState<{
    shown: CanueVariableSelection
    outgoing: CanueVariableSelection | null
  }>({ shown: selection, outgoing: null })
  // Months of a year share an archive and are only a repaint apart.
  if (shown !== selection && shown.pmtilesUrl === selection.pmtilesUrl) {
    setDisplay({ shown: selection, outgoing })
  }

  const layers = useMemo(() => {
    const byArchive = new Map<string, CanueVariableSelection>()
    const nearby = selectionsAround(timelineSelections, selection, CANUE_GRID_PRELOAD_RADIUS)
    // The outgoing layer stays mounted: a paint change fades, so removing it at
    // the swap would leave the incoming layer fading up over nothing.
    for (const entry of [shown, selection, ...nearby, ...(outgoing ? [outgoing] : [])]) {
      if (!byArchive.has(entry.pmtilesUrl)) byArchive.set(entry.pmtilesUrl, entry)
    }
    return Array.from(byArchive.values())
  }, [outgoing, selection, shown, timelineSelections])

  useEffect(() => {
    if (!outgoing) return
    const timer = setTimeout(() => setDisplay((current) => ({ ...current, outgoing: null })), CANUE_GRID_OUTGOING_MS)
    return () => clearTimeout(timer)
  }, [outgoing])

  useEffect(() => {
    if (!map || !isLoaded || map.getZoom() >= CANUE_GRID_MIN_ZOOM) return
    map.easeTo({ zoom: CANUE_GRID_MIN_ZOOM, duration: 400 })
  }, [isLoaded, map])

  // A source reports loaded as soon as its header arrives, before it has asked
  // for a tile, so it only counts once a tile of its own has landed.
  const tiledSources = useRef(new Map<string, string>())
  useEffect(() => {
    if (!map || !isLoaded) return
    const recordTile = (event: SourceDataEvent) => {
      const url =
        event.source && 'url' in event.source && typeof event.source.url === 'string' ? event.source.url : null
      if (event.tile && event.sourceId && url) tiledSources.current.set(url, event.sourceId)
    }
    map.on('sourcedata', recordTile)
    return () => {
      map.off('sourcedata', recordTile)
    }
  }, [isLoaded, map])

  // What each archive last had loaded under it. Asking a mounted archive for a
  // different property only queues a re-parse, so its tiles still hold the old one.
  const paintedProperties = useRef(new Map<string, string>())

  const waitingFor = shown.pmtilesUrl === selection.pmtilesUrl ? null : selection.pmtilesUrl
  useEffect(() => {
    if (!map || !isLoaded || !waitingFor) return
    const promote = () =>
      setDisplay((current) => (current.shown === selection ? current : { shown: selection, outgoing: current.shown }))
    const sourceId = () => tiledSources.current.get(`pmtiles://${waitingFor}`)
    const tilesLoaded = () => {
      const id = sourceId()
      return id != null && map.getSource(id) != null && map.isSourceLoaded(id)
    }
    if (paintedProperties.current.get(waitingFor) === selection.property && tilesLoaded()) {
      promote()
      return
    }
    const handleSourceData = (event: SourceDataEvent) => {
      if (event.tile && event.sourceId === sourceId() && tilesLoaded()) promote()
    }
    // `idle` covers a view with no tiles to request. A repaint makes sure it
    // fires even when this step left nothing to load and the map is at rest.
    map.on('sourcedata', handleSourceData)
    map.on('idle', promote)
    map.triggerRepaint()
    return () => {
      map.off('sourcedata', handleSourceData)
      map.off('idle', promote)
    }
  }, [isLoaded, map, selection, waitingFor])

  // Declared after the effect above so that it still reads the previous render's.
  useEffect(() => {
    for (const entry of layers) paintedProperties.current.set(entry.pmtilesUrl, entry.property)
  }, [layers])

  return (
    <>
      {layers.map((entry) => {
        const visible = entry.pmtilesUrl === shown.pmtilesUrl
        return (
          <MapPmtilesFillLayer
            key={entry.pmtilesUrl}
            url={entry.pmtilesUrl}
            sourceLayer="canue"
            fillColor={canueV2Paint(entry, timelineSelections.includes(entry) ? scale : null)}
            fillOpacity={visible ? CANUE_GRID_FILL_OPACITY : 0}
            lineColor="#0f172a"
            lineWidth={0.18}
            lineOpacity={visible ? 0.22 : 0}
          />
        )
      })}
    </>
  )
}
