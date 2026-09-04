import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

const root = path.resolve(__dirname, '../../..')
const raw: unknown = JSON.parse(
  readFileSync(path.join(root, 'public/data/projects/echoscreen-climate-health.json'), 'utf8'),
)

function readNamedWatershed(streamOrder: number, namedWatershedId: number) {
  const sourcePath = path.join(
    root,
    `vendor/bcdatamapper/datascrapers/bc/boundaries/output/BCFWA/named_watersheds_stream_order_${streamOrder}_50m.geojson.gz`,
  )
  const collection = JSON.parse(gunzipSync(readFileSync(sourcePath)).toString('utf8')) as GeoJSON.FeatureCollection
  return collection.features.find((feature) => Number(feature.properties?.namedWatershedId) === namedWatershedId)
}

describe('echoscreen-climate-health project package', () => {
  const project = normalizeProjectPackage(raw)

  it('uses the build-derived local vector for the exact Fraser and Nechako records', () => {
    expect(project).not.toBeNull()
    const watershedLayers = project!.portalMap!.contextLayers.filter((layer) => layer.id === 'fraser-nechako')

    expect(watershedLayers).toMatchObject([
      {
        data: '/data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson',
        featureProperty: 'namedWatershedId',
        featureValue: 11541,
      },
      {
        data: '/data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson',
        featureProperty: 'namedWatershedId',
        featureValue: 8886,
      },
    ])
    expect(watershedLayers.every((layer) => layer.mapPath === undefined)).toBe(true)
  })

  it('pins the requested IDs to the canonical Freshwater Atlas source features', () => {
    expect(readNamedWatershed(8, 8886)?.properties).toMatchObject({
      name: 'Nechako River',
      streamOrder: 8,
      areaKm2: 47257.951,
    })
    expect(readNamedWatershed(10, 11541)?.properties).toMatchObject({
      name: 'Fraser River',
      streamOrder: 10,
      areaKm2: 231524.875,
    })
  })

  it('renders hospitals from the deduplicated local point source with the supplied SVG', () => {
    const hospitalLayer = project!.portalMap!.contextLayers.find((layer) => layer.id === 'hospitals')
    expect(hospitalLayer).toMatchObject({
      data: '/data/health/echoscreen-northern-health-hospitals.geojson',
      geometry: 'point',
      icon: '/media/dev-projects/red-cross-icon-circle-background.svg',
      idProperty: 'id',
      labelProperty: 'name',
    })
    expect(hospitalLayer?.mapPath).toBeUndefined()

    const registry = JSON.parse(
      readFileSync(
        path.join(
          root,
          'vendor/bcdatamapper/data-sources/healthdata/health_place_registry/health_place_registry.geojson',
        ),
        'utf8',
      ),
    ) as GeoJSON.FeatureCollection<GeoJSON.Point>
    const northernHospitalCoordinates = new Set(
      registry.features
        .filter(
          (feature) =>
            feature.properties?.place_type === 'hospital' &&
            String(feature.properties?.source_url ?? '').includes('northernhealth.ca'),
        )
        .map((feature) => feature.geometry.coordinates.map((coordinate) => coordinate.toFixed(6)).join(',')),
    )
    expect(northernHospitalCoordinates.size).toBe(18)

    const icon = readFileSync(path.join(root, 'public/media/dev-projects/red-cross-icon-circle-background.svg'), 'utf8')
    expect(icon).toContain('stroke="#F51D25"')
    expect(icon).toContain('fill="white"')
  })

  it('uses the shared PGMaps Northern Health authority vector', () => {
    const boundary = project!.portalMap!.contextLayers.find((layer) => layer.id === 'northern-health')

    expect(project!.portalMap!.localBoundaryLayerId).toBeUndefined()
    expect(boundary).toMatchObject({
      data: '/data/boundaries/BCMoH/simplified/health_authorities.json',
      featureProperty: 'HLTH_AUTHORITY_NAME',
      featureValue: 'Northern',
      idProperty: 'HLTH_AUTHORITY_CODE',
      legendLabel: 'Northern Health boundary',
    })
  })
})
