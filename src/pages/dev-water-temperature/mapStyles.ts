import { useEffect, useMemo, useState } from 'react'
import type { StyleSpecification } from 'maplibre-gl'
import { buildBasemapStyle, MAP_STYLES, type BasemapAppearance } from '@/components/ui/map-styles'

export type StationBasemap = 'reference' | 'imagery' | 'pgmaps' | 'none'

// Match the reference's white backdrop and 50%-opacity raster tiles.
function rasterStyle(tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { basemap: { type: 'raster', tiles, tileSize: 256, attribution, maxzoom: 19 } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.5 } },
    ],
  }
}

const reference = rasterStyle(
  [
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ],
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
)
const imagery = rasterStyle(
  ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
)
const blank: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }],
}

// PG Maps host presets: the light palette matches /dev/design's shared basemap capture.
const light: BasemapAppearance = {
  backgroundColor: '#f8fafc',
  waterColor: '#bae6fd',
  landcoverColor: '#dcfce7',
  buildingColor: '#e2e8f0',
  countryBoundaryColor: '#94a3b8',
  otherBoundaryColor: '#94a3b8',
  roadColor: '#ffffff',
  labelColor: '#2563eb',
  labelHaloColor: '#f8fafc',
  showWater: true,
  showLandcover: true,
  showCountryBoundaries: true,
  showOtherBoundaries: true,
  showLabels: true,
}
const dark: BasemapAppearance = {
  ...light,
  backgroundColor: '#0f172a',
  waterColor: '#164e63',
  landcoverColor: '#14532d',
  buildingColor: '#334155',
  countryBoundaryColor: '#64748b',
  otherBoundaryColor: '#475569',
  roadColor: '#334155',
  labelColor: '#cbd5e1',
  labelHaloColor: '#0f172a',
}

/** Transport is host-owned; the toolkit only transforms the supplied style. */
export function useStationMapStyles(basemap: StationBasemap) {
  const [base, setBase] = useState<{ light: StyleSpecification; dark: StyleSpecification } | null>(null)
  useEffect(() => {
    if (basemap !== 'pgmaps' || base) return
    const controller = new AbortController()
    const load = async () => {
      try {
        const responses = await Promise.all(
          [MAP_STYLES.light, MAP_STYLES.dark].map((url) => fetch(url, { signal: controller.signal })),
        )
        if (responses.some((response) => !response.ok)) return
        const [light, dark] = await Promise.all(
          responses.map((response) => response.json() as Promise<StyleSpecification>),
        )
        if (!controller.signal.aborted) setBase({ light, dark })
      } catch {
        // Keep the shared Carto fallback usable if the style service is unavailable.
      }
    }
    void load()
    return () => controller.abort()
  }, [basemap, base])
  return useMemo(() => {
    if (basemap === 'pgmaps')
      return base
        ? { light: buildBasemapStyle(base.light, light), dark: buildBasemapStyle(base.dark, dark) }
        : MAP_STYLES
    const style = basemap === 'reference' ? reference : basemap === 'imagery' ? imagery : blank
    return { light: style, dark: style }
  }, [basemap, base])
}
