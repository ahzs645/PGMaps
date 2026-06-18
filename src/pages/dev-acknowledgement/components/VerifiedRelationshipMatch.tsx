import { ExternalLink, ShieldCheck } from 'lucide-react'

import { formatList, nationName, selectedNationIdsForRelationship } from '../wording'
import type { MatchedRelationshipPlace, RelationshipGraph } from '../types'

type VerifiedRelationshipMatchProps = {
  graph: RelationshipGraph
  match: MatchedRelationshipPlace
  selectedIds: string[]
}

export function VerifiedRelationshipMatch({ graph, match, selectedIds }: VerifiedRelationshipMatchProps) {
  return (
    <section className="rounded-lg border border-teal-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-teal-700" />
        <h2 className="text-sm font-semibold">Verified Relationship Match</h2>
      </div>
      <div className="text-sm">
        <div className="font-semibold text-slate-950">{match.place.name}</div>
        <div className="mt-1 text-xs leading-5 text-slate-600">
          Generated from structured place, Nation, people-group, territory-status, and treaty relationship facts.
        </div>
      </div>
      <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
        {match.relationships.map((relationship) => {
          const nationIds = selectedNationIdsForRelationship(graph, relationship, selectedIds)
          return (
            <div key={relationship.id} className="rounded-md border bg-teal-50/50 p-3">
              <div className="font-semibold text-slate-900">
                {relationship.relationshipType.replace(/_/g, ' ')}
                {relationship.treatyName ? ` · ${relationship.treatyName}` : ''}
              </div>
              <div className="mt-1">
                {formatList(nationIds.map((nationId) => nationName(graph, nationId)))}
              </div>
              {(relationship.referenceAreaIds ?? []).length > 0 && (
                <div className="mt-2 space-y-2">
                  {relationship.referenceAreaIds?.map((areaId) => {
                    const area = graph.referenceAreas?.find((item) => item.id === areaId)
                    if (!area) return null
                    return (
                      <div key={area.id} className="rounded border border-teal-100 bg-white p-2">
                        <div className="font-medium text-slate-900">{area.name}</div>
                        <div className="mt-1 text-slate-500">{area.caveat}</div>
                        <div className="mt-1 text-[10px] font-semibold uppercase text-slate-500">
                          {area.geometryStatus.replace(/_/g, ' ')}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ...relationship.sourceRefs,
                  ...(relationship.referenceAreaIds ?? []).flatMap((areaId) => (
                    graph.referenceAreas?.find((area) => area.id === areaId)?.sourceRefs ?? []
                  )),
                ].filter((sourceRef, index, sourceRefs) => sourceRefs.indexOf(sourceRef) === index).map((sourceRef) => {
                  const source = graph.sources.find((item) => item.id === sourceRef)
                  if (!source) return null
                  return (
                    <a
                      key={sourceRef}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 font-medium text-teal-800"
                    >
                      {source.title}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
