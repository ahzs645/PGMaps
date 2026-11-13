#!/usr/bin/env node
/**
 * Builds the road-cost evidence catalogue the BC references dialog reads
 * (`src/pages/dev-forestry-roads/costEvidence/*.generated.json`) from the three research packages
 * reviewed in November 2026. The packages themselves are not in the repository; pass the folders:
 *
 *   node scripts/forestry/cost-evidence/build-catalogue.mjs \
 *     --bc-local <PGMaps_BC_Cost_Data_…> \
 *     --bc-projects <PGMaps_BC_Project_Cost_Evidence_…> \
 *     --external <PGMaps_External_Cost_References_…>
 *
 * Nothing is converted, escalated or averaged here: each record keeps its own currency, unit, price
 * year, source and limits. See docs/forestry-road-design/bc-cost-evidence.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const arg = (name) => {
  const at = args.indexOf('--' + name)
  if (at < 0 || !args[at + 1]) throw new Error(`Missing --${name} <folder>`)
  return resolve(args[at + 1])
}
const read = (folder, file) => JSON.parse(readFileSync(join(folder, file), 'utf8'))
const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../../src/pages/dev-forestry-roads/costEvidence')
const write = (file, value) => writeFileSync(join(outDir, file), JSON.stringify(value, null, 1) + '\n')

const REGION_IDS = [
  'cariboo',
  'kootenay-boundary',
  'northeast',
  'omineca',
  'skeena',
  'thompson-okanagan',
  'south-coast',
  'west-coast',
]
const regionId = (name) => {
  if (!name) return null
  const id = String(name)
    .toLowerCase()
    .replace(/[\s–—]+/g, '-')
  return REGION_IDS.includes(id) ? id : null
}
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
/** "Not stated on rate card." and friends carry no term; the panel says "not stated" itself. */
const stated = (value) => {
  const clean = text(value)
  return !clean || /^not[ _]stated/i.test(clean) ? null : clean
}
const compact = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  )

// ---------------------------------------------------------------------------------------------
// BC local supplier prices, municipal fees, maintenance awards and quote-only leads
// ---------------------------------------------------------------------------------------------

const LOCAL_KIND = {
  supplier_material: 'supplier-price',
  supplier_haul: 'supplier-haul',
  municipal_access_fee: 'municipal-fee',
  maintenance_contract_award: 'maintenance-award',
}
const LOCAL_FRESHNESS = {
  dated_supplier_list: 'dated',
  year_labelled_supplier_list: 'year-only',
  undated_supplier_list: 'undated',
  stale_undated_retail_list: 'stale',
  undated_promotion: 'promotion',
  published_fee_schedule: 'dated',
  awarded_maintenance_contract: 'award',
}
/** The unit as it reads after the amount. A basis the source leaves unclear stays unclear. */
const LOCAL_UNIT = {
  tonne: '/t',
  purchased_yd3: '/yd³',
  hour: '/hour',
  linear_metre: '/m',
  source_m3_basis_unstated: '/m³',
  source_yard_basis_unconfirmed: ' per listed yard',
  advertised_10_yard_load: ' per advertised 10-yard load',
  unspecified_load: ' per load',
}
const LOCAL_UNIT_NOTE = {
  purchased_yd3: 'Purchased loose volume, not compacted road volume.',
  source_m3_basis_unstated: 'The source does not say whether the volume is loose, bank or compacted.',
  source_yard_basis_unconfirmed: 'The source writes "/yd"; whether it is a cubic yard is not confirmed.',
  advertised_10_yard_load: 'One advertised load; the delivered volume is not confirmed.',
  unspecified_load: 'The schedule does not give the load volume.',
}
const surcharge = (item) => {
  const amount =
    item.amount === null || item.amount === undefined
      ? 'amount not published'
      : item.unit === 'percent'
        ? `${item.amount}%`
        : `$${item.amount} ${String(item.unit).replace(/^CAD /, '')}`
  const kind = item.kind.charAt(0).toUpperCase() + item.kind.slice(1)
  return `${kind} surcharge: ${amount}; applies to ${String(item.applies_to).toLowerCase()}${item.note ? `. ${item.note}` : ''}`
}

