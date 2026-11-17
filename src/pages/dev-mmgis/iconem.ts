import { xyzTileTemplate } from '@pgmaps/geo-toolkit/map'
import type { Camera } from './model'

export const WAYBACK_CATALOG = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json'

export interface WaybackRelease {
  id: string
  date: string
  tiles: string
  itemUrl?: string
}

export function waybackReleases(catalog: unknown): WaybackRelease[] {
  const releases: WaybackRelease[] = []
  if (catalog && typeof catalog === 'object' && !Array.isArray(catalog)) {
    for (const [id, item] of Object.entries(catalog)) {
      if (!/^\d+$/.test(id) || typeof item?.itemTitle !== 'string' || typeof item.itemURL !== 'string') continue
      const date = /^World Imagery \(Wayback (\d{4}-\d{2}-\d{2})\)$/.exec(item.itemTitle)?.[1]
      if (
        !date ||
        !Number.isFinite(Date.parse(date)) ||
        !item.itemURL.startsWith('https://wayback.maptiles.arcgis.com/')
      )
        continue
      try {
        const itemUrl =
          typeof item.itemID === 'string' && /^[0-9a-f]{32}$/i.test(item.itemID)
            ? `https://www.arcgis.com/home/item.html?id=${item.itemID}`
            : undefined
        releases.push({ id, date, tiles: xyzTileTemplate(item.itemURL), itemUrl })
      } catch {
        // A catalog may contain entries without a usable tile template.
      }
    }
  }
  if (!releases.length) throw new Error('Esri returned no usable Wayback releases.')
  return releases.sort((a, b) => b.date.localeCompare(a.date))
}

export function iconemViewUrl(camera: Camera, mode: 'terrain' | 'historical', date?: string): string {
  const url = new URL('https://terrain-viewer.iconem.com/')
  const [lng, lat] = camera.center
  const historical = mode === 'historical'
  const params = new URLSearchParams({
    appMode: mode,
    viewMode: historical ? '2d' : '3d',
    lng: String(lng),
    lat: String(lat),
    zoom: String(camera.zoom),
    bearing: String(camera.bearing),
    pitch: historical ? '0' : String(camera.pitch),
  })
  if (historical) {
    params.set('basemapSourceA', 'historical')
    params.set('historicalActiveSourceA', 'wayback')
    if (date) params.set('dateA', String(Date.parse(date)))
  } else {
    params.set('terrainSourceA', 'aws')
    params.set('showHillshade', 'true')
  }
  url.search = params.toString()
  return url.href
}
