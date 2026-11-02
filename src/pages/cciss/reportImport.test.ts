import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { openReportArchive, readReportCsv, REPORT_IMPORT_LIMITS } from './reportImport'
import { parseShinyReport } from './shinyReport'

const encode = (text: string) => new TextEncoder().encode(text)
const csv = 'SiteRef,SS_NoSpace,Spp,Curr,1_2021,2_2021,3_2021,X_2021\nA,SBSmh/01,Pl,2,1,0,0,0'
async function zipFiles(files: Record<string, string>) {
  const zip = new JSZip()
  for (const [path, text] of Object.entries(files)) zip.file(path, text)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('Shiny CSV and ZIP import', () => {
  it('loads a nested Shiny export without reading auxiliary CSVs or RDS files', async () => {
    const archive = await openReportArchive(
      'download.zip',
      await zipFiles({
        'report/cciss_export.csv': csv,
        'report/model_parameters.csv': 'parameter,value\nscenario,SSP245',
        'report/state.rds': 'not parsed',
      }),
    )
    expect(archive.preferred).toBe('report/cciss_export.csv')
    expect(archive.entries).toEqual(['report/cciss_export.csv', 'report/model_parameters.csv'])
    expect(parseShinyReport(await archive.read(archive.preferred!)).rows[0].site).toBe('A')
    await expect(archive.read('report/state.rds')).rejects.toThrow('Choose a CSV')
  })
  it('requires an explicit choice for ambiguous results and preserves duplicate basenames in different folders', async () => {
    const archive = await openReportArchive(
      'two-sites.zip',
      await zipFiles({
        'one/cciss_export.csv': csv,
        'two/cciss_export.csv': csv.replace('A,SBS', 'B,SBS'),
      }),
    )
    expect(archive.preferred).toBeNull()
    expect(archive.entries).toHaveLength(2)
    expect(parseShinyReport(await archive.read('two/cciss_export.csv')).rows[0].site).toBe('B')
  })
  it('retains the authentic historical example and its original periods inside a ZIP', async () => {
    const real = gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/bc/cciss/output/report-examples/williams-lake-raw.csv.gz'),
    ).toString()
    const archive = await openReportArchive('example.zip', await zipFiles({ 'published.csv': real }))
    expect(archive.preferred).toBe('published.csv')
    const report = parseShinyReport(await archive.read('published.csv'))
    expect(report.periods).toEqual(['1975', '2000', '2025', '2055', '2085'])
    expect(report.rows.some((row) => row.site === '4812311' && row.species === 'Ac')).toBe(true)
  })
  it('rejects oversized, malformed, unsupported and duplicate-path archives', async () => {
    await expect(openReportArchive('huge.zip', new Uint8Array(REPORT_IMPORT_LIMITS.zipBytes + 1))).rejects.toThrow(
      '20 MB',
    )
    await expect(openReportArchive('bad.zip', encode('not a zip'))).rejects.toThrow('corrupt')
    await expect(openReportArchive('rds.zip', await zipFiles({ 'result.rds': 'data' }))).rejects.toThrow('No CSV')
    const oversized = await openReportArchive(
      'large-csv.zip',
      await zipFiles({ 'result.csv': 'x'.repeat(REPORT_IMPORT_LIMITS.csvBytes + 1) }),
    )
    await expect(oversized.read('result.csv')).rejects.toThrow('5 MB')
    const duplicate = await zipFiles({ 'x.csv': csv, 'y.csv': csv })
    for (let i = 0; i < duplicate.length - 5; i++) {
      if (
        duplicate[i] === 121 &&
        duplicate[i + 1] === 46 &&
        duplicate[i + 2] === 99 &&
        duplicate[i + 3] === 115 &&
        duplicate[i + 4] === 118
      )
        duplicate[i] = 120
    }
    await expect(openReportArchive('duplicate.zip', duplicate)).rejects.toThrow('duplicate file paths')
  })
  it('bounds actual decompression even when the directory advertises a smaller size', async () => {
    const bytes = await zipFiles({ 'report.csv': 'x'.repeat(REPORT_IMPORT_LIMITS.csvBytes + 100_000) })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i <= bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true)
    }
    const archive = await openReportArchive('lying-size.zip', bytes)
    await expect(archive.read('report.csv')).rejects.toThrow('5 MB')
  })
  it('reads UTF-8 CSVs directly and rejects invalid encodings or oversized text', () => {
    expect(readReportCsv(encode(csv))).toBe(csv)
    expect(() => readReportCsv(Uint8Array.of(255))).toThrow('UTF-8')
    expect(() => readReportCsv(new Uint8Array(REPORT_IMPORT_LIMITS.csvBytes + 1))).toThrow('5 MB')
  })
})
