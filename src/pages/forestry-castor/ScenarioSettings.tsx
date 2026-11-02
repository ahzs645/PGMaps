import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToggleRow } from '@/components/ui/toggle-row'
import { CASTOR_LIMITS, validateCastorProject } from '@/features/forestry-castor/validation'
import type { CastorConfig, CastorConstraint, CastorProject } from '@/features/forestry-castor/types'
import { JsonEditor, number, Section } from './common'

export function ScenarioSettings({
  project,
  config,
  onProjectChange,
  onConfigChange,
}: {
  project: CastorProject
  config: CastorConfig
  onProjectChange: (project: CastorProject) => void
  onConfigChange: (config: CastorConfig) => void
}) {
  const patch = (value: Partial<CastorConfig>) => onConfigChange({ ...config, ...value })
  const applyTable = (key: keyof CastorProject, value: unknown) => {
    if (!Array.isArray(value)) throw new Error('This table must be a JSON array.')
    const candidate = { ...project, [key]: value }
    const validation = validateCastorProject(candidate, config)
    if (validation.errors.length) {
      throw new Error(validation.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    }
    onProjectChange(candidate)
  }
  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <Section
          title="Planning horizon"
          description="A flow target is a total for its period. Reports also show the corresponding annual rate."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Scenario name" className="sm:col-span-2">
              <input
                value={config.scenario}
                onChange={(event) => patch({ scenario: event.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </FormField>
            <NumberField
              label="Starting year"
              value={config.startYear}
              min={0}
              max={9999}
              step={1}
              onValueChange={(startYear) => patch({ startYear })}
            />
            <NumberField
              label="Periods"
              value={config.periods}
              min={1}
              max={CASTOR_LIMITS.periods}
              step={1}
              onValueChange={(periods) => patch({ periods })}
            />
            <NumberField
              label="Years per period"
              value={config.stepYears}
              min={1}
              max={100}
              step={1}
              onValueChange={(stepYears) => patch({ stepYears })}
            />
            <NumberField
              label="Target multiplier"
              value={config.targetMultiplier}
              min={0}
              max={100}
              step={0.1}
              onValueChange={(targetMultiplier) => patch({ targetMultiplier })}
            />
            <SelectField
              label="Harvest selection"
              value={config.mode}
              onChange={(event) => patch({ mode: event.target.value as CastorConfig['mode'] })}
            >
              <option value="queue">Queue from period targets</option>
              <option value="schedule">Apply a supplied schedule</option>
            </SelectField>
            <SelectField
              label="Harvest unit"
              value={config.harvestUnit}
              onChange={(event) => patch({ harvestUnit: event.target.value as CastorConfig['harvestUnit'] })}
            >
              <option value="pixel">Pixels within the block queue</option>
              <option value="block">Whole candidate blocks</option>
            </SelectField>
          </div>
        </Section>
        <Section
          title="Harvest flows"
          description="Set live or salvage volume targets by compartment. A compartment is an independent reporting and harvest area."
        >
          <FlowBuilder project={project} config={config} onChange={onProjectChange} />
          <div className="mt-4">
            <JsonEditor
              label="Harvest flow table"
              value={project.harvestFlows}
              onApply={(value) => applyTable('harvestFlows', value)}
              description="Each row specifies an id, compartment, 1-based period, targetM3 and type (live or salvage). Optional structured conditions select a partition; overlapping selections still harvest each pixel only once."
            />
          </div>
        </Section>
        <Section
          title="Growth and retention"
          description="Growth comes from your yield curves; the model does not create locally calibrated curves for an imported forest."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Minimum harvest age"
              unit="years"
              value={config.minimumHarvestAge}
              min={0}
              max={1000}
              step={1}
              onValueChange={(minimumHarvestAge) => patch({ minimumHarvestAge })}
            />
            <NumberField
              label="Retain initial growing stock"
              unit="%"
              value={config.growingStockRetention * 100}
              min={0}
              max={100}
              step={1}
              onValueChange={(value) => patch({ growingStockRetention: value / 100 })}
            />
            <NumberField
              label="Maximum yield age"
              unit="years"
              value={config.maxYieldAge}
              min={1}
              max={2000}
              step={1}
              onValueChange={(maxYieldAge) => patch({ maxYieldAge })}
            />
            <SelectField
              label="Growth timing"
              value={config.growthTiming}
              onChange={(event) => patch({ growthTiming: event.target.value as CastorConfig['growthTiming'] })}
            >
              <option value="upstream-midpoint">Upstream midpoint first step</option>
              <option value="period-end">Full period each step</option>
            </SelectField>
          </div>
          <ToggleRow
            className="mt-4"
            active={config.initializeFromYield}
            label="Initialize volume and height from yield curves"
            onClick={() => patch({ initializeFromYield: !config.initializeFromYield })}
          />
          <div className="mt-4">
            <JsonEditor
              label="Yield curves"
              value={project.yieldCurves}
              onApply={(value) => applyTable('yieldCurves', value)}
              description="Curves use age, merchantable volume (m³/ha), height (m) and optional ECA fraction and stand attributes. Interpolation and out-of-range behavior are described in Methods."
            />
          </div>
        </Section>
        <Section
          title="Harvest priority"
          description="Priority orders candidate blocks; constraints and the growing-stock floor still apply."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Primary priority"
              value={config.blockPriority[0]?.field ?? 'age'}
              onChange={(event) =>
                patch({
                  blockPriority: [
                    { field: event.target.value, direction: config.blockPriority[0]?.direction ?? 'desc' },
                    ...config.blockPriority.slice(1),
                  ],
                })
              }
            >
              <option value="age">Stand age</option>
              <option value="volume">Live volume</option>
              <option value="height">Stand height</option>
              <option value="salvageVolume">Salvage volume</option>
              <option value="distance">Distance from disturbance</option>
              <option value="eca">Equivalent clearcut area</option>
            </SelectField>
            <SelectField
              label="Priority order"
              value={config.blockPriority[0]?.direction ?? 'desc'}
              onChange={(event) =>
                patch({
                  blockPriority: [
                    { field: config.blockPriority[0]?.field ?? 'age', direction: event.target.value as 'asc' | 'desc' },
                    ...config.blockPriority.slice(1),
                  ],
                })
              }
            >
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </SelectField>
          </div>
          <div className="mt-4 space-y-3">
            <JsonEditor
              label="Priority sequence"
              value={config.blockPriority}
              onApply={(value) => {
                const candidate = { ...config, blockPriority: value }
                const checked = validateCastorProject(project, candidate)
                if (checked.errors.length)
                  throw new Error(checked.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
                onConfigChange(candidate as CastorConfig)
              }}
              description="Multiple field/direction entries provide tie breakers. Custom pixel attributes can be used where supported by the model validator."
            />
            <JsonEditor
              label="Zone priority"
              value={config.zonePriority ?? null}
              onApply={(value) => {
                const candidate = { ...config, zonePriority: value === null ? undefined : value }
                const checked = validateCastorProject(project, candidate)
                if (checked.errors.length)
                  throw new Error(checked.errors.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
                onConfigChange(candidate as CastorConfig)
              }}
              description={
                'Use null for no zone priority, or {"zone":"watershed","order":[{"field":"age","direction":"desc"}],"refreshPeriods":1}. Zone names must occur on the pixels.'
              }
            />
          </div>
        </Section>
      </div>
      <div className="space-y-5">
        <Section
          title="Management constraints"
          description="Keep no-harvest areas, cover thresholds and ECA limits attached to their source zones. Review achieved values before and after harvest in the report."
        >
          <ConstraintBuilder project={project} onChange={onProjectChange} />
          <div className="mt-4">
            <JsonEditor
              label="Constraint table"
              value={project.constraints}
              onApply={(value) => applyTable('constraints', value)}
              description="Structured all/any/not conditions support multiple attributes without executing SQL. Denominator conditions and startYear/stopYear are available in this table."
            />
          </div>
        </Section>
        <Section
          title="Spatial controls"
          description="Adjacency uses the supplied block-neighbour table. Distance updates need projected pixel coordinates in metres."
        >
          <ToggleRow
            active={config.adjacencyHeight !== null}
            label="Enforce green-up adjacency"
            onClick={() => patch({ adjacencyHeight: config.adjacencyHeight === null ? 3 : null })}
          />
          {config.adjacencyHeight !== null && (
            <NumberField
              className="mt-4"
              label="Neighbour green-up height"
              unit="m"
              value={config.adjacencyHeight}
              min={0}
              max={100}
              step={0.5}
              onValueChange={(adjacencyHeight) => patch({ adjacencyHeight })}
            />
          )}
          <ToggleRow
            className="mt-3"
            active={config.updateDistance}
            label="Update proximity to new harvest"
            onClick={() => patch({ updateDistance: !config.updateDistance })}
          />
          <div className="mt-4">
            <JsonEditor
              label="Block adjacency"
              value={project.adjacency}
              onApply={(value) => applyTable('adjacency', value)}
              description="Each pair names neighbouring block IDs. A missing neighbour table is not evidence that blocks are separated."
            />
          </div>
        </Section>
        <Section
          title="Partial cuts and schedules"
          description="Partial treatments retain a specified share of volume. Explicit schedules select known pixels or blocks in a period."
        >
          <div className="space-y-3">
            <JsonEditor
              label="Partial-cut treatments"
              value={project.treatments ?? []}
              onApply={(value) => applyTable('treatments', value)}
              description="Each treatment needs id and a structured condition. Fraction treatments use removeFraction (0–1); curve-transition treatments use resetAge and nextCurveId. Optional nextManagedCurveId and nextTreatmentId control subsequent growth. Pixels reference treatmentId."
            />
            <JsonEditor
              label="Harvest schedule"
              value={project.schedule ?? []}
              onApply={(value) => applyTable('schedule', value)}
              description="Select the supplied-schedule mode to use these period, pixelIds/blockIds, type and removeFraction entries. Conflicts with constraints remain visible in the run diagnostics."
            />
          </div>
        </Section>
        <Section
          title="Yield uncertainty"
          description="Sensitivity of the selected harvest to supplied yield variation. This does not recreate the upstream gamma calibration without its calibration observations."
        >
          <ToggleRow
            active={config.uncertainty.enabled}
            label="Run yield sensitivity replicates"
            onClick={() => patch({ uncertainty: { ...config.uncertainty, enabled: !config.uncertainty.enabled } })}
          />
          {config.uncertainty.enabled && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Replicates"
                value={config.uncertainty.replicates}
                min={1}
                max={CASTOR_LIMITS.uncertaintyReplicates}
                step={1}
                onValueChange={(replicates) => patch({ uncertainty: { ...config.uncertainty, replicates } })}
              />
              <NumberField
                label="Yield coefficient of variation"
                unit="%"
                value={config.uncertainty.coefficientOfVariation * 100}
                min={0}
                max={300}
                step={1}
                onValueChange={(value) =>
                  patch({ uncertainty: { ...config.uncertainty, coefficientOfVariation: value / 100 } })
                }
              />
              <NumberField
                label="Random seed"
                value={config.uncertainty.seed}
                min={1}
                max={2147483647}
                step={1}
                onValueChange={(seed) => patch({ uncertainty: { ...config.uncertainty, seed } })}
              />
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function FlowBuilder({
  project,
  config,
  onChange,
}: {
  project: CastorProject
  config: CastorConfig
  onChange: (project: CastorProject) => void
}) {
  const compartments = Array.from(new Set(project.pixels.map((pixel) => pixel.compartment))).sort()
  const [compartment, setCompartment] = useState('*')
  const [type, setType] = useState<'live' | 'salvage'>('live')
  const [target, setTarget] = useState(10000)
  const chosen = compartment === '*' ? compartments : [compartment]
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {number(project.harvestFlows.length)} flow rows · {number(compartments.length)} compartments
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Target compartment"
          value={compartment}
          onChange={(event) => setCompartment(event.target.value)}
        >
          <option value="*">Each compartment</option>
          {compartments.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Harvest type"
          value={type}
          onChange={(event) => setType(event.target.value as 'live' | 'salvage')}
        >
          <option value="live">Live timber</option>
          <option value="salvage">Salvage timber</option>
        </SelectField>
        <NumberField
          label="Target per compartment per period"
          unit="m³"
          value={target}
          min={0}
          step={100}
          onValueChange={setTarget}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const untouched = project.harvestFlows.filter(
            (flow) => !chosen.includes(flow.compartment) || flow.type !== type,
          )
          const rows = chosen.flatMap((value) =>
            Array.from({ length: config.periods }, (_, index) => ({
              id: `${value}-${type}-${index + 1}`,
              compartment: value,
              period: index + 1,
              targetM3: target,
              type,
            })),
          )
          onChange({ ...project, harvestFlows: [...untouched, ...rows] })
        }}
      >
        Apply targets to all {config.periods} periods
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        Replaces targets for the selected compartment and harvest type. Other flows stay in the scenario.
      </p>
    </div>
  )
}

function ConstraintBuilder({
  project,
  onChange,
}: {
  project: CastorProject
  onChange: (project: CastorProject) => void
}) {
  const zones = Array.from(new Set(project.pixels.flatMap((pixel) => Object.keys(pixel.zones)))).sort()
  const [zone, setZone] = useState(zones[0] ?? '')
  const effectiveZone = zones.includes(zone) ? zone : (zones[0] ?? '')
  const zoneIds = Array.from(new Set(project.pixels.map((pixel) => pixel.zones[effectiveZone]).filter(Boolean))).sort()
  const [zoneId, setZoneId] = useState(zoneIds[0] ?? '')
  const effectiveZoneId = zoneIds.includes(zoneId) ? zoneId : (zoneIds[0] ?? '')
  const [type, setType] = useState<CastorConstraint['type']>('ge')
  const [variable, setVariable] = useState('age')
  const [threshold, setThreshold] = useState(80)
  const [percentage, setPercentage] = useState(20)
  return (
    <div className="space-y-3">
      {project.constraints.length > 0 && (
        <ul className="divide-y rounded-md border px-3">
          {project.constraints.map((constraint) => (
            <li key={constraint.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <div className="min-w-0">
                <strong className="break-words">{constraint.id}</strong>
                <p className="text-muted-foreground">
                  {constraint.zone} / {constraint.zoneId} ·{' '}
                  {constraint.type === 'nh'
                    ? 'No harvest'
                    : constraint.variable === 'eca'
                      ? `Zone ECA ≤ ${constraint.threshold}%`
                      : `${constraint.variable} ${constraint.type === 'ge' ? '≥' : '≤'} ${constraint.threshold} · ${constraint.percentage}%`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove constraint ${constraint.id}`}
                onClick={() =>
                  onChange({ ...project, constraints: project.constraints.filter((item) => item.id !== constraint.id) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {zones.length === 0 ? (
        <InlineAlert>
          No zone columns were supplied. Add zones to the pixels before defining zonal constraints.
        </InlineAlert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Constraint zone"
              value={effectiveZone}
              onChange={(event) => setZone(event.target.value)}
            >
              {zones.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
            <SelectField label="Zone ID" value={effectiveZoneId} onChange={(event) => setZoneId(event.target.value)}>
              {zoneIds.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Constraint type"
              value={type}
              onChange={(event) =>
                setType(
                  variable === 'eca' && event.target.value === 'ge'
                    ? 'le'
                    : (event.target.value as CastorConstraint['type']),
                )
              }
            >
              <option value="ge" disabled={variable === 'eca'}>
                At least this share above threshold
              </option>
              <option value="le">
                {variable === 'eca' ? 'Maximum zone ECA' : 'At most this share below threshold'}
              </option>
              <option value="nh">No harvest in the zone</option>
            </SelectField>
            {type !== 'nh' && (
              <>
                <SelectField
                  label="Forest attribute"
                  value={variable}
                  onChange={(event) => {
                    setVariable(event.target.value)
                    if (event.target.value === 'eca') {
                      setType('le')
                      setThreshold(30)
                    }
                    if (event.target.value === 'distance') setType('ge')
                  }}
                >
                  <option value="age">Age (years)</option>
                  <option value="height">Height (m)</option>
                  <option value="volume">Live volume (m³/ha)</option>
                  <option value="eca">Zone equivalent clearcut area</option>
                  <option value="distance">Distance (m)</option>
                </SelectField>
                <NumberField
                  label={variable === 'eca' ? 'Maximum zone ECA' : 'Threshold'}
                  unit={variable === 'eca' ? '%' : undefined}
                  value={threshold}
                  min={0}
                  max={variable === 'eca' ? 100 : undefined}
                  step={1}
                  onValueChange={setThreshold}
                />
                {variable !== 'eca' && (
                  <NumberField
                    label="Target share"
                    unit="%"
                    value={percentage}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={setPercentage}
                  />
                )}
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const baseId = `${effectiveZone}-${effectiveZoneId}-${type === 'nh' ? 'no-harvest' : variable}`
              let id = baseId
              for (let suffix = 2; project.constraints.some((item) => item.id === id); suffix += 1)
                id = `${baseId}-${suffix}`
              const constraint: CastorConstraint = {
                id,
                zone: effectiveZone,
                zoneId: effectiveZoneId,
                type,
                ...(type === 'nh' ? {} : { variable, threshold, percentage: variable === 'eca' ? 100 : percentage }),
              }
              onChange({ ...project, constraints: [...project.constraints, constraint] })
            }}
          >
            <Plus className="size-4" /> Add constraint
          </Button>
        </>
      )}
    </div>
  )
}
