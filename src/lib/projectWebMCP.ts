import { useMemo } from 'react'
import type { NavigateFunction } from 'react-router-dom'

import type { ProjectPackage } from '@/lib/projectPackages'
import type { ResearchRecordsAdapterData } from '@/maps/project-explorer/adapters/useResearchRecordsAdapter'

import {
  optionalString,
  requiredString,
  resolveNamedIndex,
  useWebMCPTools,
  type WebMCPInput,
  type WebMCPTool,
} from './webmcp'

const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

const READ_ONLY = { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false } as const
const UI_ACTION = { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false } as const

function waitForVisibleUpdate() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

function projectSummary(project: ProjectPackage) {
  return {
    slug: project.slug,
    title: project.title,
    kind: project.kind,
    summary: project.summary,
    region: project.region,
    owner: project.owner,
    layers: project.catalogCounts?.layers ?? project.layers.length,
    scenes: project.catalogCounts?.scenes ?? project.scenes.length,
  }
}

export function useProjectCatalogWebMCP({
  active,
  projects,
  navigate,
}: {
  active: boolean
  projects: ProjectPackage[]
  navigate: NavigateFunction
}) {
  const tools = useMemo<WebMCPTool[]>(() => {
    if (!active) return []
    return [
      {
        name: 'find_map_projects',
        title: 'Find map projects',
        description:
          'Search the PGMaps project catalog by topic and optional project type. Returns project slugs and summaries so a relevant project can be opened.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 160, description: 'Plain-language topic, place, or keyword.' },
            kind: {
              type: 'string',
              enum: ['map-story', 'raster-story', 'index-preset', 'research-pack'],
              description: 'Optional project type filter.',
            },
          },
          additionalProperties: false,
        },
        annotations: READ_ONLY,
        execute: async (input) => {
          const query = optionalString(input, 'query')?.toLowerCase() ?? ''
          const kind = optionalString(input, 'kind')
          const allowedKinds = new Set(['map-story', 'raster-story', 'index-preset', 'research-pack'])
          if (kind && !allowedKinds.has(kind)) throw new Error(`Unsupported project kind: ${kind}.`)
          const matches = projects.filter((project) => {
            if (kind && project.kind !== kind) return false
            if (!query) return true
            return [project.title, project.summary, project.region, project.owner, project.sourceNote]
              .join(' ')
              .toLowerCase()
              .includes(query)
          })
          return {
            count: matches.length,
            projects: matches.slice(0, 5).map(projectSummary),
            truncated: matches.length > 5,
          }
        },
      },
      {
        name: 'open_map_project',
        title: 'Open a map project',
        description:
          'Open one PGMaps project by its catalog slug. The human and agent will see the project workspace on the current page.',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', maxLength: 160, description: 'Exact slug returned by find_map_projects.' },
          },
          required: ['slug'],
          additionalProperties: false,
        },
        annotations: UI_ACTION,
        execute: async (input) => {
          const slug = requiredString(input, 'slug')
          const project = projects.find((item) => item.slug === slug)
          if (!project) throw new Error(`No project with slug "${slug}" exists in the loaded catalog.`)
          navigate(`/dev/projects/${encodeURIComponent(slug)}`)
          return {
            opened: projectSummary(project),
            path: `/dev/projects/${encodeURIComponent(slug)}`,
          }
        },
      },
    ]
  }, [active, navigate, projects])

  useWebMCPTools(tools)
}

export function useLoadedProjectWebMCP({
  project,
  activeSceneIndex,
  visibleLayerIds,
  rasterOpacity,
  applyScene,
  setLayerVisibility,
  setRasterOpacity,
}: {
  project: ProjectPackage
  activeSceneIndex: number
  visibleLayerIds: Set<string>
  rasterOpacity: number
  applyScene: (index: number) => void
  setLayerVisibility: (layerId: string, action: 'show' | 'hide' | 'toggle') => void
  setRasterOpacity: (value: number) => void
}) {
  const tools = useMemo<WebMCPTool[]>(() => {
    const result: WebMCPTool[] = [
      projectContextTool(project, activeSceneIndex, visibleLayerIds),
      sceneNavigationTool(project, activeSceneIndex, applyScene),
      layerVisibilityTool(project, visibleLayerIds, setLayerVisibility),
    ]
    if (project.portalMap) {
      result.push({
        name: 'set_map_raster_opacity',
        title: 'Set raster opacity',
        description: 'Set the visible portal raster opacity from 20 to 100 percent on the current map.',
        inputSchema: {
          type: 'object',
          properties: { percent: { type: 'number', minimum: 20, maximum: 100 } },
          required: ['percent'],
          additionalProperties: false,
        },
        annotations: UI_ACTION,
        execute: async (input) => {
          const percent = input.percent
          if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 20 || percent > 100) {
            throw new Error('percent must be a number from 20 to 100.')
          }
          const rounded = Math.round(percent)
          setRasterOpacity(rounded)
          await waitForVisibleUpdate()
          return { project: project.title, rasterOpacity: rounded, previousRasterOpacity: rasterOpacity }
        },
      })
    }
    return result
  }, [activeSceneIndex, applyScene, project, rasterOpacity, setLayerVisibility, setRasterOpacity, visibleLayerIds])
  useWebMCPTools(tools)
}

