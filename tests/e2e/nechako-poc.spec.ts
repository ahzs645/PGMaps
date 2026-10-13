import { expect, test, type Page } from '@playwright/test'

// Every portal request is intercepted, including the write adapter. These tests
// exercise the review UI and outgoing contracts without changing source records.
type SourceRequest = { path: string; params: Record<string, string> }
const identity = {
  uname: 'fixture-reviewer',
  fname: 'Fixture',
  lname: 'Reviewer',
  email: 'fixture@example.test',
  initial_notification: false,
  initial_permission: 1,
  initial_group: 2,
  active: true,
  can_be_assigned_subs: false,
  can_assign_subs: false,
  can_edit_subs: false,
  boss_permission: false,
}
async function mockPortal(page: Page, admin = false) {
  const reads: SourceRequest[] = [],
    writes: SourceRequest[] = [],
    errors: string[] = []
  let formRead = false,
    addedMember = false,
    approved = false
  let loggedIn = admin
  let statusGate: Promise<void> | undefined
  let pendingStatuses = 0
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('pgmaps-nechako-connection-mode', 'gateway'))
  await page.route('https://**/*', (route) => {
    if (new URL(route.request().url()).hostname === 'basemaps.cartocdn.com')
      return route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce9e9' } }],
        },
      })
    return route.abort('internetdisconnected')
  })
  await page.route('**/data/nechako-showcase/submissions.cleaned.json', (route) =>
    route.fulfill({
      json: [
        {
          id: 73,
          title: 'Fixture salmon research',
          authors: ['Fixture researcher'],
          tags: [],
          description: 'Public catalogue fixture',
        },
      ],
    }),
  )
  await page.route('**/data/nechako-showcase/services.json', (route) => route.fulfill({ json: [] }))
  await page.route('**/data/nechako-showcase/public-projects/index.json', (route) =>
    route.fulfill({
      json: {
        schema: 'nechako-public-projects-v1',
        capturedAt: '2026-10-12',
        access: 'anonymous',
        projects: [],
      },
    }),
  )
  await page.route('**/api/nechako-portal/**', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop()
    if (action === 'status') {
      if (statusGate) {
        pendingStatuses += 1
        await statusGate
      }
      return route.fulfill({
        json: {
          available: true,
          loggedIn,
          readOnly: !loggedIn,
          canWrite: loggedIn,
          isAdmin: loggedIn,
          csrfToken: 'e2e-fixture-csrf',
          expiresAfterIdleSeconds: 1800,
        },
      })
    }
    const payload = route.request().postDataJSON() as SourceRequest
    if (action === 'write') {
      expect(admin).toBe(true)
      expect(route.request().headers()['x-nechako-csrf']).toBe('e2e-fixture-csrf')
      writes.push(payload)
      if (payload.path.endsWith('updateUser.php')) formRead = true
      if (payload.path.endsWith('updateGroup.php')) addedMember = true
      if (payload.path.endsWith('setLinkableStatus.php')) approved = true
      return route.fulfill({ json: { status: 'success', loggedIn: true, attributes: { accepted: true } } })
    }
    expect(action).toBe('read')
    reads.push(payload)
    let attributes: unknown = []
    switch (payload.path.split('/').pop()) {
      case 'getSearchContext.php':
        attributes = ['Submission Title', 'Submission ID', 'Submission Content'].map((context) => ({ context }))
        break
      case 'getSearchResults.php':
        attributes = {
          results: [
            {
              submission_id: 1477,
              form_id: 39,
              submission_title: 'Fixture native submission',
              submission_name: 'Upper fixture',
              submission_date: '2024-01-01',
              submitted_by: 'Fixture contributor',
            },
          ],
        }
        break
      case 'getSubmissionMetadata.php':
        attributes = {
          submission_id: 1477,
          submission_title: 'Fixture native submission',
          submission_state: 'Submitted',
          parent_id: 0,
        }
        break
      case 'getSubmissionForm.php':
        attributes = 39
        break
      case 'getForm.php':
        attributes = {
          name: 'Fixture source form',
          nodes: [
            { field_id: 561, field_type: 'text', field_label: 'Sub-basin Name', nodeInfo: { node_is_dynamic: true } },
          ],
        }
        break
      case 'getFieldValue.php':
        attributes = 'Upper fixture source value'
        break
      case 'getSubmissionLayers.php':
        return route.fulfill({ json: { status: 'failure', loggedIn: admin, error: 'Fixture layer access denied' } })
      case 'getUserDetails.php':
        attributes = identity
        break
      case 'getUserPermissionsCheckbox.php':
        attributes = [
          { id: 39, name: 'Fixture form', checked: payload.params.mode === 'form' && formRead, edit_checked: false },
        ]
        break
      case 'getUsers.php':
        attributes = [
          { uid: 7, uname: identity.uname },
          { uid: 8, uname: 'fixture-member' },
        ]
        break
      case 'getGroups.php':
        attributes = [{ gid: 2, gname: 'Fixture group', count: addedMember ? 2 : 1 }]
        break
      case 'getGroupMembers.php':
        attributes = [
          { uid: 7, uname: identity.uname, primary_group: true },
          ...(addedMember ? [{ uid: 8, uname: 'fixture-member', primary_group: false }] : []),
        ]
        break
      case 'getLinkableLayers.php':
        attributes = [
          {
            layer_id: 386,
            layer_name: 'Fixture shared layer',
            uname: 'fixture-member',
            active: true,
            shared: true,
            vetted_by_admin: approved,
          },
        ]
        break
    }
    return route.fulfill({ json: { status: 'success', loggedIn: admin, attributes } })
  })
  return {
    reads,
    writes,
    errors,
    get pendingStatuses() {
      return pendingStatuses
    },
    deferAnonymousStatus() {
      loggedIn = false
      let resume!: () => void
      statusGate = new Promise<void>((resolve) => {
        resume = resolve
      })
      return () => {
        statusGate = undefined
        resume()
      }
    },
  }
}

