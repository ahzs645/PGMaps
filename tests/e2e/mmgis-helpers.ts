import { expect, type Locator, type Page } from '@playwright/test'
import type { Geometry } from 'geojson'

declare global {
  interface Window {
    missionRead: () => Promise<{
      visibleFeatures: number
      name: string
      view: string
      tool: string
      draftVertices: number
      pointer: [number, number] | null
      editing: boolean
      localRaster: { name: string; width: number; height: number; epsg: number } | null
      selectedFeature: { geometry: Geometry; properties: Record<string, unknown> } | null
      bookmarks: Array<{ name: string; camera: { center: [number, number]; zoom: number } }>
      selected: { layer: string; id: string } | null
      layers: Array<{
        id: string
        name: string
        features: number
        shown: number
        visible: boolean
        opacity: number
        geometryTypes: string[]
        style: { type: string }
      }>
      map: {
        loaded: boolean
        layerCount: number
        sources: string[]
        terrain: unknown
        camera: { center: [number, number]; zoom: number }
        paintedLayers: Array<{ id: string; type: string; paint: Record<string, unknown>; visible: boolean }>
        dataSources: Array<{ id: string; features: number; geometryTypes: string[] }>
      }
    }>
  }
}
export async function openMission(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: async (tool: { name: string; execute: (args: object, options: object) => Promise<unknown> }) => {
          if (tool.name === 'read_mission_workbench')
            window.missionRead = () => tool.execute({}, {}) as ReturnType<typeof window.missionRead>
        },
      },
    })
  })
  await page.route('https://basemaps.cartocdn.com/**', (r) =>
    r.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#e2e9e5' } }],
        glyphs: 'https://mission-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.goto('/dev/mmgis')
  await expect.poll(() => page.evaluate(() => window.missionRead?.().then((r) => r.map.loaded))).toBe(true)
  return errors
}
export const readMission = async (page: Page) => {
  await page.waitForFunction(() => typeof window.missionRead === 'function')
  return page.evaluate(() => window.missionRead())
}
export async function press(page: Page, target: Locator) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await target.tap()
  else await target.click()
}
export async function dragInput(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
    for (let i = 1; i <= 12; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12, id: 1 }],
      })
      await page.waitForTimeout(20)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  } else {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
  }
}
export async function expandPanel(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 768) return
  const handle = page.getByRole('separator', { name: 'Drag to resize sheet', exact: true })
  if ((await handle.getAttribute('aria-valuenow')) === '2') return
  const box = (await handle.boundingBox())!
  await dragInput(page, { x: box.x + 20, y: box.y + 8 }, { x: box.x + 20, y: 140 })
  await expect(handle).toHaveAttribute('aria-valuenow', '2')
}
export async function collapsePanel(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 768) return
  const hide = page.getByRole('button', { name: 'Hide panel', exact: true })
  if (await hide.isVisible()) await press(page, hide)
  await expect(page.getByRole('separator', { name: 'Drag to resize sheet', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
}
export async function expectPanelCollapsed(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) >= 768) return
  await expect(page.getByRole('separator', { name: 'Drag to resize sheet', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
}
export async function panel(page: Page, name: string) {
  await expandPanel(page)
  await press(
    page,
    page.getByRole('navigation', { name: 'Workbench tools' }).getByRole('button', { name, exact: true }),
  )
}
export async function mapTap(page: Page, x = 0.35, y = 0.45) {
  const canvas = page.getByTestId('mission-plan').locator('canvas.maplibregl-canvas')
  const box = (await canvas.boundingBox())!
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await canvas.tap({ position: { x: box.width * x, y: box.height * y } })
  else await canvas.click({ position: { x: box.width * x, y: box.height * y } })
}
export async function expectFits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const canvas = page.getByTestId('mission-plan').locator('canvas.maplibregl-canvas')
  // MapLibre resizes its canvas on the next animation frame after a layout/rotation change.
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox()
      return !!box && box.x + box.width <= (page.viewportSize()?.width ?? 0) + 1
    })
    .toBe(true)
  const map = (await canvas.boundingBox())!
  expect(map.width).toBeGreaterThan(100)
  expect(map.height).toBeGreaterThan(70)
  expect(map.x + map.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1)
}
