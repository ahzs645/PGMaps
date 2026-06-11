import { useMemo } from 'react'
import buffer from '@turf/buffer'
import { point } from '@turf/helpers'
import type { AirMonitor } from '@/maps/airquality'
import {
  bboxCenter,
  computeValueGrowth,
  estimateCanopyAreaSqKm,
  featureCount,
  featureLengthKm,
  featurePoint,
  geometryBounds,
  hazardWeight,
  type ParkBufferRecord,
} from '../lib/spatial'
import type { ScoreDataSource } from '../types'
import type { CimdRecord } from './useCimdData'
import type { ScoreBuilderDatasets } from './useScoreBuilderDatasets'

export interface MonitorPointRecord {
  monitor: AirMonitor
  feature: GeoJSON.Feature<GeoJSON.Point>
}

export interface PointRecord {
  lng: number
  lat: number
  feature: GeoJSON.Feature<GeoJSON.Point>
}

export interface PropertyPointRecord extends PointRecord {
  assessedValue: number
  landValue: number
  buildingValue: number
  valueGrowth: number | null
  yearBuilt: number | null
  category: string
  ct: string | null
  da: string | null
}

export interface CrimePointRecord extends PointRecord {
  date: Date
  recent: boolean
}

export interface TransitPointRecord extends PointRecord {
  accessible: boolean
  hasShelter: boolean
  frequent: boolean
  weekdayTrips: number
  serviceSpanHours: number
}

export interface WalkabilityLineRecord extends PointRecord {
  kind: 'sidewalk' | 'walkway'
  lengthKm: number
}

export interface WalkabilityPointRecord extends PointRecord {
  kind: 'intersection' | 'crossing' | 'childcare' | 'poi' | 'class3Crosswalk' | 'pedestrianCrash'
  count: number
}

export interface HeatShadeTreePointRecord extends PointRecord {
  mature: boolean
  canopyAreaSqKm: number
}

export interface HeatShadeForestRecord extends PointRecord {
  areaSqKm: number
}

export interface HeatShadeFacilityPointRecord extends PointRecord {
  kind: 'communityFacility' | 'responseFacility'
}

export interface CimdPointRecord extends PointRecord {
  cimd: CimdRecord
}

type SourceSet = ReadonlySet<ScoreDataSource>

function useAirQualityRecords(enabledSourceSet: SourceSet, monitors: AirMonitor[], selectedNetworks: string[]) {
  const networkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    monitors.forEach((monitor) => {
      counts.set(monitor.network, (counts.get(monitor.network) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [monitors])

  const allNetworks = useMemo(() => networkCounts.map(([network]) => network), [networkCounts])
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const hasActiveNetworks = enabledSourceSet.has('airQuality') && selectedNetworks.length > 0

  const filteredMonitors = useMemo(() => {
    if (!hasActiveNetworks) return []
    return monitors.filter((monitor) => selectedNetworkSet.has(monitor.network))
  }, [hasActiveNetworks, monitors, selectedNetworkSet])

  const monitorPointRecords = useMemo<MonitorPointRecord[]>(() => {
    return filteredMonitors.map((monitor) => ({
      monitor,
      feature: point([monitor.longitude, monitor.latitude]),
    }))
  }, [filteredMonitors])

  return { networkCounts, allNetworks, filteredMonitors, monitorPointRecords }
}

function useParksRecords(
  enabledSourceSet: SourceSet,
  parks: ScoreBuilderDatasets['parks'],
  trails: ScoreBuilderDatasets['trails'],
  amenities: ScoreBuilderDatasets['amenities'],
  shouldComputeParkBufferAccess: boolean,
) {
  // Park centroid points
  const parkPointRecords = useMemo<Array<PointRecord & { areaSqKm: number }>>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return parks
      .map((park) => {
        const center = bboxCenter(park.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          areaSqKm: (park.area || 0) / 1_000_000,
        }
      })
      .filter(Boolean) as Array<PointRecord & { areaSqKm: number }>
  }, [enabledSourceSet, parks])

  // 1-mile (1.6 km) walkable buffers, only built while the access-gap metric is weighted.
  const parkBufferRecords = useMemo<ParkBufferRecord[]>(() => {
    if (!shouldComputeParkBufferAccess) return []
    return parks
      .map((park) => {
        try {
          const buffered = buffer(
            {
              type: 'Feature',
              properties: {},
              geometry: park.geometry,
            },
            1.6,
            { units: 'kilometers' },
          ) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | undefined
          if (!buffered?.geometry) return null
          const bounds = geometryBounds(buffered.geometry)
          if (!bounds) return null
          return { feature: buffered, bounds }
        } catch {
          return null
        }
      })
      .filter(Boolean) as ParkBufferRecord[]
  }, [parks, shouldComputeParkBufferAccess])

  // Trail midpoint points
  const trailPointRecords = useMemo<Array<PointRecord & { lengthKm: number }>>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return trails
      .filter((t) => t.coordinates.length >= 2)
      .map((trail) => {
        const mid = Math.floor(trail.coordinates.length / 2)
        const [lng, lat] = trail.coordinates[mid]
        return {
          lng,
          lat,
          feature: point([lng, lat]),
          lengthKm: (trail.length || 0) / 1000,
        }
      })
  }, [enabledSourceSet, trails])

  // Amenity points
  const amenityPointRecords = useMemo<PointRecord[]>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return amenities
      .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
      .map((a) => ({
        lng: a.longitude,
        lat: a.latitude,
        feature: point([a.longitude, a.latitude]),
      }))
  }, [amenities, enabledSourceSet])

  return { parkPointRecords, parkBufferRecords, trailPointRecords, amenityPointRecords }
}

