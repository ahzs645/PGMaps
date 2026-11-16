import { useElementSize } from '@/hooks/useElementSize'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileImage, Layers, MapPinned } from 'lucide-react'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CatalogueFacets, RasterRecord } from './catalogue'
import {
  activeFilters,
  isRaster,
  knownDate,
  libraryColumns,
  type FilterOptions,
  type LibraryItem,
  type OrganizationFilters,
} from './libraryOrganization'
import { ActiveFilterChips, FilterButton, FilterDialog, FilterRow } from './LibraryFilters'

type CardProps = {
  item: LibraryItem
  subject: string
  /** A card too narrow for "Open on map", and one too narrow to spell out its source link beside it. */
  compact: boolean
  shortSource: boolean
  onPreview: (item: LibraryItem) => void
  onMap: (item: RasterRecord) => void
  onSourceGroup?: (id: string) => void
}

/** How a map is placed, in the corner of its thumbnail. A source image has no placement to state. */
function placement(item: LibraryItem) {
  if (!isRaster(item)) return null
  const experimental = item.confidence === 'experimental'
  return {
    label: item.alignmentReview?.label || (experimental ? 'Experimental' : 'Provisional'),
    caution: experimental,
  }
}

function LibraryCard({ item, subject, compact, shortSource, onPreview, onMap, onSourceGroup }: CardProps) {
  const raster = isRaster(item)
  const organization = item.organization
  const status = placement(item)
  const detail = [
    knownDate(item.dateLabel),
    organization?.pageLabel,
    organization?.variantLabel,
    !raster ? item.imageLabel : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const siblings = raster && onSourceGroup && organization?.sourceGroupId ? organization.sourceGroupSize || 0 : 0
  return (
    <article
      aria-label={item.title}
      // A card on the page: under an Appearance theme the page has a colour of its own and this stays the card's.
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md"
    >
      {/* The thumbnail's button stretches over the whole card, so anywhere but the footer opens the image. */}
      <button
        type="button"
        onClick={() => onPreview(item)}
        aria-label={`${raster || item.image ? 'Preview image' : 'View source'}: ${item.title}`}
        className="relative block aspect-[4/3] w-full bg-muted outline-none after:absolute after:inset-0 after:z-[1] after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
      >
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-contain p-1.5"
          />
        ) : (
          <FileImage className="absolute inset-0 m-auto size-9 text-muted-foreground" aria-hidden="true" />
        )}
        {status && (
          <span className="absolute left-1.5 top-1.5 inline-flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-2xs font-medium leading-4 text-foreground shadow-sm">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', status.caution ? 'bg-warning' : 'bg-muted-foreground/60')}
              aria-hidden="true"
            />
            <span className="truncate">{status.label}</span>
          </span>
        )}
      </button>
      <div className={cn('flex flex-1 flex-col gap-0.5', compact ? 'p-2.5' : 'p-3')}>
        <h2 className="line-clamp-2 break-words text-sm font-semibold leading-snug">{item.title}</h2>
        {subject && <p className="truncate text-xs text-muted-foreground">{subject}</p>}
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
      {raster && (
        <div className="relative z-[2] flex items-center justify-between gap-1 border-t px-1.5 py-1">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 px-2"
            aria-label={`Open on map: ${item.title}`}
            onClick={() => onMap(item)}
          >
            <MapPinned />
            {compact ? 'Map' : 'Open on map'}
          </Button>
          {siblings > 1 && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 px-2 text-muted-foreground"
              aria-label={`Browse ${siblings} layers from this source`}
              title={`Browse ${siblings} layers from this source`}
              onClick={() => onSourceGroup!(organization!.sourceGroupId!)}
            >
              <Layers />
              {shortSource ? siblings : `${siblings} from this source`}
            </Button>
          )}
        </div>
      )}
    </article>
  )
}

