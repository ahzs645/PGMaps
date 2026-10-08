import { useEffect, useId, useRef } from 'react'
import { useMap, dispatchMobileMapFeatureClick } from '../map-context.js'
import { observeMarkerSource, sameMarkerPosition } from '../map-marker-reconciliation.js'
import {
  createDonutElement,
  updateDonutElement,
  getDonutRenderKey,
  pieMarkerDonutProperties,
} from '../../visualizations/donut.js'
import {
  SPIDERFY_LIMIT,
  CLUSTER_LIST_PAGE_SIZE,
  getClusterLeafProperties,
  getClusterLeafTitle,
  createSpiderElement,
} from './pie-cluster-expansion.js'
import type MapLibreGL from 'maplibre-gl'
import MapLibreGLRuntime from 'maplibre-gl'

/** Known fields consumed by donut aggregation. Hosts can use this schema when authoring data. */
export interface PieClusterPointProperties {
  /** Category index for a single input observation. */
  bandIndex?: number
  /** Static color for an isolated observation. */
  color?: string
  /** Aggregate observation count when preAggregated is enabled. */
  count?: number
  /** Category counts in the same order as bandColors. */
  bandCounts?: readonly number[]
}

export type MapPieClusterLayerProps = {
  /** GeoJSON points carrying `bandIndex`/`color`, or pre-aggregated `count`/`bandCounts`, properties. */
  data: GeoJSON.FeatureCollection<GeoJSON.Point>
  /** Wedge color per band, indexed by each feature's `bandIndex`. */
  bandColors: readonly string[]
  /** Maximum clustering zoom, or the record-expansion threshold when expandOverlappingPoints is enabled (default: 14). */
  clusterMaxZoom?: number
  /** Cluster radius in pixels (default: 46). */
  clusterRadius?: number
  /** Show the total point count in the hollow donut centre (default: true). */
  showCount?: boolean
  /** Donut hole fill: solid 'white' disc or 'transparent' so the map shows through (default: 'white'). */
  centerStyle?: 'white' | 'transparent'
  /** Stroke color around unclustered dots (default: '#ffffff'). */
  pointStrokeColor?: string
  /**
   * Treat each input feature as an already-aggregated location. Clusters sum
   * `count` and `bandCounts`, while isolated features remain full pie markers.
   */
  preAggregated?: boolean
  /** Property used to label isolated pre-aggregated points. */
  pointLabelProperty?: string
  /**
   * Keep terminal clusters interactive: small stacks spiderfy and large stacks
   * open a paged record list instead of drawing coincident points on top of
   * each other (default: false).
   */
  expandOverlappingPoints?: boolean
  /** Callback when an unclustered point is clicked — receives the feature's properties. */
  onPointClick?: (properties: Record<string, unknown>) => void
}

