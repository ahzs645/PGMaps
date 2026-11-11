import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { downloadText } from '@/lib/download'
import { NumberField } from './Controls'
import { ReferenceHeading, ReferenceLink, ReferenceSelect, referenceMoney } from './CostReferenceControls'
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
    <section aria-label="Coast road cost comparison" className="space-y-4">
      <p className="flex items-center gap-1 text-2xs leading-4 text-muted-foreground">
        <span>
          <ReferenceLink href={COAST_COST_SOURCE.url}>CAM Table 5-1, page 5-16</ReferenceLink>
          {' · effective ' + COAST_COST_SOURCE.effectiveDate + ' · ' + COAST_COST_SOURCE.costBaseYear + ' cost base'}
        </span>
        <InfoTip label="About the Coast construction comparison">
          CAD per kilometre of eligible new road, including the category's ballast and surfacing.
        </InfoTip>
      </p>

      <div className="space-y-2">
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
          hint="Verify the category in the field. A terrain model does not identify material."
        />
        {selectedCategory && <p className="text-2xs leading-4 text-muted-foreground">{selectedCategory.description}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            hint="Verify the rock mass classification in the field. A terrain model does not identify rock hardness."
          />
          <ReferenceSelect
            label="Coast point-of-origin area"
            value={origin}
            options={[
              { value: 'unselected', label: 'Choose area or confirm none' },
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
            hint="Choose an area, or confirm no eligible addition applies, before calculating or exporting. Natural resource regions do not determine these appraisal boundaries."
          />
        </div>
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
          hint="Eligible isolated cutblocks' net cruise volume ÷ total net cruise volume; not the isolated share of road length. Review the CAM connection-to-community definition, including public-ferry-served communities."
        />
      </div>

      <section className="space-y-2 border-t pt-4" aria-label="Coast eligibility">
        <ReferenceHeading>Eligibility</ReferenceHeading>
        <p className="text-2xs leading-4 text-muted-foreground">
          Confirm new single-lane tabular-road conditions. Main access construction/upgrades, end haul, extensive
          imported fills, side slopes above 150%, repeated deep gullies, large switchbacks or rock faces above 7.50 m
          need engineering review.
        </p>
        <ToggleRow
          active={tabularEligibilityConfirmed}
          label="Coast tabular-road eligibility reviewed"
          tone="primary"
          onClick={() => setTabularEligibilityConfirmed((value) => !value)}
        />
        {isolationFraction > 0 && (
          <ToggleRow
            active={isolationEligibilityConfirmed}
            label="CAM isolation eligibility reviewed"
            tone="primary"
            onClick={() => setIsolationEligibilityConfirmed((value) => !value)}
          />
        )}
      </section>

      <div data-testid="road-coast-benchmark-result" aria-live="polite" className="space-y-2 border-t pt-4">
        {result?.valid && result.unitCostCadPerKm !== null ? (
          <>
            <p className="text-base font-semibold tabular-nums">{referenceMoney(result.unitCostCadPerKm)} CAD/km</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Category allowance</dt>
              <dd className="text-right tabular-nums">{referenceMoney(result.baseCadPerKm!)}/km</dd>
              <dt className="text-muted-foreground">Isolation addition</dt>
              <dd className="text-right tabular-nums">{referenceMoney(result.isolationAddOnCadPerKm!)}/km</dd>
              <dt className="text-muted-foreground">Point-of-origin addition</dt>
              <dd className="text-right tabular-nums">{referenceMoney(result.pointOfOriginAddOnCadPerKm!)}/km</dd>
            </dl>
            <p className="text-2xs text-muted-foreground">
              Rounded to whole CAD; the download keeps the calculated amount.
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
        Bundled allowance: do not add it to itemized construction costs. Bridges, culverts and stabilizing-material haul
        beyond 3.2 km are costed separately; exclude bridge deck/span lengths from the road length.
      </InlineAlert>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={download} disabled={!downloadable}>
          Download Coast comparison JSON
        </Button>
        <InfoTip label="Coast source scope and limits" showLabel bubbleClassName="w-96">
          <span className="block space-y-2">
            {COAST_BENCHMARK_NOTES.map((note) => (
              <span key={note} className="block">
                {note}
              </span>
            ))}
          </span>
        </InfoTip>
      </div>
    </section>
  )
}
