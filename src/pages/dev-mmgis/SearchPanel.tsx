import { useMemo } from 'react'
import { SearchInput, SidebarSection } from '@/components/ui/map-panels'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { effectiveStyle, featureTitle, filteredCollection, type LoadedLayer } from '../dev-data/layerData'
import { matchesSearch, type Mission } from './model'

export function SearchPanel({
  mission,
  getLayer,
  query,
  onQuery,
  filter,
  onFilter,
  onSelect,
}: {
  mission: Mission
  getLayer: (id: string) => LoadedLayer
  query: string
  onQuery: (v: string) => void
  filter: boolean
  onFilter: (v: boolean) => void
  onSelect: (layerId: string, id: string) => void
}) {
  const results = useMemo(
    () =>
      mission.layers
        .filter((l) => l.visible)
        .flatMap((l) => {
          const loaded = getLayer(l.id)
          return filteredCollection(loaded.collection, l, effectiveStyle(l, loaded))
            .features.filter((f) => matchesSearch(f, query))
            .map((f) => ({
              layer: l.id,
              id: f.properties.__devDataId,
              title: featureTitle(f, l, loaded.attributes),
              label: l.label,
            }))
        }),
    [mission.layers, getLayer, query],
  )
  return (
    <>
      <SidebarSection title="Search & query">
        <SearchInput
          icon
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onClear={() => onQuery('')}
          placeholder="Search every visible layer…"
          aria-label="Search mission features"
        />
        <label className="mm-check">
          <input type="checkbox" checked={filter} onChange={(e) => onFilter(e.target.checked)} />
          Filter map and table to these results
        </label>
        <p className="mm-help">
          Search matches all words across feature properties. Layer category filters and mission time apply to these
          results.
        </p>
        <p className="text-xs font-semibold" role="status">
          {results.length.toLocaleString()} matching features
        </p>
      </SidebarSection>
      <VirtualResultList items={results} getKey={(v) => v.id} estimateSize={65} label="Mission search results">
        {(v) => (
          <button className="mm-search-result" onClick={() => onSelect(v.layer, v.id)}>
            <strong>{v.title}</strong>
            <span>{v.label}</span>
          </button>
        )}
      </VirtualResultList>
    </>
  )
}
