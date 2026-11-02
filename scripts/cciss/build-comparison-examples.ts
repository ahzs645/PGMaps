import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { fromArrayBuffer } from 'geotiff'
import { sampleCcissRaster } from '../../src/pages/cciss/raster.ts'
import {
  compareLegacyPoint,
  LEGACY_LIMITATION,
  type LegacyComparisonReport,
  type LegacyPointSample,
} from '../../src/pages/cciss/legacyComparison.ts'
import {
  legacySpecies,
  regionalOutlook,
  ratingLabel,
  type LegacyManifest,
  type LegacyReference,
  type LegacyRegion,
  type LegacyRaster,
} from '../../src/pages/cciss/legacyAnalysis.ts'
import { legacyComparisonSnapshot } from '../../src/pages/cciss/legacyComparisonAdapter.ts'
import { compareSnapshots, parseComparisonSnapshot, type ComparisonSnapshot } from '../../src/pages/cciss/comparison.ts'
import { comparisonHtml, comparisonJson, type ComparisonReport } from '../../src/pages/cciss/comparisonExport.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { values } = parseArgs({ options: { output: { type: 'string' } } })
const output = resolve(values.output ?? resolve(root, 'tmp/cciss-comparison-examples'))
const source = resolve(root, 'vendor/bcdatamapper/datascrapers/bc/cciss/output/legacy-analysis') + sep
if (output === root || source.startsWith(output + sep) || output.startsWith(source))
  throw new Error('Choose an output folder outside the source dataset and repository root.')
const manifest: LegacyManifest = JSON.parse(readFileSync(source + 'manifest.json', 'utf8'))
const reference: LegacyReference = JSON.parse(gunzipSync(readFileSync(source + manifest.reference.file)).toString())
const region: LegacyRegion = JSON.parse(gunzipSync(readFileSync(source + 'BC.json.gz')).toString())
const roster = legacySpecies(reference, region, 'C4')
const locations = [
  { name: 'Prince George', longitude: -122.7497, latitude: 53.9171 },
  { name: 'Victoria', longitude: -123.37, latitude: 48.43 },
]
const samples: LegacyPointSample[][] = locations.map(() => [])
const checks: object[] = []
type GridRaster = LegacyRaster & { sha256: string; west: number; north: number; dx: number; dy: number }

