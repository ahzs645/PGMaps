import { useEffect, useState } from 'react'
import { FileImage, MapPinned } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OrganizationSummary } from './OrganizationSummary'
import type { CatalogueFacets, RasterRecord } from './catalogue'

export function MapImagePreview({
  item,
  onClose,
  onMap,
  onSheet,
  onDetails,
  facets,
}: {
  item: RasterRecord | null
  onClose: () => void
  onMap: (item: RasterRecord) => void
  onSheet: () => void
  onDetails: () => void
  facets?: CatalogueFacets
}) {
  const [image, setImage] = useState<{ id: string; url?: string; error?: string }>({ id: '' })
  useEffect(() => {
    if (!item) return
    const abort = new AbortController()
    let url: string | undefined
    import('./rasterPreview')
      .then(({ rasterPreview }) => rasterPreview(item, abort.signal))
      .then((blob) => {
        if (abort.signal.aborted) return
        url = URL.createObjectURL(blob)
        setImage({ id: item.id, url })
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setImage({
            id: item.id,
            error: 'The larger image could not load. You can still open this map or download its original.',
          })
      })
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [item])
  const current = image.id === item?.id ? image : null
  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent elevated className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{item?.title}</DialogTitle>
          <DialogDescription>
            {item?.dateLabel || item?.organization?.pageLabel || 'Map image preview'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={item?.confidence === 'experimental' ? 'warning' : 'neutral'}>
            {item?.alignmentReview?.label ||
              (item?.confidence === 'experimental' ? 'Experimental placement' : 'Provisional placement')}
          </Badge>
          {!current?.url && !current?.error && (
            <span role="status" className="text-xs text-muted-foreground">
              Loading larger image…
            </span>
          )}
        </div>
        <div className="flex min-h-40 items-center justify-center rounded-lg border bg-stone-100 dark:bg-zinc-900">
          {current?.url || item?.thumbnail ? (
            <img
              src={current?.url || item?.thumbnail}
              alt={`${item?.title} · map image`}
              referrerPolicy="no-referrer"
              className="max-h-[52dvh] w-full object-contain"
            />
          ) : (
            <FileImage className="m-12 size-12 text-muted-foreground" />
          )}
        </div>
        {current?.error && <InlineAlert tone="warning">{current.error}</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              if (item) onMap(item)
            }}
          >
            <MapPinned />
            Open on map
          </Button>
          {!!item?.fullSheets.length && (
            <Button variant="outline" onClick={onSheet}>
              <FileImage />
              Full sheet / legend
            </Button>
          )}
          <Button variant="outline" onClick={onDetails}>
            Map notes & sources
          </Button>
          {current?.url && (
            <a href={current.url} target="_blank" rel="noreferrer" className="self-center px-2 text-sm underline">
              Open larger image ↗
            </a>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {item?.alignmentReview?.summary || item?.caveat}
        </p>
        {item?.organization && (
          <CollapsibleSection label="Category & source details" collapseOn="always" contentClassName="p-3">
            <OrganizationSummary value={item.organization} facets={facets} detail />
          </CollapsibleSection>
        )}
        <p className="text-xs text-muted-foreground">
          Display preview. Original-resolution GeoTIFF downloads are available in Map notes & sources.
        </p>
      </DialogContent>
    </Dialog>
  )
}
