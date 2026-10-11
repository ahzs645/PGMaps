import { expect, test, type Page } from '@playwright/test'
import { encode } from 'fast-png'

test.use({ serviceWorkers: 'block' })
// Several terrain/camera changes render through SwiftShader in CI.
test.setTimeout(90000)
const bytes = new Uint8Array(256 * 256 * 3)
for (let i = 0; i < bytes.length; i += 3) { bytes[i] = 129; bytes[i + 1] = 244 }
// Terrarium: 129*256 + 244 - 32768 = 500 metres.
const flatTile = Buffer.from(encode({ width: 256, height: 256, data: bytes, channels: 3, depth: 8 }))

type Snapshot = {
  loading: boolean; error: string | null
  observer: { lng: number; lat: number }; observerHeightMeters: number
  result: { visible: number; occluded: number; unknown: number } | null
  map: { loaded: boolean; coverageLayer: boolean; terrain: boolean }
}
async function read(page: Page): Promise<Snapshot | null> {
  return page.evaluate(async () => {
    const tools = (window as unknown as { viewshedTools: Record<string, { execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown> }> }).viewshedTools
    const tool = tools.read_viewshed
    return tool ? await tool.execute({}, { signal: new AbortController().signal }) as Snapshot : null
  })
}
async function setup(page: Page, fail = false) {
  await page.addInitScript(() => {
    const tools: Record<string, unknown> = {}
    ;(window as unknown as { viewshedTools: Record<string, unknown> }).viewshedTools = tools
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      async registerTool(tool: { name: string }, options?: { signal?: AbortSignal }) {
        tools[tool.name] = tool
        options?.signal?.addEventListener('abort', () => { delete tools[tool.name] })
      },
    } })
  })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f1f5f9' } }] } }))
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ contentType: 'image/png', body: flatTile }))
}
test('dev entry opens a real coverage layer and observer changes update it', async ({ page }) => {
  await setup(page)
  await page.goto('/dev')
  await page.getByRole('link', { name: 'Open Viewshed', exact: true }).click()
  await expect.poll(async () => {
    const state = await read(page)
    return !!state?.result && state.map.coverageLayer
  }, { timeout: 30000 }).toBe(true)
  const initial = (await read(page))!
  expect(initial.result!.visible).toBeGreaterThan(0)
  expect(initial.result!.unknown).toBe(0)
  await page.getByRole('button', { name: '3D terrain' }).click()
  await expect.poll(async () => (await read(page))?.map.terrain).toBe(true)
  const marker = page.getByRole('button', { name: 'Move viewshed observer' })
  const box = (await marker.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 })
  await page.waitForTimeout(450)
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await read(page))?.observer.lng).toBeGreaterThan(initial.observer.lng)
  await expect.poll(async () => (await read(page))?.loading, { timeout: 30000 }).toBe(false)
  // Keyboard movement is available alongside pointer dragging.
  await page.getByRole('button', { name: 'Move viewshed observer' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await read(page))?.observer.lng).toBeGreaterThan(initial.observer.lng)
  await expect.poll(async () => {
    const state = await read(page)
    return !state?.loading && !!state?.result && state.map.coverageLayer
  }, { timeout: 30000 }).toBe(true)
  let requests = 0
  page.on('request', (request) => { if (request.url().includes('/terrarium/')) requests++ })
  const height = page.getByRole('slider', { name: 'Observer height above ground' })
  await height.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await read(page))?.observerHeightMeters).toBeGreaterThan(initial.observerHeightMeters)
  await expect.poll(async () => (await read(page))?.loading, { timeout: 30000 }).toBe(false)
  expect(requests).toBe(0)
  await page.getByRole('button', { name: 'Vancouver', exact: true }).click()
  await expect.poll(async () => {
    const state = await read(page)
    return state?.observer.lat === 49.28 && !state.loading && state.map.coverageLayer
  }, { timeout: 30000 }).toBe(true)
  await page.screenshot({ path: 'test-results/viewshed.png' })
})
test('failed terrain produces an error and no coverage layer', async ({ page }) => {
  await setup(page, true)
  await page.goto('/dev/viewshed')
  await expect.poll(async () => (await read(page))?.error, { timeout: 30000 }).toContain('Terrain could not be loaded')
  expect((await read(page))?.map.coverageLayer).toBe(false)
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
})
