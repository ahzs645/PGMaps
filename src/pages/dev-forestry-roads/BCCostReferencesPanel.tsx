import { useState } from 'react'
import { CollapsibleSection } from '@/components/ui/map-panels'
import {
  BC_COST_REGIONS,
  BC_COST_REVIEWED_DATE,
  BC_REGION_SOURCE,
  BC_SUPPORTING_COST_SOURCES,
} from './bcCostReferences'
import { BCInteriorBenchmark } from './BCInteriorBenchmark'
import { BCCoastBenchmark } from './BCCoastBenchmark'
import { ReferenceLink, ReferenceSelect } from './CostReferenceControls'
import { CostRateTools } from './CostRateToolsPanel'

/** Source evidence and independent benchmarks never write the project's unit rates. */
export function BCCostReferences() {
  const [regionId, setRegionId] = useState('unselected')
  const [method, setMethod] = useState<'interior' | 'coast'>('interior')
  const region = BC_COST_REGIONS.find((item) => item.id === regionId)
  return (
    <CollapsibleSection
      label="BC regional cost references"
      summary="8 regions · source dates and comparisons"
      toggleProps={{ 'data-testid': 'road-bc-cost-toggle' }}
      className="rounded border"
      contentClassName="space-y-3 px-3 pb-3"
    >
      <p className="text-[11px] leading-4 text-muted-foreground">
        References reviewed {BC_COST_REVIEWED_DATE}. Appraisal allowances, supplier material lists and equipment rates
        have different scopes. Keep their units and inclusions when building an estimate.
      </p>
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
      />
      {region && (
        <div className="space-y-3" data-testid="road-bc-region-reference">
          <div className="space-y-1 text-[11px] leading-4 text-muted-foreground">
            <p>{region.geography}</p>
            <p>{region.review}</p>
            {region.groups.length > 0 && (
              <p>
                Candidate Interior road groups: {region.groups.join(', ')}. These are a lookup guide; confirm the
                district, timber supply area and supply block in IAM Table 4-2.
              </p>
            )}
            <ReferenceLink href={BC_REGION_SOURCE}>Official region and district list</ReferenceLink>
          </div>
          <div className="space-y-2">
            <h3 className="font-medium">Local material-price evidence</h3>
            {region.suppliers.length ? (
              region.suppliers.map((supplier) => (
                <div key={supplier.url} className="space-y-1 rounded border p-2 text-[11px] leading-4">
                  <p>
                    <ReferenceLink href={supplier.url}>{supplier.supplier}</ReferenceLink> · {supplier.location}
                  </p>
                  <p className="font-medium">{supplier.price}</p>
                  <p className="text-muted-foreground">
                    {supplier.effectiveDate ? 'Effective ' + supplier.effectiveDate : 'No effective date published'}
                    {' · checked ' + BC_COST_REVIEWED_DATE}
                  </p>
                  <p className="text-muted-foreground">{supplier.limits}</p>
                </div>
              ))
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No applicable public numeric list has been verified here. Use a dated local quote; a missing price is
                not a zero-cost material or a reason to copy another region’s rate.
              </p>
            )}
          </div>
          <ReferenceSelect
            label="Appraisal comparison method"
            value={method}
            options={[
              { value: 'interior', label: 'Interior · subgrade only' },
              { value: 'coast', label: 'Coast · bundled road construction' },
            ]}
            onChange={(value) => setMethod(value as 'interior' | 'coast')}
          />
          <p className="text-[11px] leading-4 text-muted-foreground">
            Both 2026 manuals use a 2024 cost base. These are separate CAD/km comparisons, with no automatic regional
            multiplier or escalation. They are not added to the covered estimate. Inputs are temporary; download a
            comparison record to keep its assumptions and source.
          </p>
          {method === 'interior' ? (
            <BCInteriorBenchmark key={regionId} regionName={region.name} />
          ) : (
            <BCCoastBenchmark key={regionId} />
          )}
        </div>
      )}
      <CostRateTools />
      <CollapsibleSection label="Equipment, fuel and engineering sources" contentClassName="space-y-2 px-2 pb-2">
        {BC_SUPPORTING_COST_SOURCES.map((source) => (
          <p key={source.url} className="text-[11px] leading-4 text-muted-foreground">
            <ReferenceLink href={source.url}>{source.title}</ReferenceLink>
            {' — ' + source.detail}
          </p>
        ))}
      </CollapsibleSection>
    </CollapsibleSection>
  )
}
