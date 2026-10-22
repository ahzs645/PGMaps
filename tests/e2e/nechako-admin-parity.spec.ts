import { expect, test, type Page } from '@playwright/test'

// Run against the dedicated Vite instance with:
// VITE_NECHAKO_GATEWAY_URL=https://fixture-gateway.example/api/nechako-portal
// PGMAPS_E2E_HOSTED_ADMIN=1 PGMAPS_E2E_BASE_URL=http://127.0.0.1:42175
// The public source is never contacted; every identity and record below is synthetic.
test.skip(!process.env.PGMAPS_E2E_HOSTED_ADMIN, 'Requires the dedicated hosted-admin fixture Vite server.')
test.describe.configure({ timeout: 90_000 })
test.use({ actionTimeout: 20_000 })

const gateway = 'https://fixture-gateway.example/api/nechako-portal'
const anonymousCapability = 'A'.repeat(64)
const signedCapability = 'B'.repeat(64)
const fixtureIdentity = 'synthetic-admin-fixture'
const catalogue = Array.from({ length: 27 }, (_, index) => ({
  sub_id: 201 + index,
  sub_title: `Synthetic admin submission ${201 + index}`,
  sub_name: `Synthetic record ${index + 1}`,
  sub_state: index === 1 ? 'DRAFT' : 'SUBMITTED',
}))
const form = {
  form_id: 39,
  name: 'Synthetic source form',
  nodes: [
    { field_id: 561, field_type: 'text', field_label: 'Synthetic basin', nodeInfo: { node_is_dynamic: true } },
    {
      field_id: 562,
      field_type: '5',
      field_label: 'Attachments',
      nodeInfo: { node_is_dynamic: false, node_name: 'attachmentsNode.form' },
    },
  ],
}

