import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { choose } from './styled-select'

const button = (page: Page, name: string | RegExp) =>
  page.getByRole('button', { name, exact: typeof name === 'string' }).first()

async function openSample(page: Page) {
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await expect(page.getByTestId('block-planning-trend')).toBeVisible({ timeout: 30_000 })
}

test('the sample compares every schedule over time, in every interface', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  // Three schedules, one line each, in the chart's legend and the comparison table.
  const legend = page.getByTestId('block-planning-trend').getByRole('list', { name: 'Schedules' })
  for (const name of ['No further harvest', 'Proposed', 'Deferred 10 years']) await expect(legend).toContainText(name)
  await page.getByRole('tab', { name: 'Compare' }).click()
  const compare = page.getByTestId('block-planning-compare')
  await expect(compare).toContainText('Deferred 10 years')
  await expect(compare).toContainText('33.3%')
  // The Board's published 2015 and 2018 shares for the sample's unit sit beside the projection.
  await expect(page.getByTestId('block-planning-published')).toContainText('2018')
  await expect(legend).toContainText('Published 2015 and 2018')

  for (const id of ['ribbon', 'guided-map', 'dashboard']) {
    await page.goto(`/dev/forestry/block-planning?interface=${id}`)
    // The plan is kept in this browser and opens in each interface.
    await expect(page.getByTestId('block-planning-trend')).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(new RegExp(`interface=${id}`))
  }
  await expect(page.getByTestId('block-planning-table')).toContainText('Deferred 10 years · 2036')
})

test('a drawn block is timed per schedule and saved with the plan', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openSample(page)
  await page.getByRole('tab', { name: 'Blocks' }).click()
  await page.getByTestId('block-planning-steps').getByRole('button', { name: 'Draw', exact: true }).click()
  const canvas = page.getByTestId('block-planning-map').locator('.maplibregl-canvas')
  const box = (await canvas.boundingBox())!
  const corners = [
    [0.15, 0.15],
    [0.3, 0.15],
    [0.3, 0.3],
    [0.15, 0.3],
  ]
  for (const [x, y] of corners) await canvas.click({ position: { x: box.width * x, y: box.height * y } })
  await canvas.click({ position: { x: box.width * corners[0][0], y: box.height * corners[0][1] } })
  await expect(page.getByRole('list', { name: 'Blocks' })).toContainText('Block 2')

  // New blocks start in the schedule under review; the deferred schedule reads them ten years later.
  await page.getByRole('tab', { name: 'Schedules' }).click()
  const timing = page.getByTestId('block-planning-timing')
  await expect(timing.getByLabel('Year Proposed cuts Block 2')).toHaveValue('2026')
  await expect(timing.getByLabel('Year Deferred 10 years cuts Block 2')).toHaveAttribute('placeholder', '2036')
  await timing.getByLabel('Year Proposed cuts Block 2').fill('2031')
  await timing.getByLabel('Year Proposed cuts Block 2').press('Enter')
  await expect(timing.getByLabel('Year Deferred 10 years cuts Block 2')).toHaveAttribute('placeholder', '2041')

  await button(page, 'Save & export').click()
  const dialog = page.getByTestId('block-planning-export')
  await expect(dialog.locator('iframe')).toBeVisible()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const plan = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(plan.format).toBe('pgmaps-block-plan/v2')
  const block = plan.blocks.find((b: { name: string }) => b.name === 'Block 2')
  expect(plan.schedules.find((s: { id: string }) => s.id === 'proposed').entries[block.id]).toEqual({ year: 2031 })

  // The assessment record waits for the run and carries the index, marked as no legal test.
  await dialog.getByRole('button', { name: 'Assessment record' }).click()
  const record = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const saved = JSON.parse(await readFile((await (await record).path())!, 'utf8'))
  expect(saved.format).toBe('pgmaps-block-assessment/v1')
  expect(saved.planningIndex.notALegalTest).toBe(true)
  expect(saved.schedules).toHaveLength(3)
})

