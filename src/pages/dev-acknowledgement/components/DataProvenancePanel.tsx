import { AlertTriangle, Database, ExternalLink } from 'lucide-react'

import { INDIGENOUS_MANIFEST_DATA, unresolvedDataGaps } from '../data'
import type { IndigenousManifestSource } from '../types'

type DataProvenancePanelProps = {
  automatedSources: IndigenousManifestSource[]
  manualSources: IndigenousManifestSource[]
}

export function DataProvenancePanel({ automatedSources, manualSources }: DataProvenancePanelProps) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-teal-700" />
        <h2 className="text-sm font-semibold">Data Provenance</h2>
      </div>
      <div className="space-y-3 text-xs leading-5 text-slate-600">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Automated</div>
        {automatedSources.map((source) => {
          const href = source.sourceUrl ?? source.url ?? source.output ?? INDIGENOUS_MANIFEST_DATA
          return (
            <a
              key={source.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-emerald-100 bg-emerald-50/40 p-3 transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold text-slate-900">{source.title}</span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
              </span>
              <span className="mt-1 inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                {source.access ?? 'automated'}{source.featureCount ? ` · ${source.featureCount} features` : ''}
              </span>
              <span className="mt-2 block">
                {source.output ? `Synced by bcdatamapper to ${source.output}.` : 'Tracked by the bcdatamapper Indigenous source manifest.'}
              </span>
              <span className="mt-1 block text-slate-500">{source.caveat}</span>
            </a>
          )
        })}
        {automatedSources.length === 0 && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-500">
            bcdatamapper manifest not loaded yet.
          </div>
        )}
        <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Manual</div>
        {manualSources.map((source) => {
          const href = source.url ?? source.sourceUrl ?? INDIGENOUS_MANIFEST_DATA
          return (
            <a
              key={source.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold text-slate-900">{source.title}</span>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
              </span>
              <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                {source.access ?? 'manual'}
              </span>
              <span className="mt-2 block">
                Tracked in the bcdatamapper manifest as a non-automated source.
              </span>
              <span className="mt-1 block text-slate-500">{source.caveat}</span>
            </a>
          )
        })}
        {manualSources.length === 0 && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-500">
            Manual bcdatamapper source metadata not loaded yet.
          </div>
        )}
        <div className="flex items-center gap-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Gaps
        </div>
        {unresolvedDataGaps.map((gap) => (
          <a
            key={gap.name}
            href={gap.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="font-semibold text-slate-900">{gap.name}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
            </span>
            <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
              {gap.status}
            </span>
            <span className="mt-2 block">{gap.use}</span>
            <span className="mt-1 block text-slate-500">{gap.limitation}</span>
          </a>
        ))}
      </div>
    </section>
  )
}