export function useStoryMapWebMCP({
  project,
  activeSceneIndex,
  visibleLayerIds,
  goToScene,
  setLayerVisibility,
}: {
  project: ProjectPackage
  activeSceneIndex: number
  visibleLayerIds: Set<string>
  goToScene: (index: number) => void
  setLayerVisibility: (layerId: string, action: 'show' | 'hide' | 'toggle') => void
}) {
  const tools = useMemo<WebMCPTool[]>(
    () => [
      projectContextTool(project, activeSceneIndex, visibleLayerIds),
      sceneNavigationTool(project, activeSceneIndex, goToScene),
      layerVisibilityTool(project, visibleLayerIds, setLayerVisibility),
    ],
    [activeSceneIndex, goToScene, project, setLayerVisibility, visibleLayerIds],
  )
  useWebMCPTools(tools)
}

function projectContextTool(
  project: ProjectPackage,
  activeSceneIndex: number,
  visibleLayerIds: Set<string>,
): WebMCPTool {
  return {
    name: 'get_map_project_context',
    title: 'Read current map context',
    description:
      'Read the current PGMaps project, story scenes, active scene, and map-layer visibility before deciding what to explore next.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: READ_ONLY,
    execute: async () => ({
      project: projectSummary(project),
      activeScene: project.scenes[activeSceneIndex]
        ? {
            number: activeSceneIndex + 1,
            label: project.scenes[activeSceneIndex].label,
            title: project.scenes[activeSceneIndex].title,
            text: project.scenes[activeSceneIndex].text,
            focus: project.scenes[activeSceneIndex].focus,
          }
        : null,
      scenes: project.scenes.map((scene, index) => ({
        number: index + 1,
        label: scene.label,
        title: scene.title,
        focus: scene.focus,
      })),
      layers: project.layers.map((layer) => ({
        id: layer.id,
        label: layer.label,
        visible: visibleLayerIds.has(layer.id),
        locked: Boolean(layer.locked),
      })),
    }),
  }
}

function sceneNavigationTool(
  project: ProjectPackage,
  activeSceneIndex: number,
  applyScene: (index: number) => void,
): WebMCPTool {
  return {
    name: 'go_to_map_scene',
    title: 'Go to a map scene',
    description:
      'Move the current map story to a scene by one-based number, label, or title. The visible narrative, layers, and camera update together.',
    inputSchema: {
      type: 'object',
      properties: {
        scene: { type: 'string', maxLength: 160, description: 'Scene number, label, or title.' },
      },
      required: ['scene'],
      additionalProperties: false,
    },
    annotations: UI_ACTION,
    execute: async (input) => {
      const requested = requiredString(input, 'scene')
      const index = resolveNamedIndex(project.scenes, requested, 'scene')
      applyScene(index)
      await waitForVisibleUpdate()
      const scene = project.scenes[index]
      return {
        project: project.title,
        previousScene: activeSceneIndex + 1,
        activeScene: { number: index + 1, label: scene.label, title: scene.title, focus: scene.focus },
      }
    },
  }
}

function layerVisibilityTool(
  project: ProjectPackage,
  visibleLayerIds: Set<string>,
  setLayerVisibility: (layerId: string, action: 'show' | 'hide' | 'toggle') => void,
): WebMCPTool {
  return {
    name: 'set_map_layer_visibility',
    title: 'Set map layer visibility',
    description: 'Show, hide, or toggle one layer in the current PGMaps project by layer ID or label.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', maxLength: 160, description: 'Layer ID or label from get_map_project_context.' },
        action: { type: 'string', enum: ['show', 'hide', 'toggle'] },
      },
      required: ['layer', 'action'],
      additionalProperties: false,
    },
    annotations: UI_ACTION,
    execute: async (input) => {
      const requested = requiredString(input, 'layer').toLowerCase()
      const action = requiredString(input, 'action')
      if (action !== 'show' && action !== 'hide' && action !== 'toggle') {
        throw new Error('action must be show, hide, or toggle.')
      }
      const layer = project.layers.find(
        (item) => item.id.toLowerCase() === requested || item.label.toLowerCase() === requested,
      )
      if (!layer) {
        throw new Error(
          `Unknown layer "${requested}". Available layers: ${project.layers.map((item) => `${item.id} (${item.label})`).join('; ')}`,
        )
      }
      if (layer.locked) throw new Error(`${layer.label} is locked and cannot be changed.`)
      const wasVisible = visibleLayerIds.has(layer.id)
      setLayerVisibility(layer.id, action)
      await waitForVisibleUpdate()
      const visible = action === 'toggle' ? !wasVisible : action === 'show'
      return { project: project.title, layer: { id: layer.id, label: layer.label, visible } }
    },
  }
}

