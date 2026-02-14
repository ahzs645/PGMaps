#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as turf from '@turf/turf'

const SERVICE_BASE = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer'
const TARGET_PR_UID = '59'
const TARGET_CD_UID = '5953'
const TARGET_CSD_UID = '5953023'
const PAGE_SIZE = 2000

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const outputDir = path.join(projectRoot, 'public/data/census')
const daDataPath = path.join(outputDir, 'prince_george_da_data.json')

function toNumber(value) {
  if (value == null) return null
  const cleaned = String(value).replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function chooseNumber(...values) {
  for (const value of values) {
    const parsed = toNumber(value)
    if (parsed != null) return parsed
  }
  return null
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed (${response.status}) for ${url}\n${body.slice(0, 400)}`)
  }
  return response.json()
}

async function queryLayerGeoJson(layerId, options) {
  const { where, outFields = '*', envelope = null } = options
  const features = []
  let offset = 0

  while (true) {
    const params = new URLSearchParams()
    params.set('where', where)
    params.set('outFields', outFields)
    params.set('returnGeometry', 'true')
    params.set('f', 'geojson')
    params.set('outSR', '4326')
    params.set('resultOffset', String(offset))
    params.set('resultRecordCount', String(PAGE_SIZE))
    if (envelope) {
      params.set('geometry', envelope.join(','))
      params.set('geometryType', 'esriGeometryEnvelope')
      params.set('spatialRel', 'esriSpatialRelIntersects')
      params.set('inSR', '4326')
    }

    const url = `${SERVICE_BASE}/${layerId}/query?${params.toString()}`
    const json = await fetchJson(url)
    const batch = Array.isArray(json.features) ? json.features : []
    features.push(...batch)

    if (batch.length < PAGE_SIZE) break
    offset += batch.length
  }

  return {
    type: 'FeatureCollection',
    features
  }
}

function featureCentroid(feature) {
  return turf.centroid(feature)
}

function isPointInside(point, polygonFeature) {
  return turf.booleanPointInPolygon(point, polygonFeature, { ignoreBoundary: false })
}

function byCentroidWithin(featureCollection, polygonFeature) {
  return {
    type: 'FeatureCollection',
    features: featureCollection.features.filter((feature) => {
      const point = featureCentroid(feature)
      return isPointInside(point, polygonFeature)
    })
  }
}

function sortById(features) {
  return [...features].sort((a, b) => {
    const aId = String(a.properties?.id || '')
    const bId = String(b.properties?.id || '')
    return aId.localeCompare(bId)
  })
}

function metricTemplate(level) {
  return {
    id: '',
    name: '',
    level,
    population: null,
    households: null,
    dwellings: null,
    areaSqKm: null,
    populationDensity: null,
    daCount: 0,
    dbCount: 0,
    parentCdId: null,
    parentCsdId: null,
    parentCtId: null,
    parentDaId: null
  }
}

function aggregateInto(target, daProps) {
  target.population = (target.population || 0) + (daProps.population || 0)
  target.households = (target.households || 0) + (daProps.households || 0)
  target.dwellings = (target.dwellings || 0) + (daProps.dwellings || 0)
  target.areaSqKm = (target.areaSqKm || 0) + (daProps.areaSqKm || 0)
  target.daCount += 1
}

function finalizeMetrics(props) {
  if (props.populationDensity == null) {
    const population = props.population || 0
    const area = props.areaSqKm || 0
    props.populationDensity = area > 0 ? population / area : null
  }
}

function findContainingId(point, features, idKey = 'id') {
  for (const feature of features) {
    if (isPointInside(point, feature)) {
      return String(feature.properties?.[idKey] || '')
    }
  }
  return null
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })

  const daDataJson = JSON.parse(await fs.readFile(daDataPath, 'utf8'))
  const daRows = Array.isArray(daDataJson.data) ? daDataJson.data : []
  const daRowsById = new Map()
  daRows.forEach((row) => {
    if (row.GeoUID) daRowsById.set(String(row.GeoUID), row)
  })

  console.log('Fetching CSD geometry...')
  const csdRaw = await queryLayerGeoJson(9, {
    where: `CSDUID='${TARGET_CSD_UID}'`
  })
  const csdBoundary = csdRaw.features[0]
  if (!csdBoundary) {
    throw new Error(`No CSD geometry found for CSDUID ${TARGET_CSD_UID}`)
  }

  const envelope = turf.bbox(csdBoundary)
  console.log('Fetching CD/CSD/CT/DA/DB geometries in Prince George extent...')

  const [cdRaw, ctRaw, daRaw, dbRaw] = await Promise.all([
    queryLayerGeoJson(4, { where: `CDUID='${TARGET_CD_UID}'` }),
    queryLayerGeoJson(11, { where: `PRUID='${TARGET_PR_UID}'`, envelope }),
    queryLayerGeoJson(12, { where: `PRUID='${TARGET_PR_UID}'`, envelope }),
    queryLayerGeoJson(13, { where: `PRUID='${TARGET_PR_UID}'`, envelope })
  ])

  const ctClipped = byCentroidWithin(ctRaw, csdBoundary)
  const daClipped = byCentroidWithin(daRaw, csdBoundary)
  const dbClipped = byCentroidWithin(dbRaw, csdBoundary)

  console.log(`CD features: ${cdRaw.features.length}`)
  console.log(`CSD features: ${csdRaw.features.length}`)
  console.log(`CT features: ${ctClipped.features.length}`)
  console.log(`DA features: ${daClipped.features.length}`)
  console.log(`DB features: ${dbClipped.features.length}`)

  const cdFeatures = sortById(
    cdRaw.features
      .map((feature) => {
        const id = String(feature.properties?.CDUID || '').trim()
        if (!id) return null
        return {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...metricTemplate('cd'),
            id,
            name: String(feature.properties?.CDNAME || `CD ${id}`),
            areaSqKm: chooseNumber(feature.properties?.LANDAREA),
            parentCdId: id
          }
        }
      })
      .filter(Boolean)
  )

  const csdFeatures = sortById(
    csdRaw.features
      .map((feature) => {
        const id = String(feature.properties?.CSDUID || '').trim()
        if (!id) return null
        return {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...metricTemplate('csd'),
            id,
            name: String(feature.properties?.CSDNAME || `CSD ${id}`),
            areaSqKm: chooseNumber(feature.properties?.LANDAREA),
            parentCdId: TARGET_CD_UID,
            parentCsdId: id
          }
        }
      })
      .filter(Boolean)
  )

  const ctFeatures = sortById(
    ctClipped.features
      .map((feature) => {
        const id = String(feature.properties?.CTUID || '').trim()
        if (!id) return null
        return {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...metricTemplate('ct'),
            id,
            name: String(feature.properties?.CTNAME || `CT ${id}`),
            areaSqKm: chooseNumber(feature.properties?.LANDAREA),
            parentCdId: TARGET_CD_UID,
            parentCsdId: TARGET_CSD_UID,
            parentCtId: id
          }
        }
      })
      .filter(Boolean)
  )

  const cdById = new Map(cdFeatures.map((feature) => [feature.properties.id, feature]))
  const csdById = new Map(csdFeatures.map((feature) => [feature.properties.id, feature]))
  const ctById = new Map(ctFeatures.map((feature) => [feature.properties.id, feature]))

  const daFeatures = sortById(
    daClipped.features
      .map((feature) => {
        const id = String(feature.properties?.DAUID || '').trim()
        if (!id) return null

        const row = daRowsById.get(id)
        const areaSqKm = chooseNumber(
          row?.['v_CA21_7: Land area in square kilometres'],
          row?.['Area (sq km)'],
          feature.properties?.LANDAREA
        )
        const population = chooseNumber(
          row?.['v_CA21_1: Population, 2021'],
          row?.['Population ']
        )
        const households = chooseNumber(
          row?.['v_CA21_434: Occupied private dwellings by structural type of dwelling data'],
          row?.['Households ']
        )
        const dwellings = chooseNumber(
          row?.['v_CA21_4: Total private dwellings'],
          row?.['Dwellings ']
        )

        const point = featureCentroid(feature)
        const ctId = findContainingId(point, ctFeatures, 'id')

        const props = {
          ...metricTemplate('da'),
          id,
          name: row?.['Region Name'] || `DA ${id}`,
          population,
          households,
          dwellings,
          areaSqKm,
          populationDensity: chooseNumber(row?.['v_CA21_6: Population density per square kilometre']),
          daCount: 1,
          parentCdId: TARGET_CD_UID,
          parentCsdId: TARGET_CSD_UID,
          parentCtId: ctId || null,
          parentDaId: id
        }
        finalizeMetrics(props)

        const cd = cdById.get(TARGET_CD_UID)
        const csd = csdById.get(TARGET_CSD_UID)
        const ct = ctId ? ctById.get(ctId) : null
        if (cd) aggregateInto(cd.properties, props)
        if (csd) aggregateInto(csd.properties, props)
        if (ct) aggregateInto(ct.properties, props)

        return {
          type: 'Feature',
          geometry: feature.geometry,
          properties: props
        }
      })
      .filter(Boolean)
  )

  const daById = new Map(daFeatures.map((feature) => [feature.properties.id, feature]))

  const dbFeatures = sortById(
    dbClipped.features
      .map((feature) => {
        const id = String(feature.properties?.DBUID || '').trim()
        if (!id) return null

        const point = featureCentroid(feature)
        const derivedDaId = id.slice(0, 8)
        const daId = daById.has(derivedDaId)
          ? derivedDaId
          : findContainingId(point, daFeatures, 'id')

        if (!daId) return null
        const parentDa = daById.get(daId)
        if (!parentDa) return null

        parentDa.properties.dbCount += 1
        const parentCt = parentDa.properties.parentCtId ? ctById.get(parentDa.properties.parentCtId) : null
        if (parentCt) parentCt.properties.dbCount += 1
        const parentCsd = csdById.get(TARGET_CSD_UID)
        if (parentCsd) parentCsd.properties.dbCount += 1
        const parentCd = cdById.get(TARGET_CD_UID)
        if (parentCd) parentCd.properties.dbCount += 1

        return {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {
            ...metricTemplate('db'),
            id,
            name: `DB ${id}`,
            areaSqKm: chooseNumber(feature.properties?.LANDAREA, turf.area(feature) / 1_000_000),
            parentCdId: parentDa.properties.parentCdId,
            parentCsdId: parentDa.properties.parentCsdId,
            parentCtId: parentDa.properties.parentCtId,
            parentDaId: daId
          }
        }
      })
      .filter(Boolean)
  )

  cdFeatures.forEach((feature) => finalizeMetrics(feature.properties))
  csdFeatures.forEach((feature) => finalizeMetrics(feature.properties))
  ctFeatures.forEach((feature) => finalizeMetrics(feature.properties))

  const outputs = {
    cd: { type: 'FeatureCollection', features: cdFeatures },
    csd: { type: 'FeatureCollection', features: csdFeatures },
    ct: { type: 'FeatureCollection', features: ctFeatures },
    da: { type: 'FeatureCollection', features: daFeatures },
    db: { type: 'FeatureCollection', features: dbFeatures }
  }

  await Promise.all(
    Object.entries(outputs).map(([level, featureCollection]) => {
      const filePath = path.join(outputDir, `prince_george_${level}.geo.json`)
      return fs.writeFile(filePath, JSON.stringify(featureCollection))
    })
  )

  console.log('\nWrote files:')
  Object.entries(outputs).forEach(([level, featureCollection]) => {
    console.log(`- prince_george_${level}.geo.json (${featureCollection.features.length} features)`)
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
