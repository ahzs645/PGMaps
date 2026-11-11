import { expect, test } from '@playwright/test'

for (const width of [390, 1108, 1440]) {
  test(`choose and switch interfaces with the same road and station at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 954 })
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.goto('/dev/forestry/road-design?example=training')
    await expect(page.getByRole('heading', { name: 'Choose your workspace' })).toBeVisible()
    await expect(page.getByTestId('road-workspace')).toHaveCount(0)
    for (const preview of await page.locator('.lp-preview img').all()) {
      await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
    await page.getByRole('button', { name: 'Open Ribbon', exact: true }).click()
    const header = page.getByTestId('road-workspace-header')
    const ribbon = page.getByRole('region', { name: 'Command ribbon' })
    await expect(header).toHaveCount(0)
    const ribbonBox = (await ribbon.boundingBox())!
    expect(ribbonBox.x).toBeCloseTo(0, 0)
    const workspace = (await page.getByTestId('road-workspace').boundingBox())!
    expect(ribbonBox.y).toBeCloseTo(workspace.y, 0)
    expect(ribbonBox.width).toBeCloseTo(width, 0)
    const summary = (await page.getByRole('complementary', { name: 'Road summary', exact: true }).boundingBox())!
    expect(summary.x).toBeGreaterThan(0)
    expect(summary.width).toBeLessThan(width / 2)
    const tabs = page.getByRole('tablist', { name: 'Ribbon tabs' })
    await tabs.getByRole('tab', { name: 'File', exact: true }).click()
    await expect(ribbon.getByRole('group', { name: 'Current project' }).getByTestId('road-project-name')).toBeVisible()
    await expect(
      ribbon.getByRole('group', { name: 'Data exchange' }).getByRole('button', { name: 'Save and export' }),
    ).toBeVisible()
    await expect(ribbon.getByRole('button', { name: 'Switch workspace interface' })).toBeVisible()
    await page.getByRole('button', { name: 'Project library', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await tabs.getByRole('tab', { name: 'Road', exact: true }).click()
    await expect(ribbon.getByRole('combobox', { name: 'Viewing road', exact: true })).toBeVisible()
    await expect(
      ribbon.getByRole('group', { name: 'Edit alignment' }).getByRole('button', { name: 'Undo' }),
    ).toBeDisabled()
    await tabs.getByRole('tab', { name: 'Engineering', exact: true }).click()
    await expect(ribbon.getByRole('button', { name: 'Quantities', exact: true })).toBeVisible()
    await tabs.getByRole('tab', { name: 'View', exact: true }).click()
    await ribbon.getByRole('button', { name: 'Screen presets & panels' }).click()
    const layoutDialog = page.getByTestId('road-layouts-dialog')
    await expect(layoutDialog).toBeVisible()
    const closePresets = layoutDialog.getByRole('button', { name: 'Close', exact: true })
    await expect(closePresets).toBeFocused()
    await closePresets.press('Escape')
    await expect(layoutDialog).toBeHidden()
    const station = page.getByRole('spinbutton', { name: 'Selected station metres' })
    await station.fill('200')
    await station.press('Enter')
    const road = await page.title()
    const switchMode = page.getByRole('button', { name: 'Switch workspace interface' })
    await switchMode.click()
    await page.getByRole('button', { name: 'Open Guided map', exact: true }).click()
    await expect(header).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Road layout guide' }).getByTestId('road-workspace-header'),
    ).toHaveCount(0)
    const steps = page.getByRole('tablist', { name: 'Road layout steps' })
    await steps.getByRole('tab', { name: 'Checks' }).click()
    await page.getByRole('button', { name: 'Road profile', exact: true }).click()
    await expect(page.getByTestId('road-profile-chart')).toBeVisible()
    await expect(station).toHaveValue('200')
    await switchMode.click()
    await page.keyboard.press('Escape')
    await expect(steps).toBeVisible()
    await switchMode.click()
    await page.getByRole('button', { name: 'Open Engineering workbench', exact: true }).click()
    await expect(page.getByTestId('road-workspace')).toHaveAttribute('data-interface', 'workbench')
    await expect(station).toHaveValue('200')
    await expect(page).toHaveTitle(road)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Choose your workspace' })).toBeVisible()
  })
}

test('a runtime-defined layout reuses the edited project, file contents and undo history', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/workspace-layouts.json', async (route) => {
    const original = await (await route.fetch()).json()
    await route.fulfill({
      json: [
        ...original,
        {
          id: 'field-review',
          name: 'Field review',
          description: 'Review and export the selected road.',
          preset: 'plan',
          panelFrame: { inset: 32 },
          toolbar: {
            dock: 'top',
            header: 'controls',
            label: 'Field commands',
            tabsLabel: 'Field tabs',
            groups: [
              {
                label: 'Field files',
                sections: [
                  { label: 'Documents', items: ['export', 'projects'] },
                  { label: 'Revision', items: ['projectInfo', 'undo'] },
                ],
              },
            ],
          },
        },
      ],
    })
  })
  await page.goto('/dev/forestry/road-design?example=training')
  await page.getByRole('button', { name: 'Open Engineering workbench', exact: true }).click()
  const projectName = page.getByTestId('road-project-name')
  const originalName = await projectName.innerText()
  await projectName.click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Layout continuity')
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter')
  async function readExport() {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
    const stream = await (await pending).createReadStream()
    const chunks = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    await page
      .getByRole('dialog', { name: 'Save & export' })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    return Buffer.concat(chunks).toString()
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const before = await readExport()
  expect(JSON.parse(before).name).toBe('Layout continuity')
  await page.getByRole('button', { name: 'Switch workspace interface' }).click()
  await page.getByRole('button', { name: 'Open Field review', exact: true }).click()
  await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-layout', 'plan')
  const commands = page.getByRole('region', { name: 'Field commands' })
  expect((await commands.boundingBox())!.x).toBeCloseTo(32, 0)
  await expect(commands.getByRole('group', { name: 'Documents' }).getByRole('button')).toHaveText([
    'Save and export',
    'Project library',
  ])
  await commands.getByRole('button', { name: 'Save and export' }).click()
  expect(await readExport()).toEqual(before)
  await commands.getByRole('group', { name: 'Revision' }).getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(projectName).toHaveText(originalName)
})

test('an invalid layout configuration leaves the built-in chooser available', async ({ page }) => {
  await page.route('**/workspace-layouts.json', (route) => route.fulfill({ json: [{ id: 'unknown' }] }))
  await page.goto('/dev/forestry/road-design')
  await expect(page.getByRole('status')).toContainText('built-in engineering workbench')
  await expect(page.getByRole('button', { name: 'Open Engineering workbench', exact: true })).toBeVisible()
})

test('a layout without a task pane can still expand its shared editor inside the ribbon', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.route('**/workspace-layouts.json', async (route) => {
    const layouts = await (await route.fetch()).json()
    delete layouts.find((layout: { id: string }) => layout.id === 'ribbon').toolbar.editorPlacement
    await route.fulfill({ json: layouts })
  })
  await page.goto('/dev/forestry/road-design?example=training')
  await page.getByRole('button', { name: 'Open Ribbon', exact: true }).click()
  const ribbon = page.getByRole('region', { name: 'Command ribbon' })
  await ribbon.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name: 'Section', exact: true }).click()
  const plan = page.getByTestId('road-plan-view')
  const compactHeight = (await plan.boundingBox())!.height
  await ribbon.getByRole('button', { name: 'Expand ribbon settings' }).click()
  const slot = ribbon.locator('.lp-editor-slot')
  await expect(slot).toBeVisible()
  await expect.poll(async () => compactHeight - (await plan.boundingBox())!.height).toBeGreaterThan(100)
  const width = slot.getByRole('spinbutton', { name: 'Left half-width (m)', exact: true })
  await width.fill('4.6')
  await width.press('Enter')
  await ribbon.getByRole('button', { name: 'Collapse ribbon settings' }).click()
  await expect(slot).toBeHidden()
  await expect(ribbon.getByRole('spinbutton', { name: 'Left half-width (m)', exact: true })).toHaveValue('4.6')
})

for (const width of [390, 1440]) {
  test(`edit terrain, alignment, section and engineering values in ribbon tabs at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.route('**/workspace-layouts.json', async (route) => {
      const layouts = await (await route.fetch()).json()
      const groups = layouts[0].toolbar.groups as {
        label: string
        editor?: string
        sections?: { label: string; rows?: number; items: string[] }[]
      }[]
      const geometry = groups.find((g) => g.editor === 'template')!.sections!
      for (const section of geometry)
        section.items = section.items.filter((id) => !['leftWidth', 'rightWidth'].includes(id))
      geometry.push({ label: 'Field dimensions', rows: 2, items: ['rightWidth', 'leftWidth'] })
      groups.find((group) => group.editor === 'design')!.label = 'Route editing'
      await route.fulfill({ json: layouts })
    })
    await page.goto('/dev/forestry/road-design?example=training')
    await page.getByRole('button', { name: 'Open Ribbon', exact: true }).click()
    const ribbon = page.getByRole('region', { name: 'Command ribbon' })
    const pane = (name: string) => page.getByRole(width < 900 ? 'dialog' : 'complementary', { name, exact: true })
    const tabs = ribbon.getByRole('tablist', { name: 'Ribbon tabs' })
    const tab = (name: string) => tabs.getByRole('tab', { name, exact: true })
    await tab('Terrain').click()
    const datum = ribbon.getByRole('textbox', { name: 'Imported DEM vertical datum (metres)', exact: true })
    await datum.fill('Ribbon test datum')
    await tab('Route editing').click()
    await expect(page.locator('[data-pane="sidebar"]')).toBeHidden()
    const road = ribbon.getByRole('textbox', { name: 'Road name', exact: true })
    await road.fill('North spur')
    await tab('Section').click()
    const leftWidth = ribbon.getByRole('spinbutton', { name: 'Left half-width (m)', exact: true })
    await expect(
      ribbon.getByRole('group', { name: 'Field dimensions' }).getByRole('spinbutton', { name: 'Left half-width (m)' }),
    ).toBeVisible()
    await leftWidth.fill('4.2')
    await leftWidth.press('Enter')
    await expect(ribbon.locator('.lp-editor-slot')).toBeHidden()
    const compactHeight = (await ribbon.boundingBox())!.height
    expect(compactHeight).toBeLessThan(150)
    await ribbon.getByRole('button', { name: 'All settings' }).click()
    const sectionPane = pane('Section settings')
    await expect(sectionPane.getByRole('spinbutton', { name: 'Left half-width (m)', exact: true })).toHaveValue('4.2')
    await expect(ribbon.locator('.lp-editor-slot')).toBeHidden()
    await sectionPane.getByRole('button', { name: 'Template library & station assignments' }).click()
    const engineering = pane('Engineering settings')
    const inputs = engineering.getByRole('tablist', { name: 'Engineering inputs' })
    await inputs.getByRole('tab', { name: 'Ground' }).click()
    await engineering.getByRole('button', { name: 'Add ground material' }).click()
    await engineering.getByRole('textbox', { name: 'Ground material name' }).last().fill('Ribbon gravel')
    const closeForm = engineering.getByRole('button', { name: 'Close Engineering settings' })
    await closeForm.click()
    await expect(inputs).toBeHidden()
    await expect(tab('Engineering')).toHaveAttribute('aria-selected', 'true')
    await ribbon.getByRole('button', { name: 'All settings' }).click()
    await expect(inputs.getByRole('tab', { name: 'Ground' })).toHaveAttribute('aria-selected', 'true')
    await closeForm.click()
    await tab('Terrain').click()
    await expect(datum).toHaveValue('Ribbon test datum')
    await tab('Engineering').click()
    await ribbon.getByRole('spinbutton', { name: 'Cut ($/m³)', exact: true }).fill('23.5')
    await ribbon.getByRole('spinbutton', { name: 'Cut ($/m³)', exact: true }).press('Enter')
    await tab('File').click()
    await ribbon.getByRole('button', { name: 'Save and export', exact: true }).click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
    const stream = await (await pending).createReadStream()
    const chunks = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    const project = JSON.parse(Buffer.concat(chunks).toString())
    const activeRoad = project.alignments.find((a: { id: string }) => a.id === project.activeAlignmentId)
    expect(project.settings.cutRate).toBe(23.5)
    expect(activeRoad.name).toBe('North spur')
    expect(activeRoad.template.leftWidth).toBe(4.2)
    expect(activeRoad.engineering.materials).toContainEqual(expect.objectContaining({ name: 'Ribbon gravel' }))
    await page
      .getByRole('dialog', { name: 'Save & export' })
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await ribbon.getByRole('button', { name: 'Switch workspace interface' }).click()
    await page.getByRole('button', { name: 'Open Engineering workbench', exact: true }).click()
    const sidebar = page.getByRole('complementary', { name: 'Road design controls' })
    if (!(await sidebar.isVisible()))
      await page.getByRole('button', { name: 'Show road controls', exact: true }).click()
    await sidebar.getByRole('tab', { name: 'Engineering', exact: true }).click()
    await expect(sidebar.getByRole('tab', { name: 'Ground', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(sidebar.getByRole('textbox', { name: 'Ground material name' }).last()).toHaveValue('Ribbon gravel')
    await sidebar.getByRole('tab', { name: 'Design', exact: true }).click()
    await sidebar.getByRole('button', { name: /^Crossing screening allowances/ }).click()
    await sidebar.getByRole('textbox', { name: 'New cost group', exact: true }).fill('Unpriced crossing survey')
    await page.getByRole('button', { name: 'Switch workspace interface' }).click()
    await page.getByRole('button', { name: 'Open Ribbon', exact: true }).click()
    await tab('Route editing').click()
    await ribbon.getByRole('button', { name: 'All settings' }).click()
    const design = pane('Route editing settings')
    await expect(design.getByRole('textbox', { name: 'New cost group', exact: true })).toHaveValue(
      'Unpriced crossing survey',
    )
    await expect(design.getByRole('button', { name: 'Save cost group', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
