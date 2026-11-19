// Measures how a map layer behaves while the camera moves: is it on screen on every frame, how much
// of the view it leaves empty and for how long, when its requests start, and what it costs a frame.
// The guide is docs/map-layer-loading.md; the process is .agents/skills/pgmaps-map-layer-loading.
//
//   node scripts/map-loading/measure.mjs --url <page> --layer <id> [options]
//
//   --url <url>            Page to open (use 127.0.0.1, not localhost).
//   --layer <id>           MapLibre layer id to follow. Repeat for each id the layer may take
//                          (a hand-off alternates `<id>` and `<id>-handoff`).
//   --layer-prefix <text>  Follow every layer whose id starts with this (deck.gl layers, generated ids).
//   --map <css>            The map's container. Default: the first `.maplibregl-map`.
//   --setup <file.mjs>     Page-specific steps. Exports `setup({ page, findMap })` to turn the layer
//                          on, and optionally `actions`: [{ name, run({ page }), holdMs? }] measured
//                          as extra phases (a release change, a basemap switch).
//   --center <lon,lat>     Jump here first.          --zoom <z>   …at this zoom.
//   --host <text>          Count requests whose URL contains this. Repeat for several.
//   --journey <list>       Phases to run, default `drag,zoom-in,zoom-out`. `none` runs only actions.
//   --label <name>         Prefix for the output files, default `run`.
//   --out <dir>            Output folder, default tmp/map-loading/out (git-ignored).
//   --no-isolate           Do not hide the other layers. Presence, requests and long frames are still
//                          measured; the empty share is not.
//   --width/--height       Viewport, default 1400×900.
//
// It prints one row per phase and exits 1 when a layer was missing on any frame or the whole view
// went empty during a gesture. Everything else is a number to compare with a baseline run.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const all = (name) => args.flatMap((arg, i) => (arg === `--${name}` ? [args[i + 1]] : []))
const one = (name, fallback) => all(name).at(-1) ?? fallback
const flag = (name) => args.includes(`--${name}`)

const url = one('url')
const layers = all('layer')
const prefixes = all('layer-prefix')
if (!url || (!layers.length && !prefixes.length)) {
  console.error('Usage: node scripts/map-loading/measure.mjs --url <page> --layer <id> [options]. See the file header.')
  process.exit(2)
}
const label = one('label', 'run')
const out = path.resolve(one('out', 'tmp/map-loading/out'))
const hosts = all('host')
const journey = one('journey', 'drag,zoom-in,zoom-out').split(',').filter((step) => step && step !== 'none')
const isolate = !flag('no-isolate')
const viewport = { width: Number(one('width', 1400)), height: Number(one('height', 900)) }
const center = one('center')?.split(',').map(Number)
const zoom = one('zoom') === undefined ? undefined : Number(one('zoom'))
const mapSelector = one('map', '.maplibregl-map')
const setupFile = one('setup')
const steps = setupFile ? await import(pathToFileURL(path.resolve(setupFile)).href) : {}
fs.mkdirSync(out, { recursive: true })

// The real GPU: the software renderer stalls on large maps and its timings mean nothing.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
})
const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage()
const errors = new Map()
const note = (text) => errors.set(text, (errors.get(text) ?? 0) + 1)
page.on('pageerror', (error) => note(error.message.slice(0, 200)))
page.on('console', (message) => message.type() === 'error' && note(`console: ${message.text().slice(0, 200)}`))

await page.addInitScript(() => {
  performance.setResourceTimingBufferSize(100_000)
  window.__long = []
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__long.push({
        t: entry.startTime,
        d: entry.duration,
        scripts: (entry.scripts ?? []).map((script) => ({
          src: script.sourceURL?.split('/').pop(),
          fn: script.sourceFunctionName,
          d: Math.round(script.duration),
        })),
      })
  }).observe({ type: 'long-animation-frame', buffered: true })
  // The map is found the way the e2e specs find it: through the container's React fiber.
  window.__findMap = (selector) => {
    const container = document.querySelector(selector)
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    for (let fiber = container[key], depth = 0; fiber && depth < 200; depth++, fiber = fiber.return)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map = value && typeof value === 'object' && 'current' in value ? value.current : value
        if (typeof map?.getZoom === 'function' && typeof map?.getBounds === 'function') return map
      }
    return null
  }
})

const findMap = async () => {
  await page.waitForFunction(
    (selector) => {
      const map = window.__findMap(selector)
      if (map?.loaded?.() || map?.isStyleLoaded?.()) window.__m = map
      return !!window.__m
    },
    mapSelector,
    { timeout: 120_000, polling: 250 },
  )
}

