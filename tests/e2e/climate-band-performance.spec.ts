import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Production's service worker otherwise serves local JSON outside page.route,
// bypassing the deliberately long transition used by this regression fixture.
test.use({ serviceWorkers: 'block' })

for (const width of [1440, 390]) {
  for (const slug of [
    'bc-climate-days-above-29c',
    'bc-climate-seasonal-precipitation',
    'northern-health-climate-resilience',
  ]) {
    test(`${slug} prepares the next section while reading at ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width, height: 900 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const downloads: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/climate/bc-climate-u6/')) downloads.push(request.url())
      })
      await page.goto(`/dev/projects/${slug}`)
      const first = page.getByRole('button', { name: 'Go to scene 1', exact: true })
      await expect(first).toHaveAttribute('aria-current', 'step')
      const status = page.getByTestId('climate-status')
      if (!slug.startsWith('northern'))
        await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 60_000 })
      else
        await page.waitForResponse((response) => response.url().includes('/values/') && response.ok(), {
          timeout: 60_000,
        })
      // Simulate reading, with the old section still active throughout.
      await page.waitForTimeout(2500)
      await expect(first).toHaveAttribute('aria-current', 'step')
      const count = downloads.length
      await page.getByRole('button', { name: 'Next scene', exact: true }).click()
      await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 30_000 })
      await expect(status).toHaveAttribute('data-preloaded', 'true')
      expect(downloads.length).toBe(count)
      expect(errors).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`prepared-${slug}-${width}.png`) })
    })
  }
  for (const slug of ['bc-climate-days-above-29c', 'bc-climate-seasonal-precipitation']) {
    test(`${slug} switches cached bands without camera waits or refetching at ${width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000)
      const story = JSON.parse(readFileSync(`public/data/projects/${slug}.json`, 'utf8'))
      // A no-op camera must skip even a long authored animation. Real camera
      // changes retain it; reduced motion must not mask this regression.
      story.workspace.options.sceneTransitionMs = 5000
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.setViewportSize({ width, height: 900 })
      let intercepted = false
      await page.route(`**/data/projects/${slug}.json*`, (route) => {
        intercepted = true
        return route.fulfill({ json: story })
      })
      const downloads: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/climate/bc-climate-u6/')) downloads.push(request.url())
      })
      await page.goto(`/dev/projects/${slug}`)
      const status = page.getByTestId('climate-status')
      await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 60_000 })
      expect(intercepted).toBe(true)
      const initialDownloads = downloads.length
      const timings: { scene: number; milliseconds: number }[] = []
      const indices = slug.includes('seasonal') ? [1, 2, 5, 6, 9, 19, 0] : [1, 2, 3, 4, 0]
      for (const index of indices) {
        const expected = story.workspace.layers
          .filter(
            (layer: { id: string; format: string }) =>
              layer.format === 'climate-grid' && story.scenes[index].visibleLayerIds.includes(layer.id),
          )
          .map((layer: { id: string }) => layer.id)
          .join(',')
        const started = Date.now()
        await page.getByRole('button', { name: `Go to scene ${index + 1}`, exact: true }).click()
        await expect(status).toHaveAttribute('data-selection', expected, { timeout: 4000 })
        await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 4000 })
        timings.push({ scene: index + 1, milliseconds: Date.now() - started })
        expect(downloads.length).toBe(initialDownloads)
      }
      await testInfo.attach('warm-scene-timings', {
        body: JSON.stringify(timings, null, 2),
        contentType: 'application/json',
      })
      console.log(JSON.stringify({ slug, width, timings }))
    })
  }
}
