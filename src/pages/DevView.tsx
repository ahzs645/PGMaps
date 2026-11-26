import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileImage, Info, Library, Link2, MapPinned, X } from 'lucide-react'
import type { StyleSpecification } from 'maplibre-gl'
import { Map as AppMap } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { textColumn } from '@/components/map/tableColumns'
import { MapTableBridge, defineTableSource, useMapTable } from '@/components/map/useMapTable'
import {
  InlineAlert,
  KeyValueRows,
  MapOverlay,
  MapSidebarShell,
  SearchInput,
  SidebarSection,
} from '@/components/ui/map-panels'
import { ActionMenu } from '@/components/ui/action-menu'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { ResultRow, ListHeader } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { Button, buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
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
import { sourceImageChoices } from './dev-view/sourceImages'
import { SourceImagePreview } from './dev-view/SourceImagePreview'
import { LibraryFilters } from './dev-view/LibraryFilters'
import { OrganizationSummary } from './dev-view/OrganizationSummary'
import { georeferenceLink } from './dev-georeference/links'
import {
  EMPTY_FILTERS,
  isRaster,
  matchesLibraryItem,
  organizationOptions,
  resultCount,
  type LibraryItem,
} from './dev-view/libraryOrganization'
import { cn } from '@/lib/utils'
import { StyledSelect } from '@/components/ui/styled-select'
import { STREET_RASTER_STYLE } from '@/lib/geo/streetRasterStyle'

const STREET = STREET_RASTER_STYLE
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
  const [urlOpen, setUrlOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
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
  const filterProps = {
    values: filters,
    options: filterOptions,
    sourceMode: scope === 'sources',
    onChange: changeFilters,
  }
  const scopeTotal = catalogue
    ? scope === 'sources'
      ? catalogue.unplacedSources.length
      : scope === 'featured' && catalogue.featured.length
        ? catalogue.featured.length
        : catalogue.items.length
    : 0
  const countLabel = resultCount(libraryItems.length, scopeTotal, scope)
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
          setUrlOpen(false)
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
  const hasScopes = !!catalogue && (!!catalogue.featured.length || !!catalogue.unplacedSources.length)
  const scopeTabs = (className?: string) =>
    catalogue &&
    hasScopes && (
      <SegmentedControl
        label="Map scope"
        className={className}
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
            ? [{ value: 'featured', label: `Selections ${formatNumber(catalogue.featured.length)}` }]
            : []),
          { value: 'all', label: `All ${formatNumber(catalogue.items.length)}` },
          ...(catalogue.unplacedSources.length
            ? [{ value: 'sources', label: `Source images ${formatNumber(catalogue.unplacedSources.length)}` }]
            : []),
        ]}
      />
    )
  const searchField = (wrapperClassName?: string) => (
    <>
      <label htmlFor="shared-map-search" className="sr-only">
        Search maps
      </label>
      <SearchInput
        id="shared-map-search"
        icon
        wrapperClassName={wrapperClassName}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          libraryScroll.current = 0
        }}
        onClear={() => {
          setQuery('')
          libraryScroll.current = 0
        }}
        placeholder={scope === 'sources' ? 'Search source images…' : 'Search maps…'}
      />
    </>
  )
  const copyLink = (
    <CopyButton
      text={() => shareLink(source, view === 'map' ? selectedId : undefined, view)}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
      copiedLabel={
        <>
          <Link2 />
          Link copied
        </>
      }
      onResult={(result) => setManualShare(!result.copied && result.text ? result.text : '')}
    >
      <Link2 />
      Copy link
    </CopyButton>
  )
  const manualLink = manualShare && (
    <label className="block text-xs text-muted-foreground">
      The link could not be copied for you. Copy it here:
      <input
        readOnly
        value={manualShare}
        onFocus={(e) => e.target.select()}
        className="mt-1 w-full rounded-md border bg-background p-2 text-foreground"
      />
    </label>
  )
  const sidebar = (
    <MapSidebarShell
      title={catalogue?.title || 'Open a shared map'}
      subtitle={catalogue ? resultCount(catalogue.items.length, catalogue.items.length, 'all') : undefined}
      icon={MapPinned}
      className={MAP_SIDEBAR_CLASS}
    >
      {catalogue && (
        <>
          {selected && (
            <SidebarSection title="Selected map">
              <h2 className="text-sm font-semibold leading-snug">{selected.title}</h2>
              <p className="mt-1 text-xs font-medium text-warning-foreground">{label}</p>
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
                className="mt-2"
                value={base}
                onChange={(v) => setBase(v as 'street' | 'satellite')}
                options={[
                  { value: 'satellite', label: 'Satellite' },
                  { value: 'street', label: 'Street map' },
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {(!!sourceImageChoices(selected).length || !!selected.sources.length) && (
                  <Button variant="outline" size="sm" onClick={() => setPreview(selected)}>
                    <FileImage />
                    Source image
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setDetails(true)}>
                  Notes & sources
                </Button>
                {!!selected.downloads.length && (
                  <Button variant="outline" size="sm" onClick={() => navigate(georeferenceLink(source, selected.id))}>
                    Adjust alignment
                  </Button>
                )}
                {copyLink}
              </div>
              {manualLink && <div className="mt-2">{manualLink}</div>}
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
          <SidebarSection title="All maps">
            {scopeTabs('mb-3')}
            {searchField()}
            <LibraryFilters {...filterProps} />
          </SidebarSection>
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
          items={libraryItems}
          facets={catalogue.facets}
          // Once one source's layers are listed, each card's link to them would lead back here.
          onSourceGroup={filters.sourceGroup ? undefined : filterBySource}
          actions={
            <>
              {copyLink}
              <ActionMenu
                label="More"
                triggerClassName="size-9"
                items={[
                  {
                    id: 'about',
                    label: 'About this collection',
                    icon: <Info className="size-4" />,
                    onSelect: () => setAboutOpen(true),
                  },
                  {
                    id: 'url',
                    label: 'Open another map URL…',
                    icon: <Link2 className="size-4" />,
                    onSelect: () => setUrlOpen(true),
                  },
                ]}
              />
            </>
          }
          notice={manualLink}
          tabs={scopeTabs('h-12 shrink-0 overflow-x-auto sm:h-10')}
          search={searchField()}
          filters={filterProps}
          countLabel={countLabel}
          onClear={() => {
            setQuery('')
            changeFilters({ ...EMPTY_FILTERS })
          }}
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
        onGeoreference={(item) => navigate(georeferenceLink(source, item.id))}
        onSheet={() => {
          const page = preview?.fullSheets.findIndex((sheet) => !!sheet.legend) ?? -1
          setSheetPage(Math.max(0, page))
          setLegend(page >= 0)
          setPreview(null)
          setSheetOpen(true)
        }}
        onDetails={() => {
          setPreview(null)
          setDetails(true)
        }}
      />
      <SourceImagePreview
        item={sourcePreview}
        facets={catalogue?.facets}
        onClose={() => setSourcePreview(null)}
        onGeoreference={(item) => navigate(georeferenceLink(source, undefined, item.id))}
      />
      <PanelDialog
        open={details}
        onOpenChange={setDetails}
        size="md"
        title={selected?.title || 'Map notes'}
        subtitle={label}
      >
        <div className="space-y-3">
          {selected?.description && <p className="text-sm leading-relaxed">{selected.description}</p>}
          <OrganizationSummary value={selected?.organization} facets={catalogue?.facets} detail />
          {selected?.alignmentReview?.summary && (
            <p className="text-sm leading-relaxed">{selected.alignmentReview.summary}</p>
          )}
          {selected?.caveat && <p className="text-sm leading-relaxed">{selected.caveat}</p>}
          {!!selected?.downloads.length && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Rectified GeoTIFFs</h3>
              {selected.downloads.map((d, i) => (
                <ExternalLink key={d.url} href={d.url} className="flex break-all text-sm">
                  {d.label || `Download rectified panel ${i + 1}`}
                  {d.width && d.height ? ` · ${d.width.toLocaleString()} × ${d.height.toLocaleString()} px` : ''}
                  {d.bytes ? ` · ${formatBytes(d.bytes)}` : ''}
                </ExternalLink>
              ))}
            </div>
          )}
          {!!selected?.sources.length && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Source documents</h3>
              {selected.sources.map((s) => (
                <ExternalLink key={s.url} href={s.url} className="flex text-sm">
                  {s.title}
                </ExternalLink>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Tiles preserve the recorded placement and available source detail. They do not establish geographic or
            survey accuracy.
          </p>
        </div>
      </PanelDialog>
      <PanelDialog
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        size="xl"
        title={selected?.title || 'Source sheet'}
        subtitle="Reading sheet and legend"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {(selected?.fullSheets.length || 0) > 1 && (
              <StyledSelect
                aria-label="Source page"
                value={sheetPage}
                onChange={(e) => {
                  setSheetPage(Number(e.target.value))
                  setLegend(false)
                }}
                className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
              >
                {selected?.fullSheets.map((s, i) => (
                  <option key={s.image} value={i}>
                    {s.label}
                  </option>
                ))}
              </StyledSelect>
            )}
            {sheet?.legend && (
              <SegmentedControl
                label="Sheet view"
                size="sm"
                fullWidth={false}
                value={legend ? 'legend' : 'sheet'}
                onChange={(value) => setLegend(value === 'legend')}
                options={[
                  { value: 'sheet', label: 'Full sheet' },
                  { value: 'legend', label: 'Legend / notes' },
                ]}
              />
            )}
          </div>
        }
      >
        {sheet && (
          <div className="space-y-2">
            <img
              src={legend && sheet.legend ? sheet.legend.image : sheet.image}
              alt={`${selected?.title} — ${legend ? 'legend / notes' : 'complete source page'}`}
              referrerPolicy="no-referrer"
              className="max-h-[70dvh] w-full rounded-lg border bg-muted object-contain"
            />
            <ExternalLink href={legend && sheet.legend ? sheet.legend.image : sheet.image} className="text-sm">
              Open image at full available resolution
            </ExternalLink>
            {sheet.sourceNote && <p className="text-xs text-muted-foreground">{sheet.sourceNote}</p>}
          </div>
        )}
      </PanelDialog>
      <PanelDialog open={urlOpen} onOpenChange={setUrlOpen} size="md" title="Open another map URL">
        {sourceForm}
      </PanelDialog>
      <PanelDialog open={aboutOpen} onOpenChange={setAboutOpen} size="md" title={catalogue?.title || 'About'}>
        {catalogue && (
          <div className="space-y-3">
            {catalogue.description && <p className="text-sm leading-relaxed">{catalogue.description}</p>}
            <KeyValueRows
              variant="divided"
              size="sm"
              rows={[
                { label: 'Maps', value: formatNumber(catalogue.items.length) },
                ...(catalogue.featured.length
                  ? [{ label: 'Curated selections', value: formatNumber(catalogue.featured.length) }]
                  : []),
                ...(catalogue.coverage?.sourceDocuments
                  ? [{ label: 'Source documents', value: formatNumber(catalogue.coverage.sourceDocuments) }]
                  : []),
                ...(catalogue.unplacedSources.length
                  ? [
                      {
                        label: 'Source images without a placement',
                        value: formatNumber(catalogue.unplacedSources.length),
                      },
                    ]
                  : []),
              ]}
            />
            {catalogue.notes && <p className="text-xs leading-relaxed text-muted-foreground">{catalogue.notes}</p>}
          </div>
        )}
      </PanelDialog>
    </>
  )
}
