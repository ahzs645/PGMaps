import { useState } from 'react'
import { BookOpenText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InfoTip } from '@/components/ui/info-tip'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TabBar } from '@/components/ui/tab-bar'
import {
  BC_COST_REGIONS,
  BC_COST_REVIEWED_DATE,
  BC_FUEL_ADJUSTMENT_SOURCE,
  BC_GEOGRAPHIC_CONTEXT_SOURCES,
  BC_REGION_SOURCE,
  BC_SUPPORTING_COST_SOURCES,
} from './bcCostReferences'
import { AppraisalScopePanel } from './AppraisalScopePanel'
import { INTERIOR_APPRAISAL_FUEL } from './appraisalScope'
import {
  CostEvidenceGate,
  EvidenceBrowser,
  RegionLocalEvidence,
  WorkedEstimates,
  useCostEvidence,
} from './CostEvidenceViews'
import { NO_EVIDENCE_FILTER, type EvidenceFilter } from './costEvidence/costEvidence'
import { BCInteriorBenchmark } from './BCInteriorBenchmark'
import { BCCoastBenchmark } from './BCCoastBenchmark'
import { ReferenceHeading, ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import { CostRateTools } from './CostRateToolsPanel'
import { RateAdoptionContext, type RateAdoptionTarget } from './RateAdoption'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'

type ReferenceTab = 'appraisal' | 'rates' | 'evidence' | 'sources'
const TABS = [
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'rates', label: 'Unit rates' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'sources', label: 'Sources' },
] as const

const fuelRowClass = 'flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2'

interface SourceLink {
  url: string
  title: string
  detail: string
}

function SourceList({ sources }: { sources: readonly SourceLink[] }) {
  return (
    <ul className={cn(insetBox({ padding: 'none', hoverRows: true }), 'divide-y overflow-hidden')}>
      {sources.map((source) => (
        <li key={source.url} className="flex items-center gap-2 px-3 py-2">
          <p className="min-w-0 flex-1 font-medium">
            <ReferenceLink href={source.url}>{source.title}</ReferenceLink>
          </p>
          <InfoTip label={`About ${source.title}`}>{source.detail}</InfoTip>
        </li>
      ))}
    </ul>
  )
}

/**
 * Source evidence and independent benchmarks, in their own dialog beside the rate preset. Opening
 * and browsing write nothing. The one write is `adoption.onAdopt`, from the confirmed form under an
 * evidence record (`RateAdoption.tsx`); without `adoption` no record offers it. Every tab stays
 * mounted, so typed inputs survive a switch.
 */
