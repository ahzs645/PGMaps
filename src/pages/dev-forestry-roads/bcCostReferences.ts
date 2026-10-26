/** Human-reviewed evidence, not a set of regional unit-rate defaults. */
export const BC_COST_REVIEWED_DATE = '2026-10-26'
export const BC_REGION_SOURCE =
  'https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/ministry-of-forests-lands-and-natural-resource-operations-region-district-contacts'

export interface SupplierCostReference {
  supplier: string
  location: string
  url: string
  effectiveDate: string | null
  price: string
  limits: string
}

export interface BCCostRegion {
  id: string
  name: string
  method: 'interior' | 'coast' | 'mixed'
  groups: number[]
  geography: string
  review: string
  suppliers: SupplierCostReference[]
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
    suppliers: [
      {
        supplier: 'United Concrete & Gravel',
        location: 'Quesnel, Williams Lake and 100 Mile House',
        url: 'https://www.unitedconcrete.ca/gravel',
        effectiveDate: null,
        price: 'Quote required; no usable public numeric list found.',
        limits:
          'The supplier lists road crush, larger base material and delivery. Confirm product specification, available quantity, haul distance and all price inclusions for the job.',
      },
    ],
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
    suppliers: [
      {
        supplier: 'BC Eco Industrial Services',
        location: 'Nelson, Castlegar and Crescent Valley',
        url: 'https://bceco.ca/news/company-news-and-events/tandem-dump-truck-loads-of-road-gravel-for-sale/',
        effectiveDate: null,
        price: 'Promotional road gravel: $253.50 per 10-yard tandem load.',
        limits:
          'Undated, limited-time/stock promotion; not a current confirmed quote. Delivery is extra. Tax basis, material grading and availability need confirmation; purchased yardage is not compacted road volume.',
      },
      {
        supplier: 'MacKay Contracting',
        location: 'Cranbrook / East Kootenay',
        url: 'https://mackaybuilds.com/divisions/aggregates-materials/',
        effectiveDate: null,
        price: 'Quote required; no public numeric rate identified.',
        limits:
          'Primary supplier source for crushed aggregates, rip rap, custom crushing and material supply/delivery.',
      },
    ],
  },
  {
    id: 'northeast',
    name: 'Northeast',
    method: 'interior',
    groups: [7],
    geography: 'Peace and Fort Nelson districts.',
    review:
      'Review wet or weak ground, winter-only construction versus an all-season road, pit availability and crew/equipment travel. Snow/ice roads use a different appraisal method.',
    suppliers: [
      {
        supplier: 'DRS Energy Services',
        location: 'Fort St. John',
        url: 'https://www.drsenergy.ca/products',
        effectiveDate: null,
        price: '3/4-inch minus: $16.00/tonne; pit run: $12.25/tonne.',
        limits:
          'Undated public material list. Tax, loading, delivery and commercial-volume inclusions are not specified; obtain a dated quote and a suitable density before converting to compacted m³.',
      },
    ],
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
    suppliers: [
      {
        supplier: 'GetGravel',
        location: 'Prince George',
        url: 'https://getgravel.com/products',
        effectiveDate: null,
        price: '3/4-inch minus road crush: $49.99/yd³; sandy fill: $14.99/yd³.',
        limits:
          'Undated retail yard prices, loaded into the customer’s vehicle, before tax. Delivery and placement are separate. Cubic yards describe purchased volume, not compacted road volume; commercial project pricing requires a quote.',
      },
    ],
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
    suppliers: [
      {
        supplier: 'Skeena Concrete Products',
        location: 'Terrace / Northwest BC',
        url: 'https://skeenaconcrete.com/',
        effectiveDate: null,
        price: 'Quote required; no public numeric rate identified.',
        limits:
          'Supplier lists sand, gravel and custom aggregate. Obtain source-specific grading, material, loading and delivery prices.',
      },
      {
        supplier: 'Steti Transport',
        location: 'Smithers / Bulkley Valley',
        url: 'https://www.stetitransport.ca/',
        effectiveDate: null,
        price: 'Quote required; no public numeric rate identified.',
        limits:
          'Supplier lists aggregate delivery, road building, site preparation and clearing/trucking. Remote access and equipment logistics require a job-specific quotation.',
      },
    ],
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
    suppliers: [
      {
        supplier: 'Skwlāx Aggregates',
        location: 'Chase / Thompson-Shuswap',
        url: 'https://www.skwlaxaggregates.com/wp-content/uploads/2026/10/Skwlax-Aggregates-Price-List.pdf',
        effectiveDate: '2026-08-25',
        price: '25 mm WGB: $13.00/tonne; 75 mm SGSB/BEF: $12.75/tonne; pit run: $7.35/tonne; tandem truck: $160/hour.',
        limits:
          'Taxes excluded; loading fee $10/unit (confirm the unit) and monthly hourly fuel surcharge are additional. Material and trucking are separate. This rate card supersedes the supplier’s 2025 truck prices.',
      },
    ],
  },
  {
    id: 'south-coast',
    name: 'South Coast',
    method: 'coast',
    groups: [],
    geography: 'Chilliwack, Sea to Sky and Sunshine Coast districts.',
    review:
      'Use the reviewed construction category and CAM point-of-origin area. Review rock hardness, end haul, stabilization, traffic/access constraints and ferry/barge logistics where applicable.',
    suppliers: [
      {
        supplier: 'Stockwell Gravel',
        location: 'Sechelt / Sunshine Coast',
        url: 'https://www.stockwellgravel.ca/pricing/',
        effectiveDate: '2025-01-01',
        price:
          '3/4-inch minus MMCD road base: $27.00/metric tonne; structural fill sand: $13.00/tonne; tandem truck: $165/hour.',
        limits:
          'Add $0.75/tonne environmental fee and taxes. Road base is marked delivery-only and delivery is separately listed; confirm the delivered total. Truck listing is approximately 14-ton capacity; boulders/blast rock use a different rate.',
      },
    ],
  },
  {
    id: 'west-coast',
    name: 'West Coast',
    method: 'coast',
    groups: [],
    geography: 'Campbell River, Haida Gwaii, North Island and South Island districts.',
    review:
      'Review island versus remote coastal access, barge movements, camp and equipment mobilization, and wet/rock conditions. Haida Gwaii is within West Coast administration; CAM additions follow specific appraisal areas.',
    suppliers: [
      {
        supplier: 'Sharecost Rentals & Sales',
        location: 'Nanaimo',
        url: 'https://sharecost.ca/bulk/base-fill-materials/road-base-34-mot-spec',
        effectiveDate: null,
        price: '3/4-inch MoT-spec road base: $33.00/tonne for a minimum 12 tonnes; yard listing: $55.00/yd³.',
        limits:
          'Undated live product page. Delivery fees apply; larger commercial quantities require a quote. The older 2025 PDF’s $26/tonne is superseded by this observed page. Neither listing includes compacted placement.',
      },
    ],
  },
]

export const BC_SUPPORTING_COST_SOURCES = [
  {
    title: 'Interior engineering cost-estimate procedures',
    url: 'https://www2.gov.bc.ca/gov/content/industry/forestry/competitive-forest-industry/timber-pricing/interior-timber-pricing/interior-ece',
    detail:
      'Use the applicable current ECE procedures for work outside tabular limits. Keep the cost year and the included activities with each rate.',
  },
  {
    title: 'BC Road Builders 2026–2027 Blue Book',
    url: 'https://www.roadbuilders.bc.ca/blue-book/',
    detail:
      'Equipment-rate guide sold by the publisher. Build a production-based rate using applicable equipment, crew and net output; no paywalled rate table is copied here.',
  },
  {
    title: 'Hired Equipment Program fuel adjustment',
    url: 'https://www2.gov.bc.ca/gov/content/industry/construction-industry/transportation-infrastructure/hired-equipment-program/fuel-price-adjustment',
    detail:
      'October 2026: +$25.50/hour on-road; +$59.50/hour off-road. This monthly program adjustment is not a universal surcharge and must not be stacked over a quote that already includes current fuel.',
  },
] as const
