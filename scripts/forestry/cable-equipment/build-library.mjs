#!/usr/bin/env node
/**
 * Builds the open cable-logging equipment library
 * (`src/pages/dev-forestry-roads/cableEquipment/skylineXl.generated.json`) from the USDA Forest
 * Service's SkylineXL 25.0 workbook, whose hidden `Database` sheet lists yarders, carriages and
 * wire rope. SkylineXL is public domain (a US Government work), so its data is extracted with its
 * provenance: every record names the workbook, version, database date, retrieval date and the cells
 * it was read from, and keeps the row as the sheet gives it beside the SI values.
 *
 *   node scripts/forestry/cable-equipment/build-library.mjs <path/to/skyline-xl-25.xlsm>
 *   node scripts/forestry/cable-equipment/build-library.mjs <path> --check   # fail on any difference
 *
 * The workbook is not kept in the repository. Download it from SOURCE.url; the build refuses any
 * file whose SHA-256 differs from SOURCE.sha256 (a new SkylineXL version means updating SOURCE).
 *
 * What is read: the sheet's English tables (in, ft, lb, lb/ft, hp, ft·lbf), converted here to SI
 * with exact factors. The sheet's own metric tables are derived from the English ones with rounded
 * factors (25.467 mm/in, 3.28 ft/m, 0.453 kg/lb, forces in kgf), so they are used only as a cross
 * check: every SI value must agree with its metric cell within that rounding, or the build stops.
 * Each yarder line's weight and design tension is also checked against the sheet's own rope table,
 * and any difference is written into the record's `notes`.
 *
 * Reads the .xlsm with fflate (zip) and @xmldom/xmldom (XML), both repository dependencies; nothing
 * in the workbook is executed (its VBA project is never opened).
 */
/* global process, console */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '../../../src/pages/dev-forestry-roads/cableEquipment/skylineXl.generated.json')

export const SOURCE = {
  id: 'skylinexl-25',
  title: 'SkylineXL 25.0 - Yarders, Carriages, and Wire Rope Database',
  publisher: 'USDA Forest Service',
  version: '25.0',
  /** The sheet's "Updated by administrator" date (cell Database!O2, Excel serial 45597). */
  databaseUpdated: '2024-11-01',
  retrieved: '2026-11-14',
  url: 'https://www.fs.usda.gov/sites/default/files/forest-management/products/skyline-xl-25.xlsm',
  listing: 'https://www.fs.usda.gov/forestmanagement/products/programs-software.shtml',
  licence:
    'Public domain: the USDA Forest Service lists its programs as "developed by the USDA Forest Service and are public domain software".',
  sha256: '3af9dc20b2b4357b770925d114a5d56f4c14447190dba35cb2d895d03f2b951a',
  sheet: 'Database',
}

/** Exact conversion factors. */
const IN_MM = 25.4
const FT_M = 0.3048
const LBF_N = 4.4482216152605
const LB_KG = 0.45359237
const LBFT_KGM = LB_KG / FT_M
/** Mechanical horsepower: 550 ft·lbf/s. */
const HP_KW = (550 * FT_M * LBF_N) / 1000
const FTLBF_NM = FT_M * LBF_N
const KGF_N = 9.80665

