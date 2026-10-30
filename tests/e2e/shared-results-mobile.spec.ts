import { expect, test, type Page } from '@playwright/test'
import type { CviData } from '../../src/pages/climate-vulnerability/data'
import type { Family, Manifest } from '../../src/pages/early-learning/data'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90_000)

function polygon(index: number, properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Polygon> {
  const x = -124.7 + (index % 15) * 0.05
  const y = 53 + Math.floor(index / 15) * 0.05
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + 0.04, y],
          [x + 0.04, y + 0.04],
          [x, y + 0.04],
          [x, y],
        ],
      ],
    },
  }
}

async function prepareMap(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'offline-background', type: 'background', paint: { 'background-color': '#eef2f6' } }],
        glyphs: 'https://shared-results-test.invalid/{fontstack}/{range}.pbf',
      },
    }),
  )
  await page.route('https://shared-results-test.invalid/**', (route) => route.fulfill({ body: Buffer.alloc(0) }))
  return errors
}

async function expandPanel(page: Page, mobile: boolean) {
  if (mobile) {
    const handle = page.locator('[data-map-mobile-sheet-handle]')
    await expect(handle).toBeVisible()
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '2')
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

for (const mobile of [false, true]) {
  const device = mobile ? 'mobile' : 'desktop'
  test(`${device}: climate shared lists retain unmapped and null values and exact quantile labels`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 })
    const errors = await prepareMap(page)
    const field = 'pm25_fsa_avg10yr_2020'
    const values = [0, 0, 0, 0, 1, 1, 1, 1, 10, 10]
    const rows = values.map((value, index) => ({
      fsa: `V${index}A`,
      name: `Area ${index}`,
      mapped: true,
      values: { [field]: value, missing_measure: null },
    }))
    rows.push({
      fsa: 'V7X',
      name: 'Non-geometric source area',
      mapped: false,
      values: { [field]: 80, missing_measure: null },
    })
    const variable = (name: string, field: string, catalogueId: number) => ({
      catalogueId,
      field,
      label: name,
      source: 'Synthetic source',
      period: '2020',
      originalGeography: 'FSA',
      catalogueComponent: 'Exposure',
      reportComponent: 'Exposure',
      selection: 'selected',
      projected: false,
      available: true,
      notes: 'Source values retained.',
      localStatus: 'Fixture verified',
      r2Status: 'Fixture only',
      candidateDatasets: [],
      nextAction: 'No external source needed for this test.',
    })
    const data = {
      schemaVersion: 1,
      checkedOn: '2026-10-30',
      sourceUrl: 'https://example.test/source',
      sourceSha256: 'fixture',
      reportUrl: 'https://example.test/report',
      variables: [variable('PM2.5 fixture', field, 1), variable('Unavailable fixture', 'missing_measure', 2)],
      rows,
      summary: {
        mappedRows: 10,
        unmappedFsas: ['V7X'],
        selectedClear: 2,
        selectedAmbiguous: 0,
        notSelected: 0,
        missingSelected: [],
      },
      diagnostics: {
        observedExposure: {
          firstTwoVariancePercent: 80,
          reportedFirstTwoVariancePercent: 80,
          variancePercent: [50, 30],
        },
        projectedExposure: {
          firstTwoVariancePercent: 80,
          reportedFirstTwoVariancePercent: 80,
          variancePercent: [50, 30],
        },
        interpretation: 'Synthetic diagnostics retained.',
      },
      cautions: ['Synthetic browser fixture.'],
    } as unknown as CviData
    await page.route('**/data/climate-vulnerability/inputs.json', (route) => route.fulfill({ json: data }))
    await page.route('**/data/boundaries/StatCan/bc_fsa_2021.geojson.gz', (route) =>
      route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: rows
            .filter((row) => row.mapped)
            .map((row, index) => polygon(index, { boundaryCode: row.fsa, boundaryName: row.name })),
        },
      }),
    )
    await page.goto('/dev/climate-vulnerability')
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
    const legend = page
      .locator('div.pointer-events-none.absolute')
      .filter({ hasText: 'Input magnitude · not a CVI score' })
    for (const label of ['< 0.6', '0.6 – < 1', '1 – < 2.8', '≥ 2.8'])
      await expect(legend.getByText(label, { exact: true })).toBeVisible()
    await expandPanel(page, mobile)
    await page.getByRole('textbox', { name: 'Find an FSA', exact: true }).fill('V7X')
    const list = page.getByRole('list', { name: 'Climate vulnerability FSAs', exact: true })
    await expect(list.getByRole('listitem')).toHaveCount(1)
    const sourceRow = list.getByRole('button', { name: /V7X Non-geometric source area/ })
    await expect(sourceRow).toContainText('No polygon')
    await expect(sourceRow).toContainText('80')
    await sourceRow.click()
    await expect(page).toHaveURL(/fsa=V7X/)
    await expect(page.getByRole('heading', { name: 'V7X · Non-geometric source area', exact: true })).toBeVisible()
    await expect(page.getByText('No matching polygon in the 2021 boundary release.', { exact: false })).toBeVisible()
    // Filtering one source row does not recalculate the scale over that row.
    for (const label of ['< 0.6', '0.6 – < 1', '1 – < 2.8', '≥ 2.8'])
      await expect(legend.getByText(label, { exact: true })).toHaveCount(1)
    await page.getByRole('combobox', { name: 'Mapped variable', exact: true }).selectOption('missing_measure')
    await expect(sourceRow).toContainText('Unavailable')
    await expect(legend.getByText('Unavailable', { exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: 'Reproducibility', exact: true }).click()
    await expect(page.getByText('Synthetic diagnostics retained.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Map inputs', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Mapped variable', exact: true })).toHaveValue('missing_measure')
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test(`${device}: EDI shared controls preserve suppression, immutable release and source-switch loading`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 })
    const errors = await prepareMap(page)
    const releaseId = 'c'.repeat(64)
    const measure = 'pct_overall_vulnerable'
    const dataset = (id: string, label: string) => ({
      id,
      label,
      source: 'https://example.test/source',
      waves: [8, 9],
      measures: [{ id: measure, label: 'Overall vulnerable', unit: 'percent' as const }],
      families: { GEOSD: { path: `${id}.json`, sha256: 'fixture' } },
      notes: 'Synthetic browser source.',
      mapJoin: { policy: 'captured_wave' as const, boundaryRelease: 'fixture-map' },
    })
    const boundary = {
      id: 'fixture-map-school-districts',
      family: 'GEOSD',
      path: 'geometry.json',
      sha256: 'geometry-fixture',
      label: 'Publisher fixture polygons',
      edition: '2026',
      retrievedAt: '2026-10-30',
      source: 'https://example.test/boundary',
      features: 105,
      joinPolicy: 'edi_wave' as const,
      reportedWaves: [8, 9],
    }
    const manifest: Manifest = {
      releaseId,
      families: { GEOSD: 'School districts' },
      datasets: [dataset('source-a', 'Source A'), dataset('source-b', 'Source B')],
      boundaries: [boundary],
      gaps: ['Synthetic data only.'],
    }
    const family = (source: 'a' | 'b'): Family => ({
      regions: Array.from({ length: 105 }, (_, index) => ({
        id: `GEOSD_${index}`,
        name: `District ${index}`,
        observations: [
          { wave: 8, measure, value: 20, status: 'published' },
          {
            wave: 9,
            measure,
            value: source === 'b' && index === 104 ? null : 37.5,
            status: source === 'b' && index === 104 ? 'suppressed' : 'published',
          },
        ],
      })),
    })
    let finishSourceA: () => void = () => undefined
    const pendingSourceA = new Promise<void>((resolve) => {
      finishSourceA = resolve
    })
    await page.route(`**/__dev_early_learning/releases/${releaseId}.json`, (route) => route.fulfill({ json: manifest }))
    await page.route('**/__dev_early_learning/geometry.json', (route) =>
      route.fulfill({
        json: {
          type: 'FeatureCollection',
          features: family('b').regions.map((region, index) =>
            polygon(index, { regionId: region.id, regionName: region.name }),
          ),
        },
      }),
    )
    await page.route('**/__dev_early_learning/source-b.json', (route) => route.fulfill({ json: family('b') }))
    await page.route('**/__dev_early_learning/source-a.json', async (route) => {
      await pendingSourceA
      await route.fulfill({ json: family('a') })
    })
    await page.goto(`/dev/early-learning?release=${releaseId}`)
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
    await expandPanel(page, mobile)
    await expect(page.getByRole('combobox', { name: 'EDI source release', exact: true })).toHaveValue('source-b')
    const list = page.getByRole('list', { name: 'Early development areas', exact: true })
    const scroll = page.locator('[data-map-sidebar-scroll="true"]').filter({ has: list })
    await expect(list.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '105')
    const last = list.getByRole('button', { name: /^District 104 / })
    await expect(last).toHaveCount(0)
    await scroll.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
    await expect(last).toBeVisible()
    await expect(last).toContainText('Not reported / suppressed')
    await last.click()
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('combobox', { name: 'EDI wave', exact: true }).selectOption('8')
    await page.getByRole('textbox', { name: 'Find an area', exact: true }).fill('GEOSD_104')
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(last).toContainText('20.0%')
    await page.getByRole('combobox', { name: 'EDI wave', exact: true }).selectOption('9')
    await expect(last).toContainText('Not reported / suppressed')
    await page.getByRole('combobox', { name: 'EDI source release', exact: true }).selectOption('source-a')
    await expect(last).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible()
    finishSourceA()
    await expect(last).toContainText('37.5%')
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('link', { name: 'Permanent link to this local snapshot', exact: true }),
    ).toHaveAttribute('href', `?release=${releaseId}`)
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })
}
