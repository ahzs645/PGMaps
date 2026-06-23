import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tileRangeForBounds, webMercatorTileBounds } from './geojson-tile-utils.mjs'

function isPng(buffer) {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
}

async function fileHasContent(filePath) {
  try {
    const info = await stat(filePath)
    return info.size > 0
  } catch {
    return false
  }
}

export async function writeWmsRasterTileSet({
  bounds,
  buildUrl,
  outputDir,
  minZoom,
  maxZoom,
  concurrency = 8,
  transparentTileMaxBytes = 400,
  clean = true,
  resume = false,
  retries = 2,
  manifest = {},
  progressEvery = 500,
  requestTimeoutMs = 30000,
}) {
  if (clean && !resume) {
    await rm(outputDir, { recursive: true, force: true })
  }

  const jobs = []
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const range = tileRangeForBounds(bounds, z)
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        jobs.push({ x, y, z })
      }
    }
  }

  let index = 0
  let completed = 0
  let tileCount = 0
  let bytes = 0
  let skippedTransparent = 0
  let failed = 0
  const failedTiles = []

  async function worker() {
    for (;;) {
      const job = jobs[index]
      index += 1
      if (!job) return

      const tilePath = path.join(outputDir, `${job.z}/${job.x}/${job.y}.png`)
      try {
        if (resume && await fileHasContent(tilePath)) {
          const info = await stat(tilePath)
          tileCount += 1
          bytes += info.size
          continue
        }

        const bbox = webMercatorTileBounds(job.z, job.x, job.y)
        let response = null
        let buffer = null
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
          try {
            response = await fetch(buildUrl({ bbox, x: job.x, y: job.y, z: job.z }), {
              signal: controller.signal,
            })
            buffer = Buffer.from(await response.arrayBuffer())
          } catch {
            response = null
            buffer = null
          } finally {
            clearTimeout(timeout)
          }
          if (response?.ok && buffer && isPng(buffer)) break
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
          }
        }
        if (!response?.ok || !buffer || !isPng(buffer)) {
          failed += 1
          failedTiles.push(job)
          continue
        }
        if (buffer.length <= transparentTileMaxBytes) {
          skippedTransparent += 1
          continue
        }

        await mkdir(path.dirname(tilePath), { recursive: true })
        await writeFile(tilePath, buffer)
        tileCount += 1
        bytes += buffer.length
      } catch {
        failed += 1
        failedTiles.push(job)
      } finally {
        completed += 1
        if (progressEvery > 0 && (completed % progressEvery === 0 || completed === jobs.length)) {
          console.log(
            `WMS raster tiles ${completed}/${jobs.length} checked ` +
              `(${tileCount} written, ${skippedTransparent} transparent, ${failed} failed)`,
          )
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  await mkdir(outputDir, { recursive: true })
  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      minZoom,
      maxZoom,
      candidateTileCount: jobs.length,
      tileCount,
      skippedTransparent,
      failed,
      failedTiles,
      bytes,
      ...manifest,
    }, null, 2),
  )

  return { candidateTileCount: jobs.length, failed, failedTiles, skippedTransparent, tileCount, bytes }
}