export function MapPieClusterLayer({
  data,
  bandColors,
  clusterMaxZoom = 14,
  clusterRadius = 46,
  showCount = true,
  centerStyle = 'white',
  pointStrokeColor = '#ffffff',
  preAggregated = false,
  pointLabelProperty,
  expandOverlappingPoints = false,
  onPointClick,
}: MapPieClusterLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `pie-cluster-src-${uid}`
  const pointLayerId = `pie-cluster-points-${uid}`
  const labelLayerId = `pie-cluster-labels-${uid}`
  const onPointClickRef = useRef(onPointClick)

  useEffect(() => {
    onPointClickRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    if (!isLoaded || !map) return
    const currentMap = map
    // Retain clusters through every reachable camera zoom. Otherwise wheel,
    // pinch, or URL zoom can bypass terminal-cluster clicks and hide coincident
    // records behind a single dot. Keep clusterMaxZoom as the click threshold.
    const sourceClusterMaxZoom = expandOverlappingPoints
      ? Math.max(clusterMaxZoom, Math.ceil(currentMap.getMaxZoom()))
      : clusterMaxZoom
    let cancelled = false
    type DonutMarkerState = {
      marker: MapLibreGL.Marker
      element: HTMLDivElement
      renderKey: string
      clickState: {
        coordinates: [number, number]
        clusterId: number | null
        pointCount: number
        isCluster: boolean
        properties: Record<string, unknown>
      }
    }
    const markers: Record<string, DonutMarkerState> = {}
    let markersOnScreen: Record<string, DonutMarkerState> = {}
    let spiderMarker: MapLibreGL.Marker | null = null
    let clusterListPopup: MapLibreGL.Popup | null = null
    let expandedClusterElement: HTMLElement | null = null

    const clusterProperties: Record<string, MapLibreGL.ExpressionSpecification> = {}
    bandColors.forEach((_, index) => {
      clusterProperties[`band${index}`] = preAggregated
        ? ['+', ['coalesce', ['at', index, ['get', 'bandCounts']], 0]]
        : ['+', ['case', ['==', ['get', 'bandIndex'], index], 1, 0]]
    })
    if (preAggregated) {
      clusterProperties.aggregate_count = ['+', ['coalesce', ['get', 'count'], 0]]
    }

    const clearExpandedCluster = () => {
      spiderMarker?.remove()
      clusterListPopup?.remove()
      expandedClusterElement?.style.removeProperty('visibility')
      spiderMarker = null
      clusterListPopup = null
      expandedClusterElement = null
    }

    const selectClusterLeaf = (properties: Record<string, unknown>) => {
      clearExpandedCluster()
      dispatchMobileMapFeatureClick(map)
      onPointClickRef.current?.(properties)
    }

    const showSpider = (coordinates: [number, number], leaves: GeoJSON.Feature[], clusterElement: HTMLElement) => {
      clearExpandedCluster()
      expandedClusterElement = clusterElement
      clusterElement.style.visibility = 'hidden'
      const element = createSpiderElement(
        leaves,
        selectClusterLeaf,
        preAggregated ? { bandColors, showCount, centerStyle } : undefined,
      )
      spiderMarker = new MapLibreGLRuntime.Marker({ element, anchor: 'center' })
        .setLngLat(coordinates)
        .addTo(currentMap)
    }

    const showClusterList = (
      source: MapLibreGL.GeoJSONSource,
      clusterId: number,
      coordinates: [number, number],
      pointCount: number,
    ) => {
      clearExpandedCluster()
      const panel = document.createElement('div')
      panel.className =
        'w-[min(19rem,calc(100vw-3rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl'

      const header = document.createElement('div')
      header.className = 'flex items-center justify-between gap-3 border-b border-border px-3 py-2.5'
      const heading = document.createElement('div')
      heading.className = 'text-sm font-semibold'
      heading.textContent = `${pointCount.toLocaleString()} overlapping records`
      const closeButton = document.createElement('button')
      closeButton.type = 'button'
      closeButton.className =
        'rounded px-1.5 py-0.5 text-lg leading-none text-muted-foreground hover:bg-accent hover:text-foreground'
      closeButton.setAttribute('aria-label', 'Close overlapping records')
      closeButton.textContent = '×'
      closeButton.addEventListener('click', clearExpandedCluster)
      header.append(heading, closeButton)

      const list = document.createElement('div')
      list.className = 'max-h-44 overflow-y-auto p-1.5'
      const footer = document.createElement('div')
      footer.className = 'border-t border-border p-2'
      const loadMoreButton = document.createElement('button')
      loadMoreButton.type = 'button'
      loadMoreButton.className =
        'w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-80'
      footer.appendChild(loadMoreButton)
      panel.append(header, list, footer)

      let loaded = 0
      let loading = false
      const loadNextPage = async () => {
        if (loading || loaded >= pointCount) return
        loading = true
        loadMoreButton.disabled = true
        loadMoreButton.textContent = 'Loading…'
        try {
          const leaves = await source.getClusterLeaves(
            clusterId,
            Math.min(CLUSTER_LIST_PAGE_SIZE, pointCount - loaded),
            loaded,
          )
          if (cancelled) return
          leaves.forEach((leaf, pageIndex) => {
            const properties = getClusterLeafProperties(leaf)
            const title = getClusterLeafTitle(properties, loaded + pageIndex)
            const subtitle = String(properties.spiderSubtitle ?? '').trim()
            const color = String(properties.color ?? '#92400e')
            const row = document.createElement('button')
            row.type = 'button'
            row.className = 'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent'
            const dot = document.createElement('span')
            dot.className = 'mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-white shadow-sm'
            dot.style.background = color
            const copy = document.createElement('span')
            copy.className = 'min-w-0'
            const titleElement = document.createElement('span')
            titleElement.className = 'block truncate text-xs font-medium text-foreground'
            titleElement.textContent = title
            copy.appendChild(titleElement)
            if (subtitle) {
              const subtitleElement = document.createElement('span')
              subtitleElement.className = 'block truncate text-[11px] text-muted-foreground'
              subtitleElement.textContent = subtitle
              copy.appendChild(subtitleElement)
            }
            row.append(dot, copy)
            row.addEventListener('click', (event) => {
              event.stopPropagation()
              selectClusterLeaf(properties)
            })
            list.appendChild(row)
          })
          loaded += leaves.length
          if (loaded >= pointCount || leaves.length === 0) {
            footer.remove()
          } else {
            loadMoreButton.disabled = false
            loadMoreButton.textContent = `Show more (${(pointCount - loaded).toLocaleString()} remaining)`
          }
        } catch {
          loadMoreButton.disabled = true
          loadMoreButton.textContent = 'Could not load more records'
        } finally {
          loading = false
        }
      }
      loadMoreButton.addEventListener('click', (event) => {
        event.stopPropagation()
        void loadNextPage()
      })

      clusterListPopup = new MapLibreGLRuntime.Popup({
        className: 'mapcn-popup',
        anchor: currentMap.project(coordinates).y < currentMap.getCanvas().clientHeight * 0.6 ? 'top' : 'bottom',
        closeButton: false,
        closeOnClick: false,
        maxWidth: 'none',
        offset: 18,
      })
        .setLngLat(coordinates)
        .setDOMContent(panel)
        .addTo(currentMap)
      void loadNextPage()
    }

    const expandTerminalCluster = async (
      source: MapLibreGL.GeoJSONSource,
      clusterId: number,
      coordinates: [number, number],
      pointCount: number,
      clusterElement: HTMLElement,
    ) => {
      if (pointCount > SPIDERFY_LIMIT) {
        showClusterList(source, clusterId, coordinates, pointCount)
        return
      }
      const leaves = await source.getClusterLeaves(clusterId, pointCount, 0)
      if (!cancelled) showSpider(coordinates, leaves, clusterElement)
    }

    const handlePointClick = (event: MapLibreGL.MapMouseEvent) => {
      const rendered = currentMap.queryRenderedFeatures(event.point, { layers: [pointLayerId] })
      const properties = rendered[0]?.properties
      if (!properties) return
      clearExpandedCluster()
      event.preventDefault()
      event.originalEvent?.preventDefault()
      dispatchMobileMapFeatureClick(map)
      onPointClickRef.current?.(properties)
    }
    const handlePointEnter = () => {
      currentMap.getCanvas().style.cursor = 'pointer'
    }
    const handlePointLeave = () => {
      currentMap.getCanvas().style.cursor = ''
    }

    const updateMarkers = () => {
      const newMarkers: Record<string, DonutMarkerState> = {}
      for (const feature of currentMap.querySourceFeatures(sourceId)) {
        const props = feature.properties as Record<string, unknown> | null
        if (!props) continue
        const isCluster = Boolean(props.cluster)
        if (!isCluster && !preAggregated) continue
        const id = isCluster
          ? `cluster-${props.cluster_id}`
          : `point-${String(props.id ?? feature.id ?? (feature.geometry as GeoJSON.Point).coordinates.join(','))}`
        // querySourceFeatures can return a cluster from more than one tile.
        if (newMarkers[id]) continue
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
        const clusterId = isCluster ? Number(props.cluster_id) : null
        const pointCount = isCluster ? Number(props.point_count) || 0 : 1
        const donutProps = isCluster ? props : pieMarkerDonutProperties(props, bandColors)
        const renderKey = getDonutRenderKey(donutProps, bandColors)
        let markerState = markers[id]
        if (!markerState) {
          const element = createDonutElement(donutProps, bandColors, showCount, centerStyle)
          const clickState = { coordinates, clusterId, pointCount, isCluster, properties: props }
          element.addEventListener('click', (domEvent) => {
            domEvent.stopPropagation()
            dispatchMobileMapFeatureClick(map)
            const current = clickState
            if (!current.isCluster || current.clusterId === null) {
              onPointClickRef.current?.(current.properties)
              return
            }
            const currentClusterId = current.clusterId
            const source = currentMap.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
            if (!source) return
            void source.getClusterExpansionZoom(currentClusterId).then((zoom) => {
              if (expandOverlappingPoints && zoom > clusterMaxZoom) {
                void expandTerminalCluster(source, currentClusterId, current.coordinates, current.pointCount, element)
                return
              }
              clearExpandedCluster()
              currentMap.easeTo({ center: current.coordinates, zoom, duration: 450 })
            })
          })
          markerState = markers[id] = {
            marker: new MapLibreGLRuntime.Marker({ element }).setLngLat(coordinates),
            element,
            renderKey,
            clickState,
          }
        } else {
          // MapLibre may reuse a cluster id after setData(). Reconcile the DOM
          // marker as well as its click metadata so a data/filter change is
          // visible immediately, without waiting for a zoom to mint new ids.
          if (!sameMarkerPosition(markerState.clickState.coordinates, coordinates)) {
            markerState.marker.setLngLat(coordinates)
          }
          markerState.clickState.coordinates = coordinates
          markerState.clickState.clusterId = clusterId
          markerState.clickState.pointCount = pointCount
          markerState.clickState.isCluster = isCluster
          markerState.clickState.properties = props
          if (markerState.renderKey !== renderKey) {
            updateDonutElement(markerState.element, donutProps, bandColors, showCount, centerStyle)
            markerState.renderKey = renderKey
          }
        }
        newMarkers[id] = markerState
        if (!markersOnScreen[id]) markerState.marker.addTo(currentMap)
      }
      for (const id of Object.keys(markersOnScreen)) {
        if (newMarkers[id]) continue
        markersOnScreen[id].marker.remove()
        // Re-clustering mints fresh cluster ids, so the cache would otherwise
        // accumulate a full set of orphaned donut elements per data update.
        delete markers[id]
      }
      markersOnScreen = newMarkers
    }

    if (!currentMap.getSource(sourceId)) {
      currentMap.addSource(sourceId, {
        type: 'geojson',
        // Start empty and let the data effect below submit the real collection.
        // Keeping `data` out of this effect's dependencies is the point: it used
        // to tear down the source, the layer, and every donut on screen on each
        // new collection, which read as the whole layer blinking out whenever a
        // timeline scrub produced a new set.
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: sourceClusterMaxZoom,
        maxzoom: Math.max(18, sourceClusterMaxZoom + 1),
        clusterRadius,
        clusterProperties,
      })
    }
    if (!currentMap.getLayer(pointLayerId)) {
      currentMap.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        filter: preAggregated ? ['has', '__pgmaps_hidden_point__'] : ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'] as MapLibreGL.ExpressionSpecification,
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': pointStrokeColor,
        },
      })
    }
    if (pointLabelProperty && !currentMap.getLayer(labelLayerId)) {
      currentMap.addLayer({
        id: labelLayerId,
        type: 'symbol',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', pointLabelProperty],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      })
    }
    const stopReconciliation = observeMarkerSource(currentMap, sourceId, updateMarkers)
    currentMap.on('click', pointLayerId, handlePointClick)
    currentMap.on('mouseenter', pointLayerId, handlePointEnter)
    currentMap.on('mouseleave', pointLayerId, handlePointLeave)
    currentMap.on('movestart', clearExpandedCluster)

    return () => {
      cancelled = true
      stopReconciliation()
      currentMap.off('click', pointLayerId, handlePointClick)
      currentMap.off('mouseenter', pointLayerId, handlePointEnter)
      currentMap.off('mouseleave', pointLayerId, handlePointLeave)
      currentMap.off('movestart', clearExpandedCluster)
      clearExpandedCluster()
      Object.values(markersOnScreen).forEach(({ marker }) => marker.remove())
      Object.values(markers).forEach(({ marker }) => marker.remove())
      markersOnScreen = {}
      try {
        currentMap.getCanvas().style.cursor = ''
        if (currentMap.getLayer(labelLayerId)) currentMap.removeLayer(labelLayerId)
        if (currentMap.getLayer(pointLayerId)) currentMap.removeLayer(pointLayerId)
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId)
      } catch {
        // MapLibre can throw during style teardown.
      }
    }
  }, [
    isLoaded,
    map,
    bandColors,
    clusterMaxZoom,
    clusterRadius,
    showCount,
    centerStyle,
    pointStrokeColor,
    preAggregated,
    pointLabelProperty,
    expandOverlappingPoints,
    sourceId,
    pointLayerId,
    labelLayerId,
  ])

  // Update source data in place. MapLibre re-clusters in a worker, and the render
  // handler above leaves the existing donuts alone until the source reports loaded
  // again — so the previous clustering stays painted until the new one is ready.
  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined
    source?.setData(data)
  }, [data, isLoaded, map, sourceId])

  return null
}
