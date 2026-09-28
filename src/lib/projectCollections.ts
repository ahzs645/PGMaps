import type { ProjectPackage } from './projectPackages'

/** Catalog-only folders: members keep their original packages and URLs. */
export interface ProjectCollection {
  slug: string
  title: string
  description: string
  projectSlugs: readonly string[]
}

export const PROJECT_COLLECTIONS: readonly ProjectCollection[] = [
  {
    slug: 'example',
    title: 'example',
    description:
      'Compare story-map designs on desktop and mobile: six focused interaction demos and four editorial presentations of the same geography story, a recreation of The Diverse Prague, and a native editorial toolkit.',
    projectSlugs: [
      'example-docked',
      'example-slides',
      'example-scrolly',
      'example-comparison',
      'example-relationships',
      'example-hierarchy',
      'example-sidecar-docked',
      'example-sidecar-floating',
      'example-sidecar-slideshow',
      'example-sidecar-mixed',
      'example-prague',
      'example-native-editorial',
    ],
  },
  {
    slug: 'bc-climate-health',
    title: 'B.C. Climate & Health',
    description:
      'Explore climate projections across B.C., the Northern Health resilience narrative, and EchoScreen climate-health maps.',
    projectSlugs: [
      'northern-health-climate-resilience',
      'echoscreen-climate-health',
      'bc-climate-mean-temperature',
      'bc-climate-mean-daily-maximum',
      'bc-climate-mean-daily-minimum',
      'bc-climate-hottest-day',
      'bc-climate-coldest-night',
      'bc-climate-days-above-29c',
      'bc-climate-days-above-32c',
      'bc-climate-nights-above-18c',
      'bc-climate-cooling-degree-days',
      'bc-climate-heating-degree-days',
      'bc-climate-frost-days',
      'bc-climate-frost-free-season',
      'bc-climate-ice-days',
      'bc-climate-annual-precipitation',
      'bc-climate-seasonal-precipitation',
      'bc-climate-precipitation-as-snow',
      'bc-climate-wettest-day',
      'bc-climate-wettest-five-days',
    ],
  },
]

export function getProjectCollection(slug: string | null | undefined) {
  return PROJECT_COLLECTIONS.find((collection) => collection.slug === slug)
}

export function getCollectionForProject(slug: string) {
  return PROJECT_COLLECTIONS.find((collection) => collection.projectSlugs.includes(slug))
}

export function collectionHref(slug: string) {
  return `/dev/projects?collection=${encodeURIComponent(slug)}`
}

/** A stable parent destination, including direct links and refreshed projects. */
export function projectCatalogDestination(projectSlug: string | null | undefined) {
  const collection = projectSlug ? getCollectionForProject(projectSlug) : undefined
  return {
    href: collection ? collectionHref(collection.slug) : '/dev/projects',
    label: collection ? `Back to ${collection.title}` : 'All projects',
    ariaLabel: collection ? `Back to ${collection.title}` : 'Back to all projects',
  }
}

export function collectionMembers(collection: ProjectCollection, projects: readonly ProjectPackage[]) {
  const bySlug = new Map(projects.map((project) => [project.slug, project]))
  return collection.projectSlugs.flatMap((slug) => {
    const project = bySlug.get(slug)
    return project ? [project] : []
  })
}

export interface ProjectCollectionSummary {
  collection: ProjectCollection
  count: number
  total: number
}

export function summarizeCollections(
  projects: readonly ProjectPackage[],
  matches: readonly ProjectPackage[],
): ProjectCollectionSummary[] {
  return PROJECT_COLLECTIONS.map((collection) => ({
    collection,
    count: collectionMembers(collection, matches).length,
    total: collectionMembers(collection, projects).length,
  })).filter(({ count }) => count > 0)
}
