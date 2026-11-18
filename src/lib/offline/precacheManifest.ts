/**
 * The list of built files the service worker keeps for offline use (`public/sw.js`,
 * `docs/app-updates-and-caching.md`, **Offline tools**).
 *
 * The build writes one `offline-precache.json`: the **shell** (what `index.html` loads before any
 * page mounts) and one **group** per tool that works offline, holding every file that tool can
 * reach, lazily loaded ones included. A page cannot be opened offline from a cache that only holds
 * what an earlier visit happened to load: a dialog never opened online is a chunk never fetched.
 *
 * Kept free of DOM, network and bundler types: `scripts/offline-precache-plugin.ts` turns Vite's
 * bundle into `BuiltFile`s, and the unit test builds a made-up bundle.
 */

/** One emitted file, with the other emitted files it names. */
export interface BuiltFile {
  /** Path below the build root, e.g. `assets/app-1a2b3c4d.js`. */
  fileName: string
  bytes: number
  /** A JavaScript chunk of the page's own module graph, as opposed to a worker, font, image or data file. */
  chunk: boolean
  /** Loaded with this file, before it runs: static imports and the stylesheets that go with them. */
  staticRefs: readonly string[]
  /** Loaded later, if at all: dynamic imports, workers, WebAssembly, fonts, data. */
  lazyRefs: readonly string[]
}

/**
 * A file served as it is from `public/`, outside the build's graph: its name carries no content
 * hash, so its `revision` (a digest of its bytes) is what tells one build's copy from the next.
 */
export interface ExtraFile {
  file: string
  revision: string
}

export interface PrecacheGroupSpec {
  /** The id a page asks for, e.g. `road-design`. */
  id: string
  /** Matches the file name (without its folder) of each chunk the tool starts from. */
  roots: RegExp
  /** Files from `public/` the tool reads at run time, e.g. its layout catalogue. */
  extras?: readonly ExtraFile[]
}

export interface PrecacheGroup {
  files: string[]
  /** Unhashed files from `public/`; fetched again whenever the build changes. */
  extras: string[]
  bytes: number
  /** Reachable files left out for their size; each is cached the first time it is used online. */
  deferred: Array<{ file: string; bytes: number }>
}

export interface PrecacheManifest {
  version: 1
  /** Changes whenever any listed file does. */
  build: string
  shell: string[]
  /** Unhashed files the shell page names, e.g. `favicon.svg`. */
  shellExtras: string[]
  shellBytes: number
  groups: Record<string, PrecacheGroup>
}

export interface PrecacheOptions {
  /** The files `index.html` loads directly: entry scripts, preloads and stylesheets. */
  entries: readonly string[]
  /** Files outside the build's graph that the shell page names, e.g. `favicon.svg` from `public/`. */
  shellExtras?: readonly ExtraFile[]
  groups: readonly PrecacheGroupSpec[]
  /** A reachable file larger than this is deferred, not precached. */
  maxFileBytes: number
}

const baseName = (fileName: string) => fileName.slice(fileName.lastIndexOf('/') + 1)

/** A short stable id for a list of file names (FNV-1a; hashed names carry the content). */
export function buildId(files: readonly string[]): string {
  let hash = 0x811c9dc5
  for (const file of [...files].sort()) {
    for (let i = 0; i < file.length; i++) {
      hash ^= file.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    hash ^= 0x0a
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Build the manifest. Throws when an entry is not in the bundle or a group's roots match no file:
 * either would switch offline support off with nothing reported.
 */
export function buildPrecacheManifest(files: readonly BuiltFile[], options: PrecacheOptions): PrecacheManifest {
  const byName = new Map(files.map((file) => [file.fileName, file]))
  const sum = (names: Iterable<string>) => {
    let bytes = 0
    for (const name of names) bytes += byName.get(name)?.bytes ?? 0
    return bytes
  }

  // The shell is what loads before a page does: static references, and the workers and other
  // files (never chunks, which are the pages themselves) that a shell file asks for later.
  const shell = new Set<string>()
  const pending = [...options.entries]
  for (const entry of options.entries) {
    if (!byName.has(entry)) throw new Error(`offline precache: entry "${entry}" is not in the build`)
  }
  while (pending.length) {
    const name = pending.pop()!
    if (shell.has(name) || !byName.has(name)) continue
    shell.add(name)
    const file = byName.get(name)!
    pending.push(...file.staticRefs)
    for (const ref of file.lazyRefs) {
      const target = byName.get(ref)
      if (target && !target.chunk && target.bytes <= options.maxFileBytes) pending.push(ref)
    }
  }

  const revisions = (options.shellExtras ?? []).map((extra) => `${extra.file}@${extra.revision}`)
  const groups: Record<string, PrecacheGroup> = {}
  for (const spec of options.groups) {
    const roots = files.filter((file) => spec.roots.test(baseName(file.fileName))).map((file) => file.fileName)
    if (!roots.length) throw new Error(`offline precache: group "${spec.id}" matches no built file (${spec.roots})`)
    const reached = new Set<string>()
    const deferred = new Map<string, number>()
    const queue = [...roots]
    while (queue.length) {
      const name = queue.pop()!
      const file = byName.get(name)
      // The shell's lazy references are every page in the app: a tool never reaches through it.
      if (!file || shell.has(name) || reached.has(name) || deferred.has(name)) continue
      if (file.bytes > options.maxFileBytes) {
        deferred.set(name, file.bytes)
        continue
      }
      reached.add(name)
      queue.push(...file.staticRefs, ...file.lazyRefs)
    }
    const list = [...reached].sort()
    for (const extra of spec.extras ?? []) revisions.push(`${extra.file}@${extra.revision}`)
    groups[spec.id] = {
      files: list,
      extras: (spec.extras ?? []).map((extra) => extra.file).sort(),
      bytes: sum(list),
      deferred: [...deferred].map(([file, bytes]) => ({ file, bytes })).sort((a, b) => a.file.localeCompare(b.file)),
    }
  }

  const shellList = [...shell].sort()
  return {
    version: 1,
    build: buildId([...shellList, ...Object.values(groups).flatMap((group) => group.files), ...revisions]),
    shell: shellList,
    shellExtras: (options.shellExtras ?? []).map((extra) => extra.file).sort(),
    shellBytes: sum(shellList),
    groups,
  }
}

/** The names in `text` that are files of this build, found by their (content-hashed) file names. */
export function referencedFiles(text: string, namesByBase: ReadonlyMap<string, string>, self: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/[A-Za-z0-9_@~][A-Za-z0-9_.@~-]*\.[A-Za-z0-9]+/g)) {
    const name = namesByBase.get(match[0])
    if (name && name !== self) found.add(name)
  }
  return [...found]
}