/** A square of `size` degrees, for the stubbed DataBC answers. */
const square = (west: number, south: number, size: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
})

test('the order’s unit and past disturbances are read from DataBC and checked against the Board', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const asked: string[] = []
  // DataBC is stubbed: the reads run in a worker, which the browser context's routes also serve.
  await page.context().route(/RMP_PLAN_LEGAL_POLY_SVW/, (route) => {
    asked.push('unit')
    return route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: square(-122.6, 53.9, 0.2),
            properties: {
              LEGAL_FEAT_ATRB_2_NAME: 'NDZ_NAME',
              LEGAL_FEAT_ATRB_3_NAME: 'ORG_CODE',
              LEGAL_FEAT_ATRB_5_VALUE: 'A5',
              LEGAL_FEAT_ATRB_6_NAME: 'NDZ_SUB',
            },
          },
        ],
      },
    })
  })
  await page.context().route(/MapServer\/543\/query/, (route) => {
    asked.push('cutblocks')
    return route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: square(-122.55, 53.95, 0.02),
            properties: { VCCB_SYSID: 1, OBJECTID: 1, HARVEST_START_YEAR_CALENDAR: 2005 },
          },
          {
            geometry: square(-122.5, 53.95, 0.03),
            properties: { VCCB_SYSID: 2, OBJECTID: 2, HARVEST_START_YEAR_CALENDAR: 2012 },
          },
        ],
      },
    })
  })
  await page.context().route(/PROT_HISTORICAL_FIRE_POLYS_SP/, (route) => {
    asked.push('fires')
    return route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          { id: 'f.1', geometry: square(-122.45, 54.0, 0.05), properties: { FIRE_NUMBER: 'G1', FIRE_YEAR: 2010 } },
        ],
      },
    })
  })
  await page.goto('/dev/forestry/block-planning?interface=guided')
  const steps = page.getByTestId('block-planning-steps')
  await choose(steps.getByRole('combobox', { name: 'Historic forest district' }), 'Prince George')
  await choose(steps.getByRole('combobox', { name: 'Natural disturbance sub-unit' }), 'Moist Interior - Mountain')
  await button(page, 'Read the order’s unit').click()
  await expect(page.getByTestId('block-planning-unit')).toContainText('Order units, Prince George')
  await expect(page.getByTestId('block-planning-order-unit')).toContainText('landscape units A5')
  await button(page, 'Read past disturbances').click()
  const read = page.getByTestId('block-planning-databc-read')
  await expect(read).toContainText('DataBC consolidated cutblocks: 2 kept of 2 read')
  await expect(read).toContainText('DataBC historical fire perimeters: 1 kept of 1 read')
  await expect(read).toContainText('years from 1995, 5 km past the unit')
  expect(asked).toEqual(expect.arrayContaining(['unit', 'cutblocks', 'fires']))

  await page.getByRole('tab', { name: 'Compare' }).click()
  await button(page, /^Published 2015 and 2018/).click()
  await button(page, 'Check the method against these figures').click()
  await button(page, 'Run the check').click()
  const check = page.getByTestId('block-planning-board-check')
  await expect(check.getByRole('table')).toContainText('>1,000 ha', { timeout: 60_000 })
  await expect(check).toContainText('2015')
  await expect(check).not.toContainText('was not read from DataBC')
})

