import { expect, test, type Download, type Locator, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { choose } from './styled-select'

const tabs = ['File', 'Terrain', 'Road', 'Section', 'Engineering', 'Review', 'View'] as const
const ribbon = (page: Page) => page.getByRole('region', { name: 'Command ribbon' })
const tablist = (page: Page) => ribbon(page).getByRole('tablist', { name: 'Ribbon tabs' })
const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true })

async function openRibbon(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  // The designer opens straight into the interface a link names; there is no chooser in front of it.
  await page.goto('/dev/forestry/road-design?interface=ribbon&example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
}

async function readDownload(download: Download) {
  const bytes: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) bytes.push(Buffer.from(chunk))
  return Buffer.concat(bytes).toString('utf8')
}

async function exportProject(page: Page): Promise<RoadProject> {
  const pending = page.waitForEvent('download')
  await button(ribbon(page), 'Save project file').click()
  return JSON.parse(await readDownload(await pending))
}

function tab(page: Page, name: string) {
  return tablist(page).getByRole('tab', { name, exact: true })
}

async function enter(field: Locator, value: string) {
  await field.fill(value)
  await field.press('Enter')
}

test('a forester maps a stream and an engineer revises a road, checks its section and exports the project', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openRibbon(page)
  const commands = ribbon(page)
  const baseline = await exportProject(page)

  await tab(page, 'Terrain').click()
  await button(commands, 'Draw stream').click()
  const canvas = page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas')
  const bounds = (await canvas.boundingBox())!
  for (const x of [0.38, 0.6]) await canvas.click({ position: { x: bounds.width * x, y: bounds.height * 0.5 } })
  const finish = page.getByRole('button', { name: 'Finish stream', exact: true })
  await expect(finish).toBeEnabled()
  await button(commands, 'Quick access: Undo point').click()
  await expect(finish).toBeDisabled()
  await canvas.click({ position: { x: bounds.width * 0.6, y: bounds.height * 0.5 } })
  await finish.click()

  await tab(page, 'Road').click()
  await button(commands, 'Duplicate road').click()
  const roadName = commands.getByRole('textbox', { name: 'Road name', exact: true })
  await enter(roadName, 'Creek crossing alternative')
  const grade = commands.locator('[data-field="maxGradePercent"]').getByRole('spinbutton')
  const initial = await grade.inputValue()
  const changed = initial === '9' ? '8' : '9'
  await enter(grade, changed)
  await button(commands, 'Undo').click()
  await expect(grade).toHaveValue(initial)
  await button(commands, 'Redo').click()
  await expect(grade).toHaveValue(changed)

  await tab(page, 'Section').click()
  await enter(commands.getByRole('spinbutton', { name: 'Ditch depth (m)', exact: true }), '0.8')
  await button(commands, 'Cross-section').click()
  await expect(page.getByTestId('road-section-chart')).toBeVisible()

  await tab(page, 'Engineering').click()
  await enter(commands.locator('[data-field="rainfallMmPerHr"]').getByRole('spinbutton'), '63')
  await button(commands, 'Drainage').click()
  await expect(page.getByTestId('road-drainage')).toBeVisible()

  await tab(page, 'Review').click()
  await button(commands, 'Vehicle swept path').click()
  await expect(page.getByTestId('road-swept-path')).toBeVisible()
  await button(commands, 'Field notes').click()
  const notes = page.getByRole('toolbar', { name: 'Map notes', exact: true })
  await button(notes, 'Pin').click()
  await expect(canvas).toHaveCSS('cursor', 'crosshair')
  const plan = (await canvas.boundingBox())!
  await canvas.click({ position: { x: plan.width * 0.35, y: plan.height * 0.4 } })
  await page.getByLabel('Note text', { exact: true }).fill('Field visit: survey the stream banks.')
  await page.getByRole('button', { name: 'Close note', exact: true }).click()

  await tab(page, 'View').click()
  const contours = button(commands, 'Contours')
  const initialContourState = await contours.getAttribute('aria-pressed')
  expect(initialContourState).toMatch(/^(true|false)$/)
  await contours.click()
  await expect(contours).toHaveAttribute('aria-pressed', initialContourState === 'true' ? 'false' : 'true')

  await tab(page, 'File').click()
  const project = await exportProject(page)
  expect(project.alignments).toHaveLength(baseline.alignments.length + 1)
  expect(project.settings.maxGradePercent).toBe(Number(changed))
  expect(project.drainage?.settings.rainfallMmPerHr).toBe(63)
  expect(project.notes).toContainEqual(
    expect.objectContaining({ kind: 'pin', text: 'Field visit: survey the stream banks.' }),
  )
  expect(project.alignments.find((road) => road.id === project.activeAlignmentId)).toMatchObject({
    name: 'Creek crossing alternative',
    template: { ditchDepth: 0.8 },
  })
  const previousIds = new Set(baseline.context.map((feature) => feature.id))
  expect(project.context.filter((feature) => !previousIds.has(feature.id))).toMatchObject([
    { kind: 'stream', geometry: { type: 'LineString', coordinates: [expect.any(Array), expect.any(Array)] } },
  ])
  expect(errors).toEqual([])
})

