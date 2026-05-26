import { useMemo, useState } from 'react'
import { Droplets, X } from 'lucide-react'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import {
  SEWAGE_ATTRIBUTES,
  SEWAGE_CENTER,
  SEWAGE_DEFAULT_ZOOM,
  attributeDomain,
  radiusFor,
  siteFeatures,
} from './dev-interact-sewage/data'
import type { SewageAttributeId, SewageSite } from './dev-interact-sewage/data'
import { SewageLegend } from './dev-interact-sewage/SewageLegend'

function DevInteractSewage() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [attribute, setAttribute] = useState<SewageAttributeId>('pfas')
  const [visible, setVisible] = useState(true)
  const [selected, setSelected] = useState<SewageSite | null>(null)

  const activeAttribute = SEWAGE_ATTRIBUTES.find((item) => item.id === attribute) ?? SEWAGE_ATTRIBUTES[0]
  const domain = useMemo(() => attributeDomain(attribute), [attribute])

  const sidebar = (
    <aside className="flex h-full w-full flex-col bg-background/95 md:w-[320px] md:border-r md:shadow-xl">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <Droplets className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Sewage &amp; PFAS sites</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Felt-style proportional-circle point layer with a graduated-circle legend.
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Size circles by</div>
          <div className="grid grid-cols-2 gap-1">
            {SEWAGE_ATTRIBUTES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAttribute(item.id)}
                aria-pressed={item.id === attribute}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                  item.id === attribute
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <h2 className="mb-2 text-sm font-semibold">Legend</h2>
          <div role="list">
            <SewageLegend
              caption={activeAttribute.caption}
              color={activeAttribute.color}
              domain={domain}
              visible={visible}
              onToggleVisible={() => setVisible((current) => !current)}
            />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Circle area is proportional to the value. Click a site for details.
          </p>
        </section>

        <section className="border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Sites" value={String(siteFeatures.features.length)} />
            <Stat label="Layer" value={visible ? 'On' : 'Off'} />
          </div>
        </section>
      </div>
    </aside>
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={320}
      mobileInitialSheetState="collapsed"
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{siteFeatures.features.length} monitoring sites</div>
          <div className="truncate text-[11px] text-muted-foreground">{activeAttribute.caption}</div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={SEWAGE_CENTER} zoom={SEWAGE_DEFAULT_ZOOM}>
          <MapControls position="top-right" className="top-16 md:top-2" />

          {visible &&
            siteFeatures.features.map((site) => {
              const value = site.properties[attribute]
              const radius = radiusFor(value, domain, 4, 30)
              const isSelected = selected?.properties.id === site.properties.id
              const [lng, lat] = site.geometry.coordinates
              return (
                <MapMarker key={site.properties.id} longitude={lng} latitude={lat}>
                  <MarkerContent>
                    <button
                      type="button"
                      aria-label={`${site.properties.name} — ${site.properties.properties[0].value}`}
                      onClick={() => setSelected(site)}
                      className={cn(
                        'rounded-full border border-white shadow transition-transform hover:scale-110',
                        isSelected && 'ring-2 ring-sky-400',
                      )}
                      style={{
                        width: radius * 2,
                        height: radius * 2,
                        backgroundColor: activeAttribute.color,
                        opacity: isSelected ? 0.95 : 0.78,
                      }}
                    />
                  </MarkerContent>
                </MapMarker>
              )
            })}

          {selected && (
            <MapPopup
              longitude={selected.geometry.coordinates[0]}
              latitude={selected.geometry.coordinates[1]}
              onClose={() => setSelected(null)}
              closeButton={false}
            >
              <SitePopup site={selected} onClose={() => setSelected(null)} />
            </MapPopup>
          )}
        </Map>
      </div>
    </MapSectionLayout>
  )
}

function SitePopup({ site, onClose }: { site: SewageSite; onClose: () => void }) {
  return (
    <div className="w-60 overflow-hidden rounded-md bg-popover text-popover-foreground">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">Monitoring site</div>
          <div className="mt-0.5 truncate text-sm font-semibold">{site.properties.name}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close popup">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-3 py-1">
        {site.properties.properties.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border/70 py-1.5 text-sm last:border-b-0">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="min-w-0 truncate font-medium text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  )
}

export default DevInteractSewage
