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
  ordersInDistrict,
  ordersUnder,
  sectionKey,
  sectionsWithTopic,
  sectionState,
  STATE_LABEL,
  topicCounts,
  type CoverageEntry,
  type AdminAreasFile,
  type CoverageReview,
  type Enabling,
  type LawTopicsFile,
  type OrderLinks,
  type SectionState,
} from '@/lib/legal/coverage'
import { catalogueIdForUrl, catalogueSource, catalogueSources } from '@/lib/legal/lawLibrary'
import { cn } from '@/lib/utils'
import adminAreas from '../../../packages/legal-rules/catalogue/admin-areas.json'
import topicsFile from '../../../packages/legal-rules/catalogue/topics.json'
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
const { topics: TOPICS } = topicsFile as LawTopicsFile
const TOPIC_GROUPS = [...new Set(TOPICS.map((t) => t.group))]
const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id
const { districts: DISTRICTS, regions: REGIONS } = adminAreas as AdminAreasFile
const districtName = (code: string) =>
  DISTRICTS.find((d) => d.code === code)?.name.replace(' Natural Resource District', '') ?? code
/** Every order and policy the catalogue places in an area, with the sections it is made under. */
const ORDERS: OrderLinks[] = catalogueSources.filter((s) => s.areas)
const UNDER = ordersUnder(ORDERS)
const shortTitle = (id: string) => catalogueSource(id)?.title.replace(/,.*$/, '') ?? id
const enablingText = (e: Enabling) => (e.source ? `${shortTitle(e.source)} s. ${e.provision}` : (e.text ?? ''))
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
  const [topic, setTopic] = useState('')
  const [district, setDistrict] = useState('')
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
  const counted = topicCounts(ordered)
  const onTopic = topic ? sectionsWithTopic(ordered, topic) : []
  const onTopicSources = [...new Set(onTopic.map((x) => x.source))]
  return (
    <div className="space-y-4" data-testid="law-coverage">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <SelectField
            label="Source"
            value={review.source}
            onValueChange={(v) => {
              setSource(v)
              setTopic('')
              setDistrict('')
              setAllGaps(false)
            }}
          >
            {ordered.map((r) => (
              <option key={r.source} value={r.source}>
                {title(r.source)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="min-w-64 flex-1">
          <SelectField
            label="Topic"
            value={topic}
            onValueChange={(v) => {
              setTopic(v)
              if (v) {
                setAllGaps(false)
                setDistrict('')
              }
            }}
          >
            <option value="">Every topic</option>
            {TOPIC_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {TOPICS.filter((t) => t.group === g).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({counted.get(t.id) ?? 0})
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectField>
        </div>
        <div className="min-w-56 flex-1">
          <SelectField
            label="Natural resource district"
            value={district}
            onValueChange={(v) => {
              setDistrict(v)
              if (v) {
                setAllGaps(false)
                setTopic('')
              }
            }}
          >
            <option value="">Every district</option>
            {REGIONS.map((r) => (
              <optgroup key={r.code} label={r.name}>
                {DISTRICTS.filter((d) => d.region === r.code).map((d) => (
                  <option key={d.code} value={d.code}>
                    {districtName(d.code)} ({ordersInDistrict(ORDERS, d.code).length})
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectField>
        </div>
        <Button
          size="sm"
          variant={allGaps ? 'default' : 'outline'}
          aria-pressed={allGaps}
          onClick={() => {
            setAllGaps(!allGaps)
            setTopic('')
            setDistrict('')
          }}
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
      {!topic && !district && !allGaps && catalogueSource(review.source)?.areas && (
        <OrderLinksLine order={catalogueSource(review.source)!} />
      )}
      {!topic && !district && (
        <div className="flex flex-wrap gap-1.5" aria-label="Sections by state">
          {counts.map(([state, n]) => (
            <Badge key={state} tone={TONE[state]} size="sm">
              {STATE_LABEL[state]} · {n}
            </Badge>
          ))}
        </div>
      )}
      {district ? (
        <div className="space-y-2" data-testid="law-district">
          <p className="text-sm">
            <span className="font-medium">{districtName(district)}</span>
            <span className="text-muted-foreground">
              {' '}
              · {ordersInDistrict(ORDERS, district).length} orders and policies cover it, in part or in whole. The
              district says an order applies somewhere in it; the map layers decide whether one reaches a block.
            </span>
          </p>
          <table className="w-full text-sm">
            <tbody>
              {ordersInDistrict(ORDERS, district).map((o) => {
                const reviewed = ordered.some((r) => r.source === o.id)
                return (
                  <tr key={o.id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2">
                      {reviewed ? (
                        <button
                          type="button"
                          className="text-left font-medium underline-offset-2 hover:underline"
                          onClick={() => {
                            setSource(o.id)
                            setDistrict('')
                          }}
                        >
                          {o.title}
                        </button>
                      ) : (
                        <a
                          className="font-medium hover:underline"
                          href={catalogueSource(o.id)?.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {o.title}
                        </a>
                      )}
                      <span className="block text-xs text-muted-foreground">{o.areas?.basis}</span>
                    </td>
                    <td className="w-64 py-1.5 text-xs">
                      {(o.enabling ?? []).map(enablingText).join('; ') || 'No enabling section recorded'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : topic ? (
        <div className="space-y-3" data-testid="law-topic">
          <p className="text-sm">
            <span className="font-medium">{topicLabel(topic)}</span>
            <span className="text-muted-foreground">
              {' '}
              · {TOPICS.find((t) => t.id === topic)?.description} {onTopic.length} sections and provisions in{' '}
              {onTopicSources.length} sources.
            </span>
          </p>
          {onTopicSources.map((src) => (
            <section key={src} className="space-y-1" aria-label={title(src)}>
              <h3 className="text-sm font-semibold">{title(src)}</h3>
              <table className="w-full text-sm">
                <tbody>
                  {onTopic
                    .filter((x) => x.source === src)
                    .map(({ entry }) => {
                      const state = sectionState(index.get(sectionKey(src, entry.n)), entry)
                      return (
                        <tr
                          key={entry.n}
                          className="cursor-pointer border-t border-border align-top hover:bg-muted"
                          onClick={() => pick(src, entry)}
                        >
                          <td className="w-28 py-1.5 pr-2 font-mono text-xs">{label(src, entry.n)}</td>
                          <td className="py-1.5 pr-2">{entry.bearsOn}</td>
                          <td className="w-36 py-1.5">
                            <Badge tone={TONE[state]} size="sm">
                              {STATE_LABEL[state]}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ) : allGaps ? (
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
              {picked.entry.topics?.length ? (
                <p className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="font-medium">Topics:</span>
                  {picked.entry.topics.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded-sm border border-border px-1.5 py-0.5 hover:bg-muted"
                      onClick={() => {
                        setTopic(t)
                        setAllGaps(false)
                        setPicked(null)
                      }}
                    >
                      {topicLabel(t)}
                    </button>
                  ))}
                </p>
              ) : null}
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
              {!isOrder(picked.source) && (UNDER.get(sectionKey(picked.source, picked.entry.n)) ?? []).length > 0 && (
                <p className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="font-medium">Orders made under it:</span>
                  {UNDER.get(sectionKey(picked.source, picked.entry.n))!.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="rounded-sm border border-border px-1.5 py-0.5 text-left hover:bg-muted"
                      onClick={() => {
                        if (ordered.some((r) => r.source === o.id)) {
                          setSource(o.id)
                          setTopic('')
                          setDistrict('')
                          setAllGaps(false)
                        } else window.open(catalogueSource(o.id)?.url, '_blank', 'noopener')
                        setPicked(null)
                      }}
                    >
                      {o.title}
                    </button>
                  ))}
                </p>
              )}
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

/** Under an order's map: the sections it is made under and the districts it covers. */
function OrderLinksLine({ order }: { order: OrderLinks }) {
  const areas = order.areas
  return (
    <p className="text-xs" data-testid="order-links">
      <span className="font-medium">Made under: </span>
      {(order.enabling ?? []).map(enablingText).join('; ') || 'No enabling section recorded'}
      <span className="font-medium"> · Covers: </span>
      {areas?.scope === 'province' ? 'the whole province' : (areas?.districts ?? []).map(districtName).join(', ')}
      <span className="block text-muted-foreground">{areas?.basis}</span>
    </p>
  )
}
