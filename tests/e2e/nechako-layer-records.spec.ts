import { expect, test } from '@playwright/test'

// Synthetic API fixtures exercise the verified native contracts; they are not live observations.
for (const width of [1440, 390])
  test(`native attribute record handoff and explicit daily monitoring dates at ${width}px`, async ({ page }) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 900 })
    const writes: string[] = [],
      queries: Record<string, string>[] = [],
      errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      }),
    )
    await page.route('**/api/nechako-portal/**', async (route) => {
      const action = new URL(route.request().url()).pathname.split('/').pop()
      if (action === 'status')
        return route.fulfill({ json: { available: true, loggedIn: false, readOnly: true, canWrite: false } })
      if (action === 'write' || action === 'login') {
        writes.push(action)
        return route.fulfill({ status: 403, json: { error: 'Fixture is read only' } })
      }
      const body = route.request().postDataJSON()
      if (action === 'layer-attributes') {
        expect(body).toEqual({ submissionId: '1477', layerId: '386' })
        return route.fulfill({
          json: {
            success: true,
            status: 'success',
            attributes: {
              attributes: ['schema_rec_seq_id', 'monitor_status', 'label'],
              rows: [
                ['1', 'ENABLED', 'Fixture station'],
                ['2', 'DISABLED', 'Disabled fixture'],
              ],
              type: ['integer', 'text', 'text'],
            },
            loggedIn: false,
          },
        })
      }
      const path = String(body?.path ?? '')
      const attributes = path.endsWith('getSubmissionLayers.php')
        ? [{ layer_id: 386, layer_name: 'Fixture spatial layer', schema_id: 13, has_style: false }]
        : path.endsWith('getSubmissionForm.php')
          ? 39
          : path.endsWith('getMonitorData.php')
            ? {
                fields: ['date', 'min_temp_c', 'location'],
                data: [
                  { date: '15/05/1951', min_temp_c: '-8.50', location: 'Fixture station' },
                  { date: '16/05/1951', min_temp_c: '-4.25', location: 'Fixture station' },
                ],
                recordCount: 2,
                noData: false,
              }
            : []
      if (path.endsWith('getMonitorData.php')) queries.push(body.params)
      return route.fulfill({ json: { success: true, status: 'success', attributes, loggedIn: false } })
    })
    await page.route('https://nechakowatershed-portal.ca/rest/**', (route) =>
      route.fulfill({ json: { success: true, status: 'success', attributes: [], loggedIn: false } }),
    )
    await page.goto('/dev/nechako/portal')
    await page.getByRole('button', { name: 'Login / Sign-up', exact: true }).click()
    await page.getByRole('button', { name: 'Check gateway', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Local gateway', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Local gateway', exact: true }).click()
    await page.getByRole('button', { name: 'Close portal window', exact: true }).click()
    await page.getByRole('button', { name: 'All options', exact: true }).click()
    await page.getByRole('button', { name: 'Open portal submissions and related resources', exact: true }).click()
    await page.getByLabel('Portal submission ID', { exact: true }).fill('1477')
    await page.getByRole('button', { name: 'Open submission resources', exact: true }).click()
    await page.getByText('Spatial layers', { exact: true }).click()
    await page.getByRole('button', { name: 'Load spatial layers', exact: true }).click()
    await page.getByLabel('Submission attribute layer').selectOption('386')
    await page.getByRole('button', { name: 'Read source layer attributes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Monitor record 1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Monitor record 2', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Monitor record 1', exact: true }).click()
    await expect(page.getByLabel('Monitoring source mode')).toHaveValue('layer')
    await expect(page.getByLabel('Monitoring layer or schema ID')).toHaveValue('386')
    await expect(page.getByLabel('Monitoring record sequence ID')).toHaveValue('1')
    await expect(page.getByRole('button', { name: 'Read schema fields', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Load observations', exact: true }).click()
    await expect(page.getByText('Rows 1–2 of 2 · page 1 of 1', { exact: true })).toBeVisible()
    expect(queries).toEqual([{ layerId: '386', recId: '1', pageSize: '500', pageNumber: '0' }])
    await page.getByRole('button', { name: 'Chart and report this page', exact: true }).click()
    await page.getByLabel('timestamp column', { exact: true }).selectOption('date')
    await page.getByLabel('Primary measurement', { exact: true }).selectOption('min_temp_c')
    await page.getByLabel('Monitoring date format').selectOption('dmy')
    await page.getByLabel('Timestamp time zone', { exact: true }).fill('UTC')
    await expect(
      page.getByText('2 valid observations · 0 rejected rows · 0 duplicate station/timestamps', { exact: true }),
    ).toBeVisible()
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
