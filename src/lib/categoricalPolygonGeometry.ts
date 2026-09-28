import { geojsonToBinary } from '@loaders.gl/gis'

export type ClassCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, { value: number }>
export type PreparedPolygons = {
  binary: ReturnType<typeof geojsonToBinary>
  values: Float64Array
}

/** CPU-intensive work: call in a worker, never in the map's render effect. */
export function preparePolygons(collection: ClassCollection): PreparedPolygons {
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Expected a polygon FeatureCollection')
  }
  if (
    collection.features.some(
      (feature) => feature.geometry?.type !== 'Polygon' || !Number.isSafeInteger(feature.properties?.value),
    )
  ) {
    throw new Error('Expected polygons with integer class values')
  }
  return {
    binary: geojsonToBinary(collection.features, {
      fixRingWinding: true,
      triangulate: true,
      // Native grid coordinates must survive high zoom and remain shared across blocks.
      PositionDataType: Float64Array,
      numericPropKeys: [],
    }),
    values: Float64Array.from(collection.features, (feature) => feature.properties.value),
  }
}

/** Transfer ownership of typed buffers, avoiding a main-thread geometry clone. */
export function polygonTransferables(prepared: PreparedPolygons): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const visit = (value: unknown) => {
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer)
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  visit(prepared)
  return [...buffers]
}
