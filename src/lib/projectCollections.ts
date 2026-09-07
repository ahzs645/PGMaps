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
