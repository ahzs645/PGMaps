import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { CollapsibleSection, InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { EmptyHint } from '@/components/ui/result-list'
import { cn } from '@/lib/utils'
import { ReferenceHeading, ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import { BC_COST_REGIONS } from './bcCostReferences'
import {
  EVIDENCE_FRESHNESS,
  EVIDENCE_KINDS,
  EVIDENCE_PLACES,
  evidenceBasis,
  evidenceKindsIn,
  evidencePlace,
  filterEvidence,
  formatEvidenceAmount,
  formatEvidenceMoney,
  groupEvidence,
  groupTerms,
  regionLocalEvidence,
  workedEstimateLineTotal,
  type CostEvidenceCatalogue,
  type EvidenceFilter,
  type EvidenceGroup,
  type EvidenceKind,
  type EvidencePlace,
  type EvidenceRecord,
  type EvidenceSource,
  type EvidenceTerm,
} from './costEvidence/costEvidence'
import { loadCostEvidence } from './costEvidence/loadCostEvidence'
import { AdoptRecord } from './RateAdoption'

export type CostEvidenceState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; catalogue: CostEvidenceCatalogue }

/** Loads the catalogue the first time the dialog opens. A failed load is an error with a retry. */
export function useCostEvidence(enabled: boolean): CostEvidenceState {
  const [catalogue, setCatalogue] = useState<CostEvidenceCatalogue | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || catalogue) return
    let cancelled = false
    loadCostEvidence().then(
      (loaded) => {
        if (!cancelled) setCatalogue(loaded)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled, catalogue, attempt])
  if (catalogue) return { status: 'ready', catalogue }
  if (failed)
    return {
      status: 'error',
      retry: () => {
        setFailed(false)
        setAttempt((value) => value + 1)
      },
    }
  return { status: enabled ? 'loading' : 'idle' }
}

/** The loading and failed states every evidence view shares. */
export function CostEvidenceGate({
  state,
  children,
}: {
  state: CostEvidenceState
  children: (catalogue: CostEvidenceCatalogue) => React.ReactNode
}) {
  if (state.status === 'ready') return <>{children(state.catalogue)}</>
  if (state.status === 'error')
    return (
      <InlineAlert tone="error" title="The evidence catalogue did not load">
        <p>No prices are shown. A missing record is not a zero price.</p>
        <Button type="button" variant="outline" size="xs" className="mt-1.5" onClick={state.retry}>
          Try again
        </Button>
      </InlineAlert>
    )
  return <InlineAlert loading>Loading the evidence catalogue…</InlineAlert>
}

