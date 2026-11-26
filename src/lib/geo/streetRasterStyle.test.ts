import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = path.resolve(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('street basemap', () => {
  it("never reads OpenStreetMap's volunteer tile servers directly", () => {
    // They block apps outside their tile usage policy: every tile becomes an "Access blocked" image.
    const offenders = sourceFiles(src).filter((file) => /tile\.openstreetmap\.org/.test(readFileSync(file, 'utf8')))
    expect(offenders.map((file) => path.relative(src, file))).toEqual([])
  })
})

describe('raster tiles', () => {
  it("never reads CARTO's key-gated raster tiles", () => {
    // basemaps.cartocdn.com/{light_all,dark_all,rastertiles/…} answer with an "API KEY REQUIRED" watermark.
    const offenders = sourceFiles(src).filter((file) =>
      /basemaps\.cartocdn\.com\/(light_all|dark_all|rastertiles)\//.test(readFileSync(file, 'utf8')),
    )
    expect(offenders.map((file) => path.relative(src, file))).toEqual([])
  })
})
