import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCORE_BUILDER_EXAMPLES } from '../src/maps/scorebuilder/constants/examples.ts'
import { SCORE_METRICS } from '../src/maps/scorebuilder/constants/metrics.ts'
import {
  SCORE_PRESETS,
  getScoreDataSourcesForWeights,
} from '../src/maps/scorebuilder/constants/presets.ts'
import type {
  ScoreDataSource,
  ScoreExample,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScorePreset,
} from '../src/maps/scorebuilder/types.ts'
import type { BoundarySource } from '../src/lib/studyArea.ts'

type ProjectTheme = 'cyan' | 'amber' | 'emerald' | 'blue' | 'slate'

interface GeneratedProjectPackage {
  version: 1
  slug: string
  title: string
  kind: 'index-preset'
  theme: ProjectTheme
  owner: string
  updated: string
  region: string
  status: string
  summary: string
  sourceNote: string
  details: string[]
  links: []
  catalogMetrics: Array<{ label: string; value: string }>
  layers: Array<{
    id: string
    label: string
    type: 'base' | 'raster' | 'point'
    checked: boolean
    locked?: boolean
    role?: 'score' | 'points'
  }>
  legend: Array<{ label: string; color: string }>
  scenes: Array<{
    label: string
    title: string
    text: string
    focus: string
    visibleLayerIds: string[]
  }>
  files: Array<{ label: string; detail: string }>
  lab: {
    presetKey?: string
    boundarySource: BoundarySource
    boundaryLevel: string
    weights: Record<string, number>
    normalization?: ScoreMethodSettings['normalization']
    aggregation?: ScoreMethodSettings['aggregation']
    missingData?: ScoreMethodSettings['missingData']
    sensitivity?: boolean
    visualOutput?: ScoreMethodSettings['visualOutput']
    mapColorScale?: ScoreMethodSettings['mapColorScale']
    paletteOverride?: string | null
    mapSurface?: 'source' | 'boundary'
    selectedNetworks?: string[] | 'all'
    accessThreshold?: Partial<ScoreMethodSettings['accessThreshold']>
    healthyPlanPriority?: Partial<ScoreMethodSettings['healthyPlanPriority']>
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const projectsDir = path.join(repoRoot, 'public/data/projects')
const generatedDir = path.join(projectsDir, 'scorebuilder')
const manifestPath = path.join(projectsDir, 'index.json')

const GENERATED_PREFIX = 'scorebuilder/'
const OWNER = 'PGMaps Index Lab'
const UPDATED = 'Generated'

function slugify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function nonZeroWeights(weights: ScoreMetricWeightMap): Record<string, number> {
  return Object.fromEntries(
    SCORE_METRICS.map((metric) => [metric.key, weights[metric.key] ?? 0]).filter(([, value]) => value !== 0),
  )
}

function metricLabels(weights: ScoreMetricWeightMap): string[] {
  return SCORE_METRICS.filter((metric) => (weights[metric.key] ?? 0) !== 0)
    .map((metric) => metric.label)
    .slice(0, 6)
}

function sourceLabel(source: ScoreDataSource): string {
  const labels: Record<ScoreDataSource, string> = {
    airQuality: 'Air',
    parks: 'Parks',
    heatShade: 'Heat',
    restaurants: 'Food',
    census: 'Census',
    bcAssessment: 'Property',
    crime: 'Safety',
    transit: 'Transit',
    walkability: 'Walkability',
    deprivation: 'CIMD',
    healthyPlanPg: 'HealthyPlan',
  }
  return labels[source]
}

function boundaryDefaultsForPreset(preset: ScorePreset, sources: ScoreDataSource[]): {
  boundarySource: BoundarySource
  boundaryLevel: string
} {
  if (preset.recommendedBoundarySource && preset.recommendedBoundaryLevel) {
    return {
      boundarySource: preset.recommendedBoundarySource,
      boundaryLevel: preset.recommendedBoundaryLevel,
    }
  }
  if (preset.boundarySources?.includes('cityPG')) {
    return { boundarySource: 'cityPG', boundaryLevel: 'elementarySchoolCatchment' }
  }
  if (preset.boundarySources?.includes('cityCommunity')) {
    return { boundarySource: 'cityCommunity', boundaryLevel: 'communityPolygon' }
  }
  const localSources = new Set<ScoreDataSource>([
    'heatShade',
    'bcAssessment',
    'crime',
    'transit',
    'walkability',
    'deprivation',
    'healthyPlanPg',
  ])
  return {
    boundarySource: 'census',
    boundaryLevel: sources.some((source) => localSources.has(source)) ? 'da' : 'ct',
  }
}

function themeForSources(sources: ScoreDataSource[], method?: Partial<ScoreMethodSettings>): ProjectTheme {
  if (method?.aggregation === 'accessThreshold') return 'emerald'
  if (sources.includes('heatShade') || sources.includes('deprivation')) return 'amber'
  if (sources.includes('walkability') || sources.includes('transit')) return 'blue'
  if (sources.includes('parks')) return 'emerald'
  if (sources.includes('airQuality')) return 'cyan'
  return 'slate'
}

function regionLabel(boundarySource: BoundarySource, boundaryLevel: string): string {
  if (boundarySource === 'bcHealth') return `British Columbia ${boundaryLevel.toUpperCase()}`
  if (boundarySource === 'cityPG' || boundarySource === 'cityCommunity') return `Prince George ${boundaryLevel}`
  return `Prince George ${boundaryLevel.toUpperCase()}`
}

function networkSelectionForPreset(sources: ScoreDataSource[]): string[] | 'all' | undefined {
  return sources.includes('airQuality') ? 'all' : undefined
}

function networkSelectionForExample(example: ScoreExample): string[] | 'all' | undefined {
  if (example.networkFilter === 'all') return 'all'
  if (example.networkFilter === 'none') return undefined
  return example.networkFilter
}

function labRecipe({
  presetKey,
  boundarySource,
  boundaryLevel,
  weights,
  methodSettings,
  sources,
  selectedNetworks,
}: {
  presetKey?: string
  boundarySource: BoundarySource
  boundaryLevel: string
  weights: ScoreMetricWeightMap
  methodSettings?: Partial<ScoreMethodSettings>
  sources: ScoreDataSource[]
  selectedNetworks?: string[] | 'all'
}): GeneratedProjectPackage['lab'] {
  return {
    presetKey,
    boundarySource,
    boundaryLevel,
    weights: nonZeroWeights(weights),
    normalization: methodSettings?.normalization,
    aggregation: methodSettings?.aggregation,
    missingData: methodSettings?.missingData,
    sensitivity: methodSettings?.sensitivity,
    visualOutput: methodSettings?.visualOutput,
    mapColorScale: methodSettings?.mapColorScale,
    paletteOverride: methodSettings?.paletteOverride,
    mapSurface: sources.includes('walkability') ? 'source' : 'boundary',
    selectedNetworks,
    accessThreshold: methodSettings?.accessThreshold,
    healthyPlanPriority: methodSettings?.healthyPlanPriority,
  }
}

function buildProject({
  slug,
  title,
  summary,
  sourceType,
  sourceKey,
  boundarySource,
  boundaryLevel,
  sources,
  weights,
  methodSettings,
  selectedNetworks,
  presetKey,
}: {
  slug: string
  title: string
  summary: string
  sourceType: 'Preset' | 'Example'
  sourceKey: string
  boundarySource: BoundarySource
  boundaryLevel: string
  sources: ScoreDataSource[]
  weights: ScoreMetricWeightMap
  methodSettings?: Partial<ScoreMethodSettings>
  selectedNetworks?: string[] | 'all'
  presetKey?: string
}): GeneratedProjectPackage {
  const activeMetrics = metricLabels(weights)
  const metricCount = Object.keys(nonZeroWeights(weights)).length
  const methodLabel = methodSettings?.aggregation ?? 'additive'
  const pointLayerLabel = sources.includes('airQuality') ? 'Monitoring points' : 'Facility points'

  return {
    version: 1,
    slug,
    title,
    kind: 'index-preset',
    theme: themeForSources(sources, methodSettings),
    owner: OWNER,
    updated: UPDATED,
    region: regionLabel(boundarySource, boundaryLevel),
    status: 'Ready',
    summary,
    sourceNote: `Generated from the score-builder ${sourceType.toLowerCase()} "${sourceKey}". Opening it in Index Lab loads the same weights, boundary, network, and method settings carried by this package.`,
    details: [
      `${sourceType} package generated from the Index Lab catalog so it can be opened from the Projects workspace.`,
      activeMetrics.length
        ? `Primary active metrics include ${activeMetrics.join(', ')}.`
        : 'This package has no active metrics.',
    ],
    links: [],
    catalogMetrics: [
      { label: 'Source', value: sourceType },
      { label: 'Boundary', value: boundaryLevel.toUpperCase() },
      { label: 'Metrics', value: String(metricCount) },
    ],
    layers: [
      { id: 'base', label: 'Muted streets', type: 'base', checked: true, locked: true },
      { id: 'score-surface', label: 'Score surface', type: 'raster', checked: true, role: 'score' },
      { id: 'points', label: pointLayerLabel, type: 'point', checked: sources.length <= 4, role: 'points' },
    ],
    legend: [
      { label: 'Lower score', color: '#dbeafe' },
      { label: 'Mid score', color: '#fde68a' },
      { label: 'Higher score', color: '#fb923c' },
      { label: 'Highest score', color: '#b91c1c' },
    ],
    scenes: [
      {
        label: 'Overview',
        title: `${title} score surface`,
        text: `Review the generated ${sourceType.toLowerCase()} across ${boundaryLevel.toUpperCase()} boundaries.`,
        focus: 'Score surface',
        visibleLayerIds: ['base', 'score-surface', 'points'],
      },
      {
        label: 'Surface',
        title: 'Score surface only',
        text: 'Hide point context to read the ranked boundary surface on its own.',
        focus: 'Score gradient',
        visibleLayerIds: ['base', 'score-surface'],
      },
      {
        label: 'Recipe',
        title: 'Index Lab handoff',
        text: 'Open the same JSON recipe in Index Lab to change weights, methods, and boundary choices.',
        focus: 'Editable recipe',
        visibleLayerIds: ['base', 'score-surface'],
      },
    ],
    files: [
      { label: 'Project package', detail: 'Generated JSON project recipe' },
      { label: 'Index recipe', detail: `${metricCount} active metrics; ${methodLabel} aggregation` },
      { label: 'Data sources', detail: sources.map(sourceLabel).join(', ') || 'None' },
    ],
    lab: labRecipe({
      presetKey,
      boundarySource,
      boundaryLevel,
      weights,
      methodSettings,
      sources,
      selectedNetworks,
    }),
  }
}

function presetProjects(): Array<{ file: string; pkg: GeneratedProjectPackage }> {
  return SCORE_PRESETS.map((preset) => {
    const sources = getScoreDataSourcesForWeights(preset.weights)
    const { boundarySource, boundaryLevel } = boundaryDefaultsForPreset(preset, sources)
    const keySlug = slugify(preset.key)
    return {
      file: `${GENERATED_PREFIX}preset-${keySlug}.json`,
      pkg: buildProject({
        slug: `score-preset-${keySlug}`,
        title: preset.label,
        summary: preset.description,
        sourceType: 'Preset',
        sourceKey: preset.key,
        boundarySource,
        boundaryLevel,
        sources,
        weights: preset.weights,
        methodSettings: preset.methodSettings,
        selectedNetworks: networkSelectionForPreset(sources),
        presetKey: preset.key,
      }),
    }
  })
}

function exampleProjects(): Array<{ file: string; pkg: GeneratedProjectPackage }> {
  return SCORE_BUILDER_EXAMPLES.map((example) => {
    const keySlug = slugify(example.key)
    return {
      file: `${GENERATED_PREFIX}example-${keySlug}.json`,
      pkg: buildProject({
        slug: `score-example-${keySlug}`,
        title: example.label,
        summary: example.description,
        sourceType: 'Example',
        sourceKey: example.key,
        boundarySource: example.boundarySource,
        boundaryLevel: example.boundaryLevel,
        sources: example.dataSources,
        weights: example.weights,
        methodSettings: example.methodSettings,
        selectedNetworks: networkSelectionForExample(example),
      }),
    }
  })
}

async function readAuthoredManifestFiles(): Promise<string[]> {
  const raw = await readFile(manifestPath, 'utf8')
  const parsed = JSON.parse(raw) as { projects?: unknown }
  return Array.isArray(parsed.projects)
    ? parsed.projects.filter(
        (file): file is string => typeof file === 'string' && !file.startsWith(GENERATED_PREFIX),
      )
    : []
}

async function main() {
  const authoredFiles = await readAuthoredManifestFiles()
  const generated = [...presetProjects(), ...exampleProjects()].sort((a, b) => a.file.localeCompare(b.file))

  await rm(generatedDir, { recursive: true, force: true })
  await mkdir(generatedDir, { recursive: true })

  await Promise.all(
    generated.map(async ({ file, pkg }) => {
      await writeFile(path.join(projectsDir, file), `${JSON.stringify(pkg, null, 2)}\n`)
    }),
  )

  const manifest = {
    projects: [...authoredFiles, ...generated.map((entry) => entry.file)],
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`Generated ${generated.length} score-builder project packages.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
