import { expect, test, type Page } from '@playwright/test'
import type { ErstatHospital } from '../../src/pages/dev-wait/data'
import type { SpecialistFacility, SpecialistMapData } from '../../src/pages/dev-wait/specialistData'

test.use({ serviceWorkers: 'block' })
// Real MapLibre rendering and camera transitions use SwiftShader in CI.
test.setTimeout(60_000)

function hospital(id: string, name: string, longitude: number): ErstatHospital {
  return {
    id,
    name,
    lng: longitude,
    lat: 56,
    has_er: true,
    province: 'MB',
    city: 'Test city',
    address: `${id} Test Street`,
    postal_code: null,
    phone: null,
    website: null,
    official_status: 'open',
    official_status_message: null,
    er_wait_minutes: 60,
    er_wait_lower_minutes: null,
    er_wait_upper_minutes: null,
    er_wait_avg_minutes: null,
    er_elos_minutes: null,
    predicted_wait_minutes: null,
    predicted_wait_lower: null,
    predicted_wait_upper: null,
    predicted_confidence: null,
    predicted_at: null,
    data_source: 'official',
    data_updated_at: '2026-10-30T12:00:00Z',
    official_updated_at: null,
    advisory_status: null,
    advisory_message: null,
    wait_status: null,
    wait_display: null,
    service_level: null,
  }
}

function specialist(id: string, name: string, longitude: number, weeks: number): SpecialistFacility {
  return {
    id,
    facility_name: name,
    source_facility_name: name,
    health_authority: 'Test Health',
    address: `${id} Test Street`,
    locality: 'Test town',
    province: 'BC',
    postal_code: null,
    longitude,
    latitude: 51.8,
    verification_status: 'verified',
    source_label: 'Fixture',
    source_url: null,
    notes: null,
    is_rollup_child: false,
    specialists: [
      {
        specialist_id: `doctor-${id}`,
        specialist_name: `Doctor ${id}`,
        row_count: 1,
        case_total_known: 12,
        procedure_count: 1,
        procedures: [
          {
            procedure_key: 'knee',
            procedure_name: 'Knee surgery',
            adult_flag: 'Y',
            cases_waiting_raw: '12',
            cases_waiting: 12,
            p50_weeks: 4,
            p90_weeks: weeks,
          },
        ],
      },
    ],
    procedures: [{ procedure_key: 'knee', name: 'Knee surgery', adult_flag: 'Y', row_count: 1, case_total_known: 12 }],
    wait_time_row_count: 1,
    case_total_known: 12,
    specialist_count: 1,
    procedure_count: 1,
  }
}

async function stubSources(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // No tile services: this style reaches actual MapLibre readiness offline.
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'offline-background', type: 'background', paint: { 'background-color': '#eef2f6' } }],
        glyphs: 'https://wait-map-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://wait-map-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  await page.route('**/data/erstat-hospitals.json', (route) =>
    route.fulfill({
      json: [hospital('alpha', 'Alpha emergency', -96.4), hospital('beta', 'Beta emergency', -95.6)],
    }),
  )
  const facilities = [specialist('alpha', 'Alpha surgery', -124.5, 30), specialist('beta', 'Beta surgery', -124.3, 8)]
  const data: SpecialistMapData = {
    metadata: {
      latest_run_id: 1,
      facility_count: 2,
      mapped_source_facility_count: 2,
      rollup_child_count: 0,
      specialist_count: 2,
      procedure_count: 1,
    },
    facilities,
  }
  await page.route('**/data/bc-wait-specialists.json', (route) => route.fulfill({ json: data }))
  return errors
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'wait maps on a phone' : 'wait maps on desktop', () => {
    test.use({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      hasTouch: mobile,
      isMobile: mobile,
    })
    test('ER count bubbles zoom into separate hospitals and refresh after zooming out', async ({ page }) => {
      const errors = await stubSources(page)
      await page.goto('/dev/health/wait')
      const cluster = page.getByRole('button', { name: 'Zoom to 2 hospitals', exact: true })
      await expect(cluster).toBeVisible()
      await expect(page.getByRole('button', { name: 'Alpha emergency: 1h', exact: true })).toHaveCount(0)

      await cluster.click()
      const alpha = page.getByRole('button', { name: 'Alpha emergency: 1h', exact: true })
      await expect(alpha).toBeVisible()
      await expect(page.getByRole('button', { name: 'Beta emergency: 1h', exact: true })).toBeVisible()
      await expect(cluster).toHaveCount(0)
      await alpha.click()
      await expect(page.locator('.mapcn-popup')).toContainText('Alpha emergency')
      await page.getByRole('button', { name: 'Close popup', exact: true }).click()

      // A real camera change must recalculate membership, rather than leave stale singletons.
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
      await expect(cluster).toBeVisible()
      await expect(alpha).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('specialist bubbles reveal selectable facilities and refresh on resize and filtering', async ({ page }) => {
      const errors = await stubSources(page)
      await page.goto('/dev/health/wait/specialist')
      const reveal = page.getByRole('button', { name: 'Reveal 2 facilities', exact: true })
      await expect(reveal).toBeVisible()
      const alpha = page.getByRole('button', { name: 'Alpha surgery: median P90 30.0w, 1 specialists', exact: true })
      const beta = page.getByRole('button', { name: 'Beta surgery: median P90 8.0w, 1 specialists', exact: true })
      await expect(alpha).toHaveCount(0)
      await reveal.click()
      await expect(page.getByRole('button', { name: 'Hide 2 facilities', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(alpha).toBeVisible()
      await expect(beta).toBeVisible()
      await beta.click()
      await expect(page.locator('.mapcn-popup')).toContainText('Beta surgery')
      await page.getByRole('button', { name: 'Close popup', exact: true }).click()

      // Cluster identity follows screen position. A changed canvas invalidates the old reveal.
      await page.setViewportSize({ width: mobile ? 414 : 1440, height: mobile ? 844 : 860 })
      await expect(reveal).toBeVisible()
      await expect(alpha).toHaveCount(0)
      if (mobile) await page.locator('[data-map-mobile-sheet-handle]').press('End')
      await page.getByRole('textbox', { name: 'Search facilities, specialists, or procedures' }).fill('Alpha surgery')
      if (mobile) await page.locator('[data-map-mobile-sheet-handle]').press('Home')
      await expect(alpha).toBeVisible()
      await expect(reveal).toHaveCount(0)
      await expect(beta).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
