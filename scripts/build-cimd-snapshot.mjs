#!/usr/bin/env node
/**
 * Builds public/data/cimd/prince_george_cimd_2021.json from Statistics Canada's Canadian
 * Index of Multiple Deprivation, 2021, British Columbia table (catalogue 45-20-0001):
 * https://www150.statcan.gc.ca/n1/pub/45-20-0001/2023001/csv/bc_scores_quintiles_csv-eng.zip
 *
 * Usage: node scripts/build-cimd-snapshot.mjs <bc_scores_quintiles_EN.csv> [da.geo.json]
 *
 * StatCan publishes four dimensions and no composite. Their scores are factor scores
 * that run negative, so they cannot be read as 0-1 shares directly:
 * - each dimension becomes its percentile among all BC DAs, which keeps PG comparable
 *   with the province rather than only with itself;
 * - the composite follows the user guide's summary score (the four quintiles summed and
 *   divided by 4, giving 1-5), rescaled to 0-1. StatCan offers this as an option, so it
 *   is a PGMaps-derived figure rather than a published one.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUTPUT = 'public/data/cimd/prince_george_cimd_2021.json'
const [source, daPath = 'vendor/bcdatamapper/datascrapers/census/output/prince_george_da.geo.json'] = process.argv.slice(2)
if (!source) throw new Error('Pass the path to bc_scores_quintiles_EN.csv.')

const DIMENSIONS = {
  residentialInstability: 'Residential instability',
  economicDependency: 'Economic dependency',
  situationalVulnerability: 'Situational vulnerability',
  ethnoCulturalComposition: 'Ethno-cultural composition',
}

// StatCan's CSVs are Windows-1252; no field used here contains a comma.
const lines = (await readFile(source, 'latin1')).split(/\r?\n/).filter(Boolean)
const cells = (line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim())
const headers = cells(lines[0])
const column = (name) => {
  const index = headers.indexOf(name)
  if (index < 0) throw new Error(`Column "${name}" is missing from ${source}.`)
  return index
}
const daColumn = column('Dissemination Area (DA)')
const populationColumn = column('DA Population')
const rows = lines.slice(1).map(cells)

/** Share of BC DAs at or below each score, so 1 is the most deprived DA in the province. */
function percentileLookup(scoreColumn) {
  const sorted = rows.map((row) => Number(row[scoreColumn])).sort((a, b) => a - b)
  return (score) => {
    let low = 0
    let high = sorted.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (sorted[middle] <= score) low = middle + 1
      else high = middle
    }
    return low / sorted.length
  }
}

const dimensions = Object.entries(DIMENSIONS).map(([key, label]) => {
  const scoreColumn = column(`${label} Scores`)
  return { key, scoreColumn, quintileColumn: column(`${label} Quintiles`), percentile: percentileLookup(scoreColumn) }
})

const round = (value) => Number(value.toFixed(4))
const daGeojson = JSON.parse(await readFile(daPath, 'utf8'))
const pgDaCodes = new Set(daGeojson.features.map((feature) => String(feature.properties?.id ?? '').trim()))

const records = rows
  .filter((row) => pgDaCodes.has(row[daColumn].trim()))
  .map((row) => {
    const summary = dimensions.reduce((sum, entry) => sum + Number(row[entry.quintileColumn]), 0) / dimensions.length
    return {
      daCode: row[daColumn].trim(),
      population: Number(row[populationColumn]),
      composite: round((summary - 1) / 4),
      ...Object.fromEntries(
        dimensions.map((entry) => [entry.key, round(entry.percentile(Number(row[entry.scoreColumn])))]),
      ),
      quintile: Math.round(summary),
    }
  })
  .sort((a, b) => a.daCode.localeCompare(b.daCode))

await mkdir(path.dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, `${JSON.stringify(records)}\n`)
console.log(`CIMD: wrote ${records.length} of ${pgDaCodes.size} Prince George DAs to ${OUTPUT}`)
