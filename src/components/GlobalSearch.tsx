import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Search,
  X,
  UtensilsCrossed,
  Trees,
  BarChart3,
  ShieldAlert,
  Wind,
  MapPin,
  Database,
  Building2,
  PawPrint,
  Droplets,
} from 'lucide-react'
import { fetchJson } from '@/lib/fetchJson'
import { requestMapSearch } from '@/lib/mapSearch'
import { CANUE_V2_CATALOG_URL, type CanueV2Catalog } from '@/maps/pgdata/canueV2'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

interface SearchItem {
  id: string
  label: string
  sublabel: string
  section: string
  sectionPath: string
  icon: React.ElementType
  iconColor: string
  params?: Record<string, string>
}

interface GlobalSearchProps {
  className?: string
}

const mapSearchPaths = new Set([
  '/airquality',
  '/bc-assessment',
  '/census',
  '/dev/aqmap',
  '/dev/interact',
  '/explorer',
  '/foodmap',
  '/misc',
  '/pgdata',
  '/score-builder',
  '/socioeconomic',
])

function staticSearchIndex(): SearchItem[] {
  const items: SearchItem[] = []
  const addDatasetItem = (
    id: string,
    label: string,
    datasetKey: keyof typeof DATASETS,
    sectionPath: string,
    icon: React.ElementType,
    iconColor: string,
    params?: Record<string, string>,
  ) => {
    const dataset = DATASETS[datasetKey]
    items.push({
      id,
      label,
      sublabel: `${dataset.source} | ${dataset.coverage} | ${dataset.formats.join(', ')}`,
      section: 'Open Data',
      sectionPath,
      icon,
      iconColor,
      params,
    })
  }

  addDatasetItem(
    'dataset-food',
    'Food safety inspections dataset',
    'foodSafety',
    '/foodmap',
    UtensilsCrossed,
    'text-orange-500',
  )
  addDatasetItem('dataset-air', 'Air monitoring stations dataset', 'airQuality', '/airquality', Wind, 'text-sky-500')
  addDatasetItem('dataset-census', '2021 Census variables catalogue', 'census', '/census', BarChart3, 'text-amber-600')
  addDatasetItem(
    'dataset-parks',
    'Parks, trails, and amenities datasets',
    'parks',
    '/pgdata',
    Trees,
    'text-green-500',
    { tab: 'parks' },
  )
  addDatasetItem('dataset-crime', 'Property crime incidents API', 'crime', '/pgdata', ShieldAlert, 'text-red-500', {
    tab: 'crime',
  })
  addDatasetItem('dataset-canue', 'CANUE BC annual extracts', 'canue', '/misc', Database, 'text-violet-600')
  addDatasetItem('dataset-heat-shade', 'Heat and shade proxy layers', 'heatShade', '/misc', Database, 'text-violet-600')
  addDatasetItem('dataset-wars', 'Wildlife accident records', 'wars', '/misc', PawPrint, 'text-amber-700', {
    tab: 'wars',
  })
  addDatasetItem(
    'dataset-water',
    'Drinking water facilities, samples, and notices',
    'water',
    '/misc',
    Database,
    'text-sky-600',
    { tab: 'water' },
  )
  addDatasetItem(
    'dataset-assessment',
    'BC Assessment parcels dataset',
    'bcAssessment',
    '/bc-assessment',
    Building2,
    'text-slate-500',
  )
  addDatasetItem('dataset-drought', 'B.C. drought levels time lapse', 'drought', '/misc', Droplets, 'text-amber-600', {
    tab: 'drought',
  })

  // Add map section quick links
  const sections: SearchItem[] = [
    {
      id: 'nav-foodmap',
      label: 'Food Safety Map',
      sublabel: 'Restaurant health inspections',
      section: 'Maps',
      sectionPath: '/foodmap',
      icon: UtensilsCrossed,
      iconColor: 'text-orange-500',
    },
    {
      id: 'nav-airquality',
      label: 'Air Quality Map',
      sublabel: 'Air monitoring stations',
      section: 'Maps',
      sectionPath: '/airquality',
      icon: Wind,
      iconColor: 'text-sky-500',
    },
    {
      id: 'nav-parks',
      label: 'Parks & Trails',
      sublabel: 'Parks, trails, and amenities',
      section: 'Maps',
      sectionPath: '/pgdata',
      icon: Trees,
      iconColor: 'text-green-500',
      params: { tab: 'parks' },
    },
    {
      id: 'nav-census',
      label: 'Census Data',
      sublabel: 'Choropleth census patterns',
      section: 'Maps',
      sectionPath: '/census',
      icon: BarChart3,
      iconColor: 'text-amber-600',
    },
    {
      id: 'nav-pgdata',
      label: 'PG Data',
      sublabel: 'City PG crime, parks, trails, and amenities',
      section: 'Maps',
      sectionPath: '/pgdata',
      icon: ShieldAlert,
      iconColor: 'text-red-500',
    },
    {
      id: 'nav-misc',
      label: 'MISC Data',
      sublabel: 'Canopy, heat-shade, CANUE, WARS, water, and other non-City PG datasets',
      section: 'Maps',
      sectionPath: '/misc',
      icon: Database,
      iconColor: 'text-violet-600',
    },
    {
      id: 'nav-scorebuilder',
      label: 'Index Lab',
      sublabel: 'Transparent weighted civic indices',
      section: 'Maps',
      sectionPath: '/score-builder',
      icon: MapPin,
      iconColor: 'text-cyan-600',
    },
  ]
  items.push(...sections)

  return items
}