const round = (value, digits) => {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

// ---------------------------------------------------------------------------------------------
// Workbook reading

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function readWorkbook(bytes) {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && /\.(xml|rels)$/.test(f.name) })
  const xml = (name) => {
    if (!files[name]) throw new Error(`The workbook has no ${name}.`)
    return new DOMParser().parseFromString(strFromU8(files[name]), 'text/xml')
  }
  const rels = new Map()
  for (const rel of Array.from(xml('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')))
    rels.set(rel.getAttribute('Id'), rel.getAttribute('Target'))
  const sheets = new Map()
  for (const sheet of Array.from(xml('xl/workbook.xml').getElementsByTagNameNS(NS, 'sheet')))
    sheets.set(sheet.getAttribute('name'), rels.get(sheet.getAttributeNS(REL_NS, 'id')))
  const shared = Array.from(xml('xl/sharedStrings.xml').getElementsByTagNameNS(NS, 'si')).map((si) =>
    Array.from(si.getElementsByTagNameNS(NS, 't'))
      .map((t) => t.textContent ?? '')
      .join(''),
  )
  const target = sheets.get(SOURCE.sheet)
  if (!target) throw new Error(`The workbook has no ${SOURCE.sheet} sheet.`)
  /** Cached cell values by reference ("B9"); formulas are never evaluated, only their stored result. */
  const cells = new Map()
  for (const c of Array.from(xml(`xl/${target}`).getElementsByTagNameNS(NS, 'c'))) {
    const v = c.getElementsByTagNameNS(NS, 'v')[0]
    let value
    if (v) value = c.getAttribute('t') === 's' ? shared[Number(v.textContent)] : v.textContent
    else {
      const is = c.getElementsByTagNameNS(NS, 'is')[0]
      if (is)
        value = Array.from(is.getElementsByTagNameNS(NS, 't'))
          .map((t) => t.textContent ?? '')
          .join('')
    }
    if (value !== undefined) cells.set(c.getAttribute('r'), value)
  }
  return cells
}

const colName = (index) => {
  let s = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
const colIndex = (name) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

function makeReader(cells) {
  const text = (ref) => {
    const v = cells.get(ref)
    return v === undefined ? '' : String(v).trim()
  }
  const num = (ref) => {
    const v = text(ref)
    if (v === '') return 0
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`Database!${ref} is not a number: ${v}`)
    // Excel's 17-digit doubles (0.62749999999999995) read back as the decimal the user typed.
    return Number(n.toPrecision(12))
  }
  /** Header name → column letter for a header row, from `first` to `last` column. */
  const headers = (row, first, last) => {
    const map = new Map()
    for (let i = colIndex(first); i <= colIndex(last); i++) {
      const h = text(`${colName(i)}${row}`)
      if (h) map.set(h, colName(i))
    }
    return map
  }
  return { text, num, headers }
}

// ---------------------------------------------------------------------------------------------
// Records

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** 0.3125 → 5/16" ; 1.125 → 1-1/8". */
function inchLabel(inches) {
  const whole = Math.floor(inches + 1e-9)
  const sixteenths = Math.round((inches - whole) * 16)
  if (Math.abs(whole + sixteenths / 16 - inches) > 1e-6) return `${inches}"`
  if (!sixteenths) return `${whole}"`
  let n = sixteenths,
    d = 16
  while (n % 2 === 0) {
    n /= 2
    d /= 2
  }
  return whole ? `${whole}-${n}/${d}"` : `${n}/${d}"`
}

const ropeType = (value, where) => {
  const v = value.toLowerCase()
  if (v === 'swaged') return 'swaged'
  if (v === 'eips') return 'eips'
  throw new Error(`${where}: unknown rope type "${value}".`)
}

const source = (cells) => ({
  dataset: SOURCE.id,
  version: SOURCE.version,
  databaseUpdated: SOURCE.databaseUpdated,
  retrieved: SOURCE.retrieved,
  cells: `${SOURCE.sheet}!${cells}`,
})

