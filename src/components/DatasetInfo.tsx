import { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Database, Download, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

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

export function DatasetInfo({ dataset, className, defaultOpen = false }: DatasetInfoProps) {
  const [open, setOpen] = useState(defaultOpen)
  const primaryUrl = dataset.downloadUrl || dataset.apiUrl

  return (
    <div className={cn('border-b border-border bg-background/95 px-4 py-2', className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{dataset.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {dataset.source} | Updated {formatUpdated(dataset.updated)}
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
          <p className="leading-4">{dataset.description}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span>Coverage</span>
            <span className="text-right text-foreground">{dataset.coverage}</span>
            <span>License</span>
            <span className="text-right text-foreground">{dataset.license}</span>
            <span>Formats</span>
            <span className="text-right text-foreground">{dataset.formats.join(', ')}</span>
          </div>
          {dataset.fields && dataset.fields.length > 0 && (
            <div className="line-clamp-2">
              <span className="font-medium text-foreground">Fields:</span> {dataset.fields.join(', ')}
            </div>
          )}
          {primaryUrl && (
            <div className="flex flex-wrap gap-2 pt-1">
              {dataset.downloadUrl && (
                <a
                  href={dataset.downloadUrl}
                  download
                  className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
                >
                  <Download className="h-3 w-3" />
                  Download
                </a>
              )}
              {dataset.apiUrl && (
                <a
                  href={dataset.apiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" />
                  API
                </a>
              )}
              <button
                type="button"
                onClick={() => copyText(primaryUrl)}
                className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
                Copy link
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
