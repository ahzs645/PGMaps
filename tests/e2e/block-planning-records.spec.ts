import { readFile } from 'node:fs/promises'
import { test, expect, type Page, type Route } from '@playwright/test'
import { choose } from './styled-select'

/** The forest development unit layer, stubbed: the units over the block, then the plan's amendments by id. */
async function stubFsp(page: Page) {
  const feature = (props: Record<string, unknown>) => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.8, 53.98],
          [-122.7, 53.98],
          [-122.7, 54.01],
          [-122.8, 54.01],
          [-122.8, 53.98],
        ],
      ],
    },
    // A required field DataBC sends whatever is asked: the reader must drop it.
    properties: { OBJECTID: props.FSP_AMENDMENT_NUMBER, CLIENT_NAME1: 'Not to be kept', ...props },
  })
  await page.route('https://openmaps.gov.bc.ca/geo/pub/wfs*', async (route: Route) => {
    const body = new URLSearchParams(route.request().postData() ?? '')
    const filter = body.get('CQL_FILTER') ?? ''
    const features = !body.get('typeNames')?.includes('FSP_FDU_POLY_SPG')
      ? []
      : filter.includes('FSP_ID IN')
        ? [
            feature({
              FSP_ID: 24,
              FDU_ID: 1,
              FSP_AMENDMENT_NUMBER: 25,
              LIFE_CYCLE_STATUS_CODE: 'PREVIOUS',
              AMENDMENT_APPROVAL_DATE: '2023-05-11Z',
            }),
            feature({
              FSP_ID: 24,
              FDU_ID: 1,
              FSP_AMENDMENT_NUMBER: 27,
              LIFE_CYCLE_STATUS_CODE: 'APPROVED',
              AMENDMENT_APPROVAL_DATE: '2025-04-28Z',
            }),
          ]
        : [feature({ FSP_ID: 24, FDU_ID: 1, FSP_AMENDMENT_NUMBER: 27, LIFE_CYCLE_STATUS_CODE: 'APPROVED' })]
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ type: 'FeatureCollection', features }),
    })
  })
}

const section = (page: Page, title: RegExp) => page.getByRole('button', { name: title }).first()

