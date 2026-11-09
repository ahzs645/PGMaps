/** Portable review packages. Importing history never grants permission to reuse a road. */
import { MAX_HISTORY_IMPORT_BYTES, assessHistoricalPath, parseAccessHistoryState } from './accessHistory'
import type { HistoricalAccessState } from './accessHistoryTypes'
import { parseProject } from './project'
import { createDemoProject } from './terrain'
import type { ContextFeature, RoadProject } from './types'

export interface AccessHistoryBundle {
  schema: 'pgmaps-access-history-bundle-v1'
  context: ContextFeature[]
  accessHistory: HistoricalAccessState
}

function checkBytes(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_HISTORY_IMPORT_BYTES)
    throw Error('Import at most 10 MB of access history. Split larger study areas.')
}

export function parseAccessHistoryBundle(text: string): AccessHistoryBundle {
  checkBytes(text)
  const raw: unknown = JSON.parse(text)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Access history must be a JSON object.')
  const record = raw as Record<string, unknown>
  if (record.schema !== 'pgmaps-access-history-bundle-v1')
    throw Error('Choose an exported PGMaps access-history bundle.')
  if (
    !Array.isArray(record.context) ||
    record.context.some(
      (feature) => !feature || !['harvest', 'existing-road'].includes(String((feature as ContextFeature).kind)),
    )
  )
    throw Error('An access-history bundle may contain only cutblocks and existing roads.')
  // The shared project parser checks coordinates, counts, feature IDs and all evidence fields.
  const context = parseProject({ ...createDemoProject(), context: record.context }).context
  return {
    schema: 'pgmaps-access-history-bundle-v1',
    context,
    accessHistory: parseAccessHistoryState(record.accessHistory, context),
  }
}

export function accessHistoryBundle(context: readonly ContextFeature[], accessHistory: HistoricalAccessState): string {
  const selected = context.filter((feature) => feature.kind === 'harvest' || feature.kind === 'existing-road')
  const text = JSON.stringify({ schema: 'pgmaps-access-history-bundle-v1', context: selected, accessHistory }, null, 2)
  // Export the same bounded, validated format the importer accepts.
  parseAccessHistoryBundle(text)
  return text
}

/** Keep unrelated project data and reject ambiguous feature replacement before changing anything. */
export function applyAccessHistoryBundle(project: RoadProject, bundle: AccessHistoryBundle): RoadProject {
  const context = [...project.context]
  const normalized = new Map(parseProject(project).context.map((feature) => [feature.id, feature]))
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
        : item,
    )
  for (const incoming of bundle.context) {
    const existing = context.find((feature) => feature.id === incoming.id)
    if (existing) {
      // Current reuse choices are outside historical evidence and are not overwritten by a bundle.
      const comparable = (feature: ContextFeature) => ({
        ...feature,
        ...(feature.roadEvidence ? { roadEvidence: { ...feature.roadEvidence, reuseAllowed: false } } : {}),
      })
      if (canonical(comparable(normalized.get(existing.id)!)) !== canonical(comparable(incoming)))
        throw Error(`Feature ${incoming.id} already exists with different data. Resolve its identity before importing.`)
      continue
    }
    context.push({
      ...incoming,
      ...(incoming.roadEvidence ? { roadEvidence: { ...incoming.roadEvidence, reuseAllowed: false } } : {}),
    })
  }
  return parseProject({ ...project, context, accessHistory: parseAccessHistoryState(bundle.accessHistory, context) })
}

