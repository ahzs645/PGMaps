import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, X, UtensilsCrossed, Trees, BarChart3, ShieldAlert, Wind, MapPin, Database, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'

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

let cachedIndex: SearchItem[] | null = null
let indexPromise: Promise<SearchItem[]> | null = null

async function buildIndex(): Promise<SearchItem[]> {
  if (cachedIndex) return cachedIndex

  if (indexPromise) return indexPromise

  indexPromise = (async () => {
    const base = import.meta.env.BASE_URL
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

    addDatasetItem('dataset-food', 'Food safety inspections dataset', 'foodSafety', '/foodmap', UtensilsCrossed, 'text-orange-500')
    addDatasetItem('dataset-air', 'Air monitoring stations dataset', 'airQuality', '/airquality', Wind, 'text-sky-500')
    addDatasetItem('dataset-census', '2021 Census variables catalogue', 'census', '/census', BarChart3, 'text-amber-600')
    addDatasetItem('dataset-parks', 'Parks, trails, and amenities datasets', 'parks', '/pgdata', Trees, 'text-green-500', { tab: 'parks' })
    addDatasetItem('dataset-crime', 'Property crime incidents API', 'crime', '/pgdata', ShieldAlert, 'text-red-500', { tab: 'crime' })
    addDatasetItem('dataset-canue', 'CANUE BC annual extracts', 'canue', '/misc', Database, 'text-violet-600')
    addDatasetItem('dataset-heat-shade', 'Heat and shade proxy layers', 'heatShade', '/misc', Database, 'text-violet-600')
    addDatasetItem('dataset-assessment', 'BC Assessment parcels dataset', 'bcAssessment', '/bc-assessment', Building2, 'text-slate-500')

    // Load restaurants
    try {
      const res = await fetch(`${base}data/restaurants.json`)
      if (res.ok) {
        const data = await res.json()
        for (const r of data) {
          items.push({
            id: `food-${r.name}`,
            label: r.name,
            sublabel: r.address || 'Prince George',
            section: 'Food Safety',
            sectionPath: '/foodmap',
            icon: UtensilsCrossed,
            iconColor: 'text-orange-500',
            params: { q: r.name },
          })
        }
      }
    } catch { /* skip */ }

    // Load parks from data
    try {
      const res = await fetch(`${base}data/parks.json`)
      if (res.ok) {
        const fc = await res.json()
        const features = fc.features || fc
        for (const f of features) {
          const name = f.properties?.PARK_NAME || f.properties?.name || f.name
          if (!name) continue
          items.push({
            id: `park-${name}`,
            label: name,
            sublabel: f.properties?.CLASSIFICATION || 'Park',
            section: 'Parks & Trails',
            sectionPath: '/pgdata',
            icon: Trees,
            iconColor: 'text-green-500',
            params: { tab: 'parks', q: name },
          })
        }
      }
    } catch { /* skip */ }

    // Load census variables
    try {
      const res = await fetch(`${base}data/census/variables/catalog.json`)
      if (res.ok) {
        const catalog = await res.json()
        for (const category of (catalog.categories || []).slice(0, 80)) {
          items.push({
            id: `census-category-${category.id}`,
            label: category.name,
            sublabel: `${category.group || 'Census'} | ${category.variables?.length || 0} variables`,
            section: 'Census Variables',
            sectionPath: '/census',
            icon: BarChart3,
            iconColor: 'text-amber-600',
          })
          for (const variable of (category.variables || []).slice(0, 30)) {
            items.push({
              id: `census-var-${category.id}-${variable.id}`,
              label: variable.label,
              sublabel: `${category.name} | ${variable.id} | ${variable.type || 'Variable'}`,
              section: 'Census Variables',
              sectionPath: '/census',
              icon: BarChart3,
              iconColor: 'text-amber-600',
              params: { category: category.id, variable: variable.id },
            })
          }
        }
      }
    } catch { /* skip */ }

    // Load CANUE datasets from the annual manifest
    try {
      const res = await fetch(`${base}data/canue/bc/annual-gzip/manifest.json`)
      if (res.ok) {
        const manifest = await res.json()
        for (const dataset of (manifest.datasets || [])) {
          items.push({
            id: `canue-${dataset.id}`,
            label: dataset.label,
            sublabel: `CANUE | ${dataset.category || 'Dataset'} | ${(dataset.files || []).length} file(s) | Updated ${manifest.generatedAt || 'unknown'}`,
            section: 'Open Data',
            sectionPath: '/misc',
            icon: Database,
            iconColor: 'text-violet-600',
            params: { tab: 'canue', dataset: dataset.id },
          })
        }
      }
    } catch { /* skip */ }

    // Load BC Assessment addresses, capped to keep the command palette responsive.
    try {
      const res = await fetch(`${base}data/bc-assessment/parcels.geojson`)
      if (res.ok) {
        const fc = await res.json()
        for (const feature of (fc.features || []).slice(0, 800)) {
          const p = feature.properties || {}
          const address = p.address || p.ADDRESS
          if (!address) continue
          items.push({
            id: `assessment-${p.oid_evbc || p.roll || address}`,
            label: address,
            sublabel: `BC Assessment | ${p.desc || p.cat || 'Property'} | ${p.val ? `$${Number(p.val).toLocaleString()}` : 'value unavailable'}`,
            section: 'Properties',
            sectionPath: '/bc-assessment',
            icon: Building2,
            iconColor: 'text-slate-500',
            params: { q: address },
          })
        }
      }
    } catch { /* skip */ }

    // Load a small sample of live property crime incidents from the public ArcGIS API.
    try {
      const params = new URLSearchParams({
        where: '1=1',
        outFields: '*',
        resultRecordCount: '200',
        outSR: '4326',
        f: 'geojson',
      })
      const res = await fetch(`https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/PGCrime/FeatureServer/0/query?${params}`)
      if (res.ok) {
        const fc = await res.json()
        for (const feature of (fc.features || [])) {
          const p = feature.properties || {}
          items.push({
            id: `crime-${p.OBJECTID}`,
            label: p.CrimeType || 'Property crime incident',
            sublabel: `${p.CommunityName || 'Prince George'} | ${p.Address || 'No address'} | ${p.File_Number || ''}`,
            section: 'Crime Incidents',
            sectionPath: '/pgdata',
            icon: ShieldAlert,
            iconColor: 'text-red-500',
            params: { tab: 'crime', q: p.Address || p.CrimeType || '' },
          })
        }
      }
    } catch { /* skip */ }

    // Add map section quick links
    const sections: SearchItem[] = [
      { id: 'nav-foodmap', label: 'Food Safety Map', sublabel: 'Restaurant health inspections', section: 'Maps', sectionPath: '/foodmap', icon: UtensilsCrossed, iconColor: 'text-orange-500' },
      { id: 'nav-airquality', label: 'Air Quality Map', sublabel: 'Air monitoring stations', section: 'Maps', sectionPath: '/airquality', icon: Wind, iconColor: 'text-sky-500' },
      { id: 'nav-parks', label: 'Parks & Trails', sublabel: 'Parks, trails, and amenities', section: 'Maps', sectionPath: '/pgdata', icon: Trees, iconColor: 'text-green-500', params: { tab: 'parks' } },
      { id: 'nav-census', label: 'Census Data', sublabel: 'Choropleth census patterns', section: 'Maps', sectionPath: '/census', icon: BarChart3, iconColor: 'text-amber-600' },
      { id: 'nav-pgdata', label: 'PG Data', sublabel: 'City PG crime, parks, trails, and amenities', section: 'Maps', sectionPath: '/pgdata', icon: ShieldAlert, iconColor: 'text-red-500' },
      { id: 'nav-misc', label: 'MISC Data', sublabel: 'Canopy, heat-shade, CANUE, and other non-City PG datasets', section: 'Maps', sectionPath: '/misc', icon: Database, iconColor: 'text-violet-600' },
      { id: 'nav-scorebuilder', label: 'Index Lab', sublabel: 'Transparent weighted civic indices', section: 'Maps', sectionPath: '/score-builder', icon: MapPin, iconColor: 'text-cyan-600' },
    ]
    items.push(...sections)

    cachedIndex = items
    return items
  })()

  return indexPromise
}