const STATIC_INDEX = staticSearchIndex()
type SearchRow = Pick<SearchItem, 'id' | 'label' | 'sublabel' | 'params'>
type SearchSource = {
  key: string
  section: string
  sectionPath: string
  icon: React.ElementType
  iconColor: string
  load: (signal: AbortSignal) => Promise<SearchRow[]>
}
const localIndex = (name: string) => (signal: AbortSignal) =>
  fetchJson<SearchRow[]>(`/data/ui/search/${name}.json.gz`, signal)
const SEARCH_SOURCES: SearchSource[] = [
  {
    key: 'restaurants',
    section: 'Food Safety',
    sectionPath: '/foodmap',
    icon: UtensilsCrossed,
    iconColor: 'text-orange-500',
    load: localIndex('restaurants'),
  },
  {
    key: 'parks',
    section: 'Parks & Trails',
    sectionPath: '/pgdata',
    icon: Trees,
    iconColor: 'text-green-500',
    load: localIndex('parks'),
  },
  {
    key: 'census',
    section: 'Census Variables',
    sectionPath: '/census',
    icon: BarChart3,
    iconColor: 'text-amber-600',
    load: localIndex('census'),
  },
  {
    key: 'properties',
    section: 'Properties',
    sectionPath: '/bc-assessment',
    icon: Building2,
    iconColor: 'text-slate-500',
    load: localIndex('properties'),
  },
  {
    key: 'canue',
    section: 'Open Data',
    sectionPath: '/misc',
    icon: Database,
    iconColor: 'text-violet-600',
    load: async (signal) => {
      const catalog = await fetchJson<CanueV2Catalog>(CANUE_V2_CATALOG_URL, signal)
      return catalog.families.map((family) => ({
        id: `canue-${family.id}`,
        label: family.label,
        sublabel: `CANUE | ${family.variableCount} variables`,
        params: { tab: 'canue', family: family.id },
      }))
    },
  },
  {
    key: 'crime',
    section: 'Crime Incidents',
    sectionPath: '/pgdata',
    icon: ShieldAlert,
    iconColor: 'text-red-500',
    load: async (signal) => {
      const params = new URLSearchParams({
        where: '1=1',
        outFields: 'OBJECTID,CrimeType,CommunityName,Address,File_Number',
        returnGeometry: 'false',
        resultRecordCount: '200',
        f: 'json',
      })
      const data = await fetchJson<{ features: { attributes: Record<string, string> }[] }>(
        `https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/PGCrime/FeatureServer/0/query?${params}`,
        signal,
      )
      if (!Array.isArray(data.features)) throw new Error('Crime search unavailable')
      return data.features.map(({ attributes: p }) => ({
        id: `crime-${p.OBJECTID}`,
        label: p.CrimeType || 'Property crime incident',
        sublabel: `${p.CommunityName || 'Prince George'} | ${p.Address || 'No address'}`,
        params: { tab: 'crime', q: p.Address || p.CrimeType || '' },
      }))
    },
  },
]
const sourceRequests = new Map<string, Promise<SearchItem[]>>()
function loadSearchSource(source: SearchSource): Promise<SearchItem[]> {
  const cached = sourceRequests.get(source.key)
  if (cached) return cached
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  const request = source
    .load(controller.signal)
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        section: source.section,
        sectionPath: source.sectionPath,
        icon: source.icon,
        iconColor: source.iconColor,
      })),
    )
    .catch((error: unknown) => {
      sourceRequests.delete(source.key)
      throw error
    })
    .finally(() => clearTimeout(timeout))
  sourceRequests.set(source.key, request)
  return request
}

