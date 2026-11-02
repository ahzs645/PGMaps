import { useEffect, useRef, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Play, RotateCcw, Square, Upload } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink } from '@/components/ui/text-button'
import { downloadText } from '@/lib/download'
import {
  DEFAULT_SOILS,
  MAX_CLIMATE_CSV_BYTES,
  MODEL_INFO,
  createExampleClimateCsv,
  simulationDailyCsv,
  simulationSummaryCsv,
  type ScenarioInput,
  type SimulationResult,
  type Soil,
} from '@/features/forest-drought/model'
import { useDroughtSimulation } from './useDroughtSimulation'

function annualChartData(result: SimulationResult, soilId: number) {
  return result.baseline.annual.map((year) => ({
    year: year.year,
    baseline: year.soils.find((soil) => soil.soilId === soilId)?.meanRatio,
    adjusted: result.scenarios[0]?.annual
      .find((item) => item.year === year.year)
      ?.soils.find((soil) => soil.soilId === soilId)?.meanRatio,
  }))
}

export function CustomCalculator({ active }: { active: boolean }) {
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('')
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [latitude, setLatitude] = useState<50 | 55 | 60>(55)
  const [summaryPolicy, setSummaryPolicy] = useState<'day-weighted' | 'equal-month'>('day-weighted')
  const [soils, setSoils] = useState<Soil[]>(() => DEFAULT_SOILS.map((soil) => ({ ...soil })))
  const [compare, setCompare] = useState(false)
  const [temperatureDelta, setTemperatureDelta] = useState(2)
  const [precipitationPercent, setPrecipitationPercent] = useState(-10)
  const [chartSoil, setChartSoil] = useState(4)
  const [dailyScenario, setDailyScenario] = useState('current')
  const revision = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const { state, run, cancel, invalidate } = useDroughtSimulation()
  useEffect(
    () => () => {
      revision.current += 1
    },
    [],
  )

  const changeInput = (change: () => void) => {
    invalidate()
    change()
  }
  const importFile = async (file: File | undefined) => {
    if (!file) return
    const id = ++revision.current
    invalidate()
    setCsv('')
    setFilename('')
    setFileError('')
    if (file.size > MAX_CLIMATE_CSV_BYTES) {
      setFileError('This file exceeds 8 MB. Use a daily climate CSV within the model’s documented year limit.')
      setReading(false)
      return
    }
    setReading(true)
    try {
      const text = await file.text()
      if (revision.current !== id) return
      setCsv(text)
      setFilename(file.name)
    } catch (cause: unknown) {
      if (revision.current === id) setFileError(cause instanceof Error ? cause.message : 'This file could not be read.')
    } finally {
      if (revision.current === id) setReading(false)
    }
  }
  const loadExample = () => {
    revision.current += 1
    invalidate()
    setCsv(createExampleClimateCsv())
    setFilename('Synthetic demonstration climate (not observed weather)')
    setFileError('')
    setReading(false)
  }
  const updateSoil = (id: number, property: 'afc' | 'awsc' | 'infiltrationRate', value: number) =>
    changeInput(() => {
      setSoils((current) => current.map((soil) => (soil.id === id ? { ...soil, [property]: value } : soil)))
    })
  const start = () => {
    const scenarios: ScenarioInput[] = compare
      ? [
          {
            id: 'user-adjustment',
            label: `User adjustment: ${temperatureDelta >= 0 ? '+' : ''}${temperatureDelta} °C, ${precipitationPercent >= 0 ? '+' : ''}${precipitationPercent}% precipitation`,
            monthly: Array.from({ length: 12 }, (_, index) => ({
              month: index + 1,
              tminDelta: temperatureDelta,
              tmaxDelta: temperatureDelta,
              precipMultiplier: 1 + precipitationPercent / 100,
            })),
          },
        ]
      : []
    setDailyScenario('current')
    run({ csv, latitude, soils, scenarios, summaryPolicy })
  }
  const result = state.status === 'complete' ? state.data.result : null
  const chart = result ? annualChartData(result, chartSoil) : []
  const chartMaximum =
    Math.ceil(Math.max(1, ...chart.flatMap((point) => [point.baseline ?? 0, point.adjusted ?? 0])) * 10) / 10
  const calculatedScenarios = result ? [result.baseline, ...result.scenarios] : []
  const downloadRecord = () => {
    if (!result) return
    downloadText(
      JSON.stringify(
        {
          schema: 'pgmaps-forest-drought-run-v1',
          model: result.model,
          sourceFilename: filename,
          inputClimateCsv: csv,
          latitude: result.latitude,
          soils: result.soils,
          summaryPolicy: result.summaryPolicy,
          scenarioInputs: result.scenarioInputs,
          adjustment: compare
            ? { temperatureDeltaC: temperatureDelta, precipitationChangePercent: precipitationPercent }
            : null,
          years: result.years,
          summaries: calculatedScenarios.map(({ id, label, initialSnowpack, summary, annual }) => ({
            id,
            label,
            initialSnowpack,
            summary,
            annual,
          })),
          warnings: result.warnings,
        },
        null,
        2,
      ),
      'forest-drought-run.json',
      'application/json',
    )
  }

  return (
    <div className="space-y-6">
      <InlineAlert tone="warning" title="Research calculator using forestDroughtTool">
        <p>{MODEL_INFO.validation}</p>
        <p className="mt-2">
          This is the older model and its soil-water assumptions. Results support model review and scenario exploration;
          they do not reproduce the published forDRAT dataset. Daily numerical agreement does not establish ecological
          validity or equivalence of the original current/future summary workflows.
        </p>
      </InlineAlert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section
          className="min-w-0 space-y-5 self-start rounded-xl border bg-background p-4 sm:p-5"
          aria-labelledby="drought-climate-title"
        >
          <div>
            <h2 id="drought-climate-title" className="text-base font-semibold">
              Daily climate inputs
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Files stay on your device. Parsing and calculations run in a browser worker.
            </p>
          </div>
          <FormField
            label="Climate CSV"
            htmlFor="forest-drought-climate-file"
            description="Required columns: date, tmn, tmx, ppt. Dates use YYYY-MM-DD; temperatures are °C and precipitation is mm/day. Supply complete, consecutive years with no missing days."
          >
            <input
              ref={fileInput}
              id="forest-drought-climate-file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full min-w-0 rounded-md border p-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:font-medium"
              onChange={(event) => {
                void importFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadExample}>
              <Upload aria-hidden="true" /> Load synthetic example
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadText(createExampleClimateCsv(), 'forest-drought-example-climate.csv', 'text/csv;charset=utf-8')
              }
            >
              <Download aria-hidden="true" /> Example CSV
            </Button>
          </div>
          {reading && <InlineAlert loading>Reading the selected file…</InlineAlert>}
          {fileError && <InlineAlert tone="error">{fileError}</InlineAlert>}
          {filename && (
            <InlineAlert title="Selected climate">
              <span className="break-words">{filename}</span>
            </InlineAlert>
          )}
          <SelectField
            label="Latitude lookup"
            value={latitude}
            onChange={(event) => changeInput(() => setLatitude(Number(event.target.value) as 50 | 55 | 60))}
            description="The original model provides monthly daylength tables only at these three latitudes. No interpolation is applied."
          >
            <option value={50}>50° N</option>
            <option value={55}>55° N</option>
            <option value={60}>60° N</option>
          </SelectField>
          <SelectField
            label="Summary weighting"
            value={summaryPolicy}
            onChange={(event) =>
              changeInput(() => setSummaryPolicy(event.target.value as 'day-weighted' | 'equal-month'))
            }
            description="Use one explicit policy for both the baseline and adjustment. Original R wrappers use different current/future weights."
          >
            <option value="day-weighted">Equal weight per included day</option>
            <option value="equal-month">Equal weight per included month</option>
          </SelectField>
          <div className="space-y-3 border-t pt-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={compare}
                className="mt-0.5 size-4"
                onChange={(event) => changeInput(() => setCompare(event.target.checked))}
              />
              Compare a climate adjustment
            </label>
            {compare && (
              <>
                <NumberField
                  label="Temperature change"
                  unit="°C"
                  value={temperatureDelta}
                  min={-20}
                  max={20}
                  step={0.5}
                  onValueChange={(value) => changeInput(() => setTemperatureDelta(value))}
                  updateOn="change"
                  clampOn="commit"
                />
                <NumberField
                  label="Precipitation change"
                  unit="%"
                  value={precipitationPercent}
                  min={-100}
                  max={200}
                  step={5}
                  onValueChange={(value) => changeInput(() => setPrecipitationPercent(value))}
                  updateOn="change"
                  clampOn="commit"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Applied equally to all 12 months. This is your hypothetical adjustment; it does not represent a
                  published ClimateBC projection.
                </p>
              </>
            )}
          </div>
          <div className="flex gap-2 border-t pt-4">
            <Button className="min-w-0 flex-1" disabled={!csv || reading || state.status === 'running'} onClick={start}>
              <Play aria-hidden="true" /> Run calculation
            </Button>
            {state.status === 'running' && (
              <Button variant="outline" onClick={cancel}>
                <Square aria-hidden="true" /> Cancel
              </Button>
            )}
          </div>
        </section>

        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border bg-background p-4 sm:p-5" aria-labelledby="drought-model-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="drought-model-title" className="text-base font-semibold">
                How this run is calculated
              </h2>
              <Badge tone="warning" variant="outline">
                Legacy model
              </Badge>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Daily temperatures and precipitation drive radiation, potential evapotranspiration, snow storage and water
              balance in five linked soils. The initial snowpack uses snowfall in the final 47 input records, following
              the original model.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Missing observations are rejected. The port does not silently interpolate weather or reuse the older
              package’s ambiguous precipitation-cleaning function. Custom results retain their model version and
              settings in the downloaded run record.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              <ExternalLink href={`${MODEL_INFO.sourceRepository}/tree/${MODEL_INFO.sourceCommit}`}>
                Pinned R source
              </ExternalLink>
              <ExternalLink href="https://github.com/ahzs645/PGMaps/blob/main/docs/forest-drought-model.md">
                Model assumptions and validation
              </ExternalLink>
            </div>
          </section>

          <div aria-live="polite" aria-atomic="true">
            {state.status === 'running' && (
              <InlineAlert loading title="Calculating locally">
                <p>
                  Validating the climate series and evaluating soil water balance: {Math.round(state.fraction * 100)}%
                </p>
                <progress
                  className="mt-2 h-2 w-full"
                  max={1}
                  value={state.fraction}
                  aria-label="Calculation progress"
                />
              </InlineAlert>
            )}
            {state.status === 'error' && (
              <InlineAlert tone="error" title="Calculation needs attention">
                {state.message}
              </InlineAlert>
            )}
            {state.status === 'idle' && (
              <InlineAlert title={state.message ? 'Ready for a new run' : 'Your results will appear here'}>
                {state.message ??
                  'Import your climate CSV or load the synthetic example, then run the calculation. The example demonstrates the model and is not a Prince George weather record.'}
              </InlineAlert>
            )}
          </div>

          {state.status === 'complete' && result && (
            <>
              <section className="rounded-xl border bg-background p-4 sm:p-5" aria-labelledby="drought-run-title">
                <h2 id="drought-run-title" className="mb-4 text-lg font-semibold">
                  Calculation complete
                </h2>
                <StatGroup
                  variant="tiles"
                  items={[
                    { label: 'Climate days', value: state.data.dayCount.toLocaleString('en-CA') },
                    {
                      label: 'Years',
                      value: `${result.years[0]}–${result.years[result.years.length - 1]}`,
                      compact: true,
                    },
                    { label: 'Worker runtime', value: `${(state.data.elapsedMs / 1000).toFixed(2)} s`, compact: true },
                  ]}
                />
                <p className="mt-3 break-words text-xs text-muted-foreground">Input: {filename}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadText(simulationSummaryCsv(result), 'forest-drought-summary.csv', 'text/csv;charset=utf-8')
                    }
                  >
                    <Download aria-hidden="true" /> Summary CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadRecord}>
                    <Download aria-hidden="true" /> Run record JSON
                  </Button>
                </div>
              </section>
              {result.warnings.length > 0 && (
                <InlineAlert tone="warning" title="Run notes">
                  <ul className="list-disc space-y-1 pl-4">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </InlineAlert>
              )}
            </>
          )}
        </div>
      </div>

      <CollapsibleSection
        label="Soil parameters"
        summary="Inspect or customize the five linked regimes"
        collapseOn="always"
        className="overflow-hidden rounded-xl border bg-background"
      >
        <div className="space-y-4 border-t p-4 sm:p-5">
          <p className="text-xs leading-5 text-muted-foreground">
            Values start with the original package’s five soils. AFC is the available field-capacity limit (mm), AWSC is
            the runoff storage threshold (mm), and the infiltration/runoff parameter is in mm/day. Negative values for
            the receiving soils retain the original model’s lateral-water behavior.
          </p>
          <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Custom soil parameter table">
            <EngineeringTable className="min-w-[34rem] text-xs [&_td]:py-2">
              <thead>
                <tr>
                  <ColumnHeader label="Soil regime" className="text-left" />
                  <ColumnHeader label="AFC" unit="mm" />
                  <ColumnHeader label="AWSC" unit="mm" />
                  <ColumnHeader label="Infiltration / runoff" unit="mm/day" />
                </tr>
              </thead>
              <tbody>
                {soils.map((soil) => (
                  <tr key={soil.id}>
                    <th scope="row" className="px-2 text-left font-medium">
                      {soil.id} · {soil.label}
                    </th>
                    <td>
                      <NumberField
                        label={`${soil.label} AFC (mm)`}
                        hideLabel
                        value={soil.afc}
                        min={0.01}
                        max={2000}
                        step={1}
                        onValueChange={(value) => updateSoil(soil.id, 'afc', value)}
                        updateOn="change"
                        clampOn="commit"
                      />
                    </td>
                    <td>
                      <NumberField
                        label={`${soil.label} AWSC (mm)`}
                        hideLabel
                        value={soil.awsc}
                        min={0}
                        max={2000}
                        step={1}
                        onValueChange={(value) => updateSoil(soil.id, 'awsc', value)}
                        updateOn="change"
                        clampOn="commit"
                      />
                    </td>
                    <td>
                      <NumberField
                        label={`${soil.label} infiltration / runoff (mm/day)`}
                        hideLabel
                        value={soil.infiltrationRate}
                        min={soil.id === 3 || soil.id === 5 ? -200 : 0}
                        max={200}
                        step={0.5}
                        onValueChange={(value) => updateSoil(soil.id, 'infiltrationRate', value)}
                        updateOn="change"
                        clampOn="commit"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => changeInput(() => setSoils(DEFAULT_SOILS.map((soil) => ({ ...soil }))))}
          >
            <RotateCcw aria-hidden="true" /> Restore original soils
          </Button>
        </div>
      </CollapsibleSection>

      {result && (
        <>
          <section
            className="overflow-hidden rounded-xl border bg-background"
            aria-labelledby="custom-soil-results-title"
          >
            <div className="p-4 sm:p-5">
              <h2 id="custom-soil-results-title" className="text-lg font-semibold">
                Soil water balance summary
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                AET/PET summaries use the selected day/month weighting across full input years. Ratio of totals is a
                distinct statistic; neither value is a published forDRAT species risk.
              </p>
            </div>
            <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Custom soil water results table">
              <EngineeringTable className="text-xs [&_td]:py-3">
                <thead>
                  <tr>
                    <ColumnHeader label="Run" className="text-left" />
                    <ColumnHeader label="Soil regime" className="text-left" />
                    <ColumnHeader label="Mean AET/PET" />
                    <ColumnHeader label="Total AET / total PET" />
                    <ColumnHeader label="ASMR class" unit="Legacy thresholds" />
                  </tr>
                </thead>
                <tbody>
                  {calculatedScenarios.flatMap((scenario) =>
                    scenario.summary.map((soil) => (
                      <tr key={`${scenario.id}-${soil.soilId}`}>
                        <th scope="row" className="max-w-52 whitespace-normal px-2 py-3 text-left font-normal">
                          {scenario.label}
                        </th>
                        <td className="text-left">{soil.soilLabel}</td>
                        <td>{soil.meanRatio.toFixed(6)}</td>
                        <td>{soil.ratioOfTotals?.toFixed(6) ?? 'No PET'}</td>
                        <td>{soil.asmrClass ?? 'Unclassified'}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </EngineeringTable>
            </div>
          </section>
          <section
            className="min-w-0 space-y-4 rounded-xl border bg-background p-4 sm:p-5"
            aria-labelledby="custom-annual-title"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="custom-annual-title" className="text-base font-semibold">
                  Annual water balance
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hover or focus a point for its annual mean AET/PET.
                </p>
              </div>
              <SelectField
                label="Chart soil regime"
                value={chartSoil}
                onChange={(event) => setChartSoil(Number(event.target.value))}
                fieldClassName="min-w-40"
              >
                {result.soils.map((soil) => (
                  <option key={soil.id} value={soil.id}>
                    {soil.label}
                  </option>
                ))}
              </SelectField>
            </div>
            {active && (
              <div
                className="h-64 w-full min-w-0"
                role="img"
                aria-label="Annual mean AET/PET by scenario; exact values are available in the run record JSON."
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={chart} margin={{ top: 8, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" opacity={0.12} />
                    <XAxis dataKey="year" tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <YAxis domain={[0, chartMaximum]} tick={{ fill: 'currentColor', fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => Number(value).toFixed(6)}
                      contentStyle={{
                        background: 'hsl(var(--background))',
                        color: 'hsl(var(--foreground))',
                        borderRadius: 8,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      dataKey="baseline"
                      name="Input climate"
                      stroke="#047857"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                    {result.scenarios.length > 0 && (
                      <Line
                        dataKey="adjusted"
                        name="User adjustment"
                        stroke="#7c3aed"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3 border-t pt-4">
              <SelectField
                label="Daily series to export"
                value={dailyScenario}
                onChange={(event) => setDailyScenario(event.target.value)}
                fieldClassName="min-w-0 flex-1"
              >
                {calculatedScenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </SelectField>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadText(
                    simulationDailyCsv(result, dailyScenario),
                    `forest-drought-daily-${dailyScenario}.csv`,
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <Download aria-hidden="true" /> Daily CSV
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
