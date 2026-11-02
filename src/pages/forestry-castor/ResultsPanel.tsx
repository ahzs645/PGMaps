import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, GitCompareArrows, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { downloadText } from '@/lib/download'
import { castorReportCsv } from '@/features/forestry-castor/outputs'
import type { CastorResult } from '@/features/forestry-castor/types'
import { number, ResultTable, Section } from './common'

const REPORTS = [
  { value: 'harvest', label: 'Harvest flow and shortfall', key: 'harvestReport' },
  { value: 'stock', label: 'Growing stock', key: 'growingStockReport' },
  { value: 'constraints', label: 'Management constraints', key: 'zoneManagement' },
  { value: 'pixels', label: 'Harvested pixels', key: 'harvestPixelList' },
  { value: 'blocks', label: 'Harvested blocks', key: 'harvestBlockList' },
  { value: 'landings', label: 'Candidate landings', key: 'landings' },
  { value: 'salvage', label: 'Salvage balance', key: 'salvageReport' },
  { value: 'uncertainty', label: 'Yield sensitivity', key: 'uncertainty' },
] as const
type ReportKind = (typeof REPORTS)[number]['value']

const label = (key: string) =>
  key
    .replace(/M3$/, '')
    .replace(/Ha$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase())
const unit = (key: string) =>
  key === 'annualVolumeM3'
    ? 'm³/year'
    : key === 'annualAreaHa'
      ? 'ha/year'
      : key === 'probabilityTarget' || key === 'removeFraction'
        ? 'fraction'
        : key === 'meanAge' || key === 'age' || key === 'elapsedYears'
          ? 'years'
          : key === 'meanHeight' || key === 'height' || key === 'x' || key === 'y'
            ? 'm'
            : key.endsWith('M3')
              ? 'm³'
              : key.endsWith('Ha')
                ? 'ha'
                : key === 'actualPercent' || key === 'targetPercent'
                  ? '%'
                  : undefined

function periodSeries(result: CastorResult) {
  const periods = new Map<
    number,
    { year: number; elapsedYears: number; harvest: number; target: number; stock: number; salvage: number }
  >()
  for (const snapshot of result.snapshots) {
    periods.set(snapshot.period, {
      year: snapshot.year,
      elapsedYears: snapshot.elapsedYears,
      harvest: 0,
      target: 0,
      stock: 0,
      salvage: 0,
    })
  }
  for (const row of result.harvestReport) {
    const current = periods.get(row.period)
    if (current) {
      current.harvest += row.volumeM3
      current.target += row.targetM3 ?? 0
      if (row.type === 'salvage') current.salvage += row.volumeM3
    }
  }
  for (const row of result.growingStockReport) {
    if (row.phase !== 'after-harvest' && row.phase !== 'initial') continue
    const current = periods.get(row.period)
    if (current) current.stock += row.stockM3
  }
  return Array.from(periods.values()).sort((a, b) => a.elapsedYears - b.elapsedYears)
}

