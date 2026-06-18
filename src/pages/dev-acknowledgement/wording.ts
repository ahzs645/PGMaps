import { defaultWordingOptions } from './data'
import { candidateId } from './names'
import type {
  MatchedRelationshipPlace,
  PlaceRelationshipRecord,
  RelationshipGraph,
  WordingMode,
  WordingOptions,
} from './types'

export function formatList(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function sourceTitle(graph: RelationshipGraph | null, sourceId: string) {
  return graph?.sources.find((source) => source.id === sourceId)?.title ?? sourceId
}

export function nationName(graph: RelationshipGraph, nationId: string) {
  return graph.nations.find((nation) => nation.id === nationId)?.preferredName ?? nationId
}

function peopleGroupName(graph: RelationshipGraph, peopleGroupId: string) {
  return graph.peopleGroups.find((group) => group.id === peopleGroupId)?.displayName ?? peopleGroupId
}

export function referenceAreaLabel(graph: RelationshipGraph, areaId: string) {
  return graph.referenceAreas?.find((area) => area.id === areaId)?.name ?? areaId
}

export function selectedNationIdsForRelationship(
  graph: RelationshipGraph,
  relationship: PlaceRelationshipRecord,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return relationship.nationIds
  const selected = new Set(selectedIds)
  const filtered = relationship.nationIds.filter((nationId) => selected.has(candidateId(nationName(graph, nationId))))
  return filtered.length > 0 ? filtered : relationship.nationIds
}

function peopleGroupIdsForNations(relationship: PlaceRelationshipRecord, nationIds: string[]) {
  if (!relationship.nationPeopleGroups) return relationship.peopleGroupIds ?? []
  const ids = new Set<string>()
  nationIds.forEach((nationId) => {
    relationship.nationPeopleGroups?.[nationId]?.forEach((peopleGroupId) => ids.add(peopleGroupId))
  })
  return Array.from(ids)
}

function buildAffiliationSentence(graph: RelationshipGraph, relationship: PlaceRelationshipRecord, nationIds: string[]) {
  if (!relationship.nationPeopleGroups) return ''

  const grouped = new Map<string, string[]>()
  nationIds.forEach((nationId) => {
    const peopleGroupIds = relationship.nationPeopleGroups?.[nationId] ?? []
    peopleGroupIds.forEach((peopleGroupId) => {
      const names = grouped.get(peopleGroupId) ?? []
      names.push(nationName(graph, nationId))
      grouped.set(peopleGroupId, names)
    })
  })

  const clauses = Array.from(grouped.entries()).map(([peopleGroupId, names]) => (
    `${formatList(names)} ${names.length === 1 ? 'is' : 'are'} part of the ${peopleGroupName(graph, peopleGroupId)}`
  ))
  return clauses.length > 0 ? `${formatList(clauses)}.` : ''
}

function relationshipCorePhrase(
  graph: RelationshipGraph,
  relationship: PlaceRelationshipRecord,
  selectedIds: string[],
  options: WordingOptions = defaultWordingOptions,
) {
  const nationIds = selectedNationIdsForRelationship(graph, relationship, selectedIds)
  const nations = formatList(nationIds.map((nationId) => nationName(graph, nationId)))
  const peopleGroups = options.includePeopleGroupContext
    ? peopleGroupIdsForNations(relationship, nationIds).map((peopleGroupId) => peopleGroupName(graph, peopleGroupId))
    : []

  if (relationship.relationshipType === 'traditional_lands') {
    const peoplePhrase = peopleGroups.length > 0 ? `the ${formatList(peopleGroups)} of ` : ''
    const treatyPrefix = options.includeTreatyContext && relationship.treatyName ? `${relationship.treatyName} territory on ` : ''
    return `${treatyPrefix}the traditional lands of ${peoplePhrase}${nations}`
  }

  if (relationship.relationshipType === 'operations_on_territories') {
    const status = relationship.territoryStatus === 'unceded' ? 'unceded ' : ''
    const peoplePhrase = peopleGroups.length > 0 ? `the ${formatList(peopleGroups)}, including ` : ''
    return `${status}territories of ${peoplePhrase}${nations}`
  }

  if (relationship.relationshipType === 'campus_on_peoples_territory') {
    const qualifiers = relationship.territoryQualifiers?.length ? `${relationship.territoryQualifiers.join(', ')} ` : ''
    const status = relationship.territoryStatus === 'unceded' ? 'unceded ' : ''
    return `the ${qualifiers}${status}territory of the ${nations}`
  }

  if (relationship.relationshipType === 'academic_campus_on_territory' || relationship.relationshipType === 'campus_on_territory') {
    const qualifiers = relationship.territoryQualifiers?.length ? `${relationship.territoryQualifiers.join(', ')} ` : ''
    const status = relationship.territoryStatus === 'unceded' ? 'unceded ' : ''
    const languagePrefix = options.includePeopleGroupContext && relationship.languageContext?.length
      ? `${formatList(relationship.languageContext)} `
      : ''
    return `the ${qualifiers}${status}territory of the ${languagePrefix}${nations}`
  }

  if (relationship.relationshipType === 'on_or_near_traditional_territories') {
    const status = relationship.territoryStatus === 'unceded' ? 'unceded ' : ''
    const peoplePhrase = peopleGroups.length > 0 ? `${formatList(peopleGroups)} ` : ''
    return `on or near ${status}traditional ${peoplePhrase}territories including ${nations}`
  }

  if (relationship.relationshipType === 'village_lands_within_treaty') {
    const treaty = options.includeTreatyContext && relationship.treatyName ? ` within ${relationship.treatyName} territory` : ''
    return `on ${relationship.landName ?? 'Village Lands'}${treaty}`
  }

  const status = relationship.territoryStatus === 'unceded' ? 'unceded ' : ''
  const territory = relationship.relationshipType === 'traditional_territories' ? 'traditional territories' : 'traditional territory'
  const peoplePhrase = peopleGroups.length === 1 ? `, part of the ${peopleGroups[0]} territory` : ''
  return `${status}${territory} of ${nations}${peoplePhrase}`
}

export function buildRelationshipAcknowledgement(
  mode: WordingMode,
  graph: RelationshipGraph,
  match: MatchedRelationshipPlace,
  selectedIds: string[],
  options: WordingOptions = defaultWordingOptions,
) {
  const phrases = match.relationships.map((relationship) => relationshipCorePhrase(graph, relationship, selectedIds, options))
  const core = phrases.length === 1 ? phrases[0] : formatList(phrases)
  const affiliation = options.includePeopleGroupContext
    ? match.relationships
      .map((relationship) => buildAffiliationSentence(graph, relationship, selectedNationIdsForRelationship(graph, relationship, selectedIds)))
      .filter(Boolean)
      .join(' ')
    : ''

  if (mode === 'short') {
    return `${match.place.name} is situated ${core}.`
  }

  if (mode === 'formal') {
    return `We respectfully acknowledge that ${match.place.name} is situated ${core}. ${affiliation}`.trim()
  }

  if (mode === 'institutional') {
    return `${match.place.name} is situated ${core}. This wording is generated from reviewed relationship records and should remain aligned with local guidance. ${affiliation}`.trim()
  }

  if (mode === 'educational') {
    return `${match.place.name} is situated ${core}. This relationship connects place, Nation, people-group, treaty, and source context so users can review why the wording was suggested. ${affiliation}`.trim()
  }

  return `We are grateful to gather today at ${match.place.name}, situated ${core}. ${affiliation}`.trim()
}

export function buildAcknowledgement(mode: WordingMode, nationNames: string[]) {
  const names = nationNames.length > 0 ? nationNames.join(', ') : '[selected Nation(s)]'

  if (mode === 'short') {
    return `This place is connected to ${names}.`
  }

  if (mode === 'formal') {
    return `We respectfully acknowledge that this place is connected to ${names}. We recognize their histories, cultures, rights, and ongoing relationships with these lands.`
  }

  if (mode === 'institutional') {
    return `This institution is working from lands connected to ${names}. Confirm local wording, protocols, and review status before publication.`
  }

  if (mode === 'educational') {
    return `This location has source signals connected to ${names}. Treat this as a learning and review prompt, not final wording.`
  }

  return `We are grateful to gather on lands connected to ${names}. We recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
}
