import { Search, X } from 'lucide-react'

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
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <SearchInput
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={feature.placeholder}
          aria-label={feature.placeholder}
          className="rounded-md py-1.5 pl-8 pr-8 text-xs focus:ring-1"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="size-3 text-muted-foreground" />
          </button>
        ) : null}
      </div>
    </SidebarSection>
  )
}
