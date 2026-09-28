import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Palette } from 'lucide-react'
import { DevPageHeader } from '@/components/DevPageHeader'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { InlineAlert, MapSidebarShell, SearchInput } from '@/components/ui/map-panels'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { downloadText } from '@/lib/download'
import { ScaleLab } from './dev-color-palettes/ScaleLab'
import catalogData from './dev-color-palettes/catalog.generated.json'
import type { ColorCatalog } from './dev-color-palettes/types'

const catalog = catalogData as ColorCatalog
const THEME_LABELS = {
  same: 'Same / single palette',
  different: 'Different light & dark',
  unknown: 'Needs theme review',
}
const KIND_LABELS: Record<string, string> = {
  utility: 'Tailwind shades',
  ordered: 'Ordered palettes',
  heatmap: 'Heatmap ramps',
  categorical: 'Categories',
  diverging: 'Diverging',
  bivariate: 'Bivariate',
  reference: 'Published / calibrated',
  basemap: 'Basemap themes',
  unclassified: 'Other colour sets',
  source: 'Other source colours',
}

export default function DevColorPalettes() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [theme, setTheme] = useState('all')
  const [literalQuery, setLiteralQuery] = useState('')
  const selected =
    catalog.palettes.find((p) => p.id === params.get('palette')) ??
    catalog.palettes.find((p) => p.name === 'COLOR_SCALES.blue') ??
    catalog.palettes[0]
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.palettes.filter(
      (p) =>
        (kind === 'all' || p.kind === kind) &&
        (theme === 'all' || p.theme.status === theme) &&
        [p.name, p.file, ...p.colors, ...p.pages.map((page) => page.href)].some((v) => v.toLowerCase().includes(q)),
    )
  }, [query, kind, theme])
  const literals = useMemo(() => {
    const q = literalQuery.trim().toLowerCase()
    return catalog.inventory.filter(
      (r) => r.color.includes(q) || r.locations.some((l) => l.file.toLowerCase().includes(q)),
    )
  }, [literalQuery])
  return (
    <div className="mx-auto max-w-[1500px] space-y-7 px-4 pb-12 pt-24 sm:px-6 md:pt-10">
      <DevPageHeader
        eyebrow="Dev playground"
        icon={Palette}
        title="Colour palettes & scales"
        description="Inspect the colours we already use, find their source pages, and experiment with a smaller part of a palette in light and dark mode."
        actions={
          <Button variant="outline" asChild>
            <Link to="/dev">All dev pages</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span>{catalog.palettes.length} palette / source groups</span>
        <span>{catalog.distinctLiterals} literal colour spellings</span>
        <span>{catalog.tailwind.uniqueTokens} Tailwind colour classes</span>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3">
          <SearchInput
            icon
            aria-label="Search palettes and pages"
            placeholder="Palette, colour, page or source…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
          />
          <AppSelect
            triggerAriaLabel="Palette type"
            value={kind}
            onValueChange={setKind}
            options={[
              { value: 'all', label: 'All palette and source groups' },
              ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <AppSelect
            triggerAriaLabel="Light and dark behaviour"
            value={theme}
            onValueChange={setTheme}
            options={[
              { value: 'all', label: 'All light / dark behaviour' },
              ...Object.entries(THEME_LABELS).map(([value, label]) => ({
                value,
                label: `${label} (${catalog.palettes.filter((p) => p.theme.status === value).length})`,
              })),
            ]}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Compares authored colours. A single palette can look different on different backgrounds. Counts are catalog
            entries, including both members of a theme pair.
          </p>
          <div className="h-[280px] overflow-hidden rounded-lg border lg:h-[600px]">
            <MapSidebarShell
              title={`${matches.length} results`}
              subtitle="Choose a palette to inspect"
              className="border-r-0 shadow-none"
              titleClassName="text-sm"
            >
              {!matches.length && <p className="p-4 text-sm text-muted-foreground">No matching palettes or sources.</p>}
              <VirtualResultList items={matches} getKey={(p) => p.id} estimateSize={118} label="Colour palette results">
                {(p) => (
                  <button
                    type="button"
                    aria-pressed={selected.id === p.id}
                    onClick={() => {
                      const next = new URLSearchParams(params)
                      next.set('palette', p.id)
                      setParams(next, { replace: true, preventScrollReset: true })
                    }}
                    className="block w-full space-y-2 p-3 text-left hover:bg-accent aria-pressed:bg-accent"
                  >
                    <span className="block break-words text-sm font-medium">
                      {p.name.replace('Other colours · ', '')}
                    </span>
                    <span className="flex h-4 overflow-hidden rounded" aria-hidden="true">
                      {p.colors.map((color, i) => (
                        <span key={i} className="min-w-0 flex-1" style={{ background: color }} />
                      ))}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {KIND_LABELS[p.kind]} · {p.pages.length} page candidates
                    </span>
                    <span className="block text-xs text-muted-foreground">{THEME_LABELS[p.theme.status]}</span>
                  </button>
                )}
              </VirtualResultList>
            </MapSidebarShell>
          </div>
        </aside>
        <section className="min-w-0 space-y-5" aria-label="Selected palette">
          <div>
            <h2 className="break-words text-xl font-semibold">{selected.name}</h2>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {selected.file}
              {selected.line ? `:${selected.line}` : (selected.pointer ?? '')}
            </p>
          </div>
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">{THEME_LABELS[selected.theme.status]}</p>
            <p className="text-xs leading-5 text-muted-foreground">{selected.theme.evidence}</p>
            {selected.theme.counterpartId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set('palette', selected.theme.counterpartId!)
                  setParams(next, { replace: true, preventScrollReset: true })
                }}
              >
                View {selected.theme.variant === 'light' ? 'dark' : 'light'} definition
              </Button>
            )}
          </div>
          {selected.directPages.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Explicit palette references / package ownership</h3>
              <div className="flex flex-wrap gap-2">
                {selected.directPages.map((p) => (
                  <Link key={p.href} to={p.href} className="text-sm underline underline-offset-2" title={p.evidence}>
                    {p.href}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <details className="rounded-lg border p-3" open={selected.pages.length <= 4} key={`pages-${selected.id}`}>
            <summary className="cursor-pointer text-sm font-medium">
              Pages using this source ({selected.pages.length})
            </summary>
            <p className="my-3 text-xs leading-5 text-muted-foreground">
              Project links are exact package ownership. Other links follow static imports to the source module; a page
              may use a different export or enable it only in a particular layer. These are candidates, not runtime
              usage counts.
            </p>
            <div className="flex flex-wrap gap-2">
              {selected.pages.map((p) => (
                <Link
                  key={p.href}
                  to={p.href}
                  className="rounded border px-2 py-1 text-xs underline underline-offset-2"
                  title={p.evidence}
                >
                  {p.href}
                </Link>
              ))}
            </div>
            {!selected.pages.length && (
              <p className="text-sm text-muted-foreground">
                No routed consumer was identified by the static import scan.
              </p>
            )}
          </details>
          <ScaleLab
            key={selected.id}
            palette={selected}
            counterpart={catalog.palettes.find((p) => p.id === selected.theme.counterpartId)}
          />
        </section>
      </div>
      <details className="border-t pt-5">
        <summary className="cursor-pointer text-lg font-semibold">
          All captured colour literals and source locations
        </summary>
        <div className="mt-4 space-y-3">
          <SearchInput
            aria-label="Search colour literals"
            value={literalQuery}
            onChange={(e) => setLiteralQuery(e.target.value)}
            placeholder="Hex, CSS colour or source file…"
          />
          <div className="h-96 overflow-hidden rounded-lg border">
            <MapSidebarShell title={`${literals.length} literal spellings`} className="border-r-0 shadow-none">
              <VirtualResultList
                items={literals}
                getKey={(r) => r.color}
                estimateSize={80}
                label="Colour literal results"
              >
                {(r) => (
                  <details className="p-3">
                    <summary className="cursor-pointer break-all text-sm">
                      <span
                        className="mr-2 inline-block h-5 w-5 rounded border align-middle"
                        style={{ background: r.color }}
                      />
                      <code>{r.color}</code> · {r.occurrences} occurrences
                    </summary>
                    <div className="mt-2 space-y-1">
                      {r.locations.map((l) => (
                        <p key={`${l.file}:${l.line}`} className="break-all text-xs text-muted-foreground">
                          {l.file}:{l.line}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </VirtualResultList>
            </MapSidebarShell>
          </div>
        </div>
      </details>
      <section className="space-y-4 border-t pt-5">
        <h2 className="text-lg font-semibold">Standardization priorities</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>One resolved scale for map colours, numeric thresholds, legends and downloads.</li>
          <li>
            Theme-aware label, halo, boundary, selection and missing-data roles; reviewed palette ranges for each theme.
          </li>
          <li>
            Keep published scales, categorical identities and diverging centres explicit. Do not invert a palette just
            because the background changes.
          </li>
          <li>
            Keep comparison domains fixed across years; automatic quantiles describe the chosen data distribution.
          </li>
        </ul>
        <InlineAlert title="Inventory coverage">
          {catalog.scope} The generated catalog must be refreshed after colour or route changes with{' '}
          <code>node scripts/audit-map-colors.mjs</code>. Type labels are audit hints, not verified cartographic
          semantics.
        </InlineAlert>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() =>
              downloadText(JSON.stringify(catalog, null, 2), 'pgmaps-colour-inventory.json', 'application/json')
            }
          >
            Download colour inventory
          </Button>
          <a
            className="self-center text-sm underline"
            href="https://d3js.org/d3-scale/quantize"
            target="_blank"
            rel="noreferrer"
          >
            D3 classification
          </a>
          <a
            className="self-center text-sm underline"
            href="https://colorbrewer2.org/learnmore/schemes_full.html"
            target="_blank"
            rel="noreferrer"
          >
            Colour scheme guidance
          </a>
        </div>
      </section>
    </div>
  )
}
