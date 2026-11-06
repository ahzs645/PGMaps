import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useMap } from '@/components/ui/map'
import { visibleMapInsets } from '@pgmaps/geo-toolkit/map/camera-framing'
import { useWorkspace } from '@pgmaps/geo-toolkit/workspace/workspace-context'
import { onMapCoveredBottomChange } from '@pgmaps/geo-toolkit/map/map-resize'
import type { RasterRecord } from './catalogue'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

export function RasterMapLayer({
  item,
  opacity,
  onError,
}: {
  item: RasterRecord | null
  opacity: number
  onError: (text: string) => void
}) {
  const { map, isLoaded } = useMap()
  const workspace = useWorkspace()
  useEffect(() => {
    if (!map || !isLoaded || !item) return
    const ids = item.assets.map((_, i) => `shared-raster-${i}`)
    let following = true
    let frame = 0
    let lastGeometry = ''
    const container = map.getContainer()
    const root = workspace?.root || container.closest<HTMLElement>('[data-map-layout-root="true"]') || container
    const panelInsets = () => {
      const rect = container.getBoundingClientRect()
      const padding = map.getPadding()
      const viewport = {
        left: rect.left + padding.left,
        right: rect.right - padding.right,
        top: rect.top + padding.top,
        bottom: rect.bottom - padding.bottom,
      }
      const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-map-mobile-sheet="true"]'))
        .filter((panel) => panel.getClientRects().length && getComputedStyle(panel).display !== 'none')
        .map((panel) => {
          const bounds = panel.getBoundingClientRect()
          const height = Number(panel.dataset.mapTargetVisibleHeight)
          return Number.isFinite(height)
            ? { left: bounds.left, right: bounds.right, top: viewport.bottom - height, bottom: viewport.bottom }
            : bounds
        })
      const insets = visibleMapInsets(viewport, panels)
      const gap = Math.min(45, Math.max(8, (viewport.bottom - viewport.top - insets.top - insets.bottom) / 4))
      return { top: insets.top + gap, bottom: insets.bottom + gap, left: insets.left + gap, right: insets.right + gap }
    }
    const fit = () => {
      frame = 0
      if (!following) return
      const padding = panelInsets()
      const rect = container.getBoundingClientRect()
      const geometry = JSON.stringify([rect.right - rect.left, rect.bottom - rect.top, map.getPadding(), padding])
      if (geometry === lastGeometry) return
      lastGeometry = geometry
      // fitBounds already accounts for the toolkit's covered-pane padding.
      map.fitBounds(
        [
          [item.bounds[0], item.bounds[1]],
          [item.bounds[2], item.bounds[3]],
        ],
        { padding, maxZoom: 18, duration: 0 },
      )
    }
    const scheduleFit = () => {
      if (following && !frame) frame = requestAnimationFrame(fit)
    }
    const stopFollowing = (event: { originalEvent?: Event }) => {
      if (event.originalEvent) following = false
    }
    const install = () => {
      ids.forEach((id, i) => {
        const asset = item.assets[i]
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
        map.addSource(id, {
          type: 'raster',
          tiles: asset.url ? [`pmtiles://${asset.url}/{z}/{x}/{y}`] : asset.tiles,
          bounds: asset.bounds,
          tileSize: 256,
          minzoom: asset.minZoom,
          maxzoom: asset.maxZoom,
        })
        map.addLayer({
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': opacity / 100, 'raster-fade-duration': 150 },
        })
      })
      fit()
    }
    const error = (event: { sourceId?: string; error?: Error }) => {
      if (event.sourceId && ids.includes(event.sourceId)) {
        onError(
          'Some map tiles could not load. Retry the map or check that its URL permits cross-origin range requests.',
        )
      }
    }
    map.on('style.load', install)
    map.on('error', error)
    map.on('resize', scheduleFit)
    map.on('movestart', stopFollowing)
    const stopCoverListener = onMapCoveredBottomChange(map, scheduleFit)
    const panelsObserver = new MutationObserver(scheduleFit)
    panelsObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-map-target-visible-height'],
    })
    install()
    return () => {
      map.off('style.load', install)
      map.off('error', error)
      map.off('resize', scheduleFit)
      map.off('movestart', stopFollowing)
      stopCoverListener()
      panelsObserver.disconnect()
      cancelAnimationFrame(frame)
      ids.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
      })
    }
    // Opacity has its own paint-only effect so moving the slider never refits the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, item, onError, workspace?.root])
  useEffect(() => {
    if (!map || !isLoaded || !item) return
    item.assets.forEach((_, i) => {
      const id = `shared-raster-${i}`
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', opacity / 100)
    })
  }, [map, isLoaded, item, opacity])
  return null
}
