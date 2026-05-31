import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  Layers3,
  MapPin,
  ShieldCheck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SourceKey = 'nativeLand' | 'cad' | 'treaty' | 'reserve' | 'local'
type Confidence = 'strong' | 'moderate' | 'review_required'
type WordingMode = 'general' | 'event' | 'research'

type CandidateNation = {
  id: string
  name: string
  preferredName: string
  confidence: Confidence
  reason: string
  sources: Partial<Record<SourceKey, string>>
  notes: string
}

const sourceMeta: Record<SourceKey, { label: string; type: string; description: string; enabled: boolean }> = {
  nativeLand: {
    label: 'Native Land Digital',
    type: 'Educational territory layer',
    description: 'Territories, languages, and treaties for review-oriented public education.',
    enabled: true,
  },
  cad: {
    label: 'BC CAD',
    type: 'Consultative area',
    description: 'Candidate First Nations associated with asserted/proven rights or title. Review required.',
    enabled: true,
  },
  treaty: {
    label: 'Treaty lands',
    type: 'Legal/admin layer',
    description: 'Treaty-related geography where official treaty data is available.',
    enabled: true,
  },
  reserve: {
    label: 'Reserve boundaries',
    type: 'Administrative layer',
    description: 'Reserve and band-name reference geography, not traditional territory.',
    enabled: true,
  },
  local: {
    label: 'Local verified',
    type: 'Institution/user verified',
    description: 'Saved wording and local guidance maintained by the organization.',
    enabled: true,
  },
}

const candidates: CandidateNation[] = [
  {
    id: 'lheidli',
    name: "Lheidli T'enneh First Nation",
    preferredName: "Lheidli T'enneh",
    confidence: 'strong',
    reason: 'Appears in local verified wording and multiple reference sources for the sample Prince George location.',
    sources: {
      nativeLand: 'Territory overlap',
      cad: 'Consultative-area association',
      reserve: 'Nearby band/reserve reference',
      local: 'UNBC-style local acknowledgement',
    },
    notes: 'Best candidate for default wording, with final wording still reviewed against Nation or local protocol.',
  },
  {
    id: 'nation-b',
    name: 'Candidate Nation B',
    preferredName: 'Candidate Nation B',
    confidence: 'review_required',
    reason: 'Appears in educational territory data only for this prototype result.',
    sources: {
      nativeLand: 'Territory overlap',
    },
    notes: 'Keep visible as a possible overlapping-territory candidate rather than silently removing it.',
  },
  {
    id: 'nation-c',
    name: 'Candidate Nation C',
    preferredName: 'Candidate Nation C',
    confidence: 'review_required',
    reason: 'Appears in consultative-area data only.',
    sources: {
      cad: 'Consultative-area association',
    },
    notes: 'CAD-style results are useful for relationship-building prompts, not automatic acknowledgements.',
  },
  {
    id: 'treaty-area',
    name: 'Treaty-area reference',
    preferredName: 'Treaty-area reference',
    confidence: 'moderate',
    reason: 'Treaty geography may be relevant, but it does not replace local territory or protocol guidance.',
    sources: {
      treaty: 'Treaty-area intersection',
    },
    notes: 'Shown as context unless the user explicitly chooses to include it in wording.',
  },
]

const confidenceStyles: Record<Confidence, string> = {
  strong: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  moderate: 'border-amber-200 bg-amber-50 text-amber-800',
  review_required: 'border-slate-200 bg-slate-50 text-slate-700',
}

const confidenceLabels: Record<Confidence, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  review_required: 'Review',
}

