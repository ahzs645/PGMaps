import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Field, roadFieldClass, RoadSelect } from './Controls'
import { analyzeRoad } from './engine'
import { alternativeCostLabel, alternativeCostStatus } from './alternativeCosts'
import {
  activateVerticalAlternative,
  addVerticalAlternative,
  materializeVerticalAlternatives,
  MAX_VERTICAL_ALTERNATIVES,
  removeVerticalAlternative,
  renameVerticalAlternative,
  setVerticalAlternativeCostMode,
} from './verticalAlternatives'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'
import type { CrossingCostItem } from './crossingPlanTypes'

const COLORS = ['#0d9488', '#9333ea', '#d97706', '#2563eb', '#db2777', '#65a30d']
const EMPTY_CONTEXT: ContextFeature[] = []
export function VerticalAlternativesEditor({
  alignment,
  terrain,
  settings,
  context = EMPTY_CONTEXT,
  referenceSurfaces,
  sharedCrossingCosts,
  onChange,
}: {
  alignment: Alignment
  terrain?: TerrainSource
  settings?: RoadSettings
  context?: ContextFeature[]
  referenceSurfaces?: Record<string, TerrainSource>
  sharedCrossingCosts?: CrossingCostItem[]
  onChange: (alignment: Alignment) => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const active = alignment.verticalAlternatives?.find((v) => v.id === alignment.activeVerticalAlternativeId)
  const alternatives = useMemo(
    () =>
      materializeVerticalAlternatives(alignment).map((entry) => {
        let analysis: RoadAnalysis | null = null
        let error: string | null = null
        if (terrain && settings) {
          try {
            analysis = analyzeRoad(entry.alignment, terrain, settings, context, {
              referenceSurfaces,
              sharedCrossingCosts,
            })
          } catch (e) {
            error = e instanceof Error ? e.message : 'Analysis unavailable.'
          }
        }
        return { ...entry, analysis, error }
      }),
    [alignment, terrain, settings, context, referenceSurfaces, sharedCrossingCosts],
  )
  const change = (action: () => Alignment) => {
    try {
      onChange(action())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check vertical alternative.')
    }
  }
  const add = () => {
    change(() =>
      addVerticalAlternative(
        alignment,
        crypto.randomUUID(),
        name.trim() || `Profile ${(alignment.verticalAlternatives?.length ?? 1) + 1}`,
      ),
    )
    setName('')
  }
  const valid = alternatives.filter((r): r is typeof r & { analysis: RoadAnalysis } => r.analysis !== null)
  const zs = valid.flatMap((r) =>
    r.analysis.stations.flatMap((s) => (s.designElevation === null ? [] : [s.designElevation])),
  )
  const lo = Math.min(...zs),
    hi = Math.max(...zs)
  const length = Math.max(1, ...valid.map((r) => r.analysis.length))
  return (
    <section className={insetBox({ padding: 'none' })} data-testid="road-vertical-alternatives">
      <CollapsibleSection
        label="Profiles on this road"
        summary={`${alternatives.length || 1}`}
        defaultOpen={alternatives.length > 1}
        contentClassName="space-y-3 p-3"
      >
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          Try several profiles on one plan.
          <InfoTip label="About road profiles">
            All profiles use the same horizontal points, section template and widening ranges, so editing the plan
            updates every profile. Terrain and base unit rates stay project-wide.{' '}
            {alignment.verticalAlternativeCostMode === 'independent'
              ? 'Material, site-preparation, culvert and haul edits stay with the active profile. Changing back to shared uses its inputs for every sibling.'
              : 'Material, site-preparation, culvert and haul edits apply to every sibling. Vertical controls and standards stay specific to each profile.'}
          </InfoTip>
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Engineering inputs across profiles">
            <RoadSelect
              value={alignment.verticalAlternativeCostMode ?? 'shared'}
              onValueChange={(mode) =>
                change(() => setVerticalAlternativeCostMode(alignment, mode as 'shared' | 'independent'))
              }
              options={[
                { value: 'shared', label: 'Shared materials, haul and structures' },
                { value: 'independent', label: 'Independent engineering per profile' },
              ]}
              ariaLabel="Vertical alternative engineering mode"
            />
          </Field>
          {active && (
            <Field label="Active vertical alternative">
              <RoadSelect
                value={active.id}
                onValueChange={(id) => change(() => activateVerticalAlternative(alignment, id))}
                options={(alignment.verticalAlternatives ?? []).map((v) => ({ value: v.id, label: v.name }))}
                ariaLabel="Active vertical alternative"
              />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
          <Field label="New profile name">
            <input
              className={roadFieldClass}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="Duplicate the current profile"
            />
          </Field>
          <Button
            size="field"
            variant="outline"
            onClick={add}
            disabled={(alignment.verticalAlternatives?.length ?? 0) >= MAX_VERTICAL_ALTERNATIVES}
          >
            Add profile
          </Button>
        </div>
        {active && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
            <Field label="Active profile name">
              <input
                key={active.id}
                className={roadFieldClass}
                defaultValue={active.name}
                maxLength={100}
                onBlur={(e) => {
                  if (e.target.value !== active.name)
                    change(() => renameVerticalAlternative(alignment, active.id, e.target.value))
                }}
              />
            </Field>
            <Button
              size="field"
              variant="outline"
              disabled={alternatives.length < 2}
              onClick={() => change(() => removeVerticalAlternative(alignment, active.id))}
            >
              Remove profile
            </Button>
          </div>
        )}
        {zs.length > 0 && (
          <svg
            viewBox="0 0 640 180"
            className={cn(insetBox({ padding: 'none', tone: 'background' }), 'w-full')}
            role="img"
            aria-label="Vertical alternatives profile overlay"
          >
            <line x1="35" x2="620" y1="150" y2="150" stroke="currentColor" opacity="0.3" />
            <text x="35" y="170" fontSize="11" fill="currentColor">
              0 m
            </text>
            <text x="620" y="170" textAnchor="end" fontSize="11" fill="currentColor">
              {length.toFixed(0)} m
            </text>
            <text x="30" y="20" textAnchor="end" fontSize="10" fill="currentColor">
              {hi.toFixed(0)}
            </text>
            <text x="30" y="150" textAnchor="end" fontSize="10" fill="currentColor">
              {lo.toFixed(0)}
            </text>
            {valid.map((entry, i) => {
              let pen = false
              const d = entry.analysis.stations
                .map((s) => {
                  if (s.designElevation === null) {
                    pen = false
                    return ''
                  }
                  const command = `${pen ? 'L' : 'M'}${(35 + (s.chainage / length) * 585).toFixed(1)},${(150 - ((s.designElevation - lo) / Math.max(1, hi - lo)) * 130).toFixed(1)}`
                  pen = true
                  return command
                })
                .join(' ')
              return (
                <path
                  key={entry.alternative.id}
                  d={d}
                  fill="none"
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={entry.alternative.id === active?.id ? 3 : 1.4}
                >
                  <title>{entry.alternative.name}</title>
                </path>
              )
            })}
          </svg>
        )}
        {alternatives.length > 0 && (
          <div className="overflow-x-auto overscroll-none">
            <EngineeringTable>
              <thead>
                <tr>
                  <ColumnHeader label="Profile" />
                  <ColumnHeader label="Max grade" unit="%" />
                  <ColumnHeader label="Cut + fill" unit="m³" />
                  <ColumnHeader label="Base estimate" unit="CAD" />
                  <ColumnHeader label="Coverage" unit="%" />
                </tr>
              </thead>
              <tbody>
                {alternatives.map((entry, i) => (
                  <tr
                    key={entry.alternative.id}
                    aria-selected={entry.alternative.id === active?.id}
                    title={entry.error ?? undefined}
                  >
                    <td>
                      <button
                        className="underline"
                        style={{ color: COLORS[i % COLORS.length] }}
                        onClick={() => change(() => activateVerticalAlternative(alignment, entry.alternative.id))}
                      >
                        {entry.alternative.name}
                      </button>
                    </td>
                    <td>{entry.analysis?.maxGradePercent.toFixed(1) ?? '—'}</td>
                    <td>
                      {entry.analysis ? (entry.analysis.cutVolumeM3 + entry.analysis.fillVolumeM3).toFixed(0) : '—'}
                    </td>
                    <td>
                      {entry.analysis
                        ? (alternativeCostLabel(entry.analysis) ?? `$${entry.analysis.estimatedCost.toFixed(0)}`)
                        : '—'}
                    </td>
                    <td>{entry.analysis?.coveragePercent.toFixed(1) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
        )}
        {valid.some((entry) => entry.analysis.coveragePercent < 99.99999) && (
          <p className="text-xs text-warning">
            Some profiles have incomplete sections. Their covered subtotals cannot establish the cheapest complete
            design.
          </p>
        )}
        {valid.some((entry) => alternativeCostStatus(entry.analysis) === 'infeasible') && (
          <p className="text-xs text-warning">
            A profile has no feasible material supply/movement prescription. Its subtotal is excluded from cost
            comparison even where terrain coverage is complete.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-warning">
            {error}
          </p>
        )}
      </CollapsibleSection>
    </section>
  )
}