const settle = (timeout = 40_000) =>
  page.evaluate(
    (timeout) =>
      new Promise((resolve) => {
        const map = window.__m
        const start = performance.now()
        const done = (how) => {
          clearTimeout(timer)
          map.off('idle', onIdle)
          resolve({ how, ms: Math.round(performance.now() - start) })
        }
        const onIdle = () => done('idle')
        const timer = setTimeout(() => done('timeout'), timeout)
        map.on('idle', onIdle)
        map.triggerRepaint()
      }),
    timeout,
  )

await page.goto(url)
await findMap()
if (center || zoom !== undefined)
  await page.evaluate(
    ({ center, zoom }) =>
      window.__m.jumpTo({ ...(center ? { center } : {}), ...(zoom === undefined ? {} : { zoom }), bearing: 0, pitch: 0 }),
    { center, zoom },
  )
if (steps.setup) await steps.setup({ page, findMap })

const target = { layers, prefixes }
await page
  .waitForFunction(
    ({ layers, prefixes }) =>
      window.__m.getLayersOrder().some((id) => layers.includes(id) || prefixes.some((prefix) => id.startsWith(prefix))),
    target,
    { timeout: 90_000, polling: 250 },
  )
  .catch(() => {
    console.error(`No layer matching ${[...layers, ...prefixes.map((p) => `${p}*`)].join(', ')} appeared within 90 s.`)
    console.error('Layers on the map:', '(see below)')
  })
console.error('layers on the map:', (await page.evaluate(() => window.__m.getLayersOrder())).join(' '))
const firstSettle = await settle()
await page.waitForTimeout(1000)
await settle()
await page.screenshot({ path: path.join(out, `${label}-start.png`) })

// The sampler. Each rendered frame: are the layers and their sources there, and (isolated) how much
// of the view is the magenta laid under them. Read inside `render`, the only time the canvas is readable.
await page.evaluate(
  ({ layers, prefixes, isolate }) => {
    const map = window.__m
    const followed = (id) => layers.includes(id) || prefixes.some((prefix) => id.startsWith(prefix))
    if (isolate) {
      const hide = () => {
        const styled = map.getStyle().layers
        if (!map.getLayer('__measure-bg'))
          map.addLayer({ id: '__measure-bg', type: 'background', paint: { 'background-color': '#ff00ff' } }, styled[0]?.id)
        for (const layer of styled) {
          if (layer.id === '__measure-bg') continue
          const visibility = followed(layer.id) ? 'visible' : 'none'
          if ((map.getLayoutProperty(layer.id, 'visibility') ?? 'visible') !== visibility)
            map.setLayoutProperty(layer.id, 'visibility', visibility)
        }
      }
      hide()
      map.on('styledata', hide)
    }
    const canvas = map.getCanvas()
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const rows = 16
    const samples = (window.__samples = [])
    window.__mark = (name) => samples.push({ t: performance.now(), mark: name })
    let buffer = null
    map.on('render', () => {
      const present = map.getLayersOrder().filter(followed)
      const sample = {
        t: performance.now(),
        zoom: map.getZoom(),
        layers: present.length,
        // A custom (deck.gl) layer has no source of its own.
        sources: present.filter((id) => {
          const source = map.getLayer(id)?.source
          return !source || !!map.getSource(source)
        }).length,
      }
      if (isolate) {
        const w = gl.drawingBufferWidth
        const h = gl.drawingBufferHeight
        if (!buffer || buffer.length !== w * 4) buffer = new Uint8Array(w * 4)
        let empty = 0
        let total = 0
        for (let row = 0; row < rows; row++) {
          gl.readPixels(0, Math.round(((row + 0.5) / rows) * h), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, buffer)
          for (let x = 0; x < w; x += 4) {
            total++
            if (buffer[x * 4] > 250 && buffer[x * 4 + 1] < 5 && buffer[x * 4 + 2] > 250) empty++
          }
        }
        sample.empty = empty / total
      }
      samples.push(sample)
    })
  },
  { ...target, isolate },
)
await settle()
await page.waitForTimeout(500)

const box = await page.locator(`${mapSelector} .maplibregl-canvas`).first().boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
const mark = (name) => page.evaluate((name) => window.__mark(name), name)
const shot = (name) => page.screenshot({ path: path.join(out, `${label}-${name}.png`) })

const phases = []
/** One measured phase: the gesture, then the wait until the map is idle and a hold after it. */
async function phase(name, gesture, holdMs = 3000) {
  await mark(name)
  await gesture()
  await mark(`${name}:end`)
  await shot(`${name}-release`)
  const settled = await settle()
  await page.waitForTimeout(holdMs)
  await mark(`${name}:settled`)
  await shot(`${name}-after`)
  await page.waitForTimeout(500)
  phases.push({ name, settled })
}

