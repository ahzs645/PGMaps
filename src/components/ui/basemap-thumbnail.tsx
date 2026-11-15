import { useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'

import { PG_CENTER } from '@/components/ui/map-styles'
import { basemapThumbnailUrl, THUMBNAIL_ZOOM } from '@/lib/geo/basemapThumbnail'

/**
 * A basemap's name with a small picture of it: one tile over Prince George, so the choices in a
 * Layers control can be told apart before one is applied. Pass it as a `MapLayersControl` basemap
 * `label`; the accessible name stays the text. `tiles` is an XYZ template, or one per theme for a
 * basemap that follows light and dark. A tile that fails to load leaves the name alone.
 */
export function BasemapThumbnailLabel({
  label,
  tiles,
  center = PG_CENTER,
}: {
  label: ReactNode
  tiles: string | { light: string; dark: string }
  center?: readonly [number, number]
}) {
  const { resolvedTheme } = useTheme()
  const [failed, setFailed] = useState(false)
  const template = typeof tiles === 'string' ? tiles : resolvedTheme === 'dark' ? tiles.dark : tiles.light
  return (
    <span className="flex items-center gap-2">
      {!failed && (
        <img
          src={basemapThumbnailUrl(template, center[0], center[1], THUMBNAIL_ZOOM)}
          alt=""
          width={40}
          height={28}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-7 w-10 shrink-0 rounded-sm border border-border object-cover"
          data-basemap-thumbnail=""
        />
      )}
      <span>{label}</span>
    </span>
  )
}
