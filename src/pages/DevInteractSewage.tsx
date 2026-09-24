import { useMemo, useState } from 'react'
import { Droplets } from 'lucide-react'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import {
  KeyValueRows,
  MapLegendNote,
  MapLegendPanel,
  MapSidebarShell,
  SidebarSection,
} from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
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
  const [attribute, setAttribute] = useState<SewageAttributeId>('pfas')
  const [visible, setVisible] = useState(true)
  const [selected, setSelected] = useState<SewageSite | null>(null)

  const activeAttribute = SEWAGE_ATTRIBUTES.find((item) => item.id === attribute) ?? SEWAGE_ATTRIBUTES[0]
  const domain = useMemo(() => attributeDomain(attribute), [attribute])

  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Sewage & PFAS sites"
      subtitle="Felt-style proportional-circle point layer with a graduated-circle legend."
      icon={Droplets}
    >
      <SidebarSection title="Size circles by">
        <SegmentedControl<SewageAttributeId>
          label="Size circles by"
          value={attribute}
          options={SEWAGE_ATTRIBUTES.map((item) => ({ value: item.id, label: item.label }))}
          onChange={setAttribute}
        />
      </SidebarSection>

      <SidebarSection>
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'Sites', value: String(siteFeatures.features.length) },
            { label: 'Layer', value: visible ? 'On' : 'Off' },
          ]}
        />
      </SidebarSection>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      desktopSidebarWidth={320}
      mobileInitialSheetState="collapsed"
      mobilePeekTitle={`${siteFeatures.features.length} monitoring sites`}
      mobilePeekSubtitle={activeAttribute.caption}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map
          center={SEWAGE_CENTER}
          zoom={SEWAGE_DEFAULT_ZOOM}
          controls={<MapControls position="top-right" className="top-16 md:top-2" />}
        >

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

          <MapLegendPanel title="Legend" collapsible defaultCollapsed="mobile">
            <div role="list">
              <SewageLegend
                caption={activeAttribute.caption}
                color={activeAttribute.color}
                domain={domain}
                visible={visible}
                onToggleVisible={() => setVisible((current) => !current)}
              />
            </div>
            <MapLegendNote className="mt-2 px-0">
              Circle area is proportional to the value. Click a site for details.
            </MapLegendNote>
          </MapLegendPanel>
        </Map>
      </div>
    </MapSectionLayout>
  )
}

function SitePopup({ site, onClose }: { site: SewageSite; onClose: () => void }) {
  return (
    <MapPopupCard
      className="w-56"
      eyebrow="Monitoring site"
      title={site.properties.name}
      onClose={onClose}
      closeLabel="Close popup"
    >
      <KeyValueRows
        variant="divided"
        rows={site.properties.properties.map((row) => ({ key: row.label, label: row.label, value: row.value }))}
      />
    </MapPopupCard>
  )
}

export default DevInteractSewage
