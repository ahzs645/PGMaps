import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { downloadText } from '@/lib/download'
import { NumberField } from './Controls'
import { ReferenceLink, ReferenceSelect, referenceMoney } from './CostReferenceControls'
import {
  COAST_BENCHMARK_NOTES,
  COAST_COST_SOURCE,
  COAST_POINTS_OF_ORIGIN,
  COAST_ROAD_CATEGORIES,
  calculateCoastRoadBenchmark,
  type CoastPointOfOrigin,
  type CoastRoadCategory,
  type CoastRockHardness,
} from './bcCoastCost'

/** Deliberately independent of project settings: these are reviewed comparison inputs only. */
export function BCCoastBenchmark() {
  const [category, setCategory] = useState<CoastRoadCategory | 'unselected'>('unselected')
  const [hardness, setHardness] = useState<CoastRockHardness | 'unselected'>('unselected')
  const [origin, setOrigin] = useState<CoastPointOfOrigin | 'unselected' | 'none'>('unselected')
  const [isolationFraction, setIsolationFraction] = useState(0)
  const [isolationEligibilityConfirmed, setIsolationEligibilityConfirmed] = useState(false)
  const [tabularEligibilityConfirmed, setTabularEligibilityConfirmed] = useState(false)
  const selectedCategory = COAST_ROAD_CATEGORIES.find((row) => row.code === category)
  const input =
    category !== 'unselected' && hardness !== 'unselected'
      ? {
          category,
          hardness,
          pointOfOrigin: origin === 'unselected' || origin === 'none' ? null : origin,
          pointOfOriginReviewed: origin === 'none',
          isolationFraction,
          isolationEligibilityConfirmed,
          tabularEligibilityConfirmed,
        }
      : null
  const result = input ? calculateCoastRoadBenchmark(input) : null
  const downloadable = result?.valid === true && result.unitCostCadPerKm !== null

  const download = () => {
    if (!downloadable || !input || !result) return
    downloadText(
      JSON.stringify(
        {
          schema: 'pgmaps-bc-coast-cost-comparison-v1',
          generatedAt: new Date().toISOString(),
          inputs: { ...input, pointOfOriginSelection: origin },
          result,
          source: COAST_COST_SOURCE,
          limitations: [
            ...COAST_BENCHMARK_NOTES,
            'This comparison is independent of the project estimate and does not change project unit rates.',
          ],
        },
        null,
        2,
      ),
      'bc-coast-cost-comparison.json',
      'application/json',
    )
  }

  return (
    <section aria-label="Coast road cost comparison" className="space-y-3 rounded border p-3">
      <div className="space-y-1">
        <h3 className="font-medium">Coast road construction comparison</h3>
        <p className="text-[11px] leading-4 text-muted-foreground">
          <ReferenceLink href={COAST_COST_SOURCE.url}>CAM Table 5-1, page 5-16</ReferenceLink>
          {' · effective ' + COAST_COST_SOURCE.effectiveDate + ' · cost base ' + COAST_COST_SOURCE.costBaseYear}. CAD
          per kilometre of eligible new road, including the category’s ballast/surfacing.
        </p>
      </div>
      <ReferenceSelect
        label="Coast construction category"
        value={category}
        options={[
          { value: 'unselected', label: 'Choose field-supported category' },
          ...COAST_ROAD_CATEGORIES.map((row) => ({ value: row.code, label: row.code + ' · ' + row.label })),
        ]}
        onChange={(value) => {
          setCategory(value as CoastRoadCategory | 'unselected')
          setTabularEligibilityConfirmed(false)
        }}
      />
      {selectedCategory && <p className="text-[11px] text-muted-foreground">{selectedCategory.description}</p>}
      <ReferenceSelect
        label="Coast rock hardness"
        value={hardness}
        options={[
          { value: 'unselected', label: 'Choose field-supported hardness' },
          { value: 'soft-medium', label: 'Soft/medium · RMC 1–4' },
          { value: 'hard', label: 'Hard · RMC 5' },
        ]}
        onChange={(value) => {
          setHardness(value as CoastRockHardness | 'unselected')
          setTabularEligibilityConfirmed(false)
        }}
      />
      <p className="text-[11px] leading-4 text-muted-foreground">
        Verify the category and rock mass classification in the field. A terrain model does not identify material or
        rock hardness.
      </p>
      <ReferenceSelect
        label="Coast point-of-origin area"
        value={origin}
        options={[
          { value: 'unselected', label: 'Choose area or confirm no eligible addition' },
          { value: 'none', label: 'Reviewed · no eligible origin addition' },
          ...COAST_POINTS_OF_ORIGIN.map((row) => ({
            value: row.code,
            label:
              row.label +
              ' (' +
              row.code +
              ')' +
              (row.addOnCadPerKm ? ' · +' + referenceMoney(row.addOnCadPerKm) + '/km' : ''),
          })),
        ]}
        onChange={(value) => setOrigin(value as CoastPointOfOrigin | 'unselected' | 'none')}
      />
      {origin === 'unselected' && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Choose an area or confirm that no eligible addition applies before calculating or exporting. Natural resource
          regions do not determine these appraisal boundaries.
        </p>
      )}
      <NumberField
        label="Eligible isolated timber volume fraction (0–1)"
        value={isolationFraction}
        min={0}
        max={1}
        step={0.01}
        onChange={(value) => {
          setIsolationFraction(value)
          setIsolationEligibilityConfirmed(false)
        }}
      />
      <p className="text-[11px] leading-4 text-muted-foreground">
        Eligible isolated cutblocks’ net cruise volume ÷ total net cruise volume; this is not the isolated share of road
        length. Review the CAM connection-to-community definition, including public-ferry-served communities.
      </p>
      {isolationFraction > 0 && (
        <ToggleRow
          active={isolationEligibilityConfirmed}
          label="CAM isolation eligibility reviewed"
          tone="primary"
          onClick={() => setIsolationEligibilityConfirmed((value) => !value)}
        />
      )}
      <p className="text-[11px] leading-4 text-muted-foreground">
        Confirm new single-lane tabular-road conditions. Main access construction/upgrades, end haul, extensive imported
        fills, side slopes above 150%, repeated deep gullies, large switchbacks or rock faces above 7.50 m need
        engineering review.
      </p>
      <ToggleRow
        active={tabularEligibilityConfirmed}
        label="Coast tabular-road eligibility reviewed"
        tone="primary"
        onClick={() => setTabularEligibilityConfirmed((value) => !value)}
      />
      <div data-testid="road-coast-benchmark-result" aria-live="polite" className="space-y-2">
        {result?.valid && result.unitCostCadPerKm !== null ? (
          <>
            <p className="text-lg font-semibold tabular-nums">{referenceMoney(result.unitCostCadPerKm)} CAD/km</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-xs">
              <dt>Category allowance</dt>
              <dd className="text-right tabular-nums">{referenceMoney(result.baseCadPerKm!)}/km</dd>
              <dt>Isolation addition</dt>
              <dd className="text-right tabular-nums">{referenceMoney(result.isolationAddOnCadPerKm!)}/km</dd>
              <dt>Point-of-origin addition</dt>
              <dd className="text-right tabular-nums">{referenceMoney(result.pointOfOriginAddOnCadPerKm!)}/km</dd>
            </dl>
            <p className="text-[11px] text-muted-foreground">
              Rounded to whole CAD; the download retains the calculated amount.
            </p>
          </>
        ) : (
          <InlineAlert>
            {result
              ? result.errors.join(' ')
              : 'Select a construction category and rock hardness, then review eligibility to calculate a comparison.'}
          </InlineAlert>
        )}
      </div>
      <InlineAlert tone="warning">
        This bundled appraisal comparison is separate from the covered estimate. Bridges, culverts and extra
        stabilizing-material haul beyond 3.2 km need separate costs. Exclude bridge deck/span lengths when applying the
        rate to road length. Do not add this allowance to itemized construction costs.
      </InlineAlert>
      <CollapsibleSection label="Coast source scope and limits" contentClassName="space-y-2 pt-2">
        {COAST_BENCHMARK_NOTES.map((note) => (
          <p key={note} className="text-[11px] leading-4 text-muted-foreground">
            {note}
          </p>
        ))}
      </CollapsibleSection>
      <Button type="button" variant="outline" size="sm" onClick={download} disabled={!downloadable}>
        Download Coast comparison JSON
      </Button>
    </section>
  )
}
