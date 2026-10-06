import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { decode, encode } from 'fast-png'
const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--cases') || !args.includes('--output'))
  throw new Error(
    'Usage: node scripts/compare-network-rendering.mjs --cases FILE --output DIR [--base-url URL] [--chromium PATH]',
  )
const cases = JSON.parse(await fs.readFile(value('--cases'), 'utf8')),
  output = path.resolve(value('--output'))
await fs.mkdir(output, { recursive: true })
const launch = {
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=https=${process.env.HTTPS_PROXY}`] : []),
  ],
}
if (args.includes('--chromium')) launch.executablePath = value('--chromium')
const browser = await chromium.launch(launch),
  results = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${args.includes('--base-url') ? value('--base-url') : 'http://127.0.0.1:5173'}/dev/networks`, {
    waitUntil: 'domcontentloaded',
  })
  await page.getByRole('button', { name: 'Hide TELUS', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Bell', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Rogers', exact: true }).click()
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.maplibregl-map'),
        key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
      for (let n = key ? el[key] : null, d = 0; n && d < 100; n = n.return, d++)
        for (let h = n.memoizedState, i = 0; h && i < 50; h = h.next, i++) {
          const map = h.memoizedState?.current ?? h.memoizedState
          if (typeof map?.getStyle === 'function' && map.__deck) {
            window.networkAuditMap = map
            return true
          }
        }
      return false
    },
    null,
    { timeout: 30000 },
  )
  // A stable neutral background makes this a comparison of coverage rendering,
  // avoiding different asynchronous basemap labels in successive screenshots.
  await page.evaluate(() =>
    window.networkAuditMap.setStyle({
      version: 8,
      sources: {},
      layers: [{ id: 'audit-background', type: 'background', paint: { 'background-color': '#f4f6f8' } }],
    }),
  )
  await page.addStyleTag({ content: '.maplibregl-control-container,.mapcn-tooltip{visibility:hidden!important}' })
  const labelButton = (label) => page.getByRole('button').filter({ has: page.getByText(label, { exact: true }) })
  let previousLabel = null
  for (const c of cases) {
    const errorStart = errors.length,
      name = `${c.provider}-${c.layer}-z${c.zoom}`
    if (previousLabel !== c.label) {
      if (previousLabel) await labelButton(previousLabel).click()
      await labelButton(c.label).click()
      previousLabel = c.label
    }
    await page.getByRole('combobox', { name: 'Saved tile level', exact: true }).click()
    await page.getByRole('option', { name: `Level ${c.zoom}`, exact: true }).click()
    await page.evaluate((c) => {
      const n = 2 ** c.zoom,
        lon = ((c.x + 0.5) / n) * 360 - 180,
        lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (c.y + 0.5)) / n))) * 180) / Math.PI
      window.networkAuditMap.jumpTo({ center: [lon, lat], zoom: c.zoom, pitch: 0, bearing: 0 })
    }, c)
    await page.getByRole('button', { name: 'Box grid', exact: true }).click()
    await page.waitForFunction(
      (c) => {
        const layers = window.networkAuditMap.__deck.props.layers
        return layers.some(
          (l) =>
            l.id.includes(`-grid-${c.layer}-${c.zoom}-1`) &&
            l.state?.tileset?.tiles.some(
              (t) =>
                t.index.x === c.x &&
                t.index.y === c.y &&
                t.index.z === c.zoom &&
                t.content &&
                t.layers?.every((s) => s.isLoaded),
            ),
        )
      },
      c,
      { timeout: 60000 },
    )
    await page.waitForTimeout(200)
    const rect = await page.locator('.maplibregl-canvas').boundingBox(),
      clip = {
        x: Math.round(rect.x + rect.width / 2 - 256),
        y: Math.round(rect.y + rect.height / 2 - 256),
        width: 512,
        height: 512,
      }
    await page.mouse.move(100, 35)
    const converted = await page.screenshot({ path: path.join(output, `${name}-grid.png`), clip })
    const grid = await page.evaluate((c) => {
      const l = window.networkAuditMap.__deck.props.layers.find((l) => l.id.includes(`-grid-${c.layer}-${c.zoom}-1`))
      const t = l.state.tileset.tiles.find((t) => t.index.x === c.x && t.index.y === c.y && t.index.z === c.zoom)
      return {
        id: l.id,
        sourceMinZoom: l.props.minZoom,
        sourceMaxZoom: l.props.maxZoom,
        opacity: l.props.opacity,
        pixels: t.content.cells.length,
        allRGBA: t.content.cells.every((cell) => cell.rgba?.length === 4),
        sourceZoom: t.index.z,
        camera: { zoom: window.networkAuditMap.getZoom(), center: window.networkAuditMap.getCenter() },
      }
    }, c)
    await page.getByRole('button', { name: 'Source image', exact: true }).click()
    await page.waitForFunction(
      (c) =>
        window.networkAuditMap.__deck.props.layers.some(
          (l) =>
            l.id.includes(`-raster-${c.layer}-${c.zoom}`) &&
            l.state?.tileset?.tiles.some(
              (t) =>
                t.index.x === c.x &&
                t.index.y === c.y &&
                t.index.z === c.zoom &&
                t.content &&
                t.layers?.every((s) => s.isLoaded),
            ),
        ),
      c,
      { timeout: 60000 },
    )
    await page.waitForTimeout(200)
    const source = await page.screenshot({ path: path.join(output, `${name}-source.png`), clip })
    const camera = await page.evaluate(() => ({
      zoom: window.networkAuditMap.getZoom(),
      center: window.networkAuditMap.getCenter(),
    }))
    const a = decode(source),
      b = decode(converted)
    let changedPixels = 0,
      maxChannelDifference = 0,
      changedChannels = 0,
      totalDifference = 0
    const difference = new Uint8Array(a.width * a.height * 4)
    for (let p = 0; p < a.width * a.height; p++) {
      let changed = false
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(a.data[p * a.channels + channel] - b.data[p * b.channels + channel])
        if (delta) {
          changed = true
          changedChannels++
        }
        totalDifference += delta
        maxChannelDifference = Math.max(maxChannelDifference, delta)
      }
      if (changed) {
        changedPixels++
        difference[p * 4] = 255
        difference[p * 4 + 3] = 255
      }
    }
    await fs.writeFile(
      path.join(output, `${name}-difference.png`),
      encode({ width: a.width, height: a.height, channels: 4, data: difference }),
    )
    const result = {
      ...c,
      grid,
      cameraUnchanged: JSON.stringify(camera) === JSON.stringify(grid.camera),
      screenshotPixels: a.width * a.height,
      changedPixels,
      changedChannels,
      maxChannelDifference,
      meanChannelDifference: totalDifference / (a.width * a.height * 3),
      browserErrors: errors.slice(errorStart),
      sourceImage: `${name}-source.png`,
      gridImage: `${name}-grid.png`,
      differenceImage: `${name}-difference.png`,
    }
    results.push(result)
    console.log(
      JSON.stringify({
        name,
        changedPixels,
        maxChannelDifference,
        cameraUnchanged: result.cameraUnchanged,
        browserErrors: result.browserErrors,
      }),
    )
    await fs.writeFile(
      path.join(output, 'rendered-comparison.json'),
      JSON.stringify({ cases: results.length, expectedCases: cases.length, results, browserErrors: errors }, null, 2),
    )
  }
} finally {
  await browser.close()
}
