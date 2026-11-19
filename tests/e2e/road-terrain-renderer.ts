import { expect, type Locator, type Page } from '@playwright/test'

/** Keep software pixel/mask regressions on the fallback without disabling MapLibre's WebGL. */
export async function forceCanvasTerrainPreview(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (
        this.dataset.testid === 'road-terrain-gpu-canvas' &&
        ['webgl', 'webgl2', 'experimental-webgl'].includes(String(args[0]))
      )
        return null
      return Reflect.apply(original, this, args)
    } as typeof original
  })
}

/** Import journeys need a drawn surface from whichever renderer owns the visible preview. */
export async function expectTerrainSurface(preview: Locator) {
  await expect(preview).toBeVisible()
  await expect
    .poll(
      () =>
        preview.evaluate((element) => {
          const gpu = element.getAttribute('data-renderer') === 'webgl'
          const canvas = element.querySelector<HTMLCanvasElement>(
            `[data-testid="${gpu ? 'road-terrain-gpu-canvas' : 'road-ground-canvas'}"]`,
          )
          if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false
          const bounds = canvas.getBoundingClientRect()
          if (bounds.width <= 0 || bounds.height <= 0 || getComputedStyle(canvas).visibility === 'hidden') return false
          // WebGL diagnostics are recorded after the actual draw, not just after building geometry.
          return gpu
            ? Number(canvas.dataset.renderCount) > 0 && Number(canvas.dataset.triangleCount) > 0
            : Number(canvas.dataset.faceCount) > 0
        }),
      { message: 'The active terrain renderer must have drawn a nonempty surface.' },
    )
    .toBe(true)
}
