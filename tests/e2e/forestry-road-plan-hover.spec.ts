import { openWorkbench } from './road-workbench'
import { openRoadPanel } from './road-sidebar'
import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

// planHover.ts: HOVER_CAPTURE_PX and HOVER_RELEASE_PX.
const CAPTURE_PX = 16
const RELEASE_PX = 48

type Point = { x: number; y: number; chainage: number }

/** The active road's calculated stations as drawn, in page pixels, read from the real map. */
async function roadOnScreen(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-roads')
        if (source?.type !== 'geojson') return null
        const roads = (source.serialize().data as GeoJSON.FeatureCollection<GeoJSON.LineString>).features
        const rect = map.getCanvas().getBoundingClientRect()
        const points = roads
          .filter((feature) => feature.properties?.selected)
          .map((feature) => {
            const p = map.project(feature.geometry.coordinates[1] as [number, number])
            return { x: rect.left + p.x, y: rect.top + p.y, chainage: Number(feature.properties!.chainage) }
          })
          .filter((p) => p.x > rect.left + 60 && p.x < rect.right - 60 && p.y > rect.top + 60 && p.y < rect.bottom - 60)
        return { rect: { left: rect.left, top: rect.top }, points }
      }
    }
    return null
  })
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect.poll(async () => (await roadOnScreen(page))?.points.length ?? 0).toBeGreaterThan(20)
  const road = (await roadOnScreen(page))!
  return { errors, road }
}

/** A unit normal to the road at a station, from its neighbours. */
function normal(points: Point[], i: number) {
  const a = points[Math.max(0, i - 1)]
  const b = points[Math.min(points.length - 1, i + 1)]
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
}
const off = (points: Point[], i: number, px: number) => {
  const n = normal(points, i)
  return { x: points[i].x + n.x * px, y: points[i].y + n.y * px }
}
const station = (page: Page) => page.getByTestId('road-profile-chart').getAttribute('data-station').then(Number)
const cursor = (page: Page) =>
  page.evaluate(
    () =>
      (document.querySelector('[data-testid="road-plan-view"] .maplibregl-canvas') as HTMLElement | null)?.style.cursor,
  )
/** Out of reach of the road: the map's own corner. */
const parkPointer = (page: Page, road: { rect: { left: number; top: number } }) =>
  page.mouse.move(road.rect.left + 8, road.rect.top + 8)

test('the station readout keeps left-aligned columns and the slider in place as numbers change', async ({ page }) => {
  const { errors } = await prepare(page)
  const slider = page.getByRole('slider', { name: 'Linked road station', exact: true })
  const output = page.getByTestId('road-selected-station')
  const readings = output.locator('[data-station-reading]')
  await expect(readings).toHaveCount(3)
  const field = page.getByLabel('Selected station metres', { exact: true })
  for (const value of ['0', '200.5', '400']) {
    await field.fill(value)
    await field.press('Enter')
    await expect(readings.nth(1)).toHaveText(/^Z -?[\d,]+\.\d m$/)
    await expect(readings.nth(2)).toHaveText(/^-?\d+\.\d%$/)
  }
  const before = (await slider.boundingBox())!
  const columns = await readings.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x))
  // Exercise grouped elevations, whole numbers and negative grades in the real column layout.
  for (const values of [
    ['0+000.0', 'Z 980.0 m', '0.0%'],
    ['3+010.0', 'Z 1,162.5 m', '16.9%'],
    ['3+577.7', 'Z 1,194.9 m', '-2.3%'],
  ]) {
    await readings.evaluateAll(
      (elements, texts) => elements.forEach((element, i) => (element.textContent = texts[i])),
      values,
    )
    const after = (await slider.boundingBox())!
    expect(after.x).toBeCloseTo(before.x, 1)
    expect(after.width).toBeCloseTo(before.width, 1)
    expect(await output.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    for (let i = 0; i < columns.length; i++) {
      const reading = readings.nth(i)
      expect((await reading.boundingBox())!.x).toBeCloseTo(columns[i], 1)
      expect(await reading.evaluate((element) => getComputedStyle(element).textAlign)).toBe('left')
      expect(await reading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
  }
  expect(errors).toEqual([])
})

test('playback ignores hover and a deliberate station selection pauses it', async ({ page }) => {
  const { errors, road } = await prepare(page)
  const field = page.getByLabel('Selected station metres', { exact: true })
  const play = page.getByRole('button', { name: 'Play station playback', exact: true })
  const pause = page.getByRole('button', { name: 'Pause station playback', exact: true })
  const profile = page.getByTestId('road-profile-chart')
  await field.fill('0')
  await field.press('Enter')
  // Freeze time so hover cannot be mistaken for an ordinary playback tick.
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  await play.click()
  await page.clock.runFor(140)
  const first = await station(page)
  expect(first).toBeGreaterThan(0)
  const point = road.points[Math.floor(road.points.length * 0.7)]
  await parkPointer(page, road)
  await page.mouse.move(point.x, point.y, { steps: 5 })
  expect(await station(page)).toBe(first)
  await expect(pause).toBeVisible()
  const box = (await profile.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 5 })
  expect(await station(page)).toBe(first)
  await page.clock.runFor(140)
  expect(await station(page)).toBeGreaterThan(first)

  await page.mouse.click(point.x, point.y)
  await expect(play).toBeVisible()
  const clicked = await station(page)
  expect(clicked).toBeGreaterThan(first)
  await page.clock.runFor(700)
  expect(await station(page)).toBe(clicked)

  await play.click()
  await page.clock.runFor(140)
  await profile.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } })
  await expect(play).toBeVisible()
  const onProfile = await station(page)
  await page.clock.runFor(700)
  expect(await station(page)).toBe(onProfile)

  await play.click()
  await field.fill('200.5')
  await field.press('Enter')
  await expect(play).toBeVisible()
  await page.clock.runFor(700)
  await expect(field).toHaveValue('200.5')
  // Paused inspection retains the normal plan hover behavior.
  await parkPointer(page, road)
  await page.mouse.move(point.x, point.y, { steps: 5 })
  expect(await station(page)).not.toBe(200.5)
  expect(errors).toEqual([])
})