export function useResearchExplorerWebMCP({ title, data }: { title: string; data: ResearchRecordsAdapterData }) {
  const tools = useMemo<WebMCPTool[]>(
    () =>
      data.loading || data.error
        ? []
        : [researchContextTool(title, data), researchFilterTool(title, data), researchLocationTool(title, data)],
    [data, title],
  )
  useWebMCPTools(tools)
}

function researchContextTool(title: string, data: ResearchRecordsAdapterData): WebMCPTool {
  return {
    name: 'get_research_map_context',
    title: 'Read research map context',
    description:
      'Read the current research-map filters, matching totals, available decades and categories, and highest-ranked mapped locations.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: READ_ONLY,
    execute: async () => ({
      project: title,
      filters: {
        query: data.searchQuery,
        decade: data.selectedDecade,
        categories: [...data.selectedTypes],
      },
      results: data.filteredStats,
      availableDecades: data.decades.map((item) => ({ decade: item.decade, records: item.total })),
      availableCategories: data.allResourceTypes.map(([id, count]) => ({
        id,
        label: data.resourceTypeLabels[id] ?? id,
        records: count,
      })),
      topLocations: data.filteredLocations.slice(0, 8).map((location) => ({
        id: location.id,
        name: location.name,
        records: location.filteredCount,
      })),
    }),
  }
}

function researchFilterTool(title: string, data: ResearchRecordsAdapterData): WebMCPTool {
  return {
    name: 'filter_research_map',
    title: 'Filter the research map',
    description:
      'Set any combination of text query, publication decade, and resource categories on the current research map. Omitted fields stay unchanged; reset clears all filters first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 160, description: 'Title, author, or tag search. Empty string clears it.' },
        decade: { type: 'number', description: 'A decade returned by get_research_map_context.' },
        categories: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', maxLength: 80 },
          description: 'Category IDs returned by get_research_map_context. Empty array clears this filter.',
        },
        reset: { type: 'boolean', description: 'Clear all current filters before applying supplied fields.' },
      },
      additionalProperties: false,
    },
    annotations: UI_ACTION,
    execute: async (input: WebMCPInput) => {
      const query = optionalString(input, 'query')
      const decade = input.decade
      const categories = input.categories
      const reset = input.reset
      if (reset !== undefined && typeof reset !== 'boolean') throw new Error('reset must be true or false.')
      if (decade !== undefined) {
        if (typeof decade !== 'number' || !Number.isInteger(decade)) throw new Error('decade must be an integer.')
        if (!data.decades.some((item) => item.decade === decade)) {
          throw new Error(
            `Unknown decade ${decade}. Available decades: ${data.decades.map((item) => item.decade).join(', ')}`,
          )
        }
      }
      if (categories !== undefined && !Array.isArray(categories)) throw new Error('categories must be an array.')
      const availableCategories = new Set(data.allResourceTypes.map(([id]) => id))
      const requestedCategories = (categories ?? []).map((category) => {
        if (typeof category !== 'string') throw new Error('Every category must be a string ID.')
        if (!availableCategories.has(category)) {
          throw new Error(
            `Unknown category "${category}". Available categories: ${[...availableCategories].join(', ')}`,
          )
        }
        return category
      })

      if (reset) data.clearFilters()
      if (query !== undefined) data.setSearchQuery(query)
      if (decade !== undefined) data.setSelectedDecade(decade)
      if (categories !== undefined) data.setSelectedTypes(new Set(requestedCategories))
      data.setSelectedLocationId(null)
      await waitForVisibleUpdate()

      return {
        project: title,
        applied: {
          reset: Boolean(reset),
          query: query ?? (reset ? '' : data.searchQuery),
          decade: decade ?? (reset ? null : data.selectedDecade),
          categories: categories !== undefined ? requestedCategories : reset ? [] : [...data.selectedTypes],
        },
        message: 'The visible map and ranked location list were updated.',
      }
    },
  }
}

function researchLocationTool(title: string, data: ResearchRecordsAdapterData): WebMCPTool {
  return {
    name: 'select_research_location',
    title: 'Select a research location',
    description:
      'Select one currently matching mapped location by ID or name, opening its popup for the human to inspect.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', maxLength: 160, description: 'Location ID or name from get_research_map_context.' },
      },
      required: ['location'],
      additionalProperties: false,
    },
    annotations: UI_ACTION,
    execute: async (input) => {
      const requested = requiredString(input, 'location').toLowerCase()
      const exact = data.filteredLocations.find(
        (location) => location.id.toLowerCase() === requested || location.name.toLowerCase() === requested,
      )
      const partial = data.filteredLocations.filter((location) => location.name.toLowerCase().includes(requested))
      const location = exact ?? (partial.length === 1 ? partial[0] : null)
      if (!location) {
        throw new Error(
          `Unknown or ambiguous location "${requested}". Read get_research_map_context for current location IDs and names.`,
        )
      }
      data.setSelectedLocationId(location.id)
      await waitForVisibleUpdate()
      return {
        project: title,
        selectedLocation: {
          id: location.id,
          name: location.name,
          records: location.filteredCount,
          categories: location.resourceTypes,
          coordinates: location.coordinates,
        },
      }
    },
  }
}
