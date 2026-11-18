/**
 * The engine the report's JSON parts are built by, and their place in the registry. A part defined in JSON
 * (`recipeJson/components/`) is listed here by its id, title and sources (`recipes.generated.json`), and built by the
 * engine Save & export loads when it opens (`viaReportWord`'s neighbour `viaReportEngine.ts`, which hands it here from
 * `engineParts.ts`: document-kit's renderer, the compiled parts, the facts object and the block reader). The page
 * holds only this module; from the load on, a report assembles synchronously as before. A JSON part asked for before
 * that refuses loudly (`ReportEngineNotLoaded`): a report is never printed without one of its parts. No DOM or
 * network access.
 */
import type { PartOutput, ReportContext, ReportPart } from './parts'
import generated from './recipeJson/recipes.generated.json'

export interface ReportEngine {
  /** One JSON part's blocks and what it leaves to complete, for the context it is built with. */
  buildPart(id: string, ctx: ReportContext): PartOutput
}

let engine: ReportEngine | null = null

/** Gives the report its engine (or takes it away: tests). */
export function setReportEngine(next: ReportEngine | null) {
  engine = next
}

export const reportEngineLoaded = () => engine !== null

/** A JSON part was asked for before the engine was loaded. */
export class ReportEngineNotLoaded extends Error {
  constructor(part: string) {
    super(
      `The report part “${part}” is defined in JSON and needs the report engine, which is not loaded yet: load it first (Save & export does when it opens).`,
    )
    this.name = 'ReportEngineNotLoaded'
  }
}

/** The engine, or a refusal naming the part that needed it. */
export function reportEngine(part: string): ReportEngine {
  if (!engine) throw new ReportEngineNotLoaded(part)
  return engine
}

/** A JSON report part by id, as the generated recipes list it, built by the loaded engine. */
export function jsonPart(id: string): ReportPart & { json: true } {
  const parts: ReadonlyArray<{ id: string; title: string; sources: readonly string[] }> =
    (generated as { parts?: Array<{ id: string; title: string; sources: string[] }> }).parts ?? []
  // Missing only before the generated file is first written: its build then refuses (and the check test fails).
  const entry = parts.find((part) => part.id === id) ?? { id, title: id, sources: [] }
  return { ...entry, json: true, build: (ctx) => reportEngine(id).buildPart(id, ctx) }
}