function readRopes(r) {
  const ropes = []
  for (let row = 7; row <= 19; row++) {
    const inches = r.num(`AK${row}`)
    if (!inches) continue
    if (r.num(`AJ${row}`) !== inches) throw new Error(`Database!AJ${row} and AK${row} disagree on the diameter.`)
    for (const [type, bs, swl, wt] of [
      ['eips', 'AH', 'AM', 'AO'],
      ['swaged', 'AI', 'AL', 'AN'],
    ]) {
      const breakingLbf = r.num(`${bs}${row}`)
      if (!breakingLbf) continue // the sheet lists no swaged rope below 3/8"
      const swlLbf = r.num(`${swl}${row}`)
      const weightLbFt = r.num(`${wt}${row}`)
      ropes.push({
        id: `${type}-${inches}in`,
        type,
        diameterIn: inches,
        diameterLabel: inchLabel(inches),
        diameterMm: round(inches * IN_MM, 3),
        massKgPerM: round(weightLbFt * LBFT_KGM, 4),
        breakingForceN: Math.round(breakingLbf * LBF_N),
        safeWorkingLoadN: Math.round(swlLbf * LBF_N),
        safeWorkingLoadFactor: 3,
        sheet: {
          diameterIn: inches,
          breakingStrengthLbf: breakingLbf,
          safeWorkingLoadLbf: swlLbf,
          weightLbPerFt: weightLbFt,
        },
        source: source(`${bs}${row},${swl}${row},${wt}${row},AK${row}`),
        notes:
          Math.round(breakingLbf / 3) === swlLbf
            ? []
            : [`The sheet's safe working load is not its breaking strength ÷ 3 (${breakingLbf} ÷ 3 ≠ ${swlLbf}).`],
      })
    }
  }
  return ropes
}

const LINES = [
  ['skyline', 'Sky'],
  ['mainline', 'ML'],
  ['haulback', 'HB'],
  ['slackpulling', 'SP'],
]
const SIZE_CLASSES = { S: 'small', M: 'medium', L: 'large', MR: 'running' }

function readYarders(r, ropes) {
  const h = r.headers(4, 'A', 'AE')
  const col = (name) => {
    const c = h.get(name)
    if (!c) throw new Error(`The yarder table has no ${name} column.`)
    return c
  }
  const yarders = []
  for (let row = 5; row <= 50; row++) {
    const name = r.text(`${col('Name')}${row}`)
    if (!name) continue
    const sheetRow = {}
    for (const [header, c] of h)
      if (header !== 'ID' && header !== 'Name')
        sheetRow[header] =
          r.text(`${c}${row}`) === '' ? null : /type|Size/.test(header) ? r.text(`${c}${row}`) : r.num(`${c}${row}`)
    const notes = []
    const lines = {}
    for (const [key, prefix] of LINES) {
      const inches = r.num(`${col(`${prefix}_dia`)}${row}`)
      if (!inches) continue
      const type = ropeType(r.text(`${col(`${prefix}_type`)}${row}`), `Database!${col(`${prefix}_type`)}${row}`)
      const tensionCol = prefix === 'SP' ? 'SP_swl' : `${prefix}_des_tens`
      const weightLbFt = r.num(`${col(`${prefix}_wt`)}${row}`)
      const tensionLbf = r.num(`${col(tensionCol)}${row}`)
      const lengthFt = r.num(`${col(`${prefix}_len`)}${row}`)
      const rope = ropes.find((x) => x.type === type && x.diameterIn === inches)
      if (!rope) notes.push(`The ${key}'s ${inchLabel(inches)} ${type} rope is not in the sheet's rope table.`)
      else {
        if (rope.sheet.weightLbPerFt !== weightLbFt)
          notes.push(
            `The ${key}'s weight (${weightLbFt} lb/ft) differs from the rope table's ${rope.sheet.weightLbPerFt}.`,
          )
        if (rope.sheet.safeWorkingLoadLbf !== tensionLbf)
          notes.push(
            `The ${key}'s design tension (${tensionLbf} lbf) differs from the rope table's ${rope.sheet.safeWorkingLoadLbf}.`,
          )
      }
      lines[key] = {
        diameterIn: inches,
        diameterMm: round(inches * IN_MM, 3),
        ropeType: type,
        ...(rope ? { ropeId: rope.id } : {}),
        lengthM: round(lengthFt * FT_M, 3),
        massKgPerM: round(weightLbFt * LBFT_KGM, 4),
        designTensionN: Math.round(tensionLbf * LBF_N),
      }
    }
    const drums = {}
    for (const [key, prefix] of [
      ['mainline', 'ML'],
      ['haulback', 'HB'],
    ]) {
      const width = r.num(`${col(`${prefix}_dwid`)}${row}`)
      const dia = r.num(`${col(`${prefix}_ddia`)}${row}`)
      const torque = r.num(`${col(`${prefix}_btor`)}${row}`)
      if (width || dia || torque)
        drums[key] = {
          widthMm: round(width * IN_MM, 1),
          diameterMm: round(dia * IN_MM, 1),
          brakeTorqueNm: round(torque * FTLBF_NM, 1),
        }
    }
    const size = r.text(`${col('Size')}${row}`)
    if (!SIZE_CLASSES[size]) throw new Error(`Database!${col('Size')}${row}: unknown size class "${size}".`)
    const average = name.toLowerCase().startsWith('avg ')
    if (average) notes.push('A SkylineXL class average of the machines in its size class, not one machine.')
    yarders.push({
      id: slug(name),
      name,
      sheetId: r.num(`A${row}`),
      kind: average ? 'class-average' : 'machine',
      sizeClass: SIZE_CLASSES[size],
      towerHeightM: round(r.num(`${col('Twr_ht')}${row}`) * FT_M, 3),
      powerKW: round(r.num(`${col('H_pwr')}${row}`) * HP_KW, 1),
      lines,
      ...(Object.keys(drums).length ? { drums } : {}),
      sheet: sheetRow,
      source: source(`A${row}:AE${row}`),
      notes,
    })
  }
  return yarders
}

