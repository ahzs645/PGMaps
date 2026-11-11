import { openWorkbench } from './road-workbench'
import { expect, test, type Page } from '@playwright/test'
import { corridorFrame } from '../../src/pages/dev-forestry-roads/corridorOptimizer'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'
import { openRoadPanel } from './road-sidebar'
import { choose } from './styled-select'

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
  await expect(page.getByLabel('Active road', { exact: true })).toHaveAttribute('data-value', project.activeAlignmentId)
}
async function prepare(
  page: Page,
  xy: Array<[number, number]> = [
    [0, 0],
    [100, 15],
    [200, 0],
  ],
) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  const show = page.getByRole('button', { name: 'Show road controls', exact: true })
  if (await show.isVisible()) await show.click()
  const project = await save(page)
  const frame = corridorFrame([-122.72, 53.89])
  const alignment = project.alignments[0]
  alignment.points = xy.map(([x, y], i) => ({ id: `edit-point-${i}`, coordinate: frame.fromXY([x, y]), radiusM: 0 }))
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
  await openRoadPanel(page, 'Horizontal points')
  await page.getByRole('button', { name: 'Select start', exact: true }).click()
  await expect(tools.getByRole('button', { name: 'Edit points', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Horizontal point 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByTestId('road-edit-help')).toContainText('Drag a +')
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
  // A click never changes the road, however many arrive.
  const handle = page.getByRole('button', { name: 'Add control between points 1 and 2', exact: true })
  for (let i = 0; i < 5; i++) await handle.click()
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText('Drag the +')
  expect(active(await save(page)).points).toHaveLength(3)
  // The keyboard has no way to drag, so Enter adds the point at the middle of the segment.
  await handle.focus()
  await page.keyboard.press('Enter')
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
  await choose(page.getByLabel('Active road', { exact: true }), original.id)
  expect((await save(page)).alignments.find((a) => a.id === original.id)).toEqual(original)
  expect(errors).toEqual([])
})

test('dragging a handle bends the road with a curve, and a small slip adds nothing', async ({ page }) => {
  await page.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  )
  await openWorkbench(page, '/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await page.getByRole('button', { name: 'Edit points', exact: true }).click()
  const points = page.getByRole('button', { name: /^Horizontal point \d+$/ })
  const before = await points.count()
  const pointsOf = (project: Awaited<ReturnType<typeof save>>) =>
    project.alignments.find((road) => road.id === project.activeAlignmentId)!.points
  const original = new Set(pointsOf(await save(page)).map((point) => point.id))
  const handle = page.getByRole('button', { name: /^Add control between points/ }).first()
  const pull = async (dx: number, dy: number) => {
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 6 })
    await page.mouse.up()
  }
  await pull(3, 2)
  await expect(points).toHaveCount(before)
  // Square off the road, so the bend opens a curve that fits: a pull back along the road can
  // fold it past what the minimum radius allows, which is refused (`plan-edit-limits.md`).
  const centre = async (locator: typeof handle) => {
    const box = (await locator.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const [from, to] = [
    await centre(handle),
    await centre(page.getByRole('button', { name: 'Horizontal point 2', exact: true })),
  ]
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  await pull(((from.y - to.y) / length) * 30, ((to.x - from.x) / length) * 30)
  // The status proves the drop was committed; a stuck drag preview would also draw one more point.
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText('Bend added')
  await expect(points).toHaveCount(before + 1)
  const added = pointsOf(await save(page)).find((point) => !original.has(point.id))!
  expect(added.radiusM).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Undo road edit', exact: true }).click()
  await expect(points).toHaveCount(before)
})

test('a drag that would make the road cross itself is refused before and after the drop', async ({ page }) => {
  const { errors, project } = await prepare(page, [
    [0, 0],
    [100, 15],
    [200, 0],
    [300, 15],
  ])
  const pointsOf = (p: RoadProject) => p.alignments.find((a) => a.id === p.activeAlignmentId)!.points
  await openRoadPanel(page, 'Horizontal points')
  await page.getByRole('button', { name: 'Select end', exact: true }).click()
  const centre = async (index: number) => {
    const box = (await page.getByRole('button', { name: `Horizontal point ${index}`, exact: true }).boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const [first, second, end] = [await centre(1), await centre(2), await centre(4)]
  // Just north of the first leg's middle: the last leg, swung back to there, crosses the first.
  const target = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 - 12 }
  await page.mouse.move(end.x, end.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 12 })
  await expect(page.locator('[data-plan-edit-refusal="crossing"]')).toContainText('Not allowed')
  await page.mouse.up()
  await expect(page.locator('[data-plan-edit-refusal]')).toHaveCount(0)
  await expect(page.getByTestId('road-workspace-header').getByRole('status')).toContainText('would cross itself')
  expect(pointsOf(await save(page))).toEqual(pointsOf(project))
  // The handle goes back to where the road still has it.
  const back = await centre(4)
  expect(Math.hypot(back.x - end.x, back.y - end.y)).toBeLessThan(3)
  expect(errors).toEqual([])
})
