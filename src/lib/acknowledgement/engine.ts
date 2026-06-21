import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

export type SourceKey = 'verified' | 'nativeLand' | 'cad' | 'treaty' | 'reserve' | 'local'
export type MatchType = 'place' | 'municipality' | 'boundary'
export type WordingMode = 'short' | 'formal' | 'event' | 'institutional'

/** Whose voice the acknowledgement is spoken in. */
export type SpeakerPerspective = 'collective' | 'individual' | 'organization'

export type WordingOptions = {
  includeTreatyContext: boolean
  includePeopleGroupContext: boolean
  /** Speaker voice — defaults to 'collective' (the existing "we" framing). */
  perspective?: SpeakerPerspective
  /** Organization name, used when perspective is 'organization'. */
  organizationName?: string
}

export type RelationshipSource = {
  id: string
  title: string
  url: string
  sourceType: string
}

export type PeopleGroupRecord = {
  id: string
  preferredName: string
  alternateNames?: string[]
  displayName: string
}

export type NationRecord = {
  id: string
  preferredName: string
  alternateNames?: string[]
  peopleGroupIds?: string[]
}

export type ReferenceAreaRecord = {
  id: string
  name: string
  nationId?: string
  areaType: string
  geometryStatus: 'reference_map_only' | 'available_geojson' | 'manual_review'
  geometrySource?: {
    dataset: 'native-land' | 'indigenous'
    category: 'territories' | 'languages' | 'treaties' | 'first_nations_treaty_areas' | 'first_nations_treaty_lands'
    property: string
    value: string
  }
  sourceRefs: string[]
  caveat: string
}

export type PlaceRecord = {
  id: string
  name: string
  type: string
  locationNames?: string[]
  addressAliases?: string[]
}

export type PlaceRelationshipRecord = {
  id: string
  placeId: string
  relationshipType:
    | 'traditional_territory'
    | 'traditional_territories'
    | 'traditional_lands'
    | 'on_or_near_traditional_territories'
    | 'village_lands_within_treaty'
    | 'academic_campus_on_territory'
    | 'operations_on_territories'
    | 'campus_on_territory'
    | 'campus_on_peoples_territory'
  territoryStatus?: 'unceded'
  territoryQualifiers?: string[]
  treatyId?: string
  treatyName?: string
  landName?: string
  languageContext?: string[]
  nationIds: string[]
  peopleGroupIds?: string[]
  nationPeopleGroups?: Record<string, string[]>
  referenceAreaIds?: string[]
  verificationStatus: string
  sourceRefs: string[]
}

export type RelationshipGraph = {
  generatedAt: string
  notes?: string[]
  sources: RelationshipSource[]
  peopleGroups: PeopleGroupRecord[]
  nations: NationRecord[]
  referenceAreas?: ReferenceAreaRecord[]
  places: PlaceRecord[]
  placeRelationships: PlaceRelationshipRecord[]
}

export type GeocodeLike = {
  fullAddress: string
  latitude: number
  longitude: number
}

export type MatchedRelationshipPlace = {
  place: PlaceRecord
  relationships: PlaceRelationshipRecord[]
}

export type SourceMatch = {
  source: SourceKey
  name: string
  label: string
  detail?: string
  /** Curated trust level, set only on `verified` matches (from the relationship record). */
  verificationStatus?: string
}

export type GeometryUrlResolver = (source: ReferenceAreaRecord['geometrySource']) => string | null
export type GeoJsonLoader = (url: string) => Promise<GeoJSON.FeatureCollection>

type FeatureProperties = Record<string, unknown>

export const defaultWordingOptions: WordingOptions = {
  includeTreatyContext: true,
  includePeopleGroupContext: true,
}

