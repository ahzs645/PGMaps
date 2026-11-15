import { useContext, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { OptionalNumberField } from './Controls'
import { ReferenceHeading, ReferenceSelect } from './CostReferenceControls'
import {
  calculateEquipmentUnitCost,
  calculateMaterialUnitCost,
  type CostUnitRateResult,
  type EquipmentUnitCostInput,
  type MaterialUnitCostInput,
  type TruckCycleUnitCostInput,
} from './costRateTools'
import {
  BUILD_UP_KINDS,
  buildUpSnapshot,
  calculateBuildUp,
  truckCycleMinutes,
  withBuildUp,
  withoutBuildUp,
  type BuildUpKind,
  type RateBuildUp,
  type TruckCycleParts,
} from './costEvidence/rateBuildUps'
import { createBuildUpAdoption } from './costEvidence/rateAdoption'
import { RateAdoptionContext, TargetSelect, rateValueText, today } from './RateAdoption'
import { roadFieldClass } from './Controls'

/** A calculator's last row: how the rate is worked out, then the rate, or what it still needs behind an (i). */
function RateResult({ result, testId, formula }: { result: CostUnitRateResult; testId: string; formula: ReactNode }) {
  const cost = result.valid ? result.unitCostCad : null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2">
      <p className="font-mono text-2xs leading-4 text-muted-foreground">{formula}</p>
      <div className="flex items-center gap-1">
        <div data-testid={testId} aria-live="polite" className="text-xs">
          {cost !== null ? (
            <p className="text-sm font-semibold tabular-nums">
              {cost.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {result.unit}
            </p>
          ) : (
            <p className="text-muted-foreground">Not calculated</p>
          )}
        </div>
        {cost === null && (
          <InfoTip label="What this rate still needs">
            <ul className="list-disc space-y-0.5 pl-4">
              {result.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </InfoTip>
        )}
      </div>
    </div>
  )
}

const EMPTY_PARTS: TruckCycleParts = {
  loadMinutes: null,
  haulKm: null,
  loadedKmh: null,
  unloadMinutes: null,
  emptyKmh: null,
  queueMinutes: null,
}

/** Saves the calculator's inputs as a named build-up in the project. Only shown where the project can be edited. */
function SaveBuildUp({
  kind,
  input,
}: {
  kind: BuildUpKind
  input: Omit<RateBuildUp, 'id' | 'name' | 'kind' | 'savedOn'>
}) {
  const target = useContext(RateAdoptionContext)
  const [name, setName] = useState('')
  const [quote, setQuote] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  if (!target?.onBuildUps) return null
  const valid = calculateBuildUp({ kind, ...input }).result.valid
  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-2" data-testid={`road-build-up-save-${kind}`}>
      <label className="flex min-w-0 flex-1 basis-32 flex-col gap-0.5 text-2xs text-muted-foreground">
        Save as
        <input
          className={roadFieldClass}
          aria-label={`${BUILD_UP_KINDS[kind].label} build-up name`}
          value={name}
          maxLength={120}
          placeholder="Pit run, 12 km haul"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="flex min-w-0 flex-1 basis-32 flex-col gap-0.5 text-2xs text-muted-foreground">
        Inputs from
        <input
          className={roadFieldClass}
          aria-label={`${BUILD_UP_KINDS[kind].label} build-up source`}
          value={quote}
          maxLength={300}
          placeholder="Quote, rate card, time study"
          onChange={(event) => setQuote(event.target.value)}
        />
      </label>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={!valid || !name.trim()}
        data-testid={`road-build-up-save-${kind}-button`}
        onClick={() => {
          const buildUp: RateBuildUp = {
            id: `bu-${Date.now().toString(36)}`,
            name: name.trim(),
            kind,
            ...input,
            ...(quote.trim() ? { quote: quote.trim() } : {}),
            savedOn: today(),
          }
          target.onBuildUps!(withBuildUp(target.project.rateBuildUps, buildUp), `Saved build-up ${buildUp.name}`)
          setSaved(`Saved ${buildUp.name}.`)
          setName('')
          setQuote('')
        }}
      >
        Save calculation
      </Button>
      {saved && <span className="text-2xs text-success">{saved}</span>}
    </div>
  )
}

/** The project's saved build-ups: each formula, its result, and the rate it can set. */
function SavedBuildUps() {
  const target = useContext(RateAdoptionContext)
  const [applyTo, setApplyTo] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const buildUps = target?.project.rateBuildUps ?? []
  if (!target?.onBuildUps || !buildUps.length) return null
  return (
    <section aria-label="Saved build-ups" className="space-y-1.5" data-testid="road-build-ups">
      <ReferenceHeading info="Kept in the project file. Applying one sets the rate and keeps the formula beside it; editing a build-up later flags the rate rather than moving it.">
        Saved build-ups
      </ReferenceHeading>
      <ul className={cn(insetBox({ padding: 'none' }), 'divide-y')}>
        {buildUps.map((buildUp) => {
          const snapshot = buildUpSnapshot(buildUp)
          const { formula } = calculateBuildUp(buildUp)
          const compatible = target.targets.filter((t) => t.basis === BUILD_UP_KINDS[buildUp.kind].basis)
          const key = applyTo[buildUp.id] ?? ''
          const chosen = compatible.find((t) => t.key === key)
          return (
            <li key={buildUp.id} className="space-y-1 px-3 py-2 text-2xs" data-build-up={buildUp.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
                  {buildUp.name}{' '}
                  <span className="font-normal text-muted-foreground">· {BUILD_UP_KINDS[buildUp.kind].label}</span>
                </p>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    target.onBuildUps!(
                      withoutBuildUp(target.project.rateBuildUps, buildUp.id),
                      `Deleted build-up ${buildUp.name}`,
                    )
                  }
                >
                  Delete
                </Button>
              </div>
              <p className="font-mono text-muted-foreground">{formula}</p>
              {buildUp.quote && (
                <p className="text-muted-foreground">
                  Inputs from {buildUp.quote} · saved {buildUp.savedOn}
                </p>
              )}
              {snapshot && compatible.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <TargetSelect
                      label="Apply to"
                      targets={compatible}
                      value={key}
                      currency={target.currency}
                      onChange={(next) => setApplyTo({ ...applyTo, [buildUp.id]: next })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    disabled={!chosen}
                    data-testid="road-build-up-apply"
                    onClick={() => {
                      if (!chosen) return
                      try {
                        target.onAdopt(
                          chosen.key,
                          createBuildUpAdoption(snapshot, chosen, target.currency, today()),
                          chosen.label,
                        )
                        setMessage(
                          `${chosen.label} set to ${rateValueText(snapshot.result, chosen.unit, target.currency)} from ${buildUp.name}.`,
                        )
                      } catch (cause) {
                        setMessage(cause instanceof Error ? cause.message : String(cause))
                      }
                    }}
                  >
                    Apply
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {message && (
        <p role="status" className="text-2xs text-success" data-testid="road-build-up-message">
          {message}
        </p>
      )}
    </section>
  )
}

/**
 * The rate calculators. Their inputs are scratch until saved as a build-up, which keeps them in the
 * project; applying a saved build-up is the only way they set a rate.
 */
export function CostRateTools() {
  const [material, setMaterial] = useState<MaterialUnitCostInput>({
    quoteUnit: null,
    priceCad: null,
    tonnesPerCompactedM3: null,
    looseM3PerCompactedM3: null,
  })
  const [truck, setTruck] = useState<TruckCycleUnitCostInput & { parts?: TruckCycleParts }>({
    allInRateCadPerHour: null,
    cycleMinutes: null,
    compactedPayloadM3: null,
  })
  const cycleFromParts = truck.parts ? truckCycleMinutes(truck.parts) : null
  const setPart = (key: keyof TruckCycleParts, value: number | null) =>
    setTruck({ ...truck, parts: { ...(truck.parts ?? EMPTY_PARTS), [key]: value } })
  const [equipment, setEquipment] = useState<EquipmentUnitCostInput>({
    allInCrewCadPerHour: null,
    netBankM3PerHour: null,
  })
  return (
    <div className="space-y-4">
      <SavedBuildUps />
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Scratch until saved; a saved build-up sets a rate only when you apply it.
        <InfoTip label="About combining these rates">
          Keep each quote&apos;s units and inclusions, and combine only scopes that do not overlap: material supply,
          hauling and placement are separate costs.
        </InfoTip>
      </p>

      <section aria-label="Material quote conversion" className={cn(insetBox({ padding: 'lg' }), 'space-y-2')}>
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
        <RateResult
          result={calculateMaterialUnitCost(material)}
          testId="road-material-unit-rate"
          formula={
            material.quoteUnit === 'loose-yd3'
              ? 'Rate = quote ÷ 0.764554857984 m³/yd³ × loose-to-compacted factor'
              : 'Rate = CAD/tonne × tonnes per compacted m³'
          }
        />
        <SaveBuildUp kind="material" input={{ material }} />
      </section>

      <section aria-label="Truck cycle unit rate" className={cn(insetBox({ padding: 'lg' }), 'space-y-2')}>
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
            value={truck.parts ? cycleFromParts : truck.cycleMinutes}
            min={0}
            step={0.1}
            disabled={!!truck.parts}
            placeholder={truck.parts ? 'From the parts below' : 'Load + travel + unload + return'}
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
        <label className="flex items-center gap-1.5 text-2xs">
          <input
            type="checkbox"
            checked={!!truck.parts}
            data-testid="road-truck-cycle-parts-toggle"
            onChange={(event) => {
              const { parts: _drop, ...rest } = truck
              void _drop
              setTruck(event.target.checked ? { ...rest, parts: EMPTY_PARTS } : rest)
            }}
          />
          Build the cycle from its parts
        </label>
        {truck.parts && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="road-truck-cycle-parts">
            {(
              [
                ['loadMinutes', 'Load (min)'],
                ['haulKm', 'One-way haul (km)'],
                ['loadedKmh', 'Loaded speed (km/h)'],
                ['unloadMinutes', 'Unload (min)'],
                ['emptyKmh', 'Empty speed (km/h)'],
                ['queueMinutes', 'Queue and delays (min)'],
              ] as const
            ).map(([key, label]) => (
              <OptionalNumberField
                key={key}
                label={label}
                value={truck.parts![key]}
                min={0}
                step={0.1}
                placeholder="Enter"
                onChange={(value) => setPart(key, value)}
              />
            ))}
          </div>
        )}
        <RateResult
          result={calculateBuildUp({ kind: 'truck-cycle', truck }).result}
          testId="road-truck-unit-rate"
          formula="Rate = truck CAD/hour × cycle minutes ÷ 60 ÷ compacted payload"
        />
        <SaveBuildUp kind="truck-cycle" input={{ truck }} />
      </section>

      <section aria-label="Equipment production unit rate" className={cn(insetBox({ padding: 'lg' }), 'space-y-2')}>
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
        <RateResult
          result={calculateEquipmentUnitCost(equipment)}
          testId="road-equipment-unit-rate"
          formula="Rate = crew CAD/hour ÷ net bank m³ per charged hour"
        />
        <SaveBuildUp kind="equipment" input={{ equipment }} />
      </section>
    </div>
  )
}
