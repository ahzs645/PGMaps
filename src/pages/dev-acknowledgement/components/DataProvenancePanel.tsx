import { AlertTriangle, Database, ExternalLink } from 'lucide-react'

import { CollapsiblePanel } from './CollapsiblePanel'
import { INDIGENOUS_MANIFEST_DATA, unresolvedDataGaps } from '../data'
import type { IndigenousManifestSource } from '../types'
import { withBase } from '@/lib/dataUrl'

type DataProvenancePanelProps = {
  automatedSources: IndigenousManifestSource[]
  manualSources: IndigenousManifestSource[]
}

export function DataProvenancePanel({ automatedSources, manualSources }: DataProvenancePanelProps) {
  return (
    <CollapsiblePanel
      title="Data Provenance"
      icon={<Database className="h-4 w-4 text-teal-700 dark:text-teal-300" />}
      defaultOpen={false}
    >
      <div className="space-y-3 text-xs leading-5 text-muted-foreground">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Automated</div>
        {automatedSources.map((source) => {
          const href = withBase(source.sourceUrl ?? source.url ?? source.output ?? INDIGENOUS_MANIFEST_DATA)
          return (
            <a
              key={source.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-success-border/60 bg-success-surface/40 p-3 transition hover:border-success-border hover:bg-success-surface"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold text-foreground">{source.title}</span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
              </span>
              <span className="mt-1 inline-flex rounded bg-success-surface px-1.5 py-0.5 text-xs font-semibold uppercase text-success-foreground">
                {source.access ?? 'automated'}
                {source.featureCount ? ` · ${source.featureCount} features` : ''}
              </span>
              <span className="mt-2 block">
                {source.output
                  ? `Synced by bcdatamapper to ${source.output}.`
                  : 'Tracked by the bcdatamapper Indigenous source manifest.'}
              </span>
              <span className="mt-1 block text-muted-foreground">{source.caveat}</span>
            </a>
          )
        })}
        {automatedSources.length === 0 && (
          <div className="rounded-md border border-border bg-muted/50 p-3 text-muted-foreground">
            bcdatamapper manifest not loaded yet.
          </div>
        )}
        <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manual</div>
        {manualSources.map((source) => {
          const href = withBase(source.url ?? source.sourceUrl ?? INDIGENOUS_MANIFEST_DATA)
          return (
            <a
              key={source.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border p-3 transition hover:border-teal-300 dark:hover:border-teal-700 hover:bg-teal-50/40 dark:hover:bg-teal-950/30"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold text-foreground">{source.title}</span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
              </span>
              <span className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                {source.access ?? 'manual'}
              </span>
              <span className="mt-2 block">Tracked in the bcdatamapper manifest as a non-automated source.</span>
              <span className="mt-1 block text-muted-foreground">{source.caveat}</span>
            </a>
          )
        })}
        {manualSources.length === 0 && (
          <div className="rounded-md border border-border bg-muted/50 p-3 text-muted-foreground">
            Manual bcdatamapper source metadata not loaded yet.
          </div>
        )}
        <div className="flex items-center gap-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          Gaps
        </div>
        {unresolvedDataGaps.map((gap) => (
          <a
            key={gap.name}
            href={gap.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border p-3 transition hover:border-teal-300 dark:hover:border-teal-700 hover:bg-teal-50/40 dark:hover:bg-teal-950/30"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="font-semibold text-foreground">{gap.name}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
            </span>
            <span className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
              {gap.status}
            </span>
            <span className="mt-2 block">{gap.use}</span>
            <span className="mt-1 block text-muted-foreground">{gap.limitation}</span>
          </a>
        ))}
      </div>
    </CollapsiblePanel>
  )
}