function buildLocal(folder) {
  const data = read(folder, 'bc-local-cost-evidence.json')
  const fuel = read(folder, 'bc-monthly-fuel-reference.json')
  const records = data.records.map((record) => {
    const kind = LOCAL_KIND[record.category]
    const freshness = LOCAL_FRESHNESS[record.source_status]
    const unit = LOCAL_UNIT[record.basis_unit]
    const region = regionId(record.region_id)
    if (!kind || !freshness || !unit || !region) throw new Error(`Unmapped local record ${record.record_id}`)
    if (record.currency !== 'CAD') throw new Error(`Unexpected currency in ${record.record_id}`)
    return compact({
      id: record.record_id,
      kind,
      group: record.supplier_or_authority.split('; ').at(-1),
      title: record.product_or_service,
      party: record.supplier_or_authority,
      place: record.location,
      regionId: region,
      country: 'CA',
      currency: 'CAD',
      amounts: { value: record.amount_cad },
      unit,
      unitNote: LOCAL_UNIT_NOTE[record.basis_unit] ?? null,
      freshness,
      tier: record.price_tier === 'as_published' ? null : record.price_tier,
      costYear: record.effective_date ? Number(record.effective_date.slice(0, 4)) : null,
      effectiveDate: record.effective_date,
      dateNote: text(record.effective_date_note),
      tax: stated(record.tax_treatment),
      loading: stated(record.loading),
      delivery: stated(record.delivery),
      installation: stated(record.installation),
      minimum: stated(record.minimum_quantity_or_charge),
      surcharges: record.surcharges.map(surcharge),
      surchargeNote: record.surcharges.length ? null : stated(record.surcharge_notes),
      availability: stated(record.availability),
      cautions: String(record.limitations ?? '')
        .split(/;\s+/)
        .map((item) => item.trim())
        .filter(Boolean),
      url: record.source_url,
      locator: text(record.source_locator),
      checked: record.checked_date,
    })
  })
  const leads = data.quote_only_sources.map((lead) => {
    const region = regionId(lead.region)
    if (!region) throw new Error(`Unmapped lead region ${lead.region}`)
    return compact({
      regionId: region,
      party: lead.supplier,
      place: lead.location,
      products: lead.products ?? (lead.product ? [lead.product] : []),
      status: lead.status ?? lead.reason,
      url: lead.source_url,
      checked: lead.checked_date,
    })
  })
  write('bcLocal.generated.json', {
    checked: data.checked_date,
    records,
    leads,
    fuel: {
      month: fuel.adjustment_month,
      updated: fuel.source_updated_date,
      onRoadPerHour: fuel.on_road_addition,
      offRoadPerHour: fuel.off_road_addition,
      url: fuel.source_url,
    },
  })
  return { records: records.length, leads: leads.length }
}

// ---------------------------------------------------------------------------------------------
// BC project evidence: contract awards, crossing projects and consultant estimates
// ---------------------------------------------------------------------------------------------

const sentence = (value) => {
  const clean = text(value)
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : null
}
const quantityText = (item) =>
  `${String(item.measure).replace(/_/g, ' ')}: ${item.value}${item.unit ? ' ' + item.unit : ''}${item.basis ? ` (${item.basis})` : ''}`

const CROSSING_GROUPS = {
  cwf_summaries: 'CWF fish-passage projects',
  cwf_canton_2024: 'CWF fish-passage projects',
  moti_lvr_2022: 'MoTI low-volume road structures',
  bcts_2020_21: 'BC Fish Passage Program',
  mcdowell_catalog: 'McDowell Creek crossing',
}

