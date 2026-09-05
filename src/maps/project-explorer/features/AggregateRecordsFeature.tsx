import { usePagination } from '@/hooks/usePagination'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { useRef } from 'react'
import { Globe } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagination = usePagination(submissions, 20, `${open}:${submissions.map((record) => record.id).join(',')}`)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet" elevated className="gap-0 p-0 sm:max-h-[80dvh] sm:max-w-lg">
        <div className="border-b px-4 py-3 pr-12">
          <DialogTitle className="text-sm leading-5 text-foreground">{feature.modalTitle}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">
            {applyCountTemplate(feature.modalDescription, submissions.length)}
          </DialogDescription>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {pagination.items.map((submission) => (
            <article key={submission.id} className="rounded-md border bg-muted/20 p-3">
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
        {pagination.pageCount > 1 && (
          <PaginationControls
            label="Record pages"
            page={pagination.page}
            pageCount={pagination.pageCount}
            onPageChange={(page) => {
              pagination.setPage(page)
              scrollRef.current?.scrollTo({ top: 0 })
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
