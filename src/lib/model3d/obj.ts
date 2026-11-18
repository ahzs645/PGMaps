/**
 * Wavefront OBJ from a `Model3d`, with its colours in a material library (`.mtl`). One object
 * (`o`) per part, Y up as OBJ readers assume, metres, positions to the millimetre. The `.obj` names
 * its `.mtl` (`mtllib`), and readers look for it beside the `.obj`: the two files travel together
 * (`writeModel` returns both). Without the `.mtl` the shapes and names still open, uncoloured.
 *
 * A part's attributes and the model's notes go in as comments, which OBJ readers skip: the file has
 * nowhere else to keep them. A part without normals is written `s off`, so it opens flat-shaded.
 *
 * Adapted from GeoLibre's `encodeObj` (`apps/geolibre-desktop/src/lib/extrusion-model.ts`, MIT):
 * Y-up rotation, safe object names and number formatting. Written here: the material library in
 * place of vertex colours (SketchUp and most CAD readers ignore vertex colours), optional normals,
 * and the comments.
 *
 * No DOM or network access.
 */
import { checkPart, drawableParts, originDescription, yUp, type Model3d } from './model'

/** A name OBJ keeps whole: whitespace would end the statement and `#` start a comment. */
export function objName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\s#\u0000-\u001f\u007f]+/g, '_') || 'part'
}

/** A fixed-point number, writing a value that rounds to zero as "0" (never "-0.000"). */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits)
  return Number(text) === 0 ? '0' : text
}

/** One comment line: a line break inside the text would start a statement. */
const comment = (text: string) => `# ${text.replace(/[\r\n]+/g, ' ')}`

/**
 * The `.obj` and `.mtl` texts of a model. `mtlFileName` is what the `.obj` names in `mtllib`, so it
 * must be the name the `.mtl` is saved under. Throws when no part has a triangle.
 */
export function writeObj(model: Model3d, mtlFileName: string): { obj: string; mtl: string } {
  const { parts, empty } = drawableParts(model)
  if (!parts.length) throw Error(`${model.name} has no triangles to write.`)
  for (const part of parts) checkPart(part)

  const lines = [
    comment(model.name),
    comment('Exported by PGMaps. Units: metres, Y up (x east, y up, z south).'),
    comment(originDescription(model.origin)),
    ...model.notes.map(comment),
    ...(empty.length ? [comment(`Left out with no triangles: ${empty.join(', ')}.`)] : []),
    `mtllib ${mtlFileName}`,
  ]
  const materials = new Map<string, string>()
  let base = 1
  for (const part of parts) {
    const count = part.positions.length / 3
    const key = part.color.map((c) => fixed(c, 4)).join(' ')
    let material = materials.get(key)
    if (!material) {
      material = `colour_${materials.size + 1}`
      materials.set(key, material)
    }
    lines.push(`o ${objName(part.name)}`)
    for (const [k, v] of Object.entries(part.attributes ?? {})) lines.push(comment(`${k}: ${String(v)}`))
    lines.push(`usemtl ${material}`)
    for (let i = 0; i < count; i++) {
      const [x, y, z] = yUp(part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2])
      lines.push(`v ${fixed(x, 3)} ${fixed(y, 3)} ${fixed(z, 3)}`)
    }
    const normals = part.normals
    if (normals) {
      for (let i = 0; i < count; i++) {
        const [x, y, z] = yUp(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])
        lines.push(`vn ${fixed(x, 4)} ${fixed(y, 4)} ${fixed(z, 4)}`)
      }
      lines.push('s 1')
    } else lines.push('s off')
    // Normals are numbered with their vertices, so one index serves both.
    for (let t = 0; t + 2 < part.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => part.indices[t + k] + base)
      lines.push(normals ? `f ${a}//${a} ${b}//${b} ${c}//${c}` : `f ${a} ${b} ${c}`)
    }
    base += count
  }
  const mtl = [comment(`Materials for ${model.name}. Colours are sRGB.`)]
  for (const [rgb, name] of materials)
    mtl.push(`newmtl ${name}`, 'Ka 0 0 0', `Kd ${rgb}`, 'Ks 0 0 0', 'd 1', 'illum 1', '')
  return { obj: `${lines.join('\n')}\n`, mtl: `${mtl.join('\n')}\n` }
}
