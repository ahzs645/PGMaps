/**
 * Test views for the road view's drawn stand: at fixed cameras, the picture, the share of the view
 * the stand covers and the time a frame takes, moving and stopped. See README.md beside this file.
 *
 * Loaded into the page (`await import('http://127.0.0.1:48731/views.js')`), because the numbers
 * have to come from the map's own canvas at the moment it is drawn: a WebGL canvas reads back
 * blank at any other time.
 */
const PANE = '[data-testid="visuals-road-view"]'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
export function findMap(sel = PANE) {
  const pane = document.querySelector(sel)
  const container = pane && pane.querySelector('.maplibregl-map')
  if (!container) return null
  const key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
  let node = container[key]
  for (let d = 0; node && d < 300; d++) {
    let hook = node.memoizedState
    for (let i = 0; hook && i < 60; i++) {
      const v = hook.memoizedState && hook.memoizedState.current
      if (v && typeof v.getCanvas === 'function' && typeof v.redraw === 'function' && pane.contains(v.getCanvas()))
        return v
      hook = hook.next
    }
    node = node.return
  }
  return null
}
const click = (text, root = document) => {
  const b = [...root.querySelectorAll('button')].find((x) => (x.textContent || '').trim().startsWith(text))
  if (b) b.click()
  return !!b
}
export async function openSample(name) {
  click(name)
  await sleep(1500)
  if (!document.querySelector(PANE + ' .maplibregl-map')) click('Look from the road')
  await sleep(2500)
  return !!findMap()
}
export const paneText = () => (document.querySelector(PANE)?.innerText || '').replace(/\s+/g, ' ').slice(0, 260)
export const preparing = () => /Preparing forest|Loading/.test(paneText())
const press = (map, key, n) => {
  for (let i = 0; i < n; i++) map.getCanvas().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}
/** Turn (degrees, + right) and tilt (degrees, + up) from where the look is now. */
export async function look(yaw, tilt = 0) {
  const map = findMap()
  press(map, yaw >= 0 ? 'ArrowRight' : 'ArrowLeft', Math.round(Math.abs(yaw) / 3))
  press(map, tilt >= 0 ? 'ArrowUp' : 'ArrowDown', Math.round(Math.abs(tilt) / 2))
  await sleep(700)
  return { bearing: +map.getBearing().toFixed(1), pitch: +map.getPitch().toFixed(1) }
}
export async function resetLook() {
  const map = findMap()
  map.getCanvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))
  await sleep(700)
}
function grab(map) {
  map.redraw()
  const src = map.getCanvas()
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0)
  return { c, data: ctx.getImageData(0, 0, c.width, c.height).data }
}
async function nudge(map) {
  press(map, 'ArrowRight', 1)
  await frame()
  await frame()
  press(map, 'ArrowLeft', 1)
  await frame()
  await frame()
  await frame()
}
function timeFrames(map, n) {
  const gl = map.getCanvas().getContext('webgl2')
  const px = new Uint8Array(4)
  const times = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    map.redraw()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    times.push(performance.now() - t)
  }
  return times
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const post = (name, blob) =>
  fetch('http://127.0.0.1:48731/?name=' + encodeURIComponent(name), { method: 'POST', body: blob })
/**
 * One view: still and moving pictures, the share of the view the stand covers in each, and frame
 * times. With `region` (`[left, top, right, bottom]` as shares of the view) it also gives the
 * stand's cover inside that part of the view (`regionCover`), and of the cut ground showing there
 * with the stand off, the share still showing with it on (`cutGroundShown`): what the drawn timber
 * leaves of a block.
 */
