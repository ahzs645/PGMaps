import {
  effectiveClass,
  FISH_LABELS,
  RIPARIAN_RULES,
  RIPARIAN_WIDTHS,
  STREAM_STATUS_LABELS,
  streamStatus,
  suggestRiparianClass,
  WATERSHED_LABELS,
} from './streamClass'
import { BC_STREAM_SOURCES } from './provincialStreamData'
import { CONSTRAINT_LABELS, resolveConstraint } from './constraints'
import { constraintRouteIssues, riparianArea } from './riparian'
import type { ContextFeature, RoadAnalysis, RoadProject } from './types'

const html = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const csv = (value: unknown) => {
  let text = String(value ?? '')
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function streamRow(stream: ContextFeature) {
  const a = stream.streamAssessment
  const shown = effectiveClass(a)
  const status = streamStatus(a, stream.geometry.coordinates)
  return {
    a,
    shown,
    status,
    widths: shown ? RIPARIAN_WIDTHS[shown] : null,
    suggestion: a ? suggestRiparianClass(a) : null,
  }
}

/** One row per reach; classifications and source evidence remain separate columns. */
export function streamRegisterCsv(project: RoadProject, analyses: Map<string, RoadAnalysis>): string {
  const header = [
    'stream_id',
    'stream_name',
    'imported_class',
    'suggested_class',
    'recorded_review_class',
    'assessment_status',
    'routing_treatment',
    'conditional_review_status',
    'routing_condition',
    'routing_review_basis',
    'channel_width_m',
    'width_basis',
    'width_date',
    'one_km_average_width_m',
    'fish_determination',
    'community_watershed_determination',
    'nominal_reserve_each_side_m',
    'nominal_management_each_side_m',
    'assessor',
    'assessed_on',
    'reviewed_rules',
    'current_rules_id',
    'current_rules_consolidated_to',
    'evidence_url',
    'outstanding',
    'source_dataset',
    'source_record_id',
    'source_retrieved_at',
    'source_query_bounds_wsen',
    'source_stream_order',
    'source_edge_type',
    'crossings_by_road_and_station_m',
    'source_catalogue_url',
    'notes',
  ]
  const rows = project.context
    .filter((f) => f.kind === 'stream')
    .map((f) => {
      const { a, status, widths, suggestion } = streamRow(f)
      const routing = resolveConstraint(f)
      const crossings = project.alignments.flatMap((road) =>
        (analyses.get(road.id)?.crossings ?? [])
          .filter((c) => c.kind === 'stream' && c.featureId === f.id)
          .map((c) => `${road.id}@${c.chainage.toFixed(2)}`),
      )
      return [
        f.id,
        f.name,
        a?.importedClass,
        suggestion?.riparianClass,
        a?.reviewedClass,
        STREAM_STATUS_LABELS[status],
        CONSTRAINT_LABELS[routing.policy.treatment],
        routing.reviewStatus,
        routing.policy.condition,
        routing.policy.review?.basis,
        a?.channelWidthM,
        a?.widthBasis,
        a?.widthDate,
        a?.oneKmAverageWidthM,
        FISH_LABELS[a?.fish ?? 'unresolved'],
        WATERSHED_LABELS[a?.communityWatershed ?? 'unresolved'],
        widths?.reserveM,
        widths?.managementM,
        a?.assessor,
        a?.assessedOn,
        a?.reviewedRules,
        RIPARIAN_RULES.id,
        RIPARIAN_RULES.consolidatedTo,
        a?.evidenceUrl,
        suggestion?.outstanding.join('; '),
        f.streamSource?.dataset,
        f.streamSource?.sourceId,
        f.streamSource?.retrievedAt,
        f.streamSource?.queryBounds.join(', '),
        f.streamSource?.streamOrder,
        f.streamSource?.edgeType,
        crossings.join('; '),
        f.streamSource ? BC_STREAM_SOURCES.streams.catalogueUrl : '',
        a?.notes,
      ]
    })
  return [header, ...rows].map((row) => row.map(csv).join(',')).join('\r\n') + '\r\n'
}

export function streamPlanningReportSection(project: RoadProject, analysis: RoadAnalysis): string {
  const streams = project.context.filter((f) => f.kind === 'stream')
  const data = project.provincialStreamData
  const rows = streams
    .map((f) => {
      const { a, status, widths, suggestion } = streamRow(f)
      const station = analysis.crossings
        .filter((c) => c.kind === 'stream' && c.featureId === f.id)
        .map((c) => c.chainage.toFixed(1))
        .join(', ')
      const source = f.streamSource
        ? `FWA record ${f.streamSource.sourceId}; ${f.streamSource.retrievedAt}; order ${f.streamSource.streamOrder ?? 'unknown'}, arc type ${f.streamSource.edgeType ?? 'unknown'}`
        : 'User/imported linework; no provincial provenance'
      return `<tr><td>${html(f.name)}<br>${html(f.id)}</td><td>${html(a?.importedClass ?? '—')}</td><td>${html(suggestion?.riparianClass ?? 'Unresolved')}</td><td>${html(a?.reviewedClass ?? '—')}<br>${html(STREAM_STATUS_LABELS[status])}</td><td>${html(a?.channelWidthM ?? 'Unknown')}<br>${html(a?.widthBasis ?? '')}</td><td>${html(FISH_LABELS[a?.fish ?? 'unresolved'])}<br>${html(WATERSHED_LABELS[a?.communityWatershed ?? 'unresolved'])}</td><td>${widths ? `${widths.reserveM} / ${widths.managementM}` : 'Unresolved'}</td><td>${html(station || 'No mapped intersection')}</td><td>${html(source)}</td></tr>`
    })
    .join('')
  const evidence = streams
    .filter((s) => s.streamAssessment)
    .map((s) => {
      const { a, suggestion } = streamRow(s)
      return `<li><strong>${html(s.name)}</strong>: ${html(a?.assessor ?? 'Assessor not recorded')}; ${html(a?.assessedOn ?? 'assessment date not recorded')}. Evidence: ${html(a?.evidenceUrl ?? 'not recorded')}. ${html(a?.notes ?? '')}${suggestion?.outstanding.length ? ` Outstanding: ${html(suggestion.outstanding.join('; '))}.` : ''}</li>`
    })
    .join('')
  const retained = new Set(streams.map((s) => s.id))
  const removed = data?.streamFeatureIds.filter((id) => !retained.has(id)).length ?? 0
  const road = project.alignments.find((a) => a.id === project.activeAlignmentId)
  const outsideScope =
    data &&
    road?.points.some(
      ({ coordinate: [x, y] }) => x < data.bounds[0] || x > data.bounds[2] || y < data.bounds[1] || y > data.bounds[3],
    )
  const province = data
    ? `<h3>Provincial source coverage</h3><p>Retrieved ${html(data.retrievedAt)}. Complete ID inventories were fetched and rechecked for the W/S/E/N query bounds ${html(data.bounds.join(', '))}. This is a bounded source query, not an inventory of every actual watercourse. Source contents may change between requests. ${removed ? `${removed} originally loaded stream parts have since been removed from this project.` : ''}${outsideScope ? ' The active road extends outside these query bounds; load evidence for the current corridor.' : ''} Retained reaches from earlier queries carry their own retrieval dates; the counts below describe the latest query.</p><table><thead><tr><th>Source</th><th>Source records</th><th>Catalogue</th></tr></thead><tbody>${Object.entries(
        BC_STREAM_SOURCES,
      )
        .map(
          ([key, source]) =>
            `<tr><td>${html(source.name)}</td><td>${data.sourceCounts[key as keyof typeof data.sourceCounts]}</td><td>${html(source.catalogueUrl)}</td></tr>`,
        )
        .join(
          '',
        )}</tbody></table><p>Fish observations retain their observation dates and coordinates in the saved project and provincial evidence GeoJSON. They are not automatically assigned to a reach. An empty fish query does not support fish absence. Community watershed polygons are mapped designations; no outside-watershed determination is inferred from an empty query.</p>${data.watersheds.length ? `<p>Designations in this scope: ${data.watersheds.map((w) => `${html(w.name)} (${html(w.code ?? w.id)}; ${html(w.legislation ?? 'legislation not recorded')})`).join('; ')}.</p>` : ''}`
    : '<p>No complete provincial stream query is retained in this project. Individual imported reaches may carry their own source metadata. Context completeness is unknown.</p>'
  return `<section class="chapter"><style>.stream-register{table-layout:fixed;font-size:10px}.stream-register td,.stream-register th{overflow-wrap:anywhere;vertical-align:top}</style><h2>Streams and riparian assessment</h2><p>Rules: ${html(RIPARIAN_RULES.citation)}, consolidation ${html(RIPARIAN_RULES.consolidatedTo)}. Source, suggested and recorded classes are separate. Nominal reserve / management widths are metres on each side in slope distance from the channel bank. Map screening areas use horizontal distances and assumed channel width; they are not surveyed regulatory boundaries. Active floodplain extensions, site-specific requirements and S1-A minister-specified reserves require separate review. A stale review remains historical evidence.</p>${streams.length ? `<table class="stream-register"><thead><tr><th>Reach</th><th>Source class</th><th>Rule suggestion</th><th>Recorded review</th><th>Width m / basis</th><th>Fish / watershed evidence</th><th>Reserve / management m</th><th>Active-road station m</th><th>Provenance</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No stream linework is retained. This does not establish the absence of streams.</p>'}${evidence ? `<h3>Assessment evidence and outstanding work</h3><ul>${evidence}</ul>` : ''}${province}</section>`
}

/** Records planning policy independently of a class decision or a priced crossing structure. */
export function constraintPlanningReportSection(project: RoadProject, analysis: RoadAnalysis): string {
  const features = project.context.filter((f) => f.kind === 'stream' || f.kind === 'avoid')
  if (!features.length) return ''
  const issues = constraintRouteIssues(analysis.centerline, features)
  const rows = features
    .map((feature) => {
      const resolved = resolveConstraint(feature)
      const area = riparianArea(feature)
      const review = resolved.policy.review
      const price =
        resolved.policy.treatment === 'avoid-where-practical'
          ? `${resolved.costPerM} CAD/m search penalty; excluded from construction costs`
          : resolved.policy.treatment === 'additional-cost'
            ? `${resolved.costPerM} CAD/m additional cost`
            : 'No price grants permission'
      return [
        feature.name,
        `<td>${html(CONSTRAINT_LABELS[resolved.policy.treatment])}<br>${html(price)}</td><td>${html(resolved.reviewStatus)}${resolved.blocked ? '; route blocked' : '; planning screen permits routing'}</td><td>${area ? `${html(area.outerRadiusM.toFixed(1))} m from mapped centreline; ${area.uncertain ? 'unresolved extent' : html(area.riparianClass)}<br>${html(area.note)}` : 'Supplied polygon'}</td><td>${html(resolved.policy.condition ?? '—')}<br>${review ? `${html(review.reviewer)}; ${html(review.reviewedOn)}; ${html(review.basis)}` : 'No conditional review recorded'}</td>`,
      ] as const
    })
    .reduce(
      (groups, [name, cells]) => {
        // Screens whose treatment, status, extent and basis read the same print once, naming every feature:
        // a road beside one creek network listed ~30 identical rows over five pages.
        const group = groups.find((g) => g.cells === cells)
        if (group) group.names.push(name)
        else groups.push({ names: [name], cells })
        return groups
      },
      [] as { names: string[]; cells: string }[],
    )
    .map(
      ({ names, cells }) =>
        `<tr><td>${names.length > 1 ? `${names.length} features: ` : ''}${html(names.join(', '))}</td>${cells}</tr>`,
    )
    .join('')
  return `<section class="chapter"><h2>Routing constraints and riparian screens</h2><p>These are entered planning treatments. A current conditional review records a person's basis; it is not regulatory approval. Avoidance penalties influence search without becoming construction costs. The stream class and channel width set a preliminary horizontal envelope; actual banks, slope-distance boundaries and active floodplain extensions require review. The final connector check separately examines the full road footprint and structure geometry.</p><table class="stream-register"><thead><tr><th>Feature</th><th>Treatment and cost meaning</th><th>Review status</th><th>Screening extent</th><th>Condition and recorded basis</th></tr></thead><tbody>${rows}</tbody></table><h3>Active fitted centreline</h3>${issues.length ? `<ul>${issues.map((issue) => `<li>${html(issue)}</li>`).join('')}</ul>` : '<p>No intersections with currently blocked planning areas were found along the fitted centreline. This does not establish whole-footprint clearance or regulatory compliance.</p>'}</section>`
}
