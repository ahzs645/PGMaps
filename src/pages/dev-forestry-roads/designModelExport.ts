/**
 * Save & export's **3D surface model**: the road's design surfaces (`designSurfaceModel.ts`) as one
 * file in the format chosen, its notice and its preview. OBJ is two files that must sit side by
 * side, so it is zipped with its `.mtl`. The model is a picture of the calculated surfaces for
 * Blender, SketchUp or a CAD viewer; the LandXML surfaces are the ones to build from, and the notice
 * says so. No DOM or network access.
 */
import { zipSync } from 'fflate'
import { triangleCount, type Model3d, type ModelFormat, type Rgb } from '@/lib/model3d/model'
import { writeModel, type ModelExport } from '@/lib/model3d/writeModel'
import { designSurfaceModel, type DesignSurfaceModelInput } from './designSurfaceModel'
import { designModelFileName, designModelFormat } from './exportFiles'
import { screenColour } from '@/lib/screenPage'

/**
 * Most triangles the preview draws in plan. Past it the preview lists the parts without a drawing:
 * every triangle is an SVG path segment, and a long road's sections run to hundreds of thousands.
 */
export const MODEL_PREVIEW_MAX_TRIANGLES = 60_000

export interface DesignModelFile {
  bytes: Uint8Array
  filename: string
  mime: string
  /** The model's notes, then what the format leaves out. */
  notes: string[]
  model: Model3d
  written: ModelExport
}

/**
 * The model's file. Throws as the LandXML design surfaces do: for a road with no two complete
 * sections in a row, and for one whose results leave out an invalid input.
 */
export function designModelFile(
  input: DesignSurfaceModelInput,
  format: ModelFormat,
  basename: string,
): DesignModelFile {
  const model = designSurfaceModel(input)
  const written = writeModel(model, format, `${basename}-design-surfaces`)
  const target = designModelFormat(format)
  const bytes =
    format === 'obj'
      ? // The .obj names its .mtl by file name, so both go in at the archive's top level.
        zipSync(Object.fromEntries(written.files.map((file) => [file.name, file.bytes])), { level: 6 })
      : written.files[0].bytes
  return {
    bytes,
    filename: designModelFileName(basename, format),
    mime: target.mime,
    notes: written.notes,
    model,
    written,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`

/** The notice after a download: what the file is, where it sits in the world, and what it leaves out. */
export function designModelNotice(file: DesignModelFile): string {
  const format = designModelFormat(file.written.format)
  return [
    `3D surface model downloaded: ${format.label}, ${plural(file.model.parts.length, 'part')}, ${plural(
      triangleCount(file.model),
      'triangle',
    )}.`,
    'A picture of the calculated surfaces for modelling software, not a machine-control file: build from the LandXML surfaces.',
    ...file.notes,
  ].join(' ')
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

const bytesText = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

/** The parts in plan, each triangle filled in its part's colour, ground first and the finished surface on top. */
function planSvg(model: Model3d, width = 640, height = 360, padding = 8): string | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const part of model.parts)
    for (let i = 0; i + 2 < part.positions.length; i += 3) {
      minX = Math.min(minX, part.positions[i])
      maxX = Math.max(maxX, part.positions[i])
      minY = Math.min(minY, part.positions[i + 1])
      maxY = Math.max(maxY, part.positions[i + 1])
    }
  if (!Number.isFinite(minX)) return null
  const scale = Math.min(
    (width - 2 * padding) / Math.max(maxX - minX, 1e-6),
    (height - 2 * padding) / Math.max(maxY - minY, 1e-6),
  )
  const offsetX = (width - (maxX - minX) * scale) / 2,
    offsetY = (height - (maxY - minY) * scale) / 2
  const at = (positions: ArrayLike<number>, index: number) =>
    `${(offsetX + (positions[index * 3] - minX) * scale).toFixed(1)} ${(height - offsetY - (positions[index * 3 + 1] - minY) * scale).toFixed(1)}`
  const order = (name: string) => (/ground/i.test(name) ? 0 : /subgrade/i.test(name) ? 1 : 2)
  const paths = [...model.parts]
    .sort((a, b) => order(a.name) - order(b.name))
    .map((part) => {
      const d: string[] = []
      for (let t = 0; t + 2 < part.indices.length; t += 3)
        d.push(
          `M${at(part.positions, part.indices[t])}L${at(part.positions, part.indices[t + 1])}L${at(part.positions, part.indices[t + 2])}Z`,
        )
      return `<path d="${d.join('')}" fill="${hex(part.color)}" fill-opacity="0.9" stroke="none"><title>${escape(part.name)}</title></path>`
    })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="The model's parts in plan, north up">${paths.join('')}</svg>`
}

/** The preview: the parts drawn in plan, the files, and the notes the notice gives. */
export function designModelPreviewHtml(file: DesignModelFile): string {
  const triangles = triangleCount(file.model)
  const drawing = triangles <= MODEL_PREVIEW_MAX_TRIANGLES ? planSvg(file.model) : null
  const rows = file.model.parts
    .map(
      (part) =>
        `<tr><td><span class="swatch" style="background:${hex(part.color)}"></span>${escape(part.name)}</td><td class="n">${Math.floor(part.indices.length / 3).toLocaleString('en-CA')}</td></tr>`,
    )
    .join('')
  const files =
    file.written.format === 'obj'
      ? `${escape(file.filename)} (${bytesText(file.bytes.length)}), holding ${file.written.files
          .map((f) => `${escape(f.name)} (${bytesText(f.bytes.length)})`)
          .join(' and ')}`
      : `${escape(file.filename)} (${bytesText(file.bytes.length)})`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px/1.45 system-ui,sans-serif;color:${screenColour('fg')};background:${screenColour('bg')};margin:16px}
h2{font-size:14px;margin:16px 0 6px}
svg{width:100%;height:auto;border:1px solid ${screenColour('line', '#d6d3d1')};border-radius:6px;background:${screenColour('panel')}}
table{border-collapse:collapse;font-size:12px}td,th{padding:3px 10px 3px 0;text-align:left}
.n{text-align:right;font-variant-numeric:tabular-nums}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.note{color:${screenColour('muted', '#57534e')}}ul{padding-left:18px;margin:4px 0}
</style></head><body>
<p class="note">A picture of the calculated surfaces for Blender, SketchUp or a CAD viewer, not a machine-control file: build from the LandXML surfaces.</p>
${drawing ?? `<p class="note">${triangles.toLocaleString('en-CA')} triangles are more than the preview draws (${MODEL_PREVIEW_MAX_TRIANGLES.toLocaleString('en-CA')}); the file holds them all.</p>`}
<h2>Parts</h2>
<table><thead><tr><th>Part</th><th class="n">Triangles</th></tr></thead><tbody>${rows}</tbody></table>
<h2>File</h2><p>${files}</p>
<h2>Notes</h2><ul>${file.notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>
</body></html>`
}
