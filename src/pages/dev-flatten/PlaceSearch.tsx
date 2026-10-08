import { useId, useState } from 'react'
import { SearchInput } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import type { Place, Model } from './routing'

export function PlaceSearch({ label, place, model, onSelect, onFocus }: {
  label: string; place: Place | null; model: Model | null; onSelect: (place: Place | null) => void; onFocus: () => void
}) {
  const id = useId()
  const [query, setQuery] = useState(place?.label ?? '')
  const [active, setActive] = useState(false)
  const [selected, setSelected] = useState(0)
  const [previousPlace, setPreviousPlace] = useState(place)
  if (place !== previousPlace) {
    setPreviousPlace(place)
    setQuery(place?.label ?? '')
  }
  const suggestions = active ? model?.index.search(query) ?? [] : []
  const pick = (index: number) => {
    const item = suggestions[index]
    if (!item) return
    setQuery(item.name)
    setActive(false)
    onSelect({ lon: item.lon, lat: item.lat, label: item.name })
  }
  return <div className="relative space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <SearchInput id={id} value={query} role="combobox" autoComplete="off" spellCheck={false} disabled={!model}
      aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={`${id}-suggestions`}
      aria-activedescendant={suggestions.length ? `${id}-option-${selected}` : undefined}
      placeholder={model?.city.searchPlaceholder ?? 'Place or intersection'} icon onClear={() => { setQuery(''); onSelect(null) }}
      onFocus={(event) => { setActive(true); onFocus(); event.currentTarget.select() }}
      onBlur={() => { setActive(false); setQuery(place?.label ?? '') }}
      onChange={(event) => { setQuery(event.target.value); setSelected(0); setActive(true) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setActive(false); event.currentTarget.blur() }
        if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setSelected((value) => (value + 1) % suggestions.length) }
        if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setSelected((value) => (value + suggestions.length - 1) % suggestions.length) }
        if (event.key === 'Enter' && suggestions.length) { event.preventDefault(); pick(selected); event.currentTarget.blur() }
      }} />
    {suggestions.length > 0 && <ul id={`${id}-suggestions`} role="listbox" aria-label={`${label} suggestions`} className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg">
      {suggestions.map((item, index) => <li key={`${item.kind}-${item.name}`} id={`${id}-option-${index}`} role="option" aria-selected={selected === index}>
        <button type="button" tabIndex={-1} className={cn('flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent', index === selected && 'bg-accent')}
          onMouseDown={(event) => event.preventDefault()} onClick={() => pick(index)}>
          <span className="min-w-0">{item.name}</span><span className="shrink-0 text-xs text-muted-foreground">{item.kind}</span>
        </button>
      </li>)}
    </ul>}
  </div>
}
