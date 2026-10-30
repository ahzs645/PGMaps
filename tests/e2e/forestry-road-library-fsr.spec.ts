import { expect, test, type Page } from '@playwright/test'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

test.use({ serviceWorkers: 'block', actionTimeout: 20_000, viewport: { width: 1512, height: 982 } })
test.setTimeout(120_000)

const IDS = {
  original: 'training-full-cost-short-a',
  armA: 'training-full-cost-arm-a',
  upper: 'training-full-cost-upper',
  armB: 'training-full-cost-arm-b',
}

async function exportProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  const stream = await (await pending).createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RoadProject
}

/** Read the actual map source so the regression also verifies the selected destination preview. */
async function destinationOverlay(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="road-plan-view"] .maplibregl-map')
    if (!container) return null
    const key = Object.keys(container).find((name) => name.startsWith('__reactFiber$'))
    if (!key) return null
    type Map = import('maplibre-gl').Map
    type Hook = { memoizedState?: { current?: Map } | Map; next?: Hook }
    type Fiber = { memoizedState?: Hook; return?: Fiber }
    let fiber = (container as unknown as Record<string, Fiber>)[key]
    for (let depth = 0; fiber && depth < 200; depth++, fiber = fiber.return!) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 40; hook = hook.next, count++) {
        const value = hook.memoizedState
        const map =
          value && typeof value === 'object' && 'current' in value ? value.current : (value as Map | undefined)
        if (typeof map?.getTerrain !== 'function') continue
        const source = map.getSource('road-overlay')
        return source?.type === 'geojson'
          ? (source.serialize().data as GeoJSON.FeatureCollection).features.filter((feature) =>
              ['reviewed-existing-road', 'fsr-target'].includes(String(feature.properties?.kind)),
            )
          : []
      }
    }
    return null
  })
}

test('the connected-access library scenario previews and generates a chosen FSR connection offline', async ({
  page,
  baseURL,
}) => {
  const publicDataRequests: string[] = []
  const appOrigin = new URL(baseURL!).origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'basemaps.cartocdn.com')
      return route.fulfill({ json: { version: 8, sources: {}, layers: [] } })
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== appOrigin) {
      publicDataRequests.push(url.toString())
      return route.abort()
    }
    return route.continue()
  })
  await page.goto('/dev/forestry/road-design?example=training')
  await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).click()
  await page
    .getByRole('button', { name: 'Load Training · connected access, gravel and condition', exact: true })
    .click()
  const active = page.getByRole('combobox', { name: 'Active road', exact: true, includeHidden: true })
  await expect(active).toHaveValue(IDS.original)
  const before = await exportProject(page)
  const original = before.alignments.find((alignment) => alignment.id === IDS.original)!
  const target = before.context.find((feature) => feature.id === IDS.armB)!
  if (target.geometry.type !== 'LineString') throw Error('The training B arm must be a mapped line.')
  const expectedJunction = target.geometry.coordinates.at(-1)!
  expect(target.roadEvidence?.roadClass).toBe('fsr')

  await page
    .getByRole('tablist', { name: 'Road workflow', exact: true })
    .getByRole('tab', { name: 'Design', exact: true })
    .click()
  const tools = page.getByTestId('road-route-tools')
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  const fsr = page.getByTestId('road-fsr-connection')
  // Both initial roads already end at the U network. Start from their common block instead.
  await fsr.getByRole('combobox', { name: 'Connect from', exact: true }).selectOption('start')
  await fsr.getByRole('button', { name: 'Find nearby FSRs', exact: true }).click()
  const picker = fsr.getByRole('combobox', { name: 'FSR to connect to', exact: true })
  await expect(picker.locator('option')).toHaveCount(4)
  for (const id of [IDS.armA, IDS.upper, IDS.armB])
    await expect(picker.locator(`option[value="${id}"]`)).toHaveText(/Synthetic/)
  await expect(fsr).toContainText('The search used the loaded synthetic scenario FSR network.')
  await picker.selectOption(IDS.armB)
  await expect(page.getByTestId('road-fsr-selected-target')).toContainText(target.name)
  await expect
    .poll(
      async () =>
        (await destinationOverlay(page))?.find((feature) => feature.properties?.kind === 'reviewed-existing-road')
          ?.geometry,
    )
    .toEqual(target.geometry)
  await expect
    .poll(
      async () =>
        (await destinationOverlay(page))?.find((feature) => feature.properties?.kind === 'fsr-target')?.geometry,
    )
    .toEqual({ type: 'Point', coordinates: expectedJunction })
  await expect(active.locator('option')).toHaveCount(2)
  await expect(
    fsr.getByRole('checkbox', { name: 'Use regional terrain across connection (screening)' }),
  ).not.toBeChecked()
  await fsr.getByRole('button', { name: 'Connect to selected FSR', exact: true }).click()
  await expect(active.locator('option')).toHaveCount(3)
  const after = await exportProject(page)
  const generated = after.alignments.find((alignment) => alignment.id === after.activeAlignmentId)!
  expect(generated.fsrConnection).toMatchObject({
    targetFeatureId: IDS.armB,
    targetName: target.name,
    preference: 'chosen',
    endpoint: 'start',
    originAlignmentId: IDS.original,
    originCoordinate: original.points[0].coordinate,
  })
  expect(generated.points[0].coordinate).toEqual(original.points[0].coordinate)
  expect(generated.points.at(-1)!.coordinate).toEqual(expectedJunction)
  expect(generated.points.at(-1)!.coordinate).toEqual(generated.fsrConnection!.targetCoordinate)
  expect(generated.fsrConnection!.straightLineDistanceM).toBeGreaterThan(390)
  expect(generated.fsrConnection!.straightLineDistanceM).toBeLessThan(410)
  expect(after.alignments.slice(0, 2)).toEqual(before.alignments)
  expect(after.context).toEqual(before.context)
  expect(after.terrain).toEqual(before.terrain)
  await expect(page.getByTestId('road-fsr-connection-record')).toContainText(`Recorded FSR connection: ${target.name}`)
  await expect
    .poll(
      async () =>
        (await destinationOverlay(page))?.find((feature) => feature.properties?.kind === 'fsr-target')?.geometry,
    )
    .toEqual({ type: 'Point', coordinates: generated.points.at(-1)!.coordinate })
  expect(publicDataRequests).toEqual([])
})
