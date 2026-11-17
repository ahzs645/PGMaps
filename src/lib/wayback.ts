import { xyzTileTemplate } from '@pgmaps/geo-toolkit/map'

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

export async function loadWaybackReleases(signal: AbortSignal) {
  const response = await fetch(WAYBACK_CATALOG, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) })
  if (!response.ok) throw new Error(`Esri returned HTTP ${response.status}.`)
  return waybackReleases(await response.json())
}

export function waybackCredit(release: WaybackRelease) {
  return release.itemUrl
    ? `<a href="${release.itemUrl}" target="_blank" rel="noopener noreferrer">Esri Wayback · imagery credits</a>`
    : 'Esri World Imagery Wayback and contributors'
}
