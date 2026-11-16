/**
 * Writes the road view's tree sheets as PNG files, to look at.
 *
 *   node --import tsx scripts/forestry/tree-atlas/export.ts [folder]
 *
 * The baked atlas (`src/pages/dev-forestry/impostorBake.ts`) is made in the browser and never
 * touches a disk, so a drawing that came out wrong was only ever seen on a hillside. This writes
 * the same bytes the layer uploads:
 *
 *   baked-colour.png    every drawing's baked views: a row a drawing, two trees of eight views each
 *   baked-surface.png   the same cells: normal across and up in red and green, foliage in blue
 *   baked-clumps.png    the far bands' clump cards, built of those trees
 *   sprays.png          the bough and leaf pictures the detailed meshes' foliage cards carry
 *
 * The folder defaults to `tmp/tree-atlas`, which git ignores. (After octahedral-impostor's atlas
 * exporter; `NOTICE-OCTAHEDRAL-IMPOSTOR.md`.)
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { encodePng } from '../../../src/lib/mapSheet/png'
import type { AtlasImage } from '../../../src/pages/dev-forestry/impostor'
import { bakeClumpAtlas, bakeImpostorAtlas } from '../../../src/pages/dev-forestry/impostorBake'
import { buildSpraySheet } from '../../../src/pages/dev-forestry/treeSprays'

async function main() {
  const folder = resolve(process.argv[2] ?? 'tmp/tree-atlas')
  await mkdir(folder, { recursive: true })
  const started = performance.now()
  const trees = bakeImpostorAtlas()
  const baked = Math.round(performance.now() - started)
  const clumps = bakeClumpAtlas()
  // The surface sheet's alpha is depth; opaque here, or an image viewer hides most of it.
  const opaque = (image: AtlasImage): AtlasImage => {
    const data = image.data.slice()
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    return { width: image.width, height: image.height, data }
  }
  const sheets: Array<[string, AtlasImage]> = [
    ['baked-colour.png', trees.image!],
    ['baked-surface.png', opaque(trees.surface!)],
    ['baked-clumps.png', clumps.image!],
    ['sprays.png', buildSpraySheet()],
  ]
  for (const [name, image] of sheets) {
    await writeFile(join(folder, name), await encodePng(image.data, image.width, image.height))
    console.log(`${name}  ${image.width} × ${image.height}`)
  }
  console.log(`baked in ${baked} ms, written to ${folder}`)
}

void main()
