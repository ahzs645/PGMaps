import { expect, test, type Page } from '@playwright/test'

// Keep production-preview caching from bypassing mocked source failures.
test.use({ serviceWorkers: 'block' })

const sample = '3333 University Way, Prince George, BC'
const other = 'Quesnel, BC'
async function prepare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          ;(window as unknown as { copiedText: string }).copiedText = text
        },
      },
    })
  })
  await page.route('https://geocoder.api.gov.bc.ca/**', (route) => {
    const address = new URL(route.request().url()).searchParams.get('addressString') ?? ''
    if (address === 'fail') return route.fulfill({ status: 500, body: 'unavailable' })
    const quesnel = address === other
    return route.fulfill({
      json: {
        features: [
          {
            geometry: {
              coordinates: address.includes('Victoria')
                ? [-123.3117, 48.4634]
                : address.includes('Fort St. John')
                  ? [-120.8476, 56.2465]
                  : quesnel
                    ? [-122.49, 52.98]
                    : [-122.814, 53.888],
            },
            properties: { fullAddress: address, score: 100, matchPrecision: 'CIVIC_NUMBER' },
          },
        ],
      },
    })
  })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef4f2' } }],
      },
    }),
  )
  await page.goto('/dev/acknowledgement')
}
async function addAddress(page: Page, address = sample) {
  await page
    .getByRole('navigation', { name: 'Builder steps' })
    .getByRole('button', { name: 'Location', exact: true })
    .click()
  await page.getByLabel('B.C. address', { exact: true }).fill(address)
  await page.getByRole('button', { name: 'Find address', exact: true }).click()
  await page.getByRole('button', { name: 'Use this location', exact: true }).click()
}
async function goWording(page: Page) {
  await page
    .getByRole('navigation', { name: 'Builder steps' })
    .getByRole('button', { name: 'Your wording', exact: true })
    .click()
}

