/**
 * The route card report for one block, put together the one way the sidebar, the workbook and the Word file all
 * read it: the sheet from the row states and the reviewer's entries, the facts, and the render. No DOM or network
 * access: the kit is passed in.
 */
import { accessPlanar } from './access'
import type { RouteCardFigure } from './excel'
import { considerationFacts, type ConsiderationFacts } from './facts'
import { considerationMaps, type RouteCardMapFigure } from './figures'
import type { Planar } from './geometry'
import { buildRouteCardReport, type RouteCardKit, type RouteCardReport } from './report'
import { routeCardCounts, routeCardSheet, type RouteCardRowState, type RouteCardSheet } from './results'
import type { RouteCardBlockReview } from './review'
import type { RouteCardPreset } from './rows'

/** What every file carries about the route card, in every place it carries it. */
export const ROUTE_CARD_CAVEAT =
  'A screen read live from public BC layers when this was written, not a legal determination. Not read means a layer could not be read; Not public means no public layer holds it, and the reviewer enters it. Every Other Considerations paragraph is a draft until the reviewer signs it.'

export type AssembleInput = {
  preset: RouteCardPreset
  block: { id: string; name: string; shape: Planar }
  states: Readonly<Record<string, RouteCardRowState>>
  review: RouteCardBlockReview | undefined
  /** The block's Visuals paragraph from step 5, when the Visuals panel is on this block. */
  visuals: { text: string; drafted: boolean } | null
  /** The scene's other proposed blocks, which can join this block's patch. */
  planned: ReadonlyArray<{ name: string; shape: Planar }>
  readAt: string | null
  /** Pictures for the files: the maps rasterised, and the saved views under Visuals. */
  figures?: readonly RouteCardFigure[]
}

export type AssembledRouteCard = {
  /** The maps the printed considerations carry, as SVG, for the sidebar and to rasterise for the files. */
  maps: RouteCardMapFigure[]
  sheet: RouteCardSheet
  facts: ConsiderationFacts
  report: RouteCardReport
  notes: string[]
  counts: ReturnType<typeof routeCardCounts>
}

export function assembleRouteCard(kit: RouteCardKit, input: AssembleInput): AssembledRouteCard {
  const subject = { id: input.block.id, name: input.block.name, kind: 'block' as const, shape: input.block.shape }
  const entries = input.review?.entries ?? {}
  const sheet = routeCardSheet(input.preset, subject, input.states, entries)
  const facts = considerationFacts({
    subject,
    states: input.states,
    entries,
    access: accessPlanar(input.review?.access?.lines),
    planned: input.planned,
    visuals: input.visuals,
    own: input.review?.own,
    inputs: input.review?.inputs,
  })
  const counts = routeCardCounts(sheet)
  const readOn = input.readAt ? input.readAt.slice(0, 10) : null
  const notes = [
    ROUTE_CARD_CAVEAT,
    readOn ? `Layers read ${readOn}.` : 'Some layers were still reading when this was written; they print as Not read.',
    ...(counts.entered
      ? [
          `${counts.entered} row${counts.entered === 1 ? ' was' : 's were'} entered by the reviewer, each marked with its source.`,
        ]
      : []),
    ...(input.review?.access
      ? [`Access road for crossings: ${input.review.access.name}.`]
      : ['No access road given: road crossings are not checked.']),
    `${input.preset.name}: rows, wording and the rules that call each paragraph are PGMaps' data files, cited in docs/forestry-route-card.md.`,
  ]
  const report = buildRouteCardReport(kit, {
    preset: input.preset,
    sheet,
    facts,
    readAt: readOn ?? 'not yet complete',
    notes,
    figures: input.figures,
  })
  const maps = considerationMaps({
    blockName: input.block.name,
    block: input.block.shape,
    access: accessPlanar(input.review?.access?.lines),
    states: input.states,
    considerations: report.considerations.map((item) => item.id),
  })
  return { sheet, facts, report, notes, counts, maps }
}
