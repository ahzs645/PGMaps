import { expect, test } from '@playwright/test'

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