function buildAcknowledgement(mode: WordingMode, nationNames: string[]) {
  const names = nationNames.length > 0 ? nationNames.join(', ') : '[selected Nation(s)]'

  if (mode === 'event') {
    return `We acknowledge that today's event is taking place on lands connected to ${names}. We are grateful to gather here and recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
  }

  if (mode === 'research') {
    return `This work takes place in areas connected to ${names}. We recognize the importance of respectful relationship-building, local protocols, and Indigenous rights and title.`
  }

  return `We acknowledge that we are on lands connected to ${names}. We recognize their histories, cultures, and ongoing relationships with these lands.`
}

export default function DevAcknowledgement() {
  const [address, setAddress] = useState('3333 University Way, Prince George, BC')
  const [enabledSources, setEnabledSources] = useState<Record<SourceKey, boolean>>(() => ({
    nativeLand: true,
    cad: true,
    treaty: true,
    reserve: true,
    local: true,
  }))
  const [selectedIds, setSelectedIds] = useState<string[]>(['lheidli'])
  const [wordingMode, setWordingMode] = useState<WordingMode>('event')

  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => (
      Object.keys(candidate.sources).some((source) => enabledSources[source as SourceKey])
    )),
    [enabledSources],
  )

  const selectedNames = useMemo(
    () => candidates
      .filter((candidate) => selectedIds.includes(candidate.id))
      .map((candidate) => candidate.preferredName),
    [selectedIds],
  )

  const wording = useMemo(() => buildAcknowledgement(wordingMode, selectedNames), [selectedNames, wordingMode])

  const toggleSource = (source: SourceKey) => {
    setEnabledSources((current) => ({ ...current, [source]: !current[source] }))
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedIds((current) => (
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : [...current, candidateId]
    ))
  }

  return (
    <div className="min-h-full bg-stone-50 text-slate-950">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1 text-sm font-medium text-slate-600">
                <ShieldCheck className="h-4 w-4 text-teal-700" />
                Multi-source acknowledgement engine
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">Acknowledgement Builder</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Prototype flow for geocoding a B.C. address, comparing official and educational spatial sources,
                selecting candidate Nations, and generating editable wording with review guidance.
              </p>
            </div>
            <Button className="w-full bg-teal-700 hover:bg-teal-800 sm:w-auto">
              <FileText className="h-4 w-4" />
              Save verified wording
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <label className="flex min-h-12 items-center gap-3 rounded-lg border bg-white px-3 shadow-sm">
              <MapPin className="h-5 w-5 flex-none text-teal-700" />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                aria-label="Address"
              />
            </label>
            <Button variant="outline" className="min-h-12 justify-center">
              Run source comparison
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[280px_1fr_360px] lg:px-8">
        <aside className="space-y-4">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Source Layers</h2>
            </div>
            <div className="space-y-2">
              {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => toggleSource(source)}
                  className="flex w-full items-start gap-3 rounded-md border p-3 text-left transition hover:border-teal-300"
                >
                  <span className={cn(
                    'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded border',
                    enabledSources[source] ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white',
                  )}>
                    {enabledSources[source] && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{sourceMeta[source].label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">{sourceMeta[source].type}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Pipeline</h2>
            </div>
            <div className="space-y-3 text-xs text-slate-600">
              {['BC Address Geocoder', 'Point-in-polygon lookup', 'Source comparison', 'User-selected wording'].map((step, index) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-4">
          <div className="grid min-h-80 overflow-hidden rounded-lg border bg-white shadow-sm md:grid-cols-[1fr_220px]">
            <div className="relative min-h-72 bg-[linear-gradient(135deg,#d8eee8_0%,#f4f0df_45%,#dbe7f3_100%)]">
              <div className="absolute inset-0 opacity-55 [background-image:radial-gradient(circle_at_20%_20%,rgba(15,118,110,.18),transparent_22%),radial-gradient(circle_at_72%_40%,rgba(180,83,9,.15),transparent_24%),linear-gradient(90deg,rgba(15,23,42,.08)_1px,transparent_1px),linear-gradient(rgba(15,23,42,.08)_1px,transparent_1px)] [background-size:auto,auto,48px_48px,48px_48px]" />
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-teal-700 text-white shadow-lg">
                  <MapPin className="h-6 w-6" />
                </span>
                <span className="rounded-md bg-white/95 px-3 py-1 text-xs font-semibold shadow">Sample geocoded point</span>
              </div>
            </div>
            <div className="border-t p-4 md:border-l md:border-t-0">
              <h2 className="text-sm font-semibold">Location Result</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-xs uppercase text-slate-500">Normalized address</dt>
                  <dd className="mt-1 font-medium">{address}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Coordinates</dt>
                  <dd className="mt-1 font-mono text-xs">53.8931, -122.8139</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Geocoder</dt>
                  <dd className="mt-1">BC Address Geocoder</dd>
                </div>
              </dl>
            </div>
          </div>

          <section className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h2 className="text-base font-semibold">Candidate Nations</h2>
              <p className="mt-1 text-sm text-slate-600">Select what should be included in the generated acknowledgement.</p>
            </div>
            <div className="divide-y">
              {visibleCandidates.map((candidate) => (
                <article key={candidate.id} className="grid gap-4 p-4 md:grid-cols-[1fr_220px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCandidate(candidate.id)}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded border',
                          selectedIds.includes(candidate.id) ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300',
                        )}
                        aria-label={`Include ${candidate.name}`}
                      >
                        {selectedIds.includes(candidate.id) && <Check className="h-4 w-4" />}
                      </button>
                      <h3 className="font-semibold">{candidate.name}</h3>
                      <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium', confidenceStyles[candidate.confidence])}>
                        {confidenceLabels[candidate.confidence]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{candidate.reason}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{candidate.notes}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                      <div
                        key={source}
                        className={cn(
                          'rounded-md border p-2',
                          candidate.sources[source] && enabledSources[source] ? 'border-teal-200 bg-teal-50' : 'border-slate-100 bg-slate-50 text-slate-400',
                        )}
                      >
                        <div className="font-medium">{sourceMeta[source].label}</div>
                        <div className="mt-1 leading-4">{candidate.sources[source] ?? 'No match'}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Wording Mode</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['general', 'event', 'research'] as WordingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWordingMode(mode)}
                  className={cn(
                    'rounded-md border px-2 py-2 text-xs font-medium capitalize',
                    wordingMode === mode ? 'border-teal-700 bg-teal-700 text-white' : 'bg-white hover:border-teal-300',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
            <textarea
              value={wording}
              readOnly
              className="mt-3 min-h-44 w-full resize-none rounded-md border bg-slate-50 p-3 text-sm leading-6 outline-none"
              aria-label="Generated acknowledgement wording"
            />
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Review needed
              </div>
              Confirm wording with local or Nation-specific guidance where possible. CAD, reserve, and treaty layers should not be treated as automatic acknowledgement text.
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold">Source Transparency</h2>
            </div>
            <div className="space-y-3 text-xs leading-5 text-slate-600">
              {(Object.keys(sourceMeta) as SourceKey[]).map((source) => (
                <div key={source} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{sourceMeta[source].label}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-1">{sourceMeta[source].description}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
