import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileImage, Library, Link2, MapPinned, X } from 'lucide-react'
import type { StyleSpecification } from 'maplibre-gl'
import { Map as AppMap } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { textColumn } from '@/components/map/tableColumns'
import { MapTableBridge, defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { InlineAlert, MapOverlay, MapSidebarShell, SearchInput, SidebarSection } from '@/components/ui/map-panels'
import { ResultRow, ListHeader } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ExternalLink } from '@/components/ui/text-button'
import { formatBytes, formatNumber } from '@/lib/format'
import {
  loadCatalogue,
  shareLink,
  type CatalogueFacets,
  type RasterCatalogue,
  type RasterRecord,
  type SourceImageRecord,
} from './dev-view/catalogue'
import { RasterMapLayer } from './dev-view/RasterMapLayer'
import { MapLibrary } from './dev-view/MapLibrary'
import { MapImagePreview } from './dev-view/MapImagePreview'
import { SourceImagePreview } from './dev-view/SourceImagePreview'
import { LibraryFilters } from './dev-view/LibraryFilters'
import { OrganizationSummary } from './dev-view/OrganizationSummary'
import {
  EMPTY_FILTERS,
  isRaster,
  matchesLibraryItem,
  organizationOptions,
  type LibraryItem,
} from './dev-view/libraryOrganization'

const STREET: StyleSpecification = {
  version: 8,
  sources: {
    reference: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'reference', type: 'raster', source: 'reference' }],
}
const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    reference: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 20,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community',
    },
  },
  layers: [{ id: 'reference', type: 'raster', source: 'reference' }],
}
function params() {
  return new URLSearchParams(window.location.hash.slice(1))
}

/** The teal the catalogue list marks its selected row with. */
const RASTER_COLOR = '#14b8a6'

function rasterColumns(facets: CatalogueFacets) {
  const labels = new Map(
    [...facets.subjects, ...facets.regions, ...facets.eras].map((facet) => [facet.id, facet.label]),
  )
  const label = (id: string | undefined) => (id ? (labels.get(id) ?? id.replace(/[-_]+/g, ' ')) : null)
  return [
    textColumn<RasterRecord>('title', 'Title', (item) => item.title, { width: 300 }),
    textColumn<RasterRecord>('date', 'Date', (item) => item.dateLabel, { width: 120 }),
    textColumn<RasterRecord>('subject', 'Subject', (item) => label(item.organization?.primarySubject)),
    textColumn<RasterRecord>('region', 'Region', (item) => label(item.organization?.region)),
    textColumn<RasterRecord>('era', 'Era', (item) => label(item.organization?.era)),
    textColumn<RasterRecord>('placement', 'Placement', (item) => item.alignmentReview?.label ?? item.confidence),
    textColumn<RasterRecord>('source', 'Source document', (item) => item.organization?.sourceGroupTitle, {
      width: 240,
    }),
  ]
}

