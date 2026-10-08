import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('a separate consumer calculates scores and renders map layers and story categories', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  for (const id of ['index-workspace', 'habitat-workspace']) {
    const state = page.getByTestId(id).getByTestId('map-state')
    await expect(state).toHaveAttribute('data-loaded', 'true')
    await expect(state).toHaveAttribute('data-fill-layers', '1')
  }
  await expect(page.locator('[data-index-lab-result="riverside"]')).toContainText('60.0')
  await page.getByRole('button', { name: 'Edit Park access weight', exact: true }).click()
  await page.getByLabel('Park access weight', { exact: true }).fill('20')
  await expect(page.locator('[data-index-lab-result="riverside"]')).toContainText('33.3')
  await expect
    .poll(async () =>
      Number(await page.getByTestId('index-workspace').getByTestId('map-state').getAttribute('data-riverside-score')),
    )
    .toBeCloseTo(1 / 3)
  await page.getByLabel('Search results', { exact: true }).fill('Riverside')
  await expect(page.locator('[data-index-lab-result]')).toHaveCount(1)
  await expect(page.locator('[data-index-lab-result="riverside"]')).toContainText('33.3')
  await page.getByRole('combobox', { name: 'Normalization', exact: true }).selectOption('percentile')
  await expect(page.locator('[data-index-lab-result="riverside"]')).toContainText('38.9')
  expect(
    await page
      .getByTestId('index-workspace')
      .locator('[data-map-sidebar-scroll]')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true)
  await page.getByLabel('Search results', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Woodland (7)' }).click()
  await expect(page.getByTestId('category-dots')).toHaveAttribute('data-selected-category', 'woodland')
  await page.getByRole('button', { name: 'Next image' }).click()
  await expect(page.getByRole('heading', { name: 'How to read this example' })).toBeVisible()
  expect(errors).toEqual([])
})

