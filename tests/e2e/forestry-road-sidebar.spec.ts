import { expect, test, type Locator, type Page } from '@playwright/test'
import { createDemoProject } from '../../src/pages/dev-forestry-roads/terrain'
import { createEngineeringDesign } from '../../src/pages/dev-forestry-roads/engineeringTypes'
import { createSurfacingSupply } from '../../src/pages/dev-forestry-roads/gravel'

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 })
test.setTimeout(180_000)

const longName = 'VeryLongForestryPlanningReferenceWithoutSpaces'.repeat(4)

function longNameProject() {
  const project = createDemoProject()
  project.terrain.name = longName
  project.terrain.verticalReference = longName
  for (const feature of project.context) feature.name = longName
  for (const alignment of project.alignments) {
    alignment.name = longName
    for (const widening of alignment.overrides) widening.name = longName
    alignment.engineering = {
      ...createEngineeringDesign(),
      templates: [{ id: 'long-template', name: longName, template: alignment.template }],
      materials: [
        {
          id: 'long-material',
          name: longName,
          color: '#a16207',
          cutRate: 12,
          reusableFraction: 1,
          compactionFactor: 0.9,
        },
      ],
      culverts: [
        {
          id: 'long-culvert',
          name: longName,
          chainage: 100,
          skewDegrees: 0,
          lengthM: 12,
          diameterM: 0.8,
          inletInvertM: null,
          outletInvertM: null,
          minCoverM: 0.6,
          unitCost: 0,
          fixedCost: 0,
        },
      ],
      surfacingSupply: {
        ...createSurfacingSupply(),
        enabled: true,
        name: longName,
        sourceNotes: `https://example.invalid/${longName}`,
      },
    }
  }
  return project
}

async function openProject(page: Page) {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByTestId('road-file-input').setInputFiles({
    name: 'long-names.road.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(longNameProject())),
  })
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.click()
  return page.getByRole('complementary', { name: 'Road design controls', exact: true })
}

async function expandSections(sidebar: Locator) {
  for (const details of await sidebar.locator('details:not([open])').all()) {
    if (await details.isVisible()) await details.locator(':scope > summary').click()
  }
  for (const toggle of await sidebar
    .locator('button[aria-controls][aria-expanded="false"]:not([aria-haspopup])')
    .all()) {
    if (await toggle.isVisible()) await toggle.click()
  }
}

async function expectContained(sidebar: Locator, label: string) {
  const content = sidebar.getByTestId('road-sidebar-content')
  const metrics = await content.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    element.scrollLeft = 10000
    const outside = [...element.querySelectorAll<HTMLElement>('input,select,textarea,button')]
      .filter((control) => {
        const box = control.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && (box.left < rect.left - 1 || box.right > rect.right + 1)
      })
      .map((control) => ({
        tag: control.tagName,
        name: control.getAttribute('aria-label') || control.textContent?.slice(0, 100),
        width: control.getBoundingClientRect().width,
      }))
    const clippedButtons = [...element.querySelectorAll('button')]
      .filter((button) => button.getClientRects().length && button.scrollHeight > button.clientHeight + 1)
      .map((button) => button.textContent?.slice(0, 100))
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      outside,
      clippedButtons,
    }
  })
  expect(metrics, label).toMatchObject({ scrollLeft: 0, outside: [], clippedButtons: [] })
  expect(metrics.scrollWidth, `${label}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.clientWidth + 1)
}

for (const viewport of [
  { width: 1512, height: 982 },
  { width: 320, height: 844 },
  { width: 390, height: 844 },
]) {
  test(`sidebar controls fit ${viewport.width === 1512 ? 'a 240 px desktop pane' : `${viewport.width} px phone`} with long names and expanded sections`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const sidebar = await openProject(page)
    if (viewport.width === 1512) {
      const separator = page.getByRole('separator', { name: 'Resize road controls and connected views', exact: true })
      for (let count = 0; count < 3; count++) await separator.press('Shift+ArrowLeft')
      await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(240, 0)
    }
    const workflow = sidebar.getByRole('tablist', { name: 'Road workflow', exact: true })
    expect(await workflow.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await expect(workflow.getByRole('tab', { name: 'Engineering', exact: true })).toHaveAttribute(
      'title',
      'Engineering',
    )
    const overlappingLabels = await workflow.getByRole('tab').evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const box = button.getBoundingClientRect()
          const label = button.querySelector(':scope > span')?.getBoundingClientRect()
          return label && (label.left < box.left - 1 || label.right > box.right + 1)
        })
        .map((button) => button.textContent),
    )
    expect(overlappingLabels).toEqual([])
    for (const tabName of ['Terrain', 'Design', 'Section', 'Engineering', 'Review']) {
      await workflow.getByRole('tab', { name: tabName, exact: true }).click()
      await expandSections(sidebar)
      if (tabName === 'Design') {
        for (const [name, visible] of [
          ['PVI 1 station', 'Station'],
          ['PVI 1 level', 'Level'],
          ['PVI 1 curve', 'Curve length (m)'],
        ]) {
          await expect(sidebar.getByRole('spinbutton', { name, exact: true }).locator('..')).toHaveText(visible)
        }
      }
      if (tabName === 'Engineering') {
        const engineering = sidebar.getByRole('tablist', { name: 'Engineering inputs', exact: true })
        for (const name of ['Templates', 'Ground', 'Drainage', 'Haul']) {
          await engineering.getByRole('tab', { name, exact: true }).click()
          await expandSections(sidebar)
          await expectContained(sidebar, `${viewport.width} Engineering/${name}`)
        }
      }
      await expectContained(sidebar, `${viewport.width} ${tabName}`)
    }
    await sidebar.getByTestId('road-sidebar-content').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({ path: `/tmp/road-sidebar-${viewport.width}.png` })
  })
}

test('phone map icons switch inspection and point editing without reopening the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await openProject(page)
  await page.getByRole('button', { name: 'Hide road controls', exact: true }).click()
  const tools = page.getByRole('group', { name: 'Road map tool', exact: true })
  await expect(tools).toHaveCount(1)
  const inspect = tools.getByRole('button', { name: 'Inspect', exact: true })
  const edit = tools.getByRole('button', { name: 'Edit points', exact: true })
  await expect(inspect).toHaveAttribute('aria-pressed', 'true')
  await expect(inspect).toHaveAttribute('title', /Inspect/)
  await expect(edit).toHaveAttribute('title', /Edit points/)
  for (const button of [inspect, edit]) {
    await expect(button).toHaveText('')
    await expect(button.locator('svg')).toHaveCount(1)
    const box = await button.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  }
  await edit.click()
  await expect(edit).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Show road controls', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Horizontal point 1', exact: true })).toBeVisible()
  await inspect.click()
  await expect(inspect).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Horizontal point 1', exact: true })).toHaveCount(0)
})
