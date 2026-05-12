import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_SOURCE =
  '/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/University/Research/Grad/Data/Canue/2026 pull'
const DEFAULT_PROCESSED_MANIFEST = 'public/data/canue/bc/annual-gzip/manifest.json'
const DEFAULT_METADATA =
  '/Users/ahmadjalil/github/canuechrome/canue_metadata/downloaded_datasets_metadata.json'

const args = parseArgs(process.argv.slice(2))
const sourceDir = path.resolve(args.source || process.env.PG_CANUE_SOURCE || DEFAULT_SOURCE)
const processedManifestPath = path.resolve(args['processed-manifest'] || DEFAULT_PROCESSED_MANIFEST)
const metadataPath = args.metadata === 'none'
  ? null
  : path.resolve(args.metadata || process.env.PG_CANUE_METADATA || DEFAULT_METADATA)
const outputPath = args.output ? path.resolve(args.output) : null

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
    } else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

function archiveDatasetId(fileName) {
  return path.basename(fileName, '.zip').replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(annual|monthly)$/i, '')
}

function archiveCadence(fileName) {
  const match = fileName.match(/_(annual|monthly)\.zip$/i)
  return match ? match[1].toLowerCase() : 'unknown'
}

function prettyBytes(bytes) {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

async function listZipFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const absolutePath = path.join(dir, entry.name)
    const relativePath = path.join(prefix, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listZipFiles(absolutePath, relativePath))
    } else if (entry.isFile() && entry.name.endsWith('.zip')) {
      const fileStats = await stat(absolutePath)
      files.push({
        path: absolutePath,
        relativePath: relativePath.split(path.sep).join('/'),
        fileName: entry.name,
        datasetId: archiveDatasetId(entry.name),
        cadence: archiveCadence(entry.name),
        sizeBytes: fileStats.size,
        isBadIncomplete: relativePath.split(path.sep).includes('_bad_incomplete_zips'),
      })
    }
  }
  return files
}

async function loadProcessedManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

async function loadMetadata(metadataFile) {
  if (!metadataFile) return []
  try {
    const data = JSON.parse(await readFile(metadataFile, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function metadataArchiveNames(row) {
  return String(row.manifest_files || '')
    .split(';')
    .map((entry) => path.basename(entry.trim()))
    .filter(Boolean)
}

function summarizeMetadata(rows) {
  const byArchiveName = new Map()
  for (const row of rows) {
    for (const archiveName of metadataArchiveNames(row)) {
      byArchiveName.set(archiveName, row)
    }
  }
  return byArchiveName
}

function compactMetadata(rows) {
  if (!rows.length) return null
  const unique = (field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))]
  return {
    categories: unique('category'),
    downloadNames: unique('download_name'),
    portalNames: unique('portal_name'),
    shortCodes: unique('short_code'),
    modes: unique('mode'),
    geographies: unique('download_geo'),
    yearCoverage: unique('download_year_coverage'),
    samplingFrequency: unique('sampling_frequency'),
    keywords: unique('keywords'),
    descriptions: unique('description'),
    sharingRestrictions: unique('sharing_restrictions'),
    citations: unique('citation'),
  }
}

function summarizeArchives(archives, processedManifest, metadataRows) {
  const metadataByArchiveName = summarizeMetadata(metadataRows)
  const byDataset = new Map()
  for (const archive of archives) {
    const existing = byDataset.get(archive.datasetId) || {
      datasetId: archive.datasetId,
      archiveCount: 0,
      annualArchives: 0,
      monthlyArchives: 0,
      unknownCadenceArchives: 0,
      badIncompleteArchives: 0,
      sizeBytes: 0,
      examples: [],
      archiveFileNames: [],
      metadataRows: [],
    }
    existing.archiveCount += 1
    existing.sizeBytes += archive.sizeBytes
    if (archive.cadence === 'annual') existing.annualArchives += 1
    else if (archive.cadence === 'monthly') existing.monthlyArchives += 1
    else existing.unknownCadenceArchives += 1
    if (archive.isBadIncomplete) existing.badIncompleteArchives += 1
    if (existing.examples.length < 3) existing.examples.push(archive.relativePath)
    existing.archiveFileNames.push(archive.fileName)
    const metadata = metadataByArchiveName.get(archive.fileName)
    if (metadata && !existing.metadataRows.includes(metadata)) existing.metadataRows.push(metadata)
    byDataset.set(archive.datasetId, existing)
  }

  const processedFiles = processedManifest?.files || []
  const processedByDataset = new Map()
  for (const file of processedFiles) {
    const datasetId = file.datasetId
    if (!datasetId) continue
    const existing = processedByDataset.get(datasetId) || {
      datasetId,
      fileCount: 0,
      rowCount: 0,
      gzipBytes: 0,
      sourceBytes: 0,
      years: new Set(),
      variables: new Set(),
    }
    existing.fileCount += 1
    existing.rowCount += Number(file.rowCount) || 0
    existing.gzipBytes += Number(file.gzipSize) || 0
    existing.sourceBytes += Number(file.sourceSize) || 0
    if (file.year) existing.years.add(file.year)
    for (const variable of file.variables || []) existing.variables.add(variable)
    processedByDataset.set(datasetId, existing)
  }

  return [...byDataset.values()]
    .map((entry) => {
      const processed = processedByDataset.get(entry.datasetId)
      return {
        ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'metadataRows')),
        size: prettyBytes(entry.sizeBytes),
        metadata: compactMetadata(entry.metadataRows),
        processedFileCount: processed?.fileCount || 0,
        processedRowCount: processed?.rowCount || 0,
        processedGzipBytes: processed?.gzipBytes || 0,
        processedGzipSize: prettyBytes(processed?.gzipBytes || 0),
        processedSourceSize: prettyBytes(processed?.sourceBytes || 0),
        processedYearCount: processed?.years.size || 0,
        processedYears: processed ? [...processed.years].sort((a, b) => a - b) : [],
        processedVariableCount: processed?.variables.size || 0,
        isProcessed: Boolean(processed),
      }
    })
    .sort((a, b) => a.datasetId.localeCompare(b.datasetId))
}

