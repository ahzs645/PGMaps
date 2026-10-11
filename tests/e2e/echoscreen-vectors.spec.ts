import { expect, test, type Page } from '@playwright/test'
import { decode, encode } from 'fast-png'
import type MapLibreGL from 'maplibre-gl'

declare global {
  interface Window {
    __echoMap: MapLibreGL.Map
  }
}

async function setup(page: Page) {
  await page.route(/https:\/\/.*cartocdn.*\/style\.json/, (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        glyphs: 'https://glyphs.test/{fontstack}/{range}.pbf',
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }],
      },
    }),
  )
  await page.route('https://nechakowatershed-portal.ca/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(encode({ width: 1, height: 1, data: new Uint8Array(4), channels: 4 })),
    }),
  )
}

async function captureMap(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        let container = document.querySelector('.maplibregl-map'),
          key: string | undefined
        while (container) {
          key = Object.keys(container).find((k) => k.startsWith('__reactFiber$'))
          if (key) break
          container = container.parentElement
        }
        if (!container || !key) return false
        type Hook = { memoizedState?: unknown; next?: Hook }
        type Fiber = { memoizedState?: Hook; return?: Fiber }
        let node = (container as unknown as Record<string, Fiber>)[key]
        for (let depth = 0; node && depth < 100; depth++, node = node.return!) {
          for (let hook = node.memoizedState, i = 0; hook && i < 50; hook = hook.next, i++) {
            const value = hook.memoizedState as { current?: unknown } | undefined
            for (const candidate of [value, value?.current]) {
              const map = candidate as MapLibreGL.Map | undefined
              if (typeof map?.getStyle === 'function' && typeof map?.project === 'function') {
                window.__echoMap = map
                return map.loaded() && !map.isMoving()
              }
            }
          }
        }
        return false
      }),
    )
    .toBe(true)
}

async function ready(page: Page, id: string) {
  const status = page.getByTestId('project-vector-status')
  await expect(status).toHaveAttribute('data-layer', id)
  await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 45_000 })
  await captureMap(page)
}

