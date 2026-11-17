import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CellNumberField, Field, NumberField, RoadSelect, roadFieldClass } from './Controls'
import type { DrainageSettings } from './drainageRun'
import {
  ECCC_DURATIONS_MIN,
  MAX_IDF_FILE_BYTES,
  MAX_IDF_POINTS,
  idfCurveFromEccc,
  parseEcccIdfText,
  type EcccIdfStation,
  type IdfCurve,
} from './idfCurve'
import {
  DEFAULT_CONCENTRATION_SETTINGS,
  MIN_TC_LIMITS,
  type ConcentrationSettings,
  type SlopeMethod,
} from './timeOfConcentration'

const SLOPE_OPTIONS = [
  {
    value: '10-85',
    label: '10–85 slope',
    title: 'Fall between 10 % and 85 % of the path from the outlet, over 0.75 L (Benson 1962, USGS).',
  },
  {
    value: 'equal-area',
    label: 'Equal-area slope',
    title: 'The line through the outlet with the same area under it as the path profile (ARR 1987).',
  },
  { value: 'end-to-end', label: 'End-to-end slope', title: 'Total fall over the path length, as Kirpich used.' },
]

/** A text input that writes on blur or Enter, so typing a name is one settings change. */
function TextSetting({
  label,
  value,
  onCommit,
  maxLength,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  maxLength: number
}) {
  return (
    <Field label={label}>
      <input
        key={value}
        type="text"
        className={roadFieldClass}
        defaultValue={value}
        maxLength={maxLength}
        aria-label={label}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim()
          if (next && next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </Field>
  )
}

/**
 * The design storm's intensity: one figure for every culvert (the run's Rainfall field), or each
 * culvert's own from an IDF curve at its Kirpich time of concentration. The curve is the user's,
 * entered as a table or ECCC's fitted equation, or read from one ECCC station file.
 */
export function DrainageIntensityEditor({
  settings,
  onSettings,
}: {
  settings: DrainageSettings
  onSettings: (settings: DrainageSettings) => void
}) {
  const [station, setStation] = useState<{ file: string; data: EcccIdfStation } | null>(null)
  const [importError, setImportError] = useState('')
  const timing = settings.concentration ?? DEFAULT_CONCENTRATION_SETTINGS
  const setTiming = (patch: Partial<ConcentrationSettings>) =>
    onSettings({ ...settings, concentration: { ...timing, ...patch } })
  const idf = timing.idf
  const setIdf = (patch: Partial<IdfCurve>) => idf && setTiming({ idf: { ...idf, ...patch } })
  const byHand = (): IdfCurve => ({
    stationName: 'Station not named',
    returnPeriodYears: 10,
    source: 'Entered by hand',
    use: 'table',
    // A flat curve at the run's one intensity: it reproduces today's figure until the rows are entered.
    table: ECCC_DURATIONS_MIN.map((durationMin) => ({ durationMin, intensityMmPerHr: settings.rainfallMmPerHr })),
  })

  return (
    <div className="space-y-2" role="group" aria-label="Culvert intensity">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-end gap-2">
        <Field
          label="Culvert intensity"
          hint="One intensity for every culvert is the Rainfall field. Per culvert reads an IDF curve at each culvert's time of concentration: Kirpich (1940), Tc = 0.0195·L^0.77·S^−0.385 (min, m, m/m), on its longest flow path."
        >
          <RoadSelect
            value={timing.enabled ? 'per-culvert' : 'one'}
            onValueChange={(value) => setTiming({ enabled: value === 'per-culvert' })}
            options={[
              { value: 'one', label: 'One for every culvert', title: 'The Rainfall (mm/h) field, for every culvert.' },
              {
                value: 'per-culvert',
                label: 'Per culvert: Tc and IDF',
                title: 'The IDF intensity at each culvert’s Kirpich time of concentration.',
              },
            ]}
            ariaLabel="Culvert intensity"
            className="h-8 w-full"
          />
        </Field>
        {timing.enabled && (
          <>
            <Field label="Flow-path slope">
              <RoadSelect
                value={timing.slopeMethod}
                onValueChange={(value) => setTiming({ slopeMethod: value as SlopeMethod })}
                options={SLOPE_OPTIONS}
                ariaLabel="Flow-path slope"
                className="h-8 w-full"
              />
            </Field>
            <NumberField
              label="Minimum Tc (min)"
              value={timing.minimumTcMin}
              min={MIN_TC_LIMITS.min}
              max={MIN_TC_LIMITS.max}
              step={1}
              hint="5 min: FHWA HEC-22's least time of concentration and ECCC's shortest IDF duration."
              onChange={(minimumTcMin) => setTiming({ minimumTcMin })}
            />
          </>
        )}
      </div>
      {timing.enabled && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label="Import an ECCC IDF station file (.txt)"
              hint="One station's short-duration IDF text file from Environment and Climate Change Canada's Engineering Climate Datasets (Open Government Licence – Canada). Table 2b's rates and Table 3's equation are read; the file stays yours."
            >
              <input
                type="file"
                accept=".txt,text/plain"
                className="max-w-full text-xs"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  try {
                    if (file.size > MAX_IDF_FILE_BYTES) throw Error('The IDF file is larger than 1 MB.')
                    const data = parseEcccIdfText(await file.text(), file.name)
                    const period = data.returnPeriodsYears.includes(timing.idf?.returnPeriodYears ?? 10)
                      ? (timing.idf?.returnPeriodYears ?? 10)
                      : data.returnPeriodsYears[0]
                    setTiming({ idf: idfCurveFromEccc(data, period, file.name) })
                    setStation({ file: file.name, data })
                    setImportError('')
                  } catch (error) {
                    setImportError(error instanceof Error ? error.message : 'The IDF file could not be read.')
                  }
                }}
              />
            </Field>
            {!idf && (
              <Button size="xs" variant="outline" onClick={() => setTiming({ idf: byHand() })}>
                Enter a curve by hand
              </Button>
            )}
          </div>
          {importError && (
            <p role="alert" className="text-danger">
              {importError}
            </p>
          )}
          {!idf && (
            <p className="text-warning">
              No IDF curve yet: import a station file or enter one. The run refuses per-culvert intensity without one.
            </p>
          )}
          {idf && (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-end gap-2">
                <TextSetting
                  label="Station"
                  value={idf.stationName}
                  maxLength={200}
                  onCommit={(stationName) => setIdf({ stationName })}
                />
                <TextSetting
                  label="Station ID"
                  value={idf.stationId ?? ''}
                  maxLength={40}
                  onCommit={(stationId) => setIdf({ stationId })}
                />
                {station && station.data.stationName === idf.stationName ? (
                  <Field label="Return period">
                    <RoadSelect
                      value={String(idf.returnPeriodYears)}
                      onValueChange={(value) =>
                        setTiming({
                          idf: { ...idfCurveFromEccc(station.data, Number(value), station.file), use: idf.use },
                        })
                      }
                      options={station.data.returnPeriodsYears.map((t) => ({ value: String(t), label: `${t}-year` }))}
                      ariaLabel="Return period"
                      className="h-8 w-full"
                    />
                  </Field>
                ) : (
                  <NumberField
                    label="Return period (years)"
                    value={idf.returnPeriodYears}
                    min={1}
                    max={1000}
                    step={1}
                    onChange={(returnPeriodYears) => setIdf({ returnPeriodYears })}
                  />
                )}
                <Field label="Read intensity from">
                  <RoadSelect
                    value={idf.use}
                    onValueChange={(value) =>
                      setIdf(
                        value === 'equation'
                          ? { use: 'equation', equation: idf.equation ?? { coefficientA: 30, exponentB: -0.65 } }
                          : {
                              use: 'table',
                              table: idf.table ?? byHand().table,
                            },
                      )
                    }
                    options={[
                      {
                        value: 'table',
                        label: 'Table (log–log)',
                        title: 'Linear in log intensity against log duration between table rows.',
                      },
                      {
                        value: 'equation',
                        label: 'Equation i = A·T^B',
                        title: "ECCC's fitted equation, T in hours, fitted over 5 min to 24 h.",
                      },
                    ]}
                    ariaLabel="Read intensity from"
                    className="h-8 w-full"
                  />
                </Field>
              </div>
              <TextSetting
                label="Source"
                value={idf.source}
                maxLength={500}
                onCommit={(source) => setIdf({ source })}
              />
              {idf.use === 'equation' && idf.equation ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-end gap-2">
                  <NumberField
                    label="A (mm/h at 1 h)"
                    value={idf.equation.coefficientA}
                    min={0.001}
                    max={100000}
                    step={0.1}
                    onChange={(coefficientA) => setIdf({ equation: { ...idf.equation!, coefficientA } })}
                  />
                  <NumberField
                    label="B (exponent)"
                    value={idf.equation.exponentB}
                    min={-2}
                    max={0}
                    step={0.001}
                    precision={4}
                    onChange={(exponentB) => setIdf({ equation: { ...idf.equation!, exponentB } })}
                  />
                </div>
              ) : (
                idf.table && (
                  <div className="space-y-1">
                    <table className="w-full max-w-sm text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left font-normal">Duration (min)</th>
                          <th className="text-left font-normal">Intensity (mm/h)</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {idf.table.map((point, k) => (
                          <tr key={k}>
                            <td>
                              <CellNumberField
                                label={`Duration ${k + 1} (min)`}
                                value={point.durationMin}
                                min={1}
                                max={10080}
                                step={1}
                                precision={1}
                                fixedDecimals={false}
                                onChange={(durationMin) => {
                                  const table = idf.table!.map((p, j) => (j === k ? { ...p, durationMin } : p))
                                  table.sort((a, b) => a.durationMin - b.durationMin)
                                  if (table.every((p, j) => !j || p.durationMin > table[j - 1].durationMin))
                                    setIdf({ table })
                                }}
                              />
                            </td>
                            <td>
                              <CellNumberField
                                label={`Intensity ${k + 1} (mm/h)`}
                                value={point.intensityMmPerHr}
                                min={0.01}
                                max={2000}
                                step={0.1}
                                precision={2}
                                fixedDecimals={false}
                                onChange={(intensityMmPerHr) =>
                                  setIdf({
                                    table: idf.table!.map((p, j) => (j === k ? { ...p, intensityMmPerHr } : p)),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={idf.table!.length <= 2}
                                aria-label={`Remove duration ${k + 1}`}
                                onClick={() => setIdf({ table: idf.table!.filter((_, j) => j !== k) })}
                              >
                                Remove
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={
                        idf.table.length >= MAX_IDF_POINTS || idf.table[idf.table.length - 1].durationMin >= 10080
                      }
                      onClick={() => {
                        const last = idf.table![idf.table!.length - 1]
                        setIdf({
                          table: [
                            ...idf.table!,
                            {
                              durationMin: Math.min(10080, last.durationMin * 2),
                              intensityMmPerHr: last.intensityMmPerHr,
                            },
                          ],
                        })
                      }}
                    >
                      Add duration
                    </Button>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
