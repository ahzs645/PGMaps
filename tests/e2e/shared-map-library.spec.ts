import { expect, test, type Page } from '@playwright/test'
import { choose } from './styled-select'

const host = 'https://maps.example.test'
const catalogueUrl = `${host}/catalog.json`
const TOTAL = 60

function catalogue() {
  const item = (index: number) => {
    const forestry = index % 3 === 0
    return {
      id: `map-${index}`,
      title: `Sheet ${index}`,
      dateLabel: index % 2 ? 'Date unknown' : `19${10 + index}`,
      confidence: index % 4 === 0 ? 'experimental' : 'provisional',
      bounds: [-126, 53, -124, 55],
      assets: [{ tiles: [`${host}/{z}/{x}/{y}.png`], bounds: [-126, 53, -124, 55] }],
      organization: {
        subjects: [forestry ? 'forestry' : 'survey'],
        primarySubject: forestry ? 'forestry' : 'survey',
        sourceGroupId: index < 4 ? 'atlas' : `doc-${index}`,
        sourceGroupTitle: index < 4 ? 'Atlas.pdf' : `Document ${index}.pdf`,
        sourceGroupSize: index < 4 ? 4 : 1,
        pageLabel: `Page ${index + 1}`,
      },
    }
  }
  return {
    schema: 'raster-catalog-v1',
    title: 'Example Map Room',
    description: 'A description the library keeps behind its menu.',
    facets: {
      subjects: [
        { id: 'forestry', label: 'Forestry & land cover' },
        { id: 'survey', label: 'Surveys & cadastral plans' },
      ],
    },
    items: Array.from({ length: TOTAL }, (_, index) => item(index)),
  }
}

async function open(page: Page) {
  await page.route(`${host}/**`, (route) =>
    route.request().url() === catalogueUrl ? route.fulfill({ json: catalogue() }) : route.fulfill({ status: 404 }),
  )
  await page.goto(`/dev/view/#catalog=${encodeURIComponent(catalogueUrl)}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Example Map Room' })).toBeVisible()
}
const count = (page: Page) => page.getByRole('region', { name: 'Map library' }).getByRole('status')
const cards = (page: Page) => page.getByRole('list', { name: 'Map previews' }).getByRole('article')

test.describe('the shared map library on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('shows maps two across, keeps the search in reach and names the filters in use', async ({ page }) => {
    await open(page)
    // The description and the counts line are behind the menu, not above the maps.
    await expect(page.getByText('A description the library keeps behind its menu.')).toHaveCount(0)
    await expect(count(page)).toHaveText(`${TOTAL} maps`)
    const first = await cards(page).nth(0).boundingBox()
    const second = await cards(page).nth(1).boundingBox()
    expect(first && second && Math.abs(first.y - second.y) < 1 && second.x > first.x + first.width).toBe(true)
    // A record with no date gets no "Date unknown" line.
    await expect(cards(page).nth(1)).not.toContainText('Date unknown')
    await expect(cards(page).nth(0)).toContainText('1910 · Page 1')

    const scroller = page.locator('[data-map-sidebar-scroll="true"]')
    await scroller.evaluate((element) => {
      element.scrollTop = 3000
    })
    const search = page.getByRole('textbox', { name: 'Search maps' })
    await expect(search).toBeInViewport()
    await expect(page.getByRole('heading', { level: 1 })).not.toBeInViewport()

    await page.getByRole('button', { name: /^Filters/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Filters' })
    await choose(dialog.getByRole('combobox', { name: 'Subject', exact: true }), 'forestry')
    await dialog.getByRole('button', { name: `Show 20 of ${TOTAL} maps` }).click()
    await expect(count(page)).toHaveText(`20 of ${TOTAL} maps`)
    await expect(scroller).toHaveJSProperty('scrollTop', 0)
    await page.getByRole('button', { name: 'Remove filter: Subject: Forestry & land cover' }).click()
    await expect(count(page)).toHaveText(`${TOTAL} maps`)

    await search.fill('no such sheet')
    await page.getByRole('button', { name: 'Clear search and filters' }).click()
    await expect(count(page)).toHaveText(`${TOTAL} maps`)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('the shared map library on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('filters in place, lists one source and opens a map', async ({ page }) => {
    await open(page)
    const first = await cards(page).nth(0).boundingBox()
    const fourth = await cards(page).nth(3).boundingBox()
    expect(first && fourth && Math.abs(first.y - fourth.y) < 1).toBe(true)
    await choose(page.getByRole('combobox', { name: 'Placement', exact: true }), 'experimental')
    await expect(count(page)).toHaveText(`15 of ${TOTAL} maps`)
    await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Clear' }).click()

    await page.getByRole('button', { name: 'Browse 4 layers from this source' }).first().click()
    await expect(count(page)).toHaveText(`4 of ${TOTAL} maps`)
    // Each card's link to its source would lead back to this same list.
    await expect(page.getByRole('button', { name: /^Browse \d+ layers/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'About this collection' }).click()
    const about = page.getByRole('dialog', { name: 'Example Map Room' })
    await expect(about).toContainText('A description the library keeps behind its menu.')
    await about.getByRole('button', { name: 'Close' }).click()
    await expect(about).toBeHidden()

    await page.getByRole('button', { name: 'Open on map: Sheet 2' }).click()
    await expect(page).toHaveURL(/view=map/)
    await expect(page.getByRole('heading', { name: 'Selected map' })).toBeVisible()
    await page.getByRole('button', { name: 'Library' }).click()
    await expect(count(page)).toHaveText(`4 of ${TOTAL} maps`)
  })
})
