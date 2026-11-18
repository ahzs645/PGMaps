/**
 * The report engine as Save & export loads it (`viaReportEngine.ts`) and the tests load it
 * (`reportEngine.setup.ts`): each JSON part rendered by document-kit's renderer from its compiled form
 * (`recipeJson/parts.compiled.json`) over the facts of the context it is built with (`reportFacts.ts`), and read back
 * as report blocks (`kitBlocks.ts`). Reached only by dynamic import on the page. No DOM or network access: the
 * renderer is handed in.
 */
import type { CompiledRecipe, RenderOptions, RenderResult } from 'document-kit/recipe'

import { readPart } from './kitBlocks'
import type { ReportEngine } from './reportEngine'
import { reportFacts } from './reportFacts'

export function makeReportEngine(
  renderRecipe: (compiled: CompiledRecipe, data: unknown, options?: RenderOptions) => RenderResult,
  compiled: Readonly<Record<string, CompiledRecipe>>,
): ReportEngine {
  return {
    buildPart(id, ctx) {
      const part = compiled[id]
      if (!part) throw new Error(`VIA report part ${id}: no compiled form: run npm run via-recipes:build`)
      const rendered = renderRecipe(part, { facts: reportFacts(ctx) })
      return readPart(rendered.document.sections[0]?.body ?? [], id)
    },
  }
}