async function main() {
  mkdirSync(output, { recursive: true })
  for (const definition of manifest.rasters) {
    const raster = definition as GridRaster
    const bytes = readFileSync(source + raster.file)
    const actualHash = createHash('sha256').update(bytes).digest('hex')
    if (actualHash !== raster.sha256) throw new Error('Source checksum mismatch: ' + raster.file)
    const tif = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const image = await tif.getImage()
    for (const [index, location] of locations.entries()) {
      const sample = await sampleCcissRaster(image, location.latitude, location.longitude)
      const column = Math.floor((location.longitude - raster.west) / raster.dx)
      const row = Math.floor((location.latitude - raster.north) / raster.dy)
      const raw = await image.readRasters({ samples: [0], window: [column, row, column + 1, row + 1] })
      const manualValue = (raw[0] as ArrayLike<number>)[0]
      if (sample.status !== 'value' || sample.value !== manualValue || sample.column !== column || sample.row !== row)
        throw new Error('Independent manifest-grid read disagrees: ' + raster.file + ' / ' + location.name)
      samples[index].push({ ...raster, sample })
      checks.push({
        location: location.name,
        model: raster.model,
        scenario: raster.scenario,
        run: raster.run,
        period: raster.period,
        file: raster.file,
        sha256: actualHash,
        row,
        column,
        rasterCode: manualValue,
      })
    }
    await tif.close()
  }
  const capturedAt = new Date().toISOString()
  const capture = (index: number, model: string, id: string) => {
    const location = locations[index]
    const comparison = compareLegacyPoint(reference, samples[index], 'C4', roster)
    const member = comparison.members.find((value) => value.model === model && value.scenario === 'ssp245')!
    const report: LegacyComparisonReport = {
      schema: 'cciss-legacy-comparison-v1',
      method: LEGACY_LIMITATION,
      source: 'Province of British Columbia · CCISS_ShinyApp/Development/OLD/spatial_app',
      dataset: manifest.schema,
      provenance: manifest,
      longitude: location.longitude,
      latitude: location.latitude,
      edatope: 'C4',
      comparison,
      regional: {
        region: 'BC',
        species: 'Pl',
        model,
        scenario: member.scenario,
        run: member.run,
        trends: regionalOutlook(region, 'C4', 'Pl', model, {
          scenario: member.scenario,
          run: member.run,
          baselinePeriod: comparison.baseline?.period,
        }),
      },
    }
    return legacyComparisonSnapshot(report, {
      reference,
      member: member.key,
      id,
      label: `${location.name} · ${model} · ${member.run} · SSP2-4.5 · C4`,
      capturedAt,
    })
  }
  const pgAccess = capture(0, 'ACCESS-ESM1-5', 'example-pg-access-c4')
  const victoriaAccess = capture(1, 'ACCESS-ESM1-5', 'example-victoria-access-c4')
  const pgEcEarth = capture(0, 'EC-Earth3', 'example-pg-ec-earth3-c4')
  const escape = (value: unknown) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  const summary = (snapshot: ComparisonSnapshot) =>
    ['baseline', 'modelled'].map((stage) => {
      const period = stage === 'baseline' ? '1961_1990' : '2061_2080'
      const metric = (measure: string, entity: string) =>
        snapshot.metrics.find(
          (value) =>
            value.measure === measure &&
            value.entity === entity &&
            value.period === period &&
            value.dimensions.stage === stage,
        )
      return {
        label: snapshot.label,
        stage,
        period,
        bgc: metric('bgc', 'site')?.value ?? null,
        siteSeries: metric('site-series', 'site')?.value ?? null,
        species: Object.fromEntries(
          ['Pl', 'Fd', 'Cw'].map((species) => [
            species,
            {
              code: metric('species-suitability', species)?.value ?? null,
              rating: ratingLabel((metric('species-suitability', species)?.value as number | null) ?? null),
            },
          ]),
        ),
      }
    })
  const summaryTable = (left: ComparisonSnapshot, right: ComparisonSnapshot) => {
    const rows = [...summary(left), ...summary(right)]
    return (
      '<table><thead><tr><th>Saved result</th><th>Basis</th><th>Period</th><th>BGC</th><th>Site series</th><th>Pl · lodgepole pine</th><th>Fd · Douglas-fir</th><th>Cw · western redcedar</th></tr></thead><tbody>' +
      rows
        .map(
          (row) =>
            '<tr>' +
            [
              row.label,
              row.stage,
              row.period,
              row.bgc ?? 'No data',
              row.siteSeries ?? 'No data',
              row.species.Pl.rating,
              row.species.Fd.rating,
              row.species.Cw.rating,
            ]
              .map((value) => `<td>${escape(value)}</td>`)
              .join('') +
            '</tr>',
        )
        .join('') +
      '</tbody></table>'
    )
  }
  const notes = [
    LEGACY_LIMITATION,
    'These exploratory examples read the prepared numeric GeoTIFFs and their versioned lookup package. Raster-derived BGC labels remain provisional because the bundled original codebook disagreed with accompanying summaries.',
    'All rows and exact saved snapshots are included below and in the companion importable JSON. Unknown values stay unknown. Unclassified source codes are retained separately without assigning an ordinal meaning.',
    'Both snapshots select the same BC regional summary for Pl. Those regional ratios and grid-cell counts describe the whole selected region, independently of either point; they are not local point probabilities or hectares.',
  ]
  const pairs = [
    {
      slug: 'pg-victoria-c4-access',
      title: 'Prince George versus Victoria',
      left: pgAccess,
      right: victoriaAccess,
      note: 'Location comparison: ACCESS-ESM1-5 / r1i1p1f1, SSP2-4.5 and C4 are held fixed; only the sampled location changes.',
    },
    {
      slug: 'pg-access-ec-earth3-c4',
      title: 'ACCESS versus EC-Earth3 at Prince George',
      left: pgAccess,
      right: pgEcEarth,
      note: 'Model comparison: the Prince George coordinates, SSP2-4.5 and C4 are held fixed. The available actual members are ACCESS-ESM1-5 / r1i1p1f1 and EC-Earth3 / r4i1p1f1. No scenario or site-condition change is mixed into this comparison.',
    },
  ]
  const summaries: object[] = []
  for (const pair of pairs) {
    const report: ComparisonReport = {
      schema: 'cciss-comparison-report-v1',
      generatedAt: capturedAt,
      intent: 'explore',
      left: pair.left,
      right: pair.right,
      comparison: compareSnapshots(pair.left, pair.right),
      notes: [
        ...new Set([
          ...notes,
          pair.note,
          ...(pair.left.provenance.limitations ?? []),
          ...(pair.right.provenance.limitations ?? []),
        ]),
      ],
    }
    const json = comparisonJson(report)
    const roundTrip = JSON.parse(json)
    parseComparisonSnapshot(roundTrip.left)
    parseComparisonSnapshot(roundTrip.right)
    writeFileSync(`${output}/${pair.slug}.json`, json)
    let html = comparisonHtml(report).replace(
      '<h1>CCISS comparison</h1>',
      `<h1>${escape(pair.title)}</h1><h2>Selected species and periods</h2><p>${escape(pair.note)}</p>${summaryTable(pair.left, pair.right)}<p>The complete ${report.comparison.rows.length}-row comparison follows; full provenance can be expanded or read in the companion JSON.</p>`,
    )
    html = html
      .replaceAll('<pre>', '<details><summary>Full source metadata and saved settings</summary><pre>')
      .replaceAll('</pre>', '</pre></details>')
    html = html.replace('@media print{body', '@media print{details:not([open]) pre{display:none}body')
    writeFileSync(`${output}/${pair.slug}.html`, html)
    summaries.push({
      slug: pair.slug,
      title: pair.title,
      controls: pair.note,
      left: summary(pair.left),
      right: summary(pair.right),
      allRows: report.comparison.rows.length,
      comparedNumericMetrics: report.comparison.comparedCount,
      jsonBytes: statSync(`${output}/${pair.slug}.json`).size,
      htmlBytes: statSync(`${output}/${pair.slug}.html`).size,
    })
  }
  const earlierRating = (snapshot: ComparisonSnapshot, species: string) =>
    (snapshot.metrics.find(
      (metric) =>
        metric.measure === 'species-suitability' &&
        metric.entity === species &&
        metric.period === '2041_2060' &&
        metric.dimensions.stage === 'modelled',
    )?.value as number | null) ?? null
  const modelFinding = `At Prince George in 2041–2060, holding C4 and SSP2-4.5 fixed, lodgepole pine is ${ratingLabel(earlierRating(pgAccess, 'Pl'))} in ACCESS-ESM1-5 and ${ratingLabel(earlierRating(pgEcEarth, 'Pl'))} in EC-Earth3. Western redcedar is ${ratingLabel(earlierRating(pgAccess, 'Cw'))} versus ${ratingLabel(earlierRating(pgEcEarth, 'Cw'))}. By 2061–2080 these selected model members agree on the shown BGC and all three selected species ratings.`
  const summaryOutput = {
    generatedAt: capturedAt,
    limitation: LEGACY_LIMITATION,
    modelFinding,
    verification: {
      method:
        'SHA-256 checked each source TIFF; independent manifest-grid row/column and direct raster read checked against the application sampler for both real coordinates.',
      rasters: manifest.rasters.length,
      pointSamples: checks.length,
    },
    comparisons: summaries,
  }
  writeFileSync(`${output}/summary.json`, JSON.stringify(summaryOutput, null, 2))
  writeFileSync(`${output}/numeric-verification.json`, JSON.stringify(checks, null, 2))
  const overview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCISS comparison examples</title><style>body{font:15px system-ui,sans-serif;max-width:1200px;margin:30px auto;padding:0 20px;line-height:1.5}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #bbc7bf;padding:8px;text-align:left;vertical-align:top}th{background:#edf3ee}.note{padding:15px;background:#fff6df;border:1px solid #cead62}h2{margin-top:36px}@media print{tr{break-inside:avoid}}</style></head><body><h1>CCISS comparison examples</h1><p>Generated ${escape(capturedAt)} from real prepared numeric data. Pl = lodgepole pine; Fd = Douglas-fir; Cw = western redcedar.</p><div class="note"><strong>Provisional legacy analysis</strong><p>${escape(LEGACY_LIMITATION)}</p><p>These are individual model/run results on the legacy 0.025-degree grid, not full current CCISS assessments or validated planting prescriptions. No Shiny service was executed for these examples.</p></div>${pairs.map((pair) => `<h2>${escape(pair.title)}</h2><p>${escape(pair.note)}</p>${summaryTable(pair.left, pair.right)}${pair.slug === 'pg-access-ec-earth3-c4' ? `<p><strong>Where the models differ:</strong> ${escape(modelFinding)}</p>` : ''}<p><a href="${pair.slug}.html">Printable report with all rows</a> · <a href="${pair.slug}.json">Native comparison JSON</a></p>`).join('')}<p>Verification: SHA-256 source checks and 64 direct numeric reads agree with the application sampler. This verifies extraction and source identity, not independent ecological validity. Full checksum and cell receipts are in numeric-verification.json.</p></body></html>`
  writeFileSync(`${output}/client-review.html`, overview)
  writeFileSync(
    `${output}/README.md`,
    '# CCISS client comparison examples\n\nOpen `client-review.html` for the selected baseline / 2061–2080 summary. Each pair also has an importable native comparison JSON and printable HTML containing every aligned row. Metadata is collapsed in HTML to keep printing readable.\n\nThese are provisional legacy numeric results. No R/Shiny engine was run and no current-model scientific parity is claimed. The original BGC codebook mismatch remains a material limit. Full source provenance and unknown values are retained.\n\nRegenerate from this workspace:\n\n```sh\nnpx tsx scripts/cciss/build-comparison-examples.ts\n```\n\n`numeric-verification.json` records each original raster checksum, exact cell and raw BGC code for the two coordinates. The independent check uses the manifest grid and a direct TIFF read; it shares the GeoTIFF decoder with the app and is not an independent ecological validation.\n',
  )
  console.log(JSON.stringify(summaryOutput, null, 2))
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