function buildProjects(folder) {
  const awards = read(folder, 'contract-awards.json')
  const crossings = read(folder, 'crossing-project-costs.json')
  const consultants = read(folder, 'consultant-estimates-and-unit-rates.json')
  const records = []
  for (const record of awards.records) {
    records.push(
      compact({
        id: record.id,
        kind: 'contract-award',
        group: 'BC ministry contract awards',
        title: record.project,
        party: record.contractor,
        place: record.location,
        regionId: regionId(record.candidate_natural_resource_region),
        country: 'CA',
        currency: 'CAD',
        amounts: { value: record.amount_cad },
        unit: null,
        costYear: record.cost_year,
        dateNote: `${record.value_status}. ${record.cost_year_basis}`,
        sample: record.amended_maximum_cad
          ? `Amended maximum $${record.amended_maximum_cad.toLocaleString('en-CA')} (amendment $${record.amendment_cad.toLocaleString('en-CA')})`
          : null,
        scope: sentence(record.scope_category) ?? 'Scope category not stated in the disclosure',
        tax: stated(record.tax_basis),
        cautions: [text(record.limitations), text(record.region_status)].filter(Boolean),
        url: record.source_url,
        locator: text(record.source_locator),
        checked: record.checked_at,
      }),
    )
  }
  for (const record of crossings.records) {
    const amount = record.cost_amount_cad
    if (typeof amount !== 'number') continue
    const regions = record.candidate_natural_resource_regions
    records.push(
      compact({
        id: record.id,
        kind: record.cost_kind === 'reported_completed_project_cost' ? 'completed-project' : 'approximate-project',
        group: CROSSING_GROUPS[record.source_id] ?? 'BC crossing projects',
        title: record.project,
        party: null,
        place: record.location,
        regionId: regionId(record.candidate_natural_resource_region),
        country: 'CA',
        currency: 'CAD',
        amounts: { value: amount },
        unit: null,
        costYear: Number(String(record.completion_date ?? '').slice(0, 4)) || null,
        dateNote: record.completion_date ? `Completed ${record.completion_date}` : null,
        sample: (record.quantities ?? []).map(quantityText).join('; ') || null,
        scope: [text(record.work_family), text(record.scope)].filter(Boolean).join('. '),
        tax: /^unspecified/i.test(record.tax_basis ?? '') ? null : stated(record.tax_basis),
        cautions: [
          ...(record.quality_flags ?? []),
          text(record.comparability),
          regions ? `Candidate regions: ${regions.join(', ')}` : null,
          text(record.region_status),
        ].filter(Boolean),
        url: record.source_url,
        locator: text(record.source_locator),
        checked: record.checked_at,
      }),
    )
  }
  const sources = new Map(consultants.sources.map((source) => [source.id, source]))
  for (const row of consultants.rate_rows) {
    const source = sources.get(row.source_id)
    if (!source) throw new Error(`Unknown consultant source ${row.source_id}`)
    if (typeof row.unit_rate !== 'number') continue
    records.push(
      compact({
        id: row.id,
        kind: 'estimate',
        group: `${source.consultant.replace(/,.*$| Consulting Services Ltd\.| Engineering Inc\./g, '')} · ${source.owner.replace(/^(City|Village|Regional District) of /, '').replace(/ Regional District$/, '')}`,
        title: row.item,
        party: `${source.consultant} for ${source.owner}`,
        place: source.location,
        regionId: regionId(source.candidate_natural_resource_region),
        country: 'CA',
        currency: 'CAD',
        amounts: { value: row.unit_rate },
        unit: '/' + String(row.unit).replace('m2', 'm²').replace('m3', 'm³'),
        costYear: row.cost_year,
        dateNote: `${source.estimate_class}; estimate dated ${row.estimate_date}`,
        sample:
          typeof row.quantity === 'number'
            ? `${row.quantity.toLocaleString('en-CA')} ${row.unit} in the estimate${row.option ? `, option ${row.option}` : ''}`
            : null,
        scope: `${source.title}. ${source.scope}`,
        tax: stated(row.tax_basis),
        cautions: [
          text(row.notes),
          ...(source.quality_flags ?? []),
          row.use === 'context_only' ? 'Context only: not a comparable construction component.' : null,
        ].filter(Boolean),
        contextOnly: row.use === 'context_only' ? true : null,
        url: row.source_url,
        locator: text(row.source_locator),
        checked: row.checked_at,
      }),
    )
  }
  write('bcProjects.generated.json', { checked: awards.checked_at, limits: crossings.common_limits, records })
  return { records: records.length }
}

// ---------------------------------------------------------------------------------------------
// Evidence from outside BC, with worked estimates and methods
// ---------------------------------------------------------------------------------------------