const hasWidth = (size: { width: number }) => size.width > 0
export function MapLibrary({
  title,
  actions,
  notice,
  tabs,
  search,
  filters,
  countLabel,
  items,
  getInitialScroll,
  resetKey,
  onScroll,
  onPreview,
  onMap,
  onSourceGroup,
  onClear,
  facets,
}: {
  title: string
  /** Buttons at the end of the title row: share, the page menu. */
  actions?: ReactNode
  /** Anything that must be read before the list, such as a link to copy by hand. */
  notice?: ReactNode
  /** The scope switch (selections, all, source images), when the catalogue has more than one. */
  tabs?: ReactNode
  search: ReactNode
  filters: {
    values: OrganizationFilters
    options: FilterOptions
    sourceMode: boolean
    onChange: (next: OrganizationFilters) => void
  }
  /** What the list holds now, e.g. "126 of 902 maps". */
  countLabel: string
  items: LibraryItem[]
  getInitialScroll: () => number
  resetKey: string
  onScroll: (top: number) => void
  onPreview: (item: LibraryItem) => void
  onMap: (item: RasterRecord) => void
  onSourceGroup?: (id: string) => void
  /** Drop the search and every filter, offered when nothing matches. */
  onClear?: () => void
  facets?: CatalogueFacets
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // An empty grid has no height, so only a width of 0 (hidden) keeps the last one.
  const [start] = useState(() => ({ width: typeof window === 'undefined' ? 1200 : window.innerWidth - 32, height: 0 }))
  const { width } = useElementSize(grid, { initial: start, accept: hasWidth })
  const columns = libraryColumns(width)
  const gap = width < 600 ? 12 : 16
  const cardWidth = (width - gap * (columns - 1)) / columns
  const compact = cardWidth < 250
  const shortSource = cardWidth < 300
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(items.length / columns) }, (_, index) =>
        items.slice(index * columns, (index + 1) * columns),
      ),
    [items, columns],
  )
  const subjects = useMemo(() => new Map((facets?.subjects || []).map((facet) => [facet.id, facet.label])), [facets])
  const subjectOf = (item: LibraryItem) => {
    const ids = item.organization?.subjects || []
    const first = item.organization?.primarySubject || ids[0]
    if (!first) return ''
    const label = subjects.get(first) || first.replace(/[-_]+/g, ' ')
    return ids.length > 1 ? `${label} +${ids.length - 1}` : label
  }
  // One scroller at every size: the title scrolls away and the search stays.
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = getInitialScroll()
  }, [getInitialScroll, resetKey])
  const filterCount = activeFilters(filters.values, filters.options, filters.sourceMode).length
  return (
    <section
      aria-label="Map library"
      // The phone's floating navigation sits over this band, so the scroller starts below it.
      className="flex h-full min-h-0 flex-col bg-background pt-[calc(env(safe-area-inset-top)+3.75rem)] md:pt-0"
    >
      <div
        ref={scroll}
        data-map-sidebar-scroll="true"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      >
        <header className="flex items-center gap-2 bg-card px-4 pb-1 pt-1 sm:px-6 md:pt-4">
          <h1 className="line-clamp-2 min-w-0 flex-1 text-xl font-semibold leading-tight tracking-tight">{title}</h1>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
        {notice && <div className="bg-card px-4 pb-2 sm:px-6">{notice}</div>}
        {/* The title and toolbar are a card band over the page colour, so their fields read as fields under a theme.
            On a phone the scope switch scrolls out from under the search, which is the row that stays. */}
        <div
          className={cn('sticky z-10 border-b bg-card px-4 py-2 sm:top-0 sm:px-6', tabs ? 'top-[-3.5rem]' : 'top-0')}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            {tabs}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="min-w-0 flex-1">{search}</div>
              <FilterButton className="lg:hidden" count={filterCount} onClick={() => setFiltersOpen(true)} />
            </div>
          </div>
          <FilterRow className="mt-2 hidden lg:flex" {...filters} />
        </div>
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-6">
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
            <p role="status" className="shrink-0 text-xs text-muted-foreground">
              {countLabel}
            </p>
            <ActiveFilterChips className="lg:hidden" {...filters} />
          </div>
          {!items.length && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <p>Nothing matches this search and these filters.</p>
              {onClear && (
                <Button variant="outline" size="sm" className="mt-3" onClick={onClear}>
                  Clear search and filters
                </Button>
              )}
            </div>
          )}
          {/* The shared list rules its rows; a grid of cards has its own edges. */}
          <div ref={grid} className="[&_[role=listitem]]:border-b-0">
            <VirtualResultList
              items={rows}
              getKey={(row) => row.map((item) => item.id).join('|')}
              estimateSize={Math.round(cardWidth * 0.75) + 130 + gap}
              label="Map previews"
            >
              {(row) => (
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap, paddingBottom: gap }}
                >
                  {row.map((item) => (
                    <LibraryCard
                      key={item.id}
                      item={item}
                      subject={subjectOf(item)}
                      compact={compact}
                      shortSource={shortSource}
                      onPreview={onPreview}
                      onMap={onMap}
                      onSourceGroup={onSourceGroup}
                    />
                  ))}
                </div>
              )}
            </VirtualResultList>
          </div>
        </div>
      </div>
      <FilterDialog open={filtersOpen} onClose={() => setFiltersOpen(false)} resultLabel={countLabel} {...filters} />
    </section>
  )
}
