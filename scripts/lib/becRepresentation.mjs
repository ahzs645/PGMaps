import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Values and classifications belong to the pinned 2023 study, not current BEC mapping.
export const SOURCE = Object.freeze({
  repository: 'https://github.com/whmacken/BEC_representation_PAS',
  commit: '0066648b02db082fded8ce9cf242c56d9a8ec22f',
  date: '2023-11-28',
  author: 'Will MacKenzie',
  title: 'Representation of BEC units in Protected Areas of BC',
  license: 'Apache-2.0',
  boundaryVersionInMethod: 'BEC v12',
  geometryIncludedUpstream: false,
})

export const SOURCE_FILES = Object.freeze([
  { path: 'ConservationAreas.Rmd', gitBlobSha: '5fa8ba46d416224e922e768b012c7a726a2b6977' },
  { path: 'Import_Catalogue_Layers.Rmd', gitBlobSha: 'b000f2d51f19f958c0cadd1f2e67aab02402e88b' },
  { path: 'LICENSE', gitBlobSha: '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64' },
  { path: 'outputs/BGC_area.csv', gitBlobSha: '2dda56ce703b8a9cb46472ed17cab7e711f695d0' },
  { path: 'outputs/BGC_area_by_park.csv', gitBlobSha: '54a62dfead2f888af8313d52d8598d46150fc3f7' },
  { path: 'outputs/PAS_representation_by_BGC.csv', gitBlobSha: '75fcf88aa30296d4b54765e2178c0299386fb01e' },
])

// These thresholds reproduce ConservationAreas.Rmd. There is no 10% breakpoint.
export const REPRESENTATION_CLASSES = Object.freeze([
  { id: 'no-recorded-intersection', label: 'No recorded intersection', color: '#7f1d1d', minInclusive: null, maxExclusive: null },
  { id: 'below-1', label: 'Below 1%', color: '#d73027', minInclusive: 0, maxExclusive: 1 },
  { id: '1-to-5', label: '1% to below 5%', color: '#fc8d59', minInclusive: 1, maxExclusive: 5 },
  { id: '5-to-15', label: '5% to below 15%', color: '#fee08b', minInclusive: 5, maxExclusive: 15 },
  { id: '15-to-30', label: '15% to below 30%', color: '#91cf60', minInclusive: 15, maxExclusive: 30 },
  { id: '30-plus', label: '30% or more', color: '#1a9850', minInclusive: 30, maxExclusive: null },
  { id: 'invalid-denominator', label: 'Percentage unavailable', color: '#64748b', minInclusive: null, maxExclusive: null },
])

const ROUNDING_RATIO_TOLERANCE = 0.00001
const asciiCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

