import { useState } from 'react'
import { ChevronDown, Footprints, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  HEATMAP_OPTIONS,
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_FACTOR_GROUPS,
  describeHeatmapLogic,
  isFactorDroppedByOptions,
  type HeatmapOptionKey,
} from '@/maps/pgdata/walkabilityFactors'
import type { ScoreMetricWeightMap } from '../types'
import { buildSourceGridFactorWeights, type WalkabilitySurfaceTuning } from '../lib/walkabilitySurface'

interface ScoreBuilderWalkabilitySurfacePanelProps {
  tuning: WalkabilitySurfaceTuning
  onChange: (next: WalkabilitySurfaceTuning) => void
  metricWeights: ScoreMetricWeightMap
  isDesktop: boolean
}

/**
 * Direct control over the 44 report factor references (A0–G5) and the variant
 * config toggles that drive the Index Lab walkability MI source surface.
 *
 * When direct control is off, the raster follows the score equation (the
 * coarse metric weights projected onto the factor references). Turning it on
 * seeds from that same projection so the map does not jump, then lets the user
 * weight every report factor — reproducing the full Pedestrian Network Study
 * Mobility Index, which the eight coarse metrics cannot express on their own.
 */
export function ScoreBuilderWalkabilitySurfacePanel({
  tuning,
  onChange,
  metricWeights,
  isDesktop,
}: ScoreBuilderWalkabilitySurfacePanelProps) {
  const [collapsed, setCollapsed] = useState(true)

  const toggleDirect = (enabled: boolean) => {
    if (enabled && !tuning.enabled) {
      // Seed from the current derived projection so the surface stays put.
      onChange({ ...tuning, enabled: true, factorWeights: buildSourceGridFactorWeights(metricWeights) })
      return
    }
    onChange({ ...tuning, enabled })
  }

  const setOption = (key: HeatmapOptionKey, checked: boolean) => {
    onChange({ ...tuning, options: { ...tuning.options, [key]: checked } })
  }

  const setFactorWeight = (ref: string, value: number) => {
    const next = Math.max(0, Math.min(2, Number.isFinite(value) ? value : 1))
    onChange({ ...tuning, factorWeights: { ...tuning.factorWeights, [ref]: next } })
  }

  const loadReportDefaults = () => {
    onChange({
      ...tuning,
      enabled: true,
      options: { ...HEATMAP_REPORT_FIDELITY_OPTIONS },
      factorWeights: Object.fromEntries(WALKABILITY_FACTOR_GROUPS.map((factor) => [factor.ref, 1])),
    })
  }

  const heatmapLogic = describeHeatmapLogic(tuning.options)

  return (
    <div
      className={cn(
        'absolute z-20 flex max-h-[calc(100dvh-9rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur',
        // On mobile, sit below the density/correlate/undo action buttons; on
        // desktop, dock to the top-left corner the legend leaves free.
        isDesktop
          ? 'left-6 top-4 rounded-xl'
          : 'left-2 top-[calc(env(safe-area-inset-top)+7rem)]',
      )}
      data-score-builder-walkability-surface-panel="true"
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full shrink-0 items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Footprints className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-foreground">Walkability MI factors</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {tuning.enabled ? 'Direct 44-factor control' : 'Following equation weights'}
            </span>
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', collapsed && '-rotate-90')} />
      </button>

      {!collapsed && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-border px-3 py-3 text-xs">
          <label className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5">
            <input
              type="checkbox"
              checked={tuning.enabled}
              onChange={(event) => toggleDirect(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-emerald-600"
            />
            <span className="min-w-0">
              <span className="block font-medium leading-4 text-foreground">Direct factor control</span>
              <span className="block leading-4 text-muted-foreground">
                Weight all 44 report factors (A0-G5) instead of deriving them from the eight walkability metrics.
              </span>
            </span>
          </label>

          {!tuning.enabled ? (
            <p className="leading-4 text-muted-foreground">
              The source surface currently follows your score equation. The eight coarse metrics only reach a subset
              of report factors, so enable direct control to reproduce or tune the full Mobility Index.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">Report variant options</div>
                  <div className="text-[10px] leading-4 text-muted-foreground">Toggle the factors dropped/narrowed for report fidelity.</div>
                </div>
                <button
                  type="button"
                  onClick={loadReportDefaults}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  title="Reset all factors to 1 and report-fidelity options"
                >
                  <RotateCcw className="h-3 w-3" />
                  Report defaults
                </button>
              </div>

              <div className="space-y-1.5">
                {HEATMAP_OPTIONS.map((option) => (
                  <label
                    key={option.key}
                    className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={tuning.options[option.key]}
                      onChange={(event) => setOption(option.key, event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-emerald-600"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium leading-4 text-foreground">{option.label}</span>
                      <span className="block leading-4 text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div>
                <div className="font-medium text-foreground">Factor weights</div>
                <div className="text-[10px] leading-4 text-muted-foreground">0 disables a factor; 1 is report weight; 2 doubles it.</div>
              </div>
              <div className="space-y-1.5 pr-1">
                {WALKABILITY_FACTOR_GROUPS.map((factor) => {
                  const dropped = isFactorDroppedByOptions(factor.ref, tuning.options)
                  const value = tuning.factorWeights[factor.ref] ?? 1
                  return (
                    <label key={factor.ref} className="block rounded border border-border bg-background px-2 py-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-medium leading-4 text-foreground">
                            {factor.ref} · {factor.label}
                          </span>
                          <span className="block leading-4 text-muted-foreground">
                            {factor.group} · {factor.method}
                          </span>
                        </span>
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                          {dropped ? 'off' : `${value.toFixed(2)}x`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.25"
                        disabled={dropped}
                        value={value}
                        onChange={(event) => setFactorWeight(factor.ref, Number(event.target.value))}
                        className="mt-1.5 h-2 w-full accent-emerald-600 disabled:opacity-40"
                      />
                    </label>
                  )
                })}
              </div>

              <div className="rounded border border-border bg-muted/30 px-2.5 py-2 text-muted-foreground">
                <div className="font-medium text-foreground">Active rules</div>
                <ul className="mt-1.5 space-y-1 leading-4">
                  {heatmapLogic.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
