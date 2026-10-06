import { useLayoutEffect } from 'react'
import { useTheme } from 'next-themes'
import type MapLibreGL from 'maplibre-gl'
import type { NativeWebMap } from './adapters/arcgisWebMap'
import type { EditorialBasemap } from './editorialBasemap'

/** Paint-only theme changes preserve the current camera, features, and canvas. */
const lightPaint: Record<string, Record<string, string>> = {
  background: { 'background-color': '#f4f5f2' },
  parks: { 'fill-color': '#e2e8df' },
  water: { 'fill-color': '#cbd8dc' },
  waterways: { 'line-color': '#cbd8dc' },
  roads: { 'line-color': '#c0c6c5' },
  buildings: { 'fill-color': '#e2e5e2', 'fill-outline-color': '#bcc3c0' },
  boundaries: { 'line-color': '#899391' },
  'road-labels': { 'text-color': '#4b5554', 'text-halo-color': '#f4f5f2' },
  'place-labels': { 'text-color': '#3c4846', 'text-halo-color': '#f4f5f2' },
}

/** Theme the incoming style before setStyle can paint a charcoal frame. */
export function editorialStyleForTheme(style: MapLibreGL.StyleSpecification, theme: string | undefined) {
  if (theme === 'dark') return style
  const themed = structuredClone(style)
  for (const [name, paint] of Object.entries(lightPaint)) {
    const layer = themed.layers.find((layer) => layer.id === `pgmaps-story-${name}`)
    if (layer) layer.paint = { ...layer.paint, ...paint } as typeof layer.paint
  }
  return themed
}

export function useEditorialBasemapTheme(
  map: MapLibreGL.Map | null,
  document: NativeWebMap | null,
  basemap: EditorialBasemap,
) {
  const { resolvedTheme } = useTheme()
  useLayoutEffect(() => {
    if (!map || !document || basemap !== 'pgmaps') return
    const apply = () => {
      for (const [name, paint] of Object.entries(lightPaint)) {
        const id = `pgmaps-story-${name}`
        if (!map.getLayer(id)) continue
        const original = document.style.layers.find((layer) => layer.id === id)?.paint as
          | Record<string, unknown>
          | undefined
        for (const [property, light] of Object.entries(paint)) {
          const value = resolvedTheme === 'dark' ? original?.[property] : light
          if (value !== undefined && map.getPaintProperty(id, property) !== value)
            map.setPaintProperty(id, property, value)
        }
      }
    }
    // styledata also covers chapter style diffs; equality guards prevent a paint-event loop.
    map.on('styledata', apply)
    apply()
    return () => {
      map.off('styledata', apply)
    }
  }, [map, document, basemap, resolvedTheme])
}
