import { useState } from 'react'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { OptionalNumberField } from './Controls'
import { ReferenceSelect } from './CostReferenceControls'
import {
  calculateEquipmentUnitCost,
  calculateMaterialUnitCost,
  calculateTruckCycleUnitCost,
  type CostUnitRateResult,
  type EquipmentUnitCostInput,
  type MaterialUnitCostInput,
  type TruckCycleUnitCostInput,
} from './costRateTools'

function RateResult({ result, testId }: { result: CostUnitRateResult; testId: string }) {
  return (
    <div data-testid={testId} aria-live="polite" className="text-xs">
      {result.valid && result.unitCostCad !== null ? (
        <p className="font-semibold tabular-nums">
          {result.unitCostCad.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
          {result.unit}
        </p>
      ) : (
        <p className="text-[11px] leading-4 text-muted-foreground">{result.errors.join(' ')}</p>
      )}
    </div>
  )
}

/** Scratch calculations only: no project rates or engineering inputs are modified. */
export function CostRateTools() {
  const [material, setMaterial] = useState<MaterialUnitCostInput>({
    quoteUnit: null,
    priceCad: null,
    tonnesPerCompactedM3: null,
    looseM3PerCompactedM3: null,
  })
  const [truck, setTruck] = useState<TruckCycleUnitCostInput>({
    allInRateCadPerHour: null,
    cycleMinutes: null,
    compactedPayloadM3: null,
  })
  const [equipment, setEquipment] = useState<EquipmentUnitCostInput>({
    allInCrewCadPerHour: null,
    netBankM3PerHour: null,
  })
  return (
    <CollapsibleSection label="Convert quotes and calculate unit rates" contentClassName="space-y-4 px-2 pb-2">
      <InlineAlert>
        Enter the quote’s units and inclusions. These temporary comparisons do not change project rates. Borrow/material
        supply, hauling and fill placement are different costs; combine only scopes that do not overlap.
      </InlineAlert>
      <section aria-label="Material quote conversion" className="space-y-2">
        <h3 className="font-medium">Material quote → compacted volume</h3>
        <ReferenceSelect
          label="Material quote unit"
          value={material.quoteUnit ?? 'unselected'}
          options={[
            { value: 'unselected', label: 'Select the quoted unit' },
            { value: 'tonne', label: 'CAD per tonne' },
            { value: 'loose-yd3', label: 'CAD per loose cubic yard' },
          ]}
          onChange={(value) =>
            setMaterial({
              ...material,
              quoteUnit: value === 'unselected' ? null : (value as MaterialUnitCostInput['quoteUnit']),
              priceCad: null,
            })
          }
        />
        <OptionalNumberField
          label={
            material.quoteUnit === 'loose-yd3'
              ? 'Quoted price (CAD/loose yd³)'
              : material.quoteUnit === 'tonne'
                ? 'Quoted price (CAD/tonne)'
                : 'Quoted price (CAD/selected unit)'
          }
          value={material.priceCad}
          min={0}
          step={0.01}
          placeholder="Enter quote"
          onChange={(priceCad) => setMaterial({ ...material, priceCad })}
        />
        {material.quoteUnit === 'tonne' && (
          <OptionalNumberField
            label="Tonnes required per compacted m³"
            value={material.tonnesPerCompactedM3}
            min={0}
            step={0.01}
            placeholder="Measured or specified density"
            onChange={(tonnesPerCompactedM3) => setMaterial({ ...material, tonnesPerCompactedM3 })}
          />
        )}
        {material.quoteUnit === 'loose-yd3' && (
          <OptionalNumberField
            label="Loose m³ required per compacted m³"
            value={material.looseM3PerCompactedM3}
            min={0}
            step={0.01}
            placeholder="Enter conversion factor"
            onChange={(looseM3PerCompactedM3) => setMaterial({ ...material, looseM3PerCompactedM3 })}
          />
        )}
        <p className="text-[11px] leading-4 text-muted-foreground">
          {material.quoteUnit === 'loose-yd3'
            ? 'Rate = quote ÷ 0.764554857984 m³/yd³ × loose-to-compacted factor. The factor is project-specific.'
            : 'Rate = CAD/tonne × tonnes per compacted m³. Use the required compacted mass, not loose bulk density.'}{' '}
          Confirm moisture, loading, delivery, processing and tax inclusions with the supplier. Compaction is a separate
          operation unless included in the quote.
        </p>
        <RateResult result={calculateMaterialUnitCost(material)} testId="road-material-unit-rate" />
      </section>
      <section aria-label="Truck cycle unit rate" className="space-y-2 border-t pt-3">
        <h3 className="font-medium">Truck cycle → hauling rate</h3>
        <OptionalNumberField
          label="All-in truck rate (CAD/hour)"
          value={truck.allInRateCadPerHour}
          min={0}
          step={0.01}
          placeholder="Enter quoted rate"
          onChange={(allInRateCadPerHour) => setTruck({ ...truck, allInRateCadPerHour })}
        />
        <OptionalNumberField
          label="Complete truck cycle (minutes)"
          value={truck.cycleMinutes}
          min={0}
          step={0.1}
          placeholder="Load + travel + unload + return + queue"
          onChange={(cycleMinutes) => setTruck({ ...truck, cycleMinutes })}
        />
        <OptionalNumberField
          label="Delivered payload (compacted m³)"
          value={truck.compactedPayloadM3}
          min={0}
          step={0.1}
          placeholder="Convert loose box volume first"
          onChange={(compactedPayloadM3) => setTruck({ ...truck, compactedPayloadM3 })}
        />
        <p className="text-[11px] leading-4 text-muted-foreground">
          Rate = truck CAD/hour × total cycle minutes ÷ 60 ÷ compacted payload. Include loading time, loaded travel,
          unloading, empty return and queues once. Respect weight and volume limits. The hourly rate should state
          operator and fuel inclusions. Loader equipment, material supply and placement remain separate unless already
          included.
        </p>
        <p className="text-[11px] leading-4 text-muted-foreground">
          This is a complete-cycle cost for the entered route. Engineering’s distance rates use CAD/(m³·km), with
          loading entered separately; this CAD/m³ result cannot be pasted directly into a distance-rate field.
        </p>
        <RateResult result={calculateTruckCycleUnitCost(truck)} testId="road-truck-unit-rate" />
      </section>
      <section aria-label="Equipment production unit rate" className="space-y-2 border-t pt-3">
        <h3 className="font-medium">Equipment crew → excavation rate</h3>
        <OptionalNumberField
          label="All-in crew rate (CAD/hour)"
          value={equipment.allInCrewCadPerHour}
          min={0}
          step={0.01}
          placeholder="Equipment + included labour and fuel"
          onChange={(allInCrewCadPerHour) => setEquipment({ ...equipment, allInCrewCadPerHour })}
        />
        <OptionalNumberField
          label="Net production (bank m³/charged hour)"
          value={equipment.netBankM3PerHour}
          min={0}
          step={0.1}
          placeholder="Site-specific net production"
          onChange={(netBankM3PerHour) => setEquipment({ ...equipment, netBankM3PerHour })}
        />
        <p className="text-[11px] leading-4 text-muted-foreground">
          Rate = crew CAD/hour ÷ net bank m³ per charged hour. Use output after expected delays and efficiency losses,
          on the same hourly basis as the crew rate. Avoid adding operator or fuel costs already included in an
          all-found equipment rate.
        </p>
        <RateResult result={calculateEquipmentUnitCost(equipment)} testId="road-equipment-unit-rate" />
      </section>
    </CollapsibleSection>
  )
}
