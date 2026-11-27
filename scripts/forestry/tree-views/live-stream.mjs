/**
 * Real Chrome smoke and coverage probe for the two bundled workers.
 * PGMAPS_TEST_URL=http://127.0.0.1:42320 node scripts/forestry/tree-views/live-stream.mjs nanite hill
 */
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { decode } from 'fast-png'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const [engine, terrain] = process.argv.slice(2)
if (!['worldgen', 'nanite'].includes(engine) || !['hill', 'valley'].includes(terrain)) {
  throw new Error('Choose worldgen or nanite, and hill or valley.')
}
const hill = terrain === 'hill'
const folder = process.env.PGMAPS_TREE_PROBE_OUT ?? 'tmp/tree-streaming'
const name = `${engine}-${terrain}`
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.PGMAPS_CHROME ?? 'chrome',
  args: [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    ...JSON.parse(process.env.PGMAPS_CHROME_ARGS ?? '[]'),
  ],
})
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, serviceWorkers: 'block' })
page.setDefaultTimeout(90000)
const result = { engine, terrain, pageErrors: [], requests: {} }
page.on('pageerror', (error) => result.pageErrors.push(error.message))
let driving = false
page.on('request', (request) => {
  if (driving) {
    const host = new URL(request.url()).hostname
    if (host) result.requests[host] = (result.requests[host] ?? 0) + 1
  }
})
await page.addInitScript((id) => {
  const WorkerClass = window.Worker
  const post = WorkerClass.prototype.postMessage
  const workers = new WeakSet()
  const probe = { scenes: [], ready: [], sent: [], applied: [], stats: [], errors: [], defer: false, pending: [] }
  window.treeProbe = probe
  window.Worker = new Proxy(WorkerClass, {
    construct(Target, args) {
      const worker = Reflect.construct(Target, args)
      if (!String(args[0]).includes(`/engines/${id}/pgmaps-engine`)) return worker
      workers.add(worker)
      worker.addEventListener('error', (event) => probe.errors.push(event.message))
      worker.addEventListener('message', ({ data }) => {
        if (data.type === 'pgmaps-engine-ready')
          probe.ready.push({ time: performance.now(), generation: data.generation })
        if (data.type === 'pgmaps-engine-error') probe.errors.push(data.message)
        if (data.type === 'pgmaps-engine-stats') probe.stats.push({ ...data, time: performance.now() })
        if (data.type === 'pgmaps-tree-tiles-applied') {
          probe.applied.push({ time: performance.now(), generation: data.generation })
          if (data.error) probe.errors.push(data.error)
        }
      })
      return worker
    },
  })
  WorkerClass.prototype.postMessage = function (data, ...args) {
    if (workers.has(this) && data?.type === 'pgmaps-scene' && data.scene) {
      probe.scenes.push({ time: performance.now(), region: data.scene.liveTreeTiles, origin: data.scene.origin })
    }
    if (workers.has(this) && data?.type === 'pgmaps-tree-tiles') {
      probe.sent.push({
        time: performance.now(),
        generation: data.generation,
        added: data.add.map(({ x, y }) => [x, y]),
        removed: data.remove,
        bytes: data.add.reduce((sum, tile) => sum + tile.data.byteLength, 0),
      })
      if (probe.defer) {
        probe.pending.push(() => post.call(this, data, ...args))
        return
      }
    }
    return post.call(this, data, ...args)
  }
}, engine)

const output = page.getByTestId('road-view-engine').locator('canvas')
const screenshot = (suffix) => output.screenshot({ path: `${folder}/${name}-${suffix}.png`, timeout: 30000 })
const state = () =>
  page.evaluate(() => {
    const { pending, ...probe } = window.treeProbe
    return { ...probe, pending: pending.length }
  })