const md = (value: unknown) =>
  String(value ?? 'unknown')
    .replace(/[\\`*_{}[\]<>|]/g, '\\$&')
    .replace(/\r?\n/g, ' ')
const windowLabel = (when: { earliest: string | null; latest: string | null } | null) =>
  when ? `${when.earliest ?? 'unknown'} to ${when.latest ?? 'unknown'}` : 'unknown'

/** The report retains source identifiers, uncertainties and superseded assertions for review. */
export function accessHistoryReport(
  projectName: string,
  context: readonly ContextFeature[],
  state: HistoricalAccessState,
): string {
  const lines = [
    `# Historical access review — ${md(projectName)}`,
    '',
    `As of: **${md(state.settings.asOf)}**.`,
    '',
    'Historical route candidates describe evidence and network connections. They do not authorize current road use or establish construction purpose, legal access, bridge capacity or engineering suitability.',
    '',
    '## Trace settings',
    '',
    `- Include roads and structures with unknown timing: ${state.settings.allowUnknownTime ? 'yes; explicit assumption' : 'no'}.`,
    `- Allow unverified endpoint connections: ${state.settings.allowUnverifiedEndpointSnaps ? 'yes; explicit assumption' : 'no'}.`,
    `- Endpoint tolerance: ${state.settings.snapToleranceM} m. Attachment tolerance: ${state.settings.attachmentToleranceM} m.`,
    '',
    '## Saved route assertions',
    '',
  ]
  if (!state.paths.length) lines.push('No route assertions saved.', '')
  for (const path of state.paths) {
    const assessment = assessHistoricalPath(path, state, context)
    lines.push(
      `### ${md(path.id)}`,
      '',
      `Block: ${md(context.find((feature) => feature.id === path.blockId)?.name ?? path.blockId)}. Relationship: **${md(path.relationship)}**.`,
      '',
      `Period: ${md(windowLabel(path.period))}. Length: ${path.lengthM.toFixed(1)} m.`,
      '',
      `Settings retained with this assertion: date ${md(path.settings.asOf)}; unknown road timing ${path.settings.allowUnknownTime ? 'allowed explicitly' : 'excluded'}; unverified endpoint connections ${path.settings.allowUnverifiedEndpointSnaps ? 'allowed explicitly' : 'excluded'}; endpoint tolerance ${path.settings.snapToleranceM} m; anchor tolerance ${path.settings.attachmentToleranceM} m.`,
      '',
      `Roads: ${path.roadIds.map(md).join(', ') || 'none'}. Structures: ${path.structureIds.map(md).join(', ') || 'none'}.`,
      '',
      `Source records: ${path.sourceIds.map(md).join(', ') || 'none'}.`,
      '',
      `Recalculation assessment: ${md(JSON.stringify(assessment))}.`,
      '',
    )
    if (path.review)
      lines.push(
        `Reviewed by ${md(path.review.reviewer)} on ${md(path.review.reviewedOn)}; reference: ${md(path.review.reference)}.`,
        '',
      )
    for (const assumption of path.assumptions) lines.push(`- ${md(assumption)}`)
    lines.push('')
  }
  lines.push('## Entrances and outlets', '')
  for (const anchor of state.anchors)
    lines.push(
      `- ${md(anchor.name)} (${md(anchor.id)}): ${anchor.role}; [${anchor.coordinate.join(', ')}]; road ${md(anchor.roadId)}; block ${md(anchor.blockId)}; sources ${anchor.sourceIds.map(md).join(', ') || 'none'}.`,
    )
  lines.push('', '## Road events', '')
  if (!state.events.length) lines.push('No physical road events recorded.')
  for (const event of state.events)
    lines.push(
      `- ${md(event.id)}: road ${md(event.roadId)}, ${md(event.kind)}, event ${md(windowLabel(event.when))}, observed ${md(event.observedOn)}; sources ${event.sourceIds.map(md).join(', ') || 'none'}; extent ${md(event.geometryFingerprint)}.`,
    )
  lines.push('', '## Structures and reported restrictions', '')
  if (!state.structures.length)
    lines.push('No structures recorded; this does not establish that the route has no crossings.')
  for (const structure of state.structures) {
    lines.push(
      `### ${md(structure.name)} (${md(structure.id)})`,
      '',
      `Type: ${md(structure.kind)}. Crossing site: ${md(structure.crossingSiteId)}. Structure: ${md(structure.structureId)}. Source row: ${md(structure.sourceRowId)}.`,
      '',
      `Road: ${md(structure.roadId)}; permit/section ${structure.roadKey ? `${md(structure.roadKey.forestFileId)} / ${md(structure.roadKey.roadSectionId)}` : 'unknown'}; ${md(structure.attachment)} attachment within ${structure.attachmentToleranceM} m. Construction: ${md(windowLabel(structure.construction))}; removal: ${md(windowLabel(structure.removal))}.`,
      '',
      `Sources: ${structure.sourceIds.map(md).join(', ') || 'none'}.`,
      '',
    )
    for (const evidence of structure.evidence)
      lines.push(
        `- ${md(evidence.kind)}: ${md(evidence.description)}. Reported rating: ${evidence.ratedLoadTonnes === null ? 'unknown' : `${evidence.ratedLoadTonnes} t`}; valid ${md(evidence.validFrom)} to ${md(evidence.validUntil)}; sources ${evidence.sourceIds.map(md).join(', ') || 'none'}.`,
      )
    lines.push('')
  }
  lines.push('## Sources', '')
  for (const source of state.sources)
    lines.push(
      `- **${md(source.id)} — ${md(source.dataset)}**, record ${md(source.recordId)}${source.synthetic ? ' (synthetic teaching record)' : ''}. Published ${md(source.publishedOn)}; retrieved ${md(source.retrievedAt)}. ${md(source.description)} ${source.url}`,
    )
  return `${lines.join('\n')}\n`
}
