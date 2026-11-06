import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Map, MapClusterLayer, MapPopup, MapScaleBar, useMap } from '@/components/ui/map'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { MapTableBridge, defineTableSource, useMapTable, type MapTableController } from '@/components/map/useMapTable'
import { Button } from '@/components/ui/button'
import {
  KeyValueRows,
  LegendItem,
  MapLegendPanel,
  MapOverlay,
  MapSidebarShell,
  SearchInput,
} from '@/components/ui/map-panels'
import { MobileFeatureCard, ResponsiveFeatureDetail } from '@/components/ui/mobile-feature-card'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink } from '@/components/ui/text-button'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { useFlyToSelection } from '@/components/ui/map-fly-to'
import { DATASETS } from '@/lib/dataCatalog'
import { formatDate, formatNumber } from '@/lib/format'
import {
  filterSites,
  loadRemediation,
  REMEDIATION_ARCGIS,
  REMEDIATION_CATALOGUE,
  type Site,
  type SiteCollection,
} from './data'

const EMPTY: SiteCollection = { type: 'FeatureCollection', features: [] }
const SITE_COLOR = '#d97706'
const SITE_RECORDS_URL =
  'https://www2.gov.bc.ca/gov/content/environment/air-land-water/site-remediation/site-information'

const siteTitle = (site: Site) => site.properties.name || `Site ${site.properties.siteId}`
const siteRowId = (site: Site) => String(site.properties.siteId)

const SITE_COLUMNS = [
  textColumn<Site>('name', 'Name', siteTitle, { width: 240 }),
  textColumn<Site>('address', 'Address', (site) => site.properties.address, { width: 220 }),
  numberColumn<Site>('siteId', 'Site ID', (site) => site.properties.siteId, { format: String, width: 100 }),
  textColumn<Site>('victoriaFile', 'Victoria file', (site) => site.properties.victoriaFile),
  textColumn<Site>('regionalFile', 'Regional file', (site) => site.properties.regionalFile),
  textColumn<Site>('description', 'Location notes', (site) => site.properties.description, { width: 320 }),
]

function SiteDetails({ site }: { site: Site }) {
  const p = site.properties
  return (
    <div className="space-y-2 text-xs">
      <p className="font-semibold">{siteTitle(site)}</p>
      <p>{p.address || 'No address provided'}</p>
      <KeyValueRows
        rows={[
          { label: 'Registry site ID', value: p.siteId },
          { label: 'Victoria file', value: p.victoriaFile || 'Not provided' },
          { label: 'Regional file', value: p.regionalFile || 'Not provided' },
        ]}
      />
      <p className="text-muted-foreground">{p.description || 'No location notes provided.'}</p>
      <ExternalLink href={SITE_RECORDS_URL}>How to obtain site records</ExternalLink>
    </div>
  )
}

