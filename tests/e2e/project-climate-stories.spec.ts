import { test, expect, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'

const stories = readdirSync('public/data/projects')
  .filter((name) => name.startsWith('bc-climate-') || name === 'northern-health-climate-resilience.json')
  .map((name) => JSON.parse(readFileSync(`public/data/projects/${name}`, 'utf8')))
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
]

for (const viewport of viewports)
  test(`seasonal legend is compact and sources live beside search on ${viewport.name}`, async ({ page }, testInfo) => {
    const story = stories.find((s) => s.slug === 'bc-climate-seasonal-precipitation')!
    const index = story.scenes.findIndex((s: { label: string }) => s.label === 'spring · P10')
    expect(index).toBeGreaterThanOrEqual(0)
    await page.setViewportSize(viewport)
    await page.goto(`/dev/projects/${story.slug}`)
    await page.getByRole('button', { name: `Go to scene ${index + 1}`, exact: true }).click()
    await checkScene(page, story, index)
    const expand = page.getByRole('button', { name: 'Expand legend', exact: true })
    if (await expand.isVisible()) await expand.click()
    const legend = page.locator('.story-map-legend')
    await expect(legend.getByText('Map layers', { exact: true })).toBeVisible()
    const toggle = legend.getByRole('button', {
      name: 'Seasonal total precipitation · spring · 2071-2100 · P10',
      exact: true,
    })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(legend.getByText('100 to < 300 mm', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`compact-legend-${viewport.name}.png`) })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveCSS('opacity', '0.5')
    await expect(legend.getByText(/^(On|Off)$/)).toHaveCount(0)
    await toggle.click()
    await checkScene(page, story, index)
    const info = page.locator('#dataset-info-toolbar-slot').getByRole('button', { name: 'Sources and downloads' })
    await expect(info).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Sources and downloads' })).toHaveCount(1)
    await expect(info).toHaveText('')
    const search = (await page.getByRole('button', { name: 'Open search', exact: true }).boundingBox())!
    const box = (await info.boundingBox())!
    expect(box.x - search.x - search.width).toBeGreaterThanOrEqual(0)
    expect(box.x - search.x - search.width).toBeLessThanOrEqual(16)
    await info.click()
    await expect(page.getByRole('dialog')).toContainText(story.sourceNote)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download story JSON' }).click()
    expect((await download).suggestedFilename()).toContain(story.slug)
    await page.keyboard.press('Escape')
    await expect(info).toBeFocused()
    // A story's toolbar portal must not leak into the project catalog.
    if (viewport.name === 'phone') await page.getByRole('link', { name: 'Back to all projects', exact: true }).click()
    else await page.getByRole('button', { name: 'All projects', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sources and downloads' })).toHaveCount(0)
  })

async function checkScene(page: Page, story: (typeof stories)[number], index: number) {
  await expect(page.getByRole('button', { name: `Go to scene ${index + 1}`, exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  )
  await expect(page.getByRole('heading', { name: story.scenes[index].title, exact: true })).toBeVisible()
  const layerIds = story.workspace.layers
    .filter(
      (l: { id: string; format: string }) =>
        l.format === 'climate-grid' && story.scenes[index].visibleLayerIds.includes(l.id),
    )
    .map((l: { id: string }) => l.id)
  if (layerIds.length) {
    const status = page.getByTestId('climate-status')
    await expect(status).toHaveAttribute('data-selection', layerIds.join(','), { timeout: 45_000 })
    await expect(status).toHaveAttribute('data-status', 'ready', { timeout: 45_000 })
    expect(Number(await status.getAttribute('data-cells'))).toBeGreaterThan(0)
  } else await expect(page.getByTestId('climate-status')).toHaveCount(0)
  const legend = page.locator('.story-map-legend')
  await expect(legend.getByText(story.scenes[index].label, { exact: true })).toHaveCount(0)
  await expect(legend.getByText(/^(On|Off|Displayed)$/)).toHaveCount(0)
}

for (const viewport of viewports)
  for (const story of stories) {
    test(`${story.slug} traverses every scene on ${viewport.name}`, async ({ browser }, testInfo) => {
      test.setTimeout(240_000)
      const context = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: true,
        isMobile: viewport.name === 'phone',
        hasTouch: viewport.name === 'phone',
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      const problems: string[] = []
      const products = new Set<string>()
      page.on('console', (m) => {
        if (
          ['warning', 'error'].includes(m.type()) &&
          !/GL Driver Message .*GPU stall due to ReadPixels/.test(m.text())
        )
          problems.push(m.text())
      })
      page.on('pageerror', (e) => problems.push(e.message))
      page.on('request', (request) => {
        const match = request.url().match(/\/products\/([^/]+)\.json/)
        if (match) products.add(match[1])
      })
      try {
        await page.goto(`/dev/projects/${story.slug}`)
        await checkScene(page, story, 0)
        const map = page.locator('.maplibregl-map')
        const height = (await map.boundingBox())!.height
        for (let index = 1; index < story.scenes.length; index++) {
          await page.getByRole('button', { name: 'Next scene', exact: true }).click()
          await test.step(`Forward scene ${index + 1}`, () => checkScene(page, story, index))
          expect(Math.abs((await map.boundingBox())!.height - height)).toBeLessThanOrEqual(2)
        }
        for (let index = story.scenes.length - 2; index >= 0; index--) {
          await page.getByRole('button', { name: 'Previous scene', exact: true }).click()
          await test.step(`Backward scene ${index + 1}`, () => checkScene(page, story, index))
        }
        // No eager fetch of products not used by this story.
        const allowed = new Set(
          story.workspace.layers
            .filter((l: { climate?: { product: string } }) => l.climate)
            .map((l: { climate: { product: string } }) => l.climate.product),
        )
        for (const id of products) expect(allowed.has(id)).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
        await page.getByRole('button', { name: 'Sources and downloads' }).click()
        await expect(page.getByRole('dialog')).toContainText('not an official Northern Health')
        await expect(page.getByRole('link', { name: 'Pinned climate manifest and provenance' })).toHaveAttribute(
          'href',
          /01b4b7e982f9b2e6d042\/manifest.json$/,
        )
        await page.getByRole('button', { name: 'Close', exact: true }).click()
        const canvasSize = await page.locator('.maplibregl-canvas').evaluate((node) => ({
          dw: Math.abs(node.clientWidth - (node.closest('.maplibregl-map') as HTMLElement).clientWidth),
          dh: Math.abs(node.clientHeight - (node.closest('.maplibregl-map') as HTMLElement).clientHeight),
        }))
        expect(canvasSize.dw).toBeLessThanOrEqual(2)
        expect(canvasSize.dh).toBeLessThanOrEqual(2)
        if (
          [
            'bc-climate-days-above-29c',
            'bc-climate-seasonal-precipitation',
            'bc-climate-precipitation-as-snow',
            'northern-health-climate-resilience',
          ].includes(story.slug)
        )
          await page.screenshot({ path: testInfo.outputPath(`${story.slug}-${viewport.name}.png`), timeout: 15_000 })
        expect(problems).toEqual([])
      } finally {
        await Promise.race([context.close(), new Promise((resolve) => setTimeout(resolve, 5000))])
      }
    })
  }

test('climate source errors are retryable and inactive layers are not fetched', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'bc-climate-days-above-29c')!
  let fail = true
  await page.route('**/products/txgt_29.json', (route) =>
    fail ? route.fulfill({ status: 503, body: 'Test source outage' }) : route.continue(),
  )
  await page.goto(`/dev/projects/${story.slug}`)
  await expect(page.getByTestId('climate-status')).toHaveAttribute('data-status', 'error', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Retry climate layers' })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry climate layers' }).click()
  await checkScene(page, story, 0)
  const toggle = page.getByRole('button', { name: /Days above 29°C · 1971-2000 · P50/ })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('climate-status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await checkScene(page, story, 0)
})

test('climate clicks expose stored values and scene changes clear selections', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'bc-climate-days-above-29c')!
  await page.goto(`/dev/projects/${story.slug}`)
  await checkScene(page, story, 0)
  const box = (await page.locator('.maplibregl-map').boundingBox())!
  // Data readiness precedes Deck's next rendered/picking frame. Click a small
  // set of central land pixels until a pick is ready, avoiding nodata holes.
  await expect(async () => {
    for (const [x, y] of [
      [0.415, 0.66],
      [0.5, 0.5],
      [0.55, 0.5],
      [0.55, 0.6],
    ]) {
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y)
      if (await page.getByText(/Stored value:/).isVisible()) break
    }
    await expect(page.getByText(/Stored value:/)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(page.getByText(/Cell: u6:/)).toBeVisible()
  await page.getByRole('button', { name: 'Next scene', exact: true }).click()
  await checkScene(page, story, 1)
  await expect(page.getByRole('button', { name: 'Close selected feature' })).toHaveCount(0)
})

test('malformed climate metadata is refetched on Retry', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'bc-climate-days-above-29c')!
  let malformed = true
  await page.route('**/products/txgt_29.json', (route) =>
    malformed ? route.fulfill({ status: 200, contentType: 'application/json', body: '{' }) : route.continue(),
  )
  await page.goto(`/dev/projects/${story.slug}`)
  await expect(page.getByTestId('climate-status')).toHaveAttribute('data-status', 'error')
  malformed = false
  await page.getByRole('button', { name: 'Retry climate layers' }).click()
  await checkScene(page, story, 0)
})