test('a crossing’s missing records are drafted, tracked and, once received, used as an answer', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await stubFsp(page)
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByRole('tab', { name: 'Review' }).click()

  // A crossing on the block's own road.
  const crossings = page.getByTestId('block-planning-crossings')
  await crossings.getByLabel('New crossing’s name').fill('Culvert at Spur 3')
  await crossings.getByRole('button', { name: 'Add crossing' }).click()
  await expect(page.getByTestId('crossing-review-crossing-1')).toBeVisible()

  // Its gaps, grouped by where to ask: the road permit file answers when it was built.
  await section(page, /^Records to get (\d|None)/).click()
  const records = page.getByTestId('block-planning-records')
  const engineering = records.getByTestId('records-channel-district-engineering')
  const built = engineering.locator('[data-gap="crossing-build-date:block-1:proposed:crossing-1"]')
  await expect(built).toContainText('When the crossing was built or replaced · Block 1 · Culvert at Spur 3')
  await expect(built).toContainText('Not requested')

  // The drafted request: one letter for the channel, and its freedom of information version.
  await engineering.getByRole('button', { name: 'Draft request' }).click()
  const letter = engineering.getByTestId('records-letter')
  await expect(letter).toContainText("To: The natural resource district's engineering staff")
  await expect(letter).toContainText('“Culvert at Spur 3”')
  await engineering.getByRole('button', { name: 'Freedom of information version' }).click()
  await expect(letter).toContainText('sever that part and release the rest')

  // Marked requested, with its reference.
  await engineering.getByRole('button', { name: 'Mark requested' }).first().click()
  await engineering.getByLabel('Event reference').fill('District inbox, 27 Nov')
  await engineering.getByTestId('records-event').getByRole('button', { name: 'Mark requested' }).click()
  await expect(built).toContainText('Requested')

  // What came back: the reviewer's transcription, which answers nothing until used.
  await engineering.getByRole('button', { name: 'Enter what came back' }).click()
  const form = engineering.getByTestId('records-received-form')
  await form.getByLabel('Record title').fill('Road permit file, section 03')
  await form.getByLabel('Record reference').fill('R08812-03')
  await form.getByLabel('Value 1 states').fill('Installed after June 15, 1995')
  await form.getByLabel('Value 1', { exact: true }).fill('Yes')
  await choose(form.getByRole('combobox', { name: 'Value 1 bears on' }), {
    value: 'crossing-1|bc.fppr-crossings|built-after-1995',
  })
  await form.getByLabel('Value 1 page').fill('4')
  await form.getByRole('button', { name: 'Keep this record' }).click()
  const record = records.getByTestId('records-received-received-1')
  await expect(record).toContainText('Road permit file, section 03')
  await expect(record).toContainText('Not used: it answers nothing yet.')
  await expect(built).toBeVisible()

  // Used as the answer: the gap goes, and its request is kept as no longer needed.
  await record.getByRole('button', { name: 'Use as the answer' }).click()
  await expect(record).toContainText('Used: Culvert at Spur 3:')
  await expect(built).toHaveCount(0)
  const stale = records.getByTestId('records-no-longer-needed')
  await expect(stale).toContainText('When the crossing was built or replaced · Block 1 · Culvert at Spur 3')
  await expect(stale).toContainText('No longer needed')
  // And as the crossing's evidence, marked received.
  await record.getByRole('button', { name: /Add to Culvert at Spur 3.s evidence/ }).click()
  await expect(page.getByTestId('crossing-evidence')).toContainText('1 record read')

  // The plan the permit relied on: the units over the block, the amendments the layer holds.
  await section(page, /^Forest stewardship plan (Not stated|FSP)/).click()
  const fsp = page.getByTestId('block-planning-fsp')
  await fsp.getByRole('button', { name: 'Read the units over this block' }).click()
  await expect(fsp.getByTestId('fsp-units')).toContainText('FSP 24 · FDU 1 · amendment 27')
  await expect(fsp.getByTestId('fsp-units')).toContainText('BC Timber Sales Prince George FSP #24')
  await fsp.getByRole('button', { name: 'Read the amendments of FSP 24' }).click()
  const history = fsp.getByTestId('fsp-history-24')
  await expect(history).toContainText('The layer holds nothing before amendment 25')
  await expect(history).toContainText('The layer skips amendment 26')
  await expect(fsp).not.toContainText('Not to be kept')
  await fsp.getByLabel('FSP id').fill('24')
  await fsp.getByLabel('FSP amendment').fill('26')
  await choose(fsp.getByRole('combobox', { name: 'How the plan was identified' }), { value: 'bcts-page' })
  await fsp.getByTestId('fsp-statement').getByRole('button', { name: 'Keep this' }).click()
  await expect(fsp.getByTestId('fsp-statement')).toContainText('FSP 24, amendment 26')

  await records.scrollIntoViewIfNeeded()
  await records.screenshot({ path: 'tmp/records/records-section.png' })

  // The letters are written from Save & export.
  await engineering.getByRole('button', { name: 'Draft request' }).click()
  await engineering.getByRole('button', { name: 'Save as text…' }).click()
  const dialog = page.getByTestId('block-planning-export')
  await expect(dialog.getByRole('heading', { name: 'Records to request (text)' })).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const text = await readFile((await (await download).path())!, 'utf8')
  expect(text).toContain('Drafts only: nothing has been sent')
  expect(text).toContain('Forest stewardship plan id: 24 (amendment 26')
  expect(text).not.toContain('Not to be kept')
  await page.keyboard.press('Escape')

  // Kept with the plan in this browser.
  await page.waitForTimeout(1_000)
  await page.reload()
  await page.getByRole('tab', { name: 'Review' }).click()
  await section(page, /^Records to get (\d|None)/).click()
  const reopened = page.getByTestId('block-planning-records')
  await expect(reopened.getByTestId('records-received-received-1')).toContainText('Used: Culvert at Spur 3:')
  await expect(reopened.getByTestId('records-no-longer-needed')).toContainText('Requested')
  await expect(section(page, /^Forest stewardship plan (Not stated|FSP)/)).toContainText(
    'FSP 24, amendment 26 as stated',
  )
})
