import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { optionalString, requiredString, useWebMCPTools, type WebMCPTool } from './webmcp'

export interface MapExperience {
  id: string
  title: string
  description: string
  path: string
  stage: 'primary' | 'lab'
  tags: string[]
}

export const MAP_EXPERIENCES: MapExperience[] = [
  {
    id: 'projects',
    title: 'Map project catalog',
    description: 'Curated map stories, raster narratives, research portals, and reusable project workspaces.',
    path: '/dev/projects',
    stage: 'primary',
    tags: ['projects', 'stories', 'research', 'climate', 'health'],
  },
  {
    id: 'food-safety',
    title: 'Food safety inspections',
    description: 'Restaurant inspections, hazard ratings, violations, risk categories, and inspection history.',
    path: '/foodmap',
    stage: 'primary',
    tags: ['food', 'restaurants', 'inspections', 'health', 'violations'],
  },
  {
    id: 'air-quality',
    title: 'Air quality',
    description: 'Community air-quality monitors, pollutant readings, and mapped station context.',
    path: '/airquality',
    stage: 'primary',
    tags: ['air', 'health', 'pollution', 'pm2.5', 'monitors'],
  },
  {
    id: 'explorer',
    title: 'Multi-dataset explorer',
    description: 'Browse point, line, and polygon datasets together and filter them by source or geometry.',
    path: '/explorer',
    stage: 'primary',
    tags: ['datasets', 'search', 'layers', 'city', 'explorer'],
  },
  {
    id: 'census',
    title: 'Census explorer',
    description: 'Compare dissemination-area population and socioeconomic measures on a choropleth map.',
    path: '/census',
    stage: 'primary',
    tags: ['census', 'population', 'socioeconomic', 'demographics'],
  },
  {
    id: 'index-lab',
    title: 'Index Lab',
    description: 'Build transparent civic and environmental-health indices with adjustable weights and methods.',
    path: '/score-builder',
    stage: 'primary',
    tags: ['index', 'score', 'environment', 'health', 'walkability', 'equity'],
  },
  {
    id: 'parks-and-trails',
    title: 'Parks and trails',
    description: 'Explore parks, trails, recreation amenities, and nearby outdoor spaces.',
    path: '/pgdata?tab=parks',
    stage: 'primary',
    tags: ['parks', 'trails', 'recreation', 'outdoors'],
  },
  {
    id: 'boundary-explorer',
    title: 'Boundary explorer',
    description: 'Search and compare administrative, health, census, watershed, and planning boundaries.',
    path: '/dev/boundaries',
    stage: 'lab',
    tags: ['boundaries', 'census', 'health', 'watershed', 'administrative'],
  },
  {
    id: 'land-acknowledgement',
    title: 'Land acknowledgement research',
    description: 'Inspect spatial evidence and source context for place-specific acknowledgement research.',
    path: '/dev/acknowledgement',
    stage: 'lab',
    tags: ['indigenous', 'nations', 'territory', 'acknowledgement', 'research'],
  },
  {
    id: 'outdoors-planner',
    title: 'Outdoors field planner',
    description: 'Plan areas, access routes, field routes, notes, and operational map layers.',
    path: '/dev/outdoors',
    stage: 'lab',
    tags: ['outdoors', 'fieldwork', 'routes', 'planning', 'forestry'],
  },
  {
    id: 'wastewater',
    title: 'Wastewater infrastructure',
    description: 'Inspect sewage-network features and their mapped infrastructure relationships.',
    path: '/dev/interact/sewage',
    stage: 'lab',
    tags: ['wastewater', 'sewage', 'infrastructure', 'network'],
  },
  {
    id: 'health-services',
    title: 'Health services access',
    description: 'Explore health-service locations and wait-time views for regional access research.',
    path: '/dev/health/wait',
    stage: 'lab',
    tags: ['health', 'services', 'wait times', 'access'],
  },
]

export function findMapExperiences(query = ''): MapExperience[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return MAP_EXPERIENCES
  return MAP_EXPERIENCES.filter((experience) =>
    [experience.id, experience.title, experience.description, experience.stage, ...experience.tags]
      .join(' ')
      .toLowerCase()
      .includes(normalized),
  )
}

function summary(experience: MapExperience, currentPath: string) {
  return {
    ...experience,
    active: currentPath === experience.path || currentPath === experience.path.split('?')[0],
  }
}

export function useSiteWebMCP() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentPath = `${location.pathname}${location.search}`

  const tools = useMemo<WebMCPTool[]>(
    () => [
      {
        name: 'list_map_experiences',
        title: 'List PGMaps experiences',
        description:
          'Discover PGMaps workspaces beyond the project catalog, including food safety, air quality, census, index building, boundaries, Indigenous research, outdoors planning, and infrastructure.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 160, description: 'Optional topic, place, dataset, or activity.' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
        execute(input) {
          const query = optionalString(input, 'query') ?? ''
          const matches = findMapExperiences(query)
          return {
            currentPath,
            count: matches.length,
            experiences: matches.map((experience) => summary(experience, currentPath)),
          }
        },
      },
      {
        name: 'open_map_experience',
        title: 'Open a PGMaps experience',
        description:
          'Open a PGMaps workspace by the exact ID returned by list_map_experiences so the person and agent share its visible map state.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: MAP_EXPERIENCES.map((experience) => experience.id) },
          },
          required: ['id'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
        execute(input) {
          const id = requiredString(input, 'id')
          const experience = MAP_EXPERIENCES.find((candidate) => candidate.id === id)
          if (!experience) {
            throw new Error(`Unknown map experience "${id}". Call list_map_experiences to discover valid IDs.`)
          }
          navigate(experience.path)
          return { opened: summary(experience, experience.path), path: experience.path }
        },
      },
    ],
    [currentPath, navigate],
  )

  useWebMCPTools(tools)
}
