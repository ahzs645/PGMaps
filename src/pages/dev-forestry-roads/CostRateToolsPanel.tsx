import { useState, type ReactNode } from 'react'
import { InlineAlert } from '@/components/ui/map-panels'
import { OptionalNumberField } from './Controls'
import { ReferenceHeading, ReferenceSelect } from './CostReferenceControls'
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
        <p className="text-2xs leading-4 text-muted-foreground">{result.errors.join(' ')}</p>
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
    <div className="space-y-4">
      <InlineAlert>
        Scratch calculations only; they never change project rates. Keep each quote's units and inclusions, and combine
        only scopes that do not overlap: material supply, hauling and placement are separate costs.
      </InlineAlert>

      <section aria-label="Material quote conversion" className="space-y-2">
        <ReferenceHeading info="Confirm moisture, loading, delivery, processing and tax inclusions with the supplier. Compaction is a separate operation unless the quote includes it.">
          Material quote → compacted volume
        </ReferenceHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
          {material.quoteUnit === 'loose-yd3' ? (
            <OptionalNumberField
              label="Loose m³ required per compacted m³"
              value={material.looseM3PerCompactedM3}
              min={0}
              step={0.01}
              placeholder="Enter conversion factor"
              hint="Project-specific."
              onChange={(looseM3PerCompactedM3) => setMaterial({ ...material, looseM3PerCompactedM3 })}
            />
          ) : (
            <OptionalNumberField
              label="Tonnes required per compacted m³"
              value={material.tonnesPerCompactedM3}
              min={0}
              step={0.01}
              placeholder="Measured or specified density"
              hint="Use the required compacted mass, not loose bulk density."
              disabled={material.quoteUnit !== 'tonne'}
              onChange={(tonnesPerCompactedM3) => setMaterial({ ...material, tonnesPerCompactedM3 })}
            />
          )}
        </div>
        <Formula>
          {material.quoteUnit === 'loose-yd3'
            ? 'Rate = quote ÷ 0.764554857984 m³/yd³ × loose-to-compacted factor'
            : 'Rate = CAD/tonne × tonnes per compacted m³'}
        </Formula>
        <RateResult result={calculateMaterialUnitCost(material)} testId="road-material-unit-rate" />
      </section>

      <section aria-label="Truck cycle unit rate" className="space-y-2 border-t pt-4">
        <ReferenceHeading
          info={
            <>
              Include loading, loaded travel, unloading, empty return and queues once, and respect weight and volume
              limits. The hourly rate should state its operator and fuel inclusions; loader, material supply and
              placement stay separate unless included. This is a complete-cycle CAD/m³ for the entered route:
              Engineering's distance rates are CAD/(m³·km) with loading entered separately, so it cannot be pasted into
              a distance-rate field.
            </>
          }
        >
          Truck cycle → hauling rate
        </ReferenceHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            placeholder="Load + travel + unload + return"
            hint="Load + loaded travel + unload + empty return + queue."
            onChange={(cycleMinutes) => setTruck({ ...truck, cycleMinutes })}
          />
          <OptionalNumberField
            label="Delivered payload (compacted m³)"
            value={truck.compactedPayloadM3}
            min={0}
            step={0.1}
            placeholder="Compacted basis"
            hint="Convert the loose box volume to compacted m³ first."
            onChange={(compactedPayloadM3) => setTruck({ ...truck, compactedPayloadM3 })}
          />
        </div>
        <Formula>Rate = truck CAD/hour × cycle minutes ÷ 60 ÷ compacted payload</Formula>
        <RateResult result={calculateTruckCycleUnitCost(truck)} testId="road-truck-unit-rate" />
      </section>

      <section aria-label="Equipment production unit rate" className="space-y-2 border-t pt-4">
        <ReferenceHeading info="Use output after expected delays and efficiency losses, on the same hourly basis as the crew rate. Don't add operator or fuel costs an all-found equipment rate already includes.">
          Equipment crew → excavation rate
        </ReferenceHeading>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <OptionalNumberField
            label="All-in crew rate (CAD/hour)"
            value={equipment.allInCrewCadPerHour}
            min={0}
            step={0.01}
            placeholder="Equipment + labour + fuel"
            onChange={(allInCrewCadPerHour) => setEquipment({ ...equipment, allInCrewCadPerHour })}
          />
          <OptionalNumberField
            label="Net production (bank m³/charged hour)"
            value={equipment.netBankM3PerHour}
            min={0}
            step={0.1}
            placeholder="Site-specific"
            onChange={(netBankM3PerHour) => setEquipment({ ...equipment, netBankM3PerHour })}
          />
        </div>
        <Formula>Rate = crew CAD/hour ÷ net bank m³ per charged hour</Formula>
        <RateResult result={calculateEquipmentUnitCost(equipment)} testId="road-equipment-unit-rate" />
      </section>
    </div>
  )
}

function Formula({ children }: { children: ReactNode }) {
  return <p className="font-mono text-2xs leading-4 text-muted-foreground">{children}</p>
}
