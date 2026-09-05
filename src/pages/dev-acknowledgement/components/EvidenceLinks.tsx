import type { BuilderLocation } from '../builder'
import type { RelationshipGraph } from '../types'

export function EvidenceLinks({
  location,
  graph,
  nationId,
}: {
  location: BuilderLocation
  graph: RelationshipGraph | null
  nationId?: string
}) {
  const sourceIds = new Set(
    location.match?.relationships
      .filter((item) => !nationId || item.nationIds.includes(nationId))
      .flatMap((item) => item.sourceRefs) ?? [],
  )
  const sources = graph?.sources.filter((source) => sourceIds.has(source.id)) ?? []
  return (
    <div className="space-y-1 text-sm">
      {sources.map((source) => (
        <a
          key={source.id}
          className="block break-words py-2 text-teal-800 underline underline-offset-2"
          href={source.url}
          target="_blank"
          rel="noreferrer"
        >
          {source.title}
        </a>
      ))}
      {sources.length > 0 && (
        <p className="text-xs text-slate-500">
          Curated record snapshot: {graph?.generatedAt}. Check the linked source for current guidance.
        </p>
      )}
      {!sources.length && (
        <p className="text-sm leading-6 text-slate-600">
          No curated source matched this selection. Confirm local guidance before using map evidence in wording.
        </p>
      )}
    </div>
  )
}