test.describe('field navigation', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  test('the finder opens a configured group setting with keyboard focus, shared edits and undo', async ({ page }) => {
    test.setTimeout(60_000)
    await page.route('**/workspace-layouts.json', async (route) => {
      const layouts = await (await route.fetch()).json()
      const configured = layouts.find((layout: { id: string }) => layout.id === 'ribbon')
      const groups = configured.toolbar.groups as {
        label: string
        sections: { label: string; items: string[]; more?: string[] }[]
      }[]
      const moved = ['rainfallMmPerHr', 'loadedDirection']
      for (const group of groups) {
        for (const section of group.sections) {
          section.items = section.items.filter((id) => !moved.includes(id))
          if (section.more) section.more = section.more.filter((id) => !moved.includes(id))
        }
      }
      groups
        .find((group) => group.label === 'Terrain')!
        .sections.push({
          label: 'Field storm assumptions',
          items: [],
          more: moved,
        })
      await route.fulfill({ json: layouts })
    })
    await openRibbon(page)
    const commands = ribbon(page)
    await tab(page, 'File').focus()
    for (const [index, name] of tabs.entries()) {
      if (index) await page.keyboard.press('ArrowRight')
      const current = tab(page, name)
      await expect(current).toHaveAttribute('aria-selected', 'true')
      await expect(current).toBeFocused()
      await expect(current).toBeInViewport()
      await expect(commands.getByRole('tabpanel', { name, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await page.keyboard.press('Alt+q')
    const finder = page.getByRole('dialog', { name: 'Find ribbon tools' })
    const search = finder.getByRole('combobox', { name: 'Search ribbon tools' })
    await expect(search).toBeFocused()
    await search.fill('Field storm rainfall')
    const result = finder.getByRole('option', { name: /rainfall/i })
    await expect(result).toContainText('Field storm assumptions')
    await search.press('Enter')
    await expect(finder).toBeHidden()
    const launcher = button(commands, 'Open Field storm assumptions settings')
    const settings = page.getByRole('dialog', { name: 'Field storm assumptions settings' })
    const field = settings.getByRole('spinbutton', { name: 'Rainfall (mm/h)' })
    await expect(settings).toBeInViewport()
    expect(
      await settings.evaluate((node) => node.matches(':modal') || node.getAttribute('aria-modal') === 'true'),
    ).toBe(true)
    const rightInset = await page
      .getByTestId('road-workspace')
      .evaluate((node) => parseFloat(getComputedStyle(node).paddingRight))
    await expect
      .poll(() => settings.evaluate((node) => innerWidth - node.getBoundingClientRect().right))
      .toBeCloseTo(rightInset, 0)
    await expect(field).toBeFocused()
    await expect(field).toBeInViewport()
    const initial = await field.inputValue()
    await choose(settings.getByRole('combobox', { name: 'Loaded trucks travel' }), 'end-to-start')
    await expect(settings).toBeVisible()
    await enter(field, '71')
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(tab(page, 'Terrain')).toHaveAttribute('aria-selected', 'true')
    await expect(launcher).toBeFocused()
    await launcher.press('Enter')
    await expect(field).toHaveValue('71')
    await button(settings, 'Close Field storm assumptions settings').click()
    await tab(page, 'File').tap()
    const saved = await exportProject(page)
    expect(saved.drainage?.settings.rainfallMmPerHr).toBe(71)
    expect(saved.standards?.loadedDirection).toBe('end-to-start')
    // On a phone the interface switch is in the tab row's More menu.
    await button(commands, 'More workspace commands').tap()
    await page.getByRole('menuitem', { name: 'Switch interface' }).tap()
    await page.getByRole('button', { name: 'Open Engineering workbench', exact: true }).tap()
    await page.getByRole('button', { name: 'Undo road edit', exact: true }).tap()
    await page.getByRole('button', { name: 'Switch workspace interface' }).tap()
    await page.getByRole('button', { name: 'Open Ribbon', exact: true }).tap()
    await tab(page, 'Terrain').tap()
    await launcher.tap()
    await expect(field).toHaveValue(initial)
  })

  test('the mobile ribbon exposes offscreen tools and can give space back to the map', async ({ page }) => {
    await openRibbon(page)
    await tab(page, 'Terrain').tap()
    const commands = ribbon(page)
    const next = button(commands, 'Next ribbon tools')
    await expect(next).toBeInViewport()
    const firstGroup = commands.getByRole('tabpanel').getByRole('group').first()
    const before = (await firstGroup.boundingBox())!.x
    await next.tap()
    await expect.poll(async () => (await firstGroup.boundingBox())!.x).toBeLessThan(before - 75)
    await expect(button(commands, 'Previous ribbon tools')).toBeInViewport()
    const map = page.getByTestId('road-plan-view')
    const expanded = (await map.boundingBox())!.height
    await button(commands, 'Minimize ribbon').tap()
    await expect.poll(async () => (await map.boundingBox())!.height - expanded).toBeGreaterThan(45)
    await expect(tablist(page)).toBeInViewport()
    await button(commands, 'Show ribbon tools').tap()
    await expect(commands.getByRole('tabpanel', { name: 'Terrain' })).toBeVisible()
  })

  test('a forester draws a stream and inspects the cross-section on a landscape phone', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await openRibbon(page)
    const commands = ribbon(page)
    await expect(button(commands, 'Show ribbon tools')).toBeVisible()
    await tab(page, 'Terrain').tap()
    await button(commands, 'Draw stream').tap()
    await expect(button(commands, 'Show ribbon tools')).toBeVisible()
    const map = page.getByTestId('road-plan-view').locator('canvas.maplibregl-canvas')
    const box = (await map.boundingBox())!
    expect(box.height).toBeGreaterThan(120)
    for (const x of [0.38, 0.57]) await map.tap({ position: { x: box.width * x, y: box.height * 0.53 } })
    const finish = page.getByRole('button', { name: 'Finish stream', exact: true })
    await expect(finish).toBeEnabled()
    await finish.tap()
    await expect(finish).toBeHidden()
    await tab(page, 'Section').tap()
    await button(commands, 'Cross-section').tap()
    await expect(button(commands, 'Show ribbon tools')).toBeVisible()
    await expect(page.getByTestId('road-section-chart')).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
})

test('the finder respects the available work in an access investigation and an empty road design', async ({ page }) => {
  await openRibbon(page)
  const study = await exportProject(page)
  const placeholder = study.alignments[0]
  study.workspaceMode = 'access-investigation'
  study.alignments = [placeholder]
  study.activeAlignmentId = placeholder.id
  study.investigation = { openingId: '12345', draftAlignmentId: placeholder.id }

  const chooser = page.waitForEvent('filechooser')
  await button(ribbon(page), 'Open project file').click()
  await (
    await chooser
  ).setFiles({
    name: 'field-study.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(study)),
  })
  const workspace = page.getByTestId('road-workspace')
  await expect(workspace).toHaveAttribute('data-workspace-mode', 'access-investigation')
  await expect(tab(page, 'Engineering')).toHaveCount(0)
  const find = button(ribbon(page), 'Find tools')
  await find.click()
  const dialog = page.getByRole('dialog', { name: 'Find ribbon tools' })
  const search = dialog.getByRole('combobox', { name: 'Search ribbon tools' })
  await search.fill('Duplicate road')
  await expect(dialog.getByRole('status')).toHaveText('No matching ribbon tools.')
  await search.fill('Survey field book')
  await expect(dialog.getByRole('status')).toHaveText('No matching ribbon tools.')
  await search.fill('Start design')
  await search.press('Enter')
  await expect(workspace).toHaveAttribute('data-workspace-mode', 'design')
  await find.click()
  await search.fill('Duplicate road')
  const unavailable = dialog.getByRole('option', { name: /duplicate road/i })
  await expect(unavailable).toHaveAttribute('aria-disabled', 'true')
  await search.press('Enter')
  await expect(dialog).toBeVisible()
  await search.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(find).toBeFocused()
})

test('typing a multi-digit design limit or design speed preserves associated engineering inputs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openRibbon(page)
  const commands = ribbon(page)
  const field = (id: string) => commands.locator(`[data-field="${id}"]`).getByRole('spinbutton')
  await tab(page, 'Road').click()
  await enter(field('maxGradePercent'), '15')
  await tab(page, 'Review').click()
  await commands.getByRole('combobox', { name: 'Loaded trucks travel' }).click()
  await page.getByRole('option', { name: 'Toward the road end', exact: true }).click()
  await enter(field('adverseGradePercent'), '8')
  await tab(page, 'Road').click()
  const grade = field('maxGradePercent')
  await grade.fill('')
  await grade.pressSequentially('20')
  await grade.press('Enter')
  await tab(page, 'Review').click()
  await expect(field('adverseGradePercent')).toHaveValue('8')

  await tab(page, 'Section').click()
  const speed = field('curveDesignSpeedKmh')
  await enter(speed, '50')
  const curveLauncher = button(commands, 'Open Curve widening settings')
  const curveSettings = page.getByRole('complementary', { name: 'Curve widening settings' })
  const superelevation = curveSettings.getByRole('spinbutton', { name: 'Max superelevation (%)' })
  const runoff = curveSettings.getByRole('spinbutton', { name: 'Runoff (m)', exact: true })
  await curveLauncher.click()
  const plan = page.getByTestId('road-plan-view')
  await expect(curveSettings).toBeInViewport()
  await expect(plan).toBeInViewport()
  const planBox = (await plan.boundingBox())!
  const paneBox = (await curveSettings.boundingBox())!
  expect(planBox.width).toBeGreaterThan(300)
  expect(planBox.x + planBox.width).toBeLessThanOrEqual(paneBox.x + 1)
  await plan.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(curveSettings).toBeVisible()
  await enter(superelevation, '6')
  await enter(runoff, '55')
  await button(curveSettings, 'Close Curve widening settings').click()
  await speed.fill('')
  await speed.pressSequentially('65')
  await speed.press('Enter')
  await curveLauncher.click()
  await expect(superelevation).toHaveValue('6')
  await expect(runoff).toHaveValue('55')
  await button(curveSettings, 'Close Curve widening settings').click()
  await tab(page, 'File').click()
  const project = await exportProject(page)
  expect(project.settings.maxGradePercent).toBe(20)
  expect(project.standards?.adverseGradePercent).toBe(8)
  expect(project.alignments.find((road) => road.id === project.activeAlignmentId)?.curveDesign).toMatchObject({
    designSpeedKmh: 65,
    maxSuperelevationPercent: 6,
    runoffLengthM: 55,
  })
})

test('a configured survey shortcut downloads stakeout coordinates from another tab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/workspace-layouts.json', async (route) => {
    const layouts = await (await route.fetch()).json()
    const toolbar = layouts.find((layout: { id: string }) => layout.id === 'ribbon').toolbar
    toolbar.quickAccess = ['stakeout']
    const documents = toolbar.groups
      .find((group: { label: string }) => group.label === 'File')
      .sections.find((section: { items: string[] }) => section.items.includes('stakeout'))
    documents.primary = 'stakeout'
    await route.fulfill({ json: layouts })
  })
  await openRibbon(page)
  const commands = ribbon(page)
  await expect(button(commands, 'Stakeout CSV')).toHaveAttribute('data-primary', 'true')
  await tab(page, 'Road').click()
  const shortcuts = commands.getByRole('group', { name: 'Quick access' })
  await expect(shortcuts.getByRole('button')).toHaveCount(1)
  await button(shortcuts, 'Quick access: Stakeout CSV').click()
  const preview = page.getByRole('region', { name: 'Stakeout preview' })
  await expect(preview).toBeVisible()
  const downloading = page.waitForEvent('download')
  await button(preview, 'Download Stakeout').click()
  const file = await downloading
  expect(file.suggestedFilename()).toMatch(/\.csv$/)
  const [header, ...rows] = (await readDownload(file)).trim().split(/\r?\n/)
  expect(header).toContain('easting,northing,elevation_m')
  expect(rows.length).toBeGreaterThan(2)
  for (const row of rows) {
    const [, , , , easting, northing] = row.split(',')
    expect(Number(easting)).toBeGreaterThan(0)
    expect(Number(northing)).toBeGreaterThan(0)
  }
})

test('Find tools opens a live workflow section, an export from the catalog, and a shared map control', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openRibbon(page)
  const find = button(ribbon(page), 'Find tools')
  const finder = page.getByRole('dialog', { name: 'Find ribbon tools' })
  async function pick(text: string) {
    await find.click()
    await finder.getByRole('combobox').fill(text)
    const result = finder.getByRole('option').filter({ has: page.getByText(text, { exact: true }) })
    await expect(result).toHaveCount(1)
    await result.click()
  }

  await pick('Survey field book')
  const settings = page.getByRole('complementary', { name: 'Terrain settings', exact: true })
  const survey = settings.getByRole('button', { name: /^Survey field book/ })
  await expect(survey).toHaveAttribute('aria-expanded', 'true')
  await expect(survey).toBeFocused()
  await expect(survey).toBeInViewport()
  await button(settings, 'Close Terrain settings').click()

  await pick('Station CSV')
  await expect(page.getByRole('region', { name: 'Station CSV preview' })).toBeVisible()
  await page.keyboard.press('Escape')
  await pick('Map legend')
  const map = page.getByTestId('road-plan-view')
  await expect(button(map, 'Collapse legend')).toBeVisible()
  await button(map, 'Collapse legend').click()
  await tab(page, 'View').click()
  await button(ribbon(page), 'Open Map layers settings').click()
  const layers = page.getByRole('complementary', { name: 'Map layers settings' })
  await expect(button(layers, 'Map legend')).toHaveAttribute('aria-pressed', 'false')
  await choose(layers.getByRole('combobox', { name: 'Terrain display' }), 'slope')
  await expect(map.getByRole('combobox', { name: 'Terrain display' })).toHaveAttribute('data-value', 'slope')
  await button(layers, 'Map display settings').click()
  await expect(page.getByRole('dialog', { name: 'Map display settings' })).toBeVisible()
})