export function GlobalSearch({ className }: GlobalSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceItems, setSourceItems] = useState<Record<string, SearchItem[]>>({})
  const [sourceStatus, setSourceStatus] = useState<Record<string, 'loading' | 'ready' | 'error'>>({})
  const [retry, setRetry] = useState(0)
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const index = useMemo(
    () => [...STATIC_INDEX, ...SEARCH_SOURCES.flatMap((source) => sourceItems[source.key] ?? [])],
    [sourceItems],
  )
  const includeProperties = query.trim().length >= 2
  const includeCrime = /crime|theft|break|mischief/i.test(query)
  const loading = Object.values(sourceStatus).includes('loading')
  const failed = Object.values(sourceStatus).includes('error')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const useMapSearch = mapSearchPaths.has(location.pathname)

  const openSearch = useCallback(() => {
    if (location.pathname === '/dev/interact') {
      window.dispatchEvent(new CustomEvent('pgmaps:open-map-search'))
      return
    }
    if (useMapSearch && requestMapSearch()) return
    setOpen(true)
  }, [location.pathname, useMapSearch])

  // Sources publish independently. Static navigation never waits on data or live APIs.
  useEffect(() => {
    if (!open) return
    const sources = SEARCH_SOURCES.filter((source) =>
      source.key === 'properties' ? includeProperties : source.key === 'crime' ? includeCrime : true,
    )
    for (const source of sources) {
      setSourceStatus((current) => ({ ...current, [source.key]: 'loading' }))
      loadSearchSource(source)
        .then((items) => {
          if (!mountedRef.current) return
          setSourceItems((current) => ({ ...current, [source.key]: items }))
          setSourceStatus((current) => ({ ...current, [source.key]: 'ready' }))
        })
        .catch(() => {
          if (mountedRef.current) setSourceStatus((current) => ({ ...current, [source.key]: 'error' }))
        })
    }
  }, [open, includeProperties, includeCrime, retry])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        if (open) setOpen(false)
        else openSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, openSearch])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // Show section quick links when no query
      return index.filter((i) => i.section === 'Maps')
    }
    const matches = index
      .filter((i) => i.label.toLowerCase().includes(q) || i.sublabel.toLowerCase().includes(q))
      .slice(0, 20)
    // Render order and keyboard selection must agree when sections interleave.
    const groups = new Map<string, SearchItem[]>()
    for (const item of matches) groups.set(item.section, [...(groups.get(item.section) ?? []), item])
    return [...groups.values()].flat()
  }, [query, index])

  useEffect(() => {
    setSelectedIdx(0)
  }, [results])

  const navigateTo = useCallback(
    (item: SearchItem) => {
      const params = item.params ? '?' + new URLSearchParams(item.params).toString() : ''
      navigate(`${item.sectionPath}${params}`)
      setOpen(false)
      setQuery('')
    },
    [navigate],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(0, Math.min(i + 1, results.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && results[selectedIdx]) {
        navigateTo(results[selectedIdx])
      }
    },
    [results, selectedIdx, navigateTo],
  )

  // Group results by section
  const grouped = useMemo(() => {
    const groups: Record<string, SearchItem[]> = {}
    results.forEach((item) => {
      if (!groups[item.section]) groups[item.section] = []
      groups[item.section].push(item)
    })
    return groups
  }, [results])

  const activeResultId = results[selectedIdx] ? `global-search-result-${selectedIdx}` : undefined

  const searchOverlay = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        elevated
        showClose={false}
        className="top-[15vh] max-h-[min(32rem,calc(100dvh-2rem))] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[15vh] sm:translate-y-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <DialogTitle className="sr-only">Search PGMaps</DialogTitle>
        <DialogDescription className="sr-only">
          Search maps, datasets, restaurants, parks, and properties.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <label htmlFor="global-search-input" className="sr-only">
            Search PGMaps
          </label>
          <input
            id="global-search-input"
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search restaurants, parks, maps..."
            aria-label="Search PGMaps"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="global-search-results"
            aria-activedescendant={activeResultId}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {(loading || failed) && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground"
          >
            <span>{loading ? 'Loading more results…' : 'Some search sources are unavailable.'}</span>
            {failed && !loading && (
              <button type="button" className="min-h-9 px-2 underline" onClick={() => setRetry((value) => value + 1)}>
                Retry
              </button>
            )}
          </div>
        )}
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="min-h-0 max-h-80 overflow-y-auto p-2"
        >
          {Object.entries(grouped).length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {loading ? 'Searching…' : failed ? 'Search is partially unavailable.' : 'No results found.'}
            </div>
          )}

          {(() => {
            let flatIdx = 0
            return Object.entries(grouped).map(([section, items]) => (
              <div key={section}>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {section}
                </div>
                {items.map((item) => {
                  const idx = flatIdx++
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      id={`global-search-result-${idx}`}
                      type="button"
                      role="option"
                      aria-selected={idx === selectedIdx}
                      onClick={() => navigateTo(item)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                        idx === selectedIdx ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', item.iconColor)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.label}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.sublabel}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          })()}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{results.length} results</span>
          <div className="hidden items-center gap-2 sm:flex">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↑↓</kbd>
            <span>Navigate</span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↵</kbd>
            <span>Open</span>
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Esc</kbd>
            <span>Close</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open search"
        title="Search (⌘K)"
        onClick={openSearch}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
      >
        <Search className="h-4 w-4" />
      </button>

      {searchOverlay}
    </>
  )
}
