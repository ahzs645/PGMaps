import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Map, MapClusterLayer, MapPopup, useMap } from '@/components/ui/map'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { MapSidebarShell, LegendItem, MapOverlay } from '@/components/ui/map-panels'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useFlyToSelection } from '@/components/ui/map-fly-to'
import { filterSites, loadRemediation, REMEDIATION_ARCGIS, REMEDIATION_CATALOGUE, type Site, type SiteCollection } from './data'

const EMPTY: SiteCollection = { type: 'FeatureCollection', features: [] }
const BUTTON = 'rounded border border-border px-3 py-2 text-xs font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary'

function SiteDetails({ site }: { site: Site }) {
  const p = site.properties
  return <div className="space-y-2 text-xs">
    <p className="font-semibold">{p.name || `Site ${p.siteId}`}</p>
    <p>{p.address || 'No address provided'}</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
      <dt className="text-muted-foreground">Registry site ID</dt><dd>{p.siteId}</dd>
      <dt className="text-muted-foreground">Victoria file</dt><dd>{p.victoriaFile || 'Not provided'}</dd>
      <dt className="text-muted-foreground">Regional file</dt><dd>{p.regionalFile || 'Not provided'}</dd>
    </dl>
    <p className="text-muted-foreground">{p.description || 'No location notes provided.'}</p>
    <a className="block underline" href="https://www2.gov.bc.ca/gov/content/environment/air-land-water/site-remediation/site-information" target="_blank" rel="noreferrer">How to obtain site records</a>
  </div>
}

function SiteMap({ collection, selected, onSelect }: { collection: SiteCollection; selected: Site | null; onSelect: (site: Site | null) => void }) {
  const { map } = useMap()
  const mobile = useIsMobile()
  useFlyToSelection(selected ? { longitude: selected.geometry.coordinates[0], latitude: selected.geometry.coordinates[1] } : null, { zoom: 15 })
  return <>
    <MapClusterLayer data={collection} pointColor="#d97706" clusterColors={['#b45309', '#92400e', '#78350f']} clusterThresholds={[50, 500]} onPointClick={onSelect} />
    <MapOverlay position="top-left" className="top-16 flex gap-2 p-2 md:top-3">
      <button className={BUTTON} onClick={() => { onSelect(null); map?.fitBounds([[-139.1, 48.2], [-114, 60.1]], { padding: 45, duration: 700 }) }}>All BC</button>
      <button className={BUTTON} onClick={() => { onSelect(null); map?.flyTo({ center: [-122.75, 53.915], zoom: 11 }) }}>Prince George</button>
    </MapOverlay>
    {selected && (mobile
      ? <MobileFeatureCard cardKey={selected.properties.siteId} title={selected.properties.name || `Site ${selected.properties.siteId}`} subtitle="Remediation registry site" onClose={() => onSelect(null)}><SiteDetails site={selected} /></MobileFeatureCard>
      : <MapPopup longitude={selected.geometry.coordinates[0]} latitude={selected.geometry.coordinates[1]} closeButton onClose={() => onSelect(null)} className="max-w-xs"><SiteDetails site={selected} /></MapPopup>)}
  </>
}

export function RemediationSection() {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadRemediation>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [selected, setSelected] = useState<Site | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    loadRemediation(controller.signal).then((result) => {
      if (!controller.signal.aborted) setData(result)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load remediation data.')
    })
    return () => controller.abort()
  }, [attempt])
  const collection = useMemo(() => filterSites(data?.collection ?? EMPTY, deferredSearch), [data, deferredSearch])
  const loading = !data && !error
  const sidebar = <MapSidebarShell className={MAP_SIDEBAR_CLASS} title="Environmental Remediation Sites" subtitle="BC registry locations · provincial snapshot">
    <div className="space-y-4 p-4">
      <p className="text-xs text-muted-foreground">Known and potentially contaminated properties. A registry listing does not establish current contamination; points are locations, not contamination boundaries.</p>
      {loading && <p role="status" className="text-sm">Loading provincial sites…</p>}
      {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><button className={BUTTON} onClick={() => { setError(null); setAttempt((value) => value + 1) }}>Retry</button></div>}
      {data && <>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded border border-border p-3"><p className="text-xs text-muted-foreground">BC sites</p><strong>{data.manifest.featureCount.toLocaleString()}</strong></div>
          <div className="rounded border border-border p-3"><p className="text-xs text-muted-foreground">Search matches</p><strong aria-live="polite">{collection.features.length.toLocaleString()}</strong></div>
        </div>
        <label className="block space-y-1 text-xs font-medium">Find a site
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setSelected(null) }} placeholder="Name, address, site ID or file number" className="w-full rounded border border-border bg-background px-3 py-2 text-sm" />
        </label>
        {search && <button className={BUTTON} onClick={() => { setSearch(''); setSelected(null) }}>Clear search</button>}
        <div className="space-y-1 text-xs">
          <LegendItem color="#d97706" label="Registry site location" active />
          <p className="text-muted-foreground">Numbered circles group nearby sites. Click a cluster to zoom or a site for details. Search covers all BC; the location buttons move the map.</p>
        </div>
        {selected && <section className="rounded border border-border p-3" aria-label="Selected site"><SiteDetails site={selected} /><button className={`${BUTTON} mt-3`} onClick={() => setSelected(null)}>Clear selection</button></section>}
        {deferredSearch.trim() && <section aria-label="Search results" className="space-y-2">
          <p className="text-xs text-muted-foreground">{collection.features.length === 0 ? 'No sites match this search.' : `Showing ${Math.min(30, collection.features.length)} of ${collection.features.length.toLocaleString()} matches. Refine your search to narrow the list.`}</p>
          {collection.features.slice(0, 30).map((site) => <button key={site.properties.siteId} onClick={() => setSelected(site)} className="block w-full rounded border border-border p-3 text-left text-xs hover:bg-accent">
            <span className="block font-medium">{site.properties.name || `Site ${site.properties.siteId}`}</span>
            <span className="block text-muted-foreground">Site {site.properties.siteId} · {site.properties.address || 'No address'}</span>
          </button>)}
        </section>}
        <details className="text-xs" open><summary className="cursor-pointer font-medium">Source and snapshot</summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p>Retrieved {new Date(data.manifest.downloadedAt).toLocaleDateString('en-CA')} · {data.manifest.license}</p>
            <p>Province of British Columbia · Site Registry. No parcel join has been applied.</p>
            <a className="block underline" href={REMEDIATION_CATALOGUE} target="_blank" rel="noreferrer">Official catalogue</a>
            <a className="block underline" href={REMEDIATION_ARCGIS} target="_blank" rel="noreferrer">Source layer and fields</a>
          </div>
        </details>
      </>}
    </div>
  </MapSidebarShell>
  return <MapSectionLayout sidebar={sidebar} mobilePeekTitle="Remediation sites" mobilePeekSubtitle={data ? `${collection.features.length.toLocaleString()} BC search matches` : 'Provincial snapshot'}>
    <Map center={[-124.5, 54.5]} zoom={4.6} loading={loading}>
      <SiteMap collection={collection} selected={selected} onSelect={setSelected} />
    </Map>
  </MapSectionLayout>
}