test('snow zoom gate avoids province-wide fine-grid loading and recovers on a scene reset', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'bc-climate-precipitation-as-snow')!
  await page.goto(`/dev/projects/${story.slug}`)
  await checkScene(page, story, 0)
  await page.getByRole('button', { name: 'Collapse legend', exact: true }).click()
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await page.waitForTimeout(350)
  }
  await expect(page.getByTestId('climate-status')).toHaveAttribute('data-status', 'zoom')
  await expect(page.getByTestId('climate-status')).toContainText('Coverage remains BC-wide')
  await page.getByRole('button', { name: 'Go to scene 2', exact: true }).click()
  await checkScene(page, story, 1)
})

test('climate periods reuse downloaded blocks and picks use the new band', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'bc-climate-days-above-29c')!
  const downloads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/climate/bc-climate-u6/')) downloads.push(request.url())
  })
  await page.goto(`/dev/projects/${story.slug}`)
  await checkScene(page, story, 0)
  const initial = downloads.length
  for (const index of [1, 2, 1, 0, 2]) {
    await page.getByRole('button', { name: `Go to scene ${index + 1}`, exact: true }).click()
    await checkScene(page, story, index)
  }
  expect(downloads.length).toBe(initial)
  const box = (await page.locator('.maplibregl-map').boundingBox())!
  await expect(async () => {
    await page.mouse.click(box.x + box.width * 0.415, box.y + box.height * 0.66)
    await expect(page.getByText(/Stored value:/)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(page.getByText(/Stored value:/)).toContainText('2071-2100')
})

test('Northern Health preloads only the adjacent climate scene while the introduction is read', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'northern-health-climate-resilience')!
  const products = new Set<string>()
  page.on('request', (request) => {
    const match = request.url().match(/\/products\/([^/]+)\.json/)
    if (match) products.add(match[1])
  })
  await page.goto(`/dev/projects/${story.slug}`)
  await checkScene(page, story, 0)
  await expect.poll(() => [...products], { timeout: 30_000 }).toEqual(['tg_mean'])
  await page.waitForTimeout(1500)
  expect([...products]).toEqual(['tg_mean'])
  await page.getByRole('button', { name: 'Next scene', exact: true }).click()
  await checkScene(page, story, 1)
})

