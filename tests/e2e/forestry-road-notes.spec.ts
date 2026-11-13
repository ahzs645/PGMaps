import { openWorkbench } from './road-workbench'
import { expect, test, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  return errors
}

async function saveProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const file = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk))
  await page.getByTestId('road-files-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** The plan's MapLibre map, read from the rendered component; no app state is injected. */
async function harvestPixel(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!container || !key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: unknown; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState as { current?: Map } | Map | undefined
        const map = (value && typeof value === 'object' && 'current' in value ? value.current : value) as
          | Map
          | undefined
        if (typeof map?.getTerrain !== 'function') continue
        const hit = map
          .queryRenderedFeatures({ layers: ['road-context-fill'] })
          .find((feature) => feature.properties?.kind === 'harvest')
        if (!hit || hit.geometry.type !== 'Polygon') return null
        const ring = hit.geometry.coordinates[0]
        const centre = ring.reduce((sum, p) => [sum[0] + p[0] / ring.length, sum[1] + p[1] / ring.length], [0, 0])
        const pixel = map.project(centre as [number, number])
        return { x: pixel.x, y: pixel.y }
      }
    return null
  })
}

test('map notes draw with every tool, save in their own collection, undo and hide', async ({ page }) => {
  // Four drawings, a save, undo and hide: past the default budget when the browsers share a CPU.
  test.setTimeout(120_000)
  const errors = await prepare(page)
  const before = await saveProject(page)
  const canvas = page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas')
  const box = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const
  const closeNote = () => page.getByRole('button', { name: 'Close note', exact: true }).click()
  const canvasElement = page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas')
  // A tool shows a crosshair once it is listening to the map; drawing before then would pan instead.
  const pick = async (tool: string) => {
    await bar.getByRole('button', { name: tool, exact: true }).click()
    await expect(canvasElement).toHaveCSS('cursor', 'crosshair')
  }

  await page.getByRole('button', { name: 'Map notes', exact: true }).click()
  const bar = page.getByRole('toolbar', { name: 'Map notes', exact: true })
  await pick('Pin')
  await page.mouse.click(...at(0.3, 0.3))
  // A note just drawn opens its card with the text field ready.
  await expect(page.getByLabel('Note text', { exact: true })).toBeFocused()
  await page.keyboard.type('Check the culvert here')
  await closeNote()

  await pick('Line')
  await page.mouse.click(...at(0.55, 0.25))
  await page.mouse.click(...at(0.65, 0.35))
  await page.mouse.dblclick(...at(0.72, 0.3))
  await page.getByLabel('Note text', { exact: true }).fill('Haul route')
  await closeNote()

  await pick('Area')
  for (const point of [at(0.2, 0.6), at(0.35, 0.58), at(0.38, 0.75)]) await page.mouse.click(...point)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('road-note-card')).toBeVisible()
  await closeNote()

  await pick('Pen')
  await page.mouse.move(...at(0.6, 0.6))
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(...at(0.6 + i * 0.01, 0.6 + Math.sin(i / 3) * 0.05))
  await page.mouse.up()
  await closeNote()

  const saved = await saveProject(page)
  expect(saved.notes?.map((note) => note.kind)).toEqual(['pin', 'line', 'area', 'sketch'])
  expect(saved.notes?.[1]).toMatchObject({ text: 'Haul route', arrow: true })
  expect(saved.notes?.[0].text).toBe('Check the culvert here')
  // Notes never touch the design: everything else in the project is as it was.
  expect({ ...saved, notes: undefined }).toEqual({ ...before, notes: undefined })
  // Freehand strokes keep their shape without storing every pointer event.
  expect(saved.notes?.[3].points.length).toBeLessThan(21)

  // Hiding notes hides their labels and the layer; showing them brings both back.
  await expect(page.getByText('Haul route', { exact: true })).toBeVisible()
  await bar.getByRole('button', { name: 'Hide map notes', exact: true }).click()
  await expect(page.getByText('Haul route', { exact: true })).toHaveCount(0)
  await bar.getByRole('button', { name: 'Show map notes', exact: true }).click()
  await expect(page.getByText('Haul route', { exact: true })).toBeVisible()

  // A note edit is an ordinary project edit: undo takes the last note back off.
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect.poll(async () => (await saveProject(page)).notes?.length).toBe(3)
  expect(errors).toEqual([])
})