function useRestaurantRecords(enabledSourceSet: SourceSet, restaurants: ScoreBuilderDatasets['restaurants']) {
  return useMemo<
    Array<
      PointRecord & {
        hazard: number
        inspectionCount: number
        criticalViolations: number
        followUps: number
      }
    >
  >(() => {
    if (!enabledSourceSet.has('restaurants')) return []
    return restaurants
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => {
        const inspections = r.inspections || []
        return {
          lng: r.longitude as number,
          lat: r.latitude as number,
          feature: point([r.longitude as number, r.latitude as number]),
          hazard: hazardWeight(r.current_hazard_rating || r.hazard_rating),
          inspectionCount: inspections.length,
          criticalViolations: inspections.reduce(
            (sum, inspection) => sum + (inspection.critical_violations_count || 0),
            0,
          ),
          followUps: inspections.reduce(
            (sum, inspection) => sum + (String(inspection.follow_up_required || '').toLowerCase() === 'yes' ? 1 : 0),
            0,
          ),
        }
      })
  }, [enabledSourceSet, restaurants])
}

function useCensusRecords(enabledSourceSet: SourceSet, censusUnitsDa: ScoreBuilderDatasets['censusUnitsByLevel']['da']) {
  // Census DA centroid points
  return useMemo<Array<PointRecord & { population: number }>>(() => {
    if (!enabledSourceSet.has('census')) return []
    return censusUnitsDa
      .map((unit) => {
        const center = bboxCenter(unit.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          population: unit.population || 0,
        }
      })
      .filter(Boolean) as Array<PointRecord & { population: number }>
  }, [enabledSourceSet, censusUnitsDa])
}

function usePropertyRecords(enabledSourceSet: SourceSet, properties: ScoreBuilderDatasets['properties']) {
  return useMemo<PropertyPointRecord[]>(() => {
    if (!enabledSourceSet.has('bcAssessment')) return []
    return properties
      .filter((property) => Number.isFinite(property.latitude) && Number.isFinite(property.longitude))
      .map((property) => ({
        lng: property.longitude,
        lat: property.latitude,
        feature: point([property.longitude, property.latitude]),
        assessedValue: property.totalAssessed || 0,
        landValue: property.totalLand || 0,
        buildingValue: property.totalBuilding || 0,
        valueGrowth: computeValueGrowth(property.histValues),
        yearBuilt: property.yearBuilt,
        category: property.category,
        ct: property.ct,
        da: property.da,
      }))
  }, [enabledSourceSet, properties])
}

function useCrimeRecords(enabledSourceSet: SourceSet, incidents: ScoreBuilderDatasets['incidents']) {
  return useMemo<CrimePointRecord[]>(() => {
    if (!enabledSourceSet.has('crime')) return []
    const validIncidents = incidents.filter(
      (incident) =>
        Number.isFinite(incident.latitude) &&
        Number.isFinite(incident.longitude) &&
        !Number.isNaN(incident.date.getTime()),
    )
    const latestTime = validIncidents.reduce((latest, incident) => Math.max(latest, incident.date.getTime()), 0)
    const recentCutoff = latestTime > 0 ? latestTime - 180 * 24 * 60 * 60 * 1000 : 0
    return validIncidents.map((incident) => ({
      lng: incident.longitude,
      lat: incident.latitude,
      feature: point([incident.longitude, incident.latitude]),
      date: incident.date,
      recent: recentCutoff > 0 && incident.date.getTime() >= recentCutoff,
    }))
  }, [enabledSourceSet, incidents])
}