/** CSV reader for the pinned UTF-8 sources; preserves raw strings and empty cells. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (quoted) throw new Error('Unclosed quoted CSV cell')
  if (cell !== '' || row.length > 0) rows.push([...row, cell])
  const header = rows.shift()
  if (!header || new Set(header).size !== header.length) throw new Error('Missing or duplicate CSV headers')
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has ${values.length} cells, expected ${header.length}`)
    return Object.fromEntries(header.map((name, column) => [name, values[column]]))
  })
}

function finiteNonnegative(value, label) {
  if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`)
  }
  return Number(value)
}

function nullableSourceNumber(value) {
  if (value === '' || value === 'Inf' || value === '-Inf' || value === 'NaN') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`Unexpected source number ${JSON.stringify(value)}`)
  return numeric
}

export function classifyRepresentation(ratio, totalAreaKm2) {
  if (!(totalAreaKm2 > 0) || (ratio !== null && !Number.isFinite(ratio))) return 'invalid-denominator'
  if (ratio === null) return 'no-recorded-intersection'
  if (ratio < 0 || ratio > 1 + ROUNDING_RATIO_TOLERANCE) throw new Error(`Out-of-range protected ratio: ${ratio}`)
  if (ratio >= 0.3) return '30-plus'
  if (ratio >= 0.15) return '15-to-30'
  if (ratio >= 0.05) return '5-to-15'
  if (ratio >= 0.01) return '1-to-5'
  return 'below-1'
}

// The study rounds each intersection to three decimal places BEFORE aggregation.
export function sumRoundedIntersections(contributors) {
  let thousandths = 0
  for (const contributor of contributors) {
    const scaled = contributor.intersectionAreaKm2 * 1000
    const whole = Math.floor(scaled)
    thousandths += scaled - whole === 0.5 ? whole + (whole % 2) : Math.round(scaled)
  }
  return thousandths / 1000
}

export function normalizeStudy(representationRows, areaRows, parkRows) {
  const areas = new Map(areaRows.map((row) => [row.BGC, row]))
  if (areas.size !== areaRows.length) throw new Error('Duplicate BGC area codes')
  const intersections = new Map()
  const pairs = new Set()
  for (const row of parkRows) {
    if (!areas.has(row.BGC)) throw new Error(`Unknown park intersection BGC code: ${row.BGC}`)
    const pair = JSON.stringify([row.BGC, row.parkname])
    if (pairs.has(pair)) throw new Error(`Duplicate park/BGC source pair: ${pair}`)
    pairs.add(pair)
    const intersectionAreaKm2 = finiteNonnegative(row.park_bgc_km2, 'park/BGC intersection area')
    const mappedParkAreaKm2 = finiteNonnegative(row.park_area_tot, 'mapped park area')
    const shareOfMappedPark = finiteNonnegative(row.park_bgc_ratio, 'mapped park share')
    if (!(mappedParkAreaKm2 > 0) || Math.abs(intersectionAreaKm2 / mappedParkAreaKm2 - shareOfMappedPark) > 1e-10) {
      throw new Error(`Inconsistent park composition for ${row.parkname} / ${row.BGC}`)
    }
    const entry = {
      parkName: row.parkname.trim(),
      sourceParkName: row.parkname,
      designation: row.park_type || null,
      parkClass: row.park_class || null,
      intersectionAreaKm2,
      mappedParkAreaKm2,
      shareOfMappedPark,
    }
    if (!intersections.has(row.BGC)) intersections.set(row.BGC, [])
    intersections.get(row.BGC).push(entry)
  }

  const seenCodes = new Set()
  const units = representationRows.map((raw) => {
    if (seenCodes.has(raw.BGC)) throw new Error(`Duplicate representation code: ${raw.BGC}`)
    seenCodes.add(raw.BGC)
    const areaRow = areas.get(raw.BGC)
    if (!areaRow || areaRow.BGC_km2 !== raw.BGC_km2) throw new Error(`BGC area disagrees with representation: ${raw.BGC}`)
    const totalAreaKm2 = finiteNonnegative(raw.BGC_km2, 'BGC area')
    const protectedAreaKm2 = raw.bgc_protected === '' ? null : finiteNonnegative(raw.bgc_protected, 'protected area')
    const rawRatio = nullableSourceNumber(raw.bgc_protected_ratio)
    const contributors = [...(intersections.get(raw.BGC) ?? [])].sort((left, right) => right.intersectionAreaKm2 - left.intersectionAreaKm2 || asciiCompare(left.sourceParkName, right.sourceParkName))
    const intersectionSum = contributors.reduce((sum, contributor) => sum + contributor.intersectionAreaKm2, 0)
    const roundedIntersectionSum = sumRoundedIntersections(contributors)
    if (protectedAreaKm2 !== null && Math.abs(roundedIntersectionSum - protectedAreaKm2) > 1e-8) {
      throw new Error(`Rounded park contributions disagree with protected area for ${raw.BGC}`)
    }
    if (protectedAreaKm2 === null && contributors.length > 0) throw new Error(`Blank protected value with recorded intersections for ${raw.BGC}`)
    if (totalAreaKm2 > 0 && rawRatio !== null && (protectedAreaKm2 === null || Math.abs(protectedAreaKm2 / totalAreaKm2 - rawRatio) > 1e-10)) {
      throw new Error(`Ratio disagrees with area totals for ${raw.BGC}`)
    }
    if (rawRatio !== null && rawRatio > 1 && (
      intersectionSum > totalAreaKm2 + 1e-8 ||
      protectedAreaKm2 - totalAreaKm2 > contributors.length * 0.0005 + 1e-8
    )) {
      throw new Error(`Excess protected share cannot be attributed to intersection rounding for ${raw.BGC}`)
    }
    const qualityFlags = []
    if (totalAreaKm2 === 0) qualityFlags.push('zero-denominator')
    if (raw.bgc_protected_ratio !== '' && rawRatio === null) qualityFlags.push('non-finite-source-ratio')
    if (protectedAreaKm2 === null && raw.bgc_protected_ratio === '') qualityFlags.push('missing-intersection')
    // Check unrounded totals and the maximum per-row rounding error before using this flag.
    if (rawRatio !== null && rawRatio > 1) qualityFlags.push('rounding-over-100')
    const protectedRatio = totalAreaKm2 > 0 ? rawRatio : null
    const protectedPercent = protectedRatio === null ? null : protectedRatio * 100
    return {
      code: raw.BGC,
      zone: raw.BGC.match(/^[A-Z]+/)[0],
      totalAreaKm2,
      protectedAreaKm2,
      protectedRatio,
      protectedPercent,
      // For bounded visual marks only; tables retain protectedPercent and qualityFlags.
      displayPercent: protectedPercent === null ? null : Math.max(0, Math.min(100, protectedPercent)),
      representationClass: classifyRepresentation(protectedRatio, totalAreaKm2),
      qualityFlags,
      raw: { ...raw },
      contributors: contributors.map((contributor) => ({
        ...contributor,
        shareOfUnitIntersections: intersectionSum > 0 ? contributor.intersectionAreaKm2 / intersectionSum : null,
      })),
    }
  }).sort((left, right) => asciiCompare(left.code, right.code))
  if (seenCodes.size !== areas.size) throw new Error('The representation output omits BGC area codes')
  const classes = REPRESENTATION_CLASSES.map((definition) => ({
    ...definition,
    count: units.filter((unit) => unit.representationClass === definition.id).length,
  }))
  return {
    schemaVersion: 1,
    source: { ...SOURCE },
    measurement: {
      numerator: 'Sum of each park/BGC intersection rounded to 0.001 km² in the source analysis',
      denominator: 'Area of the mapped BGC unit in the source CSV; not a terrestrial-land mask',
      formula: 'protectedPercent = 100 × protectedAreaKm2 / totalAreaKm2',
      missingValues: 'Blank source values remain null; no recorded intersection is not proof of no protection today.',
      displayPercent: 'Clamped to 0–100 only for bounded visual marks; source ratios and excess flags are retained.',
      parkNames: 'Source name groups; provincial names were truncated at the first hyphen before aggregation.',
    },
    summary: {
      unitCount: units.length,
      zoneCount: new Set(units.map((unit) => unit.zone)).size,
      intersectionCount: parkRows.length,
      parkNameGroupCount: new Set(parkRows.map((row) => row.parkname)).size,
      finiteRatioCount: units.filter((unit) => unit.protectedRatio !== null).length,
      missingIntersectionCount: units.filter((unit) => unit.qualityFlags.includes('missing-intersection')).length,
      invalidRatioCount: units.filter((unit) => unit.representationClass === 'invalid-denominator').length,
      roundingExcessCount: units.filter((unit) => unit.qualityFlags.includes('rounding-over-100')).length,
      belowFivePercentCount: units.filter((unit) => unit.protectedRatio !== null && unit.protectedRatio < 0.05).length,
      atLeastThirtyPercentCount: units.filter((unit) => unit.protectedRatio !== null && unit.protectedRatio >= 0.3).length,
    },
    classes,
    units,
  }
}

export async function loadPinnedStudy(sourceDirectory) {
  const sources = []
  const texts = new Map()
  for (const sourceFile of SOURCE_FILES) {
    const bytes = await readFile(join(sourceDirectory, sourceFile.path))
    const actualBlobSha = gitBlobSha(bytes)
    if (actualBlobSha !== sourceFile.gitBlobSha) throw new Error(`Pinned source integrity mismatch: ${sourceFile.path}`)
    texts.set(sourceFile.path, bytes.toString('utf8'))
    sources.push({
      path: `source/${sourceFile.path}`,
      upstreamPath: sourceFile.path,
      upstreamUrl: `${SOURCE.repository}/blob/${SOURCE.commit}/${sourceFile.path}`,
      gitBlobSha: actualBlobSha,
      sha256: sha256(bytes),
      bytes: bytes.length,
    })
  }
  const data = normalizeStudy(
    parseCsv(texts.get('outputs/PAS_representation_by_BGC.csv')),
    parseCsv(texts.get('outputs/BGC_area.csv')),
    parseCsv(texts.get('outputs/BGC_area_by_park.csv')),
  )
  return { data, sources }
}
