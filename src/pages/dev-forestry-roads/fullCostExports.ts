/** Saved complete-access evidence travels separately from the current engineering estimate. */
import { isFullCostRecordCurrent, type FullCostReviewRecord } from './fullCostRecord'
import type { Alignment, RoadProject, TerrainMetadata } from './types'

export interface FullCostExportEvidence extends Omit<FullCostReviewRecord, 'inputSignature'> {
  inputStatus: 'current' | 'stale'
  basis: string
  reviewedInputs: Pick<RoadProject, 'settings' | 'totalCostPlanning' | 'context'> & {
    modelVersion?: string
    alignment: Omit<Alignment, 'fullCostRecord'>
    terrain: Omit<TerrainMetadata, 'raster'> & {
      raster?: Omit<NonNullable<TerrainMetadata['raster']>, 'values'>
    }
  }
}

/** The canonical signature is decoded once into evidence, rather than repeated as escaped JSON. */
export function fullCostExportEvidence(alignment: Alignment, project: RoadProject): FullCostExportEvidence | null {
  const record = alignment.fullCostRecord
  if (!record) return null
  const inputs = JSON.parse(record.inputSignature) as FullCostExportEvidence['reviewedInputs']
  const snapshot = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'inputSignature')) as Omit<
    FullCostReviewRecord,
    'inputSignature'
  >
  return {
    ...snapshot,
    inputStatus: isFullCostRecordCurrent(alignment, project) ? 'current' : 'stale',
    basis:
      'Saved comparison of screened candidates using entered cost, access and condition assumptions. Current means model inputs match; it does not establish field verification or an exhaustive optimum.',
    reviewedInputs: {
      ...(typeof inputs.modelVersion === 'string' ? { modelVersion: inputs.modelVersion } : {}),
      alignment: inputs.alignment,
      settings: inputs.settings,
      totalCostPlanning: inputs.totalCostPlanning,
      context: inputs.context,
      terrain: inputs.terrain,
    },
  }
}

const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
const amount = (value: number) => value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const components = [
  ['newConstruction', 'New construction'],
  ['internalMaterialHaul', 'Internal material haul'],
  ['newConstructionFixed', 'New construction setup'],
  ['sourceMaterials', 'Supply and disposal materials'],
  ['sourcePreparation', 'Supply site preparation'],
  ['supplyNetworkHaul', 'Network loaded haul and empty return'],
  ['supplyConnectorHaul', 'Connector loaded haul and empty return'],
  ['networkRehabilitation', 'Existing-road rehabilitation'],
  ['networkAccess', 'Network access'],
  ['networkStructures', 'Network structures'],
  ['networkFixed', 'Network setup'],
  ['subtotal', 'Subtotal before contingency'],
  ['contingency', 'Contingency'],
  ['total', 'Recorded complete access total'],
] as const

export function fullCostReportSection(alignment: Alignment | undefined, project: RoadProject): string {
  const record = alignment && fullCostExportEvidence(alignment, project)
  if (!record) return ''
  const paths = [
    { label: 'Access outward: connector to outlet', path: record.accessPath },
    { label: 'Access return: outlet to connector', path: record.accessReturnPath },
    ...record.allocations.flatMap((source) => [
      { label: `${source.sourceName} · ${source.use} · loaded network path`, path: source.path },
      { label: `${source.sourceName} · ${source.use} · empty return network path`, path: source.returnPath },
    ]),
  ]
  const usedRoadIds = new Set(paths.flatMap(({ path }) => path.roadIds))
  const roadEvidence = record.reviewedInputs.context.filter((feature) => feature && usedRoadIds.has(feature.id))
  const sourceIds = new Set(record.allocations.map((allocation) => allocation.sourceId))
  const recordedSources = record.reviewedInputs.totalCostPlanning?.sources
  const sources = Array.isArray(recordedSources)
    ? recordedSources.filter((source) => source && sourceIds.has(source.id))
    : []
  const evidenceJson = (value: unknown) =>
    `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;text-align:left">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
  return `<section aria-label="Saved complete access cost"><h2>Complete access cost · saved comparison</h2><p class="status"><strong>CAD $${amount(record.totalCost)} · ${record.inputStatus === 'current' ? 'Inputs match saved comparison' : 'STALE — inputs changed; recalculate before relying on this total'}</strong><br>Assessment date: ${escapeHtml(record.asOf)}. Candidate: ${escapeHtml(record.candidateName)}. Model: ${escapeHtml(record.reviewedInputs.modelVersion ?? 'Unversioned legacy comparison')}.</p><p>${escapeHtml(record.basis)} The covered construction estimate and engineering ledger remain separate; do not add those totals to this comparison.</p><table><thead><tr><th>Saved component</th><th>CAD</th></tr></thead><tbody>${components.map(([key, label]) => `<tr><td>${label}</td><td>${amount(record.ledger[key])}</td></tr>`).join('')}</tbody></table><h3>Saved supply and disposal allocations</h3>${record.allocations.length ? `<table><thead><tr><th>Source / use</th><th>Volume and basis</th><th>Materials CAD</th><th>Preparation CAD</th><th>Loaded / return network km</th><th>Network haul CAD</th><th>Connector haul CAD</th></tr></thead><tbody>${record.allocations.map((source) => `<tr><td>${escapeHtml(source.sourceName)} · ${source.use}</td><td>${amount(source.volumeM3)} ${source.volumeBasis} m³</td><td>${amount(source.materialCost)}</td><td>${amount(source.sourcePreparationCost)}</td><td>${amount(source.networkDistanceM / 1000)} / ${amount(source.returnNetworkDistanceM / 1000)}</td><td>${amount(source.networkHaulCost + source.returnNetworkHaulCost)}</td><td>${amount(source.connectorHaulCost + source.returnConnectorHaulCost)}</td></tr>`).join('')}</tbody></table><p>Allocation rows describe individual demand groups. Shared preparation, rehabilitation, access and structure allowances are counted once in the saved ledger above.</p>` : '<p>No external material allocations were required by this saved comparison.</p>'}<h3>Saved connected paths</h3>${paths.map(({ label, path }) => `<details><summary>${escapeHtml(label)} · ${amount(path.lengthM)} m</summary><dl><dt>Road IDs</dt><dd>${escapeHtml(path.roadIds.join(', ') || 'No existing-road distance')}</dd><dt>Edge IDs</dt><dd>${escapeHtml(path.edgeIds.join(', ') || 'None')}</dd><dt>Shared cost item IDs</dt><dd>${escapeHtml(path.costItemIds.join(', ') || 'None')}</dd><dt>Entrance / junction gaps</dt><dd>${amount(path.attachmentDistanceM)} / ${amount(path.junctionGapM)} m</dd></dl></details>`).join('')}<details><summary>Recorded source quotes, road evidence and network assumptions</summary><p>These are the inputs saved at adoption, including dated condition observations and entered reviewer names. They are user-supplied planning evidence, not authenticated professional sign-off. Later project edits do not rewrite this snapshot.</p>${evidenceJson({ asOf: record.asOf, connector: record.reviewedInputs.alignment, sources, networkPolicy: record.reviewedInputs.totalCostPlanning?.networkPolicy, connectorChecks: record.reviewedInputs.totalCostPlanning?.connectorChecks, roads: roadEvidence, terrain: record.reviewedInputs.terrain })}</details>${record.warnings.length ? `<h3>Saved comparison flags</h3><ul>${record.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}<p class="muted">The project JSON retains the exact comparison input signature. The GeoJSON alignment carries the saved ledger, source/path IDs and reviewed inputs. These records do not replace the separately reported base engineering calculation.</p></section>`
}
