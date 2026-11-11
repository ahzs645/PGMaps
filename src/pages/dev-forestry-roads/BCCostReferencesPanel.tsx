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
  BC_REGION_SOURCE,
  BC_SUPPORTING_COST_SOURCES,
} from './bcCostReferences'
import { BCInteriorBenchmark } from './BCInteriorBenchmark'
import { BCCoastBenchmark } from './BCCoastBenchmark'
import { ReferenceHeading, ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import { CostRateTools } from './CostRateToolsPanel'

type ReferenceTab = 'appraisal' | 'rates' | 'sources'
const TABS = [
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'rates', label: 'Unit rates' },
  { value: 'sources', label: 'Sources' },
] as const

/**
 * Source evidence and independent benchmarks, in their own dialog beside the rate preset. They
 * never write the project's unit rates. Every tab stays mounted, so typed inputs survive a switch.
 */
export function BCCostReferences({ portalContainer }: { portalContainer?: HTMLElement | null }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ReferenceTab>('appraisal')
  const [regionId, setRegionId] = useState('unselected')
  const [method, setMethod] = useState<'interior' | 'coast'>('interior')
  const region = BC_COST_REGIONS.find((item) => item.id === regionId)
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        data-testid="road-bc-cost-toggle"
        title="Dated BC sources, appraisal comparisons and unit-rate converters"
        onClick={() => setOpen(true)}
      >
        <BookOpenText className="size-3.5" />
        BC references
      </Button>
      <PanelDialog
        open={open}
        onOpenChange={setOpen}
        title="BC regional cost references"
        subtitle={`${BC_COST_REGIONS.length} regions · reviewed ${BC_COST_REVIEWED_DATE} · comparisons never change the estimate`}
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
                A region sets the starting comparison method and local evidence; it does not determine an appraisal road
                group. <ReferenceLink href={BC_REGION_SOURCE}>Official region and district list</ReferenceLink>
              </>
            }
          />
          {!region ? (
            <p className="text-2xs leading-4 text-muted-foreground">
              Choose a region to see its appraisal road groups, local material prices and the matching comparison.
            </p>
          ) : (
            <div className="space-y-4" data-testid="road-bc-region-reference">
              <div className="space-y-1.5 text-2xs leading-4 text-muted-foreground">
                <p>{region.geography}</p>
                {region.groups.length > 0 && (
                  <p className="flex items-center gap-1 text-foreground">
                    <span>
                      Candidate Interior road groups:{' '}
                      <span className="font-medium tabular-nums">{region.groups.join(', ')}</span>
                    </span>
                    <InfoTip label="About candidate road groups">
                      A lookup guide only. Confirm the district, timber supply area and supply block in IAM Table 4-2.
                    </InfoTip>
                  </p>
                )}
                <p>{region.review}</p>
              </div>

              <section className="space-y-2" aria-label="Local material-price evidence">
                <ReferenceHeading info="Supplier lists are checked by hand on the review date. Keep each price's unit and inclusions; a missing price is not a zero-cost material.">
                  Local material prices
                </ReferenceHeading>
                {region.suppliers.length ? (
                  <ul className="divide-y rounded-md border">
                    {region.suppliers.map((supplier) => (
                      <li key={supplier.url} className="space-y-0.5 p-2 text-2xs leading-4">
                        <div className="flex items-start gap-1">
                          <p className="min-w-0 flex-1">
                            <ReferenceLink href={supplier.url}>{supplier.supplier}</ReferenceLink>
                            <span className="text-muted-foreground"> · {supplier.location}</span>
                          </p>
                          <InfoTip label={`About ${supplier.supplier}`}>{supplier.limits}</InfoTip>
                        </div>
                        <p className="font-medium text-foreground">{supplier.price}</p>
                        <p className="text-muted-foreground">
                          {supplier.effectiveDate ? 'Effective ' + supplier.effectiveDate : 'No effective date'}
                          {' · checked ' + BC_COST_REVIEWED_DATE}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-2xs leading-4 text-muted-foreground">
                    No public numeric list verified for this region. Use a dated local quote; don't copy another
                    region's rate.
                  </p>
                )}
              </section>

              <section className="space-y-2 border-t pt-4" aria-label="Appraisal comparison">
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
          id="road-bc-cost-panel-sources"
          aria-labelledby="road-bc-cost-tab-sources"
          hidden={tab !== 'sources'}
          className="text-xs"
        >
          <ul className="divide-y">
            {[
              {
                url: BC_REGION_SOURCE,
                title: 'BC natural resource regions and districts',
                detail: 'The official region and district list the region picker follows.',
              },
              ...BC_SUPPORTING_COST_SOURCES,
            ].map((source) => (
              <li key={source.url} className="space-y-0.5 py-2.5 first:pt-0">
                <p className="font-medium">
                  <ReferenceLink href={source.url}>{source.title}</ReferenceLink>
                </p>
                <p className="text-2xs leading-4 text-muted-foreground">{source.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </PanelDialog>
    </>
  )
}