export function GlobalSearch({ className }: GlobalSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<SearchItem[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Build the index on first open
  useEffect(() => {
    if (open) {
      buildIndex().then(setIndex)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // Show section quick links when no query
      return index.filter((i) => i.section === 'Maps')
    }
    return index
      .filter((i) => i.label.toLowerCase().includes(q) || i.sublabel.toLowerCase().includes(q))
      .slice(0, 20)
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
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
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

  const searchOverlay = open && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-[15vh] backdrop-blur-sm">
          <div
            ref={panelRef}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="h-5 w-5 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search restaurants, parks, maps..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {Object.entries(grouped).length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results found.</div>
              )}

              {(() => {
                let flatIdx = 0
                return Object.entries(grouped).map(([section, items]) => (
                  <div key={section}>
                    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {section}
                    </div>
                    {items.map((item) => {
                      const idx = flatIdx++
                      const Icon = item.icon
                      return (
                        <button
                          key={item.id}
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

            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <span>{results.length} results</span>
              <div className="flex items-center gap-2">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↑↓</kbd>
                <span>Navigate</span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">↵</kbd>
                <span>Open</span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">Esc</kbd>
                <span>Close</span>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        aria-label="Open search"
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-input bg-background/80 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="ml-2 hidden rounded border border-input bg-muted px-1.5 py-0.5 text-[10px] font-mono sm:inline">
          ⌘K
        </kbd>
      </button>

      {searchOverlay}
    </>
  )
}