test('data saver suppresses read-ahead but still allows foreground climate loading', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: {
        saveData: true,
        effectiveType: '4g',
        addEventListener() {},
        removeEventListener() {},
      },
    })
  })
  const story = stories.find((s) => s.slug === 'northern-health-climate-resilience')!
  const downloads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/climate/bc-climate-u6/')) downloads.push(request.url())
  })
  await page.goto(`/dev/projects/${story.slug}`)
  await checkScene(page, story, 0)
  await page.waitForTimeout(2000)
  expect(downloads).toEqual([])
  await page.getByRole('button', { name: 'Next scene', exact: true }).click()
  await checkScene(page, story, 1)
  expect(downloads.length).toBeGreaterThan(0)
})

for (const viewport of viewports)
  test(`a delayed scene keeps the displayed climate legend on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const story = stories.find((s) => s.slug === 'northern-health-climate-resilience')!
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/products/txgt_29.json', async (route) => {
      await gate
      await route.continue().catch(() => {})
    })
    try {
      await page.goto(`/dev/projects/${story.slug}`)
      await page.getByRole('button', { name: 'Go to scene 4', exact: true }).click()
      await checkScene(page, story, 3)
      if (viewport.name === 'phone') await page.getByRole('button', { name: 'Expand legend', exact: true }).click()
      await page.getByRole('button', { name: 'Next scene', exact: true }).click()
      await expect(page.getByTestId('climate-status')).toHaveAttribute('data-status', 'loading')
      await expect(page.getByText('Updating map · previous climate layer shown')).toBeVisible()
      const displayed = page.getByRole('button', { name: /Mean annual temperature.*2071-2100/ })
      await expect(displayed).toBeVisible()
      await expect(displayed).toBeDisabled()
      // toBeVisible alone does not detect clipping inside a scrolling legend.
      const bounds = await displayed.evaluate((node) => {
        const box = node.getBoundingClientRect()
        const map = document.querySelector('.maplibregl-map')!.getBoundingClientRect()
        const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return { insideMap: box.top >= map.top && box.bottom <= map.bottom, unobscured: node.contains(centre) }
      })
      expect(bounds).toEqual({ insideMap: true, unobscured: true })
      await expect(page.getByTestId('climate-status')).toHaveClass('sr-only')
      await page.screenshot({ path: testInfo.outputPath(`retained-legend-${viewport.name}.png`) })
      release()
      await checkScene(page, story, 4)
      await expect(page.getByText('Updating map · previous climate layer shown')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Days above 29°C.*2071-2100/ })).toBeVisible()
    } finally {
      release()
    }
  })

test('rapid navigation aborts a slow climate scene without allowing a stale swap', async ({ page }) => {
  const story = stories.find((s) => s.slug === 'northern-health-climate-resilience')!
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route('**/products/txgt_29.json', async (route) => {
    requested = true
    await gate
    await route.continue().catch(() => {})
  })
  try {
    await page.goto(`/dev/projects/${story.slug}`)
    await page.getByRole('button', { name: 'Go to scene 4', exact: true }).click()
    await checkScene(page, story, 3)
    await page.getByRole('button', { name: 'Next scene', exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByTestId('climate-status')).toHaveAttribute('data-status', 'loading')
    await page.getByRole('button', { name: 'Next scene', exact: true }).click()
    await checkScene(page, story, 5)
    release()
    await page.waitForTimeout(1000)
    await checkScene(page, story, 5)
    await expect(page.getByText('Updating map · previous climate layer shown')).toHaveCount(0)
  } finally {
    release()
  }
})
