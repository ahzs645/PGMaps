import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APPROXIMATE_VALUE_LIMIT,
  approximateBytes,
  cataloguedNames,
  INTERNAL_CACHES,
  STORE_CATALOGUE,
  uncatalogued,
  usageShare,
} from './siteStorage'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

function sourceFiles(folder: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(folder, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (/\.(ts|tsx|js)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) found.push(path)
  }
  return found
}

/** A name on the same line as the call that opens it, or a constant such a call is given. */
const OPENS = [
  /caches\.open\(\s*['"`]([^'"`$]+)['"`]/g,
  /indexedDB\.open\(\s*['"`]([^'"`$]+)['"`]/g,
  /createTerrainTileStore\(\s*['"`]([^'"`$]+)['"`]/g,
  /super\(\s*['"`]([^'"`$]+)['"`]\s*\)/g,
  /(?:DATABASE|DB_NAME|[A-Z_]*_DATABASE|[A-Z_]*CACHE|[A-Z_]*_STORAGE_NAME)\s*=\s*['"`]((?:pgmaps|geo-toolkit)[^'"`$]+)['"`]/g,
]

describe('the catalogue of what is kept', () => {
  it('lists every cache and database the source opens', () => {
    const opened = new Map<string, string>()
    const files = [
      ...sourceFiles(join(ROOT, 'src')),
      ...sourceFiles(join(ROOT, 'packages/geo-toolkit/src')),
      join(ROOT, 'public/sw.js'),
    ]
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of OPENS) {
        for (const match of text.matchAll(pattern)) {
          // `super('…')` is any subclass; only a Dexie database's name starts this way.
          if (pattern.source.startsWith('super') && !/^pgmaps[.-]/.test(match[1])) continue
          opened.set(match[1], file.slice(ROOT.length))
        }
      }
    }
    // The scan itself must be finding the stores, or a pass would mean nothing.
    expect(opened.size).toBeGreaterThanOrEqual(12)
    const known = cataloguedNames()
    const missing = [...opened].filter(([name]) => !known.caches.has(name) && !known.databases.has(name))
    expect(
      missing,
      'Add each to STORE_CATALOGUE in src/lib/storage/siteStorage.ts so the storage dialog can show and clear it.',
    ).toEqual([])
  })

  it('gives every entry something to measure and says what clearing or managing it means', () => {
    for (const entry of STORE_CATALOGUE) {
      expect((entry.caches?.length ?? 0) + (entry.databases?.length ?? 0), entry.id).toBeGreaterThan(0)
      expect(entry.note.length, entry.id).toBeGreaterThan(10)
    }
    expect(new Set(STORE_CATALOGUE.map((entry) => entry.id)).size).toBe(STORE_CATALOGUE.length)
  })

  it('never offers to clear a whole database that also holds work', () => {
    const work = new Map<string, Set<string> | null>()
    for (const entry of STORE_CATALOGUE.filter((item) => item.role === 'work')) {
      for (const database of entry.databases ?? []) {
        work.set(database.name, database.stores ? new Set(database.stores) : null)
      }
    }
    for (const entry of STORE_CATALOGUE.filter((item) => item.role === 'download')) {
      for (const database of entry.databases ?? []) {
        if (!work.has(database.name)) continue
        const workStores = work.get(database.name)
        // Sharing a database with work is allowed only store by store, with no store in both.
        expect(database.stores, `${entry.id} shares ${database.name} with work`).toBeDefined()
        expect(workStores, `${database.name} must name its work stores`).not.toBeNull()
        for (const store of database.stores!) expect(workStores!.has(store), `${entry.id}:${store}`).toBe(false)
      }
    }
  })

  it('reports what the browser holds that it does not list', () => {
    expect(
      uncatalogued({
        caches: ['pgmaps-shell-v3', ...INTERNAL_CACHES, 'transformers-cache', 'pgmaps-shell-v2'],
        databases: ['pgmaps-forestry-roads-v1', 'keyval-store'],
      }),
    ).toEqual({ caches: ['pgmaps-shell-v2', 'transformers-cache'], databases: ['keyval-store'] })
  })
})

describe('approximateBytes', () => {
  it('takes binary data and long grids by their length', () => {
    expect(approximateBytes(new Float32Array(1000))).toBe(4000)
    expect(approximateBytes(new ArrayBuffer(123))).toBe(123)
    expect(approximateBytes(new Blob([new Uint8Array(77)]))).toBe(77)
    expect(approximateBytes(Array.from({ length: 5000 }, (_, i) => i))).toBe(40_000)
  })

  it('adds up a record: keys, text, numbers and what it nests', () => {
    const record = { name: 'Road A', length: 1429, raster: { width: 2, data: new Float32Array(4) } }
    expect(approximateBytes(record)).toBe(
      'name'.length * 2 +
        'Road A'.length * 2 +
        'length'.length * 2 +
        8 +
        'raster'.length * 2 +
        'width'.length * 2 +
        8 +
        'data'.length * 2 +
        16,
    )
  })

  it('counts a value referenced twice once, and stops at its limit', () => {
    const shared = { grid: new Float64Array(10) }
    expect(approximateBytes([shared, shared])).toBe('grid'.length * 2 + 80)
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(approximateBytes(loop)).toBe('self'.length * 2)
    const many = Array.from({ length: 50 }, (_, i) => ({ i }))
    expect(approximateBytes(many, 10)).toBeLessThan(approximateBytes(many))
    expect(APPROXIMATE_VALUE_LIMIT).toBeGreaterThan(10_000)
  })

  it('counts nothing for what holds nothing', () => {
    expect(approximateBytes(null)).toBe(0)
    expect(approximateBytes(undefined)).toBe(0)
    expect(approximateBytes(() => 1)).toBe(0)
  })
})

describe('usageShare', () => {
  it('is the used share of the allowance, or null when the browser does not say', () => {
    expect(usageShare(25, 100)).toBe(0.25)
    expect(usageShare(150, 100)).toBe(1)
    expect(usageShare(undefined, 100)).toBeNull()
    expect(usageShare(10, 0)).toBeNull()
    expect(usageShare(10, undefined)).toBeNull()
  })
})
