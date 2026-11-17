/**
 * The road designer's import graph, walked from its own files through everything they reach. Reads
 * files only; used by `check-boundary.mjs` and `export.mjs`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { ALIASED_PACKAGES, ENTRIES, OWN, PUBLIC, SHARED } from './manifest.mjs'

const CODE = /\.(tsx?|m?js)$/
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']
/** Imports TypeScript's pre-processor does not list: workers, wasm and test mocks. */
const EXTRA_IMPORTS =
  /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url|vi\.(?:mock|doMock|importActual)\(\s*['"]([^'"]+)['"]/g
const CSS_IMPORT = /@import\s+(?:url\()?['"]([^'"]+)['"]/g

const under = (rel, roots) => roots.some((root) => (root.endsWith('/') ? rel.startsWith(root) : rel === root))
export const isOwn = (rel) => under(rel, OWN)
export const isShared = (rel) => under(rel, SHARED)
/** A file from `public/` the build copies (`PUBLIC`): tests read lesson samples from there. */
export const isPublic = (rel) =>
  under(
    rel,
    PUBLIC.map((entry) => `public/${entry}${entry.includes('.') ? '' : '/'}`),
  )
export const isTest = (rel) => /\.test\.(tsx?|m?js)$/.test(rel)

/** The package name of a bare specifier, or null for a path. */
export function packageName(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || /^[a-z]+:/.test(spec)) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function specifiers(file, text) {
  if (file.endsWith('.css')) return [...text.matchAll(CSS_IMPORT)].map((m) => m[1])
  if (!CODE.test(file)) return []
  const info = ts.preProcessFile(text, true, true)
  // Comments often quote these patterns (`new URL('./x.mjs', import.meta.url)`) without meaning them.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...info.importedFiles.map((f) => f.fileName), ...[...code.matchAll(EXTRA_IMPORTS)].map((m) => m[1] ?? m[2])]
}

function resolveSpec(root, from, spec) {
  const clean = spec.replace(/[?#].*$/, '')
  let base
  if (clean.startsWith('@/')) base = path.join(root, 'src', clean.slice(2))
  else if (clean.startsWith('.')) base = path.resolve(path.dirname(from), clean)
  else return null
  for (const ext of EXTENSIONS) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return { missing: path.relative(root, base) }
}

/** Files in the working tree under a root or list of roots that git tracks or would (not ignored), repository-relative. */
export function trackedFiles(root, roots) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots], {
    cwd: root,
    encoding: 'utf8',
  })
  return out.split('\0').filter(Boolean)
}

/**
 * Walks from `starts` (repository-relative), returning every reached file, the packages imported, and
 * each file's importer so a violation can print the chain that reached it.
 */
export function walk(root, starts) {
  const reached = new Map()
  const packages = new Map()
  const missing = []
  const queue = starts.map((rel) => [path.resolve(root, rel), null])
  while (queue.length) {
    const [file, by] = queue.pop()
    const rel = path.relative(root, file)
    if (reached.has(rel)) continue
    reached.set(rel, by)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const spec of specifiers(file, text)) {
      const pkg = packageName(spec)
      if (pkg) {
        if (!packages.has(pkg)) packages.set(pkg, rel)
        continue
      }
      const target = resolveSpec(root, file, spec)
      if (target && typeof target === 'object') missing.push({ from: rel, spec })
      else if (target) queue.push([target, rel])
    }
  }
  return { reached, packages, missing }
}

/** The chain of importers from a start file to `rel`. */
export function chain(reached, rel) {
  const out = [rel]
  for (let at = reached.get(rel); at; at = reached.get(at)) out.unshift(at)
  return out
}

/** The tool's starts: its entries and every file it owns, tests included. */
export function toolStarts(root) {
  return [...new Set([...ENTRIES, ...trackedFiles(root, OWN).filter((rel) => CODE.test(rel) || rel.endsWith('.css'))])]
}

/** Problems with the tool's graph: another page reached, an unknown package, an import that resolves nowhere. */
export function boundaryProblems(root, graph, dependencies) {
  const problems = []
  for (const [rel] of graph.reached) {
    if (isOwn(rel) || isShared(rel) || isPublic(rel)) continue
    problems.push(
      `${rel} is outside the road designer and the shared code:\n    ${chain(graph.reached, rel).join('\n      → ')}`,
    )
  }
  for (const [pkg, from] of graph.packages) {
    if (ALIASED_PACKAGES.includes(pkg) || dependencies.has(pkg) || isNodeBuiltin(pkg) || installedVersion(root, pkg))
      continue
    problems.push(`${from} imports "${pkg}", which package.json does not list and npm has not installed.`)
  }
  for (const { from, spec } of graph.missing) problems.push(`${from} imports "${spec}", which resolves to no file.`)
  return problems
}

function isNodeBuiltin(pkg) {
  return (
    pkg.startsWith('node:') ||
    [
      'fs',
      'path',
      'url',
      'crypto',
      'child_process',
      'os',
      'zlib',
      'stream',
      'util',
      'module',
      'worker_threads',
      'assert',
      'buffer',
      'events',
      'http',
      'https',
      'process',
      'readline',
      'perf_hooks',
      'v8',
      'vm',
    ].includes(pkg)
  )
}

/**
 * The installed version of a package, or null. A package another one brings in (`@turf/buffer` under
 * `@turf/turf`) is used at the version npm installed, which the export then lists by name.
 */
export function installedVersion(root, pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

export function packageDependencies(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return new Map(Object.entries({ ...pkg.devDependencies, ...pkg.dependencies }))
}