test('a hover picks the road up near the line, follows it, and lets go away from it', async ({ page }) => {
  const { errors, road } = await prepare(page)
  const { points } = road
  const a = Math.floor(points.length / 4)

  // Near the line, not on it: the station follows and the cursor says so.
  await parkPointer(page, road)
  const near = off(points, a, CAPTURE_PX - 6)
  await page.mouse.move(near.x, near.y, { steps: 4 })
  await expect.poll(() => station(page)).toBe(points[a].chainage)
  expect(await cursor(page)).toBe('pointer')

  // Drifting off the line, inside the release distance, keeps following along the road.
  const drift = off(points, a + 3, RELEASE_PX - 10)
  await page.mouse.move(drift.x, drift.y, { steps: 6 })
  await expect.poll(() => station(page)).toBe(points[a + 3].chainage)

  // Past it, the hover lets go: the station stays and the cursor returns.
  const away = off(points, a + 5, RELEASE_PX + 30)
  await page.mouse.move(away.x, away.y, { steps: 3 })
  await expect.poll(() => cursor(page)).toBe('')
  const held = await station(page)
  // Moving about away from the road, and back to the release distance, changes nothing.
  for (const i of [a + 6, a + 8, a + 10]) {
    const p = off(points, i, RELEASE_PX - 10)
    await page.mouse.move(p.x, p.y, { steps: 2 })
  }
  expect(await station(page)).toBe(held)
  expect(errors).toEqual([])
})

test('a quick swipe across the road selects the station it crossed', async ({ page }) => {
  const { errors, road } = await prepare(page)
  const { points } = road
  const s = Math.floor((points.length * 2) / 3)
  await parkPointer(page, road)
  const before = await station(page)
  expect(before).not.toBe(points[s].chainage)
  // One pointer event on each side, 240 px apart: none lands near the line.
  const from = off(points, s, 120)
  const to = off(points, s, -120)
  await page.mouse.move(from.x, from.y)
  expect(await station(page)).toBe(before)
  await page.mouse.move(to.x, to.y)
  await expect.poll(() => station(page)).toBe(points[s].chainage)
  expect(errors).toEqual([])
})

test('the sidebar adds at the station a hover selected', async ({ page }) => {
  const { errors, road } = await prepare(page)
  const { points } = road
  const i = Math.floor(points.length / 2)
  // The memoized sidebar does not re-render for a hover; its actions read the station when clicked.
  await page.mouse.move(points[i].x, points[i].y, { steps: 3 })
  await expect.poll(() => station(page)).toBe(points[i].chainage)
  await openRoadPanel(page, 'Control points')
  const sidebar = page.getByRole('complementary', { name: 'Road design controls', exact: true })
  await sidebar.getByRole('button', { name: 'Control at selected station', exact: true }).click()
  const added = sidebar.locator('[data-vertical-control]').last()
  await expect(added.getByLabel('Station', { exact: true })).toHaveValue(new RegExp(`^${points[i].chainage}(\\.0+)?$`))
  // A second hover moves it on: the same button now adds at the new station.
  const j = i + 4
  await page.mouse.move(points[j].x, points[j].y, { steps: 3 })
  await expect.poll(() => station(page)).toBe(points[j].chainage)
  await sidebar.getByRole('button', { name: 'Control at selected station', exact: true }).click()
  await expect(sidebar.locator('[data-vertical-control]').last().getByLabel('Station', { exact: true })).toHaveValue(
    new RegExp(`^${points[j].chainage}(\\.0+)?$`),
  )
  expect(errors).toEqual([])
})