function useTransitRecords(enabledSourceSet: SourceSet, transitStops: ScoreBuilderDatasets['transitStops']) {
  return useMemo<TransitPointRecord[]>(() => {
    if (!enabledSourceSet.has('transit')) return []
    return transitStops
      .filter((stop) => stop.status === 'ACT')
      .map((stop) => ({
        lng: stop.longitude,
        lat: stop.latitude,
        feature: point([stop.longitude, stop.latitude]),
        accessible: stop.accessible,
        hasShelter: stop.hasShelter,
        frequent: stop.frequent,
        weekdayTrips: stop.weekdayTrips,
        serviceSpanHours: stop.serviceSpanHours,
      }))
  }, [enabledSourceSet, transitStops])
}

function useWalkabilityRecords(
  enabledSourceSet: SourceSet,
  collections: ScoreBuilderDatasets['walkabilityCollections'],
) {
  const walkabilityLineRecords = useMemo<WalkabilityLineRecord[]>(() => {
    if (!enabledSourceSet.has('walkability')) return []
    const buildLineRecords = (
      collection: GeoJSON.FeatureCollection | null | undefined,
      kind: WalkabilityLineRecord['kind'],
    ): WalkabilityLineRecord[] =>
      (collection?.features ?? [])
        .map((feature) => {
          if (!feature.geometry) return null
          const center = bboxCenter(feature.geometry)
          if (!center) return null
          return {
            lng: center[0],
            lat: center[1],
            feature: point(center),
            kind,
            lengthKm: featureLengthKm(feature),
          }
        })
        .filter((record): record is WalkabilityLineRecord => record !== null)
    return [
      ...buildLineRecords(collections.sidewalks, 'sidewalk'),
      ...buildLineRecords(collections.walkways, 'walkway'),
    ]
  }, [enabledSourceSet, collections.sidewalks, collections.walkways])

  const walkabilityPointRecords = useMemo<WalkabilityPointRecord[]>(() => {
    if (!enabledSourceSet.has('walkability')) return []
    const buildPointRecords = (
      collection: GeoJSON.FeatureCollection | null | undefined,
      kind: WalkabilityPointRecord['kind'],
    ): WalkabilityPointRecord[] =>
      (collection?.features ?? [])
        .map((feature) => {
          const pointFeature = featurePoint(feature)
          if (!pointFeature?.geometry || pointFeature.geometry.type !== 'Point') return null
          const [lng, lat] = pointFeature.geometry.coordinates
          return { lng, lat, feature: pointFeature, kind, count: featureCount(feature) }
        })
        .filter((record): record is WalkabilityPointRecord => record !== null)
    return [
      ...buildPointRecords(collections.intersections, 'intersection'),
      ...buildPointRecords(collections.crossings, 'crossing'),
      ...buildPointRecords(collections.childcare, 'childcare'),
      ...buildPointRecords(collections.osmDaycares, 'childcare'),
      ...buildPointRecords(collections.class3Crosswalks, 'class3Crosswalk'),
      ...buildPointRecords(collections.supplementalPoi, 'poi'),
      ...buildPointRecords(collections.intercityStops, 'poi'),
      ...buildPointRecords(collections.pedestrianCrashes, 'pedestrianCrash'),
    ]
  }, [
    enabledSourceSet,
    collections.childcare,
    collections.class3Crosswalks,
    collections.crossings,
    collections.intercityStops,
    collections.intersections,
    collections.osmDaycares,
    collections.pedestrianCrashes,
    collections.supplementalPoi,
  ])

  return { walkabilityLineRecords, walkabilityPointRecords }
}

