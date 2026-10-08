import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.use({ launchOptions: { executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] } })
import { installHost, execute, summary, ready } from './flatten-helpers'

test('native map preserves routing, search, exports and shared-route state', async ({ page, context }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installHost(page)
  await page.goto('/dev/flatten')
  await ready(page)
  const flat = await summary(page)
  expect(flat.map).toEqual({ engine: 'MapLibre', loaded: true, routeLayer: true })
  expect(flat.route.distanceMeters).toBeCloseTo(7822.2, 6)
  expect(flat.route.climbMeters).toBeCloseTo(83.29, 6)
  expect(flat.route.alternatives).toBe(30)
  await page.getByRole('slider', { name: 'From shortest to flattest' }).press('Home')
  const shortest = await summary(page)
  expect(shortest.route.distanceMeters).toBeLessThan(flat.route.distanceMeters)
  expect(shortest.route.climbMeters).toBeGreaterThan(flat.route.climbMeters)
  await page.getByRole('button', { name: 'km', exact: true }).click()
  expect((await summary(page)).units).toBe('km')
  await expect(page.locator('dl').first()).toContainText('km')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'GPX', exact: true }).click()
  const file = await downloadPromise
  const xml = await readFile((await file.path())!, 'utf8')
  expect(await page.evaluate((xml) => { const doc = new DOMParser().parseFromString(xml, 'application/xml'); return !doc.querySelector('parsererror') && doc.querySelectorAll('trkpt').length > 2 && doc.querySelectorAll('trkpt').length === doc.querySelectorAll('ele').length }, xml)).toBe(true)
  await page.getByRole('button', { name: 'Swap', exact: true }).click()
  await ready(page)
  expect((await summary(page)).from.label).toBe(flat.to!.label)
  const from = page.getByRole('combobox', { name: 'From', exact: true })
  await from.fill('24th & Mission')
  await expect(page.getByRole('listbox', { name: 'From suggestions' })).toBeVisible()
  await from.press('Enter')
  await ready(page)
  expect((await summary(page)).from.label).toContain('24th')
  const search = await execute<{ matches: { name: string }[] }>(page, 'search_flatten_places', { query: 'Trick Dog' })
  expect(search.matches[0].name).toBe('Trick Dog')
  await expect(execute(page, 'search_flatten_places', { query: '' })).rejects.toThrow(/non-empty/)
  await expect(execute(page, 'read_flatten_route', { unexpected: true })).rejects.toThrow(/no parameters/)
  const selected = await summary(page)
  const shared = await context.newPage()
  await installHost(shared)
  await shared.goto(selected.route.shareUrl)
  await ready(shared)
  expect((await summary(shared)).route).toMatchObject({ distanceMeters: selected.route.distanceMeters, climbMeters: selected.route.climbMeters, index: selected.route.index })
  await shared.close()
  await page.goto('/dev')
  await expect(page.getByRole('link', { name: 'Open Flatten SF', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('bike, calm streets, loops and cancelled searches update the native route', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installHost(page)
  await page.goto('/dev/flatten')
  await ready(page)
  await page.getByRole('button', { name: 'Bike', exact: true }).click()
  await ready(page)
  expect((await summary(page)).mode).toBe('bike')
  const calm = page.getByRole('button', { name: /Prefer calm streets/ })
  await calm.click()
  await expect(calm).toHaveAttribute('aria-pressed', 'false')
  await ready(page)
  await page.getByRole('button', { name: 'Make a loop', exact: true }).click()
  await ready(page)
  expect((await summary(page)).loop).toBe(true)
  await expect(page.getByRole('combobox', { name: 'To', exact: true })).toHaveCount(0)
  const loop = page.getByRole('slider', { name: 'Loop length', exact: true })
  await loop.press('Home')
  await ready(page)
  await page.getByRole('button', { name: /Allow out and back/ }).click()
  await ready(page)
  await page.getByRole('button', { name: 'Point to point', exact: true }).click()
  await page.getByRole('button', { name: 'Walk', exact: true }).click()
  await ready(page)
  expect((await summary(page))).toMatchObject({ mode: 'walk', loop: false, error: null })
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
  await ready(page)
  expect((await summary(page)).map.routeLayer).toBe(true)
  expect(errors).toEqual([])
})

test('mobile uses the shared sheet without horizontal overflow', async ({ page }) => {
  test.setTimeout(60000)
  await page.setViewportSize({ width: 390, height: 844 })
  await installHost(page)
  await page.goto('/dev/flatten')
  await ready(page)
  await expect(page.getByRole('combobox', { name: 'From', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/workspace/flattensf-native-mobile.png' })
  await page.getByRole('button', { name: 'Bike', exact: true }).click()
  await ready(page)
  expect((await summary(page)).mode).toBe('bike')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

const interactionHash = '#t~-122.45234~37.77116~-122.47790~37.77160~w~1.000~near_20Oak_20Street_20_26_20Shrader_20Street~The_20Dragon_2c_20Golden_20Gate_20Park'

test('routes and elevation update before either endpoint is released', async ({ page }) => {
  test.setTimeout(90000)
  await installHost(page)
  await page.goto(`/dev/flatten/${interactionHash}`)
  await ready(page)
  for (const which of ['from', 'to'] as const) {
    const before = await summary(page)
    const profile = page.getByRole('slider', { name: 'Elevation profile', exact: true }).locator('polyline')
    const originalProfile = await profile.getAttribute('points')
    const marker = page.getByRole('button', { name: which === 'from' ? 'Move start point' : 'Move finish point', exact: true })
    const box = (await marker.boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    const dx = which === 'from' ? -100 : 100
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + 50, { steps: 20 })
    // These checks deliberately happen before mouseup: a drop-only update fails.
    await expect.poll(async () => {
      const state = await summary(page)
      return state.dragging && state[which]!.lon !== before[which]!.lon && state.route?.distanceMeters !== before.route.distanceMeters && state.map.routeLayer
    }).toBe(true)
    await expect.poll(() => profile.getAttribute('points')).not.toBe(originalProfile)
    const held = (await marker.boundingBox())!
    expect(Math.hypot(held.x - box.x - dx, held.y - box.y - 50)).toBeLessThan(3)
    const preview = await summary(page)
    await page.mouse.move(x + dx * 0.65, y + 85, { steps: 12 })
    await expect.poll(async () => (await summary(page)).route?.distanceMeters).not.toBe(preview.route.distanceMeters)
    expect((await summary(page)).dragging).toBe(true)
    await page.mouse.up()
    await ready(page)
    expect((await summary(page)).dragging).toBe(false)
    await expect(page.getByText('Live route preview · release to compare all routes.', { exact: true })).toHaveCount(0)
  }
})

test('held dots stay under the pointer during controls and route updates', async ({ page }) => {
  test.setTimeout(90000)
  await installHost(page)
  await page.goto(`/dev/flatten/${interactionHash}`)
  await ready(page)
  const before = await summary(page)
  const marker = page.getByRole('button', { name: 'Move finish point', exact: true })
  const origin = (await marker.boundingBox())!
  const x = origin.x + origin.width / 2, y = origin.y + origin.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 85, y + 40, { steps: 20 })
  const followsPointer = async (dx: number, dy: number) => {
    await expect.poll(async () => {
      const box = (await marker.boundingBox())!
      return Math.hypot(box.x - origin.x - dx, box.y - origin.y - dy)
    }).toBeLessThan(3)
  }
  await followsPointer(85, 40)
  // Trigger page renders while the physical mouse remains held on the dot.
  await page.getByRole('button', { name: 'km', exact: true }).evaluate((button) => button.click())
  await expect(page.locator('dl').first()).toContainText('km')
  await followsPointer(85, 40)
  await page.getByRole('button', { name: 'Bike', exact: true }).evaluate((button) => button.click())
  await expect.poll(async () => (await summary(page)).mode).toBe('bike')
  await ready(page)
  await followsPointer(85, 40)
  await page.mouse.move(x + 110, y + 25, { steps: 10 })
  await followsPointer(110, 25)
  await page.mouse.up()
  await expect.poll(async () => (await summary(page)).to!.lon).not.toBe(before.to!.lon)
  await ready(page)
})

test('both endpoint dots drag and the selected endpoint moves on map clicks', async ({ page }) => {
  test.setTimeout(90000)
  await installHost(page)
  await page.goto(`/dev/flatten/${interactionHash}`)
  await ready(page)
  for (const which of ['from', 'to'] as const) {
    const before = await summary(page)
    const marker = page.getByRole('button', { name: which === 'from' ? 'Move start point' : 'Move finish point', exact: true })
    const box = (await marker.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + (which === 'from' ? -100 : 100), y + 55, { steps: 20 })
    await page.mouse.up()
    await expect.poll(async () => (await summary(page))[which]!.lon).not.toBe(before[which]!.lon)
    await ready(page)
    const after = await summary(page)
    expect(after.route.shareUrl).not.toBe(before.route.shareUrl)
    expect(after.route.distanceMeters).not.toBe(before.route.distanceMeters)
    await expect(marker).toHaveAttribute('aria-pressed', 'true')
  }
  const beforeClick = await summary(page)
  await page.getByRole('button', { name: 'Move finish', exact: true }).click()
  const map = (await page.locator('.maplibregl-canvas').boundingBox())!
  await page.mouse.click(map.x + map.width * 0.55, map.y + map.height * 0.4)
  await expect.poll(async () => (await summary(page)).to!.lon).not.toBe(beforeClick.to!.lon)
  await ready(page)
  expect((await summary(page)).from).toEqual(beforeClick.from)
})

test('touch dragging reaches the start dot while the mobile sheet is open', async ({ browser }) => {
  test.setTimeout(90000)
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage()
    await installHost(page)
    await page.goto(`/dev/flatten/${interactionHash}`)
    await ready(page)
    const before = await summary(page)
    const marker = page.getByRole('button', { name: 'Move start point', exact: true })
    expect(await marker.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
    const box = (await marker.boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    const client = await context.newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 20; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 100 * step / 20, y: y + 50 * step / 20 }] })
      await page.waitForTimeout(25)
    }
    await expect.poll(async () => {
      const state = await summary(page)
      return state.dragging && state.from.lon !== before.from.lon && state.route?.distanceMeters !== before.route.distanceMeters
    }).toBe(true)
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(async () => (await summary(page)).from.lon).not.toBe(before.from.lon)
    await ready(page)
    const after = await summary(page)
    expect(after.route.distanceMeters).not.toBe(before.route.distanceMeters)
    expect(after.to).toEqual(before.to)
    await page.getByRole('button', { name: 'Move finish point', exact: true }).tap()
    // The viewport stays still after a drag, so avoid tapping the moved dot.
    const target = await page.locator('.maplibregl-canvas').evaluate((canvas) => {
      const box = canvas.getBoundingClientRect()
      for (const [rx, ry] of [[0.65, 0.4], [0.45, 0.35], [0.6, 0.2]]) {
        const x = box.x + box.width * rx, y = box.y + box.height * ry
        if (document.elementFromPoint(x, y) === canvas) return { x, y }
      }
      throw new Error('No exposed map canvas for the tap')
    })
    await page.touchscreen.tap(target.x, target.y)
    await expect.poll(async () => (await summary(page)).to!.lon).not.toBe(after.to!.lon)
    await ready(page)
    expect((await summary(page)).from).toEqual(after.from)
    await page.screenshot({ path: '/workspace/flatten-touch-interaction.png' })
  } finally {
    await context.close()
  }
})
