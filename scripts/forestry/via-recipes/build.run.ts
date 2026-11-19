/**
 * Writes what the page reads of the VIA report recipes, from the recipe JSON by document-kit's own compile
 * (`src/pages/dev-forestry/viaReport/recipeRoute.ts`):
 *
 * - `recipeJson/recipes.generated.json`: every shipped recipe as `REPORT_RECIPES` (`recipes.ts`), and the report
 *   parts defined in JSON (id, title, sources) as the registry lists them. Read with the page: no kit.
 * - `recipeJson/parts.compiled.json`: each JSON part compiled on its own, which the page renders with the engine once
 *   Save & export has loaded it (`reportEngine.ts`), so the page never compiles.
 *
 * `npm run via-recipes:build` writes both; `npm run via-recipes:check` (and `recipeJson.test.ts`) fails when either
 * differs from what the JSON compiles to. Never edit them by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as kit from 'document-kit'
import * as recipe from 'document-kit/recipe'
import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'

import {
  compiledJsonParts,
  jsonPartEntries,
  shippedReportRecipes,
} from '../../../src/pages/dev-forestry/viaReport/recipeRoute'

const DIR = join(import.meta.dirname, '../../../src/pages/dev-forestry/viaReport/recipeJson')
const FILES = {
  'recipes.generated.json': () => ({
    recipes: shippedReportRecipes({ recipe, imageInfo: kit.imageInfo }),
    parts: jsonPartEntries(),
  }),
  'parts.compiled.json': () => ({ parts: compiledJsonParts({ recipe, imageInfo: kit.imageInfo }) }),
}

it(process.env.VIA_RECIPES_CHECK ? 'checks the generated recipes' : 'writes the generated recipes', async () => {
  for (const [name, make] of Object.entries(FILES)) {
    const file = join(DIR, name)
    const data = make()
    if (process.env.VIA_RECIPES_CHECK) expect(JSON.parse(readFileSync(file, 'utf8')), name).toEqual(data)
    // Written in the repository's own style, so the format check passes on it as written.
    else writeFileSync(file, await format(JSON.stringify(data), { ...(await resolveConfig(file)), filepath: file }))
  }
})