function SiteMap({
  collection,
  selected,
  table,
  onSelect,
}: {
  collection: SiteCollection
  selected: Site | null
  table: MapTableController
  onSelect: (site: Site | null) => void
}) {
  const { map } = useMap()
  useFlyToSelection(
    selected ? { longitude: selected.geometry.coordinates[0], latitude: selected.geometry.coordinates[1] } : null,
    { zoom: 15 },
  )
  return (
    <>
      <MapTableBridge table={table} />
      <MapClusterLayer
        data={collection}
        pointColor={SITE_COLOR}
        clusterColors={['#b45309', '#92400e', '#78350f']}
        clusterThresholds={[50, 500]}
        onPointClick={onSelect}
      />
      <MapOverlay position="top-left" className="top-16 flex gap-2 p-2 md:top-3">
        {table.button}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onSelect(null)
            map?.fitBounds(
              [
                [-139.1, 48.2],
                [-114, 60.1],
              ],
              { padding: 45, duration: 700 },
            )
          }}
        >
          All BC
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onSelect(null)
            map?.flyTo({ center: [-122.75, 53.915], zoom: 11 })
          }}
        >
          Prince George
        </Button>
      </MapOverlay>
      <MapScaleBar position="bottom-left" />
      <MapLegendPanel title="Legend" width="sm" defaultCollapsed="mobile" collapsible>
        <div className="space-y-1 text-xs">
          <LegendItem color={SITE_COLOR} label="Registry site location" active />
          <p className="text-muted-foreground">
            Numbered circles group nearby sites. Click a cluster to zoom or a site for details.
          </p>
        </div>
      </MapLegendPanel>
      {selected && (
        <ResponsiveFeatureDetail
          card={
            <MobileFeatureCard
              cardKey={selected.properties.siteId}
              title={siteTitle(selected)}
              subtitle="Remediation registry site"
              onClose={() => onSelect(null)}
            >
              <SiteDetails site={selected} />
            </MobileFeatureCard>
          }
          popup={
            <MapPopup
              longitude={selected.geometry.coordinates[0]}
              latitude={selected.geometry.coordinates[1]}
              closeButton
              onClose={() => onSelect(null)}
              className="max-w-xs"
            >
              <SiteDetails site={selected} />
            </MapPopup>
          }
        />
      )}
    </>
  )
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
    loadRemediation(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Unable to load remediation data.')
      })
    return () => controller.abort()
  }, [attempt])
  const collection = useMemo(() => filterSites(data?.collection ?? EMPTY, deferredSearch), [data, deferredSearch])
  const loading = !data && !error
  const selectSite = useCallback((site: Site) => setSelected(site), [])
  const tableSources = useMemo(
    () =>
      data
        ? [
            defineTableSource<Site>({
              id: 'remediation-sites',
              label: 'Remediation sites',
              color: SITE_COLOR,
              shape: 'point',
              rows: collection.features,
              columns: SITE_COLUMNS,
              getRowId: siteRowId,
              getRowCenter: (site) => site.geometry.coordinates as [number, number],
            }),
          ]
        : [],
    [collection, data],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selected ? siteRowId(selected) : null,
    onSelectRow: selectSite,
    // SiteMap flies to the selection, which also covers a click on a point.
    flyOnSelect: false,
    inlineButton: true,
  })
  const searching = deferredSearch.trim().length > 0
  const sidebar = (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title="Environmental Remediation Sites"
      subtitle="BC registry locations · provincial snapshot"
      dataset={data ? { ...DATASETS.remediation, license: data.manifest.license } : DATASETS.remediation}
    >
      <div className="space-y-4 p-4">
        <p className="text-xs text-muted-foreground">
          Known and potentially contaminated properties. A registry listing does not establish current contamination;
          points are locations, not contamination boundaries.
        </p>
        {(loading || error) && <ListState loading={loading} loadingLabel="Loading provincial sites…" error={error} />}
        {error && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null)
              setAttempt((value) => value + 1)
            }}
          >
            Retry
          </Button>
        )}
        {data && (
          <>
            <StatGroup
              variant="tiles"
              size="sm"
              columns={2}
              items={[
                { label: 'BC sites', value: formatNumber(data.manifest.featureCount) },
                { label: 'Search matches', value: formatNumber(collection.features.length) },
              ]}
            />
            <SearchInput
              icon
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setSelected(null)
              }}
              onClear={() => {
                setSearch('')
                setSelected(null)
              }}
              placeholder="Name, address, site ID or file number"
              aria-label="Find a site"
            />
            {selected && (
              <section className="rounded border border-border p-3" aria-label="Selected site">
                <SiteDetails site={selected} />
                <Button className="mt-3" size="sm" variant="outline" onClick={() => setSelected(null)}>
                  Clear selection
                </Button>
              </section>
            )}
            {searching && (
              <section aria-label="Search results">
                <ListState empty={collection.features.length === 0} emptyLabel="No sites match this search.">
                  <ListHeader sticky={false} count={collection.features.length} noun={['match', 'matches']} />
                  <VirtualResultList
                    items={collection.features}
                    getKey={siteRowId}
                    estimateSize={68}
                    label="Search results"
                  >
                    {(site) => (
                      <ResultRow
                        title={siteTitle(site)}
                        subtitle={`Site ${site.properties.siteId} · ${site.properties.address || 'No address'}`}
                        selected={selected?.properties.siteId === site.properties.siteId}
                        onClick={() => setSelected(site)}
                      />
                    )}
                  </VirtualResultList>
                </ListState>
              </section>
            )}
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                Retrieved {formatDate(data.manifest.downloadedAt)} · {data.manifest.license}. Province of British
                Columbia · Site Registry. No parcel join has been applied.
              </p>
              <ExternalLink href={REMEDIATION_CATALOGUE}>Official catalogue</ExternalLink>{' '}
              <ExternalLink href={REMEDIATION_ARCGIS}>Source layer and fields</ExternalLink>
            </div>
          </>
        )}
      </div>
    </MapSidebarShell>
  )
  return (
    <MapSectionLayout
      sidebar={sidebar}
      table={table}
      mobilePeekTitle="Remediation sites"
      mobilePeekSubtitle={
        data ? `${formatNumber(collection.features.length)} BC search matches` : 'Provincial snapshot'
      }
    >
      <Map center={[-124.5, 54.5]} zoom={4.6} loading={loading} deferResize={table.deferResize}>
        <SiteMap collection={collection} selected={selected} table={table} onSelect={setSelected} />
      </Map>
    </MapSectionLayout>
  )
}