export function ResultsPanel({
  result,
  baseline,
  onKeepBaseline,
  onClearBaseline,
}: {
  result: CastorResult
  baseline: CastorResult | null
  onKeepBaseline: () => void
  onClearBaseline: () => void
}) {
  const [reportKind, setReportKind] = useState<ReportKind>('harvest')
  const current = REPORTS.find((report) => report.value === reportKind) ?? REPORTS[0]
  const rows = result[current.key] as unknown as Record<string, unknown>[]
  const keys = rows.length ? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))) : []
  const series = useMemo(() => {
    const previous = baseline ? periodSeries(baseline) : []
    return periodSeries(result).map((row) => ({
      ...row,
      baselineHarvest: previous.find((other) => other.elapsedYears === row.elapsedYears)?.harvest,
    }))
  }, [baseline, result])
  const failedConstraints = result.zoneManagement.filter((row) => !row.met)
  return (
    <div className="min-w-0 space-y-5">
      <StatGroup
        variant="tiles"
        columns={4}
        items={[
          { label: 'Harvested volume', value: `${number(result.summary.harvestedM3)} m³` },
          {
            label: 'Harvested area',
            value: `${number(result.summary.harvestedAreaHa, 1)} ha`,
            note: 'Includes repeated treatments over time',
          },
          { label: 'Final growing stock', value: `${number(result.summary.finalStockM3)} m³` },
          {
            label: 'Target shortfall',
            value: `${number(result.summary.shortfallM3)} m³`,
            tone: result.summary.shortfallM3 > 0 ? 'warning' : 'success',
          },
        ]}
      />
      {failedConstraints.length > 0 && (
        <InlineAlert tone="warning" title="Review constraint attainment">
          {number(failedConstraints.length)} zone checks do not meet their target. The constraint report retains both
          pre-harvest and post-harvest checks; existing forest conditions may already be outside the target.
        </InlineAlert>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Section
          title="Harvest and targets"
          description="Period totals across compartments; the year marks the model's period label."
        >
          <div className="h-72 min-w-0" aria-label="Harvest and target chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 10, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="year" fontSize={11} />
                <YAxis tickFormatter={(value: number) => number(value)} width={72} fontSize={11} />
                <Tooltip formatter={(value) => `${number(Number(value), 1)} m³`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="harvest"
                  name="Harvest (m³)"
                  fill="#0f766e"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="target"
                  name="Target (m³)"
                  stroke="#b45309"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {baseline && (
                  <Line
                    dataKey="baselineHarvest"
                    name={`${baseline.scenario} (m³)`}
                    stroke="#7c3aed"
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section
          title="Standing timber"
          description="Initial and post-harvest merchantable stock on the timber harvesting land base."
        >
          <div className="h-72 min-w-0" aria-label="Growing stock chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 10, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="year" fontSize={11} />
                <YAxis tickFormatter={(value: number) => number(value)} width={72} fontSize={11} />
                <Tooltip formatter={(value) => `${number(Number(value), 1)} m³`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  dataKey="stock"
                  name="Growing stock (m³)"
                  stroke="#15803d"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>
      <Section
        title="Scenario comparison"
        description="Keep a run while you change assumptions. Chart comparisons align elapsed years; the table shows each complete horizon."
        actions={
          <Button variant="outline" size="sm" onClick={onKeepBaseline}>
            <GitCompareArrows className="size-4" /> Keep this run for comparison
          </Button>
        }
      >
        {baseline ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3 text-sm">
              <span>
                Comparing <strong>{baseline.scenario}</strong> with <strong>{result.scenario}</strong>.
              </span>
              <Button variant="ghost" size="sm" onClick={onClearBaseline}>
                <X className="size-4" /> Clear
              </Button>
            </div>
            <ResultTable
              label="Scenario comparison"
              rows={[baseline, result]}
              columns={[
                { key: 'name', label: 'Scenario', left: true, value: (row) => row.scenario },
                {
                  key: 'horizon',
                  label: 'Horizon',
                  unit: 'years',
                  value: (row) => row.config.periods * row.config.stepYears,
                },
                { key: 'harvest', label: 'Harvest', unit: 'm³', value: (row) => number(row.summary.harvestedM3, 1) },
                {
                  key: 'area',
                  label: 'Treatment area',
                  unit: 'ha',
                  value: (row) => number(row.summary.harvestedAreaHa, 1),
                },
                { key: 'stock', label: 'Final stock', unit: 'm³', value: (row) => number(row.summary.finalStockM3, 1) },
                {
                  key: 'shortfall',
                  label: 'Shortfall',
                  unit: 'm³',
                  value: (row) => number(row.summary.shortfallM3, 1),
                },
              ]}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Keep the current result, change targets or management settings, and run another scenario to compare them.
          </p>
        )}
      </Section>
      <Section
        title="Model reports"
        description="Every report row is available in the table and CSV. The complete download includes all report tables and the scenario inputs."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(castorReportCsv(result, reportKind), `castor-${reportKind}.csv`, 'text/csv;charset=utf-8')
            }
          >
            <Download className="size-4" /> Download table CSV
          </Button>
        }
      >
        <SelectField
          label="Report"
          value={reportKind}
          fieldClassName="mb-4 max-w-md"
          onChange={(event) => setReportKind(event.target.value as ReportKind)}
        >
          {REPORTS.map((report) => (
            <option key={report.value} value={report.value}>
              {report.label} ({number(result[report.key].length)})
            </option>
          ))}
        </SelectField>
        {reportKind === 'landings' && (
          <InlineAlert className="mb-4">
            Landing points are candidates attached to harvested blocks. They do not establish access, terrain
            suitability, engineering feasibility or a designed road.
          </InlineAlert>
        )}
        {reportKind === 'uncertainty' && (
          <InlineAlert className="mb-4">
            The 5th–95th percentiles and probability of meeting a target come from the supplied variation assumption.
            Without upstream calibration data, these are sensitivity results rather than calibrated prediction
            intervals.
          </InlineAlert>
        )}
        <ResultTable
          key={reportKind}
          label={current.label}
          rows={rows}
          columns={keys.map((key) => ({
            key,
            label: label(key),
            unit: unit(key),
            left: rows.some((row) => typeof row[key] === 'string'),
            value: (row: Record<string, unknown>) => {
              const value = row[key]
              return value === null || value === undefined
                ? '—'
                : typeof value === 'number'
                  ? number(value, 3)
                  : typeof value === 'boolean'
                    ? value
                      ? 'Yes'
                      : 'No'
                    : String(value)
            },
          }))}
        />
      </Section>
    </div>
  )
}