test('mobile address-to-draft flow is compact, source-backed, and defers optional data', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const dataRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/data/')) dataRequests.push(request.url())
  })
  await prepare(page)
  expect(dataRequests.filter((url) => url.endsWith('.geojson'))).toEqual([])
  await addAddress(page)
  await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: 'Review Nations' }).click()
  await expect(page.getByRole('checkbox', { name: 'Include Lheidli T’enneh First Nation', exact: true })).toBeChecked()
  await expect(
    page.getByRole('link', { name: 'UNBC Traditional Territory Acknowledgement', exact: true }),
  ).toBeVisible()
  await goWording(page)
  const draft = page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
  await expect(draft).toHaveValue(/Lheidli/)
  expect((await draft.boundingBox())!.y).toBeLessThan(500)
  expect(dataRequests.some((url) => /\/data\/(native-land|fpcc)\/|indian_reserves|community_locations/.test(url))).toBe(
    false,
  )
  await page.getByRole('button', { name: 'Copy draft', exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(
    await draft.inputValue(),
  )
  for (const width of [320, 375, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('organization copy owns its visible draft and transfers generator options', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await page.getByRole('button', { name: 'Organization examples', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search organizations' }).fill('bc ferries')
  await page.getByRole('button', { name: /BC Ferries/ }).click()
  await page.getByRole('button', { name: 'Formal', exact: true }).click()
  const statement = await page.getByRole('textbox', { name: 'Organization draft', exact: true }).inputValue()
  await page.getByRole('button', { name: 'Copy organization draft', exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe(statement)
  await expect(page.getByRole('button', { name: 'Copy wording', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Use this draft in builder', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })).toHaveValue(statement)
})

test('manual wording survives point focus, context changes, and reload', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await goWording(page)
  const editor = page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
  await expect(editor).toHaveValue(/Lheidli/)
  await editor.fill('My carefully edited acknowledgment.')
  await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: 'Location' }).click()
  await page.getByRole('button', { name: 'Choose or view on map', exact: true }).click()
  await page.getByRole('button', { name: 'Focus point 1', exact: true }).click()
  // A marker focus must not relocate the point or clear the draft.
  await expect(
    page.getByRole('button', { name: new RegExp(sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }),
  ).toContainText(sample)
  await goWording(page)
  await expect(editor).toHaveValue('My carefully edited acknowledgment.')
  await addAddress(page, other)
  await goWording(page)
  await expect(editor).toHaveValue('My carefully edited acknowledgment.')
  await page.reload()
  await goWording(page)
  await expect(editor).toHaveValue('My carefully edited acknowledgment.')
  await expect(page.getByText('Restored your saved work from this device.', { exact: true })).toBeVisible()
})

test('failed and unconfirmed searches cannot replace a confirmed draft context', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await goWording(page)
  const editor = page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
  await expect(editor).toHaveValue(/Lheidli/)
  const previous = await editor.inputValue()
  await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: 'Location' }).click()
  await page.getByLabel('B.C. address', { exact: true }).fill('fail')
  await page.getByRole('button', { name: 'Find address', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Your confirmed locations have been kept')
  await goWording(page)
  await expect(editor).toHaveValue(previous)
  await expect(page.getByText(new RegExp('Venue: 3333 University Way'))).toBeVisible()
})

test('combined drafts remain incomplete until every location has a reviewed selection', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await addAddress(page, 'Unknown place, BC')
  await goWording(page)
  await page.getByLabel('Acknowledgment purpose', { exact: true }).selectOption('operations')
  await expect(page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Copy draft', exact: true })).toBeDisabled()
  await expect(page.getByText(/1 of 2 locations ready\./)).toBeVisible()
  await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: 'Review Nations' }).click()
  // Boundary context is available but must be explicitly selected.
  await expect(
    page.getByRole('checkbox', { name: 'Include Lheidli T’enneh First Nation', exact: true }),
  ).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Include Lheidli T’enneh First Nation', exact: true }).check()
  await goWording(page)
  await expect(page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })).toHaveValue('')
  await expect(page.getByText(/These selections include context/)).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
    .fill('My wording after reviewing local sources.')
  await expect(page.getByRole('button', { name: 'Copy draft', exact: true })).toBeEnabled()
})

test('clipboard errors offer manual selection and optional language failures do not block drafting', async ({
  page,
}) => {
  await prepare(page)
  await addAddress(page)
  await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: 'Review Nations' }).click()
  await expect(page.getByRole('checkbox', { name: 'Include Lheidli T’enneh First Nation', exact: true })).toBeChecked()
  await page.route('**/data/fpcc/language-geo.geojson', (route) => route.fulfill({ status: 500 }))
  await page.getByRole('button', { name: 'Explore local language context', exact: true }).click()
  await expect(page.getByText(/Your Nation selections are unaffected/)).toBeVisible()
  await goWording(page)
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('denied')
    }
  })
  await page.getByRole('button', { name: 'Copy draft', exact: true }).click()
  await expect(page.getByText(/Copy was unavailable/)).toBeVisible()
  await page.getByRole('button', { name: 'Select text', exact: true }).click()
  expect(
    await page
      .getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
      .evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart),
  ).toBeGreaterThan(30)
})

