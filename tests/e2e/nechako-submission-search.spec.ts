import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

const source = 'https://nechakowatershed-portal.ca/'
const records = Array.from({ length: 26 }, (_, index) => ({
  id: String(index + 1),
  title: `Public fixture ${index + 1}`,
  name: `Site ${index + 1}`,
  formId: index < 25 ? '3' : '8',
  formName: index < 25 ? 'Project' : 'Literature',
  date: '2026-10-12',
  submittedBy: 'Public contributor',
  parentId: index === 25 ? 1 : -1,
  sourceUrl: source,
  fields: [
    {
      id: '34',
      label: 'Project description',
      type: 'htmleditor',
      value:
        index === 0
          ? '<p>Fieldonlyquartz habitat survey.</p><a href="http://example.test/report?a=1&amp;b=2">Citation</a>'
          : '<p>River survey.</p>',
    },
    { id: '35', label: 'Reviewed', type: 'checkbox', value: false },
    { id: '36', label: 'Observation count', type: 'integer', value: 0 },
  ],
  attachments: [],
  layers: [],
  media:
    index === 0
      ? [{ fieldId: '34', ordinal: 1, mime: 'image/png', kind: 'embedded', sourceUrl: source, sha256: 'a'.repeat(64) }]
      : [],
  searchText: '',
}))
const forms = {
  schema: 'nechako-public-form-definitions-v1',
  source,
  capturedAt: '2026-10-12T23:10:00Z',
  forms: ['3', '8'].map((id) => ({
    id,
    name: id === '3' ? 'Project' : 'Literature',
    pages: [{ id: 1 }],
    nodes: [
      ...[
        { fieldId: '36', label: 'Observation count', type: 'integer' },
        { fieldId: '34', label: 'Project description', type: 'htmleditor' },
        { fieldId: '35', label: 'Reviewed', type: 'checkbox' },
      ].map((field, index) => ({
        ...field,
        dynamic: true,
        page: 1,
        nodeRank: 0,
        fieldRank: index + 1,
        nodeType: '2',
        semanticType: 'dynamic',
        nodeName: 'dynamicNode.form',
      })),
      {
        fieldId: '37',
        label: 'Attachment section',
        type: '',
        dynamic: false,
        page: 1,
        nodeRank: 1,
        fieldRank: 0,
        nodeType: '5',
        semanticType: 'attachments',
        nodeName: 'attachmentsNode.form',
      },
    ],
  })),
}
const formsGzip = gzipSync(Buffer.from(JSON.stringify(forms)))
const raw = Buffer.from(
  JSON.stringify({ schema: 'nechako-public-content-v1', source, capturedAt: '2026-10-12T23:00:00Z', records }),
)
const gzip = gzipSync(raw)
const manifest = {
  schema: 'nechako-public-content-manifest-v1',
  source,
  capturedAt: '2026-10-12T23:00:00Z',
  scope: 'Anonymous fixture',
  recordCount: records.length,
  fieldCount: records.length * 3,
  mediaCount: 1,
  attachmentCount: 0,
  layerCount: 0,
  files: {
    'submissions.json.gz': {
      bytes: gzip.length,
      uncompressedBytes: raw.length,
      sha256: createHash('sha256').update(gzip).digest('hex'),
      uncompressedSha256: createHash('sha256').update(raw).digest('hex'),
    },
  },
  limitations: ['Embedded media remains at the source.'],
  omissions: {},
}

