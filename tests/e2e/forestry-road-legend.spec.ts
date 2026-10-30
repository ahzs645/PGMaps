import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 20000 })
test.setTimeout(180000)

async function prepare(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
}

async function mapData(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((key) => key.startsWith('__reactFiber$'))
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
        const features = (id: string) => {
          const source = map.getSource(id)
          return source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection).features : []
        }
        return {
          context: features('road-context').map((feature) => feature.properties?.kind),
          roads: features('road-roads').map((feature) => feature.properties),
          overlay: features('road-overlay').map((feature) => feature.properties),
          drainage: features('road-drainage').map((feature) => feature.properties?.role),
          terrain: map.getLayer('road-terrain') ? map.getLayoutProperty('road-terrain', 'visibility') : null,
        }
      }
    }
    return null
  })
}

async function expandLegend(page: Page) {
  const legend = page.getByTestId('road-terrain-legend')
  if (await legend.getByRole('button', { name: 'Expand legend', exact: true }).isVisible())
    await legend.getByRole('button', { name: 'Expand legend', exact: true }).click()
  return page.getByTestId('road-plan-legend-content')
}

test('legend follows alternative road colours, context visibility, earthworks and labels even with terrain switched off', async ({
  page,
}, info) => {
  await prepare(page)
  const content = await expandLegend(page)
  await expect(content).toContainText('Alternative · Contour alternative · training')
  for (const text of ['Streams', 'Existing roads', 'Harvest areas', 'Review areas'])
    await expect(content.getByText(text, { exact: true })).toHaveCount(1)
  const source = (await mapData(page))!.roads.find((road) => road?.id === 'demo-contour')!
  expect(source.color).toBe('#2563eb')
  await expect(
    content
      .getByText('Alternative · Contour alternative · training', { exact: true })
      .locator('..')
      .locator('span[style]')
      .first(),
  ).toHaveCSS('background-color', 'rgb(37, 99, 235)')
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show harvest areas context', exact: true }).uncheck()
  await expect(content.getByText('Harvest areas', { exact: true })).toHaveCount(0)
  await expect.poll(async () => (await mapData(page))?.context.includes('harvest')).toBe(false)
  await page.getByRole('checkbox', { name: 'Earthworks', exact: true }).uncheck()
  await expect(content.locator('[data-legend-section="earthwork"]')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Labels', exact: true }).uncheck()
  await expect(content.getByText('Station ticks & chainage labels', { exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Contours', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Close map settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Terrain display', exact: true }).click()
  await page.getByRole('option', { name: 'Basemap', exact: true }).click()
  await expect(content.locator('[data-legend-section="terrain"]')).toHaveCount(0)
  await expect(page.getByTestId('road-terrain-legend').locator('.road-map-legend')).toBeVisible()
  await expect(content.getByText('Existing roads', { exact: true })).toHaveCount(1)
  await expect.poll(async () => (await mapData(page))?.terrain).toBe('none')
  await page.getByRole('button', { name: 'Map display settings', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Show harvest areas context', exact: true }).check()
  await page.getByRole('button', { name: 'Close map settings', exact: true }).click()
  await expect(content.getByText('Harvest areas', { exact: true })).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('legend-basemap-context.png') })
})

test('cost-preview legend shows actual reused, loaded and return routes and removes them when preview closes', async ({
  page,
}, info) => {
  await prepare(page)
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page
    .getByRole('button', { name: 'Load Training · connected access, gravel and condition', exact: true })
    .click()
  await page.getByRole('button', { name: 'Compare complete route costs', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Complete route cost comparison', exact: true })
  await dialog.getByRole('button', { name: 'Calculate route comparison', exact: true }).click()
  const candidate = dialog.getByTestId('full-cost-candidate-training-full-cost-short-a')
  await expect(candidate).toHaveAttribute('data-status', 'feasible', { timeout: 120000 })
  await candidate.getByRole('button', { name: /^Preview / }).click()
  const content = await expandLegend(page)
  for (const text of ['Reused access route', 'Loaded material haul', 'Empty return route'])
    await expect(content.getByText(text, { exact: true })).toHaveCount(1)
  await expect
    .poll(async () => (await mapData(page))?.overlay.map((feature) => feature?.pathRole))
    .toEqual(expect.arrayContaining(['access', 'loaded', 'return']))
  await content.locator('[data-legend-section="overlays"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('legend-delivered-haul.png') })
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await expect(content.locator('[data-legend-section="overlays"]')).toHaveCount(0)
})

test('drainage legend follows the actual analysis and drops stale flow overlays', async ({ page }) => {
  await prepare(page)
  await page.getByRole('combobox', { name: 'Road detail view', exact: true }).click()
  await page.getByRole('option', { name: 'Drainage', exact: true }).click()
  const panel = page.getByTestId('road-drainage')
  await panel.getByLabel('Stream from (ha)', { exact: true }).fill('0.5')
  await panel.getByRole('button', { name: 'Run drainage check', exact: true }).click()
  await expect
    .poll(async () => (await mapData(page))?.drainage, { timeout: 60000 })
    .toEqual(expect.arrayContaining(['stream-existing', 'stream-design']))
  const content = await expandLegend(page)
  await expect(content).toContainText('Existing-ground drainage')
  await expect(content).toContainText('Design-surface drainage')
  await panel.getByLabel('Rainfall (mm/h)', { exact: true }).fill('60')
  await expect.poll(async () => (await mapData(page))?.drainage).toEqual([])
  await expect(content.locator('[data-legend-section="drainage"]')).toHaveCount(0)
})

test('phone map tools use icons, centre insert-control plus and remember the hidden editing hint', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 668 })
  await prepare(page)
  const tools = page.getByRole('group', { name: 'Road map tool', exact: true })
  await expect(tools).toBeInViewport()
  const edit = tools.getByRole('button', { name: 'Edit points', exact: true })
  await expect(edit.locator('svg')).toHaveCount(1)
  await expect(edit).toHaveAttribute('title', /drag start\/end controls/)
  await edit.click()
  await expect(edit).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('road-edit-help')).toBeVisible()
  const insert = page.getByRole('button', { name: 'Add control between points 1 and 2', exact: true })
  const circle = (await insert.boundingBox())!
  const plus = (await insert.locator('svg').boundingBox())!
  expect(Math.abs(circle.x + circle.width / 2 - plus.x - plus.width / 2)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(circle.y + circle.height / 2 - plus.y - plus.height / 2)).toBeLessThanOrEqual(0.5)
  await page.getByRole('button', { name: 'Hide editing hint', exact: true }).click()
  await expect(page.getByTestId('road-edit-help')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show editing hint', exact: true })).toBeVisible()
  await tools.getByRole('button', { name: 'Inspect', exact: true }).click()
  await expect(insert).toHaveCount(0)
  await edit.click()
  await expect(page.getByTestId('road-edit-help')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await edit.click()
  await expect(page.getByTestId('road-edit-help')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show editing hint', exact: true }).click()
  await expect(page.getByTestId('road-edit-help')).toBeVisible()
  await page.screenshot({ path: info.outputPath('map-tools-and-edit-hint.png') })
})
