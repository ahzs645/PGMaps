import { expect, test, type Page } from '@playwright/test'
import { corridorFrame } from '../../src/pages/dev-forestry-roads/corridorOptimizer'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', viewport: { width: 1512, height: 982 }, actionTimeout: 15000 })
test.setTimeout(120000)

async function save(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString())
}
async function open(page: Page, project: RoadProject) {
  const pending = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await (
    await pending
  ).setFiles({ name: 'editing.road.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect(page.getByLabel('Active road', { exact: true })).toHaveValue(project.activeAlignmentId)
}
async function prepare(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.click()
  const project = await save(page)
  const frame = corridorFrame([-122.72, 53.89])
  const alignment = project.alignments[0]
  alignment.points = [
    [0, 0],
    [100, 15],
    [200, 0],
  ].map(([x, y], i) => ({ id: `edit-point-${i}`, coordinate: frame.fromXY([x, y]), radiusM: 0 }))
  alignment.name = 'Editable original'
  alignment.vertical = []
  alignment.overrides = []
  delete alignment.engineering
  project.alignments = [alignment]
  project.activeAlignmentId = alignment.id
  project.context = []
  project.cables = []
  project.profiles = []
  await open(page, project)
  return { errors, project: await save(page) }
}
async function drag(page: Page, index: number, dx: number, dy: number) {
  const marker = page.getByRole('button', { name: `Horizontal point ${index}`, exact: true })
  await expect(marker).toBeVisible()
  const box = (await marker.boundingBox())!
  const hit = await marker.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return { receivesPointer: element.contains(target), target: target?.outerHTML.slice(0, 400), x: box.x, y: box.y }
  })
  expect(hit.receivesPointer, `Point ${index} must receive pointer events: ${JSON.stringify(hit)}`).toBe(true)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 })
  await page.mouse.up()
}

test('edit start/end, add and drag middle controls, and save separate editable paths', async ({ page }, info) => {
  const { errors, project } = await prepare(page)
  const original = project.alignments[0]
  const tools = page.getByRole('group', { name: 'Road map tool', exact: true })
  await expect(tools.getByRole('button', { name: 'Inspect', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Horizontal point 1', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Duplicate active alignment', exact: true }).click()
  const duplicated = await save(page)
  expect(duplicated.alignments).toHaveLength(2)
  expect(duplicated.activeAlignmentId).not.toBe(original.id)
  await page.getByRole('button', { name: 'Select start', exact: true }).click()
  await expect(tools.getByRole('button', { name: 'Edit points', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Horizontal point 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByTestId('road-edit-help')).toContainText('Click +')
  await drag(page, 1, 20, 25)
  const movedStart = await save(page)
  const active = (p: RoadProject) => p.alignments.find((a) => a.id === p.activeAlignmentId)!
  expect(active(movedStart).points[0].coordinate).not.toEqual(active(duplicated).points[0].coordinate)
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  expect(await save(page)).toEqual(duplicated)
  await page.getByRole('button', { name: 'Redo road edit', exact: true }).click()
  expect(await save(page)).toEqual(movedStart)

  await page.getByRole('button', { name: 'Select end', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Horizontal point 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await drag(page, 3, -20, 20)
  const movedEnd = await save(page)
  expect(active(movedEnd).points[2].coordinate).not.toEqual(active(movedStart).points[2].coordinate)
  await page.getByRole('button', { name: 'Add control between points 1 and 2', exact: true }).click()
  const inserted = await save(page)
  expect(active(inserted).points).toHaveLength(4)
  expect(active(inserted).points[0]).toEqual(active(movedEnd).points[0])
  expect(active(inserted).points[2]).toEqual(active(movedEnd).points[1])
  await expect(page.getByRole('button', { name: 'Horizontal point 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await drag(page, 2, 0, -25)
  const reshaped = await save(page)
  expect(active(reshaped).points[1].coordinate).not.toEqual(active(inserted).points[1].coordinate)
  expect(reshaped.alignments.find((a) => a.id === original.id)).toEqual(original)
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  expect(await save(page)).toEqual(inserted)
  await page.getByRole('button', { name: 'Redo road edit', exact: true }).click()
  expect(await save(page)).toEqual(reshaped)
  await page.screenshot({ path: info.outputPath('editable-road-controls.png'), fullPage: true })

  await tools.getByRole('button', { name: 'Inspect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Horizontal point 1', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add control between points 1 and 2', exact: true })).toHaveCount(0)
  await open(page, project)
  await open(page, reshaped)
  expect(await save(page)).toEqual(reshaped)
  await page.getByLabel('Active road', { exact: true }).selectOption(original.id)
  expect((await save(page)).alignments.find((a) => a.id === original.id)).toEqual(original)
  expect(errors).toEqual([])
})
