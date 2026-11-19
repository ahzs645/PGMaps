import { expect, test, type Page } from '@playwright/test'
import { openWorkbench } from './road-workbench'

/**
 * The Layers list (`ReferencePanel.tsx`) shows and hides whole groups as well as single layers, lists the terrain with
 * the commands that load another, and changes the basemap the plan's own Basemap button sets.
 */
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

/** The design roads the plan draws, by id, read from the MapLibre map behind the plan. */
async function drawnRoads(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!container || !key) return []
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map = value && typeof value === 'object' && 'current' in value ? value.current : (value as Map)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-roads')
        const data = source?.type === 'geojson' ? (source.serialize().data as GeoJSON.FeatureCollection) : null
        return [...new Set((data?.features ?? []).map((feature) => String(feature.properties?.id)))]
      }
    }
    return []
  })
}

test('Layers hides a group or everything, lists the terrain and changes the plan’s basemap', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await expect.poll(() => drawnRoads(page)).not.toHaveLength(0)
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const layers = page.getByTestId('road-reference-layers')
  await expect(layers).toBeVisible()

  // The group's eye takes every design road off the plan, and puts them back.
  await layers.getByRole('button', { name: 'Hide all design roads', exact: true }).click()
  await expect.poll(() => drawnRoads(page)).toHaveLength(0)
  await layers.getByRole('button', { name: 'Show all design roads', exact: true }).click()
  await expect.poll(() => drawnRoads(page)).not.toHaveLength(0)

  // One road's own eye takes that road alone off the plan.
  const every = (await drawnRoads(page)).length
  await layers
    .getByRole('button', { name: /^Hide road / })
    .first()
    .click()
  await expect.poll(async () => (await drawnRoads(page)).length).toBe(every - 1)
  await layers
    .getByRole('button', { name: /^Show road / })
    .first()
    .click()
  await expect.poll(async () => (await drawnRoads(page)).length).toBe(every)

  // Hide all switches roads and base layers off together; Show all brings them back.
  await layers.getByRole('button', { name: 'Hide all layers', exact: true }).click()
  await expect.poll(() => drawnRoads(page)).toHaveLength(0)
  await expect(layers.getByRole('button', { name: /^Show NRCan/ })).toBeVisible()
  await layers.getByRole('button', { name: 'Show all layers', exact: true }).click()
  await expect.poll(() => drawnRoads(page)).not.toHaveLength(0)
  await expect(layers.getByRole('button', { name: /^Hide NRCan/ })).toBeVisible()

  // The terrain is listed with Load 1 m DEM, the same command the Terrain tab runs.
  const terrain = layers.locator('[data-terrain-group]')
  await expect(terrain).toContainText('m cells')
  await terrain.getByRole('button', { name: /Load 1 m DEM/ }).click()
  await expect(page.getByRole('dialog', { name: 'Load 1 m DEM' })).toBeVisible()
  await page
    .getByRole('dialog', { name: 'Load 1 m DEM' })
    .getByRole('button', { name: 'Close', exact: true })
    .first()
    .click()

  // The basemap is changed here and read by the plan's Basemap button: one choice.
  await expect(layers.locator('[data-base-layer="basemap"]')).toContainText('Basemap: Map')
  await layers.getByRole('button', { name: 'Change the basemap', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Basemap' })
    .getByRole('button', { name: /Satellite/ })
    .click()
  await expect(layers.locator('[data-base-layer="basemap"]')).toContainText('Basemap: Satellite')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await expect(page.locator('[data-basemap="satellite"] input[type="radio"]')).toBeChecked()
  await page.keyboard.press('Escape')

  // The basemap's eye draws the plan on a plain background: None in the plan's Basemap button.
  await layers.getByRole('button', { name: 'Hide the basemap', exact: true }).click()
  await expect(layers.locator('[data-base-layer="basemap"]')).toContainText('(hidden)')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await expect(page.locator('[data-basemap="none"] input[type="radio"]')).toBeChecked()
  await page.locator('[data-basemap="satellite"] input').check()
  await expect(layers.locator('[data-base-layer="basemap"]')).not.toContainText('(hidden)')
  expect(errors).toEqual([])
})

test('Layers lists the layer drawn on top first, and a grip moves a layer in the draw order', async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Layers', exact: true }).last().click()
  const layers = page.getByTestId('road-reference-layers')
  const line = (name: string, offset: number) => ({
    name: `${name}.geojson`,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name },
            geometry: {
              type: 'LineString',
              coordinates: [
                [-122.72 + offset, 53.89],
                [-122.71 + offset, 53.895],
              ],
            },
          },
        ],
      }),
    ),
  })
  const pending = page.waitForEvent('filechooser')
  await layers.getByRole('button', { name: 'Add files', exact: true }).click()
  await (await pending).setFiles([line('first', 0), line('second', 0.002)])
  await page
    .getByRole('dialog', { name: 'Import layers', exact: true })
    .getByRole('button', { name: 'Import layers', exact: true })
    .click()
  // Lines read as roads offer their 1 m DEM boxes on import; that dialog is not this test's.
  const dem = page.getByRole('dialog', { name: 'Load 1 m DEM', exact: true })
  await expect(dem).toBeVisible()
  await dem.getByRole('button', { name: 'Close', exact: true }).first().click()
  const order = () =>
    layers
      .locator('[data-layer-source]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-layer-source')))
  // Imported in that order, the second draws over the first, so it is listed first.
  await expect.poll(order).toEqual(['second.geojson', 'first.geojson'])
  await layers.getByRole('button', { name: 'Move layer first', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  await expect.poll(order).toEqual(['first.geojson', 'second.geojson'])
  // One undo step puts the order back.
  await page.locator('[data-command="undo"]:visible').first().click()
  await expect.poll(order).toEqual(['second.geojson', 'first.geojson'])
})
