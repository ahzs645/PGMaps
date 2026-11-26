/**
 * Draw a region's generated geography with a saved hatch recipe, as an editable SVG and a vector
 * PDF from the same sheet operations. The hatch strokes stay curves in both files.
 *
 *   node --import tsx scripts/illustrated-map/compose-region.ts <geography.json> <output-dir>
 *     [--recipe recipe.json | --preset northern-bc-reference] [--coverage coverage|region]
 *     [--name file-stem] [--channel-gap 1.2] [--lettering great-forest]
 *
 * The geography is the output of build-geographic-map.py, for BC or any `--region` config.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GState, jsPDF } from 'jspdf'
import { ORGANIC_HATCH_PRESETS, parseOrganicHatchRecipe, type OrganicHatchPresetId } from '@pgmaps/geo-toolkit/patterns'
import { regionSheetOps, type RegionGeography } from '../../src/lib/illustratedMap/regionSheet'
import {
  GREAT_FOREST_DIRECTORY,
  GREAT_FOREST_FILES,
  registerGreatForestPdf,
  woffDataUrl,
} from '../../src/lib/mapSheet/greatForest'
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

const channelGap = Number(flag('channel-gap') ?? 0)
const lettering = flag('lettering') === 'great-forest' ? 'great-forest' : 'helvetica'
const { ops, width, height } = regionSheetOps(geography, { recipe, coverage, channelGap, lettering })
// Great Forest from the committed fonts: the WOFF embedded in the SVG, the TTF in the PDF.
const fontsDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../public', GREAT_FOREST_DIRECTORY)
const fontBytes = async (file: string) => new Uint8Array(await readFile(join(fontsDirectory, file)))
const svgFonts =
  lettering === 'great-forest'
    ? { 'great-forest': woffDataUrl(await fontBytes(GREAT_FOREST_FILES['great-forest'].woff)) }
    : undefined
const title = `${geography.region?.name ?? 'Region'} — ${geography.projection.name}`
await mkdir(resolve(outputDir), { recursive: true })
await writeFile(join(outputDir, `${stem}.svg`), standaloneSheetSvg(ops, width, height, { title, fonts: svgFonts }))
const pdf = createSheetPdf({ jsPDF, GState }, width, height)
const families =
  lettering === 'great-forest'
    ? registerGreatForestPdf(pdf, { 'great-forest': await fontBytes(GREAT_FOREST_FILES['great-forest'].ttf) })
    : undefined
drawSheetPdf(
  pdf,
  { jsPDF, GState },
  ops,
  families ? { body: 'helvetica', heading: 'helvetica', custom: false, families } : undefined,
)
await writeFile(join(outputDir, `${stem}.pdf`), Buffer.from(pdf.output('arraybuffer')))
await writeFile(join(outputDir, `${stem}.recipe.json`), JSON.stringify(recipe, null, 2) + '\n')
const strokes = ops.reduce((sum, op) => sum + (op.op === 'curves' ? op.parts.length : 0), 0)
console.log(JSON.stringify({ stem, width, height, coverage, strokes, recipe: preset }))
