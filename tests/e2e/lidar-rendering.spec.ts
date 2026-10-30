import { expect, test } from '@playwright/test'
import type { LidarRenderingHarness } from './fixtures/lidar-rendering'

declare global {
  interface Window {
    lidarRendering: LidarRenderingHarness
  }
}

const white = [255, 255, 255, 255]
const released = { programs: 0, buffers: 0, arrays: 0, shaders: 0 }
for (const mode of ['desktop', 'mobile'] as const) {
  test.describe(`LiDAR production WebGL2 rendering (${mode})`, () => {
    test.use(
      mode === 'mobile'
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    )
    test.beforeEach(async ({ page }) => {
      await page.goto('/tests/e2e/fixtures/lidar-rendering.html')
      await page.waitForFunction(() => !!window.lidarRendering)
    })

    test('roof triangles and tree points paint their original colors and point appearance', async ({ page }, info) => {
      const roof = await page.evaluate(() => window.lidarRendering.roof())
      expect(roof.version).toContain('WebGL 2.0')
      expect(roof.error).toBe(0)
      expect(roof.coloredPixels).toBeGreaterThan(10_000)
      expect(roof.center[0]).toBeGreaterThan(200)
      expect(roof.center[1]).toBeGreaterThan(100)
      expect(roof.center[1]).toBeLessThan(200)
      expect(roof.center[2]).toBeLessThan(60)
      expect(roof.outside).toEqual(white)
      const roofImage = info.outputPath(`roof-${mode}.png`)
      await page.locator('#direct canvas').screenshot({ path: roofImage })
      await info.attach(`roof-${mode}`, {
        path: roofImage,
        contentType: 'image/png',
      })

      const small = await page.evaluate(() => window.lidarRendering.points({ pointSize: 1 }))
      const large = await page.evaluate(() => window.lidarRendering.points({ pointSize: 4 }))
      expect(large.coloredPixels).toBeGreaterThan(small.coloredPixels * 4)
      const picked = await page.evaluate(() =>
        window.lidarRendering.points({ picked: window.lidarRendering.pickedKey, pointSize: 3 }),
      )
      expect(picked.center).toEqual([255, 13, 51, 255])
      expect(picked.pointCorner).toEqual(white)
      expect(picked.error).toBe(0)
      const black = await page.evaluate(() => window.lidarRendering.points({ colour: 'black' }))
      expect(black.center).toEqual([31, 31, 31, 255])
      const rejected = await page.evaluate(() =>
        window.lidarRendering.points({ assignments: { [window.lidarRendering.pickedKey]: '0' }, colour: 'segment' }),
      )
      expect(rejected.center).toEqual([166, 166, 166, 255])
    })

    test('releases actual GPU resources and rebuilds the same layer in a replacement context', async ({ page }) => {
      const result = await page.evaluate(() => window.lidarRendering.lifecycle())
      expect(result.before.coloredPixels).toBeGreaterThan(10_000)
      expect(result.active).toMatchObject({ programs: 1, buffers: 1, arrays: 1 })
      expect(result.deletionRequested).toBe(true)
      expect(result.released).toEqual(released)
      expect(result.afterRemoval.coloredPixels).toBe(0)
      expect(result.afterRemoval.error).toBe(0)
      expect(result.replacement.coloredPixels).toBe(result.before.coloredPixels)
      expect(result.replacement.error).toBe(0)
      expect(result.replacementReleased).toEqual(released)
      for (const linkFailure of [false, true]) {
        const failure = await page.evaluate((link) => window.lidarRendering.failedSetup(link), linkFailure)
        expect(failure.message).not.toBe('')
        expect(failure.live).toEqual(released)
        expect(failure.error).toBe(0)
      }
    })

    test('paints and removes the roof and selected tree through real MapLibre custom-layer callbacks', async ({
      page,
    }, info) => {
      const result = await page.evaluate(() => window.lidarRendering.mapIntegration())
      expect(result.building.coloredPixels).toBeGreaterThan(100)
      expect(result.building.center[0]).toBeGreaterThan(200)
      expect(result.building.center[2]).toBeLessThan(60)
      expect(result.removed.coloredPixels).toBe(0)
      expect(result.tree.center).toEqual([255, 13, 51, 255])
      expect(result.hasTreeLayer).toBe(true)
      expect(result.building.error).toBe(0)
      expect(result.tree.error).toBe(0)
      const mapImage = info.outputPath(`maplibre-${mode}.png`)
      await page.locator('#map').screenshot({ path: mapImage })
      await info.attach(`maplibre-${mode}`, { path: mapImage, contentType: 'image/png' })
    })
  })
}
