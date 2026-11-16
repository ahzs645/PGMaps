import { useEffect, useMemo, useState } from 'react'
import { FileImage, MapPinned } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { DialogShell } from '@/components/ui/dialog-shell'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ExternalLink } from '@/components/ui/text-button'
import { formatBytes } from '@/lib/format'
import { knownDate } from './libraryOrganization'
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

function ImageDialog({
  item,
  onClose,
  onMap,
  onSheet,
  onDetails,
  onGeoreference,
  facets,
}: Omit<Props, 'item'> & { item: RasterRecord }) {
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
      <div className="flex min-h-40 items-center justify-center rounded-lg border bg-muted">
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
  const hasLegend = item.fullSheets.some((sheet) => sheet.legend)
  const canAdjust = !!item.downloads.length && !!onGeoreference
  return (
    <DialogShell
      onClose={onClose}
      size="xl"
      className="workspace-sm:max-w-6xl"
      bodyClassName="space-y-4"
      title={item.title}
      subtitle={knownDate(item.dateLabel) || item.organization?.pageLabel}
      toolbar={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl<Mode>
            label="Image representation"
            className="w-full sm:w-auto sm:min-w-96"
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
          <Badge tone={item.confidence === 'experimental' ? 'warning' : 'neutral'} size="sm">
            {item.alignmentReview?.label ||
              (item.confidence === 'experimental' ? 'Experimental placement' : 'Provisional placement')}
          </Badge>
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          <Button className="flex-1 sm:flex-none" onClick={() => onMap(item)}>
            <MapPinned />
            Open on map
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onDetails}>
            Notes & sources
          </Button>
        </div>
      }
    >
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
      <p className="text-xs leading-relaxed text-muted-foreground">{item.alignmentReview?.summary || item.caveat}</p>
      {(hasLegend || canAdjust) && (
        <div className="flex flex-wrap gap-2">
          {hasLegend && (
            <Button variant="outline" size="sm" onClick={onSheet}>
              <FileImage />
              Legend / notes
            </Button>
          )}
          {canAdjust && (
            <Button variant="outline" size="sm" onClick={() => onGeoreference?.(item)}>
              Adjust alignment
            </Button>
          )}
        </div>
      )}
      {item.organization && (
        <CollapsibleSection label="Category & source details" collapseOn="always" contentClassName="p-3">
          <OrganizationSummary value={item.organization} facets={facets} detail />
        </CollapsibleSection>
      )}
    </DialogShell>
  )
}

export function MapImagePreview({ item, ...props }: Props) {
  if (!item) return null
  // Reopening another source or revision discards pending preview work and all old view state.
  const identity = JSON.stringify([item.id, item.assets, item.downloads, item.imageVariants, item.fullSheets])
  return <ImageDialog key={identity} item={item} {...props} />
}
