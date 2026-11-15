import { useMemo } from 'react'
import type * as MapLibreGL from 'maplibre-gl'

import { MapPopup, useMap } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { formatDecimalDegrees } from '@/lib/geo/coordinateFormat'
import { groupWhatsHere, type SourceSpecLike, type WhatsHereFeature, type WhatsHereGroup } from '@/lib/geo/whatsHere'

/** How far round the point to look, in pixels, so a thin line or a small dot can be hit. */
const PICK_RADIUS_PX = 4

/** Every feature drawn within a few pixels of a map point, grouped for the card. */
export function queryWhatsHere(map: MapLibreGL.Map, x: number, y: number): WhatsHereGroup[] {
  const features = map.queryRenderedFeatures([
    [x - PICK_RADIUS_PX, y - PICK_RADIUS_PX],
    [x + PICK_RADIUS_PX, y + PICK_RADIUS_PX],
  ])
  const sources = (map.getStyle()?.sources ?? {}) as Record<string, SourceSpecLike>
  return groupWhatsHere(features, sources)
}

/**
 * The *What's here?* card from the map menu: everything drawn at the point, one section per layer,
 * with the basemap's own features folded at the end. It is read once when opened and does not
 * follow later changes to the layers.
 */
export function MapWhatsHere({
  point,
  onClose,
}: {
  point: { lng: number; lat: number; x: number; y: number }
  onClose: () => void
}) {
  const { map } = useMap()
  const groups = useMemo(() => (map ? queryWhatsHere(map, point.x, point.y) : []), [map, point])
  const pageGroups = groups.filter((group) => !group.basemap)
  const basemap = groups.find((group) => group.basemap)

  return (
    <MapPopup longitude={point.lng} latitude={point.lat} onClose={onClose} closeOnClick={false} maxWidth="none">
      <MapPopupCard
        eyebrow={formatDecimalDegrees(point.lng, point.lat)}
        title="What’s here"
        onClose={onClose}
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <div className="max-h-72 space-y-3 overflow-y-auto overscroll-contain pr-1" data-testid="map-whats-here">
          {pageGroups.length === 0 && (
            <p className="text-xs text-muted-foreground">None of this map’s own layers draw anything at this point.</p>
          )}
          {pageGroups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
                {group.features.length > 1 && <span className="font-normal"> · {group.features.length}</span>}
              </h3>
              <ul className="space-y-1">
                {group.features.map((feature, index) => (
                  <FeatureRow key={feature.key} feature={feature} open={pageGroups.length === 1 && index === 0} />
                ))}
              </ul>
            </section>
          ))}
          {basemap && (
            <details className="group/basemap">
              <summary className="cursor-pointer text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Basemap · {basemap.features.length}
              </summary>
              <ul className="mt-1 space-y-1">
                {basemap.features.map((feature) => (
                  <FeatureRow key={feature.key} feature={feature} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </MapPopupCard>
    </MapPopup>
  )
}

function FeatureRow({ feature, open = false }: { feature: WhatsHereFeature; open?: boolean }) {
  if (feature.rows.length === 0) return <li className="text-xs">{feature.title}</li>
  return (
    <li>
      <details open={open} className="rounded-sm border border-border/60 px-2 py-1">
        <summary className="cursor-pointer truncate text-xs font-medium">{feature.title}</summary>
        <dl className="mt-1 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2 gap-y-0.5 text-2xs leading-4">
          {feature.rows.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="truncate text-muted-foreground" title={key}>
                {key}
              </dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {feature.hiddenRows > 0 && (
          <p className="mt-1 text-2xs text-muted-foreground">
            and {feature.hiddenRows} more attribute{feature.hiddenRows === 1 ? '' : 's'}
          </p>
        )}
      </details>
    </li>
  )
}
