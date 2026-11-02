// SPDX-License-Identifier: Apache-2.0

import type { SimulationResult } from './types'

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  // Labels may originate in uploaded files or user-entered scenarios.
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csv(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export function simulationSummaryCsv(result: SimulationResult): string {
  const rows: unknown[][] = [
    [
      'model_id',
      'upstream_commit',
      'validation',
      'summary_policy',
      'latitude_lookup',
      'scenario_id',
      'scenario',
      'time_group',
      'period',
      'soil_id',
      'soil',
      'mean_daily_AET_PET',
      'total_AET_divided_by_total_PET',
      'total_PET_mm',
      'total_AET_mm',
      'ASMR_class',
      'initial_snowpack_mm',
      'input_years',
    ],
  ]
  for (const scenario of [result.baseline, ...result.scenarios]) {
    const groups = [
      { type: 'all_input_years', period: 'all', soils: scenario.summary },
      ...scenario.monthly.map((month) => ({ type: 'calendar_month', period: month.month, soils: month.soils })),
      ...scenario.annual.map((year) => ({ type: 'calendar_year', period: year.year, soils: year.soils })),
    ]
    for (const group of groups) {
      for (const soil of group.soils)
        rows.push([
          result.model.id,
          result.model.sourceCommit,
          result.model.validation,
          result.summaryPolicy,
          result.latitude,
          scenario.id,
          scenario.label,
          group.type,
          group.period,
          soil.soilId,
          soil.soilLabel,
          soil.meanRatio,
          soil.ratioOfTotals,
          soil.totalPet,
          soil.totalAet,
          soil.asmrClass,
          scenario.initialSnowpack,
          result.years.join(';'),
        ])
    }
  }
  return csv(rows)
}

export function simulationDailyCsv(result: SimulationResult, scenarioId = 'current'): string {
  const scenario = [result.baseline, ...result.scenarios].find((entry) => entry.id === scenarioId)
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}.`)
  const rows: unknown[][] = [
    [
      'model_id',
      'upstream_commit',
      'scenario_id',
      'date',
      'tmn_C',
      'tmx_C',
      'ppt_mm',
      'mean_temperature_C',
      'radiation',
      'PET_mm',
      'snow_mm',
      'snowpack_mm',
      'potential_water_balance_mm',
      ...result.soils.flatMap((soil) => [
        `S${soil.id}_AET_mm`,
        `S${soil.id}_AET_PET`,
        `S${soil.id}_storage_mm`,
        `S${soil.id}_storage_change_mm`,
        `S${soil.id}_runoff_mm`,
      ]),
    ],
  ]
  for (const day of scenario.daily)
    rows.push([
      result.model.id,
      result.model.sourceCommit,
      scenario.id,
      day.date,
      day.tmn,
      day.tmx,
      day.ppt,
      day.tav,
      day.radiation,
      day.pet,
      day.snow,
      day.snowpack,
      day.potentialWaterBalance,
      ...day.soils.flatMap((soil) => [soil.aet, soil.ratio, soil.storage, soil.change, soil.runoff]),
    ])
  return csv(rows)
}

/** Reproducible model settings; the separate daily CSV preserves the imported observations. */
export function simulationConfigurationJson(result: SimulationResult): string {
  return (
    JSON.stringify(
      {
        schema: 'forest-drought-run-configuration-v1',
        model: result.model,
        latitude: result.latitude,
        years: result.years,
        summaryPolicy: result.summaryPolicy,
        soils: result.soils,
        scenarios: result.scenarioInputs,
        initialSnowpack: {
          baseline: result.baseline.initialSnowpack,
          scenarios: result.scenarios.map((scenario) => ({ id: scenario.id, value: scenario.initialSnowpack })),
        },
        warnings: result.warnings,
      },
      null,
      2,
    ) + '\n'
  )
}
