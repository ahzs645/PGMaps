import { useMemo } from 'react'

import { useWebMCPTools, type WebMCPInput, type WebMCPTool } from '@/lib/webmcp'
import {
  FACILITY_TYPE_OPTIONS,
  HAZARD_RATING_OPTIONS,
  type FoodMapFilterActions,
  type FoodMapFilters,
} from './hooks/useFoodMapFilters'
import type {
  HazardRating,
  HazardStatsAtDate,
  RestaurantWithStats,
  TimelineStats,
  ViolationTimelineMode,
  VisualizationMode,
} from './types'
import type { CrimeIncident } from '@/maps/pgdata/types'

export const FOOD_VIOLATION_BUCKETS = ['zero', 'low', 'medium', 'high'] as const
export type FoodViolationBucket = (typeof FOOD_VIOLATION_BUCKETS)[number]

const TIMELINE_MONTH_OPTIONS = [0, 3, 6, 12, 24] as const
const CRIME_RADIUS_OPTIONS = [250, 500, 1000, 2000] as const
const CRIME_LOOKBACK_OPTIONS = [12, 24, 36, 60] as const
const VISUALIZATION_MODES: VisualizationMode[] = ['violations', 'hazard']
const TIMELINE_MODES: ViolationTimelineMode[] = ['period', 'cumulative']
const READ_ONLY = { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false } as const
const UI_ACTION = { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false } as const

function asInputRecord(input: WebMCPInput): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool input must be an object.')
  return input
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`Unsupported input fields: ${unknown.join(', ')}.`)
}

function optionalText(input: Record<string, unknown>, key: string, maxLength = 160): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${key} must be ${maxLength} characters or fewer.`)
  return trimmed
}

function stringArray<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T[] | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`)
  const invalid = value.filter((item) => typeof item !== 'string' || !allowed.includes(item as T))
  if (invalid.length > 0) throw new Error(`${key} contains unsupported values: ${invalid.join(', ')}.`)
  return [...new Set(value as T[])]
}

function enumValue<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

function boundedMaxResults(input: Record<string, unknown>) {
  const value = input.maxResults ?? 8
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 20) {
    throw new Error('maxResults must be an integer from 1 to 20.')
  }
  return Number(value)
}

function waitForVisibleUpdate() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

export function summarizeFoodEstablishment(restaurant: RestaurantWithStats) {
  const latestInspection = restaurant.filteredInspections?.[0] ?? restaurant.inspections?.[0]
  return {
    name: restaurant.name,
    address: restaurant.full_address || restaurant.address,
    facilityType: restaurant.establishment_type || restaurant.facility_type || 'Unknown',
    hazardRating:
      restaurant.hazardRatingAtDate || restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown',
    violations: restaurant.violationStats?.total ?? 0,
    criticalViolations: restaurant.violationStats?.critical ?? 0,
    inspections: restaurant.violationStats?.inspectionCount ?? 0,
    riskBand: restaurant.violationStats?.risk?.worstBand ?? 'Unknown',
    riskScore: restaurant.violationStats?.risk?.score ?? 0,
    latestInspection: latestInspection?.date || latestInspection?.inspection_date || null,
    mapped: restaurant.latitude != null && restaurant.longitude != null,
  }
}

export function resolveFoodEstablishment(
  restaurants: RestaurantWithStats[],
  requested: string,
  requestedAddress = '',
): RestaurantWithStats {
  const name = requested.trim().toLowerCase()
  const address = requestedAddress.trim().toLowerCase()
  if (!name) throw new Error('establishment must be a non-empty string.')

  const addressMatches = (restaurant: RestaurantWithStats) =>
    !address || (restaurant.full_address || restaurant.address).toLowerCase().includes(address)
  const exact = restaurants.filter((restaurant) => restaurant.name.toLowerCase() === name && addressMatches(restaurant))
  if (exact.length === 1) return exact[0]

  const partial = restaurants.filter(
    (restaurant) =>
      `${restaurant.name} ${restaurant.full_address || restaurant.address}`.toLowerCase().includes(name) &&
      addressMatches(restaurant),
  )
  if (partial.length === 1) return partial[0]

  const matches = exact.length > 1 ? exact : partial
  if (matches.length === 0) {
    throw new Error(`No currently filtered establishment matches "${requested}".`)
  }
  const choices = matches
    .slice(0, 8)
    .map((restaurant) => `${restaurant.name} — ${restaurant.full_address || restaurant.address}`)
    .join('; ')
  throw new Error(`The establishment is ambiguous. Add an address. Matches: ${choices}`)
}

