import { useEffect, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Popup, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { KeyValueRows } from '@/components/ui/map-panels'
import { record, type NativeWebMap } from './adapters/arcgisWebMap'
import { featurePopupPlans, featurePopupUrl, popupContent } from './adapters/featurePopup'

/** Preserve authored feature details without fetching every popup field for the whole viewport. */
export function useNativeFeaturePopups(
  map: MapLibreMap | null,
  document: NativeWebMap | null,
  enabled: boolean,
  acceptPoint?: (x: number, width: number) => boolean,
  displayMap?: MapLibreMap | null,
) {
  const acceptPointRef = useRef(acceptPoint)
  useEffect(() => {
    acceptPointRef.current = acceptPoint
  }, [acceptPoint])
  useEffect(() => {
    if (!map || !document || !enabled) return
    const plans = featurePopupPlans(document)
    if (!plans.length) return
    let disposed = false
    let request: AbortController | undefined
    let popup: Popup | undefined
    let reactRoot: Root | undefined
    const close = () => {
      request?.abort()
      request = undefined
      const current = popup
      popup = undefined
      current?.remove()
      const content = reactRoot
      reactRoot = undefined
      if (content) queueMicrotask(() => content.unmount())
    }
    const click = (event: MapMouseEvent) => {
      if (acceptPointRef.current && !acceptPointRef.current(event.point.x, map.getContainer().clientWidth)) {
        close()
        return
      }
      const ids = plans.map((plan) => plan.id).filter((id) => map.getLayer(id))
      if (!ids.length) return
      const hit = map
        .queryRenderedFeatures(event.point, { layers: ids })
        .find((feature) => plans.some((plan) => plan.id === feature.layer.id))
      close()
      if (!hit) return
      const plan = plans.find((plan) => plan.id === hit.layer.id)!
      const url = featurePopupUrl(plan, hit.properties[plan.objectIdField])
      if (!url) return
      const abort = new AbortController()
      request = abort
      const host = window.document.createElement('div')
      host.className = 'rounded-md bg-background p-3 text-foreground'
      host.setAttribute('data-testid', 'editorial-feature-popup')
      const presentationMap = displayMap ?? map
      host.style.overflowY = 'auto'
      host.style.maxHeight = `${Math.max(80, presentationMap.getContainer().clientHeight - 32)}px`
      host.style.maxWidth = `${Math.max(120, presentationMap.getContainer().clientWidth - 32)}px`
      reactRoot = createRoot(host)
      const root = reactRoot
      const render = (title: string, content: ReactNode) =>
        root.render(
          <MapPopupCard title={title} eyebrow={plan.layerTitle} onClose={close}>
            <div className="max-h-64 overflow-auto overscroll-contain">{content}</div>
          </MapPopupCard>,
        )
      render('Feature details', <p role="status">Loading original feature details…</p>)
      popup = new Popup({
        className: 'editorial-feature-popup',
        closeButton: false,
        maxWidth: '320px',
        focusAfterOpen: false,
      })
        .setLngLat(event.lngLat)
        .setDOMContent(host)
        .addTo(displayMap ?? map)
      // React fills the host after MapLibre's initial anchor measurement. Refit
      // when the committed card changes size, including loaded details/fonts.
      let layoutFrame = 0
      const measure = new ResizeObserver(() => {
        cancelAnimationFrame(layoutFrame)
        layoutFrame = requestAnimationFrame(() => {
          if (disposed || abort.signal.aborted) return
          host.style.maxHeight = `${Math.max(80, presentationMap.getContainer().clientHeight - 32)}px`
          host.style.maxWidth = `${Math.max(120, presentationMap.getContainer().clientWidth - 32)}px`
          popup?.setLngLat(event.lngLat)
        })
      })
      measure.observe(host)
      measure.observe(presentationMap.getContainer())
      popup.once('close', () => {
        measure.disconnect()
        cancelAnimationFrame(layoutFrame)
        abort.abort()
        if (reactRoot === root) {
          reactRoot = undefined
          queueMicrotask(() => root.unmount())
        }
      })
      void fetch(url, { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('The source did not return feature details.')
          const result = record(await response.json())
          if (result.error) throw new Error('The source could not retrieve this feature.')
          const feature = Array.isArray(result.features) ? record(result.features[0]) : undefined
          if (!feature) throw new Error('This feature is no longer available from the source.')
          if (disposed || abort.signal.aborted) return
          const content = popupContent(plan, record(feature.attributes))
          render(content.title, <KeyValueRows rows={content.rows} variant="grid" />)
        })
        .catch((error: unknown) => {
          if (!disposed && !abort.signal.aborted)
            render(
              'Feature details',
              <p role="alert">
                {error instanceof Error ? error.message : 'The original feature details are unavailable.'}
              </p>,
            )
        })
    }
    map.on('click', click)
    return () => {
      disposed = true
      map.off('click', click)
      close()
    }
  }, [map, document, enabled, displayMap])
}
