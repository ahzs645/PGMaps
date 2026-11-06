import type { CatalogueFacets, Facet, RasterRecord, SourceImageRecord } from './catalogue'

export type LibraryItem = RasterRecord | SourceImageRecord
export type OrganizationFilters = {
  subject: string
  region: string
  era: string
  sourceGroup: string
  confidence: string
}
export const EMPTY_FILTERS: OrganizationFilters = { subject: '', region: '', era: '', sourceGroup: '', confidence: '' }
export function isRaster(item: LibraryItem): item is RasterRecord {
  return 'assets' in item
}
export function matchesLibraryItem(item: LibraryItem, query: string, filters: OrganizationFilters) {
  const org = item.organization
  if (filters.subject && !org?.subjects.includes(filters.subject)) return false
  if (filters.region && org?.region !== filters.region) return false
  if (filters.era && org?.era !== filters.era) return false
  if (filters.sourceGroup && org?.sourceGroupId !== filters.sourceGroup) return false
  if (filters.confidence && isRaster(item)) {
    const placement = item.confidence?.includes('experimental')
      ? 'experimental'
      : item.confidence?.includes('provisional')
        ? 'provisional'
        : item.confidence
    if (placement !== filters.confidence) return false
  }
  const search = [
    item.title,
    item.description,
    item.dateLabel,
    isRaster(item) ? item.subtitle : '',
    org?.sourceGroupTitle,
    org?.pageLabel,
    org?.variantLabel,
    org?.region,
    org?.era,
    ...(org?.subjects || []),
    ...item.sources.map((s) => s.title),
  ]
    .join(' ')
    .toLowerCase()
  return search.includes(query.trim().toLowerCase())
}
const label = (value: string) => value.replace(/[-_]+/g, ' ')
export function organizationOptions(items: LibraryItem[], facets: CatalogueFacets) {
  const collect = (values: string[], defined: Facet[]) => {
    const labels = new Map(defined.map((f) => [f.id, f.label]))
    return [...new Set(values.filter(Boolean))]
      .map((id) => ({ id, label: labels.get(id) || label(id) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  const groups = new Map<string, string>()
  items.forEach((item) => {
    const org = item.organization
    if (org?.sourceGroupId) groups.set(org.sourceGroupId, org.sourceGroupTitle || org.sourceGroupId)
  })
  const repeated = new Map<string, number>()
  groups.forEach((title) => repeated.set(title, (repeated.get(title) || 0) + 1))
  return {
    subjects: collect(
      items.flatMap((item) => item.organization?.subjects || []),
      facets.subjects,
    ),
    regions: collect(
      items.map((item) => item.organization?.region || ''),
      facets.regions,
    ),
    eras: collect(
      items.map((item) => item.organization?.era || ''),
      facets.eras,
    ),
    sources: [...groups]
      .map(([id, title]) => ({ id, label: repeated.get(title)! > 1 ? `${title} · ${id.slice(-6)}` : title }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }
}
