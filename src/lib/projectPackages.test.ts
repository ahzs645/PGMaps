import { describe, expect, it } from 'vitest'

import { createInitialScoreBuilderState } from '@/maps/scorebuilder/hooks/scoreBuilderReducer'
import type { ScoreBuilderShareState } from '@/maps/scorebuilder/lib/shareState'
import {
  buildProjectLabParams,
  buildProjectPackageFromShareState,
  normalizeProjectPackage,
  projectLabWeights,
  type ProjectPackage,
} from './projectPackages'

const HEAT_PACKAGE: ProjectPackage = {
  version: 1,
  slug: 'heat-shade-priority',
  title: 'Heat + Shade Relief Priority',
  kind: 'index-preset',
  theme: 'amber',
  owner: 'PGMaps',
  updated: 'Current',
  region: 'Prince George DA',
  status: 'Ready',
  summary: 'Heat relief recipe.',
  sourceNote: 'Test package.',
  catalogMetrics: [],
  layers: [],
  legend: [],
  scenes: [],
  files: [],
  lab: {
    presetKey: 'heatReliefPriority',
    boundarySource: 'census',
    boundaryLevel: 'da',
    weights: {
      shadeGap: 28,
      canopyProxyRatio: 18,
      coolingWalk15Access: 16,
      buildingAge: 14,
      cimdSituationalVulnerability: 14,
      cimdComposite: 10,
      populationDensity: 10,
    },
    normalization: 'percentile',
    aggregation: 'cumulativeBurden',
  },
}

/** Fixtures stand in for untrusted JSON, so their fields stay loosely typed. */
type RawStoryPackage = {
  scenes: Array<Record<string, unknown>>
  workspace: {
    map: Record<string, unknown>
    layers: Array<Record<string, unknown>>
  } & Record<string, unknown>
} & Record<string, unknown>

function storyPackage(data = '/data/example.geojson'): RawStoryPackage {
  return {
    version: 1,
    slug: 'example-story',
    title: 'Example story',
    kind: 'map-story',
    theme: 'emerald',
    layers: [{ id: 'areas', label: 'Areas', type: 'boundary', checked: true }],
    scenes: [
      {
        label: 'Start',
        title: 'Start here',
        text: 'A story card.',
        focus: 'B.C.',
        visibleLayerIds: ['areas'],
        camera: { center: [-125, 54], zoom: 5 },
        placeIds: ['place'],
      },
    ],
    workspace: {
      type: 'story-map',
      schema: 'story-map-v1',
      map: { center: [-125, 54], zoom: 5, minZoom: 3, maxZoom: 12 },
      places: [{ id: 'place', label: 'Place', coordinates: [-122.7, 53.9] }],
      layers: [
        {
          id: 'areas',
          data,
          idProperty: 'id',
          labelProperty: 'name',
          fillColor: '#047857',
          fillOpacity: 0.4,
          lineColor: '#0f172a',
          lineOpacity: 0.9,
          lineWidth: 1,
        },
      ],
    },
  }
}