export function BCCostReferences({
  portalContainer,
  adoption,
}: {
  portalContainer?: HTMLElement | null
  adoption?: RateAdoptionTarget
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ReferenceTab>('appraisal')
  const [regionId, setRegionId] = useState('unselected')
  const [method, setMethod] = useState<'interior' | 'coast'>('interior')
  const [evidenceView, setEvidenceView] = useState<'records' | 'estimates'>('records')
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>(NO_EVIDENCE_FILTER)
  const evidence = useCostEvidence(open)
  const region = BC_COST_REGIONS.find((item) => item.id === regionId)
  return (
    <>
      <Button
        size="xs"
        variant="outline"
        data-testid="road-bc-cost-toggle"
        title="Dated cost evidence, appraisal comparisons and unit-rate converters"
        onClick={() => setOpen(true)}
      >
        <BookOpenText className="size-3.5" />
        BC references
      </Button>
      <PanelDialog
        open={open}
        onOpenChange={setOpen}
        title="BC regional cost references"
        subtitle={`Appraisal comparisons, unit-rate tools and source evidence. Reviewed ${BC_COST_REVIEWED_DATE}.`}
        toolbar={
          <TabBar
            value={tab}
            options={TABS}
            onChange={setTab}
            label="Cost reference sections"
            idPrefix="road-bc-cost"
            stretch
          />
        }
        size="lg"
        portalContainer={portalContainer}
        // Opened from the cost dialog, so it sits one layer above it.
        className="z-menu"
        contentProps={{ 'data-testid': 'road-bc-cost-references' }}
      >
        <RateAdoptionContext.Provider value={adoption ?? null}>
          <div
            role="tabpanel"
            id="road-bc-cost-panel-appraisal"
            aria-labelledby="road-bc-cost-tab-appraisal"
            hidden={tab !== 'appraisal'}
            className="space-y-4 text-xs"
          >
            <ReferenceSelect
              label="BC natural resource region"
              value={regionId}
              options={[
                { value: 'unselected', label: 'Choose a region' },
                ...BC_COST_REGIONS.map((item) => ({ value: item.id, label: item.name })),
              ]}
              onChange={(value) => {
                setRegionId(value)
                const next = BC_COST_REGIONS.find((item) => item.id === value)
                setMethod(next?.method === 'coast' ? 'coast' : 'interior')
              }}
              hint={
                <>
                  A region sets the starting comparison method and local evidence; it does not determine an appraisal
                  road group. <ReferenceLink href={BC_REGION_SOURCE}>Official region and district list</ReferenceLink>
                </>
              }
            />
            {!region ? (
              <p className="text-2xs leading-4 text-muted-foreground">
                Choose a region to see its appraisal road groups, local material prices and the matching comparison.
              </p>
            ) : (
              <div className="space-y-4" data-testid="road-bc-region-reference">
                {/* One line of facts; what to confirm before relying on them is behind the (i). */}
                <div className={cn(insetBox({ padding: 'lg' }), 'space-y-1')}>
                  <p className="flex items-center gap-1 text-xs text-foreground">
                    {region.groups.length > 0 ? (
                      <span>
                        Candidate Interior road groups{' '}
                        <span className="font-semibold tabular-nums">{region.groups.join(', ')}</span>
                      </span>
                    ) : (
                      <span className="font-medium">{region.name}</span>
                    )}
                    <InfoTip label="What to confirm for this region">
                      {region.groups.length > 0 && (
                        <p>
                          A lookup guide only. Confirm the district, timber supply area and supply block in IAM Table
                          4-2.
                        </p>
                      )}
                      <p className={cn(region.groups.length > 0 && 'mt-1.5')}>{region.review}</p>
                    </InfoTip>
                  </p>
                  <p className="text-2xs leading-4 text-muted-foreground">{region.geography}</p>
                </div>

                <section className="space-y-2" aria-label="Local material-price evidence">
                  <ReferenceHeading info="Each supplier's published prices, checked by hand on the date shown. A price keeps its own unit, date, tax, loading and delivery terms; a term the source does not state reads Not stated, and a missing price is not a zero-cost material.">
                    Local material prices
                  </ReferenceHeading>
                  <CostEvidenceGate state={evidence}>
                    {(catalogue) => (
                      <RegionLocalEvidence
                        catalogue={catalogue}
                        regionId={region.id}
                        onShowProjects={() => {
                          setEvidenceFilter({ ...NO_EVIDENCE_FILTER, place: 'bc', regionId: region.id })
                          setEvidenceView('records')
                          setTab('evidence')
                        }}
                      />
                    )}
                  </CostEvidenceGate>
                </section>

                <section className={cn(insetBox({ padding: 'lg' }), 'space-y-3')} aria-label="Appraisal comparison">
                  <ReferenceHeading info="Both 2026 manuals use a 2024 cost base. Each is a separate CAD/km comparison with no regional multiplier or escalation, and neither is added to the covered estimate. Inputs are temporary; download a comparison record to keep its assumptions and source.">
                    Appraisal comparison
                  </ReferenceHeading>
                  <SegmentedControl
                    label="Appraisal comparison method"
                    value={method}
                    options={[
                      { value: 'interior', label: 'Interior · subgrade only' },
                      { value: 'coast', label: 'Coast · bundled construction' },
                    ]}
                    onChange={setMethod}
                  />
                  {method === 'interior' ? (
                    <BCInteriorBenchmark key={regionId} regionName={region.name} />
                  ) : (
                    <BCCoastBenchmark key={regionId} />
                  )}
                </section>

                <AppraisalScopePanel method={method} />
              </div>
            )}
          </div>

          <div
            role="tabpanel"
            id="road-bc-cost-panel-rates"
            aria-labelledby="road-bc-cost-tab-rates"
            hidden={tab !== 'rates'}
            className="text-xs"
          >
            <CostRateTools />
          </div>

          <div
            role="tabpanel"
            id="road-bc-cost-panel-evidence"
            aria-labelledby="road-bc-cost-tab-evidence"
            hidden={tab !== 'evidence'}
            className="space-y-3 text-xs"
          >
            <SegmentedControl
              label="Evidence view"
              value={evidenceView}
              options={[
                { value: 'records', label: 'Records' },
                { value: 'estimates', label: 'Worked estimates' },
              ]}
              onChange={setEvidenceView}
            />
            <CostEvidenceGate state={evidence}>
              {(catalogue) =>
                evidenceView === 'records' ? (
                  <EvidenceBrowser catalogue={catalogue} filter={evidenceFilter} onFilter={setEvidenceFilter} />
                ) : (
                  <WorkedEstimates catalogue={catalogue} />
                )
              }
            </CostEvidenceGate>
          </div>

          <div
            role="tabpanel"
            id="road-bc-cost-panel-sources"
            aria-labelledby="road-bc-cost-tab-sources"
            hidden={tab !== 'sources'}
            className="space-y-4 text-xs"
          >
            <SourceList
              sources={[
                {
                  url: BC_REGION_SOURCE,
                  title: 'BC natural resource regions and districts',
                  detail: 'The official region and district list the region picker follows.',
                },
                ...BC_SUPPORTING_COST_SOURCES,
              ]}
            />

            <section className="space-y-2" aria-label="Fuel references">
              <ReferenceHeading info="Two published fuel figures that answer different questions. Neither is a regional multiplier, and neither goes on top of a supplier or equipment rate that already includes fuel.">
                Fuel references
              </ReferenceHeading>
              <dl
                className={cn(insetBox({ padding: 'none', hoverRows: true }), 'divide-y overflow-hidden')}
                data-testid="road-bc-fuel-references"
              >
                <div className={fuelRowClass}>
                  <dt className="min-w-0 flex-1 font-medium">Interior appraisal fuel allowance</dt>
                  <dd className="tabular-nums">
                    ${INTERIOR_APPRAISAL_FUEL.onRoadPerHour.toFixed(2)}/hour on-road · $
                    {INTERIOR_APPRAISAL_FUEL.offRoadPerHour.toFixed(2)}/hour off-road
                  </dd>
                  <dd>
                    <InfoTip label="About the Interior appraisal fuel allowance">
                      {INTERIOR_APPRAISAL_FUEL.locator}, effective 1 July 2026. Belongs to the Interior manual&apos;s
                      engineered estimates.
                    </InfoTip>
                  </dd>
                </div>
                <div className={fuelRowClass}>
                  <dt className="min-w-0 flex-1 font-medium">
                    <ReferenceLink href={BC_FUEL_ADJUSTMENT_SOURCE}>
                      Hired Equipment Program fuel adjustment
                    </ReferenceLink>
                  </dt>
                  <CostEvidenceGate state={evidence}>
                    {({ fuel }) => (
                      <>
                        <dd className="tabular-nums">
                          +${fuel.onRoadPerHour.toFixed(2)}/hour on-road · +${fuel.offRoadPerHour.toFixed(2)}/hour
                          off-road
                        </dd>
                        <dd>
                          <InfoTip label="About the Hired Equipment Program fuel adjustment">
                            Adjustment for {fuel.month}, page updated {fuel.updated}. Belongs to the transportation
                            ministry&apos;s program and changes monthly, so check the page for a later month.
                          </InfoTip>
                        </dd>
                      </>
                    )}
                  </CostEvidenceGate>
                </div>
              </dl>
            </section>

            <section className="space-y-2" aria-label="Map layers for appraisal inputs">
              <ReferenceHeading info="A mapped polygon can propose an input for review. It is a sourced suggestion, not a reviewed input: rock, soil moisture and terrain stability still need site evidence.">
                Map layers for appraisal inputs
              </ReferenceHeading>
              <SourceList sources={BC_GEOGRAPHIC_CONTEXT_SOURCES} />
            </section>

            <section className="space-y-2" aria-label="Estimating methods">
              <ReferenceHeading info="References that explain how an estimate is built. They carry no rate for this catalogue.">
                Estimating methods
              </ReferenceHeading>
              <CostEvidenceGate state={evidence}>
                {(catalogue) => (
                  <SourceList
                    sources={catalogue.sources
                      .filter((source) => source.role === 'method')
                      .map((source) => ({
                        url: source.url,
                        title: source.title,
                        detail: [source.publisher, source.use ?? source.method ?? source.scope]
                          .filter(Boolean)
                          .join('. '),
                      }))}
                  />
                )}
              </CostEvidenceGate>
            </section>
          </div>
        </RateAdoptionContext.Provider>
      </PanelDialog>
    </>
  )
}
