/**
 * Draw a region's generated geography with a saved hatch recipe, as an editable SVG and a vector
 * PDF from the same sheet operations. The hatch strokes stay curves in both files.
 *
 *   node --import tsx scripts/illustrated-map/compose-region.ts <geography.json> <output-dir>
 *     [--recipe recipe.json | --preset northern-bc-reference] [--coverage coverage|region]
 *     [--name file-stem]
 *
 * The geography is the output of build-geographic-map.py, for BC or any `--region` config.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { GState, jsPDF } from 'jspdf'
import { ORGANIC_HATCH_PRESETS, parseOrganicHatchRecipe, type OrganicHatchPresetId } from '@pgmaps/geo-toolkit/patterns'
import { regionSheetOps, type RegionGeography } from '../../src/lib/illustratedMap/regionSheet'
import { createSheetPdf, drawSheetPdf } from '../../src/lib/mapSheet/renderPdf'
import { standaloneSheetSvg } from '../../src/lib/mapSheet/renderSvg'

const [geographyPath, outputDir, ...rest] = process.argv.slice(2)
if (!geographyPath || !outputDir) {
  console.error(
    'Usage: compose-region.ts <geography.json> <output-dir> [--recipe file | --preset id] [--coverage coverage|region] [--name stem]',
  )
  process.exit(1)
}
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const geography = JSON.parse(await readFile(resolve(geographyPath), 'utf8')) as RegionGeography
const recipeFile = flag('recipe')
const preset = (flag('preset') ?? 'northern-bc-reference') as OrganicHatchPresetId
if (!recipeFile && !ORGANIC_HATCH_PRESETS[preset]) throw Error(`Unknown preset ${preset}.`)
const recipe = recipeFile
  ? parseOrganicHatchRecipe(JSON.parse(await readFile(resolve(recipeFile), 'utf8')), recipeFile)
  : ORGANIC_HATCH_PRESETS[preset].recipe
const coverage = flag('coverage') === 'region' ? 'region' : 'coverage'
const stem =
  flag('name') ?? `${(geography.region?.name ?? 'region').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${coverage}`

const { ops, width, height } = regionSheetOps(geography, { recipe, coverage })
const title = `${geography.region?.name ?? 'Region'} — ${geography.projection.name}`
await mkdir(resolve(outputDir), { recursive: true })
await writeFile(join(outputDir, `${stem}.svg`), standaloneSheetSvg(ops, width, height, { title }))
const pdf = createSheetPdf({ jsPDF, GState }, width, height)
drawSheetPdf(pdf, { jsPDF, GState }, ops)
await writeFile(join(outputDir, `${stem}.pdf`), Buffer.from(pdf.output('arraybuffer')))
await writeFile(join(outputDir, `${stem}.recipe.json`), JSON.stringify(recipe, null, 2) + '\n')
const strokes = ops.reduce((sum, op) => sum + (op.op === 'curves' ? op.parts.length : 0), 0)
console.log(JSON.stringify({ stem, width, height, coverage, strokes, recipe: preset }))
