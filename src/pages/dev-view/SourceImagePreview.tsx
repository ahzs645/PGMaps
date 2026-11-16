import { FileImage } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { Badge } from '@/components/ui/badge'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { ExternalLink } from '@/components/ui/text-button'
import { knownDate } from './libraryOrganization'
import { OrganizationSummary } from './OrganizationSummary'
import type { CatalogueFacets, SourceImageRecord } from './catalogue'

export function SourceImagePreview({
  item,
  facets,
  onClose,
  onGeoreference,
}: {
  item: SourceImageRecord | null
  facets?: CatalogueFacets
  onClose: () => void
  onGeoreference?: (item: SourceImageRecord) => void
}) {
  if (!item) return null
  return (
    <PanelDialog
      onClose={onClose}
      size="xl"
      bodyClassName="space-y-3"
      title={item.title}
      subtitle={knownDate(item.dateLabel)}
      headerExtra={
        <Badge tone="warning" size="sm">
          Not georeferenced
        </Badge>
      }
      footer={
        item.image && onGeoreference ? (
          <div className="flex">
            <Button className="flex-1 sm:flex-none" onClick={() => onGeoreference(item)}>
              Georeference this image
            </Button>
          </div>
        ) : undefined
      }
    >
      {item.image ? (
        <img
          src={item.image}
          alt={item.imageLabel || item.title}
          referrerPolicy="no-referrer"
          className="max-h-[60dvh] w-full rounded-lg border bg-muted object-contain"
        />
      ) : (
        <div className="flex items-center gap-3 rounded-lg border bg-muted p-6 text-sm text-muted-foreground">
          <FileImage />
          No image is available for this record. Use the source links below.
        </div>
      )}
      {(item.imageLabel || item.imageScope) && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {[item.imageLabel, item.imageScope].filter(Boolean).join(' · ')}
        </p>
      )}
      {item.image && (
        <ExternalLink href={item.image} className="text-sm">
          Open image at its supplied resolution
        </ExternalLink>
      )}
      {!!item.sources.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Source documents</h3>
          {item.sources.map((s) => (
            <ExternalLink key={s.url} href={s.url} className="mb-2 flex break-words text-sm">
              {s.title}
            </ExternalLink>
          ))}
        </div>
      )}
      <CollapsibleSection label="Source scope & category notes" collapseOn="always" contentClassName="space-y-3 p-3">
        {item.description && <p className="text-sm leading-relaxed">{item.description}</p>}
        {item.imageScope && <p className="text-sm leading-relaxed">Image scope: {item.imageScope}</p>}
        {item.statusNote && <p className="text-sm leading-relaxed">{item.statusNote}</p>}
        <OrganizationSummary value={item.organization} facets={facets} detail />
      </CollapsibleSection>
      <p className="text-xs text-muted-foreground">
        This record has no geographic placement. Its image may be a page, an excerpt or a contextual lead.
      </p>
    </PanelDialog>
  )
}
