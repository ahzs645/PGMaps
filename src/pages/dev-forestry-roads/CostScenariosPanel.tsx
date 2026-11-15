import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import {
  idleDrivers,
  SCENARIO_DRIVERS,
  SCENARIO_MULTIPLIER,
  scenarioCase,
  type CostScenarioSettings,
  type ScenarioDriverId,
} from './costScenarios'
import type { EvidenceCurrency } from './costEvidence/costEvidence'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

const money = (value: number, currency: EvidenceCurrency) =>
  `${currency === 'CAD' ? '$' : `${currency} `}${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`

interface CaseFigures {
  total: number
  cut: number
  borrowWaste: number
  haul: number
  structures: number
  applied: string[]
}

const figures = (analysis: RoadAnalysis, applied: string[], settings: RoadSettings): CaseFigures => {
  const c = analysis.engineering?.costs
  return {
    total: analysis.estimatedCost,
    cut: c ? c.cut + c.stripping : analysis.cutVolumeM3 * settings.cutRate,
    borrowWaste: c ? c.borrow + c.waste : 0,
    haul: c?.haul ?? 0,
    structures: c?.structures ?? 0,
    applied,
  }
}

/**
 * Low and high cases: each driver's stated multipliers applied to a copy of the road and settings,
 * analysed in full. Nothing is applied to the project; the bounds are the estimator's own, not a
 * confidence interval. Editing a bound writes `project.costScenarios`; running writes nothing.
 */
export function CostScenariosPanel({
  analysis,
  alignment,
  settings,
  scenarios,
  currency,
  onScenarios,
  runCase,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
  scenarios: CostScenarioSettings | undefined
  currency: EvidenceCurrency
  onScenarios?: (next: CostScenarioSettings | undefined, label: string) => void
  runCase?: (alignment: Alignment, settings: RoadSettings) => RoadAnalysis
}) {
  const [result, setResult] = useState<{ of: RoadAnalysis; low: CaseFigures; high: CaseFigures } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drivers = scenarios?.drivers ?? {}
  const idle = new Set(idleDrivers(alignment, { drivers }))
  const shown = result?.of === analysis ? result : null
  const setDriver = (id: ScenarioDriverId, range: { low: number; high: number } | null) => {
    const next = { ...drivers }
    if (range) next[id] = range
    else delete next[id]
    onScenarios?.(
      Object.keys(next).length || scenarios?.note ? { ...scenarios, drivers: next } : undefined,
      `Scenario: ${SCENARIO_DRIVERS[id].label.toLowerCase()}`,
    )
  }
  const run = () => {
    if (!runCase) return
    setRunning(true)
    setError(null)
    // After the button has drawn its busy state: each case is a full analysis of the road.
    window.setTimeout(() => {
      try {
        const low = scenarioCase(settings, alignment, { drivers }, 'low')
        const high = scenarioCase(settings, alignment, { drivers }, 'high')
        setResult({
          of: analysis,
          low: figures(runCase(low.alignment, low.settings), low.applied, low.settings),
          high: figures(runCase(high.alignment, high.settings), high.applied, high.settings),
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setRunning(false)
      }
    }, 30)
  }
  const base = figures(analysis, [], settings)
  return (
    <section className="space-y-2 text-xs" aria-label="Cost scenarios" data-testid="road-cost-scenarios">
      <p className="text-2xs leading-4 text-muted-foreground">
        Each driver scales the inputs it names by your low and high multipliers, and the road is analysed again with
        them. Bounds you state, not probabilities; nothing is applied to the project.
      </p>
      <ul className="divide-y rounded-md border">
        {(Object.keys(SCENARIO_DRIVERS) as ScenarioDriverId[]).map((id) => {
          const spec = SCENARIO_DRIVERS[id]
          const range = drivers[id]
          return (
            <li key={id} className="flex flex-wrap items-end gap-2 px-3 py-1.5" data-scenario-driver={id}>
              <label className="flex min-w-0 flex-1 basis-44 items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!range}
                  disabled={!onScenarios}
                  onChange={(event) => setDriver(id, event.target.checked ? spec.suggested : null)}
                />
                <span>{spec.label}</span>
                <InfoTip label={`What ${spec.label} scales`}>{spec.scales}</InfoTip>
                {range && idle.has(id) && <span className="text-2xs text-warning">no inputs on this road</span>}
              </label>
              {range && (
                <>
                  <div className="w-24">
                    <OptionalNumberField
                      label="Low ×"
                      value={range.low}
                      min={SCENARIO_MULTIPLIER.min}
                      max={SCENARIO_MULTIPLIER.max}
                      step={0.05}
                      onChange={(low) => setDriver(id, { ...range, low: low ?? 1 })}
                    />
                  </div>
                  <div className="w-24">
                    <OptionalNumberField
                      label="High ×"
                      value={range.high}
                      min={SCENARIO_MULTIPLIER.min}
                      max={SCENARIO_MULTIPLIER.max}
                      step={0.05}
                      onChange={(high) => setDriver(id, { ...range, high: high ?? 1 })}
                    />
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <Field label="What the bounds rest on">
        <input
          className={roadFieldClass}
          aria-label="What the bounds rest on"
          defaultValue={scenarios?.note ?? ''}
          maxLength={500}
          disabled={!onScenarios}
          placeholder="Two test pits; pit-run quote valid to March"
          onBlur={(event) => {
            const note = event.target.value.trim()
            if (note === (scenarios?.note ?? '')) return
            const next = { drivers, ...(note ? { note } : {}) }
            onScenarios?.(Object.keys(drivers).length || note ? next : undefined, 'Scenario note')
          }}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!runCase || running || !Object.keys(drivers).length}
          data-testid="road-cost-scenarios-run"
          onClick={run}
        >
          {running ? 'Analysing…' : 'Run low and high'}
        </Button>
        {!Object.keys(drivers).length && (
          <span className="text-2xs text-muted-foreground">Tick a driver to set its bounds.</span>
        )}
      </div>
      {error && (
        <InlineAlert tone="error" title="A scenario did not analyse">
          {error}
        </InlineAlert>
      )}
      {shown && (
        <EngineeringTable data-testid="road-cost-scenarios-table">
          <thead>
            <tr>
              <ColumnHeader label="" className="text-left" />
              <ColumnHeader label="Low" />
              <ColumnHeader label="Base" />
              <ColumnHeader label="High" />
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Construction estimate', 'total'],
                ['Excavation and stripping', 'cut'],
                ['Borrow and waste', 'borrowWaste'],
                ['Haul', 'haul'],
                ['Structures', 'structures'],
              ] as const
            ).map(([label, key]) => (
              <tr key={key} data-scenario-row={key}>
                <td className="text-left">{label}</td>
                <td className="font-mono">{money(shown.low[key], currency)}</td>
                <td className="font-mono">{money(base[key], currency)}</td>
                <td className="font-mono">{money(shown.high[key], currency)}</td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      )}
      {shown && (
        <p className="text-2xs text-muted-foreground">
          Low: {shown.low.applied.join('; ') || 'no change'}. High: {shown.high.applied.join('; ') || 'no change'}.
        </p>
      )}
    </section>
  )
}
