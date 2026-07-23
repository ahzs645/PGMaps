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
      lab: { boundarySource: 'census', boundaryLevel: 'da', weights: { populationDensity: 10 } },
    })
    expect(pkg).not.toBeNull()
    expect(pkg!.kind).toBe('index-preset')
    expect(pkg!.layers).toEqual([])
    expect(pkg!.lab?.weights.populationDensity).toBe(10)
  })

  it('drops malformed lab recipes instead of the whole package', () => {
    const pkg = normalizeProjectPackage({ slug: 'x', title: 'X', lab: { weights: 'bad' } })
    expect(pkg).not.toBeNull()
    expect(pkg!.lab).toBeUndefined()
  })

  it('normalizes a reusable research portal definition', () => {
    const pkg = normalizeProjectPackage({
      slug: 'research-project',
      title: 'Research project',
      dataPortal: {
        schema: 'research-portal-v1',
        dataBaseUrl: 'https://projects.example.com/map/data',
        files: {
          overview: 'summary.json',
          submissions: 'records.json',
          locations: 'places.json',
          decades: 'periods.json',
        },
        map: { center: [-124.2, 54.1], zoom: 6.2 },
        resourceTypes: [{ id: 'report', label: 'Reports', color: '#f59e0b' }],
        regionalLocationIds: ['whole_region'],
      },
    })

    expect(pkg?.dataPortal).toEqual({
      schema: 'research-portal-v1',
      dataBaseUrl: 'https://projects.example.com/map/data/',
      files: {
        overview: 'summary.json',
        submissions: 'records.json',
        locations: 'places.json',
        decades: 'periods.json',
      },
      map: { center: [-124.2, 54.1], zoom: 6.2, minZoom: 4, maxZoom: 15 },
      resourceTypes: [{ id: 'report', label: 'Reports', color: '#f59e0b' }],
      regionalLocationIds: ['whole_region'],
    })
  })

  it('drops research portal definitions with a non-HTTPS data URL', () => {
    const pkg = normalizeProjectPackage({
      slug: 'unsafe-research-project',
      title: 'Unsafe research project',
      dataPortal: {
        schema: 'research-portal-v1',
        dataBaseUrl: 'http://projects.example.com/map/data/',
        map: { center: [-124.2, 54.1], zoom: 6.2 },
        resourceTypes: [{ id: 'report', label: 'Reports', color: '#f59e0b' }],
      },
    })

    expect(pkg?.dataPortal).toBeUndefined()
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