function useHeatShadeRecords(
  enabledSourceSet: SourceSet,
  trees: ScoreBuilderDatasets['heatShadeTrees'],
  forests: ScoreBuilderDatasets['heatShadeForests'],
  facilities: ScoreBuilderDatasets['heatShadeFacilities'],
) {
  const heatShadeTreePointRecords = useMemo<HeatShadeTreePointRecord[]>(() => {
    if (!enabledSourceSet.has('heatShade')) return []
    return trees.map((tree) => ({
      lng: tree.longitude,
      lat: tree.latitude,
      feature: point([tree.longitude, tree.latitude]),
      mature: (tree.dbh ?? 0) >= 20 || (tree.treeAge ?? 0) >= 20,
      canopyAreaSqKm: estimateCanopyAreaSqKm(tree.dbh, tree.treeAge),
    }))
  }, [enabledSourceSet, trees])

  const heatShadeForestRecords = useMemo<HeatShadeForestRecord[]>(() => {
    if (!enabledSourceSet.has('heatShade')) return []
    return forests
      .map((forest) => {
        const center = bboxCenter(forest.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          areaSqKm: forest.areaSqKm,
        }
      })
      .filter((record): record is HeatShadeForestRecord => record !== null)
  }, [enabledSourceSet, forests])

  const heatShadeFacilityPointRecords = useMemo<HeatShadeFacilityPointRecord[]>(() => {
    if (!enabledSourceSet.has('heatShade')) return []
    return facilities.map((facility) => ({
      lng: facility.longitude,
      lat: facility.latitude,
      feature: point([facility.longitude, facility.latitude]),
      kind: facility.kind,
    }))
  }, [enabledSourceSet, facilities])

  return { heatShadeTreePointRecords, heatShadeForestRecords, heatShadeFacilityPointRecords }
}

function useCimdRecords(
  enabledSourceSet: SourceSet,
  cimdRecords: CimdRecord[],
  censusUnitsDa: ScoreBuilderDatasets['censusUnitsByLevel']['da'],
) {
  return useMemo<CimdPointRecord[]>(() => {
    if (!enabledSourceSet.has('deprivation') || cimdRecords.length === 0) return []
    const cimdByDa = new Map<string, CimdRecord>(cimdRecords.map((record) => [record.daCode, record]))
    return censusUnitsDa
      .map((unit) => {
        const cimd = cimdByDa.get(String(unit.id ?? '').trim())
        if (!cimd) return null
        const center = bboxCenter(unit.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          cimd,
        }
      })
      .filter((record): record is CimdPointRecord => record !== null)
  }, [cimdRecords, enabledSourceSet, censusUnitsDa])
}

export interface ScoreBuilderPointRecordsOptions {
  enabledSourceSet: SourceSet
  datasets: ScoreBuilderDatasets
  selectedNetworks: string[]
  /** True while the park access-gap metric carries weight, enabling the costly buffer build. */
  parkBufferAccessNeeded: boolean
}

/**
 * Converts each enabled raw dataset into the point/line/buffer record collections the
 * region aggregation consumes. Each domain is memoized independently so a change to one
 * dataset never recomputes the records of an unrelated one.
 */
export function useScoreBuilderPointRecords({
  enabledSourceSet,
  datasets,
  selectedNetworks,
  parkBufferAccessNeeded,
}: ScoreBuilderPointRecordsOptions) {
  const shouldComputeParkBufferAccess = enabledSourceSet.has('parks') && parkBufferAccessNeeded

  const air = useAirQualityRecords(enabledSourceSet, datasets.monitors, selectedNetworks)
  const parks = useParksRecords(
    enabledSourceSet,
    datasets.parks,
    datasets.trails,
    datasets.amenities,
    shouldComputeParkBufferAccess,
  )
  const restaurantPointRecords = useRestaurantRecords(enabledSourceSet, datasets.restaurants)
  const censusPointRecords = useCensusRecords(enabledSourceSet, datasets.censusUnitsByLevel.da)
  const propertyPointRecords = usePropertyRecords(enabledSourceSet, datasets.properties)
  const crimePointRecords = useCrimeRecords(enabledSourceSet, datasets.incidents)
  const transitPointRecords = useTransitRecords(enabledSourceSet, datasets.transitStops)
  const walkability = useWalkabilityRecords(enabledSourceSet, datasets.walkabilityCollections)
  const heatShade = useHeatShadeRecords(
    enabledSourceSet,
    datasets.heatShadeTrees,
    datasets.heatShadeForests,
    datasets.heatShadeFacilities,
  )
  const cimdPointRecords = useCimdRecords(enabledSourceSet, datasets.cimdRecords, datasets.censusUnitsByLevel.da)

  return {
    ...air,
    ...parks,
    shouldComputeParkBufferAccess,
    restaurantPointRecords,
    censusPointRecords,
    propertyPointRecords,
    crimePointRecords,
    transitPointRecords,
    ...walkability,
    ...heatShade,
    cimdPointRecords,
  }
}

export type ScoreBuilderPointRecords = ReturnType<typeof useScoreBuilderPointRecords>
