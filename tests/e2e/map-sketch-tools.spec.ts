import { expect, test, type Page } from '@playwright/test'
import { createFullCostTrainingProject } from '../../src/pages/dev-forestry-roads/trainingFullCostScenario'
import { openWorkbench } from './road-workbench'
import { openRoadPanel } from './road-sidebar'

/**
 * The shared sketch (`map-sketch.tsx`) and measure tool (`map-measure.tsx`) on the three pages that
 * use them, and the shared Map / Satellite basemap on the road plan.
 */
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(180_000)

async function stubBasemap(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
}

async function clickAt(
  page: Page,
  canvas: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
) {
  await page.mouse.click(canvas.x + canvas.width * x, canvas.y + canvas.height * y)
}

const TRIANGLE = [
  [0.4, 0.4],
  [0.55, 0.4],
  [0.55, 0.55],
] as const

test('/dev/interact measures a polygon that closes on its first point', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubBasemap(page)
  await page.goto('/dev/interact')
  await page.getByRole('button', { name: 'Measure areas' }).click()
  await page.getByRole('menuitem', { name: 'Polygon' }).click()
  const canvas = (await page.locator('.maplibregl-canvas').first().boundingBox())!
  for (const [x, y] of TRIANGLE) await clickAt(page, canvas, x, y)
  await expect(page.getByTestId('measurement-vertex')).toHaveCount(3)
  const card = page.getByText('Polygon measurement', { exact: true }).locator('xpath=../../..')
  await expect(card.getByRole('button', { name: 'Close polygon' })).toBeEnabled()
  // A click on the first point closes it, as the card says.
  await clickAt(page, canvas, ...TRIANGLE[0])
  await expect(card.getByRole('button', { name: 'Close polygon' })).toHaveCount(0)
  await expect(card).toContainText(/Area:?\s*[\d.,]+\s*(ha|km²)/)
  await page.getByRole('button', { name: 'Clear measurement' }).click()
  await expect(page.getByTestId('measurement-vertex')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the road plan measures, switches to satellite and closes a drawn block on its first point', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubBasemap(page)
  await page.route('https://services.arcgisonline.com/**', (route) => route.fulfill({ status: 204, body: '' }))
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await pending
  ).setFiles({
    name: 'sketch.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createFullCostTrainingProject())),
  })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 60_000 })
  const plan = page.getByTestId('road-plan-view')
  const canvas = (await plan.locator('canvas').first().boundingBox())!

  // Basemap: the same choices as the visual-quality maps, imagery under the plan's layers.
  await plan.getByRole('button', { name: 'Basemap', exact: true }).click()
  await plan.locator('[data-basemap="satellite"] input').check()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pgmaps-road-basemap'))).toBe('satellite')

  // Measure: a plan tool beside Peg and Query, opening on a distance.
  await plan.getByRole('button', { name: 'Measure', exact: true }).click()
  const measure = page.getByTestId('map-measure-panel')
  await expect(measure).toBeVisible()
  await clickAt(page, canvas, 0.3, 0.5)
  await clickAt(page, canvas, 0.6, 0.5)
  await expect(page.getByTestId('road-measure-vertex')).toHaveCount(2)
  await expect(measure.getByTestId('map-measure-readout')).toContainText(/Length:?\s*[\d.,]+\s*(m|km)/)
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('road-measure-vertex')).toHaveCount(1)
  await measure.getByRole('button', { name: 'Area', exact: true }).click()
  await expect(page.getByTestId('road-measure-vertex')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(measure).toHaveCount(0)

  // Draw block: the same sketch, closed by a click on its first point rather than Finish.
  await openRoadPanel(page, 'Access from FSR')
  await page.getByTestId('road-access-review').getByRole('button', { name: 'Draw block', exact: true }).click()
  await expect(page.getByTestId('pegging-feedback')).toContainText('Draw harvest block')
  for (const [x, y] of TRIANGLE) await clickAt(page, canvas, x, y)
  await expect(page.getByTestId('road-area-draft-vertex')).toHaveCount(3)
  await expect(page.getByTestId('pegging-readout')).toContainText(/Area:?\s*[\d.,]+\s*(ha|km²)/)
  await clickAt(page, canvas, ...TRIANGLE[0])
  await expect(page.getByTestId('pegging-feedback')).toHaveCount(0)
  await expect(page.getByTestId('road-area-draft-vertex')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the visual-quality plan measures, and traces a block that closes on its first point', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await stubBasemap(page)
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) => route.fulfill({ status: 503, body: '' }))
  await page.addInitScript(() => window.localStorage.clear())
  await page.goto('/dev/forestry/visual-quality')
  await expect(page.getByRole('heading', { name: 'Visual quality' })).toBeVisible()
  const plan = page.getByTestId('visuals-plan-map')
  const canvas = (await plan.locator('.maplibregl-canvas').first().boundingBox())!

  await plan.getByRole('button', { name: 'Measure', exact: true }).click()
  const measure = page.getByTestId('map-measure-panel')
  await measure.getByRole('button', { name: 'Area', exact: true }).click()
  for (const [x, y] of TRIANGLE) await clickAt(page, canvas, x, y)
  await expect(page.getByTestId('visuals-measure-vertex')).toHaveCount(3)
  await measure.getByRole('button', { name: 'Close polygon', exact: true }).click()
  await expect(measure.getByTestId('map-measure-readout')).toContainText(/Area:?\s*[\d.,]+\s*(ha|km²)/)
  await measure.getByRole('button', { name: 'Close measure', exact: true }).click()
  await expect(measure).toHaveCount(0)

  // Drawing a block uses the same interaction; the closing click adds the block, not a fourth point.
  const draw = page.getByRole('button', { name: 'Draw block', exact: true })
  for (const id of ['identify', 'visit', 'design', 'assess', 'rate'] as const) {
    if (await draw.isVisible()) break
    await page.locator(`[data-via-step="${id}"]`).click()
  }
  await draw.click()
  for (const [x, y] of TRIANGLE) await clickAt(page, canvas, x, y)
  await expect(page.getByTestId('visuals-draft-vertex')).toHaveCount(3)
  await clickAt(page, canvas, ...TRIANGLE[0])
  await expect(page.getByTestId('visuals-draft-vertex')).toHaveCount(0)
  await expect(draw).toHaveAttribute('aria-pressed', 'false')
  expect(errors).toEqual([])
})
