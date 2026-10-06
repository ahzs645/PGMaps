import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

const record = (id: number, locationIds: string[], resourceTypeMain = 'journalArticle', decade = 2020) => ({
  id,
  locationIds,
  resourceTypeMain,
  resourceType: resourceTypeMain,
  decade,
  publicationYear: decade + 1,
  title: `Water research ${id}`,
  author: 'Researcher',
  tags: ['water'],
})
const records = [
  record(1, ['prince_george', 'nechako_river']),
  record(2, ['prince_george'], 'report', 1990),
  record(3, ['nechako_river']),
  record(4, ['nechako_watershed']),
  record(5, ['northern_bc'], 'report', 1990),
]

async function setup(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        glyphs: 'https://glyphs.test/{fontstack}/{range}.pbf',
        sources: {},
        layers: [],
      },
    }),
  )
  await page.route('https://glyphs.test/**', (route) =>
    route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }),
  )
  await page.route('https://projects.ahmadjalil.com/nwsviz/data/**', (route) => {
    const file = route.request().url().split('/').pop()
    const json =
      file === 'overview.json'
        ? { submissionsTotal: 5, locationsTotal: 4, yearRange: { min: 1991, max: 2021 } }
        : file === 'submissions.cleaned.json'
          ? records
          : file === 'decades.cleaned.json'
            ? [
                { decade: 1990, total: 2 },
                { decade: 2020, total: 3 },
              ]
            : [
                { id: 'prince_george', name: 'Prince George', coordinates: { lon: -122.75, lat: 53.92 } },
                { id: 'nechako_river', name: 'Nechako River', coordinates: { lon: -124, lat: 54 } },
              ]
    return route.fulfill({ json })
  })
}

async function mapState(page: Page) {
  return page.locator('.maplibregl-map').evaluate((container) => {
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    // Inspect React's map ref without a production debug handle.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node = key ? (container as any)[key] : null
    for (let depth = 0; node && depth < 100; depth++, node = node.return) {
      for (let hook = node.memoizedState, index = 0; hook && index < 50; index++, hook = hook.next) {
        const map = hook.memoizedState?.current ?? hook.memoizedState
        if (typeof map?.getStyle !== 'function') continue
        const style = map.getStyle()
        const fill = style.layers?.find(
          (layer: { source?: string; type: string }) =>
            layer.source === 'fill-shared-research-regional-boundary' && layer.type === 'fill',
        )
        return {
          center: [map.getCenter().lng, map.getCenter().lat],
          opacity: fill?.paint?.['fill-opacity'],
          boundaryIds:
            style.sources?.['fill-shared-research-regional-boundary']?.data?.features?.map(
              (feature: { id: number }) => feature.id,
            ) ?? [],
        }
      }
    }
    return null
  })
}

for (const width of [1440, 390]) {
  test(`research location filters and exact regional boundary at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await setup(page)
    await page.goto('/dev/projects/nechako-watershed-research-portal')
    if (width === 390) await page.locator('[data-map-mobile-sheet-handle]').press('End')
    const sidebar = page.locator('[data-explorer-sidebar-scroll]')
    const category = sidebar.getByRole('button', { name: /Journal Articles/ })
    const location = sidebar.getByRole('button', { name: /^Prince George/ })
    expect(await category.evaluate((node) => getComputedStyle(node).fontSize)).toBe('12px')
    expect(await location.evaluate((node) => getComputedStyle(node).fontSize)).toBe('12px')
    expect(await sidebar.evaluate((node) => getComputedStyle(node).scrollbarGutter)).toBe('stable')

    const overlay = page.getByRole('button', { name: /Show Nechako River boundary/ })
    const regionalSection = sidebar
      .getByRole('heading', { name: 'Nechako River', exact: true })
      .locator('xpath=ancestor::section[1]')
    await expect(
      regionalSection.getByRole('button', { name: /publications tagged to watershed region only/ }),
    ).toHaveCount(1)
    await expect(regionalSection.getByRole('button', { name: /Show Nechako River boundary/ })).toHaveText(
      'Show Nechako River boundary',
    )
    await regionalSection.getByRole('button', { name: /publications tagged to watershed region only/ }).click()
    await expect(page.getByRole('dialog', { name: 'Regional Publications' }).locator('article')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(overlay).toHaveAttribute('aria-pressed', 'false')
    await overlay.click()
    const count = page.locator('[data-regional-boundary-count]')
    await expect(count).toContainText('2')
    await expect.poll(async () => (await mapState(page))?.boundaryIds).toEqual([8886])
    const slider = page.getByRole('slider', { name: 'Boundary shading' })
    await slider.fill('0.5')
    await expect.poll(async () => (await mapState(page))?.opacity).toBe(0.5)

    await location.click()
    await expect(location).toHaveAttribute('aria-pressed', 'true')
    await expect(count).toContainText('0')
    await expect.poll(async () => (await mapState(page))?.center[0]).toBeCloseTo(-122.75, 2)
    await expect(page.locator('.maplibregl-popup')).toContainText('2 publications')
    await sidebar.getByRole('button', { name: 'Clear location filter' }).click()
    await expect(count).toContainText('2')

    if (width === 1440) await location.click({ button: 'right' })
    else await sidebar.getByRole('button', { name: 'Exclude Prince George' }).click()
    await expect(sidebar.getByRole('button', { name: 'Restore Prince George' })).toBeVisible()
    await sidebar.getByRole('button', { name: /^Nechako River/ }).click()
    await expect(page.locator('.maplibregl-popup')).toContainText('1 publications')
    await sidebar.getByRole('button', { name: 'Restore Prince George' }).click()
    await expect(page.locator('.maplibregl-popup')).toContainText('2 publications')
    await sidebar.getByRole('button', { name: 'Clear location filter' }).click()

    await category.click()
    await expect(count).toContainText('1')
    await page.getByPlaceholder('Search titles, authors, tags…').fill('no-such-record')
    await expect(count).toContainText('0')
    await expect(sidebar.getByText('No locations match filters')).toBeVisible()
    await page.getByPlaceholder('Search titles, authors, tags…').fill('')
    await overlay.click()
    await expect(count).toHaveCount(0)
    await expect.poll(async () => (await mapState(page))?.boundaryIds).toEqual([])
    await overlay.click()
    await expect(count).toContainText('1')
    await expect(slider).toHaveValue('0.5')
    await expect.poll(async () => (await mapState(page))?.opacity).toBe(0.5)
    if (width === 390) await page.locator('[data-map-mobile-sheet-handle]').press('Home')
    await page.screenshot({ path: testInfo.outputPath(`research-${width}.png`) })
    expect(errors).toEqual([])
  })
}

test('regional boundary failure can be retried without losing the research controls', async ({ page }) => {
  await setup(page)
  let failed = true
  await page.route('**/named_watersheds_stream_order_8_50m.geojson.gz', (route) =>
    failed ? route.fulfill({ status: 503 }) : route.continue(),
  )
  await page.goto('/dev/projects/nechako-watershed-research-portal')
  await page.getByRole('button', { name: /Show Nechako River boundary/ }).click()
  await expect(page.getByRole('alert')).toContainText('Boundary unavailable')
  failed = false
  await page.getByRole('button', { name: 'Retry boundary' }).click()
  await expect.poll(async () => (await mapState(page))?.boundaryIds).toEqual([8886])
  await expect(page.getByRole('alert')).toHaveCount(0)
})