export interface FoodCrimeRankingOptions {
  radiusMeters: number
  lookbackMonths: number
  crimeWeight: number
  maxResults: number
  requireInspections?: boolean
  referenceDate?: Date
}

function haversineMeters(aLatitude: number, aLongitude: number, bLatitude: number, bLongitude: number) {
  const earthRadiusMeters = 6_371_000
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(bLatitude - aLatitude)
  const longitudeDelta = radians(bLongitude - aLongitude)
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(aLatitude)) * Math.cos(radians(bLatitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a))
}

function isWithinRadius(latitude: number, longitude: number, incident: CrimeIncident, radiusMeters: number) {
  const latitudeDelta = radiusMeters / 111_320
  const longitudeDelta = radiusMeters / (111_320 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)))
  if (Math.abs(incident.latitude - latitude) > latitudeDelta) return false
  if (Math.abs(incident.longitude - longitude) > longitudeDelta) return false
  return haversineMeters(latitude, longitude, incident.latitude, incident.longitude) <= radiusMeters
}

function lowerBurdenPercentile(value: number, values: number[]) {
  if (values.length <= 1) return 0
  return values.filter((candidate) => candidate < value).length / (values.length - 1)
}

export function rankFoodOptionsBySafety(
  restaurants: RestaurantWithStats[],
  incidents: CrimeIncident[],
  options: FoodCrimeRankingOptions,
) {
  const referenceDate = options.referenceDate ?? new Date()
  const earliestCrimeDate = new Date(referenceDate)
  earliestCrimeDate.setMonth(earliestCrimeDate.getMonth() - options.lookbackMonths)
  const recentIncidents = incidents.filter(
    (incident) => incident.date >= earliestCrimeDate && incident.date <= referenceDate,
  )
  const mappedRestaurants = restaurants.filter(
    (restaurant) =>
      restaurant.latitude != null &&
      restaurant.longitude != null &&
      (options.requireInspections === false || (restaurant.violationStats?.inspectionCount ?? 0) > 0),
  )
  const rows = mappedRestaurants.map((restaurant) => ({
    restaurant,
    nearbyCrimeIncidents: recentIncidents.reduce(
      (count, incident) =>
        count + Number(isWithinRadius(restaurant.latitude!, restaurant.longitude!, incident, options.radiusMeters)),
      0,
    ),
    violations: restaurant.violationStats?.total ?? 0,
  }))
  const crimeValues = rows.map((row) => row.nearbyCrimeIncidents)
  const violationValues = rows.map((row) => row.violations)
  const crimeShare = options.crimeWeight / 100

  return rows
    .map((row) => {
      const crimeBurden = lowerBurdenPercentile(row.nearbyCrimeIncidents, crimeValues)
      const violationBurden = lowerBurdenPercentile(row.violations, violationValues)
      const combinedBurden = crimeBurden * crimeShare + violationBurden * (1 - crimeShare)
      return {
        ...summarizeFoodEstablishment(row.restaurant),
        nearbyCrimeIncidents: row.nearbyCrimeIncidents,
        crimePercentile: Math.round(crimeBurden * 1000) / 10,
        violationPercentile: Math.round(violationBurden * 1000) / 10,
        suitabilityScore: Math.round((1 - combinedBurden) * 1000) / 10,
      }
    })
    .sort(
      (a, b) =>
        b.suitabilityScore - a.suitabilityScore ||
        a.violations - b.violations ||
        a.nearbyCrimeIncidents - b.nearbyCrimeIncidents ||
        a.name.localeCompare(b.name),
    )
    .slice(0, options.maxResults)
}

interface FoodMapWebMCPData {
  loading: boolean
  error: string | null
  restaurants: RestaurantWithStats[]
  filteredRestaurants: RestaurantWithStats[]
  geocodedRestaurants: RestaurantWithStats[]
  selectedRestaurant: RestaurantWithStats | null
  filters: FoodMapFilters
  filterActions: FoodMapFilterActions
  selectedViolationBuckets: FoodViolationBucket[]
  setSelectedViolationBuckets: (buckets: FoodViolationBucket[]) => void
  violationTimelineLabel: string
  timelineStats: TimelineStats
  hazardStatsAtDate: HazardStatsAtDate
  crimeIncidents: CrimeIncident[]
  crimeLoading: boolean
  crimeError: string | null
  clearSelection: () => void
  selectRestaurant: (restaurant: RestaurantWithStats) => void
  showRestaurant: () => void
  showInspections: () => void
}

