import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileImage, Link2, MapPinned, Search } from 'lucide-react'
import type { StyleSpecification } from 'maplibre-gl'
import { Map as AppMap } from '@/components/ui/map'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { InlineAlert, MapOverlay, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { ResultRow, ListHeader } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatBytes } from '@/lib/format'
import { loadCatalogue, shareLink, type RasterCatalogue, type RasterRecord } from './dev-view/catalogue'
import { RasterMapLayer } from './dev-view/RasterMapLayer'

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

export default function DevView() {
  const [source, setSource] = useState(() => params().get('catalog') || '')
  const [input, setInput] = useState(source)
  const [catalogue, setCatalogue] = useState<RasterCatalogue | null>(null)
  const [selectedId, setSelectedId] = useState(() => params().get('map') || '')
  const [scope, setScope] = useState<'featured' | 'all'>('featured')
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
    () =>
      candidates.filter((i) =>
        [i.title, i.subtitle, i.description, i.dateLabel].join(' ').toLowerCase().includes(query.toLowerCase()),
      ),
    [candidates, query],
  )
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
        setScope(value.featured.some((x) => x.id === item.id) ? 'featured' : 'all')
        setQuery('')
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
    if (source && selectedId) history.replaceState(null, '', shareLink(source, selectedId))
  }, [source, selectedId])
  useEffect(() => {
    const change = () => {
      const p = params()
      setSource(p.get('catalog') || '')
      setInput(p.get('catalog') || '')
      if (p.get('map')) setSelectedId(p.get('map') || '')
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  const choose = useCallback((item: RasterRecord) => {
    setSelectedId(item.id)
    setTileError('')
    setSheetPage(0)
    setLegend(false)
  }, [])
  const sheet = selected?.fullSheets[sheetPage]
  const label =
    selected?.alignmentReview?.label ||
    (selected?.confidence === 'experimental' ? 'Experimental placement' : 'Provisional placement')
  const sidebar = (
    <MapSidebarShell
      title={catalogue?.title || 'Open a shared map'}
      subtitle={
        catalogue
          ? `${catalogue.representationCount.toLocaleString()} raster representations`
          : 'Browse maps from a share link or data URL'
      }
      icon={MapPinned}
      className={MAP_SIDEBAR_CLASS}
    >
      <SidebarSection title="Map URL" icon={Link2}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
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
      </SidebarSection>
      {catalogue && (
        <>
          <SidebarSection title="Collection">
            <p className="text-xs text-muted-foreground">{catalogue.description}</p>
            {!!catalogue.featured.length && (
              <SegmentedControl
                label="Map scope"
                className="mt-3"
                value={scope}
                onChange={(value) => {
                  const next = value as 'featured' | 'all'
                  setScope(next)
                  setQuery('')
                  choose((next === 'featured' ? catalogue.featured : catalogue.items)[0])
                }}
                options={[
                  { value: 'featured', label: `Selections ${catalogue.featured.length}` },
                  { value: 'all', label: `All ${catalogue.items.length}` },
                ]}
              />
            )}
            <div className="relative mt-3">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <label htmlFor="shared-map-search" className="sr-only">
                Search maps
              </label>
              <input
                id="shared-map-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a map or source…"
                className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm"
              />
            </div>
            <CopyButton
              text={() => shareLink(source, selectedId)}
              className="mt-3 text-xs underline underline-offset-4"
              onResult={(result) => {
                if (!result.copied && result.text) setManualShare(result.text)
              }}
            >
              Copy this map’s share link
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
          </SidebarSection>
          {selected && (
            <SidebarSection title="Selected map">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{label}</p>
              <h2 className="mt-1 text-sm font-semibold">{selected.title}</h2>
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
                onClick={() => choose(item)}
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
      <MapSectionLayout
        sidebar={sidebar}
        desktopSidebarWidth={390}
        mobileInitialSheetState="half"
        mobilePeekTitle={catalogue?.title || 'Shared map viewer'}
        mobilePeekSubtitle={selected?.title || 'Open a map URL'}
      >
        <AppMap
          className="h-full w-full"
          center={[-125.2, 53.75]}
          zoom={9}
          maxZoom={22}
          styles={styles}
          showStyleLoadingOverlay={false}
          loading={loading}
        >
          <RasterMapLayer item={selected} opacity={opacity} onError={setTileError} />
          {selected && (
            <MapOverlay position="top-left" className="max-w-[calc(100%-5rem)] p-2 text-xs">
              <span className="font-medium">{selected.title}</span>
              <span className="mt-0.5 block text-muted-foreground">{label} · tiles load as you zoom</span>
            </MapOverlay>
          )}
        </AppMap>
      </MapSectionLayout>
      <Dialog open={details} onOpenChange={setDetails}>
        <DialogContent elevated className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.title || 'Map notes'}</DialogTitle>
            <DialogDescription>
              {selected?.description || 'Source documents, placement limits and downloads.'}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-sm leading-relaxed">{selected?.alignmentReview?.summary}</p>
          <p className="text-sm leading-relaxed">{selected?.caveat}</p>
          <h3 className="mt-2 font-semibold">Original-resolution GeoTIFFs</h3>
          {selected?.downloads.map((d, i) => (
            <a
              key={d.url}
              href={d.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block break-all text-sm underline"
            >
              Download panel {i + 1}
              {d.bytes ? ` · ${formatBytes(d.bytes)}` : ''}
              <ExternalLink className="ml-1 inline size-3" />
            </a>
          ))}
          <h3 className="mt-2 font-semibold">Source documents</h3>
          {selected?.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="block text-sm underline">
              {s.title}
              <ExternalLink className="ml-1 inline size-3" />
            </a>
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
              <a
                href={legend && sheet.legend ? sheet.legend.image : sheet.image}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm underline"
              >
                Open image at full available resolution ↗
              </a>
              <p className="text-xs text-muted-foreground">{sheet.sourceNote}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
