import { SearchInput, SidebarSection } from '@/components/ui/map-panels'

import type { ExplorerFeature } from './featureTypes'

export function SearchFeature({
  feature,
  query,
  onQueryChange,
}: {
  feature: ExplorerFeature<'search'>
  query: string
  onQueryChange: (query: string) => void
}) {
  return (
    <SidebarSection className="p-3">
      <SearchInput
        icon
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onClear={() => onQueryChange('')}
        placeholder={feature.placeholder}
        aria-label={feature.placeholder}
      />
    </SidebarSection>
  )
}
