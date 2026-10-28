import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** A two-polygon upload, as someone would drop from their own GIS. */
const studyAreas = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Study area A', priority: 'High', budget: 120000 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.78, 53.9],
            [-122.74, 53.9],
            [-122.74, 53.93],
            [-122.78, 53.93],
            [-122.78, 53.9],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Study area B', priority: 'Low', budget: 45000 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.72, 53.89],
            [-122.69, 53.89],
            [-122.69, 53.91],
            [-122.72, 53.91],
            [-122.72, 53.89],
          ],
        ],
      },
    },
  ],
}

async function openDevData(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Stub the basemap with a style that still finishes loading: a glyphs URL is
  // required, or `isLoaded` never turns true and every layer effect no-ops.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: { version: 8, sources: {}, layers: [], glyphs: 'https://dev-data-test.invalid/{fontstack}/{range}.pbf' },
    }),
  )
  await page.route('https://dev-data-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  await page.goto('/dev/data')
  await expect(page.getByRole('heading', { name: 'City data' }).first()).toBeVisible()
  return errors
}

const sidebar = (page: Page) => page.locator('[data-map-sidebar-wrapper]')
const tablePane = (page: Page) => page.locator('[data-panel="data-table-panel"]')

test.describe('/dev/data on desktop', () => {
  test.use({ viewport: { width: 1280, height: 860 } })

  test('lists layers with their legends and filters a category from the legend', async ({ page }) => {
    const errors = await openDevData(page)
    const civic = sidebar(page).locator('[data-layer-item="Civic facilities"]')
    await expect(civic).toContainText('62 rows')
    await expect(civic).toContainText(/Snapshot/)
    const legend = civic.getByRole('group', { name: 'Civic facilities legend' })
    await expect(legend.getByRole('button', { name: 'Leased' })).toHaveAttribute('aria-pressed', 'true')

    await civic.getByRole('button', { name: 'Civic facilities options' }).click()
    await page.getByRole('menuitem', { name: 'Open table' }).click()
    await expect(tablePane(page)).toContainText('62 rows')

    await legend.getByRole('button', { name: 'Leased' }).click()
    await expect(legend.getByRole('button', { name: 'Leased' })).toHaveAttribute('aria-pressed', 'false')
    await expect(tablePane(page)).toContainText('38 rows')
    // Values the legend lumps into "Other" stay on the map when one category is hidden.
    await expect(tablePane(page)).toContainText('Police')
    await expect(civic).toContainText('Filtered')
    expect(errors).toEqual([])
  })

  test('sorts a table column, shows its stats and opens a feature popup from a row', async ({ page }) => {
    const errors = await openDevData(page)
    await sidebar(page).getByRole('button', { name: 'Civic facilities options' }).click()
    await page.getByRole('menuitem', { name: 'Open table' }).click()

    const pane = tablePane(page)
    await pane.getByRole('button', { name: 'Building area column options' }).click()
    await page.getByRole('menuitem', { name: 'Sort descending' }).click()
    await expect(pane.getByRole('columnheader', { name: /Building area/ })).toHaveAttribute('aria-sort', 'descending')
    await expect(pane.getByRole('row').nth(1)).toContainText('CN Centre')

    await pane.getByRole('button', { name: 'Building area column options' }).click()
    await page.getByRole('menuitem', { name: 'Column stats' }).click()
    const stats = page.getByRole('dialog', { name: 'Building area statistics' })
    await expect(stats).toContainText('Maximum')
    await expect(stats).toContainText('14,011 m²')
    await page.keyboard.press('Escape')
    await expect(stats).toBeHidden()

    await pane.getByRole('row').nth(1).click()
    const popup = page.locator('.mapcn-popup')
    await expect(popup).toContainText('CN Centre')
    await expect(popup).toContainText('Civic facilities')
    await expect(popup.getByRole('button', { name: /Show in table/ })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('adds a library layer and an uploaded file while the table is open', async ({ page }) => {
    const errors = await openDevData(page)
    await page.getByRole('button', { name: 'Open table' }).first().click()
    await expect(tablePane(page)).toBeVisible()

    // The first sidebar click after the table opens must not be swallowed.
    await sidebar(page).getByRole('button', { name: 'Add data' }).click()
    const library = page.locator('[data-dev-data-library]')
    await expect(library).toBeVisible()
    await library.getByRole('textbox', { name: 'Search the data library' }).fill('bus')
    await library.getByRole('button', { name: 'Add Transit bus stops' }).click()
    await expect(library.getByRole('button', { name: 'Transit bus stops, added' })).toBeVisible()

    await library.getByLabel('Choose files to upload').setInputFiles({
      name: 'study_areas.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(studyAreas)),
    })
    await expect(library).toBeHidden()
    await expect(sidebar(page).getByRole('heading', { name: 'Your uploads' })).toBeVisible()
    const upload = sidebar(page).locator('[data-layer-item="study areas"]')
    await expect(upload).toContainText('2 rows · Uploaded study_areas.geojson')
    await expect(sidebar(page).locator('[data-layer-item="Transit bus stops"]')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('explains a file it cannot read', async ({ page }) => {
    await openDevData(page)
    await sidebar(page).getByRole('button', { name: 'Add data' }).click()
    const library = page.locator('[data-dev-data-library]')
    await library.getByLabel('Choose files to upload').setInputFiles({
      name: 'counts.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,value\nA,1\n'),
    })
    await expect(library).toContainText('latitude and longitude')
  })

  test('restyles a layer by a numeric column and swipes between two boundaries', async ({ page }) => {
    const errors = await openDevData(page)
    await sidebar(page).getByRole('button', { name: 'Style and explore Civic facilities' }).click()
    await sidebar(page).getByRole('button', { name: 'Color range' }).click()
    await expect(sidebar(page).getByRole('button', { name: 'Color range' })).toHaveAttribute('aria-pressed', 'true')
    await expect(sidebar(page).getByRole('group', { name: 'Civic facilities legend' })).toContainText('≥')
    await expect(sidebar(page).getByText('Insights')).toBeVisible()
    await sidebar(page).getByRole('button', { name: 'Back to layers' }).click()

    await sidebar(page).getByRole('button', { name: 'Boundaries group options' }).click()
    await page.getByRole('menuitemradio', { name: 'Swipe between two layers' }).click()
    await sidebar(page).getByRole('button', { name: 'Show Subdivision boundaries' }).click()
    await expect(page.getByTestId('dev-data-swipe-slider')).toHaveAttribute(
      'aria-label',
      'Compare Community boundaries and Subdivision boundaries',
    )
    expect(errors).toEqual([])
  })
})

test.describe('/dev/data on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('keeps the layer list and library reachable from the sheet', async ({ page }) => {
    const errors = await openDevData(page)
    await expect(page.getByRole('button', { name: 'Add data' })).toBeVisible()
    await page.getByRole('button', { name: 'Add data' }).click()
    await expect(page.locator('[data-dev-data-library]')).toBeVisible()
    expect(errors).toEqual([])
  })
})
