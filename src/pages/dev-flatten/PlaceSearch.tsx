import { useId, useState } from 'react'
import { SearchComboboxInput, SearchResultList, useSearchCombobox } from '@/components/ui/search-combobox'
import { cn } from '@/lib/utils'
import type { Place, Model } from './routing'

export function PlaceSearch({
  label,
  place,
  model,
  onSelect,
  onFocus,
}: {
  label: string
  place: Place | null
  model: Model | null
  onSelect: (place: Place | null) => void
  onFocus: () => void
}) {
  const id = useId()
  const [query, setQuery] = useState(place?.label ?? '')
  const [active, setActive] = useState(false)
  const [previousPlace, setPreviousPlace] = useState(place)
  if (place !== previousPlace) {
    setPreviousPlace(place)
    setQuery(place?.label ?? '')
  }
  const suggestions = active ? (model?.index.search(query) ?? []) : []
  const combobox = useSearchCombobox({
    items: suggestions,
    id: `${id}-suggestions`,
    resetKey: query,
    expanded: suggestions.length > 0,
    onPick: (item) => {
      setQuery(item.name)
      setActive(false)
      onSelect({ lon: item.lon, lat: item.lat, label: item.name })
    },
  })
  return (
    <div className="relative space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <SearchComboboxInput
        id={id}
        combobox={combobox}
        value={query}
        spellCheck={false}
        disabled={!model}
        placeholder={model?.city.searchPlaceholder ?? 'Place or intersection'}
        icon
        onClear={() => {
          setQuery('')
          onSelect(null)
        }}
        onFocus={(event) => {
          setActive(true)
          onFocus()
          event.currentTarget.select()
        }}
        onBlur={() => {
          setActive(false)
          setQuery(place?.label ?? '')
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setActive(false)
            event.currentTarget.blur()
          }
          // The list picked the highlighted place; leave the field as a native select would.
          if (event.key === 'Enter' && event.defaultPrevented) event.currentTarget.blur()
        }}
      />
      {suggestions.length > 0 && (
        <SearchResultList
          combobox={combobox}
          as="ul"
          keepInputFocus
          aria-label={`${label} suggestions`}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg"
          getKey={(item) => `${item.kind}-${item.name}`}
          optionClassName={({ active }) =>
            cn(
              'flex w-full cursor-pointer items-start justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent',
              active && 'bg-accent',
            )
          }
          renderOption={(item) => (
            <>
              <span className="min-w-0">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.kind}</span>
            </>
          )}
        />
      )}
    </div>
  )
}
