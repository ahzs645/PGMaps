import { usePagination } from '@/hooks/usePagination'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { useRef } from 'react'
import { Globe } from 'lucide-react'

import { RecordDialog } from '@/components/ui/record-dialog'

import type { ResearchRecord } from '../adapters/researchRecordsTypes'
import type { ExplorerFeature } from './featureTypes'

function applyCountTemplate(template: string, count: number) {
  return template.split('{count}').join(count.toLocaleString())
}

export function AggregateRecordsFeature({
  feature,
  count,
  onOpen,
}: {
  feature: ExplorerFeature<'aggregate-records'>
  count: number
  onOpen: () => void
}) {
  return (
    <section className="border-b border-border p-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
      >
        <Globe className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">{applyCountTemplate(feature.triggerTemplate, count)}</span>
      </button>
    </section>
  )
}

export function AggregateRecordsDialog({
  open,
  feature,
  submissions,
  resourceTypeLabels,
  recordSingular,
  onOpenChange,
}: {
  open: boolean
  feature: ExplorerFeature<'aggregate-records'>
  submissions: ResearchRecord[]
  resourceTypeLabels: Record<string, string>
  recordSingular: string
  onOpenChange: (open: boolean) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const pagination = usePagination(submissions, 20, `${open}:${submissions.map((record) => record.id).join(',')}`)
  // The shell owns the scroll port (the whole sheet on phones, the body from
  // sm up), so reset every ancestor up to the dialog when the page changes.
  const scrollListToTop = () => {
    for (
      let node: HTMLElement | null = listRef.current;
      node && node.getAttribute('role') !== 'dialog';
      node = node.parentElement
    ) {
      node.scrollTop = 0
    }
  }
  return (
    <RecordDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={feature.modalTitle}
      subtitle={applyCountTemplate(feature.modalDescription, submissions.length)}
      size="md"
      className="sm:max-h-[80dvh] sm:max-w-lg"
      footerStart={
        pagination.pageCount > 1 ? (
          <PaginationControls
            label="Record pages"
            className="border-t-0 bg-transparent p-0"
            page={pagination.page}
            pageCount={pagination.pageCount}
            onPageChange={(page) => {
              pagination.setPage(page)
              scrollListToTop()
            }}
          />
        ) : undefined
      }
    >
      <div ref={listRef} className="space-y-2">
        {pagination.items.map((submission) => (
          <article key={submission.id} className="rounded-md border bg-background p-3">
            <h3 className="text-sm font-medium leading-5 text-foreground">
              {submission.title || `Untitled ${recordSingular}`}
            </h3>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {submission.author ? <span>{submission.author}</span> : null}
              {submission.publicationYear ? <span>{submission.publicationYear}</span> : null}
              <span>{resourceTypeLabels[submission.resourceTypeMain] ?? submission.resourceType}</span>
            </div>
          </article>
        ))}
      </div>
    </RecordDialog>
  )
}
