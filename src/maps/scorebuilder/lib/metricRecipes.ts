import type { MetricRecipe as ToolkitMetricRecipe } from '@pgmaps/geo-toolkit/index-lab/metricRecipes'
export * from '@pgmaps/geo-toolkit/index-lab/metricRecipes'

export type MetricRecipeSource =
  | 'healthyplanPg.businessPois'
  | 'healthyplanPg.educationFacilities'
  | 'healthyplanPg.businessLicencesBcGeocoded'
  | 'restaurants'
  | 'census'
  | 'custom'
  /** A dataset uploaded by the user, stored locally in IndexedDB (`user.<datasetId>`). */
  | `user.${string}`

/** PG Maps' dataset catalog constrains the toolkit's consumer-defined source identifier. */
export type MetricRecipe = ToolkitMetricRecipe<MetricRecipeSource>

export const HEALTHYPLAN_PG_STARTER_RECIPES: MetricRecipe[] = [
  {
    id: 'healthyFoodOutletAccess1km',
    label: 'Healthy food outlets within 1 km',
    description:
      'Counts OSM/CityPG food outlets classified as healthy-food candidates within 1 km of each boundary centroid.',
    source: 'healthyplanPg.businessPois',
    sourcePath: '/data/healthyplan-pg/business_pois.geojson',
    operation: 'countWithinCentroidRadius',
    radiusMeters: 1000,
    filters: [{ field: 'healthyFoodOutlet', operator: 'equals', value: true }],
    direction: 'higherIsBetter',
    format: 'count',
    proxyLevel: 'experimental',
    caveats: ['OSM/CityPG classification requires QA; current healthy-food outlet count is small.'],
  },
  {
    id: 'retailServiceAccess1km',
    label: 'Retail/services within 1 km',
    description: 'Counts retail/service POIs within 1 km of each boundary centroid.',
    source: 'healthyplanPg.businessPois',
    sourcePath: '/data/healthyplan-pg/business_pois.geojson',
    operation: 'countWithinCentroidRadius',
    radiusMeters: 1000,
    filters: [{ field: 'retailService', operator: 'equals', value: true }],
    direction: 'higherIsBetter',
    format: 'count',
    proxyLevel: 'experimental',
    caveats: ['OSM completeness varies by neighbourhood.'],
  },
  {
    id: 'educationFacilityAccess1km',
    label: 'Education facilities within 1 km',
    description: 'Counts K-12, childcare, and post-secondary facilities within 1 km of each boundary centroid.',
    source: 'healthyplanPg.educationFacilities',
    sourcePath: '/data/healthyplan-pg/education_facilities.geojson',
    operation: 'countWithinCentroidRadius',
    radiusMeters: 1000,
    filters: [{ field: 'category', operator: 'in', value: ['school_k12', 'child_care', 'post_secondary'] }],
    direction: 'higherIsBetter',
    format: 'count',
    proxyLevel: 'official',
  },
  {
    id: 'geocodedBusinessDensity',
    label: 'Geocoded business density',
    description: 'Counts CityPG business licence records geocoded by BC Address Geocoder per km².',
    source: 'healthyplanPg.businessLicencesBcGeocoded',
    sourcePath: '/data/healthyplan-pg/business_licences_bc_geocoded.geojson',
    operation: 'pointDensityInPolygon',
    filters: [{ field: 'locationConfidence', operator: 'in', value: ['high', 'medium'] }],
    direction: 'higherIsBetter',
    format: 'density',
    proxyLevel: 'experimental',
    caveats: ['Address-geocoded points may place multiple businesses at the same building address.'],
  },
  {
    id: 'canopy_gap',
    label: 'Canopy gap',
    description: 'Transforms the existing canopy proxy into an inverse gap metric.',
    source: 'custom',
    operation: 'derivedExpression',
    expression: '1 - canopyProxyRatio',
    direction: 'higherIsWorse',
    format: 'ratio',
    proxyLevel: 'proxy',
    caveats: ['Canopy proxy is derived from local trees and forest/open-space inputs, not remote-sensing canopy.'],
  },
  {
    id: 'shade_vulnerability',
    label: 'Shade vulnerability',
    description: 'Combines shade gap and CIMD composite vulnerability into one interaction term.',
    source: 'custom',
    operation: 'derivedExpression',
    expression: 'shadeGap * cimdComposite',
    direction: 'higherIsWorse',
    format: 'index',
    proxyLevel: 'experimental',
    caveats: ['CIMD is an area-level deprivation index, not a direct population count.'],
  },
]
