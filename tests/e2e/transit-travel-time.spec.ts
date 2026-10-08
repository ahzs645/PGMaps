import { expect, test } from '@playwright/test'
import { decode } from 'fast-png'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { HeatGridSpec, Point, TransitData } from '../../src/pages/dev-transit/types'

async function stubBasemap(page: import('@playwright/test').Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f0f3ed' } }],
      },
    }),
  )
}

test('Prince George journey, walking comparison, origin drag, search and shared URL', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await stubBasemap(page)
  await page.goto('/dev/transit')
  await page.getByRole('button', { name: 'UNBC', exact: true }).click()
  await expect(page.getByTestId('journey-duration')).toContainText('30 min')
  await expect(page.getByRole('list', { name: 'Journey steps' })).toContainText('Bus 15 toward UNBC')
  await expect(page.getByRole('img', { name: 'Destination B, drag to move' })).toBeVisible()
  await page.getByRole('button', { name: 'Include buses', exact: false }).click()
  await expect(page.getByTestId('journey-duration')).toContainText('105 min')
  await expect(page.getByRole('list', { name: 'Journey steps' })).not.toContainText('Bus 15')
  await page.getByRole('button', { name: 'Include buses', exact: false }).click()
  await expect(page.getByTestId('journey-duration')).toContainText('30 min')
  await page.getByLabel('Departure time', { exact: true }).fill('09:00')
  await expect(page).toHaveURL(/time=09%3A00/)
  await expect(page.getByTestId('journey-duration')).toBeVisible()
  await page.getByRole('button', { name: 'From B', exact: true }).click()
  await expect(page).toHaveURL(/heat=to/)
  const marker = page.getByRole('img', { name: 'Starting point A, drag to move' })
  const box = await marker.boundingBox()
  await page.mouse.move(box!.x + 18, box!.y + 18)
  await page.mouse.down()
  await page.mouse.move(box!.x + 45, box!.y + 35, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).not.toBe('-122.747330,53.913130')
  await page.getByRole('button', { name: 'Set starting point', exact: true }).click()
  await page.getByLabel('Search stops or addresses').fill('Downtown Exch Bay A')
  await page.getByRole('button', { name: /Downtown Exch Bay A Stop/ }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe('-122.747330,53.913130')
  await page.getByRole('button', { name: 'Share map', exact: true }).click()
  const shared = await page.getByLabel('Shareable map link').inputValue()
  expect(new URL(shared).searchParams.get('z')).not.toBeNull()
  await page.goto(shared)
  await expect(page.getByRole('button', { name: 'From A', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('09:00')
  await expect(page.getByTestId('journey-duration')).toBeVisible()
  await page.screenshot({ path: 'tmp/transit-desktop.png' })
  expect(errors).toEqual([])
})

test('heat changes during a held drag, then commits the final point and heat origin', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubBasemap(page)
  await page.goto('/dev/transit?to=-122.81364,53.89128')
  await expect(page.getByTestId('journey-duration')).toBeVisible()
  const canvas = page.locator('.maplibregl-canvas')
  const data: TransitData = JSON.parse(
    gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/transit/output/prince_george_travel_time.json.gz'),
    ).toString(),
  )
  const nearbyStop = (point: Point) =>
    data.stops
      .filter((stop) => stop.access)
      .reduce((best, stop) =>
        Math.hypot((stop.point[0] - point[0]) * 0.59, stop.point[1] - point[1]) <
        Math.hypot((best.point[0] - point[0]) * 0.59, best.point[1] - point[1])
          ? stop
          : best,
      ).point
  const worldSize = 512 * 2 ** 11.1
  const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2
  const snapshot = async () =>
    decode(
      await canvas.screenshot({
        style: '.maplibregl-marker { visibility: hidden !important; }',
      }),
    )
  const changedHeatPixels = (before: ReturnType<typeof decode>, after: ReturnType<typeof decode>) => {
    let changed = 0
    // Hide overlaid HTML markers when capturing the map; moving a marker alone
    // cannot satisfy this assertion. Only changed heat colours count.
    for (let i = 0; i < before.data.length; i += before.channels) {
      const b = before.data,
        a = after.data
      if ((b[i + 1] > b[i] + 15 || a[i + 1] > a[i] + 15) && Math.abs(b[i] - a[i]) + Math.abs(b[i + 1] - a[i + 1]) > 20)
        changed++
    }
    return changed
  }
  for (const [name, param, heat, targets] of [
    [
      'Starting point A, drag to move',
      'from',
      'from',
      [
        [-122.77958, 53.89848],
        [-122.767, 53.907],
      ],
    ],
    [
      'Destination B, drag to move',
      'to',
      'to',
      [
        [-122.8, 53.894],
        [-122.787, 53.898],
      ],
    ],
  ] as const) {
    const marker = page.getByRole('img', { name })
    const box = await marker.boundingBox()
    const savedPoint = new URL(page.url()).searchParams.get(param)
    const initial = (savedPoint?.split(',').map(Number) ?? [-122.74733, 53.91313]) as Point
    const moveTo = async (target: readonly number[]) => {
      const point = nearbyStop([target[0], target[1]])
      await page.mouse.move(
        box!.x + 18 + ((point[0] - initial[0]) / 360) * worldSize,
        box!.y + 18 + (mercatorY(point[1]) - mercatorY(initial[1])) * worldSize,
        { steps: 12 },
      )
    }
    const before = await snapshot()
    await moveTo(targets[0])
    await expect(page.locator('.mapcn-tooltip')).toBeVisible()
    await page.mouse.move(box!.x + 18, box!.y + 18)
    await page.mouse.down()
    await moveTo(targets[0])
    await expect(page.locator('.mapcn-tooltip')).toHaveCount(0)
    await expect.poll(async () => changedHeatPixels(before, await snapshot())).toBeGreaterThan(100)
    // Still holding: updates are local until release, as in the reference.
    expect(new URL(page.url()).searchParams.get(param)).toBe(savedPoint)
    await expect(
      page.getByRole('button', { name: heat === 'from' ? 'From A' : 'From B', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    const during = await snapshot()
    await moveTo(targets[1])
    await expect(page.locator('.mapcn-tooltip')).toHaveCount(0)
    await expect.poll(async () => changedHeatPixels(during, await snapshot())).toBeGreaterThan(100)
    await page.mouse.up()
    await expect.poll(() => new URL(page.url()).searchParams.get(param)).not.toBe(savedPoint)
    await expect.poll(() => new URL(page.url()).searchParams.get('heat')).toBe(heat)
    await expect(page.getByText('Calculating travel times…')).toHaveCount(0)
    await moveTo(targets[0])
    await expect(page.locator('.mapcn-tooltip')).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('light-mode dragging retains heat across access gaps and generates a finer grid when zooming', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    const state = window as unknown as { liveSpecs: HeatGridSpec[]; heatAlpha: number[] }
    state.liveSpecs = []
    state.heatAlpha = []
    const send = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (...args: Parameters<typeof send>) {
      const message = args[0]
      if (message.heatGrid) state.liveSpecs.push(message.heatGrid)
      return send.apply(this, args)
    }
    const put = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (...args: Parameters<typeof put>) {
      if (this.canvas.width > 200 && this.canvas.height > 200) {
        let alpha = 0
        for (let i = 3; i < args[0].data.length; i += 4) alpha += args[0].data[i]
        state.heatAlpha.push(alpha)
      }
      return put.apply(this, args)
    }
  })
  await stubBasemap(page)
  await page.goto('/dev/transit?to=-122.81364,53.89128')
  await expect(page.getByTestId('journey-duration')).toContainText('30 min')
  const state = () =>
    page.evaluate(() => {
      const value = window as unknown as { liveSpecs: HeatGridSpec[]; heatAlpha: number[] }
      return { specs: value.liveSpecs, alpha: value.heatAlpha }
    })
  await expect.poll(async () => (await state()).alpha.length).toBeGreaterThan(0)
  const baseline = await state()
  const snapshot: TransitData = JSON.parse(
    gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/transit/output/prince_george_travel_time.json.gz'),
    ).toString(),
  )
  const candidates: Point[] = [
    [-122.9, 53.95],
    [-122.88, 53.95],
    [-122.9, 53.9],
  ]
  const off = candidates.find((point) =>
    snapshot.walkNodes.every((node) =>
      Math.hypot((point[0] - node[0]) * 65500, (point[1] - node[1]) * 111320) > (snapshot.meta.markerAccessMeters ?? 180) + 150,
    ),
  )
  expect(off).toBeDefined()
  const box = await page.getByRole('img', { name: 'Starting point A, drag to move' }).boundingBox()
  const initial: Point = [-122.74733, 53.91313]
  const world = 512 * 2 ** 11.1
  const y = (latitude: number) => (1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2
  await page.mouse.move(box!.x + 18, box!.y + 18)
  await page.mouse.down()
  await page.mouse.move(
    box!.x + 18 + ((off![0] - initial[0]) / 360) * world,
    box!.y + 18 + (y(off![1]) - y(initial[1])) * world,
    { steps: 15 },
  )
  await expect(
    page.getByText('No nearby connected street. Showing the last connected preview while you drag.'),
  ).toBeVisible()
  const held = await state()
  expect(held.alpha.slice(baseline.alpha.length).every((alpha) => alpha > 5000)).toBe(true)
  expect(held.alpha.at(-1)).toBeGreaterThan(5000)
  await page.mouse.move(box!.x + 18, box!.y + 18, { steps: 15 })
  await expect(
    page.getByText('No nearby connected street. Showing the last connected preview while you drag.'),
  ).toHaveCount(0)
  await page.mouse.up()
  await expect(page.getByTestId('journey-duration')).toContainText('30 min')
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe('-122.813640,53.891280')
  const before = (await state()).specs.at(-1)!
  const count = (await state()).specs.length
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => (await state()).specs.length).toBeGreaterThan(count)
  await expect
    .poll(async () => {
      const after = (await state()).specs.at(-1)!
      return (after.bbox[2] - after.bbox[0]) / after.cols
    })
    .toBeLessThan((before.bbox[2] - before.bbox[0]) / before.cols)
  await expect(page.getByText('Calculating travel times…')).toHaveCount(0)
  await expect(page.getByTestId('journey-duration')).toContainText('30 min')
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe('-122.813640,53.891280')
  await page.screenshot({ path: 'tmp/transit-live-light.png' })
  expect(errors).toEqual([])
})

test('missing data can be retried and mobile controls remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubBasemap(page)
  let unavailable = true
  await page.route('**/prince_george_travel_time.json.gz', (route) =>
    unavailable ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue(),
  )
  await page.goto('/dev/transit?to=-122.81364,53.89128')
  // The shared layout starts collapsed; expand its mobile sheet.
  await page.getByRole('button', { name: 'Show panel', exact: true }).click()
  await expect(page.getByText(/Failed to fetch.*503/)).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry loading transit data' }).click()
  await expect(page.getByTestId('journey-duration')).toContainText('30 min')
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390)
  await page.screenshot({ path: 'tmp/transit-mobile.png' })
})
