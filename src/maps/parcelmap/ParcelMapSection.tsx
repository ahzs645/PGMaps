import { useEffect, useState } from 'react'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Map, MapPopup, useMap } from '@/components/ui/map'
import { MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { LegendItem, MapOverlay, MapSidebarShell } from '@/components/ui/map-panels'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { useIsMobile } from '@/hooks/useIsMobile'
import { escapeHtml } from '@/lib/escapeHtml'
import { fetchJson } from '@/lib/fetchJson'

const BASE = 'https://data.map.ahmad.sh/bc/parcelmap/v1/'
const BUTTON = 'rounded border border-border px-3 py-2 text-xs font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary'

type ParcelManifest = {
  schemaVersion: number
  layer: string
  featureCount: number
  resource: string
  pmtilesSha256: string
  sourceLastModified: string
  scope: string
}

type SelectedParcel = {
  id: number
  lng: number
  lat: number
  properties: Record<string, unknown>
}

function property(properties: Record<string, unknown>, name: string): string {
  const value = properties[name]
  return value == null || value === '' ? 'Not provided' : String(value)
}

function ParcelDetails({ parcel }: { parcel: SelectedParcel }) {
  return <div className="space-y-2 text-xs">
    <p className="font-semibold">Parcel {parcel.id}</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
      <dt className="text-muted-foreground">PID</dt><dd>{property(parcel.properties, 'PID')}</dd>
      <dt className="text-muted-foreground">Owner category</dt><dd>{property(parcel.properties, 'OWNER_TYPE')}</dd>
      <dt className="text-muted-foreground">Regional district</dt><dd>{property(parcel.properties, 'REGIONAL_DISTRICT')}</dd>
      <dt className="text-muted-foreground">Class</dt><dd>{property(parcel.properties, 'PARCEL_CLASS')}</dd>
      <dt className="text-muted-foreground">Status</dt><dd>{property(parcel.properties, 'PARCEL_STATUS')}</dd>
    </dl>
  </div>
}

function ParcelMap({ manifest, selected, onSelect }: { manifest: ParcelManifest; selected: SelectedParcel | null; onSelect: (parcel: SelectedParcel | null) => void }) {
  const { map } = useMap()
  const mobile = useIsMobile()
  return <>
    <MapPmtilesFillLayer
      url={BASE + manifest.resource}
      sourceLayer={manifest.layer}
      idSource="feature"
      fillColor="#0f766e"
      fillOpacity={0.48}
      lineColor="#115e59"
      lineWidth={0.6}
      lineOpacity={0.8}
      selectedId={selected?.id}
      selectionColor="#f97316"
      selectionWidth={2.5}
      onFeatureClick={(id, _event, properties, lngLat) => {
        const numericId = Number(id)
        if (Number.isFinite(numericId) && lngLat) onSelect({ id: numericId, properties, lng: lngLat.lng, lat: lngLat.lat })
      }}
      hoverHtml={(properties) => `<strong>${escapeHtml(property(properties, 'OWNER_TYPE'))}</strong><br>PID ${escapeHtml(property(properties, 'PID'))}`}
    />
    <MapOverlay position="top-left" className="top-16 flex gap-2 p-2 md:top-3">
      <button className={BUTTON} onClick={() => { onSelect(null); map?.flyTo({ center: [-122.75, 53.915], zoom: 10 }) }}>Prince George</button>
      <button className={BUTTON} onClick={() => { onSelect(null); map?.flyTo({ center: [-123.12, 49.28], zoom: 10 }) }}>Vancouver</button>
    </MapOverlay>
    {selected && (mobile
      ? <MobileFeatureCard cardKey={selected.id} title={`Parcel ${selected.id}`} subtitle="Initial public-land screen" onClose={() => onSelect(null)}><ParcelDetails parcel={selected} /></MobileFeatureCard>
      : <MapPopup longitude={selected.lng} latitude={selected.lat} closeButton onClose={() => onSelect(null)} className="max-w-xs"><ParcelDetails parcel={selected} /></MapPopup>)}
  </>
}

export function ParcelMapSection() {
  const [manifest, setManifest] = useState<ParcelManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SelectedParcel | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchJson<ParcelManifest>(BASE + 'public-land-candidates-pmtiles.json', controller.signal).then((result) => {
      if (result.schemaVersion !== 1 || result.layer !== 'candidate_parcels' || !Number.isSafeInteger(result.featureCount) || result.featureCount <= 0 || !/^[a-f0-9]{64}$/.test(result.pmtilesSha256) || result.resource !== 'public-land-candidates.pmtiles') {
        throw new Error('Unrecognized ParcelMap release manifest.')
      }
      if (!controller.signal.aborted) setManifest(result)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load ParcelMap release.')
    })
    return () => controller.abort()
  }, [attempt])

  const sidebar = <MapSidebarShell className={MAP_SIDEBAR_CLASS} title="ParcelMap public-land screen" subtitle="ParcelMap BC · initial research screen">
    <div className="space-y-4 p-4 text-xs">
      <p>Parcel boundaries passing the first public ownership and reserve/park exclusion stage. These are research candidates, not verified available land or housing-suitable sites.</p>
      {!manifest && !error && <p role="status">Loading ParcelMap release…</p>}
      {error && <div role="alert" className="space-y-2"><p>{error}</p><button className={BUTTON} onClick={() => { setError(null); setAttempt((value) => value + 1) }}>Retry</button></div>}
      {manifest && <>
        <div className="rounded border border-border p-3"><p className="text-muted-foreground">Screened parcels</p><strong className="text-base">{manifest.featureCount.toLocaleString()}</strong></div>
        <LegendItem color="#0f766e" label="Initial candidate parcel" active />
        <p className="text-muted-foreground">Zoom in to see parcel outlines, then select one for its PID, owner category and region. National parks and other masks were used in the screen; this layer does not establish current ownership or development feasibility.</p>
        {selected && <section aria-label="Selected parcel" className="space-y-2 rounded border border-border p-3"><ParcelDetails parcel={selected} /><button className={BUTTON} onClick={() => setSelected(null)}>Clear selection</button></section>}
        <details open><summary className="cursor-pointer font-medium">Source and methods</summary><div className="mt-2 space-y-2 text-muted-foreground"><p>{manifest.scope}</p><p>ParcelMap BC polygons, source archive last modified {new Date(manifest.sourceLastModified).toLocaleDateString('en-CA')}. Uses the source regional-district attribute; no spatial join to shared administrative boundaries.</p><a className="block underline" href="https://catalogue.data.gov.bc.ca/dataset/2f4117d9-41fc-44db-87d4-dbdb77f14086" target="_blank" rel="noreferrer">Official ParcelMap catalogue</a></div></details>
      </>}
    </div>
  </MapSidebarShell>

  return <MapSectionLayout sidebar={sidebar} mobilePeekTitle="ParcelMap candidates" mobilePeekSubtitle={manifest ? `${manifest.featureCount.toLocaleString()} screened parcels` : 'Initial public-land screen'}>
    <Map center={[-122.75, 53.915]} zoom={10} loading={!manifest && !error}>
      {manifest && <ParcelMap manifest={manifest} selected={selected} onSelect={setSelected} />}
    </Map>
  </MapSectionLayout>
}
