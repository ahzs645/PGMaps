import { FileImage } from 'lucide-react'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OrganizationSummary } from './OrganizationSummary'
import type { CatalogueFacets, SourceImageRecord } from './catalogue'

export function SourceImagePreview({
  item,
  facets,
  onClose,
}: {
  item: SourceImageRecord | null
  facets?: CatalogueFacets
  onClose: () => void
}) {
  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent elevated className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{item?.title || 'Source record'}</DialogTitle>
          <DialogDescription>
            Available source imagery and document links. No geographic placement is assigned.
          </DialogDescription>
        </DialogHeader>
        <Badge tone="warning" className="w-fit">
          Not georeferenced
        </Badge>
        {item?.dateLabel && <p className="text-sm text-muted-foreground">{item.dateLabel}</p>}
        {item?.image ? (
          <img
            src={item.image}
            alt={item.imageLabel || item.title}
            referrerPolicy="no-referrer"
            className="max-h-[55dvh] w-full rounded border bg-stone-100 object-contain dark:bg-zinc-900"
          />
        ) : (
          <div className="flex items-center gap-3 rounded border bg-muted p-6 text-sm text-muted-foreground">
            <FileImage />
            No direct source image is available for this record. Use the source links below.
          </div>
        )}
        {(item?.imageLabel || item?.imageScope) && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {[item.imageLabel, item.imageScope].filter(Boolean).join(' · ')}
          </p>
        )}
        {item?.image && (
          <a href={item.image} target="_blank" rel="noreferrer noopener" className="text-sm underline">
            Open available image at its supplied resolution ↗
          </a>
        )}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Source documents</h3>
          {item?.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mb-2 block break-words text-sm underline"
            >
              {s.title} ↗
            </a>
          ))}
        </div>
        <CollapsibleSection label="Source scope & category notes" collapseOn="always" contentClassName="space-y-3 p-3">
          {item?.description && <p className="text-sm leading-relaxed">{item.description}</p>}
          {item?.imageScope && <p className="text-sm leading-relaxed">Image scope: {item.imageScope}</p>}
          {item?.statusNote && <p className="text-sm leading-relaxed">{item.statusNote}</p>}
          <OrganizationSummary value={item?.organization} facets={facets} detail />
        </CollapsibleSection>
        <p className="text-xs text-muted-foreground">
          This source record has no geographic placement. Available imagery may be a page, excerpt or contextual lead;
          its scope is recorded above.
        </p>
      </DialogContent>
    </Dialog>
  )
}