test('archive vectors retain colours and exact picks, traverse scenes, and recover from an error', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await setup(page)
  const problems: string[] = [],
    fetched: string[] = [],
    climateWms: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('503')) problems.push(m.text())
  })
  page.on('request', (r) => {
    if (r.url().includes('/echoscreen-climate/')) fetched.push(r.url())
    if (r.url().includes('nechakowatershed') && /txgt|Days|precip|GetLegendGraphic/i.test(decodeURIComponent(r.url())))
      climateWms.push(r.url())
  })
  await page.goto('/dev/projects/echoscreen-climate-health')
  await ready(page, 'hot-days-future')
  expect(fetched.some((url) => /hot-days-past|precip-change/.test(url))).toBe(false)
  await page.screenshot({ path: info.outputPath('archive-future-desktop.png') })
  await page.getByRole('tab', { name: 'Layers', exact: true }).click()
  for (const label of [
    'Watershed Labels',
    'Hospitals',
    'Northern Health',
    'River and lake network',
    'Fraser and Nechako watersheds',
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
  }
  const slider = page.getByRole('slider', { name: 'Raster opacity' })
  await slider.focus()
  await page.keyboard.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', '100')
  await page.evaluate(() => window.__echoMap.jumpTo({ center: [-122.79166666666656, 53.8750025257732], zoom: 8 }))
  await captureMap(page)
  const canvas = page.locator('.maplibregl-canvas')
  const point = await page.evaluate(() => {
    const p = window.__echoMap.project([-122.79166666666656, 53.8750025257732])
    return { x: p.x, y: p.y }
  })
  const box = (await canvas.boundingBox())!
  // Actual GPU paint, rather than merely a loaded manifest or visible legend.
  await expect
    .poll(async () => {
      const png = decode(
        await page.screenshot({
          clip: { x: Math.floor(box.x + point.x), y: Math.floor(box.y + point.y), width: 1, height: 1 },
        }),
      )
      return Array.from(png.data).slice(0, 3)
    })
    .toEqual([253, 151, 66])
  await canvas.click({ position: point })
  await expect(page.getByTestId('project-vector-value')).toHaveAttribute('data-value', '39.28333282470703')
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  const renderedBlocks = () =>
    page.evaluate(
      () =>
        (
          window.__echoMap as MapLibreGL.Map & {
            __deck?: { props: { layers: Array<{ id: string; props: { visible: boolean } }> } }
          }
        ).__deck?.props.layers.filter((layer) => layer.props.visible && layer.id.startsWith('categorical-raster-'))
          .length ?? 0,
    )
  const futureBlocks = await renderedBlocks()
  expect(futureBlocks).toBeGreaterThan(0)
  await page.getByRole('button', { name: /^Days >29°C NH, 1971-2000/ }).click()
  await expect.poll(renderedBlocks).toBeGreaterThan(futureBlocks)
  await page.getByRole('button', { name: /^Days >29°C NH, 1971-2000/ }).click()
  await page.getByRole('button', { name: /^Days >29°C NH, 2071-2100/ }).click()
  await expect(page.getByTestId('project-vector-status')).toHaveCount(0)
  await page.getByRole('button', { name: /^Days >29°C NH, 1971-2000/ }).click()
  await ready(page, 'hot-days-past')
  await page.keyboard.press('Escape')
  for (const [scene, id] of [
    ['Winter Change', 'precip-change'],
    ['Summer Change', 'summer-precip-change'],
    ['Future Heat', 'hot-days-future'],
    ['Methods', 'hot-days-future'],
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${scene}`) }).click()
    await ready(page, id)
    await page.screenshot({ path: info.outputPath(`${id}-desktop.png`) })
  }
  await page.getByRole('button', { name: /^Context/ }).click()
  await expect(page.getByTestId('project-vector-status')).toHaveCount(0)
  let fail = true
  await page.route('**/echoscreen-climate/hot-days-future/manifest.json', (route) =>
    fail ? route.fulfill({ status: 503 }) : route.continue(),
  )
  await page.getByRole('button', { name: /^Future Heat/ }).click()
  await expect(page.getByTestId('project-vector-status')).toHaveAttribute('data-status', 'error')
  fail = false
  await page.getByRole('button', { name: 'Retry climate layer' }).click()
  await ready(page, 'hot-days-future')
  expect(climateWms).toEqual([])
  expect(problems).toEqual([])
})

test('phone legend and sheet expose every archive layer and opacity control', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/dev/projects/echoscreen-climate-health')
  await page.getByRole('button', { name: 'Expand legend' }).click()
  await ready(page, 'hot-days-future')
  await page.screenshot({ path: info.outputPath('archive-future-phone.png') })
  await page.getByRole('button', { name: 'Show panel' }).click()
  for (const [scene, id] of [
    ['Winter Change', 'precip-change'],
    ['Summer Change', 'summer-precip-change'],
    ['Future Heat', 'hot-days-future'],
    ['Methods', 'hot-days-future'],
  ]) {
    await page.getByRole('button', { name: scene, exact: true }).click()
    await ready(page, id)
  }
  await page.getByRole('button', { name: 'Context', exact: true }).click()
  await expect(page.getByTestId('project-vector-status')).toHaveCount(0)
  // The sheet opens halfway; drag it fully up to scroll to the lower controls.
  const handle = (await page.getByRole('separator', { name: 'Drag to resize sheet' }).boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 8)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, 90, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('[data-map-mobile-sheet-content]')).toHaveClass(/touch-auto/)
  await page.getByRole('button', { name: /^Days >29°C NH, 1971-2000/ }).click()
  await ready(page, 'hot-days-past')
  const slider = page.getByRole('slider', { name: 'Raster opacity' })
  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '20')
  await page.screenshot({ path: info.outputPath('archive-controls-phone.png') })
  expect(errors).toEqual([])
})