const SLACKPULLING = new Set(['carriage', 'hand', 'yarder', 'none'])
const yesNo = (value, where) => {
  if (value === 'yes') return true
  if (value === 'no') return false
  throw new Error(`${where}: expected yes or no, read "${value}".`)
}

function readCarriages(r) {
  const h = r.headers(56, 'A', 'O')
  const col = (name) => {
    const c = h.get(name)
    if (!c) throw new Error(`The carriage table has no ${name} column.`)
    return c
  }
  const carriages = []
  for (let row = 57; row <= 102; row++) {
    const name = r.text(`${col('Name')}${row}`)
    if (!name) continue
    const sheetRow = {}
    for (const [header, c] of h)
      if (header !== 'ID' && header !== 'Name')
        sheetRow[header] =
          r.text(`${c}${row}`) === ''
            ? null
            : /clp|meth|Multi/.test(header)
              ? r.text(`${c}${row}`)
              : r.num(`${c}${row}`)
    const method = r.text(`${col('SP_meth')}${row}`)
    if (!SLACKPULLING.has(method))
      throw new Error(`Database!${col('SP_meth')}${row}: unknown slackpulling "${method}".`)
    const range = (min, max) => [
      round(r.num(`${col(min)}${row}`) * IN_MM, 3),
      round(r.num(`${col(max)}${row}`) * IN_MM, 3),
    ]
    const droplineFt = r.num(`${col('DL_len')}${row}`)
    carriages.push({
      id: slug(name),
      name,
      sheetId: r.num(`A${row}`),
      massKg: round(r.num(`${col('Weight')}${row}`) * LB_KG, 2),
      powerKW: round(r.num(`${col('H_pwr')}${row}`) * HP_KW, 1),
      skylineClamp: yesNo(r.text(`${col('Sky_clp')}${row}`), `Database!${col('Sky_clp')}${row}`),
      slackpulling: method,
      multispan: yesNo(r.text(`${col('Multi')}${row}`), `Database!${col('Multi')}${row}`),
      yarderDrumsRequired: r.num(`${col('#_drums')}${row}`),
      skylineDiameterMm: range('Sky_min', 'Sky_max'),
      mainlineDiameterMm: range('ML_min', 'ML_max'),
      ...(droplineFt
        ? {
            dropline: {
              lengthM: round(droplineFt * FT_M, 3),
              diameterMm: round(r.num(`${col('DL_dia')}${row}`) * IN_MM, 3),
            },
          }
        : {}),
      sheet: sheetRow,
      source: source(`A${row}:O${row}`),
      notes: [],
    })
  }
  return carriages
}

