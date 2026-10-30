import { expect, test, type Page } from '@playwright/test'
import { ROAD_SCENARIOS } from '../../src/pages/dev-forestry-roads/scenarios'
import type { RoadProject } from '../../src/pages/dev-forestry-roads/types'

// Deliberately uses each scenario's actual terrain provider. Offline tests remain separate.
test.skip(
  process.env.PGMAPS_ROAD_REFERENCE_LIVE !== '1',
  'Set PGMAPS_ROAD_REFERENCE_LIVE=1 for all nine real-source/mobile scenarios.',
)
test.use({
  serviceWorkers: 'block',
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  actionTimeout: 30_000,
})
test.setTimeout(300_000)

async function exportedProject(page: Page): Promise<RoadProject> {
  await page.getByRole('button', { name: 'Save', exact: true }).tap()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).tap()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page
    .getByRole('dialog', { name: 'Save & export', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap()
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function containment(page: Page) {
  return page.evaluate(() => {
    const main = document.getElementById('main-content')!
    const root = document.documentElement
    return [main, root].flatMap((el) => [
      ...(el.scrollWidth > el.clientWidth + 1 ? [`horizontal overflow ${el.scrollWidth - el.clientWidth}px`] : []),
      ...(el.scrollHeight > el.clientHeight + 1 ? [`vertical overflow ${el.scrollHeight - el.clientHeight}px`] : []),
    ])
  })
}

for (const scenario of ROAD_SCENARIOS) {
  test(`reference scenario ${scenario.id}: actual terrain, mobile panes and project handoff`, async ({
    page,
  }, info) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
    )
    await page.goto('/dev/forestry/road-design?example=training')
    await expect(page.getByTestId('road-map-ready')).toHaveAttribute('data-ready', 'true')
    await page.getByRole('button', { name: 'Projects', exact: true }).tap()
    await page.getByRole('button', { name: /Browse \d+ example scenarios/ }).tap()
    await page.getByRole('button', { name: `Load ${scenario.name}`, exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled({ timeout: 180_000 })
    const project = await exportedProject(page)
    expect(project.scenario?.id).toBe(scenario.id)
    expect(project.alignments.length).toBeGreaterThan(0)
    expect(project.terrain.kind).toBe(
      scenario.kind === 'training' ? 'demo' : scenario.kind === 'regional' ? 'regional' : 'geotiff',
    )
    expect(project.scenario?.terrainCoveragePercent).toBe(100)

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport)
      const showControls = page.getByRole('button', { name: 'Show road controls', exact: true })
      if (await showControls.isVisible()) {
        await showControls.tap()
        const tabs = page.getByRole('tablist', { name: 'Road workflow', exact: true })
        for (const label of ['Terrain', 'Design', 'Section', 'Review']) {
          const tab = tabs.getByRole('tab', { name: label, exact: true })
          if (await tab.count()) {
            await tab.tap()
            await expect(tab).toHaveAttribute('aria-selected', 'true')
          }
        }
        const hide = page.getByRole('button', { name: 'Hide road controls', exact: true })
        if (await hide.isVisible()) await hide.tap()
      }
      const paneTabs = page.getByRole('tablist', { name: 'Visible road pane', exact: true })
      for (const [label, chart] of [
        ['Plan', 'road-plan-view'],
        ['Profile', 'road-profile-chart'],
        ['Detail', 'road-section-chart'],
      ]) {
        const paneTab = paneTabs.getByRole('tab', { name: label, exact: true })
        await paneTab.tap()
        await expect(paneTab).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByTestId(chart)).toBeVisible()
        const rect = await page.getByTestId(chart).boundingBox()
        expect(rect!.width).toBeGreaterThan(100)
        expect(rect!.height).toBeGreaterThan(30)
        await expect.poll(() => containment(page)).toEqual([])
      }
      const planTab = paneTabs.getByRole('tab', { name: 'Plan', exact: true })
      await planTab.tap()
      await expect(planTab).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('road-connected-layout')).toHaveAttribute('data-focused-pane', 'plan')
      await page.screenshot({
        path: info.outputPath(`${scenario.id}-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
        timeout: 60_000,
      })
    }
    const after = await exportedProject(page)
    expect(after).toEqual(project)
    await info.attach('project.json', { body: JSON.stringify(after), contentType: 'application/json' })
    expect(errors).toEqual([])
  })
}
