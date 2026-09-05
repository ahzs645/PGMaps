import type { ResearchRecord, ResearchRecordsTimelineBucket } from './researchRecordsTypes'

export function filterResearchRecords(
  records: ResearchRecord[],
  query: string,
  types: Set<string>,
  fields: Array<'title' | 'author' | 'tags'>,
  decade: number | null = null,
) {
  const normalized = query.trim().toLowerCase()
  return records.filter(
    (record) =>
      (decade === null || record.decade === decade) &&
      (types.size === 0 || types.has(record.resourceTypeMain)) &&
      (!normalized ||
        fields.some((field) =>
          field === 'tags'
            ? record.tags.some((tag) => tag.toLowerCase().includes(normalized))
            : record[field]?.toLowerCase().includes(normalized),
        )),
  )
}

export function summarizeResearchDecades(
  records: ResearchRecord[],
  buckets: ResearchRecordsTimelineBucket[],
): ResearchRecordsTimelineBucket[] {
  const result = new Map(
    buckets.map((bucket) => [
      bucket.decade,
      { decade: bucket.decade, total: 0, byResourceType: {} as Record<string, number> },
    ]),
  )
  for (const record of records) {
    if (record.decade === null) continue
    const bucket = result.get(record.decade) ?? { decade: record.decade, total: 0, byResourceType: {} }
    bucket.total++
    bucket.byResourceType[record.resourceTypeMain] = (bucket.byResourceType[record.resourceTypeMain] ?? 0) + 1
    result.set(record.decade, bucket)
  }
  return [...result.values()].sort((a, b) => a.decade - b.decade)
}
