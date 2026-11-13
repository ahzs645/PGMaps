/**
 * Region guidance and supporting sources. The prices themselves are records in the evidence
 * catalogue (`costEvidence/`), each with its own date, unit and terms: there are no regional
 * unit-rate defaults here.
 */
export const BC_COST_REVIEWED_DATE = '2026-11-12'
export const BC_REGION_SOURCE =
  'https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/ministry-of-forests-lands-and-natural-resource-operations-region-district-contacts'

export interface BCCostRegion {
  id: string
  name: string
  method: 'interior' | 'coast' | 'mixed'
  groups: number[]
  geography: string
  review: string
}

export const BC_COST_REGIONS: readonly BCCostRegion[] = [
  {
    id: 'cariboo',
    name: 'Cariboo',
    method: 'interior',
    groups: [4, 8, 12],
    geography:
      '100 Mile House, Cariboo-Chilcotin and Quesnel districts. Williams Lake and Quesnel supply blocks cross appraisal road-group boundaries.',
    review:
      'Confirm the timber supply area and supply block before selecting a road group. Review aggregate access, unsuitable material, seasonal access and haul distances for the actual corridor.',
  },
  {
    id: 'kootenay-boundary',
    name: 'Kootenay-Boundary',
    method: 'interior',
    groups: [10, 11],
    geography:
      'Rocky Mountain and Boundary areas differ from Arrow, Golden, Kootenay Lake and Revelstoke in the appraisal grouping.',
    review:
      'Review rock excavation, steep sections, retaining works, stream crossings and access constraints. A region name does not establish geology or an excavation rate.',
  },
  {
    id: 'northeast',
    name: 'Northeast',
    method: 'interior',
    groups: [7],
    geography: 'Peace and Fort Nelson districts.',
    review:
      'Review wet or weak ground, winter-only construction versus an all-season road, pit availability and crew/equipment travel. Snow/ice roads use a different appraisal method.',
  },
  {
    id: 'omineca',
    name: 'Omineca',
    method: 'interior',
    groups: [4, 5, 6, 7, 12],
    geography:
      'Prince George, Mackenzie and Stuart Nechako areas; the IAM splits Prince George, Mackenzie and Robson Valley timber supply areas by supply block.',
    review:
      'For a Prince George road, identify its supply block and ground conditions first. Review cut suitability, borrow supply and haul before interpreting a low subgrade-only appraisal benchmark.',
  },
  {
    id: 'skeena',
    name: 'Skeena',
    method: 'mixed',
    groups: [1, 2, 3],
    geography:
      'Coast Mountains, Skeena Stikine and Nadina districts. Interior road group 1 uses Coast methodology; other coastal territory may also require the CAM.',
    review:
      'Confirm the appraisal jurisdiction and management unit. Do not treat the whole Skeena region as either one Interior price zone or one coastal multiplier. Review ferry/barge access and remote supply separately.',
  },
  {
    id: 'thompson-okanagan',
    name: 'Thompson-Okanagan',
    method: 'interior',
    groups: [9, 11, 12],
    geography:
      'Cascades, Thompson Rivers and Okanagan Shuswap districts; Kamloops and Okanagan supply blocks require specific road-group checks.',
    review:
      'Check the management-unit boundary, rock conditions, haul route, dust/water supply and seasonal operating constraints. Local aggregate list prices are not installed surfacing prices.',
  },
  {
    id: 'south-coast',
    name: 'South Coast',
    method: 'coast',
    groups: [],
    geography: 'Chilliwack, Sea to Sky and Sunshine Coast districts.',
    review:
      'Use the reviewed construction category and CAM point-of-origin area. Review rock hardness, end haul, stabilization, traffic/access constraints and ferry/barge logistics where applicable.',
  },
  {
    id: 'west-coast',
    name: 'West Coast',
    method: 'coast',
    groups: [],
    geography: 'Campbell River, Haida Gwaii, North Island and South Island districts.',
    review:
      'Review island versus remote coastal access, barge movements, camp and equipment mobilization, and wet/rock conditions. Haida Gwaii is within West Coast administration; CAM additions follow specific appraisal areas.',
  },
]

export const BC_FUEL_ADJUSTMENT_SOURCE =
  'https://www2.gov.bc.ca/gov/content/industry/construction-industry/transportation-infrastructure/hired-equipment-program/fuel-price-adjustment'

export const BC_SUPPORTING_COST_SOURCES = [
  {
    title: 'Interior engineering cost-estimate procedures and workbooks',
    url: 'https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/interior-timber-pricing/interior-ece',
    detail:
      'The current procedures for work outside tabular limits, with the July 2026 workbooks for tabular bridges, road reactivation, portable platforms and support-centre distance. Keep the cost year and the included activities with each rate.',
  },
  {
    title: 'BC Road Builders 2026–2027 Blue Book',
    url: 'https://www.roadbuilders.bc.ca/blue-book/',
    detail:
      'Equipment-rate guide sold by the publisher. Build a production-based rate using applicable equipment, crew and net output; no paywalled rate table is copied here.',
  },
] as const

/**
 * Provincial layers that can propose an appraisal input for review. A mapped polygon is a sourced
 * suggestion, never a reviewed input: rock, soil moisture and terrain stability still need site
 * evidence, and a TSA overlay does not resolve every TFL exception.
 */
export const BC_GEOGRAPHIC_CONTEXT_SOURCES = [
  {
    title: 'Timber supply areas and supply blocks',
    url: 'https://catalogue.data.gov.bc.ca/dataset/8daa29da-d7f4-401c-83ae-d962e3a28980',
    detail:
      'FADM timber supply area and supply block polygons. Intersect the road with them to shortlist an Interior road group, then confirm it against IAM Table 4-2 and its TFL exceptions.',
  },
  {
    title: 'Biogeoclimatic ecosystem classification map',
    url: 'https://catalogue.data.gov.bc.ca/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3',
    detail:
      'BEC zone, subzone, variant and phase polygons. A road that crosses a boundary is compared in sections; the mapped zone does not establish soil moisture.',
  },
] as const