test('source spatial IDs restrict local content and failures do not silently broaden results', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  const { errors } = await mockSnapshot(page)
  let deny = false
  const areas: unknown[] = []
  await page.route('**/api/nechako-portal/read', (route) => {
    const body = route.request().postDataJSON()
    expect(body.path).toBe('rest/portal/getSearchResults.php')
    expect(JSON.parse(body.params.fields)).toEqual(['Submission ID'])
    areas.push(JSON.parse(body.params.area))
    return route.fulfill({
      json: deny
        ? { status: 'failure', loggedIn: false, error: 'Fixture spatial access unavailable' }
        : {
            status: 'success',
            loggedIn: false,
            attributes: { results: [{ submission_id: 2 }, { submission_id: 9999 }] },
          },
    })
  })
  await page.goto('/dev/nechako/portal?panel=search')
  await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
  await page.getByLabel('Submission selection type', { exact: true }).selectOption('area')
  await page.getByLabel('Submission selection layer', { exact: true }).selectOption('nechako-watershed-boundary')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Public fixture 2', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toHaveCount(0)
  expect(areas).toHaveLength(1)
  const area = areas[0] as { geojson: string }
  expect(JSON.parse(area.geojson).features[0].properties.namedWatershedId).toBe(8886)
  deny = true
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Fixture spatial access unavailable')
  await expect(page.getByRole('button', { name: 'Public fixture 2', exact: true })).toHaveCount(0)
  await page.getByLabel('Submission selection type', { exact: true }).selectOption('normal')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('snapshot mismatch is visible and retry loads a consistent capture', async ({ page }) => {
  const { errors } = await mockSnapshot(page)
  let invalid = true
  await page.route('**/data/nechako-portal/manifest.json', (route) =>
    route.fulfill({ json: invalid ? { ...manifest, recordCount: 27 } : manifest }),
  )
  await page.goto('/dev/nechako/portal?panel=search')
  await expect(page.getByRole('alert')).toContainText('counts do not match')
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled()
  invalid = false
  await page.getByRole('button', { name: 'Retry submission snapshot', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('late initial account status preserves a public search already entered', async ({ page }) => {
  const { errors } = await mockSnapshot(page)
  let releaseStatus!: () => void
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve
  })
  await page.route('**/api/nechako-portal/status', async (route) => {
    await statusGate
    return route.fulfill({ json: { available: false, loggedIn: false, readOnly: true } })
  })
  await page.goto('/dev/nechako/portal?panel=search')
  const search = page.getByLabel('Submission search expression', { exact: true })
  await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
  await search.fill('Fieldonlyquartz')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const response = page.waitForResponse('**/api/nechako-portal/status')
  releaseStatus()
  await response
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  await expect(search).toHaveValue('Fieldonlyquartz')
  await expect(page.getByRole('button', { name: 'Public fixture 2', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

async function mockSnapshot(page: Page) {
  const errors: string[] = []
  const sourceRequests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    sourceRequests.push(url.href)
    return route.abort('internetdisconnected')
  })
  await page.route('**/data/nechako-portal/manifest.json', (route) => route.fulfill({ json: manifest }))
  await page.route('**/data/nechako-portal/forms.json.gz', (route) =>
    route.fulfill({ contentType: 'application/gzip', body: formsGzip }),
  )
  await page.route('**/data/nechako-portal/submissions.json.gz', (route) =>
    route.fulfill({ contentType: 'application/gzip', body: gzip }),
  )
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({ json: { available: false, loggedIn: false, readOnly: true } }),
  )
  return { errors, sourceRequests }
}

for (const width of [1440, 390]) {
  test(`compact submission search indexes fields, preserves values and exports filtered results at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    const { errors, sourceRequests } = await mockSnapshot(page)
    await page.goto('/dev/nechako/portal?panel=search')
    const search = page.getByLabel('Submission search expression', { exact: true })
    await expect(page.getByRole('heading', { name: 'Find Submissions : SEARCH', exact: true })).toBeVisible()
    const searchDialog = page.getByRole('dialog', { name: 'Find Submissions : SEARCH', exact: true })
    const size = await searchDialog.boundingBox()
    expect(size?.width).toBeLessThanOrEqual(width === 390 ? 390 : 802)
    expect(size?.height).toBeLessThanOrEqual(width === 390 ? 830 : 552)
    await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Watershed search type' })).toHaveCount(0)
    await search.fill('Fieldonlyquartz')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Public fixture 2', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
    const details = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Public fixture 1', exact: true }) })
    await expect(details).toContainText('Submission ID 1')
    await expect(details.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true')
    for (const name of [
      'General',
      'Allowed Users',
      'Spatial Data',
      'Attachments',
      'Child Submissions',
      'History',
      'Export',
    ])
      await expect(details.getByRole('tab', { name, exact: true })).toBeVisible()
    await expect(details).toContainText('Fieldonlyquartz habitat survey.')
    await expect(details.getByText('Loading the captured form layout…')).toHaveCount(0)
    const fieldLabels = await details.locator('[data-source-form-section] h3').allTextContents()
    expect(fieldLabels).toEqual(['Observation count', 'Project description', 'Reviewed'])
    await expect(details.getByText('false', { exact: true })).toBeVisible()
    await expect(details.getByText('0', { exact: true })).toBeVisible()
    await expect(details.locator('img[src^="data:"]')).toHaveCount(0)
    await expect(details.locator(`a[href="${source}"]`).first()).toBeVisible()
    await expect(details.locator('a[href="http://example.test/report?a=1&b=2"]')).toBeVisible()
    await details.getByRole('button', { name: 'Close', exact: true }).last().press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await search.fill('{Submission ID} >= 25')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Public fixture 25', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Public fixture 26', exact: true })).toBeVisible()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export to CSV', exact: true }).click()
    const csv = readFileSync((await (await download).path())!, 'utf8')
    expect(csv).toContain('Public fixture 25')
    expect(csv).toContain('Public fixture 26')
    expect(csv).not.toContain('Public fixture 24')
    await search.fill('')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('button', { name: 'Next submissions', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Public fixture 26', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Simple Expression Builder', exact: true }).click()
    await page.getByLabel('Simple expression words', { exact: true }).fill('Fieldonlyquartz absentword')
    await page.getByLabel('Simple expression match', { exact: true }).selectOption('OR')
    await page.getByRole('button', { name: 'Use simple expression', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Public fixture 2', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Expression Builder', exact: true }).click()
    await page.getByLabel('Expression term', { exact: true }).fill('Fieldonlyquartz')
    await page.getByRole('button', { name: 'Use built expression', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Public fixture 1', exact: true })).toBeVisible()
    await search.fill('salmon AND')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(sourceRequests).toEqual([])
    expect(errors).toEqual([])
  })
}

test('submission tabs keep public resources, child navigation and exports separate', async ({ page }) => {
  const { errors, sourceRequests } = await mockSnapshot(page)
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  let details = page.locator('[data-nechako-submission-dialog]')
  await details.getByRole('tab', { name: 'General', exact: true }).click()
  await expect(details).toContainText('Site 1')
  await details.getByRole('tab', { name: 'Spatial Data', exact: true }).click()
  await expect(details).toContainText('Owned layers (0)')
  await expect(details).toContainText('Linked layers (0)')
  await details.getByRole('tab', { name: 'Attachments', exact: true }).click()
  await expect(details).toContainText('Attachments (0)')
  await details.getByRole('tab', { name: 'Export', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await details.getByRole('button', { name: 'Export submission JSON', exact: true }).click()
  const content = JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8'))
  expect(content.record.id).toBe('1')
  expect(content.form.id).toBe('3')
  expect(content).not.toHaveProperty('permissions')
  expect(content).not.toHaveProperty('history')
  await details.getByRole('tab', { name: 'Child Submissions', exact: true }).click()
  await details.getByRole('button', { name: 'Public fixture 26 · ID 26', exact: true }).click()
  details = page.locator('[data-nechako-submission-dialog]')
  await expect(details).toContainText('Submission ID 26 · Literature')
  await expect(details.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true')
  await details.getByRole('tab', { name: 'General', exact: true }).click()
  await details.getByRole('button', { name: 'Open parent submission 1', exact: true }).click()
  await expect(details).toContainText('Submission ID 1 · Project')
  expect(sourceRequests).toEqual([`${source}rest/portal/getChildren.php`])
  expect(errors).toEqual([])
})

test('unavailable source definitions show a clear fallback and retry the original layout', async ({ page }) => {
  const { errors } = await mockSnapshot(page)
  let deny = true
  await page.route('**/data/nechako-portal/forms.json.gz', (route) =>
    deny
      ? route.fulfill({ status: 404, body: 'Form definitions unavailable' })
      : route.fulfill({ contentType: 'application/gzip', body: formsGzip }),
  )
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const details = page.locator('[data-nechako-submission-dialog]')
  await expect(
    details.getByText('Original form layout unavailable; captured fields are shown below', { exact: true }),
  ).toBeVisible()
  await expect(details).toContainText('Fieldonlyquartz habitat survey.')
  deny = false
  await details.getByRole('button', { name: 'Retry form layout', exact: true }).click()
  await expect(
    details.getByText('Original form layout unavailable; captured fields are shown below', { exact: true }),
  ).toHaveCount(0)
  await expect(details.locator('[data-source-form-section] h3')).toHaveText([
    'Observation count',
    'Project description',
    'Reviewed',
  ])
  expect(errors).toEqual([])
})

test('live permissions and history use native reads, report errors and discard session data', async ({ page }) => {
  const { errors } = await mockSnapshot(page)
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({ json: { available: true, loggedIn: true, readOnly: true } }),
  )
  let denyHistory = true
  const reads: { path: string; params: Record<string, string> }[] = []
  await page.route('**/api/nechako-portal/read', async (route) => {
    const body = route.request().postDataJSON()
    reads.push(body)
    if (body.path.endsWith('getHistory.php')) {
      expect(body.params).toEqual({ sub_id: '1' })
      if (denyHistory) return route.fulfill({ status: 403, json: { error: 'Fixture history denied' } })
      return route.fulfill({
        json: {
          status: 'success',
          loggedIn: true,
          attributes: [
            {
              history_timestamp: '2026-10-12 12:30:00',
              uname: 'Fixture actor',
              changed_field_name: 'Fixture field',
              changed_field_old_value: false,
              changed_field_new_value: 0,
              reason: 'Fixture reason',
            },
          ],
        },
      })
    }
    expect(body.path).toBe('rest/portal/getSubmissionPermissions.php')
    expect(body.params).toEqual({ submissionId: '1' })
    return route.fulfill({
      json: {
        status: 'success',
        loggedIn: true,
        attributes: [
          {
            text: 'Fixture group',
            gid: 2,
            checked: false,
            editEnabled: true,
            editChecked: false,
            attributes: [
              { uid: 7, text: 'Fixture allowed user*', checked: true, editEnabled: true, editChecked: false },
              { uid: 8, text: 'Fixture unselected', checked: false },
              { uid: 9, text: 'Fixture unknown', checked: 'true' },
            ],
          },
        ],
      },
    })
  })
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const details = page.locator('[data-nechako-submission-dialog]')
  expect(reads).toEqual([])
  await details.getByRole('tab', { name: 'Allowed Users', exact: true }).click()
  await expect(details.getByText('Fixture allowed user*', { exact: true })).toBeVisible()
  await expect(details.getByText('Fixture unselected', { exact: true })).toHaveCount(0)
  await expect(details.getByText('Fixture unknown', { exact: true })).toHaveCount(0)
  await details.getByLabel('Show all returned users and access details').check()
  await expect(details.getByText('Fixture unknown', { exact: true })).toBeVisible()
  await details.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(details.getByRole('alert')).toContainText('Fixture history denied')
  denyHistory = false
  await details.getByRole('button', { name: 'Refresh history', exact: true }).click()
  await expect(details.getByText('Fixture actor', { exact: true })).toBeVisible()
  await expect(
    details.locator('[data-nechako-live-resource=history]').getByText('false', { exact: true }),
  ).toBeVisible()
  await expect(details.locator('[data-nechako-live-resource=history]').getByText('0', { exact: true })).toBeVisible()
  let releaseLogout!: () => void
  const logoutGate = new Promise<void>((resolve) => {
    releaseLogout = resolve
  })
  await page.route('**/api/nechako-portal/disconnect', async (route) => {
    await logoutGate
    return route.fulfill({ json: { available: true, loggedIn: false, readOnly: true } })
  })
  await details
    .locator('[data-nechako-live-resource=history]')
    .getByRole('button', { name: 'Connection settings', exact: true })
    .click()
  const connection = page.getByRole('dialog', { name: 'Original portal connection', exact: true })
  await connection.getByRole('button', { name: 'Disconnect local session', exact: true }).click()
  await expect(details).toContainText('Connection changed. Refresh')
  await expect(details.getByText('Fixture actor', { exact: true })).toHaveCount(0)
  await expect(details).toContainText('Submission ID 1')
  releaseLogout()
  await connection.getByRole('button', { name: 'Close', exact: true }).click()
  await details.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(details).toContainText('Fieldonlyquartz habitat survey.')
  expect(errors).toEqual([])
})

test('a late protected response cannot restore data after connection changes', async ({ page }) => {
  const { errors } = await mockSnapshot(page)
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const start = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/api/nechako-portal/read', async (route) => {
    started()
    await gate
    await route
      .fulfill({
        json: {
          status: 'success',
          loggedIn: false,
          attributes: [{ history_timestamp: '2026-10-12', uname: 'Late protected actor' }],
        },
      })
      .catch(() => undefined)
  })
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const details = page.locator('[data-nechako-submission-dialog]')
  await details.getByRole('tab', { name: 'History', exact: true }).click()
  await start
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('nechako-connection-change', { detail: { reason: 'disconnected' } })),
  )
  await expect(details).toContainText('Connection changed. Refresh')
  release()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  await expect(details.getByText('Late protected actor', { exact: true })).toHaveCount(0)
  await expect(details).toContainText('Connection changed. Refresh')
  expect(errors).toEqual([])
})

test('public ZIP and PDF downloads contain the captured dataset and a valid PDF', async ({ page }) => {
  await mockSnapshot(page)
  await page.goto('/dev/nechako/portal?panel=search')
  const archiveDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download public data', exact: true }).click()
  const archiveFile = await (await archiveDownload).path()
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(readFileSync(archiveFile!))
  expect(Object.keys(archive.files).sort()).toEqual(['README.txt', 'forms.json', 'manifest.json', 'submissions.json'])
  expect(JSON.parse(await archive.file('submissions.json')!.async('text')).records).toHaveLength(26)
  expect(JSON.parse(await archive.file('forms.json')!.async('text')).forms).toHaveLength(2)
  expect(await archive.file('README.txt')!.async('text')).toContain(
    'live permissions, history and private records are excluded',
  )
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const details = page.locator('[data-nechako-submission-dialog]')
  await details.getByRole('tab', { name: 'Export', exact: true }).click()
  const pdfDownload = page.waitForEvent('download')
  await details.getByRole('button', { name: 'Export public PDF', exact: true }).click()
  const file = readFileSync((await (await pdfDownload).path())!)
  expect(file.subarray(0, 5).toString()).toBe('%PDF-')
  expect(file.length).toBeGreaterThan(1000)
})

test('denied direct child reads recover through the anonymous portal connection', async ({ page }) => {
  await mockSnapshot(page)
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({ json: { available: true, loggedIn: false, readOnly: true } }),
  )
  await page.route('https://nechakowatershed-portal.ca/rest/portal/getChildren.php', (route) =>
    route.fulfill({ json: { status: 'failure', error: 'You do not have access to that submission', loggedIn: false } }),
  )
  const reads: unknown[] = []
  await page.route('**/api/nechako-portal/read', (route) => {
    const request = route.request().postDataJSON()
    reads.push(request)
    expect(request).toEqual({ path: 'rest/portal/getChildren.php', params: { parentId: '1' } })
    return route.fulfill({ json: { status: 'success', loggedIn: false, attributes: [] } })
  })
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const details = page.locator('[data-nechako-submission-dialog]')
  await details.getByRole('tab', { name: 'Child Submissions', exact: true }).click()
  await expect(details.getByRole('alert')).toContainText('You do not have access')
  await details.getByRole('button', { name: 'Use portal connection', exact: true }).click()
  await expect(details.getByRole('alert')).toHaveCount(0)
  await expect(details).toContainText('0 records returned')
  expect(reads).toHaveLength(1)
  await expect(details).toContainText('Submission ID 1')
})

test('original downloads use the bounded session endpoint and do not enable empty ZIP exports', async ({ page }) => {
  await mockSnapshot(page)
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({ json: { available: true, loggedIn: false, readOnly: true } }),
  )
  await page.route('**/api/nechako-portal/download', (route) => {
    expect(route.request().postDataJSON()).toEqual({ submissionId: '1', mode: 'pdf' })
    return route.fulfill({ contentType: 'application/pdf', body: Buffer.from('%PDF-1.7 Fixture original report') })
  })
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const details = page.locator('[data-nechako-submission-dialog]')
  await details.getByRole('tab', { name: 'Export', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Download original ZIP', exact: true })).toBeDisabled()
  const original = page.waitForEvent('download')
  await details.getByRole('button', { name: 'Download original PDF', exact: true }).click()
  expect(
    readFileSync((await (await original).path())!)
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-')
})

test('uncaptured child access is gated, sign-in opens a RAM-only viewer and closing cancels its original download', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const { errors } = await mockSnapshot(page)
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  let loggedIn = false
  const status = () => ({ available: true, loggedIn, readOnly: true, canWrite: false, isAdmin: false })
  await page.route('**/api/nechako-portal/status', (route) =>
    route.fulfill({
      json: { ...status(), ...(route.request().method() === 'POST' ? { sessionToken: 'A'.repeat(64) } : {}) },
    }),
  )
  await page.route('**/api/nechako-portal/login', (route) => {
    expect(route.request().postDataJSON()).toEqual({ username: 'fixture-account', password: 'fixture-password' })
    loggedIn = true
    return route.fulfill({ json: { ...status(), sessionToken: 'B'.repeat(64) } })
  })
  const reads: { path: string; params: Record<string, string> }[] = []
  const fieldIndices: Record<string, string> = {}
  const sourceForm = {
    name: 'Source fixture form',
    nodes: [
      { field_id: 46, field_label: 'Private fixture field', field_type: 'text', nodeInfo: { node_is_dynamic: true } },
      { field_id: 47, field_label: 'Checked fixture', field_type: 'checkbox', nodeInfo: { node_is_dynamic: true } },
      {
        field_id: 100,
        field_label: 'Attachments',
        field_type: '5',
        nodeInfo: { node_is_dynamic: false, node_name: 'attachmentsNode.form' },
      },
      { field_id: 48, field_label: 'Count fixture', field_type: 'number', nodeInfo: { node_is_dynamic: true } },
      { field_id: 49, field_label: 'Empty fixture', field_type: 'text', nodeInfo: { node_is_dynamic: true } },
      { field_id: 50, field_label: 'Body fixture', field_type: 'htmleditor', nodeInfo: { node_is_dynamic: true } },
    ],
  }
  await page.route('**/api/nechako-portal/read', (route) => {
    const body = route.request().postDataJSON()
    reads.push(body)
    let attributes: unknown = []
    if (body.path.endsWith('getChildren.php')) {
      attributes =
        body.params.parentId === '1' ? [{ form_submission_id: 742, submission_title: 'Uncaptured fixture child' }] : []
    } else if (body.path.endsWith('getSubmissionMetadata.php')) {
      expect(body.params).toEqual({ submissionId: '742' })
      if (!loggedIn)
        return route.fulfill({
          json: {
            status: 'failure',
            sourceDenied: true,
            loggedIn: false,
            error: 'Fixture source access denied for 742',
          },
        })
      attributes = {
        submission_id: 742,
        form_id: 4,
        submission_title: 'Source-only fixture 742',
        submission_name: 'Private fixture name',
        parent_id: 1,
      }
    } else if (body.path.endsWith('getSubmissionForm.php')) {
      expect(loggedIn).toBe(true)
      expect(body.params).toEqual({ submissionId: '742' })
      attributes = 4
    } else if (body.path.endsWith('getForm.php')) {
      expect(loggedIn).toBe(true)
      expect(body.params).toEqual({ id: '4' })
      attributes = sourceForm
    } else if (body.path.endsWith('getFieldValue.php')) {
      expect(loggedIn).toBe(true)
      expect(body.params.submissionId).toBe('742')
      fieldIndices[body.params.fieldId] = body.params.fieldIndex
      attributes = (
        {
          '46': 'Ephemeral private fixture value',
          '47': false,
          '48': 0,
          '49': [],
          '50': '<p>Ephemeral fixture body.</p><a href="http://example.test/private-citation?a=1&amp;b=2">Source citation</a>',
        } as Record<string, unknown>
      )[body.params.fieldId]
    } else
      expect([
        'rest/portal/getSubmissionLayers.php',
        'rest/portal/getSubmissionLinkedLayers.php',
        'rest/portal/getSubmissionAttachments.php',
        'rest/portal/getSubmissionPermissions.php',
        'rest/portal/getHistory.php',
      ]).toContain(body.path)
    return route.fulfill({ json: { status: 'success', loggedIn, attributes } })
  })
  let downloadStarted!: () => void, releaseDownload!: () => void, downloadHandled!: () => void
  const start = new Promise<void>((resolve) => {
    downloadStarted = resolve
  })
  const gate = new Promise<void>((resolve) => {
    releaseDownload = resolve
  })
  const handled = new Promise<void>((resolve) => {
    downloadHandled = resolve
  })
  await page.route('**/api/nechako-portal/download', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ submissionId: '742', mode: 'pdf' })
    downloadStarted()
    await gate
    await route
      .fulfill({ contentType: 'application/pdf', body: Buffer.from('%PDF-1.7 Source-only fixture report') })
      .catch(() => undefined)
    downloadHandled()
  })
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.goto('/dev/nechako/portal?panel=search')
  await page.getByRole('button', { name: 'Public fixture 1', exact: true }).click()
  const publicDetails = page.locator('[data-nechako-submission-dialog]')
  await publicDetails.getByRole('tab', { name: 'Child Submissions', exact: true }).click()
  await publicDetails.getByRole('button', { name: 'Open child submission 742', exact: true }).click()
  const privateDetails = page.locator('[data-nechako-source-submission-dialog]')
  await expect(privateDetails.getByRole('alert')).toContainText('Fixture source access denied for 742')
  expect(
    reads.filter(({ path }) =>
      /getSubmissionForm|getForm|getFieldValue|getHistory|getSubmissionPermissions|getSubmissionLayers|getSubmissionAttachments/.test(
        path,
      ),
    ),
  ).toEqual([])
  await expect(page.locator('[data-nechako-submission-search]')).toContainText('26 submissions')
  await privateDetails.getByRole('button', { name: 'Connection settings', exact: true }).click()
  const connection = page.getByRole('dialog', { name: 'Original portal connection', exact: true })
  await connection.getByLabel('Portal connection username').fill('fixture-account')
  await connection.getByLabel('Portal connection password').fill('fixture-password')
  await connection.getByRole('button', { name: 'Sign in for portal access', exact: true }).click()
  await expect(connection).toContainText('Portal connection available · signed in')
  await connection.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(privateDetails.getByRole('heading', { name: 'Source-only fixture 742', exact: true })).toBeVisible()
  await expect(privateDetails.getByText('Ephemeral private fixture value', { exact: true })).toBeVisible()
  await expect(privateDetails.getByText('false', { exact: true })).toBeVisible()
  await expect(privateDetails.getByText('0', { exact: true })).toBeVisible()
  await expect(privateDetails.getByText('[]', { exact: true })).toBeVisible()
  await expect(
    privateDetails.getByRole('link', { name: 'http://example.test/private-citation?a=1&b=2', exact: true }),
  ).toHaveAttribute('href', 'http://example.test/private-citation?a=1&b=2')
  expect(fieldIndices).toEqual({ '46': '0', '47': '1', '48': '0', '49': '1', '50': '2' })
  await expect(privateDetails.getByRole('tab')).toHaveCount(8)
  for (const tab of ['General', 'Allowed Users', 'Spatial Data', 'Attachments', 'Child Submissions', 'History'])
    await privateDetails.getByRole('tab', { name: tab, exact: true }).click()
  await privateDetails.getByRole('tab', { name: 'Preview', exact: true }).click()
  await expect(privateDetails.getByText('Ephemeral private fixture value', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('nechako-connection-change', { detail: { reason: 'session-changing' } })),
  )
  await expect(privateDetails.getByText('Ephemeral private fixture value', { exact: true })).toHaveCount(0)
  await expect(privateDetails.getByRole('heading', { name: 'Source-only fixture 742', exact: true })).toHaveCount(0)
  await expect(privateDetails.getByText('Private fixture name', { exact: true })).toHaveCount(0)
  await privateDetails.getByRole('button', { name: 'Check submission access', exact: true }).click()
  await expect(privateDetails.getByText('Ephemeral private fixture value', { exact: true })).toBeVisible()
  await privateDetails.getByRole('tab', { name: 'Export', exact: true }).click()
  await expect(privateDetails.getByRole('button', { name: 'Download original ZIP', exact: true })).toBeDisabled()
  await privateDetails.getByRole('button', { name: 'Download original PDF', exact: true }).click()
  await start
  await privateDetails.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(privateDetails).toHaveCount(0)
  releaseDownload()
  await handled
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  expect(downloads).toEqual([])
  await expect(publicDetails).toContainText('Submission ID 1 · Project')
  await publicDetails.getByRole('button', { name: 'Close', exact: true }).last().click()
  const archiveDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download public data', exact: true }).click()
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(readFileSync((await (await archiveDownload).path())!))
  const captured = JSON.parse(await archive.file('submissions.json')!.async('text'))
  expect(captured.records).toHaveLength(26)
  expect(captured.records.some((record: { id: string }) => record.id === '742')).toBe(false)
  expect(JSON.stringify(captured)).not.toContain('Ephemeral private fixture value')
  expect(errors).toEqual([])
})