describe('story project packages', () => {
  it('normalizes a JSON-driven story workspace', () => {
    const project = normalizeProjectPackage(storyPackage())
    expect(project?.kind).toBe('map-story')
    expect(project?.workspace?.type).toBe('story-map')
    expect(project?.scenes[0].camera).toEqual({ center: [-125, 54], zoom: 5 })
  })

  it('allows HTTPS GeoJSON while rejecting insecure and protocol-relative sources', () => {
    expect(normalizeProjectPackage(storyPackage('https://example.com/areas.geojson'))?.workspace).toBeDefined()
    expect(normalizeProjectPackage(storyPackage('http://example.com/areas.geojson'))?.workspace).toBeUndefined()
    expect(normalizeProjectPackage(storyPackage('//example.com/areas.geojson'))?.workspace).toBeUndefined()
  })

  it('accepts PMTiles only when a vector source layer is declared', () => {
    const raw = storyPackage('https://data.example.com/areas.pmtiles')
    raw.workspace.layers[0].format = 'pmtiles'
    raw.workspace.layers[0].sourceLayer = 'areas'
    expect(normalizeProjectPackage(raw)?.workspace).toMatchObject({
      layers: [{ format: 'pmtiles', sourceLayer: 'areas' }],
    })

    const missingSourceLayer = storyPackage('https://data.example.com/areas.pmtiles')
    missingSourceLayer.workspace.layers[0].format = 'pmtiles'
    expect(normalizeProjectPackage(missingSourceLayer)?.workspace).toBeUndefined()
  })

  it('drops malformed optional camera data without losing the scene', () => {
    const raw = storyPackage()
    raw.scenes[0].camera = { center: [999] as unknown as [number, number], zoom: 5 }
    const project = normalizeProjectPackage(raw)
    expect(project?.scenes).toHaveLength(1)
    expect(project?.scenes[0].camera).toBeUndefined()
  })

  it('defaults the basemap and accent when a package omits them', () => {
    const workspace = normalizeProjectPackage(storyPackage())?.workspace
    expect(workspace).toMatchObject({ accent: '#0e7490', map: { basemap: 'auto' } })
  })

  it('keeps an explicit basemap override', () => {
    const raw = storyPackage()
    raw.workspace.map = { ...raw.workspace.map, basemap: 'dark' }
    expect(normalizeProjectPackage(raw)?.workspace).toMatchObject({ map: { basemap: 'dark' } })
  })

  it('defaults the story options when a package omits them', () => {
    const workspace = normalizeProjectPackage(storyPackage())?.workspace
    expect(workspace).toMatchObject({
      options: {
        layout: 'panel',
        sceneTransition: 'ease',
        sceneTransitionMs: 1150,
        mobileSheet: 'half',
        mobilePeekSceneText: false,
        mobilePeekTicker: false,
        legendCollapsed: 'auto',
        mapControls: 'auto',
        cameraFit: 'auto',
        slidesSwipeHint: 'off',
      },
    })
  })

  it('keeps valid story options and clamps the transition duration', () => {
    const raw = storyPackage()
    raw.workspace.options = {
      layout: 'slides',
      sceneTransition: 'fly',
      sceneTransitionMs: 99999,
      mobileSheet: 'collapsed',
      mobilePeekSceneText: true,
      mobilePeekTicker: true,
      legendCollapsed: 'never',
      mapControls: 'hidden',
      cameraFit: 'off',
      slidesSwipeHint: 'pane',
    }
    expect(normalizeProjectPackage(raw)?.workspace).toMatchObject({
      options: {
        layout: 'slides',
        sceneTransition: 'fly',
        sceneTransitionMs: 5000,
        mobileSheet: 'collapsed',
        mobilePeekSceneText: true,
        mobilePeekTicker: true,
        legendCollapsed: 'never',
        mapControls: 'hidden',
        cameraFit: 'off',
        slidesSwipeHint: 'pane',
      },
    })

    // Boolean true predates the scoped variants and keeps meaning fullscreen.
    const legacy = storyPackage()
    legacy.workspace.options = { slidesSwipeHint: true }
    expect(normalizeProjectPackage(legacy)?.workspace).toMatchObject({
      options: { slidesSwipeHint: 'fullscreen' },
    })
  })

  it('falls back to option defaults on unknown values', () => {
    const raw = storyPackage()
    raw.workspace.options = {
      layout: 'carousel',
      sceneTransition: 'teleport',
      mobileSheet: 'giant',
      mobilePeekSceneText: 'yes',
      legendCollapsed: 'sometimes',
      mapControls: 'invisible',
      cameraFit: 'maybe',
      slidesSwipeHint: 'always',
    }
    expect(normalizeProjectPackage(raw)?.workspace).toMatchObject({
      options: {
        layout: 'panel',
        sceneTransition: 'ease',
        sceneTransitionMs: 1150,
        mobileSheet: 'half',
        mobilePeekSceneText: false,
        legendCollapsed: 'auto',
        mapControls: 'auto',
        cameraFit: 'auto',
        slidesSwipeHint: 'off',
      },
    })
  })

  it('normalizes scene highlights and clamps their dim opacity', () => {
    const raw = storyPackage()
    raw.scenes[0].highlights = [
      { layerId: 'areas', property: 'name', values: ['North', 42], dimOpacity: 5, label: 'North' },
      { layerId: 'areas', property: 'name', values: [] },
      { property: 'name', values: ['North'] },
    ]
    const scene = normalizeProjectPackage(raw)?.scenes[0]
    expect(scene?.highlights).toEqual([
      { layerId: 'areas', property: 'name', values: ['North'], color: undefined, dimOpacity: 1, label: 'North' },
    ])
  })

  it('keeps only usable scene layer overrides', () => {
    const raw = storyPackage()
    raw.scenes[0].layerOverrides = {
      areas: { fillOpacity: 0, lineWidth: -4 },
      ignored: { fillOpacity: 'thick' },
    }
    const scene = normalizeProjectPackage(raw)?.scenes[0]
    expect(scene?.layerOverrides).toEqual({
      areas: { fillOpacity: 0, lineOpacity: undefined, lineWidth: 0 },
    })
  })

  it('accepts a scene legend and callout, and drops an incomplete callout', () => {
    const raw = storyPackage()
    raw.scenes[0].legend = [{ label: 'North', color: '#2563eb' }, { label: 'bad' }]
    raw.scenes[0].callout = { label: 'Zone', value: 'South West' }
    const scene = normalizeProjectPackage(raw)?.scenes[0]
    expect(scene?.legend).toEqual([{ label: 'North', color: '#2563eb' }])
    expect(scene?.callout).toEqual({ label: 'Zone', value: 'South West', detail: undefined })

    const withoutValue = storyPackage()
    withoutValue.scenes[0].callout = { label: 'Zone' }
    expect(normalizeProjectPackage(withoutValue)?.scenes[0].callout).toBeUndefined()
  })
})

