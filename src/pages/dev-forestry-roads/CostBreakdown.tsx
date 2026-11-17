import { Fragment, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { CellNumberField, NumberField, RoadSelect } from './Controls'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import { hasCompleteCoverage } from './analysisResult'
import { haulUnitCost } from './engineering'
import type { HaulSettings } from './engineeringTypes'
import type { Alignment, RoadAnalysis, RoadProject, RoadSettings } from './types'
import { COST_SETTING_RATE_KEYS, costBreakdownRows, type CostRow, type CostRowRate } from './costBreakdownRows'
import { BCCostReferences } from './BCCostReferencesPanel'
import { RateSources, type RateAdoptionTarget } from './RateAdoption'
import { applyAdoption, rateSourceLines, withoutAdoption } from './costEvidence/rateAdoption'
import { adoptionTargets } from './costEvidence/adoptionTargets'
import { projectCurrency } from './costPlaces/projectLocation'
import { useCostPreferences } from './costPlaces/useCostPreferences'
import { CostLocationControl, useLocationSuggestion } from './CostLocation'
import { projectBudget } from './projectBudget'
import { ProjectBudgetPanel } from './ProjectBudgetPanel'
import { CostScenariosPanel } from './CostScenariosPanel'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { unpricedQuantities } from './costReadiness'
import { invalidInputNotice } from './inputErrors'
import { InlineAlert } from '@/components/ui/map-panels'
import { insetBox } from '@/components/ui/inset-box'
import type { CostAttribution, CostSeriesId } from './costAttribution'
import {
  COST_STRETCH_LENGTHS_M,
  CostWhereItFalls,
  defaultStretchLength,
  type CostStretchFocus,
} from './CostWhereItFalls'

const money = (value: number, digits = 0) =>
  `$${value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const quantity = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** The base unit rates a preset sets; engineering inputs (materials, haul, structures) stay per project. */
export const RATE_KEYS = COST_SETTING_RATE_KEYS
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

type Rate = Omit<CostRowRate, 'edit'> & {
  /** Omitted: the rate is shown, and edited where its note says. */
  onChange?: (value: number) => void
}
type Row = Omit<CostRow, 'rate'> & { rate?: Rate }

function RateCell({ rate }: { rate?: Rate }) {
  if (!rate) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span className="w-12 sm:w-24">
        {rate.onChange ? (
          <CellNumberField
            label={rate.label}
            value={rate.value}
            min={rate.min ?? 0}
            max={rate.max ?? 100000}
            precision={4}
            // Rates run from cents to thousands; padding every one to four places hides that.
            fixedDecimals={false}
            onChange={rate.onChange}
          />
        ) : (
          <span className="block px-1 text-right font-mono sm:px-2" aria-label={rate.label}>
            {rate.value.toLocaleString('en-CA', { maximumFractionDigits: 6 })}
          </span>
        )}
      </span>
      <span className="max-w-12 whitespace-normal text-left text-3xs text-muted-foreground sm:w-14 sm:max-w-none">
        {rate.unit}
      </span>
    </span>
  )
}

/** A project field set, or removed from the file when the value is undefined. */
function withField<K extends keyof RoadProject>(
  project: RoadProject,
  key: K,
  value: RoadProject[K] | undefined,
): RoadProject {
  if (value !== undefined) return { ...project, [key]: value }
  const rest = { ...project }
  delete rest[key]
  return rest
}

/**
 * How the covered estimate is built: every priced line as quantity × editable rate, so a rate
 * edit recalculates the whole road and the change shows here and in the headline at once. Beside
 * it: the project's cost location, where each adopted rate came from, the project budget and the
 * low and high cases. Opening the dialog writes nothing.
 */
export function CostBreakdown({
  open,
  onOpenChange,
  analysis,
  alignment,
  settings,
  project,
  onSettings,
  onHaul,
  onMaterialRate,
  onProjectEdit,
  runCase,
  portalContainer,
  attribution,
  onFocusStretch,
  colourBy,
  onColourBy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
  /** The project the estimate belongs to: its location, rate sources, build-ups, budget and scenarios. */
  project: RoadProject
  onSettings: (patch: Partial<RoadSettings>) => void
  onHaul?: (patch: Partial<HaulSettings>) => void
  onMaterialRate?: (materialId: string, cutRate: number) => void
  /** One named undo step on the project. Absent: everything beside the rates is read-only. */
  onProjectEdit?: (edit: (project: RoadProject) => RoadProject, label: string) => void
  /** Analyses a copy of the road with other inputs, for the low and high cases. */
  runCase?: (alignment: Alignment, settings: RoadSettings) => RoadAnalysis
  portalContainer?: HTMLElement | null
  /**
   * The estimate spread along the road (`costAttribution.ts`) for the same analysis, alignment and
   * settings. Absent: no "Where it falls".
   */
  attribution?: CostAttribution
  /** A stretch was picked: frame it on the plan and open its governing section. */
  onFocusStretch?: (focus: CostStretchFocus) => void
  /** The row the plan is coloured by now; null when the plan is not coloured by cost. */
  colourBy?: CostSeriesId | null
  /** Colours the plan's road by one row's cost per metre (or the whole estimate's). */
  onColourBy?: (id: CostSeriesId) => void
}) {
  const [opened, setOpened] = useState<{ open: boolean; total: number }>({ open, total: analysis.estimatedCost })
  if (opened.open !== open) setOpened({ open, total: analysis.estimatedCost })
  const [preferences] = useCostPreferences()
  // Session state: the dialog stays mounted while closed, so these hold until the page reloads.
  const [stretchChoice, setStretchChoice] = useState<number | null>(null)
  const stretchLengthM = stretchChoice ?? defaultStretchLength(analysis.length)
  const [whereOpen, setWhereOpen] = useState<ReadonlySet<CostSeriesId>>(() => new Set())
  const toggleWhere = (id: CostSeriesId) =>
    setWhereOpen((open) => {
      const next = new Set(open)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const placedRows = useMemo(
    () => new Set((attribution?.rows ?? []).filter((row) => row.placedTotal !== 0).map((row) => row.rowId)),
    [attribution],
  )
  const where = (id: CostSeriesId) =>
    attribution && (
      <CostWhereItFalls
        attribution={attribution}
        id={id}
        stretchLengthM={stretchLengthM}
        stationing={alignment.stationing}
        onFocusStretch={onFocusStretch}
        colouring={colourBy === id}
        onColourBy={onColourBy}
      />
    )
  const points = useMemo(() => alignment.points.map((point) => point.coordinate), [alignment.points])
  const suggestion = useLocationSuggestion(points, open && !project.costLocation)
  const currency = projectCurrency(project.costLocation)
  const budget = projectBudget(project, analysis)
  const adoption: RateAdoptionTarget | undefined = onProjectEdit && {
    project,
    currency,
    targets: adoptionTargets(project, budget.packItems),
    scheduleItems: budget.packItems,
    // The rate and the record it came from are one edit, so one undo takes both back.
    onAdopt: (key, adopted, label) =>
      onProjectEdit((p) => applyAdoption(p, key, adopted, budget.packItems), `Adopted ${label.toLowerCase()}`),
    onBuildUps: (next, label) => onProjectEdit((p) => withField(p, 'rateBuildUps', next), label),
  }
  const result = analysis.engineering
  const haul = alignment.engineering?.haul
  const costs = result?.costs
  // The dialog and the cost attribution (`costAttribution.ts`) read one row list.
  const breakdown = costBreakdownRows({
    analysis,
    alignment,
    settings,
    editable: { haul: Boolean(onHaul), materialRate: Boolean(onMaterialRate) },
  })
  const { noPlan } = breakdown
  const withEdit = (rate: CostRowRate | undefined): Rate | undefined => {
    if (!rate) return undefined
    const { edit, ...shown } = rate
    if (!edit) return shown
    const onChange =
      edit.kind === 'setting'
        ? (value: number) => onSettings({ [edit.key]: value })
        : edit.kind === 'haul'
          ? onHaul && ((value: number) => onHaul({ [edit.key]: value }))
          : onMaterialRate && ((value: number) => onMaterialRate(edit.materialId, value))
    return onChange ? { ...shown, onChange } : shown
  }
  const rows: Row[] = breakdown.rows.map((row) => ({ ...row, rate: withEdit(row.rate) }))
  const contingency = breakdown.contingency
  const preset = ratePresetFor(settings)
  const change = analysis.estimatedCost - opened.total
  // Work with a quantity and no rate: its amount is zero because it is unpriced, not because it is free.
  const unpriced = unpricedQuantities(analysis, alignment, settings)
  const unpricedOn = (rowId: string) => unpriced.filter((item) => item.rowId === rowId)
  const sources = rateSourceLines(project.rateEvidence, project, budget.packItems)
  const sourceOn = (row: Row) => sources.find((line) => line.rateKey === row.rate?.rateKey)
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      portalContainer={portalContainer}
      size={result ? 'lg' : 'md'}
      title="Covered estimate"
      className="road-cost-dialog"
      bodyClassName="p-3 workspace-sm:p-4"
      contentProps={{ 'data-testid': 'road-cost-dialog' }}
    >
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-end gap-2" data-testid="road-rate-sources">
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-muted-foreground max-sm:basis-full sm:max-w-72">
            <span className="flex items-center gap-1">
              Rate preset
              <InfoTip label="About this rate preset">
                <span data-testid="road-rate-source">
                  {preset
                    ? preset.source
                    : 'Rates edited for this project. They are saved with the project file and are not tied to a published source.'}
                </span>
              </InfoTip>
            </span>
            <RoadSelect
              value={preset?.id ?? 'custom'}
              onValueChange={(id) => {
                const next = RATE_PRESETS.find((p) => p.id === id)
                if (next) onSettings({ ...next.rates })
              }}
              options={[
                ...RATE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                { value: 'custom', label: 'Custom · this project', disabled: true },
              ]}
              ariaLabel="Rate preset"
              className="h-8"
            />
          </div>
          <div className="flex min-h-8 max-w-full flex-wrap items-center gap-2">
            <BCCostReferences
              portalContainer={portalContainer}
              road={{ name: alignment.name, length: analysis.length, stations: analysis.stations }}
              adoption={adoption}
              place={project.costLocation?.place}
            />
            <InfoTip label="How amounts are calculated" showLabel>
              Amount = quantity × rate. Contingency = subtotal × %. Quantities cover supported intervals only, with
              volumes by average end areas. Section coverage measures sampled road length, not cost confidence.
            </InfoTip>
          </div>
        </div>
        <CostLocationControl
          location={project.costLocation}
          suggestion={suggestion}
          homePlace={preferences.homePlace}
          onSet={(location, label) => onProjectEdit?.((p) => withField(p, 'costLocation', location), label)}
        />
        {analysis.invalidInput && (
          <div data-testid="road-cost-invalid-input">
            <InlineAlert tone="warning" title="This estimate leaves out an invalid input">
              {invalidInputNotice(analysis.invalidInput)} The amounts below change when it is corrected.
            </InlineAlert>
          </div>
        )}
        {unpriced.length > 0 && (
          <div data-testid="road-cost-unpriced">
            <InlineAlert
              tone="warning"
              title={
                unpriced.length === 1
                  ? 'One quantity has no rate and adds nothing to the total'
                  : `${unpriced.length} quantities have no rate and add nothing to the total`
              }
            >
              {unpriced.map((item) => item.text).join('; ')}. Enter the missing rate{unpriced.length === 1 ? '' : 's'},
              or note where the cost is carried. A total that falls after work is added is missing a price.
            </InlineAlert>
          </div>
        )}
        {attribution && (
          <div className="flex flex-wrap items-center gap-2" data-testid="road-cost-where">
            <span className="flex items-center gap-1 font-medium">
              Where the cost falls
              <InfoTip label="How the cost is placed on the road">
                Each row's amount is spread over the road by what it pays for: earthwork, surfacing and clearing by each
                stretch's own volume or area, haul half to each end of a movement, culverts, crossings and sites where
                they are. Nothing is re-priced: a row's stretches and its part off the road add up to its amount. Pick a
                stretch to see it on the plan and open its costliest section.
              </InfoTip>
            </span>
            <RoadSelect
              value={String(stretchLengthM)}
              onValueChange={(value) => setStretchChoice(Number(value))}
              options={COST_STRETCH_LENGTHS_M.map((length) => ({ value: String(length), label: `${length} m` }))}
              ariaLabel="Stretch length"
              className="h-8 w-24"
            />
            <Button
              size="xs"
              variant="outline"
              aria-expanded={whereOpen.has('total')}
              onClick={() => toggleWhere('total')}
            >
              <MapPin className="size-3.5" aria-hidden />
              Whole estimate
            </Button>
          </div>
        )}
        {attribution && whereOpen.has('total') && <div className={insetBox({ padding: 'md' })}>{where('total')}</div>}
        <div className="overflow-x-auto overscroll-none">
          <EngineeringTable
            className="[&_td]:bg-background [&_th]:bg-background max-sm:[&_td]:px-1 max-sm:[&_th]:px-1"
            data-testid="road-cost-calculation"
          >
            <thead>
              <tr>
                <ColumnHeader label="Item" className="text-left" />
                <ColumnHeader label="Quantity" />
                <ColumnHeader label="Unit" className="text-left" />
                <ColumnHeader label="Rate" />
                <ColumnHeader label="Amount" unit={currency} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const missing = unpricedOn(row.id)
                const source = sourceOn(row)
                const placed = placedRows.has(row.id)
                const opened = placed && whereOpen.has(row.id)
                return (
                  <Fragment key={row.id}>
                    <tr
                      data-cost-row={row.id}
                      data-unpriced={missing.length ? 'true' : undefined}
                      title={
                        [...missing.map((item) => `${item.text}.`), row.note].filter(Boolean).join(' ') || undefined
                      }
                    >
                      <td className="text-left max-sm:whitespace-normal">
                        {placed && (
                          <Button
                            size="icon-2xs"
                            variant="ghost"
                            className="-my-1 mr-1 align-middle"
                            aria-label={`Where ${row.item} falls`}
                            title="Where it falls on the road"
                            aria-expanded={opened}
                            onClick={() => toggleWhere(row.id)}
                          >
                            <MapPin className="size-3.5" aria-hidden />
                          </Button>
                        )}
                        {row.item}
                        {/* Why this rate: the reference it was adopted from, in the reference's own unit. */}
                        {source && (
                          <span
                            className={`block whitespace-normal text-3xs font-normal ${source.edited ? 'text-warning' : 'text-muted-foreground'}`}
                            data-testid="road-cost-rate-source"
                          >
                            {source.edited ? 'Edited since adopted from' : 'Rate adopted from'} {source.observed}
                          </span>
                        )}
                      </td>
                      <td>
                        {quantity(
                          row.quantity,
                          row.unit === 'culverts' || row.unit === 'crossings' || row.unit === 'lump sum' ? 0 : 1,
                        )}
                      </td>
                      <td className="text-left text-muted-foreground max-sm:whitespace-normal">{row.unit}</td>
                      <td>
                        <RateCell rate={row.rate} />
                      </td>
                      <td className="font-mono">
                        {/* A line with nothing priced on it says so; a part-priced line keeps its amount. */}
                        {row.amountText ? (
                          <span className="font-sans font-medium text-warning">{row.amountText}</span>
                        ) : missing.length > 0 && row.amount === 0 ? (
                          <span className="font-sans font-medium text-warning">No rate</span>
                        ) : (
                          <>
                            {missing.length > 0 && (
                              <span className="mr-1 font-sans text-3xs font-medium text-warning">part unpriced</span>
                            )}
                            {money(row.amount, 2)}
                          </>
                        )}
                      </td>
                    </tr>
                    {opened && (
                      <tr data-cost-stretches={row.id}>
                        <td colSpan={5} className="whitespace-normal text-left">
                          {where(row.id)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {costs && contingency && (
                <>
                  <tr className="font-medium">
                    <td className="text-left" colSpan={4}>
                      Subtotal
                    </td>
                    <td className="font-mono">{money(costs.subtotal, 2)}</td>
                  </tr>
                  <tr data-cost-row={contingency.id}>
                    <td className="text-left">{contingency.item}</td>
                    <td>{quantity(contingency.quantity, 0)}</td>
                    <td className="text-left text-muted-foreground">{contingency.unit}</td>
                    <td>
                      <RateCell rate={withEdit(contingency.rate)} />
                    </td>
                    <td className="font-mono">{money(contingency.amount, 2)}</td>
                  </tr>
                </>
              )}
            </tbody>
            <tfoot>
              <tr className="font-semibold" data-cost-row="total">
                <th
                  scope="row"
                  className="border-x border-b border-border/60 px-2 py-2 text-left align-top"
                  colSpan={4}
                >
                  <div className="flex items-baseline gap-2">
                    Total
                    <span
                      data-testid="road-cost-coverage"
                      className={`font-normal ${hasCompleteCoverage(analysis) ? 'text-muted-foreground' : 'text-warning'}`}
                    >
                      {quantity(analysis.coveragePercent)}% complete sections
                    </span>
                  </div>
                  {/* Only an edit made here moves the total, so the difference shows once there is one. */}
                  {change !== 0 && (
                    <span
                      data-testid="road-cost-change"
                      className={`block font-normal ${change > 0 ? 'text-warning' : 'text-success'}`}
                    >
                      {`${change > 0 ? '+' : '−'}${money(Math.abs(change))} since opened`}
                    </span>
                  )}
                  {noPlan ? (
                    <p className="max-w-64 whitespace-normal font-normal text-warning">
                      The material plan {noPlan}. Haul, borrow and waste are excluded.
                    </p>
                  ) : result?.complete === false ? (
                    <p className="whitespace-normal font-normal text-warning">Engineering inputs incomplete</p>
                  ) : null}
                </th>
                <td className="align-top font-mono !py-2" data-testid="road-cost-total">
                  {money(analysis.estimatedCost, 2)}
                </td>
              </tr>
            </tfoot>
          </EngineeringTable>
        </div>
        <RateSources
          lines={sources}
          onRemove={
            onProjectEdit &&
            ((key, label) =>
              // An emptied record is `undefined` here and leaves the saved file altogether.
              onProjectEdit(
                (p) => withField(p, 'rateEvidence', withoutAdoption(p.rateEvidence, key)),
                `Removed ${label.toLowerCase()} source`,
              ))
          }
        />
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
        <div className={insetBox({ padding: 'none' })}>
          <CollapsibleSection
            label="Project budget"
            summary={`$${Math.round(budget.summary.projectBudget).toLocaleString('en-CA')} · ${budget.summary.counts['not-assessed']} not assessed`}
            defaultOpen={false}
            className="bg-transparent"
            toggleProps={{ 'data-testid': 'road-project-budget-toggle' }}
          >
            <div className="px-3 pb-3">
              <ProjectBudgetPanel
                budget={budget}
                state={project.costSchedule}
                currency={currency}
                onSchedule={
                  onProjectEdit && ((next, label) => onProjectEdit((p) => withField(p, 'costSchedule', next), label))
                }
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            label="Low and high cases"
            summary={(() => {
              const count = Object.keys(project.costScenarios?.drivers ?? {}).length
              return count ? `${count} ${count === 1 ? 'driver' : 'drivers'}` : 'No drivers set'
            })()}
            defaultOpen={false}
            className="bg-transparent last:border-b-0"
            toggleProps={{ 'data-testid': 'road-cost-scenarios-toggle' }}
          >
            <div className="px-3 pb-3">
              <CostScenariosPanel
                analysis={analysis}
                alignment={alignment}
                settings={settings}
                scenarios={project.costScenarios}
                currency={currency}
                runCase={runCase}
                onScenarios={
                  onProjectEdit && ((next, label) => onProjectEdit((p) => withField(p, 'costScenarios', next), label))
                }
              />
            </div>
          </CollapsibleSection>
        </div>
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
    <figure className={insetBox()} data-testid="road-haul-cost-graph">
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
      <figcaption className="text-2xs text-muted-foreground">
        $ per m³ hauled: free haul over its whole distance, overhaul and endhaul beyond the free-haul distance, each
        class adding its loading rate.
      </figcaption>
    </figure>
  )
}