function Terms({ terms, cautions }: { terms: EvidenceTerm[]; cautions: string[] }) {
  if (!terms.length && !cautions.length) return null
  return (
    <div className="space-y-1 text-2xs leading-4 text-muted-foreground">
      {terms.length > 0 && (
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          {terms.map((term) => (
            <div key={term.label} className="contents">
              <dt className="text-foreground">{term.label}</dt>
              <dd className={cn(term.text === 'Not stated' && 'italic')}>{term.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {cautions.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecordBadges({ record }: { record: EvidenceRecord }) {
  const freshness = record.freshness ? EVIDENCE_FRESHNESS[record.freshness] : null
  return (
    <>
      {freshness && (
        <Badge tone={freshness.tone} variant="outline">
          {freshness.label}
        </Badge>
      )}
      {record.fundingOnly && (
        <Badge tone="warning" variant="outline">
          Not a price
        </Badge>
      )}
      {record.contextOnly && (
        <Badge tone="warning" variant="outline">
          Context only
        </Badge>
      )}
    </>
  )
}

/**
 * One supplier's or source's records: each amount in its own unit, currency and price year, the
 * terms the whole group shares printed once below, and the link to check them against.
 */
function EvidenceGroupBody({ group, source }: { group: EvidenceGroup; source?: EvidenceSource }) {
  const terms = useMemo(() => groupTerms(group.records), [group.records])
  const first = group.records[0]
  const urls = [...new Set(group.records.map((record) => record.url))]
  const places = [...new Set(group.records.map((record) => record.place))]
  return (
    <div className="space-y-2 px-3 pb-3" data-testid="road-cost-evidence-group">
      <p className="text-2xs leading-4 text-muted-foreground">
        {EVIDENCE_KINDS[first.kind].use}
        {places.length === 1 && ` ${places[0]}.`}
      </p>
      <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
        {group.records.map((record) => {
          const own = terms.own.get(record.id)!
          return (
            <li key={record.id} className="space-y-1 p-2">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="min-w-0 flex-1 basis-40 text-xs text-foreground">
                  {record.title}
                  {places.length > 1 && <span className="text-muted-foreground"> · {record.place}</span>}
                </p>
                <p className="text-xs font-semibold tabular-nums text-foreground">{formatEvidenceAmount(record)}</p>
              </div>
              <p className="flex flex-wrap items-center gap-1 text-2xs leading-4 text-muted-foreground">
                <span>{evidenceBasis(record)}</span>
                <RecordBadges record={record} />
                {record.kind !== first.kind && <Badge variant="outline">{EVIDENCE_KINDS[record.kind].label}</Badge>}
              </p>
              <Terms terms={own.terms} cautions={own.cautions} />
              <AdoptRecord record={record} />
            </li>
          )
        })}
      </ul>
      {(terms.shared.length > 0 || terms.sharedCautions.length > 0) && (
        <div className="space-y-1">
          <p className="text-2xs font-medium text-foreground">Applies to all {group.records.length}</p>
          <Terms terms={terms.shared} cautions={terms.sharedCautions} />
        </div>
      )}
      {source && (source.method || source.priceBasis) && (
        <p className="text-2xs leading-4 text-muted-foreground">
          {source.method ?? source.priceBasis}
          {source.method && source.priceBasis ? ` Price basis: ${source.priceBasis}` : ''}
        </p>
      )}
      <p className="text-2xs leading-4 text-muted-foreground">
        {urls.map((url, index) => (
          <span key={url}>
            {index > 0 && ' · '}
            <ReferenceLink href={url}>{urls.length > 1 ? `Source ${index + 1}` : 'Source'}</ReferenceLink>
          </span>
        ))}
        {urls.length === 1 && first.locator && group.records.length === 1 ? ` · ${first.locator}` : ''}
        {' · checked ' + first.checked}
      </p>
    </div>
  )
}

/** A supplier's first price and how many more it lists, so a folded row still shows a number. */
function priceSummary(group: EvidenceGroup): string {
  const [first, ...rest] = group.records
  return `${first.title} ${formatEvidenceAmount(first)}${rest.length ? ` · +${rest.length} more` : ''}`
}

function groupSummary(group: EvidenceGroup): string {
  const kinds = [...new Set(group.records.map((record) => EVIDENCE_KINDS[record.kind].label))]
  return `${group.records.length} ${group.records.length === 1 ? 'record' : 'records'} · ${kinds.join(', ')}`
}

function EvidenceGroupList({
  groups,
  sources,
  defaultOpen = false,
  summary = groupSummary,
}: {
  groups: EvidenceGroup[]
  sources: EvidenceSource[]
  defaultOpen?: boolean
  summary?: (group: EvidenceGroup) => string
}) {
  // Only an opened group renders its records; a hundred folded rows cost nothing.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  return (
    <div className={cn(insetBox({ padding: 'none', hoverRows: true }), 'overflow-hidden')}>
      {groups.map((group) => {
        const open = toggled.has(group.name) !== defaultOpen
        return (
          <CollapsibleSection
            key={group.name}
            label={<span className="block max-w-[58vw] truncate sm:max-w-xs">{group.name}</span>}
            summary={summary(group)}
            open={open}
            onOpenChange={() =>
              setToggled((current) => {
                const next = new Set(current)
                if (!next.delete(group.name)) next.add(group.name)
                return next
              })
            }
            className="bg-transparent last:border-b-0"
          >
            {open && (
              <EvidenceGroupBody
                group={group}
                source={sources.find((source) => source.id === group.records[0].sourceId)}
              />
            )}
          </CollapsibleSection>
        )
      })}
    </div>
  )
}

/** A region's supplier prices, its other local records and its quote-only leads, each kept apart. */
export function RegionLocalEvidence({
  catalogue,
  regionId,
  onShowProjects,
}: {
  catalogue: CostEvidenceCatalogue
  regionId: string
  onShowProjects: () => void
}) {
  const local = useMemo(() => regionLocalEvidence(catalogue, regionId), [catalogue, regionId])
  return (
    <div className="space-y-3" data-testid="road-bc-local-evidence">
      {local.suppliers.length > 0 ? (
        <EvidenceGroupList key={regionId} groups={local.suppliers} sources={catalogue.sources} summary={priceSummary} />
      ) : (
        <InlineAlert tone="warning" title="Local quote required">
          No comparable public construction-aggregate price is verified for this region. Use a dated local quote; do not
          copy another region&apos;s rate.
        </InlineAlert>
      )}
      {local.other.length > 0 && (
        <div className="space-y-1.5">
          <ReferenceHeading info="Recent local purchases and fees for other products or uses. They are evidence of what was paid, not offers for road-base aggregate, so they stay out of the supplier prices above.">
            Other local records
          </ReferenceHeading>
          <EvidenceGroupList
            key={regionId}
            groups={groupEvidence(local.other)}
            sources={catalogue.sources}
            summary={priceSummary}
          />
        </div>
      )}
      {local.leads.length > 0 && (
        <div className="space-y-1.5">
          <ReferenceHeading info="Suppliers whose pages list products without a usable price. They are where to send a scoped quote request, not evidence of a price.">
            Quote on request
          </ReferenceHeading>
          <ul className={cn(insetBox({ padding: 'none', hoverRows: true }), 'divide-y overflow-hidden')}>
            {local.leads.map((lead) => (
              <li key={lead.url} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="shrink-0 font-medium">
                  <ReferenceLink href={lead.url}>{lead.party}</ReferenceLink>
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{lead.place}</span>
                <InfoTip label={`What ${lead.party} lists`}>
                  {lead.products.length > 0 && <p>Lists {lead.products.join(', ')}.</p>}
                  <p className="text-muted-foreground">
                    {lead.status}. Checked {lead.checked}.
                  </p>
                </InfoTip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {local.projects.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            className="rounded-sm text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="road-bc-region-projects"
            onClick={onShowProjects}
          >
            {local.projects.length} project {local.projects.length === 1 ? 'record' : 'records'} tagged to this region
          </button>
          <InfoTip label="About this region's project records">
            Contract awards, crossing projects and consultant estimates, opened in the Evidence tab. The tag follows the
            location and is not a verified boundary.
          </InfoTip>
        </p>
      )}
    </div>
  )
}

const ALL = 'all'

/** Every record in the catalogue, narrowed by place, evidence type, region and words. */
export function EvidenceBrowser({
  catalogue,
  filter,
  onFilter,
}: {
  catalogue: CostEvidenceCatalogue
  filter: EvidenceFilter
  onFilter: (filter: EvidenceFilter) => void
}) {
  const inPlace = useMemo(
    () => filterEvidence(catalogue.records, { ...filter, kind: ALL, query: '' }),
    [catalogue.records, filter],
  )
  const shown = useMemo(() => filterEvidence(catalogue.records, filter), [catalogue.records, filter])
  const groups = useMemo(() => groupEvidence(shown), [shown])
  const places = (Object.keys(EVIDENCE_PLACES) as EvidencePlace[]).filter((place) =>
    catalogue.records.some((record) => evidencePlace(record) === place),
  )
  const filtered = filter.place !== ALL || filter.kind !== ALL || filter.regionId !== ALL || filter.query !== ''
  return (
    <div className="space-y-3" data-testid="road-cost-evidence-browser">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ReferenceSelect
          label="Where"
          value={filter.place}
          options={[
            { value: ALL, label: 'Everywhere' },
            ...places.map((place) => ({ value: place, label: EVIDENCE_PLACES[place] })),
          ]}
          onChange={(value) =>
            onFilter({ ...filter, place: value as EvidenceFilter['place'], kind: ALL, regionId: ALL })
          }
        />
        <ReferenceSelect
          label="Evidence type"
          value={filter.kind}
          options={[
            { value: ALL, label: 'Every type' },
            ...evidenceKindsIn(inPlace).map((kind) => ({ value: kind, label: EVIDENCE_KINDS[kind].label })),
          ]}
          onChange={(value) => onFilter({ ...filter, kind: value as EvidenceKind | typeof ALL })}
        />
        {filter.place === 'bc' && (
          <ReferenceSelect
            label="BC region"
            value={filter.regionId}
            options={[
              { value: ALL, label: 'All of BC' },
              ...BC_COST_REGIONS.map((region) => ({ value: region.id, label: region.name })),
            ]}
            onChange={(regionId) => onFilter({ ...filter, regionId, kind: ALL })}
            hint="A project's region tag follows its location; the boundary is not verified."
          />
        )}
        <div className={cn('space-y-1', filter.place !== 'bc' && 'sm:col-span-2')}>
          <label htmlFor="road-cost-evidence-search" className="text-2xs font-medium text-muted-foreground">
            Work or source
          </label>
          <SearchInput
            id="road-cost-evidence-search"
            value={filter.query}
            placeholder="culvert, excavation, gravel…"
            onChange={(event) => onFilter({ ...filter, query: event.target.value })}
            onClear={() => onFilter({ ...filter, query: '' })}
          />
        </div>
      </div>
      {filter.kind !== ALL && (
        <p className="text-2xs leading-4 text-muted-foreground">{EVIDENCE_KINDS[filter.kind].use}</p>
      )}
      <div className="flex items-center gap-1 text-2xs text-muted-foreground" aria-live="polite">
        <span data-testid="road-cost-evidence-count">
          {shown.length} {shown.length === 1 ? 'record' : 'records'} from {groups.length}{' '}
          {groups.length === 1 ? 'source' : 'sources'}
        </span>
        <InfoTip label="About these records">
          Each amount stays in its own currency, unit and price year. Nothing is converted, escalated or averaged, and
          browsing changes nothing. A record reaches the estimate only through Use for a project rate, where you type
          the rate yourself. Two records from one project or source are not independent samples.
        </InfoTip>
      </div>
      {groups.length > 0 ? (
        <EvidenceGroupList
          key={JSON.stringify(filter)}
          groups={groups}
          sources={catalogue.sources}
          defaultOpen={groups.length === 1}
        />
      ) : (
        <EmptyHint>
          No record matches.{' '}
          {filtered && (
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => onFilter({ place: ALL, kind: ALL, regionId: ALL, query: '' })}
            >
              Show every record
            </button>
          )}
        </EmptyHint>
      )}
    </div>
  )
}

/** A complete estimate: its quantities, rates, allowances and totals read together. */
export function WorkedEstimates({ catalogue }: { catalogue: CostEvidenceCatalogue }) {
  const [id, setId] = useState(catalogue.estimates[0]?.id ?? '')
  const estimate = catalogue.estimates.find((item) => item.id === id)
  if (!estimate) return <EmptyHint>No worked estimate in the catalogue.</EmptyHint>
  const money = (value: number) => formatEvidenceMoney(value, estimate.currency)
  const source = catalogue.sources.find((item) => item.id === estimate.sourceId)
  return (
    <div className="space-y-3" data-testid="road-cost-worked-estimate">
      <ReferenceSelect
        label="Worked estimate"
        value={id}
        options={catalogue.estimates.map((item) => ({ value: item.id, label: item.title }))}
        onChange={setId}
        hint="A rate keeps its meaning inside the estimate it came from. Several examples share a project or source."
      />
      <p className="text-2xs leading-4 text-muted-foreground">
        {estimate.status} · {estimate.currency}
        {estimate.costYear ? ` · ${estimate.costYear}` : ''} · no conversion or escalation ·{' '}
        <ReferenceLink href={estimate.url}>Source</ReferenceLink> · {estimate.locator}
      </p>
      {estimate.lines.length > 0 && (
        <div className="overflow-x-auto">
          <EngineeringTable rowHeaders compact className="[&_td]:bg-background [&_th]:bg-background">
            <thead>
              <tr>
                <ColumnHeader label="Item" className="text-left" />
                <ColumnHeader label="Quantity" />
                <ColumnHeader label="Unit" className="text-left" />
                <ColumnHeader label="Rate" />
                <ColumnHeader label="Amount" unit={estimate.currency} />
              </tr>
            </thead>
            <tbody>
              {estimate.lines.map((line) => (
                <tr key={line.label}>
                  <th scope="row">{line.label}</th>
                  <td>{line.quantity.toLocaleString('en-CA')}</td>
                  <td className="text-left">{line.unit}</td>
                  <td>{money(line.rate)}</td>
                  <td>{money(line.amount)}</td>
                </tr>
              ))}
              <tr>
                <td className="text-left font-medium" colSpan={4}>
                  Lines as listed
                </td>
                <td className="font-medium">{money(workedEstimateLineTotal(estimate))}</td>
              </tr>
            </tbody>
          </EngineeringTable>
        </div>
      )}
      <dl className={cn(insetBox({ padding: 'none' }), 'divide-y text-xs')}>
        {estimate.totals.map((total) => (
          <div key={total.label} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
            <dt className="text-muted-foreground">{total.label}</dt>
            <dd className="font-medium tabular-nums">{money(total.amount)}</dd>
          </div>
        ))}
      </dl>
      <ul className="list-disc space-y-0.5 pl-4 text-2xs leading-4 text-muted-foreground">
        {estimate.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        {source?.priceBasis && <li>Price basis: {source.priceBasis}</li>}
      </ul>
    </div>
  )
}
