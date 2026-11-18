/**
 * Binary STL from a `Model3d`: every triangle of every part in one Z-up mesh in local metres, the
 * frame CAD and printing tools expect. STL has no colours, names, attributes or shared vertices; its
 * 80-byte header carries the model's name, the units and as much of the origin as fits, and each
 * facet's normal is worked out from its own corners (STL is always flat-shaded).
 *
 * Adapted from GeoLibre's `encodeStl` (`apps/geolibre-desktop/src/lib/extrusion-model.ts`, MIT):
 * the record layout. Written here: the facet normal from the corners and the header text.
 *
 * No DOM or network access.
 */
import { checkPart, drawableParts, faceNormal, triangleCount, type Model3d } from './model'

const HEADER_BYTES = 80
const FACET_BYTES = 50

/** The 80-byte header: ASCII only, and never starting "solid", which makes readers parse it as ASCII STL. */
export function stlHeader(model: Model3d): Uint8Array {
  const o = model.origin
  const at =
    o.kind === 'grid'
      ? `EPSG:${o.epsg} E${o.easting.toFixed(1)} N${o.northing.toFixed(1)} Z${o.elevation.toFixed(1)}`
      : `lon ${o.longitude.toFixed(6)} lat ${o.latitude.toFixed(6)} z ${o.elevation.toFixed(1)}`
  const name = model.name.replace(/[^ -~]+/g, '_')
  const text = `PGMaps ${name}; metres, Z up; origin ${at}`.slice(0, HEADER_BYTES)
  const out = new Uint8Array(HEADER_BYTES).fill(0x20)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

/** The `.stl` bytes of a model. Throws when no part has a triangle. */
export function writeStl(model: Model3d): Uint8Array {
  const { parts } = drawableParts(model)
  if (!parts.length) throw Error(`${model.name} has no triangles to write.`)
  for (const part of parts) checkPart(part)
  const count = triangleCount({ parts })
  const out = new Uint8Array(HEADER_BYTES + 4 + count * FACET_BYTES)
  const view = new DataView(out.buffer)
  out.set(stlHeader(model))
  view.setUint32(HEADER_BYTES, count, true)
  let offset = HEADER_BYTES + 4
  for (const { positions, indices } of parts) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const corners = [indices[t], indices[t + 1], indices[t + 2]]
      const normal = faceNormal(positions, corners[0], corners[1], corners[2])
      for (let k = 0; k < 3; k++) view.setFloat32(offset + k * 4, normal[k], true)
      offset += 12
      for (const v of corners) {
        for (let k = 0; k < 3; k++) view.setFloat32(offset + k * 4, positions[v * 3 + k], true)
        offset += 12
      }
      // The attribute byte count, which no reader agrees on, stays zero.
      offset += 2
    }
  }
  return out
}
