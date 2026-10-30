import { useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { InlineAlert } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import {
  HEATMAP_OPTIONS,
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_FACTOR_GROUPS,
  describeHeatmapLogic,
  isFactorDroppedByOptions,
  normalizeHeatmapOptions,
  type HeatmapFactorWeightState,
  type HeatmapOptionKey,
  type HeatmapOptionState,
} from '@/maps/pgdata/walkabilityFactors'
import { WalkabilityFactorControls, WalkabilityOptionControls } from './WalkabilityFactorControls'

/** Domain model supplied by MISC; control presentation does not own calculation state. */
export interface WalkabilityBuilderState {
  heatmapOptionState: HeatmapOptionState
  heatmapFactorWeights: HeatmapFactorWeightState
  setHeatmapOptions: (options: HeatmapOptionState) => void
  setHeatmapOption: (key: HeatmapOptionKey, enabled: boolean) => void
  setHeatmapFactorWeight: (ref: string, value: number) => void
}

const WALKABILITY_MODEL_PRESETS: Array<{
  key: string
  label: string
  description: string
  options: HeatmapOptionState
  weights?: Partial<HeatmapFactorWeightState>
}> = [
  {
    key: 'report',
    label: 'Report fidelity',
    description: 'Closest public-data reconstruction of the Pedestrian Network Study Mobility Index.',
    options: HEATMAP_REPORT_FIDELITY_OPTIONS,
  },
  {
    key: 'full',
    label: 'Full source model',
    description: 'Uses every available public and reconstructed factor without report-fidelity exclusions.',
    options: normalizeHeatmapOptions({
      dropGtfsHf: false,
      narrowCivic: false,
      narrowGrowth: false,
      dropPopAge: false,
      dropF0: false,
      dropC0: false,
      dropF8: false,
      dropSuppPoi: false,
      tightBuffer: false,
    }),
  },
  {
    key: 'access',
    label: 'Access emphasis',
    description: 'Prioritizes community destinations, services, parks, schools, and transit reach.',
    options: HEATMAP_REPORT_FIDELITY_OPTIONS,
    weights: Object.fromEntries(
      WALKABILITY_FACTOR_GROUPS.map((factor) => [
        factor.ref,
        ['Community activities', 'Community facilities', 'Community services', 'Environment mobility'].includes(
          factor.group,
        )
          ? 1.5
          : 0.5,
      ]),
    ),
  },
  {
    key: 'network',
    label: 'Network emphasis',
    description: 'Focuses on crossings, signals, transit corridors, and street-network association.',
    options: normalizeHeatmapOptions({ ...HEATMAP_REPORT_FIDELITY_OPTIONS, dropF0: false }),
    weights: Object.fromEntries(
      WALKABILITY_FACTOR_GROUPS.map((factor) => [
        factor.ref,
        ['Environment mobility', 'Environment routes'].includes(factor.group) ? 1.6 : 0.45,
      ]),
    ),
  },
]

function heatmapOptionsMatch(a: HeatmapOptionState, b: HeatmapOptionState) {
  return HEATMAP_OPTIONS.every((option) => a[option.key] === b[option.key])
}

function heatmapWeightsMatch(
  current: HeatmapFactorWeightState,
  expected: Partial<HeatmapFactorWeightState> | undefined,
) {
  return WALKABILITY_FACTOR_GROUPS.every((factor) => {
    const currentValue = Number(current[factor.ref] ?? 1)
    const expectedValue = Number(expected?.[factor.ref] ?? 1)
    return Math.abs(currentValue - expectedValue) < 0.001
  })
}

function activeWalkabilityPreset(walkability: WalkabilityBuilderState) {
  return (
    WALKABILITY_MODEL_PRESETS.find(
      (preset) =>
        heatmapOptionsMatch(walkability.heatmapOptionState, preset.options) &&
        heatmapWeightsMatch(walkability.heatmapFactorWeights, preset.weights),
    ) ?? null
  )
}

export function WalkabilityBuilderControls({ walkability }: { walkability: WalkabilityBuilderState }) {
  const [sourceRulesOpen, setSourceRulesOpen] = useState(false)
  const [factorTermsOpen, setFactorTermsOpen] = useState(false)
  const [showDisabledTerms, setShowDisabledTerms] = useState(false)
  const activePreset = activeWalkabilityPreset(walkability)
  const activeFactors = WALKABILITY_FACTOR_GROUPS.filter(
    (factor) =>
      !isFactorDroppedByOptions(factor.ref, walkability.heatmapOptionState) &&
      (walkability.heatmapFactorWeights[factor.ref] ?? 1) > 0,
  )
  const activeRuleCount = HEATMAP_OPTIONS.filter((option) => walkability.heatmapOptionState[option.key]).length
  const visibleFactorTerms = WALKABILITY_FACTOR_GROUPS.filter(
    (factor) => showDisabledTerms || !isFactorDroppedByOptions(factor.ref, walkability.heatmapOptionState),
  )
  const heatmapLogic = describeHeatmapLogic(walkability.heatmapOptionState)

  const applyPreset = (preset: (typeof WALKABILITY_MODEL_PRESETS)[number]) => {
    walkability.setHeatmapOptions(preset.options)
    WALKABILITY_FACTOR_GROUPS.forEach((factor) => {
      walkability.setHeatmapFactorWeight(factor.ref, preset.weights?.[factor.ref] ?? 1)
    })
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">
              {activePreset?.label ?? 'Custom walkability index'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => applyPreset(WALKABILITY_MODEL_PRESETS[0])}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-xs text-muted-foreground transition-colors hover:text-foreground touch:h-9"
            title="Reset to report fidelity model"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
        <div className="mt-1 text-xs leading-4 text-muted-foreground">
          {activePreset?.description ?? 'Custom factor weights and source rules are recalculated directly on the map.'}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {WALKABILITY_MODEL_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                'rounded-md border px-2 py-1.5 text-left transition-colors',
                activePreset?.key === preset.key
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/35 dark:text-emerald-100'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
              title={preset.description}
            >
              <span className="block truncate font-medium">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Equation</div>
            <div className="mt-0.5 break-words font-mono text-xs leading-5 text-foreground">
              MI(cell) = SUM(weight_ref x term_ref)
            </div>
          </div>
          <Badge size="sm">{activeFactors.length} active terms</Badge>
        </div>
        <div className="mt-2 text-xs leading-4 text-muted-foreground">
          Proximity terms use cumulative 400m / 250m / 100m buffers. Area and line terms use report points inside source
          buffers.
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background">
        <button
          type="button"
          onClick={() => setSourceRulesOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
          aria-expanded={sourceRulesOpen}
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Source Rules
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {activeRuleCount} active; open to change included logic.
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !sourceRulesOpen && '-rotate-90',
            )}
          />
        </button>
        {sourceRulesOpen && (
          <div className="space-y-3 border-t border-border px-3 py-3">
            <WalkabilityOptionControls
              variant="chips"
              options={walkability.heatmapOptionState}
              onChange={walkability.setHeatmapOption}
            />
            <InlineAlert title={<span className="text-foreground">Active rule logic</span>}>
              <ul className="mt-1.5 space-y-1 leading-4">
                {heatmapLogic.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </InlineAlert>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background">
        <button
          type="button"
          onClick={() => setFactorTermsOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
          aria-expanded={factorTermsOpen}
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Factor Weights
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {activeFactors.length} active terms; open to tune A0-G5.
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !factorTermsOpen && '-rotate-90',
            )}
          />
        </button>
        {factorTermsOpen && (
          <div className="border-t border-border px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs leading-4 text-muted-foreground">
                0 disables a factor; 1 is report weight; 2 doubles it.
              </div>
              <button
                type="button"
                onClick={() => setShowDisabledTerms((current) => !current)}
                className="shrink-0 rounded-full border border-input px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground touch:min-h-9"
              >
                {showDisabledTerms ? 'Hide off' : 'Show off'}
              </button>
            </div>
            <WalkabilityFactorControls
              className="max-h-[24rem] space-y-1.5 overflow-y-auto pr-1"
              factors={visibleFactorTerms}
              options={walkability.heatmapOptionState}
              weights={walkability.heatmapFactorWeights}
              onChange={walkability.setHeatmapFactorWeight}
            />
          </div>
        )}
      </div>
    </div>
  )
}