describe('normalizeProjectPackage', () => {
  it('rejects values that are not packages', () => {
    expect(normalizeProjectPackage(null)).toBeNull()
    expect(normalizeProjectPackage('nope')).toBeNull()
    expect(normalizeProjectPackage({ title: 'No slug' })).toBeNull()
  })

  it('fills defaults and keeps a valid lab recipe', () => {
    const pkg = normalizeProjectPackage({
      slug: 'x',
      title: 'X',
      created: '2026-07-05',
      angledLegendLabels: true,
      lab: { boundarySource: 'census', boundaryLevel: 'da', weights: { populationDensity: 10 } },
    })
    expect(pkg).not.toBeNull()
    expect(pkg!.kind).toBe('index-preset')
    expect(pkg!.created).toBe('2026-07-05')
    expect(pkg!.angledLegendLabels).toBe(true)
    expect(pkg!.layers).toEqual([])
    expect(pkg!.lab?.weights.populationDensity).toBe(10)
  })

  it('drops malformed lab recipes instead of the whole package', () => {
    const pkg = normalizeProjectPackage({ slug: 'x', title: 'X', lab: { weights: 'bad' } })
    expect(pkg).not.toBeNull()
    expect(pkg!.lab).toBeUndefined()
  })

  it('normalizes a reusable map-explorer workspace with composable features', () => {
    const pkg = normalizeProjectPackage({
      slug: 'research-project',
      title: 'Research project',
      workspace: {
        type: 'map-explorer',
        schema: 'map-explorer-v1',
        data: {
          adapter: 'research-records-v1',
          baseUrl: 'https://projects.example.com/map/data',
          files: {
            overview: 'summary.json',
            records: 'records.json',
            locations: 'places.json',
            timeline: 'periods.json',
          },
          categories: [{ id: 'report', label: 'Reports', color: '#f59e0b' }],
          aggregateLocationIds: ['whole_region'],
        },
        map: { center: [-124.2, 54.1], zoom: 6.2 },
        labels: { recordPlural: 'publications' },
        features: [
          {
            type: 'summary-stats',
            items: [{ metric: 'records', label: 'Publications', icon: 'book-open' }],
          },
          { type: 'timeline', title: 'Timeline' },
          { type: 'ranked-list', title: 'Places', limit: 20 },
          { type: 'map-legend', title: 'Resource types', description: 'Circle size is count.' },
        ],
      },
    })

    expect(pkg?.workspace).toEqual({
      type: 'map-explorer',
      schema: 'map-explorer-v1',
      data: {
        adapter: 'research-records-v1',
        baseUrl: 'https://projects.example.com/map/data/',
        files: {
          overview: 'summary.json',
          records: 'records.json',
          locations: 'places.json',
          timeline: 'periods.json',
        },
        categories: [{ id: 'report', label: 'Reports', color: '#f59e0b' }],
        aggregateLocationIds: ['whole_region'],
      },
      map: { center: [-124.2, 54.1], zoom: 6.2, minZoom: 4, maxZoom: 15 },
      labels: {
        recordSingular: 'record',
        recordPlural: 'publications',
        locationSingular: 'location',
        locationPlural: 'locations',
        yearPlural: 'years',
        loading: 'Loading data…',
        unavailable: 'Data unavailable',
      },
      features: [
        {
          type: 'summary-stats',
          items: [{ metric: 'records', label: 'Publications', icon: 'book-open' }],
        },
        {
          type: 'timeline',
          title: 'Timeline',
          granularity: 'decade',
          showLabel: 'Show Timeline',
          hideLabel: 'Hide Timeline',
        },
        { type: 'ranked-list', title: 'Places', limit: 20 },
        { type: 'map-legend', title: 'Resource types', description: 'Circle size is count.' },
      ],
    })
  })

  it('drops map-explorer workspaces with a non-HTTPS data URL', () => {
    const pkg = normalizeProjectPackage({
      slug: 'unsafe-research-project',
      title: 'Unsafe research project',
      workspace: {
        type: 'map-explorer',
        schema: 'map-explorer-v1',
        data: {
          adapter: 'research-records-v1',
          baseUrl: 'http://projects.example.com/map/data/',
          categories: [{ id: 'report', label: 'Reports', color: '#f59e0b' }],
        },
        map: { center: [-124.2, 54.1], zoom: 6.2 },
        features: [{ type: 'category-filter', title: 'Types' }],
      },
    })

    expect(pkg?.workspace).toBeUndefined()
  })
})

