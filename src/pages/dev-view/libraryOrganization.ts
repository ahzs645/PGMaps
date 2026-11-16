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

/** The filter each key sets, for a chip that names it and a field that labels it. */
export const FILTER_FIELDS: { key: keyof OrganizationFilters; title: string; all: string }[] = [
  { key: 'subject', title: 'Subject', all: 'All subjects' },
  { key: 'region', title: 'Region', all: 'All regions' },
  { key: 'era', title: 'Map date', all: 'Any map date' },
  { key: 'sourceGroup', title: 'Source document', all: 'All source documents' },
  { key: 'confidence', title: 'Placement', all: 'Any placement' },
]
export const PLACEMENT_OPTIONS: Facet[] = [
  { id: 'provisional', label: 'Provisional' },
  { id: 'experimental', label: 'Experimental' },
]
export type FilterOptions = ReturnType<typeof organizationOptions>

/** The choices one filter offers; placement has none for source images, which carry no placement. */
export function filterChoices(key: keyof OrganizationFilters, options: FilterOptions, sourceMode: boolean): Facet[] {
  if (key === 'subject') return options.subjects
  if (key === 'region') return options.regions
  if (key === 'era') return options.eras
  if (key === 'sourceGroup') return options.sources
  return sourceMode ? [] : PLACEMENT_OPTIONS
}

/** The filters that are narrowing the list, each with the label of the value it holds. */
export function activeFilters(values: OrganizationFilters, options: FilterOptions, sourceMode: boolean) {
  return FILTER_FIELDS.flatMap(({ key, title }) => {
    const value = values[key]
    if (!value || (sourceMode && key === 'confidence')) return []
    const choice = filterChoices(key, options, sourceMode).find((facet) => facet.id === value)
    return [{ key, title, label: choice?.label || label(value) }]
  })
}

/**
 * How many cards fit across the library: two on any phone, then as many as keep a card wide enough
 * for its thumbnail to read as a map.
 */
export function libraryColumns(width: number) {
  if (width < 600) return width < 260 ? 1 : 2
  return Math.min(8, Math.floor((width + 16) / (264 + 16)))
}

/** A date worth a line on a card: catalogues write "Date unknown" on records that have none. */
export function knownDate(dateLabel: string | undefined) {
  const value = dateLabel?.trim()
  return value && !/^(date|map date) (unknown|not (recorded|established))\.?$/i.test(value) ? value : ''
}

/** The count line above the cards, naming what the current scope lists. */
export function resultCount(shown: number, total: number, scope: 'featured' | 'all' | 'sources') {
  const [one, many] =
    scope === 'sources'
      ? ['source image', 'source images']
      : scope === 'featured'
        ? ['selection', 'selections']
        : ['map', 'maps']
  const number = (value: number) => value.toLocaleString('en-CA')
  return shown === total
    ? `${number(total)} ${total === 1 ? one : many}`
    : `${number(shown)} of ${number(total)} ${many}`
}
