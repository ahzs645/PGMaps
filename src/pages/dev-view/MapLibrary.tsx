import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { FileImage, MapPinned } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CatalogueFacets, RasterRecord } from './catalogue'
import { isRaster, type LibraryItem } from './libraryOrganization'
import { OrganizationSummary } from './OrganizationSummary'

export function MapLibrary({
  title,
  description,
  items,
  toolbar,
  sourceForm,
  getInitialScroll,
  resetKey,
  onScroll,
  onPreview,
  onMap,
  onSourceGroup,
  facets,
  coverageSummary,
  sourceMode = false,
}: {
  title: string
  description?: string
  items: LibraryItem[]
  toolbar: ReactNode
  sourceForm: ReactNode
  getInitialScroll: () => number
  resetKey: string
  onScroll: (top: number) => void
  onPreview: (item: LibraryItem) => void
  onMap: (item: RasterRecord) => void
  onSourceGroup?: (id: string) => void
  facets?: CatalogueFacets
  coverageSummary?: string
  sourceMode?: boolean
}) {
  const wide = useMediaQuery('(min-width: 1280px)')
  const medium = useMediaQuery('(min-width: 640px)')
  const desktop = useMediaQuery('(min-width: 768px)')
  const columns = wide ? 3 : medium ? 2 : 1
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(items.length / columns) }, (_, index) =>
        items.slice(index * columns, (index + 1) * columns),
      ),
    [items, columns],
  )
  // The virtual list follows the same scrolling element as the visible page:
  // the whole library on phones, and just the cards below the desktop toolbar.
  const pageScroll = useRef<HTMLElement>(null)
  const cardScroll = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroll = desktop ? cardScroll.current : pageScroll.current
    if (scroll) scroll.scrollTop = getInitialScroll()
  }, [desktop, getInitialScroll, resetKey])
  return (
    <section
      ref={pageScroll}
      data-map-sidebar-scroll={!desktop ? 'true' : undefined}
      className="h-full min-h-0 overflow-y-auto scroll-pt-[calc(env(safe-area-inset-top)+4.5rem)] bg-muted/30 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:flex md:flex-col md:overflow-hidden md:scroll-pt-0 md:pt-0"
      aria-label="Map library"
      onScroll={(event) => {
        if (!desktop) onScroll(event.currentTarget.scrollTop)
      }}
    >
      <header className="border-b bg-background px-4 py-4 sm:px-6 md:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Map library</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-2 hidden max-w-3xl text-sm text-muted-foreground sm:block">{description}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            {sourceMode
              ? 'Available source images and archive leads. These records have no geographic placement.'
              : 'Browse the images, then open a map to explore its placement.'}
          </p>
          {coverageSummary && <p className="mt-2 text-xs text-muted-foreground">{coverageSummary}</p>}
          <details className="mt-3 text-sm">
            <summary className="w-fit cursor-pointer text-muted-foreground">Open another map URL</summary>
            <div className="mt-3 max-w-2xl">{sourceForm}</div>
          </details>
        </div>
      </header>
      <div className="border-b bg-background px-4 py-3 sm:px-6 md:max-h-[45dvh] md:shrink-0 md:overflow-y-auto md:px-8">
        <div className="mx-auto max-w-7xl">{toolbar}</div>
      </div>
      <div
        ref={cardScroll}
        data-map-sidebar-scroll={desktop ? 'true' : undefined}
        className="px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-6 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain md:px-8"
        onScroll={(event) => {
          if (desktop) onScroll(event.currentTarget.scrollTop)
        }}
      >
        <div className="mx-auto max-w-7xl pt-4">
          {!items.length && (
            <p role="status" className="py-12 text-center text-sm text-muted-foreground">
              No records match these filters.
            </p>
          )}
          <VirtualResultList
            items={rows}
            getKey={(row) => row.map((item) => item.id).join('|')}
            estimateSize={390}
            label="Map previews"
          >
            {(row) => (
              <div className="grid gap-4 pb-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {row.map((item) => (
                  <article
                    key={item.id}
                    className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
                    aria-label={item.title}
                  >
                    <button
                      type="button"
                      onClick={() => onPreview(item)}
                      aria-label={`${isRaster(item) || item.image ? 'Preview image' : 'View source'}: ${item.title}`}
                      className="flex h-48 w-full items-center justify-center border-b bg-stone-100 p-2 focus-visible:outline-2 focus-visible:outline-ring dark:bg-zinc-900"
                    >
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          width={600}
                          height={420}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <FileImage className="size-10 text-muted-foreground" />
                      )}
                    </button>
                    <div className="flex flex-1 flex-col items-start gap-2 p-4">
                      <h2 className="line-clamp-2 min-h-10 break-words text-sm font-semibold leading-5">
                        {item.title}
                      </h2>
                      <p className="line-clamp-1 w-full text-xs text-muted-foreground">
                        {item.dateLabel ||
                          (isRaster(item) ? item.subtitle : item.imageLabel) ||
                          (isRaster(item) ? 'Archive map' : 'Source record')}
                      </p>
                      <Badge tone={isRaster(item) && item.confidence === 'experimental' ? 'warning' : 'neutral'}>
                        {isRaster(item)
                          ? item.alignmentReview?.label ||
                            (item.confidence === 'experimental' ? 'Experimental' : 'Provisional')
                          : 'Not georeferenced'}
                      </Badge>
                      <OrganizationSummary value={item.organization} facets={facets} />
                      {isRaster(item) &&
                        !!onSourceGroup &&
                        !!item.organization?.sourceGroupId &&
                        (item.organization.sourceGroupSize || 0) > 1 && (
                          <button
                            type="button"
                            className="text-left text-xs underline underline-offset-2"
                            onClick={() => onSourceGroup(item.organization!.sourceGroupId!)}
                          >
                            Browse {item.organization.sourceGroupSize} layers from this source
                          </button>
                        )}
                      <div className="mt-auto flex w-full flex-wrap gap-2 pt-2">
                        <Button size="sm" onClick={() => onPreview(item)}>
                          <FileImage />
                          {isRaster(item) || item.image ? 'View image' : 'View source'}
                        </Button>
                        {isRaster(item) && (
                          <Button size="sm" variant="outline" onClick={() => onMap(item)}>
                            <MapPinned />
                            Open on map
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </VirtualResultList>
        </div>
      </div>
    </section>
  )
}