// ---------------------------------------------------------------------------------------------
// Cross-check against the sheet's own metric tables

function crossCheck(r, ropes, yarders, carriages) {
  const problems = []
  const near = (ours, theirs, rel, abs, what) => {
    if (Math.abs(ours - theirs) > abs + rel * Math.abs(theirs))
      problems.push(`${what}: ${ours} against the metric sheet's ${theirs}`)
  }
  // Ropes: metric rows 24–36, forces and weights in kgf and kg/m.
  for (let row = 24; row <= 36; row++) {
    const mm = r.num(`AK${row}`)
    const inches = r.num(`AJ${row}`)
    for (const [type, bs, wt] of [
      ['eips', 'AH', 'AO'],
      ['swaged', 'AI', 'AN'],
    ]) {
      const rope = ropes.find((x) => x.type === type && x.diameterIn === inches)
      if (!rope) continue
      near(rope.diameterMm, mm, 0.004, 0.06, `${rope.id} diameter mm`)
      near(rope.breakingForceN / KGF_N, r.num(`${bs}${row}`), 0.002, 1, `${rope.id} breaking force kgf`)
      near(rope.massKgPerM, r.num(`${wt}${row}`), 0.01, 0.006, `${rope.id} kg/m`)
    }
  }
  // Yarders: metric rows 110–155 in the same order.
  for (const y of yarders) {
    const row = 109 + y.sheetId
    if (r.text(`B${row}`) !== y.name) {
      problems.push(`Metric yarder row ${row} is "${r.text(`B${row}`)}", expected "${y.name}"`)
      continue
    }
    if (y.kind === 'class-average') continue // the metric averages are recomputed from rounded rows
    near(y.towerHeightM, r.num(`C${row}`), 0.002, 0.5, `${y.id} tower m`)
    near(y.powerKW, r.num(`X${row}`), 0.002, 0.1, `${y.id} kW`)
    const cols = {
      skyline: ['D', 'E', 'F', 'G', 'H'],
      mainline: ['I', 'J', 'K', 'L', 'M'],
      haulback: ['N', 'O', 'P', 'Q', 'R'],
      slackpulling: ['S', 'T', 'U', 'V', 'W'],
    }
    for (const [key, [d, len, type, wt, ten]] of Object.entries(cols)) {
      const line = y.lines[key]
      if (!line) {
        if (r.num(`${d}${row}`)) problems.push(`${y.id} ${key}: absent in English, present in metric`)
        continue
      }
      near(line.diameterMm, r.num(`${d}${row}`), 0.004, 0.06, `${y.id} ${key} mm`)
      near(line.lengthM, r.num(`${len}${row}`), 0.002, 0.6, `${y.id} ${key} m`)
      // A metric row whose rope-type cell is blank looks its weight and tension up in the EIPS
      // column (SkylineXL's VLOOKUP falls through to it). The English row names the type, and is
      // the one used; the difference is written into the record's notes rather than refused.
      const metricType = r.text(`${type}${row}`)
      const asEips = !/^(swaged|eips)$/i.test(metricType) && line.ropeType === 'swaged'
      const compared = asEips ? ropes.find((x) => x.type === 'eips' && x.diameterIn === line.diameterIn) : null
      const weight = compared ? compared.massKgPerM : line.massKgPerM
      const tension = compared ? compared.safeWorkingLoadN : line.designTensionN
      near(weight, r.num(`${wt}${row}`), 0.01, 0.006, `${y.id} ${key} kg/m`)
      near(tension / KGF_N, r.num(`${ten}${row}`), 0.002, 1, `${y.id} ${key} kgf`)
      if (compared)
        y.notes.push(
          `SkylineXL's metric table leaves this ${key}'s rope type blank (Database!${type}${row}) and so lists EIPS weight and tension (${r.num(`${wt}${row}`)} kg/m, ${r.num(`${ten}${row}`)} kgf); the English table names it swaged, which is used here.`,
        )
    }
  }
  // Carriages: metric rows 162–207.
  for (const c of carriages) {
    const row = 161 + c.sheetId
    if (r.text(`B${row}`) !== c.name) {
      problems.push(`Metric carriage row ${row} is "${r.text(`B${row}`)}", expected "${c.name}"`)
      continue
    }
    near(c.massKg, r.num(`C${row}`), 0.002, 0.5, `${c.id} kg`)
    near(c.skylineDiameterMm[0], r.num(`I${row}`), 0.004, 0.06, `${c.id} skyline min mm`)
    near(c.skylineDiameterMm[1], r.num(`J${row}`), 0.004, 0.06, `${c.id} skyline max mm`)
    near(c.mainlineDiameterMm[0], r.num(`K${row}`), 0.004, 0.06, `${c.id} mainline min mm`)
    near(c.mainlineDiameterMm[1], r.num(`L${row}`), 0.004, 0.06, `${c.id} mainline max mm`)
  }
  return problems
}