test('mobile cards and sheets belong to their embedded workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const index = page.getByTestId('index-workspace')
  const habitat = page.getByTestId('habitat-workspace')
  await expect(index.getByTestId('map-state')).toHaveAttribute('data-loaded', 'true')
  await expect(habitat.getByTestId('map-state')).toHaveAttribute('data-loaded', 'true')
  await page.getByRole('button', { name: 'Inspect Riverside' }).click()
  await expect(index.getByRole('button', { name: 'Close feature card' })).toBeVisible()
  await page.getByRole('button', { name: 'Inspect habitats', exact: true }).click()
  await expect(habitat.getByRole('button', { name: 'Close feature card' })).toBeVisible()
  await index.getByRole('button', { name: 'Close feature card' }).click()
  await expect(index.getByRole('button', { name: 'Close feature card' })).toHaveCount(0)
  await expect(habitat.getByRole('button', { name: 'Close feature card' })).toBeVisible()
  // A viewport-positioned card would extend outside this scrolling embedded host.
  const frame = await habitat.boundingBox()
  const card = await habitat.getByRole('button', { name: 'Close feature card' }).boundingBox()
  expect(frame).not.toBeNull()
  expect(card).not.toBeNull()
  expect(card!.y).toBeGreaterThanOrEqual(frame!.y)
  expect(card!.y + card!.height).toBeLessThanOrEqual(frame!.y + frame!.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('an embedded workspace responds to its own width and preserves selection across resize and theme changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  const index = page.getByTestId('index-workspace')
  const habitat = page.getByTestId('habitat-workspace')
  const state = index.getByTestId('map-state')
  await expect(state).toHaveAttribute('data-loaded', 'true')
  const canvas = await index.locator('.maplibregl-canvas').elementHandle()
  await expect(index.getByRole('separator', { name: 'Drag to resize sheet', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Inspect Riverside' }).click()
  await expect(index.getByRole('button', { name: 'Close feature card' })).toHaveCount(0)
  const broadWidth = Number(await state.getAttribute('data-map-width'))
  await page.getByRole('button', { name: 'Use compact map' }).click()
  await expect(index.getByRole('separator', { name: 'Drag to resize sheet', exact: true })).toBeVisible()
  await expect(index.getByRole('button', { name: 'Close feature card' })).toBeVisible()
  await expect.poll(async () => Number(await state.getAttribute('data-map-width'))).toBeLessThan(broadWidth)
  await expect(habitat.getByRole('button', { name: 'Close feature card' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Use dark theme' }).click()
  await expect(state).toHaveAttribute('data-background', '#182939')
  await expect(state).toHaveAttribute('data-fill-layers', '1')
  await expect(index.getByRole('button', { name: 'Close feature card' })).toBeVisible()
  await page.getByRole('button', { name: 'Use wide map' }).click()
  await expect(index.getByRole('separator', { name: 'Drag to resize sheet', exact: true })).toBeHidden()
  await expect(index.getByRole('button', { name: 'Close feature card' })).toHaveCount(0)
  await expect(index.locator('[data-index-lab-result="riverside"]')).toContainText('60.0')
  await expect.poll(async () => Number(await state.getAttribute('data-map-width'))).toBeGreaterThan(420)
  await page.getByRole('button', { name: 'Use light theme' }).click()
  await expect(state).toHaveAttribute('data-background', '#e5eef0')
  await expect(habitat.getByTestId('map-state')).toHaveAttribute('data-background', '#182939')
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true)
})

test('a scene project navigates layers and round-trips through injected storage and JSON transport', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const workspace = page.getByTestId('project-workspace')
  const story = workspace.locator('[data-active-scene-index]')
  const mapState = workspace.getByTestId('map-state')
  await expect(mapState).toHaveAttribute('data-loaded', 'true')
  await expect(story).toHaveAttribute('data-active-scene-index', '0')
  await expect(mapState).toHaveAttribute('data-visible-fill-layers', '1')
  const canvas = await workspace.locator('.maplibregl-canvas').elementHandle()
  await workspace.getByRole('button', { name: 'Habitat mosaic', exact: true }).click()
  await expect(story).toHaveAttribute('data-active-scene-index', '1')
  await expect.poll(async () => Number(await mapState.getAttribute('data-map-zoom'))).toBeCloseTo(5.8)
  await workspace.getByRole('button', { name: 'Shared view', exact: true }).click()
  await expect(story).toHaveAttribute('data-active-scene-index', '2')
  await expect(mapState).toHaveAttribute('data-visible-fill-layers', '2')
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true)

  await page.getByLabel('Project storage', { exact: true }).selectOption('browser')
  await page.getByLabel('Project title', { exact: true }).fill('Saved outdoor story')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(page.getByTestId('project-status')).toHaveText('Project saved.')
  await page.getByLabel('Project title', { exact: true }).fill('Unsaved local edits')
  await page.getByRole('button', { name: 'Load saved project', exact: true }).click()
  await expect(page.getByLabel('Project title', { exact: true })).toHaveValue('Saved outdoor story')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export project JSON', exact: true }).click()
  const artifact = await downloaded
  expect(artifact.suggestedFilename()).toBe('willow-bay-outdoor-story.json')
  const filename = await artifact.path()
  const document = JSON.parse(await readFile(filename!, 'utf8'))
  expect(document.title).toBe('Saved outdoor story')
  expect(document.scenes).toHaveLength(3)
  await page.getByLabel('Project title', { exact: true }).fill('Temporary replacement')
  await page.getByLabel('Import project JSON', { exact: true }).setInputFiles(filename!)
  await expect(page.getByTestId('project-status')).toHaveText('Project imported and saved.')
  await expect(page.getByLabel('Project title', { exact: true })).toHaveValue('Saved outdoor story')
  await page.reload()
  await page.getByLabel('Project storage', { exact: true }).selectOption('browser')
  await page.getByRole('button', { name: 'Load saved project', exact: true }).click()
  await expect(page.getByLabel('Project title', { exact: true })).toHaveValue('Saved outdoor story')
  expect(errors).toEqual([])
})

test('the complete editorial renderer owns chapter navigation and narrative map actions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const workspace = page.getByTestId('editorial-workspace')
  await workspace.scrollIntoViewIfNeeded()
  const content = workspace.getByTestId('native-editorial')
  const adapter = workspace.getByTestId('editorial-map')
  const chapters = workspace.getByRole('navigation', { name: 'Story chapters' })
  await expect(adapter.getByTestId('map-state')).toHaveAttribute('data-loaded', 'true')
  await workspace.getByRole('button', { name: 'Highlight woodland', exact: true }).click()
  await expect(content).toHaveAttribute('data-selected-category', 'woodland')
  await expect(adapter).toHaveAttribute('data-category', 'woodland')
  await workspace.getByRole('button', { name: 'Zoom to the woodland cells', exact: true }).click()
  await expect(adapter).toHaveAttribute('data-view-zoom', '7')
  await expect
    .poll(async () => Number(await adapter.getByTestId('map-state').getAttribute('data-map-zoom')))
    .toBeCloseTo(7)
  await chapters.getByRole('button', { name: 'Understand the source', exact: true }).click()
  await expect(chapters.getByRole('button', { name: 'Understand the source', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await chapters.getByRole('button', { name: 'Explore the observations', exact: true }).click()
  await workspace.getByRole('button', { name: 'Read how the observations were created', exact: true }).click()
  await expect(chapters.getByRole('button', { name: 'Understand the source', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const shell = workspace.locator('.editorial-document-root')
  expect(await shell.evaluate((node) => node.clientHeight)).toBeLessThanOrEqual(720)
  expect(errors).toEqual([])
})
