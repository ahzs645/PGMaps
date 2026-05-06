import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const DEFAULT_INPUT = 'public/data/canue/bc/annual'
const DEFAULT_OUTPUT = 'public/data/canue/bc/annual-gzip'
const DEFAULT_MANIFEST = 'public/data/canue/bc/manifest.json'

const args = parseArgs(process.argv.slice(2))
const inputDir = path.resolve(args.input || DEFAULT_INPUT)
const outputDir = path.resolve(args.output || DEFAULT_OUTPUT)
const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST)
const level = Number(args.level || 9)

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

function prettyBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

async function gzipFile(fileName) {
  const source = path.join(inputDir, fileName)
  const output = path.join(outputDir, `${fileName}.gz`)
  await pipeline(createReadStream(source), createGzip({ level }), createWriteStream(output))
  const [sourceStats, outputStats] = await Promise.all([stat(source), stat(output)])
  return {
    fileName,
    sourceSize: sourceStats.size,
    gzipSize: outputStats.size,
    ratio: outputStats.size / sourceStats.size,
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const csvFiles = (await readdir(inputDir)).filter((file) => file.endsWith('.csv')).sort()
  if (csvFiles.length === 0) {
    throw new Error(`No CSV files found in ${inputDir}`)
  }

  const results = []
  for (const fileName of csvFiles) {
    const result = await gzipFile(fileName)
    results.push(result)
    console.log(
      `${fileName}: ${prettyBytes(result.sourceSize)} -> ${prettyBytes(result.gzipSize)} ` +
        `(${(result.ratio * 100).toFixed(1)}%)`,
    )
  }

  const sourceTotal = results.reduce((sum, row) => sum + row.sourceSize, 0)
  const gzipTotal = results.reduce((sum, row) => sum + row.gzipSize, 0)
  await writeGzipManifest(results, sourceTotal, gzipTotal)
  console.log(`CANUE gzip: ${prettyBytes(sourceTotal)} -> ${prettyBytes(gzipTotal)} (${(gzipTotal / sourceTotal * 100).toFixed(1)}%)`)
  console.log(`Output: ${outputDir}`)
}

async function writeGzipManifest(results, sourceTotal, gzipTotal) {
  let sourceManifest = null
  try {
    sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    sourceManifest = null
  }

  const sourceFileByName = new Map(
    (sourceManifest?.files || []).map((file) => [path.basename(file.output || ''), file]),
  )
  const publicOutputBase = `/${path.relative(path.resolve('public'), outputDir).split(path.sep).join('/')}`
  const files = results.map((result) => {
    const sourceFile = sourceFileByName.get(result.fileName)
    return {
      ...(sourceFile || {}),
      output: `${publicOutputBase}/${result.fileName}.gz`,
      compression: 'gzip',
      sourceCsv: sourceFile?.output || `/data/canue/bc/annual/${result.fileName}`,
      sourceSize: result.sourceSize,
      gzipSize: result.gzipSize,
      compressionRatio: Number(result.ratio.toFixed(4)),
    }
  })
  const outputBySource = new Map(files.map((file) => [file.sourceCsv, file.output]))
  const datasets = (sourceManifest?.datasets || []).map((dataset) => ({
    ...dataset,
    files: (dataset.files || []).map((file) => outputBySource.get(file) || file),
  }))

  const manifest = {
    ...(sourceManifest || {}),
    generatedAt: new Date().toISOString(),
    datasets,
    compression: {
      format: 'gzip',
      level,
      sourceBytes: sourceTotal,
      gzipBytes: gzipTotal,
      compressionRatio: Number((gzipTotal / sourceTotal).toFixed(4)),
    },
    files,
  }
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
