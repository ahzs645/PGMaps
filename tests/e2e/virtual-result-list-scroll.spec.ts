import { expect, test, type Page } from '@playwright/test'

const count = 500
const crimeFeatures = Array.from({ length: count }, (_, index) => ({
  type: 'Feature',
  properties: {
    OBJECTID: index,
    File_Number: `test-${index}`,
    Date: Date.UTC(2026, 0, 1) + index * 60_000,
    CrimeType: 'Theft',
    Address: `${index} Example Street${' near the intersection'.repeat(index % 4)}`,
    CommunityName: 'Prince George',
  },
  geometry: { type: 'Point', coordinates: [-122.75, 53.91] },
}))
const parcels = Array.from({ length: count }, (_, index) => ({
  type: 'Feature',
  properties: {
    oid_evbc: String(index),
    address: `${index} Example Street${' near the intersection'.repeat(index % 4)}`,
    desc: 'Residential property',
    cat: 'residential',
    val: 400_000 + index,
    land: 150_000,
    bldg: 250_000,
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.75, 53.91],
        [-122.749, 53.91],
        [-122.749, 53.911],
        [-122.75, 53.91],
      ],
    ],
  },
}))

test.use({ serviceWorkers: 'block' })

for (const [path, label] of [
  ['/pgdata?tab=crime', 'Crime incidents'],
  ['/bc-assessment', 'Properties'],
]) {
  test(`${path} keeps its results usable after fast scrolling`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [], glyphs: 'https://list-test.invalid/{fontstack}/{range}.pbf' },
      }),
    )
    await page.route('https://list-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
    await page.route('**/PGCrime/FeatureServer/0/query?**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).searchParams.has('returnCountOnly')
          ? { count }
          : { type: 'FeatureCollection', features: crimeFeatures },
      }),
    )
    await page.route('**/data/bc-assessment/parcels.geojson', (route) =>
      route.fulfill({
        json: { type: 'FeatureCollection', features: parcels },
      }),
    )
    await page.goto(path)
    const list = page.getByRole('list', { name: label, exact: true })
    await expect(list.getByRole('listitem').first()).toBeVisible()
    const scroll = page.locator('[data-map-sidebar-scroll="true"]').filter({ has: list })
    await scroll.evaluate(async (node) => {
      for (let index = 0; index < 60; index++) {
        node.scrollTop = node.scrollHeight * (index % 2 ? 0.95 : 0.31) + 0.125
        await new Promise(requestAnimationFrame)
      }
      node.scrollTop = node.scrollHeight
    })
    const last = list.locator(`[aria-posinset="${count}"]`)
    await expect(last).toBeVisible()
    expect(await list.getByRole('listitem').count()).toBeLessThan(40)
    await last.getByRole('button').focus()
    await page.keyboard.press('Home')
    await expect(list.locator('[aria-posinset="1"] button')).toBeFocused()
    expect(errors).toEqual([])
  })
}

