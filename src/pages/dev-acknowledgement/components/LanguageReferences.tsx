import { ExternalLink, Globe2 } from 'lucide-react'

import { CollapsiblePanel } from './CollapsiblePanel'
import { localLanguageResources, pronunciationSources } from '../data'

export function LanguageReferences() {
  return (
    <CollapsiblePanel title="Language References" icon={<Globe2 className="h-4 w-4 text-teal-700" />} defaultOpen={false}>
      <div className="space-y-3 text-xs leading-5 text-slate-600">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pronunciation</div>
        {pronunciationSources.map((source) => (
          <a
            key={source.name}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border p-3 transition hover:border-teal-300 hover:bg-teal-50/40"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="font-semibold text-slate-900">{source.name}</span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
            </span>
            <span className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
              {source.status}
            </span>
            <span className="mt-2 block">{source.use}</span>
            <span className="mt-1 block text-slate-500">{source.caveat}</span>
          </a>
        ))}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
          Audio links are only shown when they come from a Nation site, FPCC permission/API access, or another source with clear reuse rights.
        </div>
        <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Local resources</div>
        {localLanguageResources.map((resource) => (
          <div key={resource.name} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">{resource.name}</div>
                <div className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                  {resource.status}
                </div>
              </div>
              <a href={resource.url} target="_blank" rel="noreferrer" aria-label={`Open ${resource.name}`}>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
              </a>
            </div>
            <p className="mt-2">{resource.use}</p>
            <p className="mt-1 text-slate-500">{resource.caveat}</p>
            {(resource.audioUrl || resource.qrUrl) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {resource.audioUrl && (
                  <a href={resource.audioUrl} target="_blank" rel="noreferrer" className="rounded border bg-white px-2 py-1 font-medium text-teal-800">
                    Audio
                  </a>
                )}
                {resource.qrUrl && (
                  <a href={resource.qrUrl} target="_blank" rel="noreferrer" className="rounded border bg-white px-2 py-1 font-medium text-teal-800">
                    QR code
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </CollapsiblePanel>
  )
}