test('map taps are read-only until a proposed placement is confirmed', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await page.getByRole('button', { name: 'Choose or view on map', exact: true }).click()
  const marker = page.getByRole('button', { name: 'Focus point 1', exact: true })
  await expect(marker).toBeVisible()
  const canvas = page.locator('canvas.maplibregl-canvas')
  await canvas.click({ position: { x: 80, y: 80 } })
  await expect(page.getByRole('button', { name: 'Confirm location', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add map location', exact: true }).click()
  await canvas.click({ position: { x: 100, y: 100 } })
  await expect(page.getByRole('button', { name: 'Confirm location', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Your locations (1)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm location', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your locations (2)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove location 1', exact: true }).click()
  const remaining = page.getByRole('button', { name: 'Focus point 1', exact: true })
  await expect(remaining).toHaveAttribute('aria-pressed', 'true')
  await expect(remaining).toHaveCSS('background-color', 'rgb(190, 18, 60)')
})

test('stale geocodes are ignored and edited text is replaced only explicitly', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await goWording(page)
  const editor = page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
  await expect(editor).toHaveValue(/Lheidli/)
  await editor.fill('My edited draft')
  await page.getByText('Voice, occasion and scope', { exact: true }).click()
  await page.getByRole('button', { name: 'Short', exact: true }).click()
  await expect(editor).toHaveValue('My edited draft')
  await page.getByRole('button', { name: 'Keep my wording', exact: true }).click()
  await expect(editor).toHaveValue('My edited draft')
  await page.getByText('Your wording is kept. A generated suggestion is available.', { exact: true }).click()
  await page.getByRole('button', { name: 'Replace with suggestion', exact: true }).click()
  await expect(editor).toHaveValue(/We are on/)
  await page
    .getByRole('navigation', { name: 'Builder steps' })
    .getByRole('button', { name: 'Location', exact: true })
    .click()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('https://geocoder.api.gov.bc.ca/**', async (route) => {
    await gate
    await route
      .fulfill({
        json: {
          features: [
            {
              geometry: { coordinates: [-123, 50] },
              properties: { fullAddress: 'Stale address', score: 100, matchPrecision: 'CIVIC_NUMBER' },
            },
          ],
        },
      })
      .catch(() => undefined)
  })
  await page.getByLabel('B.C. address', { exact: true }).fill('old search')
  const request = page.waitForRequest('https://geocoder.api.gov.bc.ca/**')
  await page.getByRole('button', { name: 'Find address', exact: true }).click()
  await request
  await page.getByLabel('B.C. address', { exact: true }).fill('new input')
  release()
  await expect(page.getByRole('button', { name: 'Use this location', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your locations (1)', exact: true })).toBeVisible()
})

test('the last generated draft is recoverable when evidence is unavailable after reload', async ({ page }) => {
  await prepare(page)
  await addAddress(page)
  await goWording(page)
  const draft = page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
  await expect(draft).toHaveValue(/Lheidli/)
  const previous = await draft.inputValue()
  await page.route('**/data/acknowledgement/relationship-graph.json', (route) => route.fulfill({ status: 503 }))
  await page.reload()
  await goWording(page)
  await expect(draft).toHaveValue(previous)
  await expect(page.getByRole('button', { name: 'Copy draft', exact: true })).toBeEnabled()
  await expect(page.getByText(/Your saved wording is kept with its original context/)).toBeVisible()
})

test('UVic deselection is respected in the visible draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepare(page)
  await addAddress(page, '3800 Finnerty Road, Victoria, BC')
  await page.getByRole('navigation', { name: 'Builder steps' }).getByRole('button', { name: 'Review Nations' }).click()
  await page.getByRole('checkbox', { name: 'Include Songhees Nation', exact: true }).uncheck()
  await expect(page.getByRole('checkbox', { name: 'Include Songhees Nation', exact: true })).toBeFocused()
  await page.getByRole('checkbox', { name: 'Include Xʷsepsəm (Esquimalt) Nation', exact: true }).uncheck()
  await expect(page.getByRole('checkbox', { name: 'Include W̱SÁNEĆ Peoples', exact: true })).toBeChecked()
  await goWording(page)
  const text = await page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true }).inputValue()
  expect(text).toContain('continuing relationships of W̱SÁNEĆ Peoples')
  expect(text).not.toMatch(/Songhees|Esquimalt|territor/)
})

test('venue choice and distributed purpose preserve location facts and survive reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepare(page)
  await addAddress(page)
  await addAddress(page, '9820 120 Avenue, Fort St. John, BC')
  await goWording(page)
  const editor = page.getByRole('textbox', { name: 'Draft acknowledgment', exact: true })
  await expect(editor).toHaveValue(/Lheidli/)
  await expect(editor).not.toHaveValue(/Treaty 8/)
  await page.getByLabel('Event venue', { exact: true }).selectOption({ label: '9820 120 Avenue, Fort St. John, BC' })
  await expect(editor).toHaveValue(/Treaty 8/)
  await expect(editor).not.toHaveValue(/Lheidli/)
  await page.getByLabel('Acknowledgment purpose', { exact: true }).selectOption('distributed')
  await expect(editor).toHaveValue(/For participants joining from/)
  const text = await editor.inputValue()
  expect(text).toContain('unceded traditional territory of Lheidli')
  expect(text).toContain('Treaty 8 territory')
  expect(text).not.toMatch(/gather|operates/)
  await page.reload()
  await goWording(page)
  await expect(page.getByLabel('Acknowledgment purpose', { exact: true })).toHaveValue('distributed')
  await expect(editor).toHaveValue(text)
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})