export async function measure(tag, name, region) {
  const map = findMap()
  const layer = 'forestry-trees'
  const out = {
    name,
    w: map.getCanvas().width,
    h: map.getCanvas().height,
    bearing: +map.getBearing().toFixed(1),
    pitch: +map.getPitch().toFixed(1),
  }
  const cover = (a, b) => {
    let n = 0
    for (let i = 0; i < a.length; i += 4)
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++
    return +((100 * n) / (a.length / 4)).toFixed(2)
  }
  // Still: the view has held for over the settle time.
  await sleep(900)
  const still = grab(map)
  out.stillMs = +median(timeFrames(map, 9)).toFixed(1)
  // Moving: within the settle time of a camera change.
  await nudge(map)
  const moving = grab(map)
  const movingTimes = []
  for (let k = 0; k < 3; k++) {
    await nudge(map)
    movingTimes.push(...timeFrames(map, 4))
  }
  out.movingMs = +median(movingTimes).toFixed(1)
  map.setLayoutProperty(layer, 'visibility', 'none')
  const bare = grab(map)
  out.bareMs = +median(timeFrames(map, 9)).toFixed(1)
  map.setLayoutProperty(layer, 'visibility', 'visible')
  map.redraw()
  out.coverStill = cover(still.data, bare.data)
  out.coverMoving = cover(moving.data, bare.data)
  if (region) {
    const [left, top, right, bottom] = region
    let inside = 0
    let covered = 0
    let cut = 0
    let cutShown = 0
    for (let y = Math.floor(top * out.h); y < bottom * out.h; y++) {
      for (let x = Math.floor(left * out.w); x < right * out.w; x++) {
        const i = (y * out.w + x) * 4
        const changed =
          Math.abs(moving.data[i] - bare.data[i]) +
            Math.abs(moving.data[i + 1] - bare.data[i + 1]) +
            Math.abs(moving.data[i + 2] - bare.data[i + 2]) >
          12
        inside++
        if (changed) covered++
        // Cut ground is the one tan thing in the road view: redder than green, greener than blue.
        const [r, g, b] = [bare.data[i], bare.data[i + 1], bare.data[i + 2]]
        if (r > 110 && r > g + 8 && g > b + 12) {
          cut++
          if (!changed) cutShown++
        }
      }
    }
    out.regionCover = +((100 * covered) / inside).toFixed(2)
    out.cutGroundPixels = cut
    out.cutGroundShown = cut ? +((100 * cutShown) / cut).toFixed(2) : null
  }
  for (const [kind, shot] of [
    ['still', still],
    ['moving', moving],
  ]) {
    const blob = await new Promise((r) => shot.c.toBlob(r, 'image/jpeg', 0.88))
    await post(`${tag}-${name}-${kind}.jpg`, blob)
  }
  await post(`${tag}-${name}.json`, new Blob([JSON.stringify(out)]))
  return out
}

/** The five Purden Lake views, in order, each turned and tilted from the one before. */
export const PURDEN_VIEWS = [
  ['along', 0, 0],
  ['side', -84, 0],
  ['quarter', 42, 0],
  ['down', 0, -30],
  ['block', -90, 30],
]

/** Measures every view of a scene under `tag`; resolves to the rows, which are also posted as files. */
export async function measureViews(tag, scene, views = PURDEN_VIEWS) {
  const rows = []
  await resetLook()
  for (const [name, yaw, tilt] of views) {
    await look(yaw, tilt)
    rows.push(await measure(tag, `${scene}-${name}`))
  }
  await resetLook()
  return rows
}

/** Moves the road view to a distance along the road, metres, by its position slider. */
export async function seek(metres) {
  const slider = document.querySelector(`${PANE} input[type="range"]`)
  if (!slider) return false
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(metres))
  slider.dispatchEvent(new Event('input', { bubbles: true }))
  slider.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(1500)
  return true
}

/** Opens the road view's View options panel and returns it. */
async function viewOptions() {
  let panel = document.querySelector('[data-testid="road-view-options"]')
  if (panel) return panel
  const named = (re) =>
    [...document.querySelectorAll('button')].find((b) =>
      re.test((b.getAttribute('aria-label') || b.textContent || '').trim()),
    )
  named(/^Show options/)?.click()
  await sleep(500)
  named(/^View options/)?.click()
  await sleep(800)
  return document.querySelector('[data-testid="road-view-options"]')
}

/** Picks an option of one of View options' dropdowns: by its value, or by its place in the list. */
export async function option(label, pick) {
  const panel = await viewOptions()
  const trigger = panel?.querySelector(`[aria-label="${label}"]`)
  if (!trigger) return false
  trigger.click()
  await sleep(500)
  const options = [
    ...([...document.querySelectorAll('[role="listbox"]')].pop()?.querySelectorAll('[role="option"]') ?? []),
  ]
  const chosen = typeof pick === 'number' ? options[pick] : options.find((o) => o.getAttribute('data-value') === pick)
  chosen?.click()
  await sleep(500)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(1500)
  return !!chosen
}

/** Faces the first block (*Where to look*), which also opens the viewing gap toward it. */
export const faceBlock = () => option('Where to look', 1)

/** Posts the frame as it stands, without measuring it. */
export async function shot(name) {
  const blob = await new Promise((r) => grab(findMap()).c.toBlob(r, 'image/jpeg', 0.9))
  await post(name, blob)
}

/** Chooses how a stem is drawn, by the sidebar button's label (e.g. `Baked from 3D`). */
export async function stemStyle(label) {
  const button = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === label)
  button?.click()
  await sleep(1500)
  return !!button
}