describe('buildProjectLabParams', () => {
  it('returns null without a lab recipe', () => {
    expect(buildProjectLabParams({ ...HEAT_PACKAGE, lab: undefined })).toBeNull()
  })

  it('produces params the lab hydrates back into the exact recipe', () => {
    const params = buildProjectLabParams(HEAT_PACKAGE)
    expect(params).not.toBeNull()
    expect(params!.get('project')).toBe('heat-shade-priority')

    const state = createInitialScoreBuilderState(params!)
    expect(state.boundarySource).toBe('census')
    expect(state.censusBoundaryLevel).toBe('da')
    expect(state.methodSettings.normalization).toBe('percentile')
    expect(state.methodSettings.aggregation).toBe('cumulativeBurden')
    expect(state.weights).toMatchObject(HEAT_PACKAGE.lab!.weights)
    expect(state.weights.parkWalk10Access).toBe(0)
    expect(state.enabledDataSources).toEqual(
      expect.arrayContaining(['heatShade', 'census', 'bcAssessment', 'deprivation']),
    )
  })

  it('drops unknown metric keys instead of corrupting the weight vector', () => {
    const pkg: ProjectPackage = {
      ...HEAT_PACKAGE,
      lab: { ...HEAT_PACKAGE.lab!, weights: { populationDensity: 10, notARealMetric: 55 } },
    }
    const weights = projectLabWeights(pkg.lab!)
    expect(weights.populationDensity).toBe(10)
    expect('notARealMetric' in weights).toBe(false)
  })
})

describe('buildProjectPackageFromShareState', () => {
  it('round-trips the recipe from a share state back through the lab params', () => {
    const share = {
      version: 1,
      boundarySource: 'census',
      healthBoundaryLevel: 'chsa',
      censusBoundaryLevel: 'da',
      enabledDataSources: ['heatShade', 'census'],
      selectedNetworks: [],
      weights: { shadeGap: 28, populationDensity: 10 },
      methodSettings: {
        normalization: 'percentile',
        aggregation: 'cumulativeBurden',
        missingData: 'zero',
        sensitivity: true,
        normalizationScope: 'activeBoundaryLevel',
        visualOutput: 'interpolated',
        mapColorScale: 'relative',
        paletteOverride: null,
        healthyPlanPriority: { demographicMetric: 'cimdComposite', environmentMetric: 'canopyProxyRatio' },
        accessThreshold: { minimumAccess: 0.5, minimumHits: 4 },
        metricModuleOverrides: {},
      },
    } as unknown as ScoreBuilderShareState

    const pkg = buildProjectPackageFromShareState(share, 'My Heat Study', 'Custom description')
    expect(pkg.title).toBe('My Heat Study')
    expect(pkg.summary).toBe('Custom description')
    expect(pkg.slug).toMatch(/^my-heat-study-/)
    expect(pkg.lab?.weights).toEqual({ shadeGap: 28, populationDensity: 10 })
    expect(pkg.lab?.boundaryLevel).toBe('da')

    const state = createInitialScoreBuilderState(buildProjectLabParams(pkg)!)
    expect(state.weights.shadeGap).toBe(28)
    expect(state.weights.populationDensity).toBe(10)
    expect(state.methodSettings.aggregation).toBe('cumulativeBurden')
  })
})