test('old and old interior forest are read and calculated for an order unit, with the GIS’s A10 figure named', async ({
  page,
}) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const empty = { type: 'FeatureCollection', features: [] }
  // DataBC's WFS answers these reads by POST; the layer is in the body.
  await page.context().route(/openmaps\.gov\.bc\.ca\/geo\/pub\/wfs/, async (route) => {
    const body = route.request().postData() ?? ''
    if (body.includes('RMP_PLAN_LEGAL_POLY_SVW'))
      return route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            {
              geometry: square(-122.6, 53.9, 0.1),
              properties: {
                LEGAL_FEAT_ATRB_1_NAME: 'BECLABEL',
                LEGAL_FEAT_ATRB_1_VALUE: 'SBS wk 1',
                LEGAL_FEAT_ATRB_3_NAME: 'ORG_CODE',
                LEGAL_FEAT_ATRB_3_VALUE: 'DPG',
                LEGAL_FEAT_ATRB_5_NAME: 'UNIT_IDENT',
                LEGAL_FEAT_ATRB_5_VALUE: 'A10',
                LEGAL_FEAT_ATRB_7_NAME: 'OLD_RETEN',
                LEGAL_FEAT_ATRB_7_VALUE: 0.12,
              },
            },
          ],
        },
      })
    if (body.includes('VEG_COMP_LYR_R1_POLY'))
      return route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            {
              geometry: square(-122.6, 53.9, 0.06),
              properties: {
                FEATURE_ID: 1,
                PROJ_AGE_1: 200,
                PROJECTED_DATE: '2025-12-31Z',
                BCLCS_LEVEL_2: 'T',
                FOR_MGMT_LAND_BASE_IND: 'Y',
                SPECIES_CD_1: 'SX',
                BEC_ZONE_CODE: 'SBS',
                BEC_SUBZONE: 'wk',
                BEC_VARIANT: '1',
                SITE_INDEX: 18,
              },
            },
            {
              geometry: square(-122.54, 53.9, 0.04),
              properties: {
                FEATURE_ID: 2,
                PROJ_AGE_1: 30,
                PROJECTED_DATE: '2025-12-31Z',
                BCLCS_LEVEL_2: 'T',
                FOR_MGMT_LAND_BASE_IND: 'Y',
                SPECIES_CD_1: 'PLI',
                BEC_ZONE_CODE: 'SBS',
                BEC_SUBZONE: 'mk',
                BEC_VARIANT: '1',
                SITE_INDEX: 21,
              },
            },
          ],
        },
      })
    return route.fulfill({ json: empty })
  })
  await openSample(page)
  await page.getByRole('tab', { name: 'Compare' }).click()
  await button(page, /^Old and old interior forest/).click()
  const steps = page.getByTestId('block-planning-steps')
  await choose(steps.getByRole('combobox', { name: 'Old forest unit (Map 2)' }), 'A10')
  await expect(page.getByTestId('block-planning-old-unit')).toContainText('17% of the CFLB old')
  await button(page, 'Read and calculate').click()
  const result = page.getByTestId('block-planning-old-forest')
  await expect(result).toContainText('Year', { timeout: 90_000 })
  await expect(result).toContainText('records 12% for A10; the order’s table says 17%')
  await expect(result).toContainText('no shortfall over the projection')
  // 200 m of old forest beside the 30-year-old pine is not interior until the pine passes 60, in 2056.
  await expect(result.getByRole('row', { name: /^2051/ })).toContainText('2,539 / 162')
  await expect(result.getByRole('row', { name: /^2056/ })).toContainText('2,632 / 162')

  // D.3: old forest beside the CFLB by leading species, as figures, with the order's words above them.
  await result.getByRole('button', { name: /Representative stands \(D\.3\)/ }).click()
  const d3 = page.getByTestId('block-planning-old-d3')
  await expect(d3).toContainText('i.e. non-pine forest')
  await expect(page.getByTestId('block-planning-old-d3-split')).toContainText('of old forest')
  await expect(d3.getByRole('row', { name: /^Spruce/ })).toBeVisible()

  // The map draws the same calculation for the year on the map, and its legend names what it shows.
  await result.getByRole('checkbox', { name: 'Draw on the map' }).check()
  const legend = page.getByTestId('block-planning-old-forest-legend')
  await expect(legend).toContainText('Old interior', { timeout: 60_000 })
  await expect(legend).toContainText('Old, by an edge')
  // The interior drawn is the interior counted: the panel's 2,539 ha in 2026.
  await expect(legend).toContainText(/Old interior\s*2,539 ha/)
  await expect(legend).not.toContainText('differ')
})
