import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

const showcaseManifest = JSON.parse(readFileSync('public/data/nechako-showcase/manifest.json', 'utf8'))

const localExport = JSON.stringify({
  projects: [
    {
      schema: 'nechako-workspace-v1',
      project_id: 901,
      project_name: 'Review community map',
      description: 'Local test export, not a portal record.',
      camera: { center: [-124, 54], zoom: 9, bearing: 0, pitch: 0 },
      layers: [],
      tiles: [],
      warnings: [],
      vectors: [
        {
          id: 'review-point',
          name: 'Review point',
          color: '#2563eb',
          visible: true,
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { name: 'Fixture point' },
                geometry: { type: 'Point', coordinates: [-124, 54] },
              },
            ],
          },
        },
      ],
    },
  ],
  stories: [
    {
      id: 'review-story',
      title: 'Review document',
      text: 'A readable local story export.',
      references: [
        { url: 'https://example.com/review.pdf', size_bytes: 1024 },
        { url: 'https://example.com/unmeasured.jpg' },
      ],
    },
  ],
})

for (const width of [1440, 390]) {
  test(`collections retain imported content and byte coverage across portal panels at ${width}px`, async ({ page }) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      }),
    )
    await page.goto('/dev/nechako/portal?panel=inventory')
    await expect(
      page.getByText(`${showcaseManifest.snapshot_file_bytes.toLocaleString('en-CA')} bytes`, { exact: false }),
    ).toBeVisible()
    await expect(page.getByText('No full server-storage inventory')).toBeVisible()
    await page.getByRole('textbox', { name: 'Search watershed collections' }).fill('monitoring')
    await expect(page.getByRole('article', { name: 'Monitoring and observations' })).toContainText(
      '77,799 observations',
    )
    await expect(page.getByRole('article', { name: 'Monitoring and observations' })).toContainText(
      'Neither count is the portal-wide total',
    )
    await expect(page.getByRole('article', { name: 'Monitoring and observations' })).toContainText(
      '25,933 observations',
    )
    await page.getByRole('button', { name: 'Close portal window' }).click()
    const nav = page.getByRole('navigation', { name: 'Watershed portal' })
    await nav.getByRole('button', { name: 'Community projects', exact: true }).click()
    await expect(page.getByText('Climate and Health', { exact: true })).toBeVisible()
    await page
      .getByLabel('Portal collection JSON files')
      .setInputFiles({ name: 'review-export.json', mimeType: 'application/json', buffer: Buffer.from(localExport) })
    await expect(
      page.getByText(`${Buffer.byteLength(localExport).toLocaleString('en-CA')} bytes`, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Review community map', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close portal window' }).click()
    await nav.getByRole('button', { name: 'Data inventory', exact: true }).click()
    await expect(page.locator('[data-nechako-session-size]')).toContainText(
      `${Buffer.byteLength(localExport).toLocaleString('en-CA')} bytes`,
    )
    await expect(page.locator('[data-nechako-session-size]')).toContainText('Unmeasured references')
    await page.getByRole('button', { name: 'Close portal window' }).click()
    await nav.getByRole('button', { name: 'Stories', exact: true }).click()
    await page.getByRole('button').filter({ hasText: 'Review document' }).click()
    const record = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Review document', exact: true }) })
    await expect(record).toContainText('A readable local story export.')
    await expect(record).toContainText('File size not supplied')
    await expect(record).toContainText('declared in export; unverified')
    await record.getByRole('button', { name: 'Close', exact: true }).last().click()
    await page.getByRole('button', { name: 'Close portal window' }).click()
    await nav.getByRole('button', { name: 'Community projects', exact: true }).click()
    await page.getByRole('button').filter({ hasText: 'Review community map' }).click()
    await page.getByRole('button', { name: 'Load imported map workspace', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand Map', exact: true }).click()
    await expect(page.getByLabel('Show Review point')).toBeChecked()
    await page.getByRole('button', { name: 'Close Map', exact: true }).click()
    await nav.getByRole('button', { name: 'All options', exact: true }).click()
    await page.getByLabel('Find a portal option').fill('buffer')
    await expect(page.getByText('1 of 77 options', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Open Map Tools', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Map Tools', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

test('learning story opens inside the portal and reaches each map chapter', async ({ page }) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
      },
    }),
  )
  await page.goto('/dev/nechako/portal?panel=stories')
  await page.getByRole('button', { name: 'Read learning story in this portal', exact: true }).click()
  const reader = page.locator('[data-nechako-project-reader]')
  await expect(reader.locator('.maplibregl-canvas')).toBeVisible()
  await reader.getByRole('button', { name: 'Start reading', exact: true }).click()
  for (const chapter of [
    'Prince George',
    'Vanderhoof',
    'Fraser Lake',
    'Burns Lake',
    'Fort St. James',
    'Bring it together',
    'Start here',
  ]) {
    await reader.getByRole('button').filter({ hasText: chapter }).first().click()
    await expect(reader.locator('[aria-current="step"]')).toContainText(chapter)
  }
  await page.getByRole('button', { name: 'Close portal window', exact: true }).click()
  await expect(page.locator('[data-nechako-portal-map] canvas')).toBeVisible()
})

test('actual public project loads its original layers and descriptions include embedded media', async ({ page }) => {
  test.setTimeout(90000)
  const mapReads: string[] = []
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  await page.route('https://**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    if (url.searchParams.get('REQUEST') === 'GetMap') mapReads.push(url.searchParams.get('LAYERS') || '')
    return route.fulfill({ contentType: 'image/png', body: png })
  })
  await page.goto('/dev/nechako/portal?panel=collections')
  await page.getByRole('button').filter({ hasText: 'Climate and Health' }).click()
  const climate = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Climate and Health', exact: true }) })
  await expect(climate).toContainText('1,663,401 bytes')
  await expect(climate.locator('img[src^="data:image/png"]')).toHaveCount(1)
  await climate.getByRole('button', { name: 'Close', exact: true }).last().click()
  await page.getByRole('button').filter({ hasText: '"Welcome to the Nechako Watershed" Learning Module' }).click()
  await page.getByRole('button', { name: 'Load this public project on map', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => mapReads.length).toBeGreaterThan(0)
  await page
    .getByRole('navigation', { name: 'Watershed portal' })
    .getByRole('button', { name: 'Projects', exact: true })
    .click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace JSON', exact: true }).click()
  const exported = JSON.parse(readFileSync((await (await download).path())!, 'utf8'))
  expect(exported.layers).toHaveLength(18)
  expect(exported.tiles).toHaveLength(1)
  expect(exported.originalProject).toEqual(
    JSON.parse(readFileSync('public/data/nechako-showcase/public-projects/project-27.json', 'utf8')),
  )
  expect(exported.vectors).toHaveLength(0)
  expect(exported.warnings.filter((message: string) => message.includes('HTTPS without credentials'))).toHaveLength(2)
})