test.describe('/bc-assessment property details', () => {
  const stubMapData = async (page: Page) => {
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [], glyphs: 'https://list-test.invalid/{fontstack}/{range}.pbf' },
      }),
    )
    await page.route('https://list-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
    await page.route('**/data/bc-assessment/parcels.geojson', (route) =>
      route.fulfill({ json: { type: 'FeatureCollection', features: parcels } }),
    )
  }

  const scrollList = async (page: Page, top: number) => {
    // By CSS, not role: on phones an open feature card hides the sheet behind it
    // from assistive technology, and a role locator would stop finding the list.
    const list = page.locator('[data-virtual-result-list="true"][aria-label="Properties"]')
    await expect(list.locator('[aria-posinset]').first()).toBeVisible()
    const scroll = page.locator('[data-map-sidebar-scroll="true"]').filter({ has: list })
    await scroll.evaluate((node, value) => {
      node.scrollTop = value
    }, top)
    // Virtual rows are recycled, so address the row by its place in the data.
    let position = 0
    await expect
      .poll(async () => {
        position = await scroll.evaluate((node) => {
          const port = node.getBoundingClientRect()
          const middle = (Math.max(port.top, 0) + Math.min(port.bottom, window.innerHeight)) / 2
          const row = [...node.querySelectorAll<HTMLElement>('[aria-posinset]')].find((candidate) => {
            const box = candidate.getBoundingClientRect()
            return box.top <= middle && box.bottom >= middle
          })
          return Number(row?.getAttribute('aria-posinset') ?? 0)
        })
        return position
      })
      .toBeGreaterThan(50)
    return { list, scroll, row: list.locator(`[aria-posinset="${position}"]`) }
  }

  test('open inside the clicked row and leave it where it was', async ({ page }) => {
    await stubMapData(page)
    await page.goto('/bc-assessment')
    const { row } = await scrollList(page, 20_000)
    const before = await row.boundingBox()

    await row.getByRole('button').first().click()

    await expect(row.getByText('Total Assessed')).toBeInViewport({ ratio: 1 })
    expect((await row.boundingBox())?.y).toBeCloseTo(before!.y, 0)
    await row.getByRole('button').first().click()
    await expect(row.getByText('Total Assessed')).toHaveCount(0)
  })

  test('a row near the bottom of the sidebar scrolls until its details fit', async ({ page }) => {
    await stubMapData(page)
    await page.goto('/bc-assessment')
    const { list, scroll } = await scrollList(page, 20_000)
    const box = (await scroll.boundingBox())!
    const position = await scroll.evaluate((node) => {
      const portBottom = node.getBoundingClientRect().bottom
      const rows = [...node.querySelectorAll<HTMLElement>('[aria-posinset]')]
      const lastVisible = rows.filter((row) => row.getBoundingClientRect().bottom <= portBottom).at(-1)
      return lastVisible?.getAttribute('aria-posinset')
    })
    const last = list.locator(`[aria-posinset="${position}"]`)

    await last.getByRole('button').first().click()

    await expect(last.getByText('Building')).toBeInViewport({ ratio: 1 })
    const rowBox = (await last.boundingBox())!
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(box.y + box.height + 1)
  })

  test('a deep link opens its row below the sticky count', async ({ page }) => {
    await stubMapData(page)
    const id = parcels[150].properties.oid_evbc
    await page.goto(`/bc-assessment?property=${id}`)

    const list = page.getByRole('list', { name: 'Properties', exact: true })
    const row = list.locator('[aria-posinset="151"]')
    await expect(row.getByText('Total Assessed')).toBeInViewport({ ratio: 1 })
    const covering = await row
      .getByRole('button')
      .first()
      .evaluate((node) => {
        const box = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(box.left + 40, box.top + 4))
      })
    expect(covering).toBe(true)
  })

  test('phones show the feature card and leave the list in place', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stubMapData(page)
    await page.goto('/bc-assessment')
    await page.getByRole('button', { name: 'Show panel' }).click()
    // Scrolling while the sheet still animates is undone or misread when it lands.
    const sheetTop = () =>
      page
        .locator('[data-map-sidebar-scroll="true"]')
        .first()
        .evaluate((node) => node.getBoundingClientRect().top)
    let settledTop = await sheetTop()
    await expect
      .poll(async () => {
        const previous = settledTop
        await page.waitForTimeout(150)
        settledTop = await sheetTop()
        return settledTop === previous && settledTop < 700
      })
      .toBe(true)
    const { row } = await scrollList(page, 5_000)
    const offset = () =>
      row.evaluate((node) => {
        const port = node.closest('[data-map-sidebar-scroll="true"]')!
        return Math.round(node.getBoundingClientRect().top - port.getBoundingClientRect().top)
      })
    // Rows jumped to are still replacing their estimated height with a measured one.
    let before = await offset()
    await expect
      .poll(async () => {
        const previous = before
        await page.waitForTimeout(100)
        before = await offset()
        return before === previous
      })
      .toBe(true)

    // A raw tap: locator.click() centres a row it finds not yet actionable, which
    // would move the very list this test asserts stays put.
    const box = (await row.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect(page.locator('[aria-label="Selected feature"]')).toBeVisible()
    await expect(row.getByText('Total Assessed')).toHaveCount(0)
    await expect.poll(offset).toBe(before)
  })
})
