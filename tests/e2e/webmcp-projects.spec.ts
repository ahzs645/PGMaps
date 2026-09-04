import { expect, test, type Page } from '@playwright/test'

async function installWebMCPTestHost(page: Page) {
  await page.addInitScript(() => {
    type TestTool = {
      name: string
      execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>
    }
    const tools = new Map<string, TestTool>()
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool: async (tool: TestTool, options?: { signal?: AbortSignal }) => {
          tools.set(tool.name, tool)
          options?.signal?.addEventListener(
            'abort',
            () => {
              if (tools.get(tool.name) === tool) tools.delete(tool.name)
            },
            { once: true },
          )
        },
      },
    })
    Object.assign(window, {
      __webMCPTest: {
        names: () => [...tools.keys()].sort(),
        execute: async (name: string, input: Record<string, unknown>) => {
          const tool = tools.get(name)
          if (!tool) throw new Error(`Tool ${name} is not registered`)
          return tool.execute(input, { signal: new AbortController().signal })
        },
      },
    })
  })
}

function toolNames(page: Page) {
  return page.evaluate(() =>
    (
      window as typeof window & {
        __webMCPTest: { names: () => string[] }
      }
    ).__webMCPTest.names(),
  )
}

function executeTool<T>(page: Page, name: string, input: Record<string, unknown>) {
  return page.evaluate(
    ({ name, input }) =>
      (
        window as typeof window & {
          __webMCPTest: {
            execute: (toolName: string, toolInput: Record<string, unknown>) => Promise<unknown>
          }
        }
      ).__webMCPTest.execute(name, input) as Promise<T>,
    { name, input },
  )
}

function captureRuntimeErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test('WebMCP tools follow the page and update the visible map workspace', async ({ page }) => {
  test.setTimeout(60_000)
  const runtimeErrors = captureRuntimeErrors(page)
  await installWebMCPTestHost(page)
  await page.goto('/dev/projects')

  await expect.poll(() => toolNames(page)).toEqual(['find_map_projects', 'open_map_project'])

  const search = await executeTool<{
    projects: Array<{ slug: string; title: string }>
  }>(page, 'find_map_projects', { query: 'climate and health' })
  expect(search.projects[0]).toMatchObject({
    slug: 'echoscreen-climate-health',
    title: 'EchoScreen Cumulative Impacts Study',
  })

  await executeTool(page, 'open_map_project', { slug: 'echoscreen-climate-health' })
  await expect(page).toHaveURL(/\/dev\/projects\/echoscreen-climate-health$/)
  await expect(page.getByRole('heading', { name: 'EchoScreen Cumulative Impacts Study' })).toBeVisible()

  await expect
    .poll(() => toolNames(page))
    .toEqual(['get_map_project_context', 'go_to_map_scene', 'set_map_layer_visibility', 'set_map_raster_opacity'])

  await executeTool(page, 'go_to_map_scene', { scene: 'Future Heat' })
  const context = await executeTool<{
    activeScene: { number: number; title: string }
    layers: Array<{ id: string; visible: boolean }>
  }>(page, 'get_map_project_context', {})
  expect(context.activeScene).toMatchObject({ number: 2, title: 'Projected hot-day surface' })
  await expect(page.getByRole('button', { name: /Future Heat/ })).toHaveClass(/border-primary/)

  await executeTool(page, 'set_map_layer_visibility', { layer: 'hospitals', action: 'hide' })
  const updated = await executeTool<{
    layers: Array<{ id: string; visible: boolean }>
  }>(page, 'get_map_project_context', {})
  expect(updated.layers.find((layer) => layer.id === 'hospitals')?.visible).toBe(false)
  expect(runtimeErrors).toEqual([])
})

test('research tools filter shared data and open a mapped location', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const runtimeErrors = captureRuntimeErrors(page)
  await installWebMCPTestHost(page)

  const fixtures: Record<string, unknown> = {
    'overview.json': {
      submissionsTotal: 2,
      linkedRowsTotal: 2,
      linkedUniquePairs: 2,
      submissionsWithLocations: 2,
      submissionsWithoutLocations: 0,
      locationsTotal: 2,
      locationsWithCoordinates: 2,
      yearRange: { min: 2014, max: 2022 },
    },
    'submissions.cleaned.json': [
      {
        id: 1,
        title: 'Water governance report',
        resourceType: 'Report',
        resourceTypeMain: 'report',
        publicationYear: 2014,
        decade: 2010,
        author: 'River Lab',
        tags: ['water'],
        locationIds: ['site-a'],
      },
      {
        id: 2,
        title: 'Fish habitat article',
        resourceType: 'Journal Article',
        resourceTypeMain: 'journalArticle',
        publicationYear: 2022,
        decade: 2020,
        author: 'Watershed Lab',
        tags: ['fish'],
        locationIds: ['site-b'],
      },
    ],
    'locations.cleaned.json': [
      {
        id: 'site-a',
        name: 'Site A',
        coordinates: { lat: 54.1, lon: -124.2 },
        coordinateSource: 'test',
        totalPublications: 1,
        byDecade: { '2010': 1 },
        resourceTypes: { report: 1 },
      },
      {
        id: 'site-b',
        name: 'Site B',
        coordinates: { lat: 54.3, lon: -124.4 },
        coordinateSource: 'test',
        totalPublications: 1,
        byDecade: { '2020': 1 },
        resourceTypes: { journalArticle: 1 },
      },
    ],
    'decades.cleaned.json': [
      { decade: 2010, total: 1, byResourceType: { report: 1 } },
      { decade: 2020, total: 1, byResourceType: { journalArticle: 1 } },
    ],
  }

  await page.route('https://projects.ahmadjalil.com/nwsviz/data/**', async (route) => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    await route.fulfill({ json: fixtures[file] })
  })
  await page.goto('/dev/projects/nechako-watershed-research-portal')

  await expect
    .poll(() => toolNames(page))
    .toEqual(['filter_research_map', 'get_research_map_context', 'select_research_location'])

  const initial = await executeTool<{
    results: { totalPublications: number }
    availableDecades: Array<{ decade: number }>
  }>(page, 'get_research_map_context', {})
  expect(initial.results.totalPublications).toBe(2)
  expect(initial.availableDecades.map((item) => item.decade)).toEqual([2010, 2020])

  await executeTool(page, 'filter_research_map', {
    query: 'water',
    decade: 2010,
    categories: ['report'],
  })
  const filtered = await executeTool<{
    results: { totalPublications: number; activeLocations: number }
    topLocations: Array<{ id: string; name: string }>
  }>(page, 'get_research_map_context', {})
  expect(filtered.results).toMatchObject({ totalPublications: 1, activeLocations: 1 })
  expect(filtered.topLocations[0]).toMatchObject({ id: 'site-a', name: 'Site A' })

  await executeTool(page, 'select_research_location', { location: 'Site A' })
  await expect(page.getByRole('heading', { name: 'Site A' })).toBeVisible()
  await expect(page.getByText('1 publications (filtered)')).toBeVisible()
  expect(runtimeErrors).toEqual([])
})