for (const width of [1440, 390]) {
  test(`cross-tab logout immediately clears private views before delayed status at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const mock = await mockPortal(page, true)
    await page.goto('/dev/nechako/portal?panel=administration')
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    await page.getByLabel('Permission user ID', { exact: true }).fill('7')
    await page.getByRole('button', { name: 'Load user resource permissions', exact: true }).click()
    await page.getByLabel('Read form 39', { exact: true }).check()
    await page.getByRole('button', { name: 'Review permission changes', exact: true }).click()
    await page.getByLabel('I reviewed the target user and every access change.', { exact: true }).check()
    await expect(page.getByRole('button', { name: 'Apply reviewed permission changes', exact: true })).toBeEnabled()
    const releaseStatus = mock.deferAnonymousStatus()
    try {
      await page.evaluate(() => {
        const revision = new BroadcastChannel('nechako-session-revision')
        revision.postMessage({ reason: 'disconnected' })
        revision.close()
      })
      await expect.poll(() => mock.pendingStatuses).toBeGreaterThan(0)
      await expect(page.getByRole('button', { name: 'Apply reviewed permission changes', exact: true })).toHaveCount(0)
      await expect(page.getByText('Source user fixture-reviewer', { exact: false })).toHaveCount(0)
      await expect(
        page.getByText('Connect an authorized account in Account / Connection', { exact: false }),
      ).toBeVisible()
      expect(mock.writes).toEqual([])
    } finally {
      releaseStatus()
    }
    expect(mock.errors).toEqual([])
  })

  test(`unified search, native submission reader and saved expression at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    const mock = await mockPortal(page)
    await page.goto('/dev/nechako/portal?panel=inventory')
    await page.getByRole('tab', { name: 'Search collections', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search all watershed information', exact: true }).fill('salmon')
    await expect(page.getByRole('button', { name: /Fixture salmon research/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Live portal submissions', exact: true }).click()
    await expect(page.getByLabel('Search expression', { exact: true })).toHaveValue('salmon')
    await page.getByText('Visual expression builder', { exact: true }).click()
    await page.getByLabel('Expression term', { exact: true }).fill('salmon')
    await page.getByRole('button', { name: 'Add expression rule', exact: true }).click()
    await page.getByLabel('Expression rule type', { exact: true }).nth(2).selectOption('field')
    await page.getByLabel('Expression value', { exact: true }).fill('100')
    await page.getByRole('button', { name: 'Use built expression', exact: true }).click()
    const expression = '("salmon" AND {Submission ID} >= 100)'
    await expect(page.getByLabel('Search expression', { exact: true })).toHaveValue(expression)
    await page.getByText('Saved queries in this browser (0)', { exact: true }).click()
    await page.getByLabel('Saved query name', { exact: true }).fill('Salmon review')
    await page.getByRole('button', { name: 'Save current query', exact: true }).click()
    expect(mock.writes).toEqual([])
    await page.reload()
    await page.getByRole('tab', { name: 'Search collections', exact: true }).click()
    await page.getByRole('tab', { name: 'Live portal submissions', exact: true }).click()
    await page.getByText('Saved queries in this browser (1)', { exact: true }).click()
    await page.getByRole('button', { name: 'Load Salmon review', exact: true }).click()
    await expect(page.getByLabel('Search expression', { exact: true })).toHaveValue(expression)
    await page.getByRole('button', { name: 'Search portal', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Fixture native submission' })).toContainText(
      'Fixture contributor',
    )
    const search = mock.reads.findLast((request) => request.path.endsWith('getSearchResults.php'))!
    expect(JSON.parse(search.params.keys)).toEqual({
      token: 'AND',
      left: { token: 'string', value: 'salmon' },
      right: {
        token: 'comparator',
        value: '>=',
        left: { token: 'column', value: 'Submission ID' },
        right: { token: 'number', value: '100' },
      },
    })
    expect(JSON.parse(search.params.fields)).toEqual(['Submission Title', 'Submission ID', 'Submission Content'])
    expect(JSON.parse(search.params.area)).toBeNull()
    await page.getByRole('button', { name: '1477', exact: true }).click()
    const submission = page.getByRole('dialog', { name: 'Portal submission 1477', exact: true })
    await expect(submission).toBeVisible()
    const popupBounds = await submission.boundingBox()
    expect(popupBounds).not.toBeNull()
    expect(popupBounds!.x).toBeGreaterThanOrEqual(0)
    expect(popupBounds!.x + popupBounds!.width).toBeLessThanOrEqual(width)
    await expect(submission.getByLabel('Portal submission ID', { exact: true })).toHaveValue('1477')
    await submission.getByText('Metadata', { exact: true }).click()
    await submission.getByRole('button', { name: 'Load metadata', exact: true }).click()
    await expect(submission).toContainText('Fixture native submission')
    await submission.getByRole('button', { name: 'Load source form preview', exact: true }).click()
    await expect(submission.getByText('Upper fixture source value', { exact: true })).toBeVisible()
    await submission.getByText('Spatial layers', { exact: true }).click()
    await submission.getByRole('button', { name: 'Load spatial layers', exact: true }).click()
    await expect(submission.getByRole('alert')).toContainText('Fixture layer access denied')
    await expect(submission.getByText('Upper fixture source value', { exact: true })).toBeVisible()
    expect(mock.writes).toEqual([])
    expect(mock.errors).toEqual([])
  })

  test(`administrator changes require reviewed exact deltas at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    const mock = await mockPortal(page, true)
    await page.goto('/dev/nechako/portal?panel=administration')
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    await page.getByLabel('Permission user ID', { exact: true }).fill('7')
    await page.getByRole('button', { name: 'Load user resource permissions', exact: true }).click()
    await page.getByLabel('Read form 39', { exact: true }).check()
    await page.getByRole('button', { name: 'Review permission changes', exact: true }).click()
    const applyPermissions = page.getByRole('button', { name: 'Apply reviewed permission changes', exact: true })
    await expect(applyPermissions).toBeDisabled()
    expect(mock.writes).toEqual([])
    await page.getByLabel('I reviewed the target user and every access change.', { exact: true }).check()
    // Editing after acknowledgement must invalidate the old reviewed request.
    await page.getByLabel('Read form 39', { exact: true }).uncheck()
    await expect(applyPermissions).toHaveCount(0)
    await page.getByLabel('Read form 39', { exact: true }).check()
    await page.getByRole('button', { name: 'Review permission changes', exact: true }).click()
    await expect(applyPermissions).toBeDisabled()
    expect(mock.writes).toEqual([])
    await page.getByLabel('I reviewed the target user and every access change.', { exact: true }).check()
    await applyPermissions.click()
    await expect(
      page.getByText('The original server accepted the permission update. Reload to verify.', { exact: true }),
    ).toBeVisible()
    expect(mock.writes).toHaveLength(1)
    const permission = mock.writes[0]
    expect(permission.path).toBe('rest/portal/admin/updateUser.php')
    expect(JSON.parse(permission.params.newData)).toEqual(identity)
    expect(permission.params.newPassword).toBe('')
    expect(JSON.parse(permission.params.formPermissionChanges)).toEqual([{ id: 39, checked: true, editChecked: false }])
    for (const key of [
      'submissionPermissionChanges',
      'matchPresetPermissionChanges',
      'sharedStylePermissionChanges',
      'sharedProjectPermissionChanges',
    ])
      expect(JSON.parse(permission.params[key])).toEqual([])
    await expect(page.getByLabel('Read form 39', { exact: true })).toBeChecked()
    await page.getByRole('tab', { name: 'Groups', exact: true }).click()
    await page.getByRole('button', { name: 'Load original groups', exact: true }).click()
    await page.getByLabel('Administration group', { exact: true }).selectOption('2')
    await page.getByRole('button', { name: 'Load group membership', exact: true }).click()
    await page.getByLabel('member user 8', { exact: true }).check()
    await page.getByRole('button', { name: 'Review group membership changes', exact: true }).click()
    const applyGroup = page.getByRole('button', { name: 'Apply reviewed group update', exact: true })
    await expect(applyGroup).toBeDisabled()
    expect(mock.writes).toHaveLength(1)
    await page.getByLabel('I reviewed membership and primary-group changes.', { exact: true }).check()
    await applyGroup.click()
    await expect(
      page.getByText('Source accepted the group update. Reload membership to verify.', { exact: true }),
    ).toBeVisible()
    expect(mock.writes[1]).toEqual({
      path: 'rest/portal/admin/updateGroup.php',
      params: {
        gid: '2',
        addedUsers: '[{"uid":8,"primary_group":false}]',
        removedUsers: '[]',
        primaryToggledUsers: '[]',
      },
    })
    await expect(page.getByLabel('member user 8', { exact: true })).toBeChecked()
    await page.getByRole('tab', { name: 'Layer moderation', exact: true }).click()
    await page.getByRole('button', { name: 'Load original shared-layer queue', exact: true }).click()
    await page.getByLabel('Review shared layer 386', { exact: true }).check()
    await page.getByRole('button', { name: 'Review layer moderation', exact: true }).click()
    const applyModeration = page.getByRole('button', { name: 'Apply reviewed layer moderation', exact: true })
    await expect(applyModeration).toBeDisabled()
    expect(mock.writes).toHaveLength(2)
    await page.getByLabel('I reviewed the source layers and action.', { exact: true }).check()
    await applyModeration.click()
    await expect(
      page.getByText('Source accepted the moderation update. Reload the queue to verify.', { exact: true }),
    ).toBeVisible()
    expect(mock.writes[2]).toEqual({
      path: 'rest/portal/admin/setLinkableStatus.php',
      params: { layerIds: '[386]', mode: 'allow' },
    })
    expect(mock.writes).toHaveLength(3)
    expect(mock.errors).toEqual([])
  })
}
