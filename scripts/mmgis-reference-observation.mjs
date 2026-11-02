/** Observe a locally configured upstream MMGIS instance with the shared overlap fixture. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { chromium, expect } from '@playwright/test'

const url = process.env.MMGIS_REFERENCE_URL ?? 'http://127.0.0.1:18888/?mission=Parity-Interaction'
const directory = process.env.MMGIS_REFERENCE_OUTPUT ?? '/tmp/pgmaps-mmgis-reference'
const browser = await chromium.launch({
  ...(process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'],
})
const observations = []
await fs.mkdir(directory, { recursive: true })
try {
  for (const touch of [false, true]) {
    const context = await browser.newContext({
      viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 960 },
      isMobile: touch,
      hasTouch: touch,
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const press = (target) => (touch ? target.tap() : target.click())
    try {
      await page.goto(url)
      await page.waitForFunction(() => !!globalThis.mmgisAPI?.map)
      await expect(page.locator('.leaflet-interactive')).toHaveCount(2)
      await press(page.locator('.leaflet-interactive').last())
      await press(page.locator('#toolButtonInfo'))
      await expect(page.locator('#infoToolEquiv')).toHaveText('1 of 2')
      await expect(page.locator('#infoToolData')).toContainText('Second overlap')
      await press(page.locator('#infoToolSelectedDropdown .dropy__title'))
      await press(page.locator('#infoToolSelectedDropdown a[idx="1"]'))
      await expect(page.locator('#infoToolData')).toContainText('First overlap')
      await page.locator('#infoToolFilter input').fill('zero')
      await expect(page.locator('#infoToolData')).toContainText('0')
      await expect.poll(() => page.locator('#infoToolData').innerText()).not.toContain('flag')
      await page.locator('#infoToolFilter input').fill('flag')
      await expect(page.locator('#infoToolData')).toContainText('false')
      await press(page.locator('#infoToolHide'))
      await expect(page.locator('#infoToolUnhideAll')).toBeVisible()
      await press(page.locator('#infoToolUnhideAll'))
      await press(page.getByText('YES', { exact: true }))
      await expect(page.locator('#infoToolUnhideAll')).toBeHidden()
      assert.deepEqual(errors, [])
      const name = touch ? 'touch-phone' : 'desktop'
      await page.screenshot({ path: path.join(directory, `${name}.png`) })
      observations.push({
        profile: name,
        viewport: page.viewportSize(),
        fixture: 'tests/fixtures/mmgis-overlap.geojson',
        checks: [
          'two rendered overlapping features',
          'cycle selected overlap',
          'filter nested numeric zero',
          'filter nested boolean false',
          'hide feature',
          'confirm restore hidden features',
        ],
        scriptErrors: errors,
      })
    } finally {
      await context.close()
    }
  }
  const report = {
    observedAt: new Date().toISOString(),
    url,
    upstream: 'c576fe4925ef6e65c74141516d3b0ffa50def6bd',
    observations,
  }
  await fs.writeFile(path.join(directory, 'observations.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
