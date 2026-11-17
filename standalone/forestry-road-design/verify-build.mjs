#!/usr/bin/env node
/**
 * Checks a standalone road designer build before it is uploaded: the page and its 404 fallback, every
 * script and stylesheet the page names, the designer's own public files, the cable optimizer's wasm,
 * and no PGMaps data or service worker. Reads the base the build was made with from its own HTML, so
 * it holds at a domain's root and under any subpath. Usage: node verify-build.mjs [dist]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(process.argv[2] ?? path.join(here, 'dist'))
const problems = []
const need = (ok, message) => ok || problems.push(message)
const read = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(dist, rel))

need(exists('index.html'), 'index.html is missing')
const html = exists('index.html') ? read('index.html') : ''
need(exists('404.html') && read('404.html') === html, '404.html must be a copy of index.html (the router fallback)')
const manifest = exists('source-manifest.json') ? JSON.parse(read('source-manifest.json')) : null
need(
  manifest?.schema === 'pgmaps-road-design-standalone-source-v1',
  'source-manifest.json is missing or of another schema',
)

const base = manifest?.settings?.ROAD_DESIGN_BASE
  ? `/${manifest.settings.ROAD_DESIGN_BASE.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')
  : null
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((url) => !/^(https?:|data:|#)/.test(url))
need(assets.length > 0, 'index.html names no scripts or stylesheets')
for (const url of assets) {
  if (base) need(url.startsWith(base), `${url} is not below the build's base ${base}`)
  const rel = base && url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, '')
  need(exists(rel), `index.html names ${url}, which the build does not contain`)
}

for (const file of manifest?.files ?? [])
  need(exists(file.path), `${file.path} is listed in source-manifest.json but missing`)
for (const rel of ['workspace-layouts.json', 'help', 'brand/access.css']) need(exists(rel), `${rel} is missing`)
const files = fs.readdirSync(path.join(dist, 'assets'))
need(
  files.some((name) => /^cable_layout.*\.wasm$/.test(name)),
  'the cable optimizer (cable_layout.wasm) is missing',
)
need(
  files.some((name) => /worker.*\.js$/i.test(name)),
  'no web worker was built',
)
need(!exists('data'), 'the build contains data/: PGMaps data must come from VITE_DATA_HOSTS, not the build')
need(!exists('sw.js'), "the build contains PGMaps' service worker")

if (problems.length) {
  console.error(`The road designer build at ${dist} is not ready:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(
  `Road designer build verified at ${dist} (base ${base ?? 'unknown'}, ${assets.length} page assets, ${manifest.files.length} public files).`,
)
