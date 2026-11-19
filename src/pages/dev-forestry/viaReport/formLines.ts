/**
 * The 2001 forms' lines about the proposed blocks: their silvicultural systems and their planned harvest years, as
 * the form header (`recipeJson/components/form-header-2001.json`, through `reportFacts.ts`) and the district parts
 * print them. No DOM or network access.
 */
import type { ReportBlockFacts } from './parts'

/** The systems the scene records, with their blocks: "Clearcut" or "Clearcut (X1); Partial cut (X2)". */
export function systemsLine(blocks: readonly ReportBlockFacts[]): string | null {
  const systems = [...new Set(blocks.map((block) => block.system))]
  if (!systems.length) return null
  if (systems.length === 1) return systems[0]
  return systems
    .map(
      (system) =>
        `${system} (${blocks
          .filter((block) => block.system === system)
          .map((block) => block.name)
          .join(', ')})`,
    )
    .join('; ')
}

/** The proposed year of harvest from each block's planned harvest year; null until every block has one. */
export function harvestYearLine(blocks: readonly ReportBlockFacts[]): string | null {
  if (!blocks.length || blocks.some((block) => block.plannedHarvestYear == null)) return null
  const years = [...new Set(blocks.map((block) => block.plannedHarvestYear))]
  return years.length === 1
    ? String(years[0])
    : blocks.map((block) => `${block.name} ${block.plannedHarvestYear}`).join(', ')
}
