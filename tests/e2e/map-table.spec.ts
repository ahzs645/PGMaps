import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

async function stubBasemap(page: Page) {
  // A glyphs URL is required, or the style never finishes loading.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: { version: 8, sources: {}, layers: [], glyphs: 'https://map-table-test.invalid/{fontstack}/{range}.pbf' },
    }),
  )
  await page.route('https://map-table-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
}

const pane = (page: Page) => page.locator('[data-panel="data-table-panel"]')
const headerWidths = (scope: ReturnType<typeof pane>) =>
  scope
    .getByRole('columnheader')
    .evaluateAll((cells) =>
      Object.fromEntries(
        cells.map((cell) => [(cell as HTMLElement).innerText.trim(), Math.round(cell.getBoundingClientRect().width)]),
      ),
    )

test.describe('the map table on desktop', () => {
  test.use({ viewport: { width: 1280, height: 860 } })

  test('opens from the labelled map button with bookkeeping columns hidden', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/data')
    const button = page.getByRole('button', { name: 'Open table' })
    await expect(button).toContainText('Table')
    await button.click()
    await expect(pane(page)).toContainText('31 rows')
    await expect(pane(page).getByRole('columnheader', { name: 'Community' })).toBeVisible()
    await expect(pane(page).getByRole('columnheader', { name: 'Global ID' })).toHaveCount(0)

    await pane(page).getByRole('button', { name: 'Table options' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Global ID' }).click()
    await expect(pane(page).getByRole('columnheader', { name: 'Global ID' })).toBeVisible()
  })

  test('a long value does not widen every column', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/data')
    await page.getByRole('button', { name: 'Open table' }).click()
    await expect(pane(page)).toContainText('31 rows')
    await pane(page).getByRole('button', { name: 'Table options' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Global ID' }).click()
    await page.keyboard.press('Escape')

    const table = pane(page).getByRole('table')
    const scroller = pane(page).getByLabel('Data table pane')
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(0)
    await expect(table).toBeVisible()
    // Spare width is shared out, so columns are not stuck at the 340px of a GUID.
    const widths = await headerWidths(pane(page))
    expect(
      new Set(
        Object.entries(widths)
          .filter(([name]) => name !== '#')
          .map(([, width]) => width),
      ).size,
    ).toBeGreaterThan(1)
  })

  test('downloads the rows and columns shown as CSV', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/data')
    await page.getByRole('button', { name: 'Open table' }).click()
    await expect(pane(page)).toContainText('31 rows')
    await pane(page).getByRole('button', { name: 'Search table' }).click()
    await pane(page).getByRole('textbox', { name: 'Search table' }).fill('austin')
    await expect(pane(page)).toContainText('2 of 31')

    await pane(page).getByRole('button', { name: 'Table options' }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download CSV (2 rows)' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('community-boundaries.csv')
    const lines = (await readFile(await download.path(), 'utf8')).replace('﻿', '').split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('"Community"')
    expect(lines[0]).not.toContain('Global ID')
    expect(lines[1]).toContain('Austin')
  })

  test('keeps the open table and row in the URL and restores them from a link', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/data')
    await page.getByRole('button', { name: 'Open table' }).click()
    await expect(page).toHaveURL(/[?&]table=community-boundaries/)
    await pane(page).getByRole('row').nth(3).click()
    await expect(page).toHaveURL(/[?&]row=/)
    const link = page.url()

    await page.goto(link)
    await expect(pane(page)).toContainText('31 rows')
    await expect(pane(page).locator('[role="row"][aria-selected="true"]')).toContainText('Austin East')

    await pane(page).getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page).not.toHaveURL(/table=/)
  })
})

test.describe('a page that keeps its selection in the URL', () => {
  test.use({ viewport: { width: 1280, height: 860 } })

  test('a row click keeps both the page selection and the table row', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/airquality')
    await page.getByRole('button', { name: 'Open table' }).click()
    const firstRow = pane(page).getByRole('row').nth(1)
    await firstRow.waitFor()
    await firstRow.click()
    await expect(pane(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(1)
    await expect(page).toHaveURL(/[?&]table=monitors/)
    await expect(page).toHaveURL(/[?&]row=/)
  })
})

test.describe('the map table on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('drops row numbers and pins the name while the rest scrolls sideways', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/data')
    await page.getByRole('button', { name: 'Open table' }).click()
    const card = page.locator('[data-map-feature-card-panel="true"]')
    await expect(card.getByRole('columnheader', { name: 'Community' })).toBeVisible()
    await expect(card.getByRole('columnheader', { name: '#' })).toHaveCount(0)

    await card.getByRole('button', { name: 'Table options' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Object ID' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Global ID' }).click()
    await page.keyboard.press('Escape')
    await expect(card.getByRole('columnheader', { name: 'Global ID' })).toBeAttached()

    const widths = await headerWidths(card as ReturnType<typeof pane>)
    expect(widths.Community).toBeLessThan(200)
    const pinned = card.getByRole('columnheader', { name: 'Community' })
    const before = await pinned.boundingBox()
    await card.getByLabel('Data table pane').evaluate((element) => {
      element.scrollLeft = 200
    })
    await expect.poll(async () => (await pinned.boundingBox())?.x).toBe(before?.x)
  })
})

test.describe('pages that offer a table once something is open', () => {
  test.use({ viewport: { width: 1280, height: 860 } })

  test('Boundaries lists the regions of an added layer', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/boundaries')
    await expect(page.getByRole('button', { name: 'Open table' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name: /^BCER admin zones/ }).click()
    await page.getByRole('button', { name: /Done/ }).click()
    await page.getByRole('button', { name: 'Open table' }).click()
    const row = pane(page).getByRole('row').nth(1)
    await row.waitFor()
    await row.click()
    await expect(pane(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(1)
  })

  test('Dev View lists the catalogue once a map is open', async ({ page }) => {
    await stubBasemap(page)
    const record = (id: string, west: number) => ({
      id,
      title: `Map ${id}`,
      bounds: [west, 53, west + 1, 54],
      assets: [{ tiles: ['https://maps.example.test/{z}/{x}/{y}.png'], bounds: [west, 53, west + 1, 54] }],
    })
    await page.route('https://maps.example.test/**', (route) =>
      route.request().url().endsWith('catalog.json')
        ? route.fulfill({ json: { schema: 'raster-catalog-v1', items: [record('a', -124), record('b', -122)] } })
        : route.fulfill({ status: 404 }),
    )
    await page.goto('/dev/view#catalog=https%3A%2F%2Fmaps.example.test%2Fcatalog.json&view=map&map=a')
    await page.getByRole('button', { name: 'Open table' }).click()
    await expect(pane(page)).toContainText('2 rows')
    await pane(page).getByRole('row').nth(2).click()
    await expect(pane(page).locator('[role="row"][aria-selected="true"]')).toContainText('Map b')
  })
})

test.describe('the LiDAR workspace', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('lists the crowns the map draws', async ({ page }) => {
    await stubBasemap(page)
    await page.goto('/dev/lidar/trees/')
    await page.getByRole('button', { name: 'Open table' }).click({ timeout: 40_000 })
    const row = pane(page).getByRole('row').nth(1)
    await row.waitFor({ timeout: 20_000 })
    await row.click()
    await expect(pane(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(1)
  })
})
