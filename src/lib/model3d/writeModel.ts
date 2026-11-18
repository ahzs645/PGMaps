/**
 * One call from a `Model3d` to the files a person saves: `.glb` (one file), `.obj` with its `.mtl`
 * (two files, which must sit side by side), or `.stl` (one file), with notes saying what the model
 * is and what the chosen format cannot carry.
 *
 * No DOM or network access.
 */
import { writeGlb } from './glb'
import { fileBaseName, drawableParts, originDescription, type Model3d, type ModelFormat } from './model'
import { writeObj } from './obj'
import { writeStl } from './stl'

export interface ModelFile {
  name: string
  bytes: Uint8Array
  mime: string
}

export interface ModelExport {
  format: ModelFormat
  /**
   * The files to save. One for `glb` and `stl`; for `obj` the `.obj` first and its `.mtl` second,
   * which the `.obj` names and readers look for in the same folder (save both, or zip them).
   */
  files: ModelFile[]
  /** The main file's extension, with its dot. */
  extension: string
  /** The main file's media type. */
  mime: string
  /** The model's own notes, then what this format leaves out. */
  notes: string[]
}

export const MODEL_FORMATS: Record<ModelFormat, { extension: string; mime: string; label: string }> = {
  glb: { extension: '.glb', mime: 'model/gltf-binary', label: 'glTF binary (.glb)' },
  obj: { extension: '.obj', mime: 'model/obj', label: 'Wavefront OBJ (.obj + .mtl)' },
  stl: { extension: '.stl', mime: 'model/stl', label: 'STL (.stl)' },
}

const FORMAT_NOTES: Record<ModelFormat, string> = {
  glb: 'glTF: Y up, metres; each part a named node with its attributes in extras, the origin and these notes in the root extras.',
  obj: 'OBJ: Y up, metres; each part a named object, colours in the .mtl that must stay beside the .obj; attributes and notes are comments only.',
  stl: 'STL: Z up, metres; one mesh with no colours, names or attributes; the origin is in the header only as far as 80 characters allow.',
}

/** Writes a model in one format. `fileBase` names the files (default: the model's name, made safe). */
export function writeModel(model: Model3d, format: ModelFormat, fileBase = fileBaseName(model.name)): ModelExport {
  const { extension, mime } = MODEL_FORMATS[format]
  const base = fileBaseName(fileBase)
  const { empty } = drawableParts(model)
  const notes = [
    ...model.notes,
    originDescription(model.origin),
    FORMAT_NOTES[format],
    ...(empty.length ? [`Left out with no triangles: ${empty.join(', ')}.`] : []),
  ]
  const encoder = new TextEncoder()
  const files: ModelFile[] =
    format === 'glb'
      ? [{ name: `${base}.glb`, bytes: writeGlb(model), mime }]
      : format === 'stl'
        ? [{ name: `${base}.stl`, bytes: writeStl(model), mime }]
        : (() => {
            const { obj, mtl } = writeObj(model, `${base}.mtl`)
            return [
              { name: `${base}.obj`, bytes: encoder.encode(obj), mime },
              { name: `${base}.mtl`, bytes: encoder.encode(mtl), mime: 'model/mtl' },
            ]
          })()
  return { format, files, extension, mime, notes }
}
