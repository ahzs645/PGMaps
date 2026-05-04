import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SOURCE = process.env.PG_CIMD_CSV || process.argv[2]
const DA_GEOJSON = 'public/data/census/prince_george_da.geo.json'
const OUTPUT = 'public/data/cimd/prince_george_cimd_2021.json'

function parseCsv(text) {
  const rows = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  if (!lines.length) return rows
  const headers = splitCsvLine(lines[0])
  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line)
    rows.push(Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ''])))
  }
  return rows
}

function splitCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

function numberFrom(row, names) {
  for (const name of names) {
    const value = Number(row[name])
    if (Number.isFinite(value)) return value
  }
  return 0
}

function normalize(value) {
  if (value > 1) return Math.max(0, Math.min(1, value / 100))
  return Math.max(0, Math.min(1, value))
}

async function readSource() {
  if (!SOURCE) {
    throw new Error('Provide a CIMD CSV path/URL as argv[2] or PG_CIMD_CSV.')
  }
  if (/^https?:\/\//.test(SOURCE)) {
    const response = await fetch(SOURCE)
    if (!response.ok) throw new Error(`Failed to fetch CIMD CSV: ${response.status}`)
    return response.text()
  }
  return readFile(SOURCE, 'utf8')
}

async function main() {
  const daGeojson = JSON.parse(await readFile(DA_GEOJSON, 'utf8'))
  const pgDaCodes = new Set(
    daGeojson.features
      .map((feature) => String(feature.properties?.DAUID ?? feature.id ?? '').trim())
      .filter(Boolean),
  )
  const rows = parseCsv(await readSource())
  const records = rows
    .map((row) => {
      const daCode = String(row.DAUID ?? row.daCode ?? row.DA ?? '').trim()
      if (!pgDaCodes.has(daCode)) return null
      return {
        daCode,
        population: numberFrom(row, ['Population', 'population', 'POP']),
        composite: normalize(numberFrom(row, ['cimdComposite', 'CIMD', 'Composite', 'COMPOSITE_SCORE'])),
        residentialInstability: normalize(numberFrom(row, ['residentialInstability', 'RI', 'RES_INSTABILITY'])),
        economicDependency: normalize(numberFrom(row, ['economicDependency', 'ED', 'ECON_DEPENDENCY'])),
        situationalVulnerability: normalize(numberFrom(row, ['situationalVulnerability', 'SV', 'SIT_VULNERABILITY'])),
        ethnoCulturalComposition: normalize(numberFrom(row, ['ethnoCulturalComposition', 'EC', 'ETHNO_CULTURAL'])),
        quintile: numberFrom(row, ['quintile', 'CIMD_Q', 'Composite_Q']),
      }
    })
    .filter(Boolean)

  await mkdir(path.dirname(OUTPUT), { recursive: true })
  await writeFile(OUTPUT, `${JSON.stringify(records)}\n`)
  console.log(`CIMD: wrote ${records.length} Prince George records to ${OUTPUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
