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

  await expect
    .poll(() => toolNames(page))
    .toEqual(['find_map_projects', 'list_map_experiences', 'open_map_experience', 'open_map_project'])

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
    .toEqual([
      'get_map_project_context',
      'go_to_map_scene',
      'list_map_experiences',
      'open_map_experience',
      'set_map_layer_visibility',
      'set_map_raster_opacity',
    ])

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
    .toEqual([
      'filter_research_map',
      'get_research_map_context',
      'list_map_experiences',
      'open_map_experience',
      'select_research_location',
    ])

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

test('site discovery opens food safety and its tools filter and select the visible data', async ({ page }) => {
  test.setTimeout(60_000)
  const runtimeErrors = captureRuntimeErrors(page)
  await installWebMCPTestHost(page)

  const restaurants = [
    {
      name: 'North Cafe',
      details_url: 'https://example.test/north-cafe',
      address: '10 First Avenue',
      full_address: '10 First Avenue, Prince George',
      latitude: 53.91,
      longitude: -122.75,
      hazard_rating: 'Low',
      current_hazard_rating: 'Low',
      facility_type: 'Restaurant',
      inspections: [],
    },
    {
      name: 'River Bakery',
      details_url: 'https://example.test/river-bakery',
      address: '5 River Road',
      full_address: '5 River Road, Prince George',
      latitude: 53.92,
      longitude: -122.73,
      hazard_rating: 'Moderate',
      current_hazard_rating: 'Moderate',
      facility_type: 'Restaurant',
      inspections: [
        {
          date: '18-Aug-2026',
          inspection_date: 'August 18, 2026',
          type: 'Routine Inspection',
          inspection_type: 'Routine',
          hazard_rating: 'Moderate',
          critical_violations_count: 1,
          non_critical_violations_count: 0,
          follow_up_required: 'No',
          violations: [
            {
              code: '203',
              description: 'Potentially hazardous food was not held at a safe temperature.',
              observation: 'Observed during inspection.',
            },
          ],
        },
      ],
    },
  ]

  await page.route('**/data/restaurants.json', (route) => route.fulfill({ json: restaurants }))
  await page.route('**/data/restaurant-classifications.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/data/restaurant-location-overrides.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/data/geocoding/geocoded_locations.json', (route) => route.fulfill({ json: { locations: [] } }))
  await page.route(/services2\.arcgis\.com\/.*\/PGCrime\/FeatureServer\/0\/query/, (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('returnCountOnly') === 'true') {
      return route.fulfill({ json: { count: 2 } })
    }
    return route.fulfill({
      json: {
        features: [
          {
            properties: {
              OBJECTID: 1,
              File_Number: 'A',
              Date: Date.parse('2026-08-01T00:00:00Z'),
              CrimeType: 'Mischief',
              Time: '',
              Address: 'Near North Cafe',
              CommunityName: 'Test',
            },
            geometry: { coordinates: [-122.7501, 53.9101] },
          },
          {
            properties: {
              OBJECTID: 2,
              File_Number: 'B',
              Date: Date.parse('2026-08-02T00:00:00Z'),
              CrimeType: 'Theft from Vehicle',
              Time: '',
              Address: 'Near North Cafe',
              CommunityName: 'Test',
            },
            geometry: { coordinates: [-122.7502, 53.9102] },
          },
        ],
      },
    })
  })

  await page.goto('/')
  const discovery = await executeTool<{
    experiences: Array<{ id: string; title: string }>
  }>(page, 'list_map_experiences', { query: 'restaurants' })
  expect(discovery.experiences).toEqual([
    expect.objectContaining({ id: 'food-safety', title: 'Food safety inspections' }),
  ])

  await executeTool(page, 'open_map_experience', { id: 'food-safety' })
  await expect(page).toHaveURL(/\/foodmap$/)
  await expect
    .poll(() => toolNames(page))
    .toEqual([
      'filter_food_safety_map',
      'get_food_safety_context',
      'list_map_experiences',
      'open_map_experience',
      'rank_food_options',
      'select_food_establishment',
    ])
  await expect(page.getByText('2 of 2 on map')).toBeVisible()

  const initial = await executeTool<{
    dataset: { establishments: number; filteredEstablishments: number }
    crossDataset: { propertyCrimeIncidentsLoaded: number }
  }>(page, 'get_food_safety_context', {})
  expect(initial.dataset).toMatchObject({ establishments: 2, filteredEstablishments: 2 })
  await expect
    .poll(async () => {
      const context = await executeTool<{
        crossDataset: { propertyCrimeIncidentsLoaded: number }
      }>(page, 'get_food_safety_context', {})
      return context.crossDataset.propertyCrimeIncidentsLoaded
    })
    .toBe(2)

  const ranking = await executeTool<{
    ranked: Array<{ name: string; nearbyCrimeIncidents: number; violations: number }>
  }>(page, 'rank_food_options', { radiusMeters: 500, crimeLookbackMonths: 12, crimeWeight: 70 })
  expect(ranking.ranked[0]).toMatchObject({ name: 'River Bakery', nearbyCrimeIncidents: 0, violations: 1 })

  await executeTool(page, 'filter_food_safety_map', {
    query: 'River',
    visualizationMode: 'violations',
    timelineMonths: 0,
  })
  await expect(page.getByPlaceholder('Search restaurants...')).toHaveValue('River')

  const filtered = await executeTool<{
    dataset: { filteredEstablishments: number }
    highestRiskMatches: Array<{ name: string; criticalViolations: number }>
  }>(page, 'get_food_safety_context', {})
  expect(filtered.dataset.filteredEstablishments).toBe(1)
  expect(filtered.highestRiskMatches[0]).toMatchObject({ name: 'River Bakery', criticalViolations: 1 })

  await executeTool(page, 'select_food_establishment', {
    establishment: 'River Bakery',
    openInspections: true,
  })
  await expect(page).toHaveURL(/restaurant=River(?:\+|%20)Bakery/)
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'River Bakery' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'River Bakery' })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})
