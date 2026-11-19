import { useMemo, useState } from 'react'
import { BookOpenText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
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
  PendingSources,
  RegionLocalEvidence,
  WorkedEstimates,
  useCostEvidence,
  type CostEvidenceState,
} from './CostEvidenceViews'
import { NO_EVIDENCE_FILTER, PROJECT_RECORDS, type EvidenceFilter } from './costEvidence/costEvidence'
import { withUserRecords } from './costEvidence/loadCostEvidence'
import { BC_PACK, packFor, placeLabel, subdivisionName } from './costPlaces/packs'
import { regionLocalId, type CostPlace } from './costPlaces/places'
import { useCostPreferences } from './costPlaces/useCostPreferences'
import { UserCostRecords } from './UserCostRecords'
import { BCInteriorBenchmark } from './BCInteriorBenchmark'
import type { SideSlopeRoad } from './MeasuredSideSlope'
import { BCCoastBenchmark } from './BCCoastBenchmark'
import { ReferenceHeading, ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import { CostRateTools } from './CostRateToolsPanel'
import { RateAdoptionContext, type RateAdoptionTarget } from './RateAdoption'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'

type ReferenceTab = 'appraisal' | 'rates' | 'evidence' | 'mine' | 'sources'
const TABS = [
  { value: 'appraisal', label: 'Region' },
  { value: 'rates', label: 'Unit rates' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'mine', label: 'My records' },
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

/** The catalogue with the person's own records joined, in the same loading states. */
function useEvidenceWithOwnRecords(state: CostEvidenceState): CostEvidenceState {
  const [preferences] = useCostPreferences()
  return useMemo(
    () =>
      state.status === 'ready' ? { ...state, catalogue: withUserRecords(state.catalogue, preferences.library) } : state,
    [state, preferences.library],
  )
}

/**
 * Source evidence and independent benchmarks, in their own dialog beside the rate preset, read for
 * the project's cost location: its pack's regions, local evidence and reference tools (the BC
 * appraisal comparisons), and every record ordered nearest first. Opening and browsing write
 * nothing. The writes are `adoption.onAdopt` (the confirmed form under a record, or applying a saved
 * build-up) and `adoption.onBuildUps`; without `adoption` nothing offers them. The person's own
 * records and preferences are theirs, in this browser. Every tab stays mounted, so typed inputs
 * survive a switch.
 */
export function BCCostReferences({
  portalContainer,
  adoption,
  road,
  place,
  culvertReview,
}: {
  portalContainer?: HTMLElement | null
  adoption?: RateAdoptionTarget
  /** The road the estimate is for; the Interior comparison offers its measured side slope. */
  road?: SideSlopeRoad
  /** The project's cost location. Absent: BC, the pack the catalogue grew from, with no region chosen. */
  place?: CostPlace
  /** Opens the culvert evidence and adoption form; opening it never changes a project rate. */
  culvertReview?: { sequence: number; targetKey?: string; recordId?: string }
}) {
  const projectPack = packFor(place)
  // A project placed outside every pack reads the evidence by place but has no region guidance.
  const pack = place ? projectPack : BC_PACK
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ReferenceTab>('appraisal')
  // The project's region until the reader picks one, so a location set while this is mounted is followed.
  const [chosenRegion, setRegionId] = useState<string | null>(null)
  const regionId =
    chosenRegion ??
    (place?.region && pack?.regionScheme?.regions.some((r) => r.id === place.region) ? place.region : 'unselected')
  const regionMethod =
    BC_COST_REGIONS.find((item) => `bc-nr:${item.id}` === regionId)?.method === 'coast' ? 'coast' : 'interior'
  const [chosenMethod, setMethod] = useState<{ region: string; method: 'interior' | 'coast' } | null>(null)
  // A method the reader picked holds for its region; another region starts from its own method.
  const method = chosenMethod?.region === regionId ? chosenMethod.method : regionMethod
  const [evidenceView, setEvidenceView] = useState<'records' | 'estimates'>('records')
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>(NO_EVIDENCE_FILTER)
  const [seenCulvertReview, setSeenCulvertReview] = useState<number>()
  const [focusRecordId, setFocusRecordId] = useState<string>()
  const [preferredTargetKey, setPreferredTargetKey] = useState<string>()
  if (culvertReview && culvertReview.sequence !== seenCulvertReview) {
    setSeenCulvertReview(culvertReview.sequence)
    setOpen(true)
    setTab('evidence')
    setEvidenceView('records')
    setEvidenceFilter({ ...NO_EVIDENCE_FILTER, query: 'culvert' })
    setFocusRecordId(culvertReview.recordId)
    setPreferredTargetKey(culvertReview.targetKey)
  }
  const [preferences] = useCostPreferences()
  const evidence = useEvidenceWithOwnRecords(useCostEvidence(open))
  const packRegion = pack?.regionScheme?.regions.find((item) => item.id === regionId)
  // The BC appraisal tools read the BC region record (road groups, method).
  const region = pack?.tools?.includes('bc-appraisal')
    ? BC_COST_REGIONS.find((item) => item.id === regionLocalId(regionId))
    : undefined
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
        Cost references
      </Button>
      <PanelDialog
        open={open}
        onOpenChange={setOpen}
        title={pack ? `Cost references · ${pack.name}` : `Cost references · ${placeLabel(place)}`}
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
        <RateAdoptionContext.Provider
          value={
            adoption
              ? { ...adoption, preferredTargetKey, openRecordId: focusRecordId, requestSequence: seenCulvertReview }
              : null
          }
        >
          <div
            role="tabpanel"
            id="road-bc-cost-panel-appraisal"
            aria-labelledby="road-bc-cost-tab-appraisal"
            hidden={tab !== 'appraisal'}
            className="space-y-4 text-xs"
          >
            {!pack?.regionScheme ? (
              <div data-testid="road-cost-no-pack">
                <InlineAlert tone="info" title={`No cost pack for ${place ? placeLabel(place) : 'this place'} yet`}>
                  Records from {place?.subdivision ? subdivisionName(place.subdivision) : 'this country'} are in the
                  Evidence tab, nearest first, and your own quotes go under My records. A pack adds regions, local
                  supplier lists, budget items and reference tools for one province or state.
                </InlineAlert>
              </div>
            ) : (
              <ReferenceSelect
                label={pack.regionScheme.name.charAt(0).toUpperCase() + pack.regionScheme.name.slice(1)}
                value={regionId}
                options={[
                  { value: 'unselected', label: 'Choose a region' },
                  ...pack.regionScheme.regions.map((item) => ({ value: item.id, label: item.name })),
                ]}
                onChange={(value) => setRegionId(value)}
                hint={
                  <>
                    {place?.region === regionId && regionId !== 'unselected' ? 'The project’s region. ' : ''}A region
                    sets the starting comparison method and local evidence; it does not determine an appraisal road
                    group.{' '}
                    <ReferenceLink href={pack.regionScheme.sourceUrl}>Official region and district list</ReferenceLink>
                  </>
                }
              />
            )}
            {packRegion && !region && (
              <div className="space-y-4" data-testid="road-bc-region-reference">
                <p className="text-xs text-muted-foreground">{packRegion.geography}</p>
                <CostEvidenceGate state={evidence}>
                  {(catalogue) => (
                    <RegionLocalEvidence
                      catalogue={catalogue}
                      regionId={packRegion.id}
                      onShowProjects={() => {
                        setEvidenceFilter({
                          ...NO_EVIDENCE_FILTER,
                          place: pack?.subdivision ?? 'all',
                          regionId: packRegion.id,
                          kind: PROJECT_RECORDS,
                        })
                        setEvidenceView('records')
                        setTab('evidence')
                      }}
                    />
                  )}
                </CostEvidenceGate>
              </div>
            )}
            {region && (
              <div className="space-y-4" data-testid="road-bc-region-reference">
                {/* One line of facts; the geography and what to confirm are behind the (i). */}
                <p className="flex items-center gap-1 text-xs text-foreground">
                  {region.groups.length > 0 ? (
                    <span>
                      Candidate Interior road groups{' '}
                      <span className="font-semibold tabular-nums">{region.groups.join(', ')}</span>
                    </span>
                  ) : (
                    <span>No candidate Interior road group</span>
                  )}
                  <InfoTip label="What to confirm for this region">
                    <p>{region.geography}</p>
                    {region.groups.length > 0 && (
                      <p className="mt-1.5">
                        A lookup guide only. Confirm the district, timber supply area and supply block in IAM Table 4-2.
                      </p>
                    )}
                    <p className="mt-1.5">{region.review}</p>
                  </InfoTip>
                </p>

                <section className="space-y-2" aria-label="Local material-price evidence">
                  <ReferenceHeading info="Each supplier's published prices, checked by hand on the date shown. A price keeps its own unit, date, tax, loading and delivery terms; a term the source does not state reads Not stated, and a missing price is not a zero-cost material.">
                    Local material prices
                  </ReferenceHeading>
                  <CostEvidenceGate state={evidence}>
                    {(catalogue) => (
                      <RegionLocalEvidence
                        catalogue={catalogue}
                        regionId={`bc-nr:${region.id}`}
                        onShowProjects={() => {
                          setEvidenceFilter({
                            ...NO_EVIDENCE_FILTER,
                            place: 'CA-BC',
                            regionId: `bc-nr:${region.id}`,
                            kind: PROJECT_RECORDS,
                          })
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
                    onChange={(next) => setMethod({ region: regionId, method: next })}
                  />
                  {method === 'interior' ? (
                    <BCInteriorBenchmark
                      key={regionId}
                      regionName={region.name}
                      candidateGroups={region.groups}
                      road={road}
                    />
                  ) : (
                    <BCCoastBenchmark key={regionId} regionName={region.name} road={road} />
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
                  <EvidenceBrowser
                    catalogue={catalogue}
                    filter={evidenceFilter}
                    onFilter={setEvidenceFilter}
                    projectPlace={place}
                    preferredKinds={preferences.preferredKinds}
                    focusRecordId={focusRecordId}
                    focusSequence={seenCulvertReview}
                  />
                ) : (
                  <WorkedEstimates catalogue={catalogue} />
                )
              }
            </CostEvidenceGate>
          </div>

          <div
            role="tabpanel"
            id="road-bc-cost-panel-mine"
            aria-labelledby="road-bc-cost-tab-mine"
            hidden={tab !== 'mine'}
            className="text-xs"
          >
            {open && (
              <CostEvidenceGate state={evidence}>
                {(catalogue) => <UserCostRecords projectPlace={place} sources={catalogue.sources} />}
              </CostEvidenceGate>
            )}
          </div>

          <div
            role="tabpanel"
            id="road-bc-cost-panel-sources"
            aria-labelledby="road-bc-cost-tab-sources"
            hidden={tab !== 'sources'}
            className="space-y-4 text-xs"
          >
            <p className="text-2xs text-muted-foreground">Catalogue reviewed {BC_COST_REVIEWED_DATE}.</p>
            <CostEvidenceGate state={evidence}>
              {(catalogue) => <PendingSources catalogue={catalogue} />}
            </CostEvidenceGate>
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