function printReport({ archives, datasetSummaries, processedManifest }) {
  const totalBytes = archives.reduce((sum, archive) => sum + archive.sizeBytes, 0)
  const badArchives = archives.filter((archive) => archive.isBadIncomplete)
  const processed = datasetSummaries.filter((entry) => entry.isProcessed)
  const unprocessed = datasetSummaries.filter((entry) => !entry.isProcessed && entry.badIncompleteArchives < entry.archiveCount)
  const cadenceCounts = archives.reduce((counts, archive) => {
    counts[archive.cadence] = (counts[archive.cadence] || 0) + 1
    return counts
  }, {})

  console.log(`CANUE source: ${sourceDir}`)
  console.log(`ZIP archives: ${archives.length} (${prettyBytes(totalBytes)} logical)`)
  console.log(`Cadence: ${Object.entries(cadenceCounts).map(([key, value]) => `${key} ${value}`).join(', ')}`)
  console.log(`Dataset IDs: ${datasetSummaries.length}`)
  console.log(`Processed in manifest: ${processed.length} dataset IDs, ${processedManifest?.files?.length || 0} files`)
  console.log(`Not processed: ${unprocessed.length} dataset IDs`)
  if (badArchives.length) console.log(`Bad/incomplete archives: ${badArchives.length}`)

  console.log('\nProcessed datasets:')
  for (const entry of processed) {
    console.log(
      `  ${entry.datasetId}: ${entry.processedFileCount} files, ${entry.processedYearCount} years, ` +
      `${entry.processedGzipSize} gzipped (${entry.archiveCount} source zips, ${entry.size})`,
    )
  }

  console.log('\nSource datasets not currently processed:')
  for (const entry of unprocessed) {
    console.log(
      `  ${entry.datasetId}: ${entry.archiveCount} zips, ${entry.size}, ` +
      `${entry.annualArchives} annual/${entry.monthlyArchives} monthly`,
    )
  }
}

async function main() {
  const [archives, processedManifest, metadataRows] = await Promise.all([
    listZipFiles(sourceDir),
    loadProcessedManifest(processedManifestPath),
    loadMetadata(metadataPath),
  ])
  const datasetSummaries = summarizeArchives(archives, processedManifest, metadataRows)
  const report = {
    generatedAt: new Date().toISOString(),
    sourceDir,
    processedManifestPath,
    metadataPath,
    metadataRecordCount: metadataRows.length,
    archiveCount: archives.length,
    archiveBytes: archives.reduce((sum, archive) => sum + archive.sizeBytes, 0),
    datasetCount: datasetSummaries.length,
    processedDatasetCount: datasetSummaries.filter((entry) => entry.isProcessed).length,
    unprocessedDatasetCount: datasetSummaries.filter((entry) => !entry.isProcessed && entry.badIncompleteArchives < entry.archiveCount).length,
    badIncompleteArchiveCount: archives.filter((archive) => archive.isBadIncomplete).length,
    datasets: datasetSummaries,
  }

  printReport({ archives, datasetSummaries, processedManifest })
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nWrote ${outputPath}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