try {
  const gpuSession = await browser.newBrowserCDPSession()
  const { gpu } = await gpuSession.send('SystemInfo.getInfo')
  await gpuSession.detach()
  result.gpu = { devices: gpu.devices, renderer: gpu.auxAttributes?.glRenderer, webgpu: gpu.featureStatus?.webgpu }
  await page.goto(`${process.env.PGMAPS_TEST_URL ?? 'http://127.0.0.1:42320'}/dev/forestry/visual-quality`, {
    waitUntil: 'domcontentloaded',
  })
  await page.locator('[data-via-step=identify]').click()
  const sample = page.getByRole('button', { name: hill ? 'Tabor Mountain sample' : /Hwy 16 · Purden Lake/ })
  if (!(await sample.isVisible())) await page.getByText('Start from', { exact: true }).first().click()
  await sample.click()
  await page.getByRole('button', { name: 'Look from the road', exact: true }).click()
  const bar = page.getByRole('region', { name: 'Road view controls' })
  const panel = page.getByTestId('road-view-options')
  const select = async (control, value) => {
    if (!(await panel.isVisible())) {
      const expand = bar.getByRole('button', { name: 'Show options', exact: true })
      if (await expand.isVisible()) await expand.click()
      await bar.getByRole('button', { name: /^View options/ }).click()
      await expect(panel).toBeVisible()
    }
    const combo = panel.getByRole('combobox', { name: control, exact: true })
    await combo.click()
    await page.getByRole('option', { name: value, exact: typeof value === 'string' }).click()
    await page.waitForTimeout(320)
    if (await panel.isVisible()) await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  }
  const helpers = await readFile(new URL('./views.js', import.meta.url), 'utf8')
  await page.evaluate((js) => {
    window.treeMap = new Function(js.replaceAll('export ', '') + '; return { findMap, seek }')()
  }, helpers)
  await expect
    .poll(() => page.evaluate(() => !!window.treeMap.findMap()?.getLayer('forestry-trees')), { timeout: 120000 })
    .toBe(true)
  const start = hill ? 1050 : 5000
  await page.evaluate((m) => window.treeMap.seek(m), start)
  await select('Where to look', hill ? /^Face Block A/ : /^Face /)
  await select('Renderer', engine === 'worldgen' ? 'threejs-worldgen' : 'Nanite Forest')
  console.log(`${name} engine selected`)
  await expect(page.getByTestId('road-view-engine')).toHaveAttribute('data-engine-phase', 'ready', { timeout: 120000 })
  await expect
    .poll(
      async () => {
        const frame = (await state()).stats.at(-1)
        return (frame?.treeTiles?.count ?? 0) > 8 && (frame?.drawn ?? 0) > 0
      },
      { timeout: 90000 },
    )
    .toBe(true)
  await expect
    .poll(
      async () => {
        const p = await state()
        return p.sent.length > 0 && p.sent.length === p.applied.length
      },
      { timeout: 90000 },
    )
    .toBe(true)
  console.log(`${name} initial tiles ready`)
  await screenshot('start')
  const before = await state()

  const area = await output.boundingBox()
  const viewport = page.viewportSize()
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp })
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 560, maxHeight: 420, everyNthFrame: 1 })
  await page.evaluate(() => {
    window.treeProbe.defer = true
  })
  driving = true
  const trace = await page.evaluate(
    async ({ start }) => {
      const range = document.querySelector('[data-testid=visuals-road-view] input[aria-label="Route position"]')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const begin = performance.now(),
        elapsed = 8000
      let previous = start
      const steps = []
      await new Promise((resolve) => {
        const tick = (now) => {
          const progress = Math.min(1, Math.max(0, (now - begin) / elapsed))
          const next = start + Math.round(progress * 20) * 50
          if (next !== previous) {
            setValue.call(range, String(next))
            range.dispatchEvent(new Event('input', { bubbles: true }))
            range.dispatchEvent(new Event('change', { bubbles: true }))
            previous = next
            steps.push({ m: next, t: now })
          }
          if (progress < 1) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      return { steps, final: Number(range.value) }
    },
    { start },
  )
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  await screenshot('pending')
  const pending = await state()
  await page.evaluate(() => {
    const probe = window.treeProbe
    probe.defer = false
    for (const send of probe.pending.splice(0)) send()
  })
  await expect
    .poll(async () => (await state()).applied.length, { timeout: 60000 })
    .toBeGreaterThan(pending.applied.length)
  await page.waitForTimeout(2500)
  const end = await state()
  driving = false
  await screenshot('settled')
  const samples = frames.map(({ data, time }) => {
    const png = decode(Buffer.from(data, 'base64'))
    const { width, height, channels } = png
    let low = 255,
      high = 0
    for (let y = 1; y < 10; y++)
      for (let x = 1; x < 10; x++) {
        const col = Math.floor(((area.x + (x * area.width) / 10) * width) / viewport.width)
        const row = Math.floor(((area.y + (y * area.height) / 10) * height) / viewport.height)
        const index = (row * width + col) * channels
        const light = (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3
        low = Math.min(low, light)
        high = Math.max(high, light)
      }
    return { time, contrast: high - low }
  })
  Object.assign(result, { before, pending, end, trace, samples })
  expect(trace.final).toBe(start + 1000)
  expect(pending.pending).toBeGreaterThan(0)
  expect(end.scenes).toHaveLength(before.scenes.length)
  expect(end.ready).toEqual(before.ready)
  expect(end.errors).toEqual([])
  const times = samples.map(({ time }) => time).sort((a, b) => a - b)
  const firstFrame = times[0],
    frameSpan = times.at(-1) - firstFrame
  expect(frameSpan).toBeGreaterThan(6)
  for (const section of [0, 1, 2]) {
    expect(
      times.filter((time) => Math.min(2, Math.floor((3 * (time - firstFrame)) / frameSpan)) === section).length,
    ).toBeGreaterThan(1)
  }
  const blank = samples.findIndex(({ contrast }) => !(contrast > 15))
  if (blank >= 0) await writeFile(`${folder}/${name}-blank.png`, Buffer.from(frames[blank].data, 'base64'))
  expect(blank).toBe(-1)
  if (process.env.PGMAPS_TEST_EXPOSURE === '1') {
    const original = end.stats.at(-1).sun
    await select('Engine exposure', '+1 stop')
    await expect
      .poll(async () => (await state()).stats.at(-1)?.sun?.exposure, { timeout: 30000 })
      .toBeCloseTo(2 * original.exposure, 1)
    const bright = await state()
    expect(bright.scenes).toEqual(end.scenes)
    expect(bright.stats.at(-1).sun.drawnElevation).toBe(original.drawnElevation)
    await screenshot('plus-one-stop')
    result.exposure = { original, adjusted: bright.stats.at(-1).sun }
  }
  console.log(
    `${name} ${samples.length} composited frames, ${end.sent.length} tile messages, ${end.scenes.length} scene builds`,
  )
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error)
  result.lastState = await state().catch(() => null)
  throw error
} finally {
  await writeFile(`${folder}/${name}-trace.json`, JSON.stringify(result, null, 2))
  await browser.close()
}
