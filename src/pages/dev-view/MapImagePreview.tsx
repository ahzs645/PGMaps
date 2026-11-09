import { useEffect, useMemo, useState } from 'react'
import { FileImage, MapPinned } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ExternalLink } from '@/components/ui/text-button'
import { formatBytes } from '@/lib/format'
import { OrganizationSummary } from './OrganizationSummary'
import { OriginalImagePanel } from './SourceImageViewer'
import { sourceImageChoices } from './sourceImages'
import type { CatalogueFacets, RasterRecord } from './catalogue'

type Props = {
  item: RasterRecord | null
  onClose: () => void
  onMap: (item: RasterRecord) => void
  onSheet: () => void
  onDetails: () => void
  onGeoreference?: (item: RasterRecord) => void
  facets?: CatalogueFacets
}
type Mode = 'original' | 'rectified' | 'compare'

function ImageContent({
  item,
  onMap,
  onSheet,
  onDetails,
  onGeoreference,
  facets,
}: Omit<Props, 'item' | 'onClose'> & { item: RasterRecord }) {
  const choices = useMemo(() => sourceImageChoices(item), [item])
  const [sourceId, setSourceId] = useState(
    () => choices.find((choice) => choice.role === 'original-scan')?.id || choices[0]?.id || '',
  )
  const [mode, setMode] = useState<Mode>(choices.length ? 'original' : 'rectified')
  const [loadRectified, setLoadRectified] = useState(!choices.length)
  const [image, setImage] = useState<{ url?: string; error?: string }>({})
  useEffect(() => {
    if (!loadRectified) return
    const abort = new AbortController()
    let url: string | undefined
    import('./rasterPreview')
      .then(({ rasterPreview }) => rasterPreview(item, abort.signal))
      .then((blob) => {
        if (abort.signal.aborted) return
        url = URL.createObjectURL(blob)
        setImage({ url })
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setImage({
            error: 'The map preview could not load. You can still open the map or download its rectified GeoTIFF.',
          })
      })
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [item, loadRectified])
  const selectedSource = choices.find((choice) => choice.id === sourceId)
  const sourceLabel =
    selectedSource?.role === 'original-scan'
      ? 'Original scan'
      : selectedSource?.role === 'edit-source'
        ? 'Edit source'
        : 'Source sheet'
  const rectified = (
    <div className="min-w-0 space-y-3">
      {mode === 'compare' && <h3 className="text-sm font-semibold">Rectified map</h3>}
      {!image.url && !image.error && (
        <span role="status" className="text-xs text-muted-foreground">
          Loading map preview…
        </span>
      )}
      <div className="flex min-h-40 items-center justify-center rounded-lg border bg-stone-100 dark:bg-zinc-900">
        {image.url || item.thumbnail ? (
          <img
            src={image.url || item.thumbnail}
            alt={`${item.title} · rectified map preview`}
            referrerPolicy="no-referrer"
            className="max-h-[52dvh] w-full object-contain"
          />
        ) : (
          <FileImage className="m-12 size-12 text-muted-foreground" />
        )}
      </div>
      {image.error && <InlineAlert tone="warning">{image.error}</InlineAlert>}
      {item.downloads.map((download, index) => (
        <div key={download.url} className="space-y-1">
          <ExternalLink href={download.url} className="text-sm">
            {download.label || `Download rectified GeoTIFF${item.downloads.length > 1 ? ` · panel ${index + 1}` : ''}`}
          </ExternalLink>
          {(download.width || download.bytes) && (
            <p className="text-xs text-muted-foreground">
              {download.width && download.height
                ? `${download.width.toLocaleString()} × ${download.height.toLocaleString()} px`
                : ''}
              {download.bytes ? `${download.width ? ' · ' : ''}${formatBytes(download.bytes)}` : ''}
              {download.crs ? ` · ${download.crs}` : ''}
            </p>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        The map preview shows the recorded geographic placement. Its detail comes from the delivered raster.
      </p>
    </div>
  )
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={item.confidence === 'experimental' ? 'warning' : 'neutral'}>
          {item.alignmentReview?.label ||
            (item.confidence === 'experimental' ? 'Experimental placement' : 'Provisional placement')}
        </Badge>
      </div>
      <SegmentedControl<Mode>
        label="Image representation"
        size="sm"
        className="flex-wrap"
        value={mode}
        options={[
          { value: 'original', label: sourceLabel },
          { value: 'rectified', label: 'Map overlay' },
          { value: 'compare', label: 'Compare', disabled: !choices.length },
        ]}
        onChange={(next) => {
          setMode(next)
          if (next !== 'original') setLoadRectified(true)
        }}
      />
      {mode === 'original' && <OriginalImagePanel item={item} choiceId={sourceId} onChoiceChange={setSourceId} />}
      {mode === 'rectified' && rectified}
      {mode === 'compare' && (
        <>
          <p className="text-xs text-muted-foreground">
            The source sheet and its map placement are separate views. Borders, legends or other panels may be omitted
            from the overlay.
          </p>
          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <h3 className="text-sm font-semibold">{sourceLabel}</h3>
              <OriginalImagePanel item={item} choiceId={sourceId} onChoiceChange={setSourceId} />
            </div>
            {rectified}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button onClick={() => onMap(item)}>
          <MapPinned />
          Open on map
        </Button>
        {item.fullSheets.some((sheet) => sheet.legend) && (
          <Button variant="outline" onClick={onSheet}>
            <FileImage />
            Legend / notes
          </Button>
        )}
        <Button variant="outline" onClick={onDetails}>
          Map notes & sources
        </Button>
        {!!item.downloads.length && onGeoreference && (
          <Button variant="outline" onClick={() => onGeoreference(item)}>
            Adjust alignment
          </Button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{item.alignmentReview?.summary || item.caveat}</p>
      {item.organization && (
        <CollapsibleSection label="Category & source details" collapseOn="always" contentClassName="p-3">
          <OrganizationSummary value={item.organization} facets={facets} detail />
        </CollapsibleSection>
      )}
    </>
  )
}

export function MapImagePreview({ item, onClose, ...props }: Props) {
  // Reopening another source or revision discards pending preview work and all old view state.
  const identity = item
    ? JSON.stringify([item.id, item.assets, item.downloads, item.imageVariants, item.fullSheets])
    : ''
  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent elevated className="max-h-[92dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{item?.title || 'Map image'}</DialogTitle>
          <DialogDescription>
            {item?.dateLabel || item?.organization?.pageLabel || 'Original source and rectified map views.'}
          </DialogDescription>
        </DialogHeader>
        {item && <ImageContent key={identity} item={item} {...props} />}
      </DialogContent>
    </Dialog>
  )
}