test('a cutblock clicked on the plan shows its size and harvest record there', async ({ page }) => {
  const errors = await prepare(page)
  const box = (await page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas').boundingBox())!
  const pixel = await harvestPixel(page)
  expect(pixel).not.toBeNull()
  await page.mouse.click(box.x + pixel!.x, box.y + pixel!.y)
  const card = page.getByTestId('road-cutblock-card')
  await expect(card).toContainText(/Area\s*\d+\.\d{2} ha/)
  await expect(card).toContainText(/Perimeter\s*\d/)
  await page.getByRole('button', { name: 'Review cutblock', exact: true }).click()
  await expect(page.getByTestId('road-cutblock-history-evidence')).toBeVisible()
  expect(errors).toEqual([])
})

/** A pixel on the first rendered existing road, and whether the plan's overlay highlights it. */
async function roadState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    const key = container && Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!container || !key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: unknown; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!)
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState as { current?: Map } | Map | undefined
        const map = (value && typeof value === 'object' && 'current' in value ? value.current : value) as
          | Map
          | undefined
        if (typeof map?.getTerrain !== 'function') continue
        const layers = map
          .getStyle()
          .layers.filter((layer) => layer.id.startsWith('road-history-'))
          .map((l) => l.id)
        const hit = map
          .queryRenderedFeatures({ layers })
          .find((feature) => feature.properties?.kind === 'existing-road' && feature.geometry.type === 'LineString')
        const overlay = map.getSource('road-overlay')
        const data = overlay?.type === 'geojson' ? (overlay.serialize().data as GeoJSON.FeatureCollection) : null
        const highlighted = data?.features.filter((f) => f.properties?.kind === 'reviewed-existing-road').length ?? 0
        if (!hit || hit.geometry.type !== 'LineString') return { pixel: null, id: null, highlighted }
        // A point along the road, inside the map, where no designed road lies on top: the plan rightly
        // gives a designed road the click there.
        const line = hit.geometry.coordinates as [number, number][]
        const canvas = map.getCanvas()
        for (let i = 1; i < line.length; i++)
          for (const t of [0.5, 0.25, 0.75]) {
            const a = map.project(line[i - 1]),
              b = map.project(line[i])
            const x = a.x + (b.x - a.x) * t,
              y = a.y + (b.y - a.y) * t
            if (x < 16 || y < 60 || x > canvas.clientWidth - 16 || y > canvas.clientHeight - 16) continue
            const under = map.queryRenderedFeatures([x, y], { layers: [...layers, 'road-alignments'] })
            if (under.some((f) => f.layer.id === 'road-alignments')) continue
            if (under.some((f) => f.properties?.id === hit.properties?.id))
              return { pixel: { x, y }, id: String(hit.properties?.id), highlighted }
          }
        return { pixel: null, id: String(hit.properties?.id), highlighted }
      }
    return null
  })
}

test('an existing road clicked on the plan is highlighted, summarised there, and opens for review', async ({
  page,
}) => {
  const errors = await prepare(page)
  const box = (await page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas').boundingBox())!
  const before = await roadState(page)
  expect(before?.pixel).toBeTruthy()
  expect(before?.highlighted).toBe(0)
  await page.mouse.click(box.x + before!.pixel!.x, box.y + before!.pixel!.y)
  await expect(page.getByTestId('road-existing-road-card')).toContainText(/Length\s*\d/)
  await expect.poll(async () => (await roadState(page))?.highlighted).toBe(1)
  await page.getByRole('button', { name: 'Review road', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Review existing road', exact: true })).toHaveAttribute(
    'data-value',
    before!.id!,
  )
  expect(errors).toEqual([])
})
