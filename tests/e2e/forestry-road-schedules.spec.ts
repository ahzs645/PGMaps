import { openWorkbench } from './road-workbench'
import { expect, test, type Page } from '@playwright/test'
import { choose } from './road-select'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

async function prepare(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('road-section-chart')).toBeVisible()
  // Reach the live MapLibre instance through React, then record every setData it receives.
  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')!
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))!
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
        const scope = window as unknown as { roadMap: Map; roadSetData: string[] }
        scope.roadMap = map
        scope.roadSetData = []
        for (const id of Object.keys(map.getStyle().sources)) {
          const source = map.getSource(id) as import('maplibre-gl').GeoJSONSource
          if (source.type !== 'geojson') continue
          const setData = source.setData.bind(source)
          source.setData = (data, wait) => {
            scope.roadSetData.push(id)
            return setData(data, wait as never)
          }
        }
        return
      }
    }
    throw Error('The plan map was not found.')
  })
}

test('a scrub updates only the selected-station source, so the line and dot move together', async ({ page }) => {
  await prepare(page)
  const next = page.getByRole('button', { name: 'Next road station', exact: true })
  const marker = page.getByTestId('road-active-map-station')
  const start = await marker.getAttribute('data-chainage')
  await page.evaluate(() => ((window as unknown as { roadSetData: string[] }).roadSetData = []))
  for (let i = 0; i < 6; i++) await next.click()
  await expect(marker).not.toHaveAttribute('data-chainage', start!)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { roadSetData: string[] }).roadSetData.length))
    .toBeGreaterThan(0)
  const sent = await page.evaluate(() => (window as unknown as { roadSetData: string[] }).roadSetData)
  expect([...new Set(sent)]).toEqual(['road-section'])
  const layers = await page.evaluate(() => {
    const map = (window as unknown as { roadMap: import('maplibre-gl').Map }).roadMap
    return ['road-section', 'road-section-point'].map((id) => map.getLayer(id)?.source)
  })
  expect(layers).toEqual(['road-section', 'road-section'])
})

test('the plan map and its markers follow a pane boundary with no blank frame', async ({ page }) => {
  await prepare(page)
  // Observers run in creation order, so this one reads the canvas in the frame the map just resized
  // in, before it is presented. A resize without its redraw reads back cleared here.
  await page.evaluate(() => {
    const scope = window as unknown as {
      roadMap: import('maplibre-gl').Map
      roadFrames: { painted: number; matched: boolean }[]
      roadPaint: ResizeObserver
    }
    const map = scope.roadMap
    const probe = document.createElement('canvas')
    probe.width = probe.height = 32
    const context = probe.getContext('2d', { willReadFrequently: true })!
    scope.roadFrames = []
    scope.roadPaint = new ResizeObserver(() => {
      context.clearRect(0, 0, 32, 32)
      context.drawImage(map.getCanvas(), 0, 0, 32, 32)
      const pixels = context.getImageData(0, 0, 32, 32).data
      let painted = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) painted++
      scope.roadFrames.push({ painted, matched: map.transform.width === map.getContainer().clientWidth })
    })
    scope.roadPaint.observe(map.getContainer())
  })
  const handle = page.getByRole('separator', { name: 'Resize plan and view column', exact: true })
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + 20
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 140, y, { steps: 12 })
  await page.mouse.move(x - 100, y, { steps: 12 })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { roadFrames: unknown[] }).roadFrames.length))
    .toBeGreaterThan(4)
  const frames = await page.evaluate(
    () => (window as unknown as { roadFrames: { painted: number; matched: boolean }[] }).roadFrames,
  )
  await page.mouse.up()
  // Skip the observer's first call, which reports the size it started with rather than a resize.
  const drag = frames.slice(1)
  expect(drag.filter((frame) => !frame.matched)).toEqual([])
  expect(drag.filter((frame) => frame.painted === 0)).toEqual([])
})

test('the station table keeps one toolbar row and its popovers open above a fullscreen pane', async ({ page }) => {
  await prepare(page)
  await choose(page.getByRole('combobox', { name: 'Road view layout' }), { label: 'Plan · profile · section · data' })
  await expect(page.getByRole('tablist', { name: 'Road data schedule', exact: true })).toBeVisible()
  const filter = page.getByRole('button', { name: 'Filter stations', exact: true })
  const columns = page.getByRole('button', { name: 'Choose columns', exact: true })
  await filter.click()
  await expect(page.getByLabel('Station table range start', { exact: true })).toBeVisible()
  await page.getByText('Flagged only', { exact: true }).click()
  // Typing a value past the start must survive until it is committed.
  const end = page.getByLabel('Station table range end', { exact: true })
  await page.getByLabel('Station table range start', { exact: true }).fill('100')
  await end.fill('250')
  await end.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Filter stations, 2 active', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show the full range', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filter stations, 1 active', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show all stations', exact: true }).click()
  expect(Math.abs((await filter.boundingBox())!.y - (await columns.boundingBox())!.y)).toBeLessThan(1)

  await page.getByRole('button', { name: /^Fullscreen Station data/ }).click()
  await columns.click()
  const mass = page.getByRole('checkbox', { name: 'Mass', exact: true })
  await expect(mass).toBeVisible()
  // Under the panel's stacking level this click would land on the table behind it.
  await mass.check()
  await expect(page.getByTestId('road-station-table').locator('thead')).toContainText('Mass')
})

test('vertical controls read as a table and crossing icons sit centred on their marker', async ({ page }) => {
  await prepare(page)
  await choose(page.getByRole('combobox', { name: 'Road view layout' }), { label: 'Plan · profile · section · data' })
  await page.getByRole('tab', { name: 'Vertical controls', exact: true }).click()
  const table = page.getByTestId('road-vertical-control-table')
  await expect(table).toBeVisible()
  const row = table.locator('tbody tr').first()
  expect((await row.boundingBox())!.height).toBeLessThan(32)
  await expect(row.getByText('Schedule PVI 1 chainage', { exact: true })).not.toBeInViewport()
  const pvi = row.locator('td').first()
  const before = (await pvi.boundingBox())!.x
  await table.locator('xpath=..').evaluate((port) => (port.scrollLeft = 200))
  expect(Math.abs((await pvi.boundingBox())!.x - before)).toBeLessThan(1)
  // A round-trip through blur must not rewrite the unrounded stored value behind a rounded display.
  const chainage = page.getByLabel('Schedule PVI 2 chainage', { exact: true })
  const shown = await chainage.inputValue()
  await chainage.focus()
  await chainage.blur()
  await expect(chainage).toHaveValue(shown)

  const crossing = page.getByRole('button', { name: /^Select crossing/ }).first()
  await crossing.scrollIntoViewIfNeeded()
  const box = (await crossing.boundingBox())!
  const icon = (await crossing.locator('svg').boundingBox())!
  expect(box.width).toBe(box.height)
  expect(Math.abs(box.x + box.width / 2 - (icon.x + icon.width / 2))).toBeLessThan(0.51)
  expect(Math.abs(box.y + box.height / 2 - (icon.y + icon.height / 2))).toBeLessThan(0.51)
})
