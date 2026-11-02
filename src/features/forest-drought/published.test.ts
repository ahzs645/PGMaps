import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PUBLISHED_CSV_HEADER,
  PUBLISHED_PERIODS,
  PUBLISHED_SOURCE,
  RISK_LEVELS,
  SOIL_MOISTURE_REGIMES,
  TREE_SPECIES,
  exportPublishedCsv,
  filterPublishedRows,
  parsePublishedCsv,
  publishedSeries,
  resolvePublishedBgc,
} from './published'

const dataDirectory = new URL('../../../public/data/forest-drought/', import.meta.url)
const bytes = readFileSync(new URL('fordrat.csv', dataDirectory))
const source = bytes.toString('utf8')
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dataDirectory), 'utf8'))
const dataset = parsePublishedCsv(source)

function replaceFirstRowCell(column: number, value: string): string {
  const lines = source.split('\n')
  const cells = lines[1].split(',')
  cells[column] = value
  lines[1] = cells.join(',')
  return lines.join('\n')
}

describe('published BC forDRAT source contract', () => {
  it('retains the exact upstream bytes and keeps the manifest in sync', () => {
    expect(bytes.byteLength).toBe(PUBLISHED_SOURCE.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PUBLISHED_SOURCE.sha256)
    expect(createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')).toBe(
      PUBLISHED_SOURCE.gitBlobSha,
    )
    expect(manifest.source).toMatchObject({
      commit: PUBLISHED_SOURCE.commit,
      bytes: PUBLISHED_SOURCE.bytes,
      sha256: PUBLISHED_SOURCE.sha256,
      gitBlobSha: PUBLISHED_SOURCE.gitBlobSha,
    })
    expect(manifest.periods).toEqual(PUBLISHED_PERIODS.map(({ id, kind, years }) => ({ id, kind, years })))
    expect(manifest.soilMoistureRegimes).toEqual(
      SOIL_MOISTURE_REGIMES.map(({ id, label }) => ({ id, label: label.toLowerCase() })),
    )
    expect(manifest.species).toEqual(TREE_SPECIES)
    expect(Object.keys(manifest.riskCodes)).toEqual(RISK_LEVELS.map(({ code }) => code))
    expect(manifest.model.becVersion).toBe(PUBLISHED_SOURCE.becVersion)
    expect(manifest.model.reproducedByLegacyCalculator).toBe(false)
  })

  it('validates all 204 × 6 × 5 combinations, without interpreting ratings as occurrence', () => {
    expect(dataset.rows).toHaveLength(6120)
    expect(dataset.bgcUnits).toHaveLength(204)
    expect(new Set(dataset.rows.map(({ bgc, period, smr }) => `${bgc}|${period}|${smr}`)).size).toBe(6120)
    expect(dataset.rows.every(({ risks }) => Object.keys(risks).length === 10)).toBe(true)
    expect(Math.min(...dataset.rows.map(({ aetPet }) => aetPet))).toBe(0.451720941)
    expect(Math.max(...dataset.rows.map(({ aetPet }) => aetPet))).toBe(1)
    expect(PUBLISHED_SOURCE.occurrenceNote).toContain('outside its natural range')
    expect(PUBLISHED_PERIODS.find(({ id }) => id === '2020')).toMatchObject({
      kind: 'projection',
      years: [2011, 2040],
    })
  })

  it('pins Prince George-area source values and categorical changes across all periods', () => {
    const series = publishedSeries(dataset, 'SBSmk1', 1)
    expect(series.map(({ period }) => period)).toEqual(PUBLISHED_PERIODS.map(({ id }) => id))
    expect(series.map(({ aetPet }) => aetPet)).toEqual([
      0.900684489, 0.893297542, 0.884785327, 0.847155466, 0.821917801, 0.802222625,
    ])
    expect(series.map(({ risks }) => risks.Bl)).toEqual(['M', 'M', 'M', 'H', 'VH', 'VH'])
    expect(series.map(({ risks }) => risks.Pl)).toEqual(['L', 'L', 'L', 'L', 'L', 'M'])
    expect(publishedSeries(dataset, 'SBSmk1', 5).every(({ aetPet }) => aetPet === 1)).toBe(true)
  })

  it('matches exact BGC variants without conflating other BEC vintages or suffixes', () => {
    expect(resolvePublishedBgc(' SBSmk1 ', dataset.bgcUnits)).toBe('SBSmk1')
    expect(resolvePublishedBgc('SBS mk1', dataset.bgcUnits)).toBeNull()
    expect(resolvePublishedBgc('sbsmk1', dataset.bgcUnits)).toBeNull()
    expect(resolvePublishedBgc('SBSmk', dataset.bgcUnits)).toBeNull()
    expect(resolvePublishedBgc('SBSwk3a', dataset.bgcUnits)).toBe('SBSwk3a')
    expect(resolvePublishedBgc('SBSwk3', dataset.bgcUnits)).toBe('SBSwk3')
    expect(filterPublishedRows(dataset, { bgc: 'SBSmk' })).toEqual([])
    expect(filterPublishedRows(dataset, { period: '1971-2000', smr: 4 })).toHaveLength(204)
    expect(filterPublishedRows(dataset, { bgc: 'SBSmk1', period: '2080', smr: 1 })).toHaveLength(1)
  })

  it('rejects duplicate combinations and truncated or schema-changed snapshots', () => {
    const lines = source.trimEnd().split('\n')
    expect(() => parsePublishedCsv([...lines, lines[1]].join('\n'))).toThrow(/duplicate/)
    expect(() => parsePublishedCsv(lines.slice(0, -1).join('\n'))).toThrow(/incomplete/)
    expect(() => parsePublishedCsv(source.replace('AET_PET', 'AET'))).toThrow(/header/)
    expect(() => parsePublishedCsv(source.replace(',L,L,L,L,L,L,L,L,L,L\n', ',L,L\n'))).toThrow(/15 unquoted/)
    expect(() => parsePublishedCsv('')).toThrow(/header/)
  })

  it.each(['', 'NaN', 'Infinity', '-0.1', '1.01', '0x1', ' 0.7'])('rejects invalid AET/PET %j', (value) => {
    expect(() => parsePublishedCsv(replaceFirstRowCell(4, value))).toThrow(/AET\/PET/)
  })

  it('rejects unknown periods, invalid species ratings and mismatched soil descriptions', () => {
    expect(() => parsePublishedCsv(replaceFirstRowCell(1, '2070'))).toThrow(/period/)
    expect(() => parsePublishedCsv(replaceFirstRowCell(5, 'NA'))).toThrow(/risk code/)
    expect(() => parsePublishedCsv(replaceFirstRowCell(2, 'xeric'))).toThrow(/code and label/)
    expect(() => parsePublishedCsv(replaceFirstRowCell(3, '04'))).toThrow(/integer/)
    expect(() => parsePublishedCsv(replaceFirstRowCell(0, '=HYPERLINK("x")'))).toThrow(/BGC/)
  })

  it('accepts transport line endings, orders series, and exports the original unrounded values', () => {
    expect(parsePublishedCsv(`\uFEFF${source.replace(/\n/g, '\r\n')}`).rows).toEqual(dataset.rows)
    expect(publishedSeries({ ...dataset, rows: [...dataset.rows].reverse() }, 'SBSmk1', 1)).toEqual(
      publishedSeries(dataset, 'SBSmk1', 1),
    )
    const exported = exportPublishedCsv(publishedSeries(dataset, 'SBSmk1', 1))
    expect(exported.split('\r\n')[0]).toBe(PUBLISHED_CSV_HEADER)
    expect(exported).toContain('SBSmk1,2080,xeric,1,0.802222625,M,H,L,VH,M,M,L,L,VH,M')
    expect(parsePublishedCsv(exportPublishedCsv(dataset.rows)).rows).toEqual(dataset.rows)
    expect(exportPublishedCsv([{ ...dataset.rows[0], bgc: '=1+1' }])).toContain("'=1+1,")
  })
})