// ---------------------------------------------------------------------------------------------

export function buildLibrary(bytes) {
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== SOURCE.sha256)
    throw new Error(
      `This workbook's SHA-256 is ${sha}, not SkylineXL ${SOURCE.version}'s ${SOURCE.sha256}. Update SOURCE for a new version.`,
    )
  const r = makeReader(readWorkbook(bytes))
  if (r.text('G1') !== SOURCE.title) throw new Error(`Database!G1 reads "${r.text('G1')}", not "${SOURCE.title}".`)
  if (r.num('O2') !== 45597) throw new Error('Database!O2 (database update date) is not 2024-11-01.')
  const ropes = readRopes(r)
  const yarders = readYarders(r, ropes)
  const carriages = readCarriages(r)
  for (const list of [ropes, yarders, carriages]) {
    const ids = new Set(list.map((x) => x.id))
    if (ids.size !== list.length) throw new Error('Two records share an id.')
  }
  const problems = crossCheck(r, ropes, yarders, carriages)
  return {
    library: {
      schema: 'pgmaps-cable-equipment-v1',
      source: SOURCE,
      units: {
        diameterMm: 'mm',
        lengthM: 'm',
        towerHeightM: 'm',
        massKgPerM: 'kg/m',
        massKg: 'kg',
        breakingForceN: 'N',
        safeWorkingLoadN: 'N',
        designTensionN: "N (the sheet's design tension: the rope table's safe working load at a factor of 3)",
        powerKW: 'kW (mechanical horsepower × 0.7457)',
        drumWidthMm: 'mm',
        brakeTorqueNm: 'N·m',
        sheet: 'As the sheet gives it: in, ft, lb, lb/ft, lbf, hp, ft·lbf',
      },
      ropes,
      yarders,
      carriages,
    },
    problems,
  }
}

function main() {
  const args = process.argv.slice(2)
  const path = args.find((a) => !a.startsWith('--'))
  if (!path) throw new Error('Pass the path of SkylineXL 25.0 (skyline-xl-25.xlsm).')
  const { library, problems } = buildLibrary(readFileSync(path))
  if (problems.length)
    throw new Error(`The SI values disagree with the sheet's metric tables:\n  ${problems.join('\n  ')}`)
  const text = JSON.stringify(library, null, 1) + '\n'
  const summary = `${library.yarders.length} yarders, ${library.carriages.length} carriages, ${library.ropes.length} ropes`
  if (args.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) throw new Error(`${OUT} differs from a rebuild. Run without --check.`)
    console.log(`Cable equipment library is up to date (${summary}).`)
    return
  }
  writeFileSync(OUT, text)
  console.log(`Wrote ${OUT} (${summary}).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