const gestures = {
  // About 2 s across most of the map, the journey in the owner's trace.
  drag: async () => {
    await page.mouse.move(box.x + box.width * 0.85, cy + 100)
    await page.mouse.down()
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(box.x + box.width * (0.85 - (0.7 * i) / 60), cy + 100 - (200 * i) / 60)
      await page.waitForTimeout(33)
      if (i === 30) await shot('drag-mid')
    }
    await page.mouse.up()
  },
  'zoom-in': async () => {
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(150)
  },
  'zoom-out': async () => {
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(150)
  },
}
for (const step of journey) {
  if (!gestures[step]) throw Error(`Unknown journey step "${step}". Known: ${Object.keys(gestures).join(', ')}`)
  await phase(step, gestures[step])
}
for (const action of steps.actions ?? []) await phase(action.name, () => action.run({ page }), action.holdMs)

const data = await page.evaluate(
  (hosts) => ({
    samples: window.__samples,
    long: window.__long,
    resources: performance
      .getEntriesByType('resource')
      .filter((entry) => hosts.some((host) => entry.name.includes(host)))
      .map((entry) => ({ t: entry.startTime, end: entry.responseEnd, name: entry.name.slice(0, 160) })),
  }),
  hosts,
)
await browser.close()

const marks = Object.fromEntries(data.samples.filter((sample) => sample.mark).map((sample) => [sample.mark, sample.t]))
const frames = data.samples.filter((sample) => !sample.mark)
const rows = phases.map(({ name, settled }) => {
  const start = marks[name]
  const ended = marks[`${name}:end`]
  const end = marks[`${name}:settled`]
  const inPhase = frames.filter((frame) => frame.t >= start && frame.t <= end)
  const during = inPhase.filter((frame) => frame.t <= ended)
  const requests = data.resources.filter((request) => request.t >= start && request.t < end)
  const firstRequest = requests.length ? Math.round(Math.min(...requests.map((request) => request.t)) - start) : null
  const row = {
    phase: name,
    frames: inPhase.length,
    // The layer, or its source, was not on the map at all.
    framesWithoutLayer: inPhase.filter((frame) => !frame.layers || frame.sources < frame.layers).length,
    gestureMs: Math.round(ended - start),
    idleAfterMs: settled.how === 'idle' ? settled.ms : `>${settled.ms}`,
    requests: hosts.length ? requests.length : null,
    requestsDuringGesture: hosts.length ? requests.filter((request) => request.t < ended).length : null,
    firstRequestMs: firstRequest,
    longFrames: data.long.filter((frame) => frame.t >= start && frame.t <= end && frame.d > 50).length,
    worstFrameMs: Math.round(Math.max(0, ...data.long.filter((f) => f.t >= start && f.t <= end).map((f) => f.d))),
  }
  if (isolate && inPhase.length) {
    // Empty ground is judged against the phase's own last frame: a view that ends half empty
    // (no data there) is not a fault, ground that fills later is.
    const final = inPhase.at(-1).empty
    let lastExcess = start
    let peak = 0
    for (const frame of inPhase) {
      const excess = Math.max(0, frame.empty - final)
      peak = Math.max(peak, excess)
      if (excess > 0.02) lastExcess = frame.t
    }
    Object.assign(row, {
      finalEmptyShare: +final.toFixed(3),
      peakExtraEmptyShare: +peak.toFixed(3),
      // Frames of the gesture with the whole view empty when it does not end that way: the layer vanished.
      framesAllEmptyDuringGesture: final < 0.9 ? during.filter((frame) => frame.empty > 0.98).length : 0,
      filledMsAfterGesture: Math.max(0, Math.round(lastExcess - ended)),
    })
  }
  return row
})

const failed = rows.filter((row) => row.framesWithoutLayer > 0 || (row.framesAllEmptyDuringGesture ?? 0) > 0)
const result = {
  label,
  url,
  layers: [...layers, ...prefixes.map((prefix) => `${prefix}*`)],
  viewport,
  isolate,
  firstSettle,
  phases: rows,
  errors: [...errors].slice(0, 12),
  verdict: failed.length ? `FAIL: the layer was gone during ${failed.map((row) => row.phase).join(', ')}` : 'ok',
}
fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify({ ...result, longFrames: data.long, requests: data.resources }, null, 1))
console.table(rows)
if (result.errors.length) console.log('page errors:', result.errors)
console.log(`${result.verdict}  →  ${path.join(out, `${label}.json`)} and ${label}-*.png beside it`)
process.exit(failed.length ? 1 : 0)
