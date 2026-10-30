import { expect, test, type Page } from '@playwright/test'
import type { SpecialistFacility, SpecialistMapData } from '../../src/pages/dev-wait/specialistData'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90_000)

function facility(index: number): SpecialistFacility {
  const name = `Surgery Facility ${String(index).padStart(3, '0')}`
  const procedures = [
    {
      procedure_key: 'adult-knee',
      procedure_name: 'Knee surgery',
      adult_flag: 'Y',
      cases_waiting_raw: String(index + 1),
      cases_waiting: index + 1,
      p50_weeks: 4,
      p90_weeks: 30,
    },
    {
      procedure_key: 'child-knee',
      procedure_name: 'Pediatric knee surgery',
      adult_flag: 'N',
      cases_waiting_raw: '3',
      cases_waiting: 3,
      p50_weeks: 2,
      p90_weeks: 8,
    },
  ]
  return {
    id: `facility-${index}`,
    facility_name: name,
    source_facility_name: name,
    health_authority: 'Fixture Health',
    address: `${index} Test Street`,
    locality: 'Fixture town',
    province: 'BC',
    postal_code: null,
    longitude: -124.4,
    latitude: 51.8,
    verification_status: 'verified',
    source_label: 'Browser fixture',
    source_url: `https://example.test/location/${index}`,
    notes: null,
    is_rollup_child: false,
    specialists: [
      {
        specialist_id: `doctor-${index}`,
        specialist_name: `Doctor ${index}`,
        row_count: 2,
        case_total_known: index + 4,
        procedure_count: 2,
        procedures,
      },
    ],
    procedures: procedures.map((procedure) => ({
      procedure_key: procedure.procedure_key,
      name: procedure.procedure_name,
      adult_flag: procedure.adult_flag,
      row_count: 1,
      case_total_known: procedure.cases_waiting,
    })),
    wait_time_row_count: 2,
    case_total_known: index + 4,
    specialist_count: 1,
    procedure_count: 2,
  }
}

async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'offline-background', type: 'background', paint: { 'background-color': '#eef2f6' } }],
        glyphs: 'https://specialist-results.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://specialist-results.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  const facilities = Array.from({ length: 115 }, (_, index) => facility(index))
  const data: SpecialistMapData = {
    metadata: {
      latest_run_id: 1,
      facility_count: 115,
      mapped_source_facility_count: 115,
      rollup_child_count: 0,
      specialist_count: 115,
      procedure_count: 2,
    },
    facilities,
  }
  await page.route('**/data/bc-wait-specialists.json', (route) => route.fulfill({ json: data }))
  return errors
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: specialist sidebar reaches matches after 80 and preserves metrics, selection, filters and sorting`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 })
    const errors = await prepare(page)
    await page.goto('/dev/health/wait/specialist')
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    if (mobile) await handle.press('End')
    const list = page.getByRole('list', { name: 'Specialist facilities', exact: true })
    const scroll = page.locator('[data-map-sidebar-scroll="true"]').filter({ has: list })
    await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '115')
    const last = list.getByRole('button', { name: /^Surgery Facility 114/ })
    await expect(last).toHaveCount(0)
    await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
    await expect(last).toBeVisible()
    await expect(last).toContainText('Fixture town • Fixture Health')
    await expect(last).toContainText('P50 3.0w')
    await expect(last).toContainText('P90 19.0w')
    await expect(last).toContainText('Cases 118')
    await last.click()
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    if (mobile) await handle.press('Home')
    const popup = page.locator('.mapcn-popup')
    await expect(popup).toContainText('Surgery Facility 114')
    await expect(popup).toContainText('114 Test Street, Fixture town')
    await expect(popup).toContainText('Doctor 114')
    await expect(popup.getByRole('link', { name: 'Location source', exact: true })).toHaveAttribute(
      'href',
      'https://example.test/location/114',
    )
    if (mobile) await handle.press('End')
    const search = page.getByRole('textbox', { name: 'Search facilities, specialists, or procedures', exact: true })
    await search.fill('Surgery Facility 114')
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Adult', exact: true }).click()
    await expect(last).toContainText('P50 4.0w')
    await expect(last).toContainText('P90 30.0w')
    await expect(last).toContainText('Cases 115')
    await page.getByRole('button', { name: 'Pediatric', exact: true }).click()
    await expect(last).toContainText('P50 2.0w')
    await expect(last).toContainText('P90 8.0w')
    await expect(last).toContainText('Cases 3')
    await page.getByRole('combobox', { name: 'Procedure', exact: true }).click()
    await page.getByRole('option', { name: 'Knee surgery (115)', exact: true }).click()
    await expect(list.getByRole('listitem')).toHaveCount(0)
    await expect(page.getByText('No facilities match the current filters.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(last).toContainText('P90 19.0w')
    await expect(last).toContainText('Cases 118')
    await page.getByRole('combobox', { name: 'Sort facilities', exact: true }).click()
    await page.getByRole('option', { name: 'Most known cases', exact: true }).click()
    await search.fill('')
    await scroll.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }))
    await expect(list.getByRole('listitem').first()).toContainText('Surgery Facility 114')
    await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '115')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}
