// Node 22+ with --experimental-strip-types. Compare every cached PNG grid with
// independent source RGBA hashes from network-pixel-oracle.py.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { decodePngPixels } from '../src/lib/pngPixels.ts'
import { reconstructImageClassGrid, rasterGridCellRing } from '../src/lib/rasterClassGrid.ts'
import { networkGridPalette } from '../src/maps/pgdata/networkGridPalette.ts'

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const scriptPath = fileURLToPath(import.meta.url)
if (!isMainThread) {
  const { rows, cacheRoot, outputDir, workerIndex } = workerData
  const results = new Map(),
    failures = []
  const out = fs.createWriteStream(path.join(outputDir, `pixel-hashes-${workerIndex}.ndjson`))
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index],
      key = `${row.provider}/${row.layer}/${row.z}`
    const result = results.get(key) ?? {
      provider: row.provider,
      layer: row.layer,
      zoom: row.z,
      files: 0,
      pixels: 0,
      changedFiles: 0,
      sourceFileMismatches: 0,
      decodeErrors: 0,
      maxCoordinateErrorMetres: 0,
    }
    results.set(key, result)
    try {
      const filename = path.join(
        cacheRoot,
        row.provider,
        'output',
        'tiles',
        row.layer,
        String(row.z),
        String(row.x),
        `${row.y}.png`,
      )
      const png = fs.readFileSync(filename),
        { width, height, rgba } = decodePngPixels(png)
      const grid = reconstructImageClassGrid(rgba, width, height, networkGridPalette(row.provider, row.layer), {
        cellPixels: 1,
        preserveSourcePixels: true,
      })
      const converted = new Uint8Array(width * height * 4)
      for (const cell of grid.cells) converted.set(cell.rgba, (cell.row * width + cell.column) * 4)
      const convertedHash = sha(converted),
        sourceMatches = sha(png) === row.pngSha256
      const pixelsMatch = width === row.width && height === row.height && convertedHash === row.rgbaSha256
      result.files++
      result.pixels += width * height
      if (!sourceMatches) result.sourceFileMismatches++
      if (!pixelsMatch) result.changedFiles++
      if (!sourceMatches || !pixelsMatch) failures.push({ ...row, sourceMatches, pixelsMatch, convertedHash })
      // Independent projected XYZ position at a cell corner, at every source level.
      const ring = rasterGridCellRing({ row: 91, column: 157 }, grid, { x: row.x, y: row.y, z: row.z })
      const halfWorld = Math.PI * 6378137,
        n = 2 ** row.z
      const expectedX = ((row.x + 157 / width) / n) * 2 * halfWorld - halfWorld
      const expectedY = halfWorld - ((row.y + 91 / height) / n) * 2 * halfWorld
      const actualX = (ring[0][0] * halfWorld) / 180
      const actualY = Math.log(Math.tan(Math.PI / 4 + (ring[0][1] * Math.PI) / 360)) * 6378137
      result.maxCoordinateErrorMetres = Math.max(
        result.maxCoordinateErrorMetres,
        Math.abs(actualX - expectedX),
        Math.abs(actualY - expectedY),
      )
      out.write(
        JSON.stringify({
          provider: row.provider,
          layer: row.layer,
          z: row.z,
          x: row.x,
          y: row.y,
          convertedRgbaSha256: convertedHash,
          sourceMatches,
          pixelsMatch,
        }) + '\n',
      )
    } catch (error) {
      result.decodeErrors++
      failures.push({ ...row, error: String(error) })
    }
    if ((index + 1) % 1000 === 0) parentPort.postMessage({ progress: index + 1, workerIndex })
  }
  out.end(() => parentPort.postMessage({ done: true, results: [...results.values()], failures, workerIndex }))
} else {
  const args = process.argv.slice(2),
    value = (name) => args[args.indexOf(name) + 1]
  if (!args.includes('--oracles') || !args.includes('--output'))
    throw new Error(
      'Usage: node --experimental-strip-types scripts/audit-network-pixels.mjs --oracles DIR --output DIR [--cache-root DIR] [--workers 4]',
    )
  const oracleDir = path.resolve(value('--oracles')),
    outputDir = path.resolve(value('--output'))
  const cacheRoot = path.resolve(
    args.includes('--cache-root') ? value('--cache-root') : 'vendor/bcdatamapper/datascrapers/network',
  )
  const count = args.includes('--workers') ? Number(value('--workers')) : 4
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Expected 1–8 workers')
  fs.mkdirSync(outputDir, { recursive: true })
  const rows = ['bell', 'rogers'].flatMap((provider) =>
    fs
      .readFileSync(path.join(oracleDir, `${provider}-oracle.ndjson`), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  )
  const start = Date.now(),
    progress = new Array(count).fill(0)
  const workers = await Promise.all(
    Array.from(
      { length: count },
      (_, workerIndex) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(scriptPath, {
            workerData: { rows: rows.filter((_, i) => i % count === workerIndex), cacheRoot, outputDir, workerIndex },
          })
          worker.on('message', (message) => {
            if (message.done) resolve(message)
            else {
              progress[workerIndex] = message.progress
              if (workerIndex === 0)
                console.log(
                  `${progress.reduce((a, b) => a + b, 0)}/${rows.length} tiles checked; ${Math.round((Date.now() - start) / 1000)}s`,
                )
            }
          })
          worker.on('error', reject)
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Audit worker exited ${code}`))
          })
        }),
    ),
  )
  const levels = new Map()
  for (const worker of workers)
    for (const row of worker.results) {
      const key = `${row.provider}/${row.layer}/${row.zoom}`,
        total = levels.get(key) ?? {
          ...row,
          files: 0,
          pixels: 0,
          changedFiles: 0,
          sourceFileMismatches: 0,
          decodeErrors: 0,
          maxCoordinateErrorMetres: 0,
        }
      for (const field of ['files', 'pixels', 'changedFiles', 'sourceFileMismatches', 'decodeErrors'])
        total[field] += row[field]
      total.maxCoordinateErrorMetres = Math.max(total.maxCoordinateErrorMetres, row.maxCoordinateErrorMetres)
      levels.set(key, total)
    }
  const report = {
    generatedAt: new Date().toISOString(),
    scope:
      'Every saved Bell/Rogers PNG, every saved level, compared against independently Pillow-decoded source archive RGBA SHA-256 hashes.',
    expectedFiles: rows.length,
    files: 0,
    pixels: 0,
    changedFiles: 0,
    sourceFileMismatches: 0,
    decodeErrors: 0,
    durationSeconds: (Date.now() - start) / 1000,
    levels: [...levels.values()].sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.layer.localeCompare(b.layer) || a.zoom - b.zoom,
    ),
    failures: workers.flatMap((w) => w.failures),
  }
  for (const row of report.levels)
    for (const field of ['files', 'pixels', 'changedFiles', 'sourceFileMismatches', 'decodeErrors'])
      report[field] += row[field]
  fs.writeFileSync(path.join(outputDir, 'pixel-comparison.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, levels: report.levels.length, failures: report.failures.length }, null, 2))
  if (
    report.files !== report.expectedFiles ||
    report.changedFiles ||
    report.sourceFileMismatches ||
    report.decodeErrors
  )
    process.exitCode = 1
}
