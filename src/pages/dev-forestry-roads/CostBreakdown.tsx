import { useState } from 'react'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { AppSelect } from '@/components/ui/select'
import { NumberField } from './Controls'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import { hasCompleteCoverage } from './analysisResult'
import { haulCostLines, haulUnitCost } from './engineering'
import type { HaulSettings } from './engineeringTypes'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'
import { CostReadiness } from './CostReadinessPanel'
import { BCCostReferences } from './BCCostReferencesPanel'

const money = (value: number, digits = 0) =>
  `$${value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const quantity = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** The base unit rates a preset sets; engineering inputs (materials, haul, structures) stay per project. */
export const RATE_KEYS = ['cutRate', 'fillRate', 'surfacingRate', 'clearingRate'] as const
type RateKey = (typeof RATE_KEYS)[number]

export const RATE_PRESETS: {
  id: string
  label: string
  rates: Pick<RoadSettings, RateKey>
  source: string
}[] = [
  {
    id: 'placeholder',
    label: 'PG Maps placeholder rates',
    rates: Object.fromEntries(RATE_KEYS.map((key) => [key, DEFAULT_ROAD_SETTINGS[key]])) as Pick<RoadSettings, RateKey>,
    source:
      'Round planning numbers set in the workspace code (DEFAULT_ROAD_SETTINGS). They are not taken from a published cost survey or appraisal manual, and they have no regional adjustment.',
  },
]

export function ratePresetFor(settings: RoadSettings) {
  return RATE_PRESETS.find((preset) => RATE_KEYS.every((key) => preset.rates[key] === settings[key]))
}

type Rate = {
  value: number
  unit: string
  label: string
  min?: number
  max?: number
  /** Omitted: the rate is shown, and edited where its note says. */
  onChange?: (value: number) => void
}
type Row = {
  id: string
  item: string
  quantity: number | null
  unit: string
  rate?: Rate
  amount: number
  note?: string
}

function RateCell({ rate }: { rate?: Rate }) {
  if (!rate) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span className="w-24">
        {rate.onChange ? (
          <NumberField
            label={rate.label}
            hideLabel
            value={rate.value}
            min={rate.min ?? 0}
            max={rate.max ?? 100000}
            onChange={rate.onChange}
          />
        ) : (
          <span className="block px-2 text-right font-mono" aria-label={rate.label}>
            {rate.value.toLocaleString('en-CA', { maximumFractionDigits: 6 })}
          </span>
        )}
      </span>
      <span className="w-14 text-left text-[10px] text-muted-foreground">{rate.unit}</span>
    </span>
  )
}

/**
 * How the covered estimate is built: every priced line as quantity × editable rate, so a rate
 * edit recalculates the whole road and the change shows here and in the headline at once.
 */
export function CostBreakdown({
  open,
  onOpenChange,
  analysis,
  alignment,
  settings,
  onSettings,
  onHaul,
  onMaterialRate,
  portalContainer,
  processMs,
}: {
  processMs?: number
  open: boolean
  onOpenChange: (open: boolean) => void
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
  onSettings: (patch: Partial<RoadSettings>) => void
  onHaul?: (patch: Partial<HaulSettings>) => void
  onMaterialRate?: (materialId: string, cutRate: number) => void
  portalContainer?: HTMLElement | null
}) {
  const [opened, setOpened] = useState<{ open: boolean; total: number }>({ open, total: analysis.estimatedCost })
  if (opened.open !== open) setOpened({ open, total: analysis.estimatedCost })
  const result = analysis.engineering
  const haul = alignment.engineering?.haul
  const setting = (key: RateKey, label: string, unit: string, max = 10000): Rate => ({
    value: settings[key],
    unit,
    label,
    max,
    onChange: (value) => onSettings({ [key]: value }),
  })
  const haulRate = (key: keyof HaulSettings, label: string, unit: string, max = 1e9): Rate | undefined =>
    haul && onHaul
      ? { value: haul[key] as number, unit, label, max, onChange: (value) => onHaul({ [key]: value }) }
      : undefined
  const costs = result?.costs
  const haulLines = result && alignment.engineering ? haulCostLines(alignment.engineering, result) : []
  const haulRows: Row[] = haulLines.length
    ? haulLines.map((line) => ({
        id: line.id,
        item: line.item,
        quantity: line.quantity,
        unit: line.unit,
        // Only the default borrow and waste rates are edited here; the others have one place each.
        rate: (line.rateKey === 'borrowRate' || line.rateKey === 'wasteRate'
          ? haulRate(line.rateKey, line.rateKey === 'borrowRate' ? 'Borrow rate' : 'Waste rate', line.rateUnit, 100000)
          : undefined) ?? { value: line.rate, unit: line.rateUnit, label: `${line.item} rate` },
        amount: line.amount,
        note:
          line.rateKey === 'borrowRate' || line.rateKey === 'wasteRate'
            ? 'No site in reach with capacity left; the default rate applies. Its haul is not priced.'
            : line.rateKey
              ? 'Haul class rates are edited below.'
              : 'The site’s own rate or fixed cost; edit it in Engineering → Haul.',
      }))
    : [
        {
          id: 'haul',
          item: 'Haul, borrow and waste',
          quantity: null,
          unit: '',
          amount: costs ? costs.haul + costs.borrow + costs.waste + costs.sitePreparation : 0,
          note: result?.haul.enabled
            ? 'No material is moved, supplied or wasted.'
            : 'Haul allocation is off; turn it on in Engineering → Haul.',
        },
      ]
  const rows: Row[] = costs
    ? [
        ...result.materials.map((m) => ({
          id: `material-${m.materialId}`,
          item: m.purpose === 'stripping' ? `Stripping · ${m.name}` : `Excavation · ${m.name}`,
          quantity: m.bankCutM3,
          unit: 'bank m³',
          rate:
            m.materialId === '__unclassified'
              ? setting('cutRate', 'Unclassified excavation rate', '$/m³')
              : onMaterialRate
                ? {
                    value: alignment.engineering?.materials.find((x) => x.id === m.materialId)?.cutRate ?? 0,
                    unit: '$/m³',
                    label: `${m.name} excavation rate`,
                    max: 10000,
                    onChange: (value: number) => onMaterialRate(m.materialId, value),
                  }
                : undefined,
          amount: m.excavationCost,
        })),
        {
          id: 'fill',
          item: 'Fill placement',
          quantity: analysis.fillVolumeM3,
          unit: 'm³',
          rate: setting('fillRate', 'Fill rate', '$/m³'),
          amount: costs.fill,
        },
        {
          id: 'surfacing',
          item: 'Surfacing',
          quantity: analysis.surfaceVolumeM3,
          unit: 'm³',
          rate: setting('surfacingRate', 'Surfacing rate', '$/m³'),
          amount: costs.surfacing,
        },
        {
          id: 'clearing',
          item: 'Clearing',
          quantity: analysis.clearingAreaM2,
          unit: 'm²',
          rate: setting('clearingRate', 'Clearing rate', '$/m²'),
          amount: costs.clearing,
        },
        {
          id: 'structures',
          item: 'Structures',
          quantity: result.culverts.length,
          unit: 'culverts',
          amount: costs.structures,
          note: 'Installed cost per culvert; edit in Engineering → Drainage.',
        },
        ...haulRows,
        {
          id: 'mobilization',
          item: 'Mobilization',
          quantity: 1,
          unit: 'lump sum',
          rate: haulRate('mobilizationCost', 'Mobilization', '$'),
          amount: costs.mobilization,
        },
      ]
    : [
        {
          id: 'cut',
          item: 'Excavation',
          quantity: analysis.cutVolumeM3,
          unit: 'bank m³',
          rate: setting('cutRate', 'Cut rate', '$/m³'),
          amount: analysis.cutVolumeM3 * settings.cutRate,
        },
        {
          id: 'fill',
          item: 'Fill placement',
          quantity: analysis.fillVolumeM3,
          unit: 'm³',
          rate: setting('fillRate', 'Fill rate', '$/m³'),
          amount: analysis.fillVolumeM3 * settings.fillRate,
        },
        {
          id: 'surfacing',
          item: 'Surfacing',
          quantity: analysis.surfaceVolumeM3,
          unit: 'm³',
          rate: setting('surfacingRate', 'Surfacing rate', '$/m³'),
          amount: analysis.surfaceVolumeM3 * settings.surfacingRate,
        },
        {
          id: 'clearing',
          item: 'Clearing',
          quantity: analysis.clearingAreaM2,
          unit: 'm²',
          rate: setting('clearingRate', 'Clearing rate', '$/m²'),
          amount: analysis.clearingAreaM2 * settings.clearingRate,
        },
      ]
  const preset = ratePresetFor(settings)
  const change = analysis.estimatedCost - opened.total
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      portalContainer={portalContainer}
      size="lg"
      title="Covered estimate"
      subtitle={`${money(analysis.estimatedCost)} · ${quantity(analysis.coveragePercent)}% of the road has complete sections`}
      summary={
        <p className="text-[11px] text-muted-foreground" data-testid="road-cost-status">
          Calculation updated · section coverage {hasCompleteCoverage(analysis) ? 'complete' : 'partial'}
          {result?.complete === false ? ' · engineering inputs incomplete' : ''} · recalculated on every edit
          {processMs === undefined
            ? ''
            : ` · process time ${processMs < 1000 ? `${Math.max(1, Math.round(processMs))} ms` : `${(processMs / 1000).toFixed(1)} s`}`}
        </p>
      }
      contentProps={{ 'data-testid': 'road-cost-dialog' }}
    >
      <div className="space-y-3 text-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-muted-foreground sm:min-w-56 sm:shrink-0">
            Rate preset
            <AppSelect
              value={preset?.id ?? 'custom'}
              onValueChange={(id) => {
                const next = RATE_PRESETS.find((p) => p.id === id)
                if (next) onSettings({ ...next.rates })
              }}
              options={[
                ...RATE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                { value: 'custom', label: 'Custom · this project', disabled: true },
              ]}
              triggerAriaLabel="Rate preset"
              triggerClassName="h-8 text-xs"
              contentClassName="z-[1500] text-xs"
            />
          </label>
          <p
            className="min-w-0 flex-1 break-words text-[11px] leading-4 text-muted-foreground"
            data-testid="road-rate-source"
          >
            {preset
              ? preset.source
              : 'Rates edited for this project. They are saved with the project file and are not tied to a published source.'}
          </p>
        </div>
        <CostReadiness analysis={analysis} alignment={alignment} settings={settings} />
        <BCCostReferences />
        <div className="overflow-x-auto">
          <EngineeringTable data-testid="road-cost-calculation">
            <thead>
              <tr>
                <ColumnHeader label="Item" className="text-left" />
                <ColumnHeader label="Quantity" />
                <ColumnHeader label="Unit" className="text-left" />
                <ColumnHeader label="Rate" />
                <ColumnHeader label="Amount" unit="CAD" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-cost-row={row.id} title={row.note}>
                  <td className="text-left">{row.item}</td>
                  <td>{quantity(row.quantity, row.unit === 'culverts' || row.unit === 'lump sum' ? 0 : 1)}</td>
                  <td className="text-left text-muted-foreground">{row.unit}</td>
                  <td>
                    <RateCell rate={row.rate} />
                  </td>
                  <td className="font-mono">{money(row.amount, 2)}</td>
                </tr>
              ))}
              {costs && (
                <>
                  <tr className="font-medium">
                    <td className="text-left" colSpan={4}>
                      Subtotal
                    </td>
                    <td className="font-mono">{money(costs.subtotal, 2)}</td>
                  </tr>
                  <tr data-cost-row="contingency">
                    <td className="text-left">Contingency</td>
                    <td>{quantity(costs.subtotal, 0)}</td>
                    <td className="text-left text-muted-foreground">$ subtotal</td>
                    <td>
                      <RateCell rate={haulRate('contingencyPercent', 'Contingency', '%', 100)} />
                    </td>
                    <td className="font-mono">{money(costs.contingency, 2)}</td>
                  </tr>
                </>
              )}
              <tr className="bg-emerald-600/10 font-semibold" data-cost-row="total">
                <td className="text-left" colSpan={4}>
                  Total
                </td>
                <td className="font-mono" data-testid="road-cost-total">
                  {money(analysis.estimatedCost, 2)}
                </td>
              </tr>
            </tbody>
          </EngineeringTable>
        </div>
        {haul && onHaul && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['freeHaulDistanceM', 'Free haul (m)', 100000],
                ['overhaulDistanceM', 'Overhaul limit (m)', 100000],
                ['freeHaulRate', 'Free haul ($/m³·km)', 100000],
                ['freeHaulLoadingRate', 'Free loading ($/m³)', 100000],
                ['overhaulRate', 'Overhaul ($/m³·km)', 100000],
                ['overhaulLoadingRate', 'Over loading ($/m³)', 100000],
                ['endHaulRate', 'Endhaul ($/m³·km)', 100000],
                ['endHaulLoadingRate', 'End loading ($/m³)', 100000],
              ] as const
            ).map(([key, label, max]) => (
              <NumberField
                key={key}
                label={label}
                value={haul[key]}
                max={max}
                onChange={(value) => onHaul({ [key]: value })}
              />
            ))}
          </div>
        )}
        {haul && onHaul && <HaulCostGraph haul={haul} />}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Amount = quantity × rate. Contingency = subtotal × %. Quantities cover supported intervals only, with
            volumes by average end areas.
          </span>
          <span
            data-testid="road-cost-change"
            className={
              change === 0
                ? ''
                : change > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
            }
          >
            {change === 0
              ? 'No change since opened'
              : `${change > 0 ? '+' : '−'}${money(Math.abs(change))} since opened`}
          </span>
        </div>
        {!result && (
          <p className="text-[11px] text-muted-foreground">
            Materials, structures, haul, mobilization and contingency join this table once Engineering inputs are added
            to the road.
          </p>
        )}
      </div>
    </PanelDialog>
  )
}

/** Haul cost per m³ against distance: the free-haul, overhaul and endhaul pieces with their loading steps. */
function HaulCostGraph({ haul }: { haul: HaulSettings }) {
  const width = 520,
    height = 150,
    left = 46,
    right = 12,
    top = 12,
    bottom = 28
  const reach = Math.max(haul.overhaulDistanceM * 1.4, haul.freeHaulDistanceM * 2, 100)
  const distances = [
    0,
    haul.freeHaulDistanceM,
    haul.freeHaulDistanceM + 1e-6,
    haul.overhaulDistanceM,
    haul.overhaulDistanceM + 1e-6,
    reach,
  ]
  const costs = distances.map((d) => haulUnitCost(haul, d))
  const top$ = Math.max(1, ...costs) * 1.1
  const x = (d: number) => left + (d / reach) * (width - left - right)
  const y = (c: number) => top + (1 - c / top$) * (height - top - bottom)
  const path = distances.map((d, i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(costs[i]).toFixed(1)}`).join(' ')
  return (
    <figure className="rounded border p-2" data-testid="road-haul-cost-graph">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Haul cost per cubic metre by distance"
      >
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="hsl(var(--muted-foreground))" />
        <line x1={left} x2={left} y1={top} y2={y(0)} stroke="hsl(var(--muted-foreground))" />
        {[haul.freeHaulDistanceM, haul.overhaulDistanceM].map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={top} y2={y(0)} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <text x={x(d)} y={height - 12} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">
              {d.toLocaleString('en-CA')} m
            </text>
          </g>
        ))}
        <text x={width - right} y={height - 1} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">
          haul distance
        </text>
        <text x={left - 6} y={top + 8} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">
          ${top$.toFixed(top$ < 10 ? 2 : 0)}
        </text>
        <text x={left - 6} y={y(0)} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">
          $0
        </text>
        <path d={path} fill="none" stroke="#7c3aed" strokeWidth={2} />
      </svg>
      <figcaption className="text-[11px] text-muted-foreground">
        $ per m³ hauled: free haul over its whole distance, overhaul and endhaul beyond the free-haul distance, each
        class adding its loading rate.
      </figcaption>
    </figure>
  )
}
