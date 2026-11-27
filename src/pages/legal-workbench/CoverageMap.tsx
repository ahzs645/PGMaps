import { useEffect, useMemo, useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { SelectField } from '@/components/ui/form-field'
import { downloadText } from '@/lib/download'
import {
  citationIndex,
  coverageCsv,
  gapsOf,
  sectionKey,
  sectionState,
  STATE_LABEL,
  type CoverageEntry,
  type CoverageReview,
  type SectionState,
} from '@/lib/legal/coverage'
import { catalogueIdForUrl, catalogueSource, catalogueSources } from '@/lib/legal/lawLibrary'
import { cn } from '@/lib/utils'
import ground from '../../../packages/legal-rules/ground/instruments.json'
import { ProvisionText } from './ProvisionPreview'
import { defaults } from './registry'

const reviewFiles = import.meta.glob<CoverageReview>('../../../packages/legal-rules/catalogue/section-review/*.json', {
  import: 'default',
})

const CHIP: Record<SectionState, string> = {
  rule: 'bg-success-surface border-success-border text-success-foreground',
  screen: 'bg-info-surface border-info-border text-info-foreground',
  'gap-high': 'bg-danger-surface border-danger-border text-danger-foreground',
  'gap-medium': 'bg-warning-surface border-warning-border text-warning-foreground',
  'gap-low': 'bg-muted border-warning-border text-warning',
  outside: 'bg-muted border-transparent text-muted-foreground',
  unreviewed: 'bg-background border-dashed border-border text-muted-foreground',
}
const TONE: Record<SectionState, BadgeTone> = {
  rule: 'success',
  screen: 'info',
  'gap-high': 'danger',
  'gap-medium': 'warning',
  'gap-low': 'neutral',
  outside: 'neutral',
  unreviewed: 'neutral',
}
const ORDER: SectionState[] = ['rule', 'screen', 'gap-high', 'gap-medium', 'gap-low', 'outside', 'unreviewed']
const isOrder = (id: string) => ['regional_order', 'guidance'].includes(catalogueSource(id)?.kind ?? '')
/** Statutes and regulations first, in the order a planner meets them, then the orders. */
const PRIORITY = ['bc.fppr', 'bc.frpa', 'bc.gar', 'bc.forest-act', 'bc.land-act', 'bc.range-act', 'bc.rppr', 'bc.ipma']

interface Picked {
  source: string
  entry: CoverageEntry
  state: SectionState
}

/**
 * The coverage map: every section of every reviewed source, coloured by whether a pack rule or a
 * map screen cites it or the review found a gap, each opening its text and its review.
 */
export default function CoverageMap() {
  const [reviews, setReviews] = useState<CoverageReview[] | null>(null)
  const [source, setSource] = useState('bc.fppr')
  const [showAll, setShowAll] = useState(false)
  const [allGaps, setAllGaps] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  useEffect(() => {
    let live = true
    void Promise.all(Object.values(reviewFiles).map((load) => load())).then((all) => live && setReviews(all))
    return () => {
      live = false
    }
  }, [])
  const index = useMemo(() => citationIndex(defaults, ground.instruments as never, catalogueIdForUrl, isOrder), [])
  if (!reviews) return <p className="text-sm text-muted-foreground">Reading the review…</p>
  const ordered = [...reviews].sort((a, b) => {
    const pa = PRIORITY.indexOf(a.source)
    const pb = PRIORITY.indexOf(b.source)
    if (pa >= 0 || pb >= 0) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb)
    if (isOrder(a.source) !== isOrder(b.source)) return isOrder(a.source) ? 1 : -1
    return a.source.localeCompare(b.source)
  })
  const review = ordered.find((r) => r.source === source) ?? ordered[0]
  const title = (id: string) => catalogueSource(id)?.title ?? id
  const states = review.sections.map((entry) => ({
    entry,
    state: sectionState(index.get(sectionKey(review.source, entry.n)), entry),
  }))
  const counts = ORDER.map((s) => [s, states.filter((x) => x.state === s).length] as const).filter(([, n]) => n)
  const listed = states.filter((x) => showAll || x.state !== 'outside')
  const pick = (src: string, entry: CoverageEntry) =>
    setPicked({ source: src, entry, state: sectionState(index.get(sectionKey(src, entry.n)), entry) })
  const cited = picked ? (index.get(sectionKey(picked.source, picked.entry.n)) ?? []) : []
  const pickedSource = picked ? catalogueSource(picked.source) : undefined
  const label = (src: string, n: string) => (isOrder(src) ? n : `s. ${n}`)
  return (
    <div className="space-y-4" data-testid="law-coverage">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <SelectField label="Source" value={review.source} onValueChange={(v) => setSource(v)}>
            {ordered.map((r) => (
              <option key={r.source} value={r.source}>
                {title(r.source)}
              </option>
            ))}
          </SelectField>
        </div>
        <Button
          size="sm"
          variant={allGaps ? 'default' : 'outline'}
          aria-pressed={allGaps}
          onClick={() => setAllGaps(!allGaps)}
        >
          Every gap, all sources
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadText(coverageCsv(ordered, index), 'pgmaps-law-coverage.csv', 'text/csv')}
        >
          Download CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {review.method} Reviewed {review.reviewedOn}. Whether a rule or screen cites a section is read from the packs
        and the ground catalogue as they ship.
      </p>
      <div className="flex flex-wrap gap-1.5" aria-label="Sections by state">
        {counts.map(([state, n]) => (
          <Badge key={state} tone={TONE[state]} size="sm">
            {STATE_LABEL[state]} · {n}
          </Badge>
        ))}
      </div>
      {allGaps ? (
        <ol className="space-y-1 text-sm">
          {gapsOf(ordered)
            .filter((g) => g.entry.gapPriority !== 'low')
            .map(({ source: src, entry }) => (
              <li key={src + entry.n}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left hover:bg-muted"
                  onClick={() => pick(src, entry)}
                >
                  <Badge tone={entry.gapPriority === 'high' ? 'danger' : 'warning'} size="sm">
                    {entry.gapPriority}
                  </Badge>{' '}
                  <span className="font-medium">
                    {catalogueSources.find((s) => s.id === src) ? title(src) : src}, {label(src, entry.n)}
                  </span>
                  <span className="block text-xs text-muted-foreground">{entry.gapNote ?? entry.bearsOn}</span>
                </button>
              </li>
            ))}
        </ol>
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="list" aria-label={`Sections of ${title(review.source)}`}>
            {states.map(({ entry, state }) => (
              <button
                key={entry.n}
                type="button"
                role="listitem"
                title={`${label(review.source, entry.n)}: ${entry.bearsOn}`}
                onClick={() => pick(review.source, entry)}
                className={cn(
                  'h-6 min-w-9 rounded-sm border px-1 font-mono text-2xs tabular-nums hover:brightness-95',
                  CHIP[state],
                )}
              >
                {entry.n.length > 10 ? entry.n.slice(0, 9) + '…' : entry.n}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            List the sections that are not about a block too
          </label>
          <table className="w-full text-sm">
            <tbody>
              {listed.map(({ entry, state }) => (
                <tr
                  key={entry.n}
                  className="cursor-pointer border-t border-border align-top hover:bg-muted"
                  onClick={() => pick(review.source, entry)}
                >
                  <td className="w-20 py-1.5 pr-2 font-mono text-xs">{label(review.source, entry.n)}</td>
                  <td className="py-1.5 pr-2">
                    {entry.bearsOn}
                    {entry.gapNote && <span className="block text-xs text-muted-foreground">{entry.gapNote}</span>}
                  </td>
                  <td className="w-36 py-1.5">
                    <Badge tone={TONE[state]} size="sm">
                      {STATE_LABEL[state]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <DialogShell
        open={!!picked}
        onOpenChange={(open) => !open && setPicked(null)}
        title={picked ? `${title(picked.source)}, ${label(picked.source, picked.entry.n)}` : ''}
        eyebrow="Coverage"
        size="lg"
        expandable
        closeLabel="Close section"
      >
        {picked && (
          <div className="space-y-4">
            <div className="space-y-1.5 rounded border border-border bg-card p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[picked.state]} size="sm">
                  {STATE_LABEL[picked.state]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {picked.entry.relevance} · review: {picked.entry.review}
                </span>
              </p>
              <p>{picked.entry.bearsOn}</p>
              {picked.entry.gapNote && (
                <p className="text-xs">
                  <span className="font-medium">What a rule would need: </span>
                  {picked.entry.gapNote}
                </p>
              )}
              {picked.entry.proposedFacts?.length ? (
                <ul className="list-disc pl-5 text-xs">
                  {picked.entry.proposedFacts.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              ) : null}
              {cited.length > 0 && (
                <p className="text-xs">
                  <span className="font-medium">Cited by: </span>
                  {[...new Set(cited.map((c) => c.label))].join(' · ')}
                </p>
              )}
            </div>
            {pickedSource && (
              <ProvisionText
                citation={{ sourceUrl: pickedSource.url, sourceTitle: pickedSource.title, provision: picked.entry.n }}
              />
            )}
          </div>
        )}
      </DialogShell>
    </div>
  )
}