async function fixtureGateway(page: Page, role: 'admin' | 'member' = 'admin') {
  const requests: { path: string; params: Record<string, string> }[] = []
  const mutations: string[] = [],
    unexpected: string[] = [],
    errors: string[] = []
  let signedIn = false,
    reset = false
  page.on('pageerror', (error) => errors.push(error.message))
  const status = (authenticated: boolean) => ({
    available: true,
    loggedIn: authenticated,
    readOnly: true,
    canWrite: false,
    isAdmin: authenticated && role === 'admin',
  })
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.protocol !== 'https:') return route.continue()
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    if (!request.url().startsWith(`${gateway}/`)) {
      unexpected.push(request.url())
      return route.abort('internetdisconnected')
    }
    const authenticated = signedIn && !reset && request.headers()['x-nechako-session'] === signedCapability
    const action = url.pathname.split('/').pop()
    if (action === 'status')
      return route.fulfill({
        json: {
          ...status(authenticated),
          ...(request.method() === 'POST' ? { sessionToken: anonymousCapability } : {}),
          ...(reset && request.headers()['x-nechako-session'] ? { sessionReset: true } : {}),
        },
      })
    if (action === 'login') {
      expect(request.postDataJSON()).toEqual({ username: fixtureIdentity, password: 'synthetic-password' })
      signedIn = true
      return route.fulfill({ json: { ...status(true), sessionToken: signedCapability } })
    }
    if (action === 'disconnect') {
      signedIn = false
      return route.fulfill({ json: status(false) })
    }
    if (action !== 'read') {
      mutations.push(action ?? 'missing action')
      return route.fulfill({ status: 403, json: { error: 'The synthetic hosted fixture is read-only.' } })
    }
    const { path, params } = request.postDataJSON() as { path: string; params: Record<string, string> }
    requests.push({ path, params })
    if (!authenticated || role !== 'admin')
      return route.fulfill({ status: 403, json: { error: 'Synthetic fixture administrator access required.' } })
    const endpoint = path.split('/').pop()
    let attributes: unknown
    switch (endpoint) {
      case 'getForms.php':
        attributes = [{ form_id: 39, form_name: form.name }]
        break
      case 'getForm.php':
        expect(params).toEqual({ id: '39' })
        attributes = form
        break
      case 'getFormsLinkedSchemas.php':
        expect(params).toEqual({ formId: '39' })
        attributes = [{ id: 12, schema: 'Synthetic monitoring schema' }]
        break
      case 'getFormVisibleGroups.php':
        expect(params).toEqual({ formId: '39' })
        attributes = {
          visible: [{ gid: 4, gname: 'Synthetic visible group' }],
          not: [{ gid: 5, gname: 'Synthetic hidden group' }],
        }
        break
      case 'getUserForms.php':
        expect(params).toEqual({ form_id: '39' })
        attributes = {
          allowed: [{ id: 7, name: fixtureIdentity, can_edit: false }],
          disallowed: [{ id: 8, name: 'Synthetic disallowed user' }],
        }
        break
      case 'getSchemas.php':
        attributes = [
          {
            attr_table_id: 12,
            attr_table_name: 'Synthetic monitoring schema',
            schema_type: 'Monitor',
            geometry_type: 'Point',
          },
        ]
        break
      case 'getSchemaFields.php':
        expect(params).toEqual({ schemaId: '12' })
        attributes = [
          {
            attr_id: 43,
            attr_name: 'Synthetic water temperature',
            attr_type: 'double precision',
            linked_to_name: 'Synthetic station',
            link_type: 'field',
          },
        ]
        break
      case 'getMonitorSchemaLayers.php':
        expect(params).toEqual({ schemaId: '12', getDraftSubmissions: 'true', getDisabled: 'true' })
        attributes = [
          {
            form_submission_id: 202,
            submission_state: 'DRAFT',
            layer_id: 52,
            layer_name: 'Synthetic station layer',
            schema_rec_seq_id: 9,
            monitor_status: 'DISABLED',
          },
        ]
        break
      case 'getSubmissions.php':
        expect(params).toEqual({})
        attributes = catalogue
        break
      case 'getAllBaseLayers.php':
        attributes = [
          {
            baselayer_id: 5,
            name: 'Synthetic spatial source',
            type: 'capabilities',
            resource: 'https://example.invalid/synthetic-wms',
            layers: 'synthetic-layer',
            is_base: false,
            is_default: 't',
            is_on: 'f',
            attributions: 'Synthetic attribution',
          },
        ]
        break
      case 'getStatusFlags.php':
        attributes = [{ status_id: 1, status_desc: 'Synthetic review flag' }]
        break
      case 'getTaskStatuses.php':
        attributes = [
          {
            status_id: 2,
            status_name: 'Synthetic scheduled',
            colour: '118899',
            description: 'Synthetic task status',
            rank: 3,
          },
        ]
        break
      case 'getPriorities.php':
        attributes = [
          {
            priority_id: 2,
            priority_description: 'Synthetic priority',
            start_date_delay: 0,
            duration: 5,
            preferred_start_day: 1,
            preferred_end_day: 5,
          },
        ]
        break
      case 'getHolidays.php':
        attributes = [
          { holiday_id: 3, name: 'Synthetic holiday', description: 'Synthetic fixture only', date: '2026-10-22' },
        ]
        break
      case 'schedule.php':
        expect(new Date(params.date).toISOString()).toBe(params.date)
        attributes =
          params.mode === 'monthly'
            ? [{ day: '2026-10-21', colour: '118899' }]
            : params.mode === 'date'
              ? [
                  {
                    event: 'START',
                    task_name: 'Synthetic daily task',
                    task_details: 'Synthetic task details',
                    submission: 201,
                    rank: 1,
                    status_name: 'Synthetic scheduled',
                    colour: '118899',
                  },
                ]
              : {
                  newTasks: [
                    {
                      task_id: 61,
                      name: 'Synthetic new task',
                      submission_id: 201,
                      task_start: '2026-10-21',
                      task_end: '2026-10-22',
                      description: 'Synthetic notification',
                    },
                  ],
                  nearDeadline: [
                    {
                      task_id: 61,
                      name: 'Synthetic new task',
                      submission_id: 201,
                      task_start: '2026-10-21',
                      task_end: '2026-10-22',
                      description: 'Synthetic overlapping category',
                    },
                  ],
                }
        break
      default:
        unexpected.push(path)
        return route.fulfill({ status: 400, json: { error: `Unexpected synthetic fixture read: ${path}` } })
    }
    return route.fulfill({ json: { success: true, status: 'success', loggedIn: true, attributes } })
  })
  return {
    requests,
    mutations,
    unexpected,
    errors,
    disconnect: () => {
      reset = true
    },
    verify: () => {
      expect(mutations).toEqual([])
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
      expect(
        requests.filter(({ path }) => /(?:create|add|set|save|new|allocat|submit|upload|delete)/i.test(path)),
      ).toEqual([])
    },
  }
}

