import { expect, test, type Page } from '@playwright/test'

/** The history button carries the record count, e.g. "Inspection history (3)". */
const INSPECTION_HISTORY = /^Inspection history( \(\d+\))?$/

test.describe('Food Map', () => {
  for (const width of [1280, 390]) {
    test(`opens inspection reports after selecting a list result at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.route('**/data/restaurants.json', (route) => route.fulfill({ json: [{
        name: 'Inspection test cafe',
        address: '123 Test Street',
        city: 'Prince George',
        latitude: 53.91,
        longitude: -122.75,
        facility_type: 'Restaurant',
        hazard_rating: 'Low',
        details_url: 'https://example.test/premise/cafe',
        inspections: [{
          date: '18-Mar-2024',
          type: 'Routine',
          hazard_rating: 'Low',
          critical_violations_count: 1,
          non_critical_violations_count: 0,
          violations: [{
            code: '201',
            description: 'Food protected from contamination',
            observation: 'Inspection report observation',
            corrective_action: 'Inspection report corrective action',
          }],
        }],
      }] }))
      for (const file of ['restaurant-classifications.json', 'restaurant-location-overrides.json', 'ui/restaurant-locations.json']) {
        await page.route(`**/data/${file}`, (route) => route.fulfill({ json: {} }))
      }
      await page.route('https://basemaps.cartocdn.com/**/style.json', (route) => route.fulfill({
        json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef2f6' } }] },
      }))
      await page.goto('/foodmap?date=2026-10-01', { waitUntil: 'domcontentloaded' })
      if (width < 768) await page.locator('[data-map-mobile-sheet-handle]').press('End')
      await page.getByRole('list', { name: 'Establishments' }).getByRole('button', { name: /^Inspection test cafe/ }).click()

      const history = page.getByRole('button', { name: INSPECTION_HISTORY })
      await expect(history).toHaveCount(1)
      await expect(history).toBeVisible()
      await expect(history).toBeInViewport()
      await history.click()
      const dialog = page.getByRole('dialog', { name: 'Inspection test cafe' })
      await expect(dialog.getByText('Inspection report observation', { exact: false })).toBeVisible()
      await expect(dialog.getByText('Inspection report corrective action', { exact: false })).toBeVisible()
      await expect(dialog.getByRole('link', { name: /HealthSpace/ })).toHaveAttribute('href', 'https://example.test/premise/cafe')
    })
  }

  test('roulette keeps non-dining premises out even when optional filters are disabled', async ({ page }) => {
    const categories: Record<string, string> = {
      'Pizza place': 'Restaurant',
      'Coffee place': 'Coffee Shop',
      'Evangelical Free Church': 'Community Kitchen',
      'PG Civic Centre - CG 60667': 'Concession',
      'Meal program': 'Social Services',
      '7-Eleven Food Store #37259': 'Restaurant',
      'Costco Food Court': 'Concession',
    }
    const premises = Object.keys(categories).map((name, index) => ({
      name,
      address: 'Prince George',
      latitude: 53.91 + index * 0.001,
      longitude: -122.75,
      facility_type: 'Restaurant',
      hazard_rating: 'Low',
      details_url: `https://example.test/premise/${index}`,
      inspections: [],
    }))
    await page.route('**/data/restaurants.json', (route) => route.fulfill({ json: premises }))
    await page.route('**/data/restaurant-classifications.json', (route) => route.fulfill({ json: categories }))
    await page.route('**/data/restaurant-location-overrides.json', (route) => route.fulfill({ json: {} }))
    await page.route('**/data/ui/restaurant-locations.json', (route) => route.fulfill({ json: {} }))
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('7 establishments', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Restaurant roulette', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Restaurant Roulette' })
    const dining = dialog.getByRole('region', { name: 'Dining categories' })
    const filters = dialog.getByRole('button', { name: /^Filters/ })
    const safetyFilters = dialog.getByRole('button', { name: 'Distance and safety filters', exact: true })
    await expect(dialog.getByText('2 available', { exact: true })).toBeVisible()

    // Everything but the wheel starts behind the Filters button.
    await expect(filters).toHaveAttribute('aria-expanded', 'false')
    await expect(dining).toBeHidden()
    await filters.click()
    await expect(dining).toBeVisible()
    await expect(safetyFilters).toHaveAttribute('aria-pressed', 'false')

    // Places outside the default list are one category, never individual rows.
    await expect(dialog.getByRole('region', { name: 'Individual exceptions' })).toHaveCount(0)
    await expect(dialog.getByText('Costco Food Court')).toHaveCount(0)
    const otherSpots = dining.getByRole('button', { name: 'Other spots 2', exact: true })
    await expect(otherSpots).toHaveAttribute('aria-pressed', 'false')
    await otherSpots.click()
    await expect(otherSpots).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByText('4 available', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Filters, 1 active', exact: true })).toBeVisible()

    await dining.getByRole('button', { name: 'None', exact: true }).click()
    await expect(dialog.getByText('0 available', { exact: true })).toBeVisible()
    await expect(dialog.getByText('No restaurants match your filters')).toBeVisible()
    await dining.getByRole('button', { name: 'Restaurant 1', exact: true }).click()
    await expect(dialog.getByText('1 available', { exact: true })).toBeVisible()

    await safetyFilters.click()
    await expect(dialog.getByText('1 available', { exact: true })).toBeVisible()
    await safetyFilters.click()
    await expect(dialog.getByText('1 available', { exact: true })).toBeVisible()
    await dining.getByRole('button', { name: 'All', exact: true }).click()
    await expect(dialog.getByText('4 available', { exact: true })).toBeVisible()

    // Closing the panel keeps its choices.
    await dialog.getByRole('button', { name: /^Filters/ }).click()
    await expect(dining).toBeHidden()
    await expect(dialog.getByText('4 available', { exact: true })).toBeVisible()
  })

  test('roulette shows the blue play button before it is hovered', async ({ page }) => {
    await page.route('**/data/restaurants.json', (route) =>
      route.fulfill({
        json: [
          {
            name: 'Pizza place',
            address: 'Prince George',
            latitude: 53.91,
            longitude: -122.75,
            facility_type: 'Restaurant',
            hazard_rating: 'Low',
            details_url: 'https://example.test/premise/pizza',
            inspections: [],
          },
        ],
      }),
    )
    await page.route('**/data/restaurant-classifications.json', (route) =>
      route.fulfill({ json: { 'Pizza place': 'Restaurant' } }),
    )
    await page.route('**/data/restaurant-location-overrides.json', (route) => route.fulfill({ json: {} }))
    await page.route('**/data/ui/restaurant-locations.json', (route) => route.fulfill({ json: {} }))
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Restaurant roulette', exact: true }).click()

    const play = page.locator('.spinner-wheel-spin-button')
    await play.waitFor()
    await page.mouse.move(0, 0)
    await expect(play).toHaveCSS('background-color', 'rgb(52, 142, 246)')
    await play.hover()
    await expect(play).toHaveCSS('background-color', 'rgb(45, 138, 240)')
  })

  test.describe('on a touch phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('roulette opens from the phone sheet instead of its hide-panel chevron', async ({ page }) => {
      await page.route('**/data/restaurants.json', (route) =>
        route.fulfill({
          json: [
            {
              name: 'Pizza place',
              address: 'Prince George',
              latitude: 53.91,
              longitude: -122.75,
              facility_type: 'Restaurant',
              hazard_rating: 'Low',
              details_url: 'https://example.test/premise/pizza',
              inspections: [],
            },
          ],
        }),
      )
      await page.route('**/data/restaurant-classifications.json', (route) =>
        route.fulfill({ json: { 'Pizza place': 'Restaurant' } }),
      )
      await page.route('**/data/restaurant-location-overrides.json', (route) => route.fulfill({ json: {} }))
      await page.route('**/data/ui/restaurant-locations.json', (route) => route.fulfill({ json: {} }))
      await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

      // The collapsed sheet offers it directly. This has to be a touch: the sheet's
      // gestures are native touch listeners, which a mouse click never reaches.
      await page.getByRole('button', { name: 'Open restaurant roulette', exact: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'Restaurant Roulette' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Close restaurant roulette', exact: true }).click()
      await expect(dialog).toBeHidden()

      // click() refuses to land if the chevron covers the button's centre.
      await page.getByRole('button', { name: 'Show panel', exact: true }).tap()
      await page.getByRole('button', { name: 'Restaurant roulette', exact: true }).tap({ timeout: 5_000 })
      await expect(dialog).toBeVisible()

      // A long panel can always be closed to get back to the wheel.
      const filters = dialog.getByRole('button', { name: /^Filters/ })
      await filters.click()
      await dialog.getByRole('button', { name: 'Distance and safety filters', exact: true }).click()
      await dialog.getByText('Exclude Hazard Ratings').scrollIntoViewIfNeeded()
      await expect(filters).toBeInViewport()

      // Spinning closes the panel so the wheel is never half hidden.
      await filters.click()
      await filters.click()
      await expect(dialog.getByRole('region', { name: 'Dining categories' })).toBeVisible()
      await dialog.locator('.spinner-wheel-spin-button').click()
      await expect(dialog.getByRole('region', { name: 'Dining categories' })).toBeHidden()
    })
  })

  test('loads and displays food establishments', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Wait for data to load - sidebar should show the establishment count
    await expect(page.getByText(/establishments/i)).toBeVisible({ timeout: 15_000 })
  })

  test('search query is reflected in URL params', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    // Wait for data to load
    await expect(page.getByText(/establishments/i)).toBeVisible({ timeout: 15_000 })

    // Find and fill the search input
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('pizza')

      // URL should contain the search query
      await expect(page).toHaveURL(/q=pizza/)
    }
  })

  test('loads with URL search param pre-filled', async ({ page }) => {
    await page.goto('/foodmap?q=pizza', { waitUntil: 'domcontentloaded' })

    // Wait for data to load
    await expect(page.getByText(/establishments/i)).toBeVisible({ timeout: 15_000 })

    // Search should be pre-filled
    const searchInput = page.getByPlaceholder(/search/i).first()
    if (await searchInput.isVisible()) {
      await expect(searchInput).toHaveValue('pizza')
    }
  })

  test.describe('timeline', () => {
    const inspection = (date: string, hazard_rating: string, critical_violations_count = 0) => ({
      date,
      type: 'Routine Inspection',
      hazard_rating,
      critical_violations_count,
      non_critical_violations_count: 0,
    })
    const premise = (name: string, inspections: ReturnType<typeof inspection>[]) => ({
      name,
      address: '123 Test Street',
      latitude: 53.91,
      longitude: -122.75,
      facility_type: 'Restaurant',
      hazard_rating: 'Low',
      details_url: `https://example.test/premise/${name}`,
      inspections,
    })

    test.beforeEach(async ({ page }) => {
      await page.route('**/data/restaurants.json', (route) =>
        route.fulfill({
          json: [
            premise('Steady cafe', [inspection('10-Jan-2024', 'Low', 2), inspection('5-Apr-2025', 'Low', 3)]),
            premise('Slipping grill', [inspection('1-Feb-2024', 'Low'), inspection('18-Mar-2024', 'High', 4)]),
          ],
        }),
      )
      for (const file of ['restaurant-classifications.json', 'restaurant-location-overrides.json', 'ui/restaurant-locations.json']) {
        await page.route(`**/data/${file}`, (route) => route.fulfill({ json: {} }))
      }
    })

    const timeline = (page: Page) => page.locator('[data-map-timeline]')
    const scrubber = (page: Page) => page.getByRole('slider', { name: 'Timeline' })

    test('opens on the last inspection, not today, and highlights the window the map counts', async ({ page }) => {
      await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Inspections through Apr 2025')).toBeVisible()
      await page.getByRole('button', { name: 'Timeline', exact: true }).click()

      await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'May 2024 – Apr 2025')
      await expect(scrubber(page)).toHaveAttribute('aria-valuemax', '15')
      await expect(timeline(page)).toContainText('1 inspection · 3 critical')
      await expect(page).not.toHaveURL(/date=/)

      await timeline(page).getByRole('group', { name: 'Window' }).getByRole('button', { name: 'All', exact: true }).click()
      await expect(page).toHaveURL(/months=0/)
      await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'Through Apr 2025')
      await expect(timeline(page)).toContainText('4 inspections · 9 critical')
    })

    test('the bars follow the filters', async ({ page }) => {
      await page.goto('/foodmap?months=0&q=Steady', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Timeline', exact: true }).click()
      await expect(timeline(page)).toContainText('2 inspections · 5 critical')
    })

    test('a shared link lands on its month with the timeline open', async ({ page }) => {
      await page.goto('/foodmap?date=2024-03', { waitUntil: 'domcontentloaded' })
      // A window reaching past the first inspection stops there, here and in the sidebar.
      await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'Jan 2024 – Mar 2024')
      await expect(page.getByText('Jan 2024 – Mar 2024', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Apr 2023 – Mar 2024')).toHaveCount(0)
      await scrubber(page).press('ArrowLeft')
      await expect(page).toHaveURL(/date=2024-02/)
      await scrubber(page).press('End')
      await expect(page).not.toHaveURL(/date=/)
    })

    test('older all-time links keep working', async ({ page }) => {
      await page.goto('/foodmap?violationTimeline=cumulative', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Timeline', exact: true }).click()
      await expect(scrubber(page)).toHaveAttribute('aria-valuetext', 'Through Apr 2025')
    })

    test('warns when the window reaches the sparse early record', async ({ page }) => {
      await page.route('**/data/restaurants.json', (route) =>
        route.fulfill({ json: [premise('Old diner', [inspection('10-Jan-2021', 'Low', 1)])] }),
      )
      await page.goto('/foodmap?date=2021-01', { waitUntil: 'domcontentloaded' })
      await expect(timeline(page)).toContainText('Far fewer violations before Sep 2022')
      await expect(page.getByText(/Inspections found far fewer violations before Sep 2022/)).toBeVisible()
    })

    test('hazard mode reads the month end, shows High, and lists what changed', async ({ page }) => {
      await page.goto('/foodmap?mode=hazard&date=2024-03', { waitUntil: 'domcontentloaded' })

      await expect(timeline(page)).toContainText('1 rating change · 1 worse · 0 better')
      await expect(page.getByRole('button', { name: /^High\b/ })).toContainText('1')
      await expect(page.getByRole('list', { name: 'Establishments' }).getByRole('button', { name: /^Slipping grill/ })).toBeVisible()

      const changes = page.getByRole('region', { name: 'Rating changes in Mar 2024' })
      await changes.getByRole('button', { name: /Slipping grill/ }).click()
      await expect(page).toHaveURL(/restaurant=Slipping/)

      await scrubber(page).press('ArrowLeft')
      await expect(page.getByRole('region', { name: 'Rating changes in Feb 2024' })).toContainText('No rating changed')
    })
  })

  test('refreshes donut clusters when the violation time window changes', async ({ page }) => {
    await page.goto('/foodmap', { waitUntil: 'domcontentloaded' })

    const donutPaths = page.locator('.maplibregl-marker svg path')
    await expect(donutPaths.first()).toBeVisible({ timeout: 15_000 })
    const periodDonuts = await donutPaths.evaluateAll((paths) => paths.map((path) => path.outerHTML).join(''))

    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await page.getByRole('group', { name: 'Window' }).getByRole('button', { name: 'All', exact: true }).click()
    await expect(page).toHaveURL(/months=0/)
    await expect.poll(
      () => donutPaths.evaluateAll((paths) => paths.map((path) => path.outerHTML).join('')),
      { timeout: 15_000 },
    ).not.toBe(periodDonuts)
  })

  test('opens earlier inspection history when the selected period has no records', async ({ page }) => {
    await page.goto('/foodmap?restaurant=7-Eleven+Food+Store+%2337258', { waitUntil: 'domcontentloaded' })

    const history = page.getByRole('button', { name: INSPECTION_HISTORY })
    await expect(history).toBeVisible({ timeout: 15_000 })
    // The summary dates the latest record and says it predates the period, instead of "0 inspections".
    await expect(page.locator('[data-restaurant-latest-inspection]')).toContainText('before this period')
    await history.click()

    const dialog = page.getByRole('dialog')
    const range = dialog.getByRole('group', { name: 'Inspection history range' })
    // The range buttons carry their counts, which explain why history opened instead of the period.
    await expect(range.getByRole('button', { name: /^All history \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('button', { name: /March 18, 2024.*Routine/ })).toBeVisible()
    await range.getByRole('button', { name: /\(0\)$/ }).click()
    await expect(dialog.getByText(/^No inspections in /)).toBeVisible()
    await range.getByRole('button', { name: /^All history/ }).click()
    await expect(dialog.getByRole('button', { name: /March 18, 2024.*Routine/ })).toBeVisible()
  })

  test('an establishment with no inspection records shows one empty state, not a page of zeros', async ({ page }) => {
    await page.goto('/foodmap?restaurant=Freeman+Park', { waitUntil: 'domcontentloaded' })

    await page.getByRole('button', { name: INSPECTION_HISTORY }).click()
    const dialog = page.getByRole('dialog', { name: 'Freeman Park' })
    await expect(dialog.getByText('No inspection records on file')).toBeVisible()
    await expect(dialog.getByText('2825 12th Avenue, Prince George', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^All history/ })).toHaveCount(0)
    await expect(dialog.getByText(/N\/A/)).toHaveCount(0)
  })
})