function foodContext(data: FoodMapWebMCPData, maxResults: number) {
  const ranked = [...data.filteredRestaurants]
    .sort((a, b) => {
      const riskDifference = (b.violationStats?.risk?.score ?? 0) - (a.violationStats?.risk?.score ?? 0)
      if (riskDifference !== 0) return riskDifference
      const criticalDifference = (b.violationStats?.critical ?? 0) - (a.violationStats?.critical ?? 0)
      if (criticalDifference !== 0) return criticalDifference
      return a.name.localeCompare(b.name)
    })
    .slice(0, maxResults)

  return {
    dataset: {
      establishments: data.restaurants.length,
      filteredEstablishments: data.filteredRestaurants.length,
      mappedEstablishments: data.geocodedRestaurants.length,
      interpretation:
        'Historical public inspection records. Hazard ratings and violation summaries are not real-time safety advice.',
    },
    crossDataset: {
      propertyCrimeIncidentsLoaded: data.crimeIncidents.length,
      propertyCrimeLoading: data.crimeLoading,
      propertyCrimeError: data.crimeError,
    },
    filters: {
      query: data.filters.searchQuery,
      visualizationMode: data.filters.visualizationMode,
      hazardRatings: data.filters.hazardRatings,
      facilityTypes: data.filters.facilityTypes,
      violationBuckets: data.selectedViolationBuckets,
      timelineMonths: data.filters.timelineMonths,
      timelineMode: data.filters.violationTimelineMode,
      periodLabel: data.violationTimelineLabel,
    },
    results:
      data.filters.visualizationMode === 'violations' ? data.timelineStats : { hazardRatings: data.hazardStatsAtDate },
    selected: data.selectedRestaurant ? summarizeFoodEstablishment(data.selectedRestaurant) : null,
    highestRiskMatches: ranked.map(summarizeFoodEstablishment),
    availableFilters: {
      hazardRatings: HAZARD_RATING_OPTIONS,
      facilityTypes: FACILITY_TYPE_OPTIONS,
      violationBuckets: FOOD_VIOLATION_BUCKETS,
      timelineMonths: TIMELINE_MONTH_OPTIONS,
    },
  }
}