async function openSignedSection(page: Page, view: string) {
  await page.goto(`/dev/nechako/portal?panel=account&admin=${view}`)
  await expect(page.getByRole('button', { name: 'Portal connection', exact: true })).toBeVisible()
  await page.getByLabel('Portal connection username').fill(fixtureIdentity)
  await page.getByLabel('Portal connection password').fill('synthetic-password')
  await page.getByRole('button', { name: 'Sign in for portal access', exact: true }).click()
  await expect(page.getByText('Portal connection available · signed in', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close portal window', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Watershed portal' })
    .getByRole('button', { name: 'Administration', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`panel=administration&admin=${view}|admin=${view}&panel=administration`))
}

test('hosted read-only admin opens form definitions and their source relationships', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const fixture = await fixtureGateway(page)
  await openSignedSection(page, 'forms')
  const admin = page.locator('[data-nechako-administration]')
  await expect(admin).toContainText('This connection is read-only')
  await admin.getByRole('button', { name: 'Load forms', exact: true }).click()
  await admin.getByRole('button', { name: 'Inspect form 39', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Form content fields', exact: true })).toContainText('Synthetic basin')
  await expect(admin.getByRole('table', { name: 'Form content fields', exact: true })).toContainText('Not supplied')
  await expect(admin.getByText('attachmentsNode.form', { exact: true })).toBeVisible()
  await admin
    .getByRole('heading', { name: 'Form definition · 39', exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: test.info().outputPath('admin-forms-synthetic-desktop.png'), fullPage: true })
  await admin.getByRole('button', { name: 'Inspect linked schema 12', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Schema fields and links', exact: true })).toContainText(
    'Synthetic station',
  )
  await admin.getByRole('button', { name: 'Load form group visibility', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Form group visibility', exact: true })).toContainText(
    'Synthetic hidden group',
  )
  await admin.getByRole('button', { name: 'Load form user access', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Form user access', exact: true })).toContainText(fixtureIdentity)
  fixture.verify()
})

test('hosted read-only admin follows monitor schemas without allocating a submission', async ({ page }) => {
  const fixture = await fixtureGateway(page)
  await openSignedSection(page, 'schemas')
  const admin = page.locator('[data-nechako-administration]')
  await admin.getByRole('button', { name: 'Load schemas', exact: true }).click()
  await admin.getByRole('button', { name: 'Inspect schema 12', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Schema fields and links', exact: true })).toContainText(
    'double precision',
  )
  await admin.getByRole('button', { name: 'Load schema monitoring associations', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Schema monitoring associations', exact: true })).toContainText(
    'DISABLED',
  )
  await expect(admin.getByRole('button', { name: 'Open submission 202', exact: true })).toBeVisible()
  fixture.verify()
})

test('hosted admin calendar retains day tasks and overlapping notification categories', async ({ page }) => {
  const fixture = await fixtureGateway(page)
  await openSignedSection(page, 'dashboard')
  const admin = page.locator('[data-nechako-administration]')
  await admin.getByLabel('Workflow date', { exact: true }).fill('2026-10-21')
  await admin.getByRole('button', { name: 'Load month highlights', exact: true }).click()
  await expect(admin.getByRole('button', { name: 'Tasks on 2026-10-21, source highlight', exact: true })).toBeVisible()
  await admin.getByRole('button', { name: 'Load tasks for selected day', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'Tasks for selected day', exact: true })).toContainText(
    'Synthetic daily task',
  )
  await admin.getByLabel('Notification start date', { exact: true }).fill('2026-10-20')
  await admin.getByRole('button', { name: 'Load notifications', exact: true }).click()
  await expect(admin.getByRole('table', { name: 'New tasks', exact: true })).toContainText('Synthetic new task')
  await expect(admin.getByRole('table', { name: 'Near deadline', exact: true })).toContainText('Synthetic new task')
  expect(fixture.requests.filter(({ path }) => path.endsWith('schedule.php')).map(({ params }) => params.mode)).toEqual(
    ['monthly', 'date', 'notification'],
  )
  fixture.verify()
})

test('hosted admin submission catalogue pages all records and clears on session reset', async ({ page }) => {
  const fixture = await fixtureGateway(page)
  await openSignedSection(page, 'submissions')
  const admin = page.locator('[data-nechako-administration]')
  await admin.getByRole('button', { name: 'Load submission catalogue', exact: true }).click()
  await expect(admin).toContainText('27 distinct submission IDs returned')
  await expect(admin.getByRole('table', { name: 'Administrator submissions', exact: true })).not.toContainText(
    'Synthetic admin submission 227',
  )
  await admin
    .getByRole('navigation', { name: 'Administrator submissions pages', exact: true })
    .getByRole('button', { name: 'Next', exact: true })
    .click()
  await expect(admin.getByRole('table', { name: 'Administrator submissions', exact: true })).toContainText(
    'Synthetic admin submission 227',
  )
  await admin.getByLabel('Submission manager state', { exact: true }).selectOption('DRAFT')
  await expect(admin.getByRole('table', { name: 'Administrator submissions', exact: true })).toContainText(
    'Synthetic admin submission 202',
  )
  fixture.disconnect()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(admin).toContainText('Administrator access required')
  await expect(admin).not.toContainText('Synthetic admin submission')
  fixture.verify()
})

test('hosted admin system registries preserve source defaults and scheduling definitions on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fixture = await fixtureGateway(page)
  await openSignedSection(page, 'system')
  const admin = page.locator('[data-nechako-administration]')
  await admin.getByRole('button', { name: 'Load spatial layer registry', exact: true }).click()
  const sources = admin.getByRole('table', { name: 'Spatial layer registry', exact: true })
  await expect(sources).toContainText('Synthetic spatial source')
  await expect(sources).toContainText('Auto Add')
  await expect(sources).toContainText('Auto On')
  const sourceCells = sources.getByRole('row').nth(1).getByRole('cell')
  await expect(sourceCells.nth(5)).toHaveText('No')
  await expect(sourceCells.nth(6)).toHaveText('Yes')
  await expect(sourceCells.nth(7)).toHaveText('No')
  await sources.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: test.info().outputPath('admin-system-synthetic-mobile.png'), fullPage: true })
  for (const [label, value] of [
    ['Submission status flags', 'Synthetic review flag'],
    ['Task statuses', 'Synthetic scheduled'],
    ['Priorities', 'Synthetic priority'],
    ['Holidays', 'Synthetic holiday'],
  ]) {
    await admin.getByRole('tab', { name: label, exact: true }).click()
    await admin.getByRole('button', { name: `Load ${label.toLowerCase()}`, exact: true }).click()
    await expect(admin.getByRole('table', { name: label, exact: true })).toContainText(value)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  fixture.verify()
})

for (const role of ['anonymous', 'member'] as const)
  test(`${role} session never requests protected administrator collections`, async ({ page }) => {
    const fixture = await fixtureGateway(page, 'member')
    if (role === 'member') await openSignedSection(page, 'submissions')
    else await page.goto('/dev/nechako/portal?panel=administration&admin=submissions')
    const admin = page.locator('[data-nechako-administration]')
    for (const label of ['Submissions', 'Permissions', 'Groups', 'Layer moderation', 'Help content', 'System']) {
      await admin.getByRole('tab', { name: label, exact: true }).click()
      await expect(admin).toContainText('Administrator access required')
    }
    expect(fixture.requests).toEqual([])
    fixture.verify()
  })