export default function DevView() {
  const navigate = useNavigate()
  const [source, setSource] = useState(() => params().get('catalog') || '')
  const [input, setInput] = useState(source)
  const [catalogue, setCatalogue] = useState<RasterCatalogue | null>(null)
  const [selectedId, setSelectedId] = useState(() => params().get('map') || '')
  const [scope, setScope] = useState<'featured' | 'all' | 'sources'>('all')
  const [view, setView] = useState<'library' | 'map'>(() => (params().get('view') === 'map' ? 'map' : 'library'))
  const [sourcePreview, setSourcePreview] = useState<SourceImageRecord | null>(null)
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS })
  const [preview, setPreview] = useState<RasterRecord | null>(null)
  const [showMapTitle, setShowMapTitle] = useState(true)
  const libraryScroll = useRef(0)
  const getLibraryScroll = useCallback(() => libraryScroll.current, [])
  const [query, setQuery] = useState('')
  const [base, setBase] = useState<'street' | 'satellite'>('satellite')
  const [opacity, setOpacity] = useState(65)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tileError, setTileError] = useState('')
  const [details, setDetails] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetPage, setSheetPage] = useState(0)
  const [legend, setLegend] = useState(false)
  const [manualShare, setManualShare] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const candidates = useMemo(
    () => (scope === 'featured' && catalogue?.featured.length ? catalogue.featured : catalogue?.items || []),
    [scope, catalogue],
  )
  const selected = useMemo(
    () => (catalogue ? [...catalogue.featured, ...catalogue.items].find((i) => i.id === selectedId) || null : null),
    [catalogue, selectedId],
  )
  const filtered = useMemo(
    () => candidates.filter((item) => matchesLibraryItem(item, query, filters)),
    [candidates, query, filters],
  )
  const filteredSources = useMemo(
    () => (catalogue?.unplacedSources || []).filter((item) => matchesLibraryItem(item, query, filters)),
    [catalogue, query, filters],
  )
  const filterOptions = useMemo(
    () =>
      organizationOptions(
        catalogue ? [...catalogue.items, ...catalogue.featured, ...catalogue.unplacedSources] : [],
        catalogue?.facets || { subjects: [], regions: [], eras: [] },
      ),
    [catalogue],
  )
  const libraryItems = scope === 'sources' ? filteredSources : filtered
  const changeFilters = (next: typeof filters) => {
    setFilters(next)
    libraryScroll.current = 0
  }
  const filterBySource = (id: string) => {
    setScope('all')
    setQuery('')
    changeFilters({ ...EMPTY_FILTERS, sourceGroup: id })
  }
  const categoryControls = (
    <LibraryFilters
      values={filters}
      options={filterOptions}
      sourceMode={scope === 'sources'}
      onChange={changeFilters}
    />
  )
  const coverageSummary = catalogue
    ? `${formatNumber(catalogue.representationCount)} raster representations${catalogue.coverage?.sourceDocuments ? ` · ${formatNumber(catalogue.coverage.sourceDocuments)} source documents` : ''}${catalogue.unplacedSources.length ? ` · ${formatNumber(catalogue.unplacedSources.length)} source-image records` : ''}`
    : undefined
  const style = base === 'satellite' ? SATELLITE : STREET
  const styles = useMemo(() => ({ light: style, dark: style }), [style])
  useEffect(() => {
    const tags = [
      ['robots', 'noindex, nofollow, noarchive'],
      ['referrer', 'no-referrer'],
    ].map(([name, content]) => {
      let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
      const old = element?.content
      if (!element) {
        element = document.createElement('meta')
        element.name = name
        document.head.append(element)
      }
      element.content = content
      return () => {
        if (old === undefined) element?.remove()
        else if (element) element.content = old
      }
    })
    return () => tags.forEach((cleanup) => cleanup())
  }, [])
  useEffect(() => {
    const abort = new AbortController()
    Promise.resolve()
      .then(() => {
        if (abort.signal.aborted) return null
        setLoading(Boolean(source))
        setError('')
        setCatalogue(null)
        return source ? loadCatalogue(source, abort.signal) : null
      })
      .then((value) => {
        if (abort.signal.aborted || !value) return
        setCatalogue(value)
        const requested = params().get('map')
        const item =
          [...value.featured, ...value.items].find((x) => x.id === requested) || value.featured[0] || value.items[0]
        setSelectedId(item.id)
        setScope(params().get('view') === 'map' && value.featured.some((x) => x.id === item.id) ? 'featured' : 'all')
        setQuery('')
        setFilters({ ...EMPTY_FILTERS })
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : 'The map could not load. Check the URL and its CORS settings.')
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [source, reloadNonce])
  useEffect(() => {
    const change = () => {
      const p = params()
      const nextView = p.get('view') === 'map' ? 'map' : 'library'
      setView(nextView)
      setPreview(null)
      setSourcePreview(null)
      setShowMapTitle(true)
      const changedSource = (p.get('catalog') || '') !== source
      setSource(p.get('catalog') || '')
      setInput(p.get('catalog') || '')
      const id = p.get('map') || ''
      if (id) {
        setSelectedId(id)
        if (catalogue && nextView === 'map')
          setScope(catalogue.featured.some((item) => item.id === id) ? 'featured' : 'all')
      }
      if (changedSource) {
        setQuery('')
        setScope('all')
        setFilters({ ...EMPTY_FILTERS })
        libraryScroll.current = 0
      }
      setTileError('')
      setSheetPage(0)
      setLegend(false)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [catalogue, source])
  const choose = useCallback((item: RasterRecord) => {
    setSelectedId(item.id)
    setShowMapTitle(true)
    setTileError('')
    setSheetPage(0)
    setLegend(false)
  }, [])
  const tableSources = useMemo(
    () =>
      view === 'map' && catalogue
        ? [
            defineTableSource<RasterRecord>({
              id: 'rasters',
              label: 'Map catalogue',
              color: RASTER_COLOR,
              shape: 'fill',
              rows: filtered,
              columns: rasterColumns(catalogue.facets),
              getRowId: (item) => item.id,
              getRowCenter: (item) => [(item.bounds[0] + item.bounds[2]) / 2, (item.bounds[1] + item.bounds[3]) / 2],
              getRowBounds: (item) => item.bounds,
            }),
          ]
        : [],
    [catalogue, filtered, view],
  )
  // This page keeps its state in the hash, and a query-string write would drop it.
  // `RasterMapLayer` fits the map to the raster a row swaps in.
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selectedId,
    onSelectRow: (item: RasterRecord) => {
      choose(item)
      navigate({ hash: new URL(shareLink(source, item.id, 'map')).hash }, { replace: true })
    },
    url: false,
    flyOnSelect: false,
    inlineButton: true,
  })
  const openMap = (item: RasterRecord) => {
    choose(item)
    setPreview(null)
    navigate({ hash: new URL(shareLink(source, item.id, 'map')).hash })
    setView('map')
  }
  const openLibrary = () => {
    navigate({ hash: new URL(shareLink(source)).hash })
    setView('library')
    setPreview(null)
  }
  const previewImage = (item: LibraryItem) => {
    if (isRaster(item)) {
      choose(item)
      setPreview(item)
    } else setSourcePreview(item)
  }
  const sheet = selected?.fullSheets[sheetPage]
  const label =
    selected?.alignmentReview?.label ||
    (selected?.confidence === 'experimental' ? 'Experimental placement' : 'Provisional placement')
  const sourceForm = (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setView('library')
          setPreview(null)
          libraryScroll.current = 0
          navigate({ hash: new URL(shareLink(input.trim())).hash })
          setSource(input.trim())
          if (input.trim() === source) {
            setReloadNonce((value) => value + 1)
          }
        }}
        className="space-y-2"
      >
        <label htmlFor="shared-map-url" className="block text-xs text-muted-foreground">
          Catalogue JSON, raster PMTiles or raster TileJSON
        </label>
        <input
          id="shared-map-url"
          type="url"
          required
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://…/catalog.json"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        />
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? 'Opening…' : 'Open map URL'}
        </Button>
      </form>
      {!catalogue && !loading && !error && (
        <p className="mt-3 text-xs text-muted-foreground">
          Open a complete share link, or paste a compatible HTTPS data URL. Collections are not listed or discoverable
          from this page.
        </p>
      )}
      {error && (
        <InlineAlert tone="error" className="mt-3">
          {error}
        </InlineAlert>
      )}
    </>
  )
  const collectionControls = catalogue && (
    <>
      {(!!catalogue.featured.length || !!catalogue.unplacedSources.length) && (
        <SegmentedControl
          label="Map scope"
          className="mt-3"
          value={scope}
          onChange={(value) => {
            const next = value as 'featured' | 'all' | 'sources'
            setScope(next)
            setQuery('')
            libraryScroll.current = 0
            if (next === 'sources' && view === 'map') openLibrary()
            if (view === 'map' && next !== 'sources') {
              const item = (next === 'featured' ? catalogue.featured : catalogue.items)[0]
              choose(item)
              navigate({ hash: new URL(shareLink(source, item.id, 'map')).hash }, { replace: true })
            }
          }}
          options={[
            ...(catalogue.featured.length
              ? [{ value: 'featured', label: `Selections ${catalogue.featured.length}` }]
              : []),
            { value: 'all', label: `All ${catalogue.items.length}` },
            ...(catalogue.unplacedSources.length
              ? [{ value: 'sources', label: `Source images ${catalogue.unplacedSources.length}` }]
              : []),
          ]}
        />
      )}
      <label htmlFor="shared-map-search" className="sr-only">
        Search maps
      </label>
      <SearchInput
        id="shared-map-search"
        icon
        wrapperClassName="mt-3"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          libraryScroll.current = 0
        }}
        onClear={() => {
          setQuery('')
          libraryScroll.current = 0
        }}
        placeholder="Find a map or source…"
      />
      <CopyButton
        text={() => shareLink(source, view === 'map' ? selectedId : undefined, view)}
        className="mt-3 text-xs underline underline-offset-4"
        onResult={(result) => {
          if (!result.copied && result.text) setManualShare(result.text)
        }}
      >
        {view === 'map' ? 'Copy this map’s share link' : 'Copy library link'}
      </CopyButton>
      {manualShare && (
        <label className="mt-2 block text-xs">
          Copy this link manually
          <input
            readOnly
            value={manualShare}
            onFocus={(e) => e.target.select()}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
      )}
    </>
  )
  const sidebar = (
    <MapSidebarShell
      title={catalogue?.title || 'Open a shared map'}
      subtitle={
        catalogue
          ? `${formatNumber(catalogue.representationCount)} raster representations`
          : 'Browse maps from a share link or data URL'
      }
      icon={MapPinned}
      className={MAP_SIDEBAR_CLASS}
    >
      <SidebarSection title="Map URL" icon={Link2}>
        {sourceForm}
      </SidebarSection>
      {catalogue && (
        <>
          <SidebarSection title="Collection">
            <p className="text-xs text-muted-foreground">{catalogue.description}</p>
            {collectionControls}
            {categoryControls}
          </SidebarSection>
          {selected && (
            <SidebarSection title="Selected map">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{label}</p>
              <h2 className="mt-1 text-sm font-semibold">{selected.title}</h2>
              <OrganizationSummary value={selected.organization} facets={catalogue.facets} />
              {selected.dateLabel && <p className="mt-1 text-xs text-muted-foreground">{selected.dateLabel}</p>}
              <label className="mt-3 block text-xs" htmlFor="shared-opacity">
                Map opacity <span className="float-right tabular-nums">{opacity}%</span>
              </label>
              <input
                id="shared-opacity"
                type="range"
                min="0"
                max="100"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="mt-1 w-full"
              />
              <SegmentedControl
                label="Reference basemap"
                value={base}
                onChange={(v) => setBase(v as 'street' | 'satellite')}
                options={[
                  { value: 'satellite', label: 'Satellite' },
                  { value: 'street', label: 'Street map' },
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setDetails(true)}>
                  Map notes & sources
                </Button>
                {!!selected.fullSheets.length && (
                  <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
                    <FileImage />
                    Full sheet / legend
                  </Button>
                )}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {selected.alignmentReview?.summary || selected.caveat}
              </p>
              {tileError && (
                <InlineAlert tone="error" className="mt-2">
                  {tileError}
                </InlineAlert>
              )}
            </SidebarSection>
          )}
          <ListHeader count={filtered.length} noun={['map', 'maps']} />
          {!filtered.length && <p className="p-4 text-sm text-muted-foreground">No maps match that search.</p>}
          <VirtualResultList items={filtered} getKey={(i) => i.id} estimateSize={100} label="Map catalogue">
            {(item) => (
              <ResultRow
                title={item.title}
                subtitle={item.dateLabel || item.subtitle}
                meta={
                  item.alignmentReview?.label || (item.confidence === 'experimental' ? 'Experimental' : 'Provisional')
                }
                selected={item.id === selectedId}
                accent="teal"
                onClick={() => {
                  choose(item)
                  navigate({ hash: new URL(shareLink(source, item.id, 'map')).hash }, { replace: true })
                }}
                leading={
                  item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      width={64}
                      height={54}
                      className="h-14 w-16 rounded bg-muted object-contain"
                    />
                  ) : undefined
                }
              />
            )}
          </VirtualResultList>
        </>
      )}
    </MapSidebarShell>
  )
  return (
    <>
      {view === 'map' && catalogue && selected ? (
        <MapSectionLayout
          sidebar={sidebar}
          desktopSidebarWidth={390}
          mobileInitialSheetState="half"
          mobilePeekTitle={catalogue?.title || 'Shared map viewer'}
          mobilePeekSubtitle={selected?.title || 'Open a map URL'}
          table={table}
        >
          <AppMap
            className="h-full w-full"
            center={[-125.2, 53.75]}
            zoom={9}
            maxZoom={22}
            styles={styles}
            showStyleLoadingOverlay={false}
            showLoadingOverlay={false}
            loading={loading}
            deferResize={table.deferResize}
          >
            <MapTableBridge table={table} />
            <RasterMapLayer item={selected} opacity={opacity} onError={setTileError} />
            <MapOverlay
              position="top-left"
              className="top-[calc(env(safe-area-inset-top)+4rem)] max-w-[calc(100%-6rem)] p-2 text-xs md:top-3"
              data-testid="shared-map-title"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={openLibrary}>
                    <Library />
                    Library
                  </Button>
                  {table.button}
                </div>
                {showMapTitle ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label="Dismiss map title"
                    onClick={() => setShowMapTitle(false)}
                  >
                    <X />
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setShowMapTitle(true)}>
                    Map info
                  </Button>
                )}
              </div>
              {showMapTitle && (
                <div className="max-w-80 px-1 pb-1">
                  <p className="line-clamp-2 font-medium">{selected.title}</p>
                  <p className="mt-0.5 text-muted-foreground">{label}</p>
                </div>
              )}
            </MapOverlay>
          </AppMap>
        </MapSectionLayout>
      ) : catalogue ? (
        <MapLibrary
          title={catalogue.title}
          description={catalogue.description}
          items={libraryItems}
          facets={catalogue.facets}
          coverageSummary={coverageSummary}
          sourceMode={scope === 'sources'}
          onSourceGroup={filterBySource}
          toolbar={
            <>
              <div className="grid gap-x-5 sm:grid-cols-[auto_minmax(12rem,1fr)_auto] sm:items-center">
                {collectionControls}
              </div>
              {categoryControls}
              <p className="mt-2 text-xs text-muted-foreground">
                {formatNumber(libraryItems.length)}{' '}
                {scope === 'sources'
                  ? libraryItems.length === 1
                    ? 'source record'
                    : 'source records'
                  : scope === 'featured'
                    ? filtered.length === 1
                      ? 'curated selection'
                      : 'curated selections'
                    : filtered.length === 1
                      ? 'raster representation'
                      : 'raster representations'}
              </p>
            </>
          }
          sourceForm={sourceForm}
          getInitialScroll={getLibraryScroll}
          resetKey={scope + ':' + query + ':' + JSON.stringify(filters)}
          onScroll={(top) => {
            libraryScroll.current = top
          }}
          onPreview={previewImage}
          onMap={openMap}
        />
      ) : (
        <section className="mx-auto max-w-2xl px-5 pb-10 pt-24 md:pt-10">
          <h1 className="mb-4 text-2xl font-semibold">Open a shared map library</h1>
          {sourceForm}
          {loading && (
            <InlineAlert loading className="mt-4">
              Opening map library…
            </InlineAlert>
          )}
        </section>
      )}
      <MapImagePreview
        key={preview?.id || 'closed'}
        item={preview}
        facets={catalogue?.facets}
        onClose={() => setPreview(null)}
        onMap={openMap}
        onSheet={() => {
          setPreview(null)
          setSheetOpen(true)
        }}
        onDetails={() => {
          setPreview(null)
          setDetails(true)
        }}
      />
      <SourceImagePreview item={sourcePreview} facets={catalogue?.facets} onClose={() => setSourcePreview(null)} />
      <Dialog open={details} onOpenChange={setDetails}>
        <DialogContent elevated className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.title || 'Map notes'}</DialogTitle>
            <DialogDescription>
              {selected?.description || 'Source documents, placement limits and downloads.'}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-semibold">{label}</p>
          <OrganizationSummary value={selected?.organization} facets={catalogue?.facets} detail />
          <p className="text-sm leading-relaxed">{selected?.alignmentReview?.summary}</p>
          <p className="text-sm leading-relaxed">{selected?.caveat}</p>
          <h3 className="mt-2 font-semibold">Original-resolution GeoTIFFs</h3>
          {selected?.downloads.map((d, i) => (
            <ExternalLink key={d.url} href={d.url} className="flex break-all text-sm">
              Download panel {i + 1}
              {d.bytes ? ` · ${formatBytes(d.bytes)}` : ''}
            </ExternalLink>
          ))}
          <h3 className="mt-2 font-semibold">Source documents</h3>
          {selected?.sources.map((s) => (
            <ExternalLink key={s.url} href={s.url} className="flex text-sm">
              {s.title}
            </ExternalLink>
          ))}
          <p className="text-xs text-muted-foreground">
            Tiles preserve the recorded placement and available source detail. They do not establish geographic or
            survey accuracy.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent elevated className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{selected?.title} · source sheet</DialogTitle>
            <DialogDescription>
              Read the original available page and margins. This reading view does not apply the map panel’s geographic
              position.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              Page{' '}
              <select
                aria-label="Source page"
                value={sheetPage}
                onChange={(e) => {
                  setSheetPage(Number(e.target.value))
                  setLegend(false)
                }}
                className="rounded border bg-background p-2"
              >
                {selected?.fullSheets.map((s, i) => (
                  <option key={s.image} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant={legend ? 'outline' : 'default'} onClick={() => setLegend(false)}>
              Full sheet
            </Button>
            {sheet?.legend && (
              <Button size="sm" variant={legend ? 'default' : 'outline'} onClick={() => setLegend(true)}>
                Legend / notes crop
              </Button>
            )}
          </div>
          {sheet && (
            <>
              <img
                src={legend && sheet.legend ? sheet.legend.image : sheet.image}
                alt={`${selected?.title} — ${legend ? 'legend / notes' : 'complete source page'}`}
                referrerPolicy="no-referrer"
                className="max-h-[65dvh] w-full bg-stone-50 object-contain"
              />
              <ExternalLink href={legend && sheet.legend ? sheet.legend.image : sheet.image} className="text-sm">
                Open image at full available resolution
              </ExternalLink>
              <p className="text-xs text-muted-foreground">{sheet.sourceNote}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