export function useFoodMapWebMCP(data: FoodMapWebMCPData) {
  const tools = useMemo<WebMCPTool[]>(
    () => [
      {
        name: 'get_food_safety_context',
        title: 'Get food safety context',
        description:
          'Read the active food-safety map filters, historical inspection totals, selected establishment, and highest-risk matching establishments. Treat records as historical public-health context, not real-time safety advice.',
        inputSchema: {
          type: 'object',
          properties: {
            maxResults: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
          },
          additionalProperties: false,
        },
        annotations: READ_ONLY,
        execute(input) {
          if (data.loading) throw new Error('Food-safety inspection data is still loading. Try again in a moment.')
          if (data.error) throw new Error(`Food-safety inspection data could not be loaded: ${data.error}`)
          const record = asInputRecord(input)
          rejectUnknownKeys(record, ['maxResults'])
          return foodContext(data, boundedMaxResults(record))
        },
      },
      {
        name: 'filter_food_safety_map',
        title: 'Filter the food safety map',
        description:
          'Update the visible food-safety map by name or address, hazard rating, facility type, violation count, and inspection period. Omitted fields stay unchanged; empty arrays intentionally show no matches.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 160 },
            visualizationMode: { type: 'string', enum: VISUALIZATION_MODES },
            hazardRatings: { type: 'array', uniqueItems: true, items: { type: 'string', enum: HAZARD_RATING_OPTIONS } },
            facilityTypes: { type: 'array', uniqueItems: true, items: { type: 'string', enum: FACILITY_TYPE_OPTIONS } },
            violationBuckets: {
              type: 'array',
              uniqueItems: true,
              items: { type: 'string', enum: FOOD_VIOLATION_BUCKETS },
            },
            timelineMonths: { type: 'integer', enum: TIMELINE_MONTH_OPTIONS },
            timelineMode: { type: 'string', enum: TIMELINE_MODES },
          },
          additionalProperties: false,
        },
        annotations: UI_ACTION,
        async execute(input) {
          const record = asInputRecord(input)
          rejectUnknownKeys(record, [
            'query',
            'visualizationMode',
            'hazardRatings',
            'facilityTypes',
            'violationBuckets',
            'timelineMonths',
            'timelineMode',
          ])
          const query = optionalText(record, 'query')
          const visualizationMode = enumValue(record, 'visualizationMode', VISUALIZATION_MODES)
          const hazardRatings = stringArray(record, 'hazardRatings', HAZARD_RATING_OPTIONS)
          const facilityTypes = stringArray(record, 'facilityTypes', FACILITY_TYPE_OPTIONS)
          const violationBuckets = stringArray(record, 'violationBuckets', FOOD_VIOLATION_BUCKETS)
          const timelineMode = enumValue(record, 'timelineMode', TIMELINE_MODES)
          const timelineMonths = record.timelineMonths
          if (
            timelineMonths !== undefined &&
            (!Number.isInteger(timelineMonths) ||
              !TIMELINE_MONTH_OPTIONS.includes(timelineMonths as (typeof TIMELINE_MONTH_OPTIONS)[number]))
          ) {
            throw new Error(`timelineMonths must be one of: ${TIMELINE_MONTH_OPTIONS.join(', ')}.`)
          }

          const filterPatch: Partial<FoodMapFilters> = {}
          if (query !== undefined) filterPatch.searchQuery = query
          if (visualizationMode !== undefined) filterPatch.visualizationMode = visualizationMode
          if (hazardRatings !== undefined) filterPatch.hazardRatings = hazardRatings as HazardRating[]
          if (facilityTypes !== undefined) filterPatch.facilityTypes = facilityTypes
          if (timelineMonths !== undefined) filterPatch.timelineMonths = timelineMonths as number
          if (timelineMode !== undefined) filterPatch.violationTimelineMode = timelineMode

          data.clearSelection()
          data.filterActions.applyFilters(filterPatch)
          if (violationBuckets !== undefined) data.setSelectedViolationBuckets(violationBuckets)
          await waitForVisibleUpdate()
          return {
            applied: {
              ...filterPatch,
              ...(violationBuckets === undefined ? {} : { violationBuckets }),
            },
            nextStep: 'Call get_food_safety_context to read the updated visible results.',
          }
        },
      },
      {
        name: 'rank_food_options',
        title: 'Rank food options by violations and nearby crime',
        description:
          'Find the best currently filtered food establishments for a user who wants both fewer inspection violations and fewer nearby mapped property-crime incidents. Returns a transparent, balanced ranking; call select_food_establishment to open the chosen result.',
        inputSchema: {
          type: 'object',
          properties: {
            radiusMeters: {
              type: 'integer',
              enum: CRIME_RADIUS_OPTIONS,
              default: 500,
              description: 'Radius around each establishment used to count mapped incidents.',
            },
            crimeLookbackMonths: {
              type: 'integer',
              enum: CRIME_LOOKBACK_OPTIONS,
              default: 36,
              description: 'Historical window used for nearby property-crime incidents.',
            },
            crimeWeight: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              default: 50,
              description: 'Percent of the ranking assigned to nearby crime; the remainder is inspection violations.',
            },
            requireInspections: {
              type: 'boolean',
              default: true,
              description: 'Exclude establishments with no inspections in the active food-map period.',
            },
            maxResults: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
          },
          additionalProperties: false,
        },
        annotations: READ_ONLY,
        execute(input) {
          if (data.loading) throw new Error('Food-safety inspection data is still loading. Try again in a moment.')
          if (data.crimeLoading) throw new Error('Nearby property-crime data is still loading. Try again in a moment.')
          if (data.error) throw new Error(`Food-safety inspection data could not be loaded: ${data.error}`)
          if (data.crimeError) throw new Error(`Property-crime data could not be loaded: ${data.crimeError}`)
          if (data.crimeIncidents.length === 0)
            throw new Error('No mapped property-crime incidents are available for ranking.')
          if (data.filteredRestaurants.length === 0)
            throw new Error('No food establishments match the current filters.')

          const record = asInputRecord(input)
          rejectUnknownKeys(record, [
            'radiusMeters',
            'crimeLookbackMonths',
            'crimeWeight',
            'requireInspections',
            'maxResults',
          ])
          const radiusMeters = record.radiusMeters ?? 500
          const crimeLookbackMonths = record.crimeLookbackMonths ?? 36
          const crimeWeight = record.crimeWeight ?? 50
          const requireInspections = record.requireInspections ?? true
          const maxResults = record.maxResults ?? 5
          if (
            !Number.isInteger(radiusMeters) ||
            !CRIME_RADIUS_OPTIONS.includes(radiusMeters as (typeof CRIME_RADIUS_OPTIONS)[number])
          ) {
            throw new Error(`radiusMeters must be one of: ${CRIME_RADIUS_OPTIONS.join(', ')}.`)
          }
          if (
            !Number.isInteger(crimeLookbackMonths) ||
            !CRIME_LOOKBACK_OPTIONS.includes(crimeLookbackMonths as (typeof CRIME_LOOKBACK_OPTIONS)[number])
          ) {
            throw new Error(`crimeLookbackMonths must be one of: ${CRIME_LOOKBACK_OPTIONS.join(', ')}.`)
          }
          if (!Number.isInteger(crimeWeight) || Number(crimeWeight) < 0 || Number(crimeWeight) > 100) {
            throw new Error('crimeWeight must be an integer from 0 to 100.')
          }
          if (typeof requireInspections !== 'boolean') throw new Error('requireInspections must be a boolean.')
          if (!Number.isInteger(maxResults) || Number(maxResults) < 1 || Number(maxResults) > 10) {
            throw new Error('maxResults must be an integer from 1 to 10.')
          }

          const ranked = rankFoodOptionsBySafety(data.filteredRestaurants, data.crimeIncidents, {
            radiusMeters: Number(radiusMeters),
            lookbackMonths: Number(crimeLookbackMonths),
            crimeWeight: Number(crimeWeight),
            maxResults: Number(maxResults),
            requireInspections,
          })
          const eligibleEstablishments = data.filteredRestaurants.filter(
            (restaurant) =>
              restaurant.latitude != null &&
              restaurant.longitude != null &&
              (!requireInspections || (restaurant.violationStats?.inspectionCount ?? 0) > 0),
          ).length
          return {
            comparedEstablishments: data.filteredRestaurants.length,
            eligibleEstablishments,
            mappedCrimeIncidentsLoaded: data.crimeIncidents.length,
            parameters: {
              radiusMeters,
              crimeLookbackMonths,
              crimeWeightPercent: crimeWeight,
              violationWeightPercent: 100 - Number(crimeWeight),
              requireInspections,
              inspectionPeriod: data.violationTimelineLabel,
            },
            methodology:
              'Eligible establishments receive percentile burdens for violations in the active food-map period and mapped property-crime incidents within the chosen radius and lookback. By default, places without an inspection in that period are excluded rather than treated as zero-risk. The weighted burden is inverted to a 0-100 suitability score; higher is better.',
            caveat:
              'This is exploratory planning context, not a guarantee of personal safety or food quality. Incident locations and inspection records are historical and may be incomplete or spatially generalized.',
            ranked,
            nextStep: ranked[0]
              ? `Discuss the tradeoff with the user, then call select_food_establishment for "${ranked[0].name}" if they approve.`
              : 'Broaden the food-map filters and try again.',
          }
        },
      },
      {
        name: 'select_food_establishment',
        title: 'Select a food establishment',
        description:
          'Select one establishment from the currently filtered food-safety results and open it on the shared map. Optionally open its inspection-history panel.',
        inputSchema: {
          type: 'object',
          properties: {
            establishment: { type: 'string', minLength: 1, maxLength: 160 },
            address: {
              type: 'string',
              maxLength: 200,
              description: 'Optional address fragment when a name is ambiguous.',
            },
            openInspections: { type: 'boolean', default: false },
          },
          required: ['establishment'],
          additionalProperties: false,
        },
        annotations: UI_ACTION,
        execute(input) {
          const record = asInputRecord(input)
          rejectUnknownKeys(record, ['establishment', 'address', 'openInspections'])
          const establishment = optionalText(record, 'establishment')
          if (!establishment) throw new Error('establishment must be a non-empty string.')
          const address = optionalText(record, 'address', 200) ?? ''
          if (record.openInspections !== undefined && typeof record.openInspections !== 'boolean') {
            throw new Error('openInspections must be a boolean.')
          }
          const selected = resolveFoodEstablishment(data.filteredRestaurants, establishment, address)
          data.selectRestaurant(selected)
          data.showRestaurant()
          if (record.openInspections) data.showInspections()
          return {
            selected: summarizeFoodEstablishment(selected),
            inspectionPanelOpen: Boolean(record.openInspections),
          }
        },
      },
    ],
    [data],
  )

  useWebMCPTools(tools)
}