export function formatList(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/first nation|indian band|band|treaty area|treaty lands/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function candidateId(name: string) {
  return normalizeName(name).replace(/\s+/g, '-') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/**
 * Index of normalized Nation name (preferred + alternates) -> stable nation.id,
 * so source matches that name a Nation differently still resolve to one identity.
 */
export function buildNationAliasIndex(graph: RelationshipGraph): Map<string, string> {
  const index = new Map<string, string>()
  for (const nation of graph.nations) {
    const add = (name: string | undefined) => {
      if (!name) return
      const key = normalizeName(name)
      if (key && !index.has(key)) index.set(key, nation.id)
    }
    add(nation.preferredName)
    nation.alternateNames?.forEach(add)
  }
  return index
}

/** Resolve a free-text Nation name to a graph nation.id via the alias index. */
export function resolveNationId(name: string, index: Map<string, string>): string | undefined {
  return index.get(normalizeName(name))
}

export function sourceTitle(graph: RelationshipGraph | null, sourceId: string) {
  return graph?.sources.find((source) => source.id === sourceId)?.title ?? sourceId
}

export function nationName(graph: RelationshipGraph, nationId: string) {
  return graph.nations.find((nation) => nation.id === nationId)?.preferredName ?? nationId
}

export function peopleGroupName(graph: RelationshipGraph, peopleGroupId: string) {
  return graph.peopleGroups.find((group) => group.id === peopleGroupId)?.displayName ?? peopleGroupId
}

export function referenceAreaLabel(graph: RelationshipGraph, areaId: string) {
  return graph.referenceAreas?.find((area) => area.id === areaId)?.name ?? areaId
}

export function selectedNationIdsForRelationship(
  relationship: PlaceRelationshipRecord,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return relationship.nationIds
  const selected = new Set(selectedIds)
  // Candidate identity is the stable nation.id, so selection matches directly.
  const filtered = relationship.nationIds.filter((nationId) => selected.has(nationId))
  return filtered.length > 0 ? filtered : relationship.nationIds
}

export function peopleGroupIdsForNations(relationship: PlaceRelationshipRecord, nationIds: string[]) {
  if (!relationship.nationPeopleGroups) return relationship.peopleGroupIds ?? []
  const ids = new Set<string>()
  nationIds.forEach((nationId) => {
    relationship.nationPeopleGroups?.[nationId]?.forEach((peopleGroupId) => ids.add(peopleGroupId))
  })
  return Array.from(ids)
}

export function buildAffiliationSentence(graph: RelationshipGraph, relationship: PlaceRelationshipRecord, nationIds: string[]) {
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

export function relationshipCorePhrase(
  graph: RelationshipGraph,
  relationship: PlaceRelationshipRecord,
  selectedIds: string[] = [],
  options: WordingOptions = defaultWordingOptions,
) {
  const nationIds = selectedNationIdsForRelationship(relationship, selectedIds)
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

/** Prefix a core phrase with "on" unless it already opens with one (e.g. "on Village Lands"). */
function onPhrase(core: string) {
  return /^on\b/i.test(core) ? core : `on ${core}`
}

// Acknowledgements lead with the territory itself — the matched place name is
// intentionally NOT spoken. An institution name therefore only appears when the
// speaker is an organization (via organizationName); it never leaks into the
// individual/community voice, nor onto a point that merely falls inside a
// nearby territory polygon. `ctx.place` is kept for callers but left unspoken.
function composeAcknowledgement(
  mode: WordingMode,
  perspective: SpeakerPerspective,
  ctx: { place: string; core: string; affiliation: string; organizationName?: string },
) {
  const { core, affiliation } = ctx
  const situated = onPhrase(core)

  if (perspective === 'individual') {
    if (mode === 'short') return `I am ${situated}.`
    if (mode === 'formal') return `I respectfully acknowledge that I am ${situated}. ${affiliation}`.trim()
    if (mode === 'institutional') return `I am ${situated}. ${affiliation}`.trim()
    return `I am grateful to be ${situated}. ${affiliation}`.trim()
  }

  if (perspective === 'organization') {
    const org = ctx.organizationName?.trim() || 'Our organization'
    if (mode === 'short') return `${org} operates ${situated}.`
    if (mode === 'formal') return `${org} respectfully acknowledges that it operates ${situated}. ${affiliation}`.trim()
    if (mode === 'institutional') return `${org} operates ${situated}. ${affiliation}`.trim()
    return `On behalf of ${org}, we are grateful to gather ${situated}. ${affiliation}`.trim()
  }

  // collective (default)
  if (mode === 'short') return `We are ${situated}.`
  if (mode === 'formal') return `We respectfully acknowledge that we are ${situated}. ${affiliation}`.trim()
  if (mode === 'institutional') return `We are ${situated}. ${affiliation}`.trim()
  return `We are grateful to gather ${situated}. ${affiliation}`.trim()
}

export function buildRelationshipAcknowledgement(
  mode: WordingMode,
  graph: RelationshipGraph,
  match: MatchedRelationshipPlace,
  selectedIds: string[] = [],
  options: WordingOptions = defaultWordingOptions,
) {
  const phrases = match.relationships.map((relationship) => relationshipCorePhrase(graph, relationship, selectedIds, options))
  const core = phrases.length === 1 ? phrases[0] : formatList(phrases)
  const affiliation = options.includePeopleGroupContext
    ? match.relationships
      .map((relationship) => buildAffiliationSentence(graph, relationship, selectedNationIdsForRelationship(relationship, selectedIds)))
      .filter(Boolean)
      .join(' ')
    : ''

  return composeAcknowledgement(mode, options.perspective ?? 'collective', {
    place: match.place.name,
    core,
    affiliation,
    organizationName: options.organizationName,
  })
}

export function buildFallbackAcknowledgement(
  mode: WordingMode,
  nationNames: string[],
  options: { perspective?: SpeakerPerspective; organizationName?: string } = {},
) {
  const names = nationNames.length > 0 ? formatList(nationNames) : '[selected Nation(s)]'
  const territories = `the traditional territories of ${names}`
  const perspective = options.perspective ?? 'collective'

  if (perspective === 'individual') {
    if (mode === 'short') return `I am on ${territories}.`
    if (mode === 'formal') return `I respectfully acknowledge that I am on ${territories}. I recognize the histories, cultures, rights, and ongoing relationships of these Nations with these lands.`
    if (mode === 'institutional') return `I work on ${territories}.`
    return `I am grateful to be on ${territories}. I recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
  }

  if (perspective === 'organization') {
    const org = options.organizationName?.trim() || 'Our organization'
    if (mode === 'short') return `${org} operates on ${territories}.`
    if (mode === 'formal') return `${org} respectfully acknowledges that it operates on ${territories}. We recognize the histories, cultures, rights, and ongoing relationships of these Nations with these lands.`
    if (mode === 'institutional') return `${org} operates on ${territories}.`
    return `On behalf of ${org}, we are grateful to gather on ${territories}. We recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
  }

  if (mode === 'short') {
    return `This place is on ${territories}.`
  }

  if (mode === 'formal') {
    return `We respectfully acknowledge that we are on ${territories}. We recognize the histories, cultures, rights, and ongoing relationships of these Nations with these lands.`
  }

  if (mode === 'institutional') {
    return `We work on ${territories}.`
  }

  return `We are grateful to gather on ${territories}. We recognize the continuing presence, rights, and stewardship of Indigenous Peoples.`
}

/**
 * Region-wide acknowledgement for operations spread across many territories
 * (e.g. a provincial Crown agency). Names a region instead of specific Nations,
 * in any of the three speaker voices.
 */
export function buildRegionalAcknowledgement(
  mode: WordingMode,
  options: { perspective?: SpeakerPerspective; organizationName?: string; regionName?: string } = {},
) {
  const region = options.regionName?.trim() || 'British Columbia'
  const territories = `the traditional territories of First Nations across ${region}`
  const perspective = options.perspective ?? 'collective'

  if (perspective === 'individual') {
    if (mode === 'short') return `I acknowledge ${territories}.`
    if (mode === 'formal') return `I respectfully acknowledge ${territories}, and the rights, cultures, and ongoing relationships of Indigenous Peoples with these lands.`
    if (mode === 'institutional') return `I carry out my work on ${territories}.`
    return `I am grateful to live and work on ${territories}.`
  }

  if (perspective === 'organization') {
    const org = options.organizationName?.trim() || 'Our organization'
    if (mode === 'short') return `${org} operates on ${territories}.`
    if (mode === 'formal') return `${org} respectfully acknowledges that it operates on ${territories}, and recognizes the rights, cultures, and ongoing relationships of Indigenous Peoples with these lands.`
    if (mode === 'institutional') return `${org} operates on ${territories}.`
    return `On behalf of ${org}, we are grateful to carry out our work on ${territories}.`
  }

  if (mode === 'short') return `We acknowledge ${territories}.`
  if (mode === 'formal') return `We respectfully acknowledge ${territories}, and recognize the rights, cultures, and ongoing relationships of Indigenous Peoples with these lands.`
  if (mode === 'institutional') return `We carry out our work on ${territories}.`
  return `We are grateful to gather and work on ${territories}.`
}

export function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function relationshipPlaceScore(place: PlaceRecord, result: GeocodeLike, addressInput: string) {
  const haystack = normalizeMatchText(`${result.fullAddress} ${addressInput}`)
  const addressScore = (place.addressAliases ?? []).reduce((score, alias) => {
    const normalizedAlias = normalizeMatchText(alias)
    if (!normalizedAlias) return score
    return haystack.includes(normalizedAlias) ? Math.max(score, normalizedAlias.length + (place.type === 'municipality' ? 0 : 1000)) : score
  }, 0)

  if (addressScore > 0) return addressScore

  return [place.name, ...(place.locationNames ?? [])].reduce((score, alias) => {
    const normalizedAlias = normalizeMatchText(alias)
    if (!normalizedAlias) return score
    return haystack.includes(normalizedAlias) ? Math.max(score, normalizedAlias.length) : score
  }, 0)
}

export function placeMatchType(place: PlaceRecord): MatchType {
  return place.type === 'municipality' ? 'municipality' : 'place'
}

export function matchRelationshipPlace(
  graph: RelationshipGraph,
  result: GeocodeLike,
  addressInput: string,
  enabledMatchTypes: Record<MatchType, boolean>,
): MatchedRelationshipPlace | null {
  const ranked = graph.places
    .filter((place) => enabledMatchTypes[placeMatchType(place)])
    .map((place) => ({ place, score: relationshipPlaceScore(place, result, addressInput) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  const place = ranked[0]?.place
  if (!place) return null

  const relationships = graph.placeRelationships.filter((relationship) => relationship.placeId === place.id)
  return relationships.length > 0 ? { place, relationships } : null
}

export async function relationshipReferencesPoint(
  graph: RelationshipGraph,
  relationship: PlaceRelationshipRecord,
  lat: number,
  lng: number,
  resolveGeometryUrl: GeometryUrlResolver,
  loadGeoJsonLayer: GeoJsonLoader,
) {
  const pt = point([lng, lat])
  const referenceAreas = relationship.referenceAreaIds
    ?.map((areaId) => graph.referenceAreas?.find((area) => area.id === areaId))
    .filter((area): area is ReferenceAreaRecord => Boolean(area?.geometrySource)) ?? []

  for (const area of referenceAreas) {
    const source = area.geometrySource
    if (!source) continue
    const url = resolveGeometryUrl(source)
    if (!url) continue
    const collection = await loadGeoJsonLayer(url)
    for (const feature of collection.features) {
      const properties = (feature.properties ?? {}) as FeatureProperties
      if (String(properties[source.property] ?? '') !== source.value) continue
      const geometry = feature.geometry
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
      if (booleanPointInPolygon(pt, geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)) return true
    }
  }

  return false
}

export async function matchBoundaryRelationshipPlace(
  graph: RelationshipGraph,
  result: GeocodeLike,
  resolveGeometryUrl: GeometryUrlResolver,
  loadGeoJsonLayer: GeoJsonLoader,
): Promise<MatchedRelationshipPlace | null> {
  for (const relationship of graph.placeRelationships) {
    if (!relationship.referenceAreaIds?.length) continue
    const place = graph.places.find((place) => place.id === relationship.placeId)
    // A boundary hit only proves the point sits inside a territory polygon — not
    // that it is at a specific campus. Resolve those to the generic territory
    // context places only, never to an institution/campus-specific place; that
    // way a point near (but not at) UBC reads as Musqueam territory, not "at UBC".
    if (!place || place.type !== 'boundary_reference_area') continue
    if (!(await relationshipReferencesPoint(graph, relationship, result.latitude, result.longitude, resolveGeometryUrl, loadGeoJsonLayer))) continue
    return { place, relationships: [relationship] }
  }
  return null
}

export function uniqueMatches(matches: SourceMatch[]) {
  const seen = new Set<string>()
  return matches.filter((match) => {
    const key = `${match.source}:${normalizeName(match.name)}:${match.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function relationshipMatches(graph: RelationshipGraph, match: MatchedRelationshipPlace): SourceMatch[] {
  return uniqueMatches(match.relationships.flatMap((relationship) => (
    relationship.nationIds.map((nationId) => ({
      source: 'verified' as SourceKey,
      name: nationName(graph, nationId),
      label: `${match.place.name}: ${relationship.relationshipType.replace(/_/g, ' ')}`,
      detail: [
        ...relationship.sourceRefs.map((sourceRef) => sourceTitle(graph, sourceRef)),
        ...(relationship.referenceAreaIds ?? []).map((areaId) => referenceAreaLabel(graph, areaId)),
      ].join(' / '),
      verificationStatus: relationship.verificationStatus,
    }))
  )))
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)))
}

export type MultiPointInput = { latitude: number; longitude: number; nationNames: string[] }

export type MultiPointSummary = {
  /** Deduped union of Nation names across all points, in first-seen order. */
  nationNames: string[]
  pointCount: number
  distinctNationCount: number
  /** Largest pairwise distance between points, in km. */
  maxSpreadKm: number
  /** True when the footprint is wide/many-Nationed enough to prefer a regional statement. */
  suggestRegional: boolean
}

export type MultiPointAcknowledgementOptions = {
  perspective?: SpeakerPerspective
  organizationName?: string
  regionName?: string
  nationNames?: string[]
  forceRegional?: boolean
  forceSpecific?: boolean
}

/**
 * Fold a set of mapped points (each already resolved to its Nation names) into a
 * single relationship: the union of Nations, how spread out they are, and whether
 * that footprint is broad enough to recommend the region-wide template.
 */
export function summarizeMultiPoint(
  points: MultiPointInput[],
  opts: { maxNations?: number; maxSpreadKm?: number } = {},
): MultiPointSummary {
  const maxNations = opts.maxNations ?? 4
  const maxSpreadKm = opts.maxSpreadKm ?? 300

  const seen = new Set<string>()
  const nationNames: string[] = []
  for (const point of points) {
    for (const raw of point.nationNames) {
      const name = raw.trim()
      if (name && !seen.has(name)) {
        seen.add(name)
        nationNames.push(name)
      }
    }
  }

  let spread = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      spread = Math.max(spread, haversineKm(points[i].latitude, points[i].longitude, points[j].latitude, points[j].longitude))
    }
  }

  return {
    nationNames,
    pointCount: points.length,
    distinctNationCount: nationNames.length,
    maxSpreadKm: spread,
    suggestRegional: nationNames.length > maxNations || spread > maxSpreadKm,
  }
}

export function buildMultiPointAcknowledgement(
  mode: WordingMode,
  summary: MultiPointSummary,
  options: MultiPointAcknowledgementOptions = {},
) {
  const { nationNames = summary.nationNames, forceRegional, forceSpecific, ...wordingOptions } = options
  if (forceRegional || (!forceSpecific && summary.suggestRegional)) {
    return buildRegionalAcknowledgement(mode, wordingOptions)
  }
  return buildFallbackAcknowledgement(mode, nationNames, wordingOptions)
}

function nameMatches(a: string, b: string) {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) && b.length >= 4) return true
  if (b.includes(a) && a.length >= 4) return true
  return false
}

export type NationSetComparison = {
  /** Expected Nations our resolution did surface. */
  matched: string[]
  /** Expected Nations our resolution missed. */
  missed: string[]
  /** Nations our resolution surfaced that the org does not name (noise / over-resolution). */
  extra: string[]
}

/**
 * Compare what an organization names (`expected`) against what our engine
 * resolved (`actual`), using normalized fuzzy matching so e.g. "Musqueam"
 * lines up with "xʷməθkʷəy̓əm (Musqueam)".
 */
export function compareNationSets(expected: string[], actual: string[]): NationSetComparison {
  const normActual = actual.map((value) => normalizeName(value))
  const normExpected = expected.map((value) => normalizeName(value))

  const matched: string[] = []
  const missed: string[] = []
  expected.forEach((name, index) => {
    (normActual.some((value) => nameMatches(value, normExpected[index])) ? matched : missed).push(name)
  })
  const extra = actual.filter((_, index) => !normExpected.some((value) => nameMatches(value, normActual[index])))
  return { matched, missed, extra }
}
