import { describe, expect, it } from 'vitest'
import { buildId, buildPrecacheManifest, referencedFiles, type BuiltFile } from './precacheManifest'

const file = (fileName: string, bytes: number, staticRefs: string[] = [], lazyRefs: string[] = []): BuiltFile => ({
  fileName,
  bytes,
  // As the build names them: a chunk is a capitalised page or a plain .js that is not a worker.
  chunk: fileName.endsWith('.js') && !fileName.includes('.worker-'),
  staticRefs,
  lazyRefs,
})

/** A small site: a shell that lazily loads two pages, one of them the tool kept offline. */
const BUNDLE: BuiltFile[] = [
  file(
    'assets/app-aaaa.js',
    100,
    ['assets/react-bbbb.js', 'assets/app-cccc.css'],
    ['assets/Tool-dddd.js', 'assets/Other-eeee.js', 'assets/loader.worker-oooo.js', 'assets/huge-pppp.wasm'],
  ),
  file('assets/loader.worker-oooo.js', 10),
  file('assets/huge-pppp.wasm', 9000),
  file('assets/react-bbbb.js', 50),
  file('assets/app-cccc.css', 20, ['assets/font-ffff.woff2']),
  file('assets/font-ffff.woff2', 30),
  file(
    'assets/Tool-dddd.js',
    400,
    ['assets/react-bbbb.js', 'assets/map-gggg.js'],
    ['assets/dialog-hhhh.js', 'assets/tool.worker-iiii.js'],
  ),
  file('assets/map-gggg.js', 300, [], ['assets/map-worker-jjjj.mjs']),
  file('assets/map-worker-jjjj.mjs', 90),
  file('assets/dialog-hhhh.js', 60, ['assets/app-aaaa.js'], ['assets/big-kkkk.wasm']),
  file('assets/tool.worker-iiii.js', 70, [], ['assets/small-llll.wasm']),
  file('assets/small-llll.wasm', 80),
  file('assets/big-kkkk.wasm', 5000),
  file('assets/Other-eeee.js', 999, [], ['assets/other-data-mmmm.json']),
  file('assets/other-data-mmmm.json', 999),
]

const OPTIONS = {
  entries: ['assets/app-aaaa.js'],
  groups: [{ id: 'tool', roots: /^Tool-/ }],
  maxFileBytes: 1000,
}