const EXTERNAL_KIND = {
  tender_bid_average: 'tender-average',
  consultant_estimate: 'estimate',
  consultant_indicative_estimate: 'estimate',
  engineer_estimate: 'estimate',
  expert_estimate: 'estimate',
  consultant_model_estimate: 'maintenance-model',
  reported_local_cost: 'maintenance-model',
  appraisal_allowance: 'appraisal-allowance',
  survey_estimate: 'survey',
  field_trial_cost_model: 'field-trial',
  funding_model: 'funding',
  grant_ceiling: 'funding',
}
const EXTERNAL_UNIT = {
  LS_per_road: ' per road, lump sum',
  LS_per_work_area: ' per work area, lump sum',
  LS_per_turnaround: ' per turnaround, lump sum',
  LS_per_landing: ' per landing, lump sum',
  package_LS: ' lump sum for the package',
  each: ' each',
  each_crossing_allowance: ' per crossing, allowance',
  mile: ' per mile',
  CY_loose_hauled: ' per loose yd³ hauled',
}
const externalUnit = (unit) =>
  EXTERNAL_UNIT[unit] ?? (/^[A-Z]{3}\//.test(unit) ? unit.slice(3) : unit.startsWith('per ') ? ' ' + unit : ' ' + unit)

const EXTERNAL_GROUPS = {
  'alberta-upa-2026': 'Alberta tender averages',
  'allnorth-labrador-2024': 'Allnorth · Labrador road study',
  'kneehill-mcelhanney-2025': 'McElhanney · Kneehill culverts',
  'norwich-burnside-2024': 'Burnside · Norwich gravel roads',
  'isc-om-toronto-2023': 'ISC operations funding model',
  'usfs-kilkenny-2024': 'US Forest Service · Kilkenny',
  'usfs-herring-2025': 'US Forest Service · Herring',
  'usfs-rocking-chair-2025': 'US Forest Service · Rocking Chair',
  nz_brown_visser_2018: 'New Zealand manager survey',
  nz_hetherington_trials_2024: 'New Zealand subgrade trials',
  uk_fr_woodland_costs_2025_2023prices: 'England woodland costs review',
  au_green_triangle_geddes_2023: 'Green Triangle farm access',
  ie_teagasc_forest_roads_current_2026: 'Ireland forest road grants',
}
/** "355 loose yd³ hauled": the quantity the rate was applied to or sampled over, in its own unit. */
const quantityWithUnit = (quantity, unit) => {
  const amount = quantity.toLocaleString('en-CA')
  if (/lump sum|allowance| each$/.test(unit)) return `Quantity ${amount}`
  return `${amount} ${unit.replace(/^\/|^ per /, '').replace(/^\((.*)\)$/, '$1')}`
}

function buildExternal(folder) {
  const catalogue = read(folder, 'catalogue-records.json')
  const register = read(folder, 'source-register.json')
  const worked = read(folder, 'worked-estimates.json')
  const byId = new Map(catalogue.records.map((record) => [record.id, record]))

  const records = catalogue.records.map((record) => {
    const kind = EXTERNAL_KIND[record.cost_kind]
    if (!kind) throw new Error(`Unmapped cost kind ${record.cost_kind}`)
    const group = EXTERNAL_GROUPS[record.source_id]
    if (!group) throw new Error(`Unnamed source ${record.source_id}`)
    const unit = externalUnit(record.reported_unit)
    const sample = [
      typeof record.quantity === 'number' && record.quantity !== 1 ? quantityWithUnit(record.quantity, unit) : null,
      typeof record.sample_contract_count === 'number'
        ? `${record.sample_contract_count} contract${record.sample_contract_count === 1 ? '' : 's'}`
        : null,
    ].filter(Boolean)
    return compact({
      id: record.id,
      kind,
      group,
      sourceId: record.source_id,
      title: record.title,
      place: record.geography,
      country: record.country_code,
      currency: record.currency,
      amounts: record.amounts,
      unit,
      costYear: record.cost_year ?? record.policy_year,
      dateNote: text(record.cost_year_basis),
      sample: sample.join(' · ') || null,
      scope: record.scope,
      tax: stated(record.tax_basis),
      cautions: [text(record.performance_flag)].filter(Boolean),
      fundingOnly: record.use_policy.calibration_eligibility === 'ineligible_funding_context' ? true : null,
      url: record.source_url,
      locator: record.source_locator,
      checked: record.reviewed_at,
    })
  })

  const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  const sources = register.sources.map((source) =>
    compact({
      id: source.source_id,
      role: source.source_role === 'method_only' ? 'method' : 'numbers',
      title: source.title,
      publisher: text(source.publisher),
      url: source.url,
      landingUrl: text(source.landing_url),
      type: text(source.source_type ?? source.evidence_type ?? source.cost_status),
      priceBasis: text(source.price_basis ?? source.cost_year_basis ?? source.price_year_basis),
      method: text(typeof source.method === 'string' ? source.method : null),
      scope: text(typeof source.scope === 'string' ? source.scope : null),
      use: text(source.pgmaps_inference ?? source.limit),
      notes: [
        ...list(source.notes),
        ...list(source.transfer_limitations),
        ...list(source.exclusions_or_unknowns),
        ...list(source.explicit_exclusions),
      ],
    }),
  )

  const line = (id, label) => {
    const record = byId.get(id)
    if (!record) throw new Error(`Unknown worked-estimate row ${id}`)
    const rate = record.amounts.value
    return {
      label: label ?? record.title,
      quantity: record.quantity,
      unit: externalUnit(record.reported_unit).trim(),
      rate,
      amount: Math.round(rate * record.quantity * 100) / 100,
    }
  }
  const example = (id) => {
    const found = worked.examples.find((item) => item.id === id)
    if (!found) throw new Error(`Missing worked estimate ${id}`)
    return found
  }
  const base = (item, title, status) => ({
    id: item.id,
    title,
    sourceId: item.source_id,
    currency: item.currency,
    costYear: item.cost_year ?? item.material_cost_year ?? null,
    status,
    url: item.source_url,
    locator: item.locator,
  })
  const usfsPackage = (id, title) => {
    const item = example(id)
    const rows = item.component_row_ids.filter((row) => !row.endsWith('engineering'))
    return {
      ...base(item, title, "Engineer's estimate"),
      lines: rows.map((row) => line(row)),
      totals: [
        { label: 'Works subtotal', amount: item.works_total_usd },
        { label: 'Engineering, package allowance', amount: item.engineering_total_usd },
        { label: 'Total estimate', amount: item.grand_total_usd },
      ],
      notes: [item.method, item.independent_sample_warning],
    }
  }
  const herringRoad = example('herring-fr3013')
  const rocking = example('rocking-chair-new-temp-4')
  const plow = example('rocking-chair-snow-plow-productivity')
  const allnorth = example('allnorth-labrador-2024-project-budget')
  const kneehill = example('kneehill-mcelhanney-2025-project-budget')
  const norwich = example('norwich-four-year-maintenance')
  const grading = norwich.gradings_per_year * norwich.grader_hours_per_km_per_visit
  const estimates = [
    usfsPackage('kilkenny-full-package', 'US Forest Service · Kilkenny road package, localized reconstruction'),
    usfsPackage('herring-full-package', 'US Forest Service · Herring road package, reconditioning and aggregate'),
    {
      ...base(herringRoad, 'US Forest Service · Herring, road FR3013 alone', "Engineer's estimate, one road"),
      lines: herringRoad.line_items.map((item) => ({
        label: item.description,
        quantity: item.quantity,
        unit: externalUnit(item.unit).trim(),
        rate: item.rate_usd,
        amount: item.amount_usd,
      })),
      totals: [{ label: 'Road works total', amount: herringRoad.road_works_total_usd }],
      notes: [herringRoad.scope, herringRoad.quality_note, herringRoad.independent_sample_warning],
    },
    {
      ...base(rocking, 'US Forest Service · Rocking Chair, new temporary road #4', 'Timber-sale appraisal estimate'),
      lines: [
        ...['r-clear', 'r-excavate', 'r-obliterate'].map((id) => ({
          ...line(id),
          quantity: rocking.length_miles_used_by_sheet,
        })),
        line('r-dips'),
        line('r-cmp'),
      ],
      totals: [
        { label: 'Basic cost, as reported', amount: rocking.basic_cost_as_reported_usd },
        { label: 'Drainage', amount: rocking.drainage_usd },
        { label: 'Subtotal before mobilization', amount: rocking.subtotal_before_mobilization_usd },
        { label: `Mobilization, ${rocking.mobilization_percent}%`, amount: rocking.mobilization_as_reported_usd },
        { label: 'Total including profit', amount: rocking.total_including_profit_as_reported_usd },
        { label: 'Appraisal entry, profit removed', amount: rocking.appraisal_cost_as_reported_usd },
      ],
      notes: [rocking.scope_note, rocking.assembly, rocking.independent_sample_warning],
    },
    {
      ...base(plow, 'US Forest Service · Rocking Chair, snow plowing rate build-up', 'Maintenance appraisal allowance'),
      lines: [
        {
          label: 'Equipment',
          quantity: 1,
          unit: 'per hour',
          rate: plow.equipment_rate_usd_per_hour,
          amount: plow.equipment_rate_usd_per_hour,
        },
        {
          label: 'Operator',
          quantity: 1,
          unit: 'per hour',
          rate: plow.operator_rate_usd_per_hour,
          amount: plow.operator_rate_usd_per_hour,
        },
        {
          label: `Mobilization, $${plow.mobilization_allowance_usd} over a ${plow.notional_workday_hours}-hour day`,
          quantity: 1,
          unit: 'per hour',
          rate: plow.worksheet_mobilization_allocation_usd_per_hour,
          amount: plow.worksheet_mobilization_allocation_usd_per_hour,
        },
      ],
      totals: [
        { label: 'Adopted rate per mile, at 1 mile an hour', amount: plow.adopted_unit_rate_usd_per_mile },
        { label: `${plow.miles_per_pass} miles × ${plow.passes} passes`, amount: plow.total_usd },
      ],
      notes: [plow.scope, plow.rate_build_up_inference, plow.quality_note],
    },
    {
      ...base(allnorth, 'Allnorth · Northern Labrador access-road study, program budget', allnorth.status),
      lines: [],
      totals: [
        { label: 'Construction subtotal', amount: allnorth.construction_subtotal },
        { label: 'Engineering, 15%', amount: allnorth.engineering_15pct },
        { label: 'HST, 15%', amount: allnorth.hst_15pct },
        { label: `Total for ${allnorth.length_km} km`, amount: allnorth.total_table },
      ],
      notes: [
        allnorth.scope,
        `Inside the construction subtotal: contingency (${allnorth.contingency_label}) $${allnorth.contingency_amount.toLocaleString('en-CA')}, mobilization and demobilization $${allnorth.mobilization_demobilization_amount.toLocaleString('en-CA')}, ${allnorth.maintenance_depots_count} maintenance depots $${allnorth.maintenance_depots_amount.toLocaleString('en-CA')}.`,
        allnorth.use_limit,
      ],
    },
    {
      ...base(kneehill, 'McElhanney · Kneehill County twin culvert replacement', kneehill.status),
      lines: [],
      totals: [
        { label: 'Contract cost, as labelled', amount: kneehill.contract_cost_label_amount },
        { label: 'Site occupancy, inside the contract cost', amount: kneehill.site_occupancy },
        { label: 'Modified cost, site occupancy removed', amount: kneehill.modified_cost_excluding_site_occupancy },
        { label: 'Contingency, 15%', amount: kneehill.contingency_15pct },
        { label: 'Engineering budget', amount: kneehill.engineering_budget },
        { label: 'Total project cost', amount: kneehill.total_project_cost },
      ],
      notes: [kneehill.scope, kneehill.use_limit],
    },
    {
      ...base(norwich, 'Burnside · Norwich gravel-road maintenance, per km', norwich.status),
      lines: [
        {
          label: 'Maintenance gravel',
          quantity: norwich.gravel_tonnes_per_km,
          unit: 'tonnes per km',
          rate: norwich.gravel_cad_per_tonne,
          amount: norwich.gravel_tonnes_per_km * norwich.gravel_cad_per_tonne,
        },
        {
          label: `Routine grading, ${norwich.gradings_per_year} visits × ${norwich.grader_hours_per_km_per_visit} hours per km`,
          quantity: grading,
          unit: 'hours per km',
          rate: norwich.grader_cad_per_hour,
          amount: grading * norwich.grader_cad_per_hour,
        },
        {
          label: 'Dust control, annual allowance',
          quantity: 1,
          unit: 'per km',
          rate: norwich.dust_control_cad_per_km_per_year,
          amount: norwich.dust_control_cad_per_km_per_year,
        },
      ],
      totals: [
        { label: 'Gravel-application year, per km', amount: norwich.gravel_year_cad_per_km },
        { label: 'Each of the other three years, per km', amount: norwich.other_year_cad_per_km },
        {
          label: 'Four-year undiscounted average, per km a year (derived for this catalogue)',
          amount: norwich.four_year_average_cad_per_km_per_year_derived,
        },
      ],
      notes: [
        `Typical ${norwich.road_width_m} m road. ${norwich.scope_limit}`,
        `Gravel input is a ${norwich.material_cost_year} cost.`,
      ],
    },
  ].map((item) => ({ ...item, notes: item.notes.filter(Boolean) }))

  write('external.generated.json', { checked: catalogue.reviewed_at, records, sources, estimates })
  return { records: records.length, sources: sources.length, estimates: estimates.length }
}

mkdirSync(outDir, { recursive: true })
console.log('BC local', buildLocal(arg('bc-local')))
console.log('BC projects', buildProjects(arg('bc-projects')))
console.log('External', buildExternal(arg('external')))
