import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
const require = createRequire(import.meta.url),
  { chromium } = require('@playwright/test')
const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--output'))
  throw Error(
    'Usage: node scripts/compare-network-native.mjs --output DIR [--cache-root DIR] [--base-url URL] [--chromium PATH]',
  )
const root = path.resolve(
    args.includes('--cache-root') ? value('--cache-root') : 'vendor/bcdatamapper/datascrapers/network',
  ),
  output = path.resolve(value('--output'))
await fs.mkdir(output, { recursive: true })
const report = { crtc: [], telus: [], errors: [] },
  hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex')
const browser = await chromium.launch({
  ...(args.includes('--chromium') ? { executablePath: value('--chromium') } : {}),
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=https=${process.env.HTTPS_PROXY}`] : []),
  ],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto((args.includes('--base-url') ? value('--base-url') : 'http://127.0.0.1:5173') + '/dev/networks', {
    waitUntil: 'domcontentloaded',
  })
  for (const provider of ['TELUS', 'Bell', 'Rogers'])
    await page.getByRole('button', { name: 'Hide ' + provider, exact: true }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('.maplibregl-map'),
      k = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
    for (let n = k ? el[k] : null, d = 0; n && d < 100; n = n.return, d++)
      for (let h = n.memoizedState, i = 0; h && i < 50; h = h.next, i++) {
        const m = h.memoizedState?.current ?? h.memoizedState
        if (typeof m?.getStyle === 'function' && m.__deck) {
          window.nativeMap = m
          return true
        }
      }
    return false
  })
  await page.evaluate(() =>
    window.nativeMap.setStyle({
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f4f6f8' } }],
    }),
  )
  const button = (label) => page.getByRole('button').filter({ has: page.getByText(label, { exact: true }) })
  const manifest = JSON.parse(await fs.readFile(root + '/crtc-network-availability/output/manifest.json', 'utf8'))
  for (const resource of manifest.cartovistaResources) {
    console.log('Checking CRTC', resource.id)
    if (!resource.path?.endsWith('.geojson.gz')) continue
    await button(resource.title).click({ force: true })
    await page.waitForFunction(
      (id) =>
        id.includes('major-roads')
          ? !!window.nativeMap.getSource('line-shared-' + id)
          : window.nativeMap.__deck.props.layers.some((l) => l.id === 'dev-network-' + id && l.isLoaded),
      resource.id,
      { timeout: 60000 },
    )
    const original = JSON.parse(
      gunzipSync(await fs.readFile(root + '/crtc-network-availability/output/' + resource.path)),
    )
    const sourceHash = await page.evaluate(async (id) => {
      const data = id.includes('major-roads')
        ? await window.nativeMap.getSource('line-shared-' + id).getData()
        : window.nativeMap.__deck.props.layers.find((l) => l.id === 'dev-network-' + id).props.data
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)))
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }, resource.id)
    await page.getByRole('button', { name: 'Box grid', exact: true }).click({ force: true })
    await page.waitForFunction(
      () =>
        document.querySelector('button[aria-pressed="true"]') &&
        [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.includes('Box grid')),
    )
    const gridHash = await page.evaluate(async (id) => {
      const data = id.includes('major-roads')
        ? await window.nativeMap.getSource('line-shared-' + id).getData()
        : window.nativeMap.__deck.props.layers.find((l) => l.id === 'dev-network-' + id).props.data
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)))
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }, resource.id)
    const result = {
      id: resource.id,
      features: original.features.length,
      sourceMatchesArchive: sourceHash === hash(original),
      gridMatchesArchive: gridHash === hash(original),
      ...(resource.id.includes('major-roads')
        ? {
            sourceTolerance: await page.evaluate(
              (id) => window.nativeMap.getSource('line-shared-' + id).serialize().tolerance,
              resource.id,
            ),
          }
        : {}),
    }
    report.crtc.push(result)
    await fs.writeFile(output + '/native-browser-comparison.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(result))
    await button(resource.title).click({ force: true })
    await page.getByRole('button', { name: 'Source image', exact: true }).click({ force: true })
  }
  const labels = {
    'telus-lte': 'TELUS LTE',
    'telus-lte-advanced': 'TELUS LTE Advanced',
    'telus-5g': 'TELUS 5G',
    'telus-5g-3500': 'TELUS 5G+ / 3500 MHz',
    'telus-hspa': 'TELUS HSPA+',
    'telus-lte-m': 'TELUS LTE-M',
  }
  const files = await fs.readdir(root + '/telus/output/tiles'),
    cases = []
  for (const layer of files) {
    for (const z of (await fs.readdir(root + '/telus/output/tiles/' + layer)).filter((z) => /^\d+$/.test(z))) {
      const coords = []
      for (const x of await fs.readdir(root + '/telus/output/tiles/' + layer + '/' + z))
        for (const y of await fs.readdir(root + '/telus/output/tiles/' + layer + '/' + z + '/' + x))
          if (y.endsWith('.mvt') && !y.startsWith('._')) coords.push({ x: Number(x), y: Number(y.slice(0, -4)) })
      const n = 2 ** Number(z),
        pgx = ((-122.75 + 180) / 360) * n,
        pgy = ((1 - Math.asinh(Math.tan((53.915 * Math.PI) / 180)) / Math.PI) / 2) * n
      coords.sort((a, b) => (a.x - pgx) ** 2 + (a.y - pgy) ** 2 - ((b.x - pgx) ** 2 + (b.y - pgy) ** 2))
      cases.push({ layer, z: Number(z), ...coords[0] })
    }
  }
  let previous = null
  for (const c of cases) {
    if (c.layer !== previous) {
      if (previous) await button(labels[previous]).click()
      await button(labels[c.layer]).click()
      previous = c.layer
    }
    await page.getByRole('combobox', { name: 'Saved tile level', exact: true }).click()
    await page.getByRole('option', { name: 'Level ' + c.z, exact: true }).click()
    await page.evaluate((c) => {
      const n = 2 ** c.z,
        center =
          c.z < 2
            ? [-122.75, 53.915]
            : [
                ((c.x + 0.5) / n) * 360 - 180,
                (Math.atan(Math.sinh(Math.PI * (1 - (2 * (c.y + 0.5)) / n))) * 180) / Math.PI,
              ]
      window.nativeMap.jumpTo({ center, zoom: Math.max(2, c.z), pitch: 0, bearing: 0 })
    }, c)
    await page.waitForFunction(
      (c) =>
        window.nativeMap.__deck.props.layers.some(
          (l) =>
            l.id === `dev-network-${c.layer}-${c.z}` &&
            l.state?.tileset?.tiles.some(
              (t) => t.index.x === c.x && t.index.y === c.y && t.index.z === c.z && t.content,
            ),
        ),
      c,
      { timeout: 60000 },
    )
    const before = await (
      await page.waitForFunction(
        (c) => {
          const l = window.nativeMap.__deck.props.layers.find((l) => l.id === `dev-network-${c.layer}-${c.z}`),
            t = l?.state?.tileset?.tiles.find((t) => t.index.x === c.x && t.index.y === c.y && t.index.z === c.z)
          return t?.content
            ? {
                features: t.content.length,
                sourceZoom: t.index.z,
                sourceMin: l.props.minZoom,
                sourceMax: l.props.maxZoom,
              }
            : false
        },
        c,
        { timeout: 60000 },
      )
    ).jsonValue()
    await page.getByRole('button', { name: 'Box grid', exact: true }).click({ force: true })
    await page.waitForFunction(
      () =>
        document.querySelector('button[aria-pressed="true"]') &&
        [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.includes('Box grid')),
    )
    await page.waitForTimeout(100)
    await page.waitForFunction(
      (c) =>
        window.nativeMap.__deck.props.layers.some(
          (l) =>
            l.id === `dev-network-${c.layer}-${c.z}` &&
            l.state?.tileset?.tiles.some(
              (t) => t.index.x === c.x && t.index.y === c.y && t.index.z === c.z && t.content,
            ),
        ),
      c,
      { timeout: 60000 },
    )
    const after = await (
      await page.waitForFunction(
        (c) => {
          const l = window.nativeMap.__deck.props.layers.find((l) => l.id === `dev-network-${c.layer}-${c.z}`),
            t = l?.state?.tileset?.tiles.find((t) => t.index.x === c.x && t.index.y === c.y && t.index.z === c.z)
          return t?.content
            ? {
                features: t.content.length,
                sourceZoom: t.index.z,
                sourceMin: l.props.minZoom,
                sourceMax: l.props.maxZoom,
              }
            : false
        },
        c,
        { timeout: 60000 },
      )
    ).jsonValue()
    const result = { ...c, before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) }
    report.telus.push(result)
    await fs.writeFile(output + '/native-browser-comparison.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(result))
    await page.getByRole('button', { name: 'Source image', exact: true }).click({ force: true })
  }
  await fs.writeFile(output + '/native-browser-comparison.json', JSON.stringify(report, null, 2))
  if (
    report.errors.length ||
    report.crtc.length !== 15 ||
    report.telus.length !== 37 ||
    report.crtc.some((r) => !r.sourceMatchesArchive || !r.gridMatchesArchive) ||
    report.telus.some((r) => !r.unchanged)
  )
    throw Error('Native source comparison failed or incomplete')
} finally {
  await browser.close()
}