describe('buildPrecacheManifest', () => {
  const manifest = buildPrecacheManifest(BUNDLE, OPTIONS)

  it('takes the shell from static references, with the workers a shell file starts later', () => {
    expect(manifest.shell).toEqual([
      'assets/app-aaaa.js',
      'assets/app-cccc.css',
      'assets/font-ffff.woff2',
      // Every page shows the loader, so its worker is the shell's although it is loaded lazily.
      'assets/loader.worker-oooo.js',
      'assets/react-bbbb.js',
    ])
    expect(manifest.shellBytes).toBe(210)
  })

  it('never takes a page, or a file over the limit, into the shell', () => {
    expect(manifest.shell).not.toContain('assets/Tool-dddd.js')
    expect(manifest.shell).not.toContain('assets/Other-eeee.js')
    expect(manifest.shell).not.toContain('assets/huge-pppp.wasm')
  })

  it('lists the unhashed files the shell page and a tool read, and changes its id with their bytes', () => {
    const extras = (revision: string) => ({
      ...OPTIONS,
      shellExtras: [{ file: 'favicon.svg', revision: 'f1' }],
      groups: [{ id: 'tool', roots: /^Tool-/, extras: [{ file: 'tool-layouts.json', revision }] }],
    })
    const first = buildPrecacheManifest(BUNDLE, extras('r1'))
    expect(first.shellExtras).toEqual(['favicon.svg'])
    expect(first.groups.tool.extras).toEqual(['tool-layouts.json'])
    // Their names carry no hash, so the hashed lists stay as they were.
    expect(first.shell).toEqual(manifest.shell)
    expect(first.groups.tool.files).toEqual(manifest.groups.tool.files)
    expect(buildPrecacheManifest(BUNDLE, extras('r1')).build).toBe(first.build)
    expect(buildPrecacheManifest(BUNDLE, extras('r2')).build).not.toBe(first.build)
  })

  it('gives a tool every file it can reach, lazy ones and worker files included', () => {
    expect(manifest.groups.tool.files).toEqual([
      'assets/Tool-dddd.js',
      'assets/dialog-hhhh.js',
      'assets/map-gggg.js',
      'assets/map-worker-jjjj.mjs',
      'assets/small-llll.wasm',
      'assets/tool.worker-iiii.js',
    ])
    expect(manifest.groups.tool.bytes).toBe(400 + 60 + 300 + 90 + 80 + 70)
  })

  it('never reaches another page through the shell', () => {
    // dialog-hhhh.js imports the app chunk, whose lazy references are every page.
    expect(manifest.groups.tool.files).not.toContain('assets/Other-eeee.js')
    expect(manifest.groups.tool.files).not.toContain('assets/other-data-mmmm.json')
    expect(manifest.groups.tool.files).not.toContain('assets/app-aaaa.js')
  })

  it('names a file too large to precache instead of dropping it silently', () => {
    expect(manifest.groups.tool.deferred).toEqual([{ file: 'assets/big-kkkk.wasm', bytes: 5000 }])
  })

  it('changes its build id when a listed file changes and not otherwise', () => {
    expect(buildPrecacheManifest([...BUNDLE].reverse(), OPTIONS).build).toBe(manifest.build)
    const renamed = BUNDLE.map((entry) =>
      entry.fileName === 'assets/map-gggg.js' ? { ...entry, fileName: 'assets/map-zzzz.js' } : entry,
    ).map((entry) => ({
      ...entry,
      staticRefs: entry.staticRefs.map((ref) => (ref === 'assets/map-gggg.js' ? 'assets/map-zzzz.js' : ref)),
    }))
    expect(buildPrecacheManifest(renamed, OPTIONS).build).not.toBe(manifest.build)
    // A file no shell or group lists does not change it.
    const otherChanged = BUNDLE.map((entry) =>
      entry.fileName === 'assets/other-data-mmmm.json' ? { ...entry, fileName: 'assets/other-data-nnnn.json' } : entry,
    )
    expect(buildPrecacheManifest(otherChanged, OPTIONS).build).toBe(manifest.build)
  })

  it('refuses a group whose roots match nothing, and an entry that was not built', () => {
    expect(() => buildPrecacheManifest(BUNDLE, { ...OPTIONS, groups: [{ id: 'gone', roots: /^Renamed-/ }] })).toThrow(
      /group "gone" matches no built file/,
    )
    expect(() => buildPrecacheManifest(BUNDLE, { ...OPTIONS, entries: ['assets/missing.js'] })).toThrow(
      /entry "assets\/missing.js" is not in the build/,
    )
  })
})

describe('referencedFiles', () => {
  const names = new Map([
    ['Tool-dddd.js', 'assets/Tool-dddd.js'],
    ['map-worker-jjjj.mjs', 'assets/map-worker-jjjj.mjs'],
    ['1-19-B2xR9bhi.json', 'assets/1-19-B2xR9bhi.json'],
  ])

  it('finds built files by name in minified code, however they are quoted', () => {
    const code =
      'import("./Tool-dddd.js");const w=new URL("/assets/map-worker-jjjj.mjs",import.meta.url);m(["assets/1-19-B2xR9bhi.json"])'
    expect(referencedFiles(code, names, 'assets/app-aaaa.js').sort()).toEqual([
      'assets/1-19-B2xR9bhi.json',
      'assets/Tool-dddd.js',
      'assets/map-worker-jjjj.mjs',
    ])
  })

  it('leaves out the file itself and names that are not built files', () => {
    expect(referencedFiles('self "Tool-dddd.js" and "unknown-file.js"', names, 'assets/Tool-dddd.js')).toEqual([])
  })
})

describe('buildId', () => {
  it('is order-independent and eight hex digits', () => {
    expect(buildId(['b', 'a'])).toBe(buildId(['a', 'b']))
    expect(buildId(['a', 'b'])).toMatch(/^[0-9a-f]{8}$/)
    expect(buildId(['ab'])).not.toBe(buildId(['a', 'b']))
  })
})
