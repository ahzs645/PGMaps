import { expect, test, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 }, hasTouch: true })
test.setTimeout(120_000)

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByRole('heading', { name: 'Forest road design', exact: true })).toBeVisible()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('road-profile-chart').locator('path[stroke="#a07845"]')).not.toHaveAttribute('d', '')
  const bands = page.getByTestId('road-engineering-bands')
  await bands.getByRole('button', { name: /Grade, curve, template & material bands/ }).click()
  const svg = bands.getByRole('group', { name: 'Connected profile data bands; click or drag to inspect a station' })
  await expect(svg).toBeVisible()
  await svg.scrollIntoViewIfNeeded()
  return { errors, bands, svg }
}

/** Read the actual rendered cross-section source rather than its station label alone. */
async function mapSection(page: Page) {
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
        if (typeof map?.getSource !== 'function') continue
        const source = map.getSource('road-section')
        if (source?.type === 'geojson')
          return (source.serialize().data as GeoJSON.FeatureCollection).features[0]?.geometry ?? null
      }
    }
    return null
  })
}

async function expectStation(page: Page, station: number) {
  const profile = page.getByTestId('road-profile-chart')
  // The engine records station knots to micrometres while fitted total length keeps full precision.
  await expect.poll(async () => Number(await profile.getAttribute('data-station'))).toBeCloseTo(station, 5)
  const selected = (await profile.getAttribute('data-station'))!
  await expect(page.getByTestId('road-active-map-station')).toHaveAttribute('data-chainage', selected)
  await expect(page.getByTestId('road-section-chart')).toHaveAttribute('data-station', selected)
}

async function saveProject(page: Page): Promise<RoadProject> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const chunks: Buffer[] = []
  for await (const chunk of (await (await pending).createReadStream())!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
}

async function plotCoordinates(bands: Locator, svg: Locator) {
  const box = (await svg.boundingBox())!
  const start = Number(await bands.getAttribute('data-range-start'))
  const end = Number(await bands.getAttribute('data-range-end'))
  const left = box.width < 380 ? 48 : 58
  return {
    box,
    start,
    end,
    x: (station: number) => box.x + left + ((station - start) / (end - start)) * (box.width - left - 16),
  }
}

test('dragging the bands updates connected views before release, clamps the visible range, and preserves the road', async ({
  page,
}) => {
  const { errors, bands, svg } = await prepare(page)
  const original = await saveProject(page)
  const full = await plotCoordinates(bands, svg)
  await page.mouse.click(full.x(100), full.box.y + 11)
  await expectStation(page, 100)
  const before = await mapSection(page)
  expect(before).not.toBeNull()
  await page.mouse.down()
  await page.mouse.move(full.x(300), full.box.y + 33, { steps: 6 })
  // No mouseup yet: both the profile and real map geometry must follow the live gesture.
  await expectStation(page, 300)
  await expect.poll(() => mapSection(page)).not.toEqual(before)
  await expect(svg).toBeFocused()
  await page.mouse.move(full.x(600), full.box.y - 30, { steps: 6 })
  await expectStation(page, 600)
  await page.mouse.up()
  await page.mouse.move(full.x(200), full.box.y + 11)
  await expectStation(page, 600)

  await svg.press('Home')
  await expectStation(page, 0)
  await svg.press('ArrowRight')
  await expectStation(page, 10)
  await svg.press('ArrowLeft')
  await expectStation(page, 0)
  await svg.press('End')
  await expectStation(page, full.end)

  const field = page.getByRole('spinbutton', { name: 'Selected station metres', exact: true })
  await field.fill('200')
  await field.press('Tab')
  await page.getByRole('button', { name: 'Zoom profile in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom profile in', exact: true }).click()
  const zoomed = await plotCoordinates(bands, svg)
  expect(zoomed.start).toBeGreaterThan(0)
  expect(zoomed.end).toBeLessThan(full.end)
  await page.mouse.move(zoomed.x(200), zoomed.box.y + 11)
  await page.mouse.down()
  await page.mouse.move(zoomed.box.x - 40, zoomed.box.y - 30)
  await expectStation(page, Math.round(zoomed.start / 10) * 10)
  await page.mouse.move(zoomed.box.x + zoomed.box.width + 20, zoomed.box.y - 30)
  await expectStation(page, Math.round(zoomed.end / 10) * 10)
  await page.mouse.up()
  const stopped = await page.getByTestId('road-profile-chart').getAttribute('data-station')
  await page.mouse.move(zoomed.x(200), zoomed.box.y + 11)
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', stopped!)
  // Auxiliary clicks do not inspect or begin a captured gesture.
  await page.mouse.click(zoomed.x(200), zoomed.box.y + 11, { button: 'right' })
  await expect(page.getByTestId('road-profile-chart')).toHaveAttribute('data-station', stopped!)
  await page.keyboard.press('Escape')
  expect(await saveProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('touch scrubbing captures movement outside the SVG and cancellation ends the gesture', async ({
  page,
  context,
}) => {
  const { errors, bands, svg } = await prepare(page)
  const plot = await plotCoordinates(bands, svg)
  await svg.evaluate((element) =>
    element.addEventListener('pointerdown', (event) => {
      ;(element as SVGSVGElement).dataset.testPointerId = String((event as PointerEvent).pointerId)
    }),
  )
  const session = await context.newCDPSession(page)
  const touch = async (type: 'touchStart' | 'touchMove', station: number, y = plot.box.y + 11) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: plot.x(station), y, id: 0 }] })
  await touch('touchStart', 200)
  await expectStation(page, 200)
  await touch('touchMove', 400, plot.box.y - 30)
  await expectStation(page, 400)
  const pointerId = Number(await svg.getAttribute('data-test-pointer-id'))
  expect(await svg.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(true)
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  expect(await svg.evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(false)
  // A delayed move from the cancelled pointer cannot continue selecting stations.
  await svg.dispatchEvent('pointermove', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: plot.x(700),
    clientY: plot.box.y + 11,
  })
  await expectStation(page, 400)
  // Cancellation keeps the last inspection and permits a fresh touch gesture.
  await touch('touchStart', 500)
  await touch('touchMove', 700)
  await expectStation(page, 700)
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expectStation(page, 700)
  await session.detach()
  expect(errors).toEqual([])
})
