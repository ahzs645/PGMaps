/**
 * Inspect company map PDFs before writing a profile, and try a draft profile against them.
 * Read-only; writes reports only to the output folder you name. Reports repeat the sheets' own
 * text and layer names, so keep them with the source files and never commit them.
 *
 *   npx tsx scripts/forestry/inspect-map-pdf.ts /tmp/inspect /local/Maps
 *   npx tsx scripts/forestry/inspect-map-pdf.ts /tmp/inspect /local/Maps/sheet.pdf --profile /local/draft-profile.ts
 *
 * A draft profile is a TypeScript module exporting `profile: PdfTemplateProfile`
 * (`src/lib/geoPdf/profiles.ts`). With one, each PDF is also read by the importer with the draft
 * tried first, and `<sheet>.read.md` lists what it extracts. Guide: docs/forestry-road-design/map-pdf-profiles.md
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { formatInspection, inspectPdf } from '../../src/lib/geoPdf/inspect'
import { readGeoPdf } from '../../src/lib/geoPdf/read'
import { PDF_PROFILES, type PdfTemplateProfile } from '../../src/lib/geoPdf/profiles'
import { classAreaBreakdown, decodeCells, knownClass, estimatedClass } from '../../src/lib/geoPdf/classGrid'

const args = process.argv.slice(2)
const profileAt = args.indexOf('--profile')
const draftPath = profileAt >= 0 ? args[profileAt + 1] : undefined
const [output, ...inputs] = args.filter((_, i) => profileAt < 0 || (i !== profileAt && i !== profileAt + 1))
if (!output || !inputs.length)
  throw Error('Usage: inspect-map-pdf.ts <output folder> <pdf or folder>... [--profile draft-profile.ts]')
const draft: PdfTemplateProfile | undefined = draftPath
  ? (await import(pathToFileURL(path.resolve(draftPath)).href)).profile
  : undefined
if (draftPath && !draft) throw Error(`${draftPath} must export \`profile\`.`)
const profiles = draft ? [draft, ...PDF_PROFILES] : PDF_PROFILES

const pdfs: string[] = []
for (const input of inputs)
  if ((await stat(input)).isDirectory())
    pdfs.push(
      ...(await readdir(input))
        .filter((n) => /\.pdf$/i.test(n))
        .sort()
        .map((n) => path.join(input, n)),
    )
  else pdfs.push(input)
await mkdir(output, { recursive: true })

for (const pdf of pdfs) {
  const bytes = new Uint8Array(await readFile(pdf))
  const name = path.basename(pdf),
    stem = name.replace(/\.pdf$/i, '')
  const report = await inspectPdf(bytes, name, runtime as never, { profiles })
  await writeFile(path.join(output, `${stem}.inspect.json`), JSON.stringify(report, null, 2))
  await writeFile(path.join(output, `${stem}.inspect.md`), formatInspection(report))
  console.log(
    `${name}: ${report.profile ?? 'no supported profile'}; ${report.layers.length} layers, ${report.images.length} images`,
  )
  if (!draft) continue
  // What the importer would extract with the draft tried first.
  const lines = [`# ${name} read with ${draft.label}`, '']
  try {
    const read = await readGeoPdf(bytes, name, runtime as never, { maxFeatures: 500, maxVertices: 50_000, profiles })
    lines.push(`Recognized by: ${read.layers[0]?.source.profile ?? '(nothing extracted)'}`, '')
    for (const layer of read.layers) {
      const parts = [
        `- **${layer.name}** (${layer.source.layer}): ${layer.features.length} features, role ${layer.suggestedRole}`,
      ]
      if (layer.classGrid) {
        const grid = layer.classGrid,
          cells = decodeCells(grid)
        let exact = 0,
          estimated = 0
        for (const code of cells) {
          if (knownClass(code, grid)) exact++
          else if (estimatedClass(code, grid)) estimated++
        }
        const total = cells.length
        const split = classAreaBreakdown(
          {
            areaM2: total,
            classAreasM2: grid.legend.map((_, i) => grid.counts[i + 1]),
            estimatedClassAreasM2: grid.legend.map((_, i) => grid.counts[i + 65]),
            unknownAreasM2: Object.fromEntries(
              grid.counts.flatMap((n, code) => (n && !knownClass(code, grid) ? [[code, n]] : [])),
            ),
            pixelAreaM2: 1,
            method: 'fractional-native-pixels',
          },
          grid,
        )
        parts.push(
          `  - Class grid ${grid.width} × ${grid.height}: legend ${grid.legend.map((c) => `${c.label} ${'#' + c.color.map((v) => v.toString(16).padStart(2, '0')).join('')}`).join(', ')}`,
          `  - Of all cells: exact class ${((exact / total) * 100).toFixed(1)}%, JPEG estimate ${((estimated / total) * 100).toFixed(1)}%, not drawn ${((split.undrawnM2 / total) * 100).toFixed(1)}%, other ${((split.otherUnknownM2 / total) * 100).toFixed(1)}%`,
          ...grid.notes.map((n) => `  - ${n}`),
        )
      }
      if (layer.contourSurface) {
        const s = layer.contourSurface
        const finite = Array.from(s.values).filter(Number.isFinite).length
        parts.push(
          `  - Contour surface EPSG:${s.epsg}, ${s.cellM} m cells, ${((finite / s.values.length) * 100).toFixed(1)}% covered; ${JSON.stringify(s.assignment)}`,
        )
      }
      lines.push(...parts)
    }
    lines.push('', '## Notices', '', ...read.notices.map((n) => `- ${n}`))
  } catch (error) {
    lines.push(`Not read: ${error instanceof Error ? error.message : String(error)}`)
  }
  await writeFile(path.join(output, `${stem}.read.md`), lines.join('\n'))
}
console.log(`Reports in ${output}`)
