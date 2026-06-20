import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Database, Download, ExternalLink, Flame, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'

export interface DatasetInfoRecord {
  title: string
  description: string
  source: string
  updated?: string | null
  coverage: string
  license: string
  formats: string[]
  downloadUrl?: string
  apiUrl?: string
  fields?: string[]
}

interface DatasetInfoProps {
  dataset: DatasetInfoRecord
  sourceNotes?: ReactNode
  className?: string
  defaultOpen?: boolean
}

function formatUpdated(value?: string | null): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function copyText(value: string) {
  if (!navigator.clipboard) return
  void navigator.clipboard.writeText(value)
}

export function DatasetInfo({ dataset, sourceNotes, className, defaultOpen = false }: DatasetInfoProps) {
  const toolbarSlot = typeof document === 'undefined' ? null : document.getElementById('dataset-info-toolbar-slot')
  const primaryUrl = dataset.downloadUrl || dataset.apiUrl

  const content = (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/70 bg-white/90 text-sm font-medium text-zinc-950 shadow-lg backdrop-blur transition-colors hover:bg-white hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-700/70 dark:bg-zinc-950/90 dark:text-zinc-50 dark:shadow-black/50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 md:h-10 md:w-10 md:border-transparent md:bg-transparent md:text-muted-foreground md:shadow-none md:backdrop-blur-none md:hover:bg-accent md:hover:text-accent-foreground',
            className
          )}
          aria-label={`Open dataset information for ${dataset.title}`}
          title="Dataset information"
        >
          <Info className="h-5 w-5" />
        </button>
      </DialogTrigger>

      <DialogContent elevated className="max-h-[calc(100vh-2rem)] max-w-xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <div className="flex items-start gap-2 pr-8">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <DialogTitle className="leading-6">{dataset.title}</DialogTitle>
              <DialogDescription className="mt-1">
                {dataset.source} | Updated {formatUpdated(dataset.updated)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 text-sm text-muted-foreground">
          <p className="leading-6">{dataset.description}</p>
          <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-x-4 gap-y-2 text-xs">
            <span>Coverage</span>
            <span className="text-right text-foreground">{dataset.coverage}</span>
            <span>License</span>
            <span className="text-right text-foreground">{dataset.license}</span>
            <span>Formats</span>
            <span className="text-right text-foreground">{dataset.formats.join(', ')}</span>
          </div>
          {dataset.fields && dataset.fields.length > 0 && (
            <div className="text-xs leading-5">
              <span className="font-medium text-foreground">Fields:</span> {dataset.fields.join(', ')}
            </div>
          )}
          {sourceNotes && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-600" />
                <h3 className="text-sm font-semibold text-foreground">Source Notes</h3>
              </div>
              <div className="space-y-2 text-xs leading-5">{sourceNotes}</div>
            </div>
          )}
          {primaryUrl && (
            <div className="flex flex-wrap gap-2 pt-1">
              {dataset.downloadUrl && (
                <a
                  href={dataset.downloadUrl}
                  download
                  className="inline-flex items-center gap-1 rounded border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              )}
              {dataset.apiUrl && (
                <a
                  href={dataset.apiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  API
                </a>
              )}
              <button
                type="button"
                onClick={() => copyText(primaryUrl)}
                className="inline-flex items-center gap-1 rounded border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy link
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )

  if (!toolbarSlot) return null

  return createPortal(content, toolbarSlot)
}
