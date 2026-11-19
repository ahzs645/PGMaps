/**
 * The route card report: the Route Card Tool Assessment and the Other Considerations as one
 * document-kit recipe, built from a preset. Each consideration is a JSON component
 * (`catalogue/considerations/*.json`) with its wording, and the catalogue (`considerations.json`)
 * holds the rule that calls for it (`when`, a recipe condition over the facts: Visuals only when an
 * EVQO polygon overlaps the block, as the planners' sheets show). One render gives:
 *
 * - the Word document (`document`, written by document-kit's `writeDocx`);
 * - each consideration's paragraphs as text, for the Excel sheet and the sidebar.
 *
 * So the workbook, the Word file and the sidebar always say the same thing. The kit is passed in
 * (`RouteCardKit`) and loaded only when asked for, never with the page. No DOM or network access.
 */
import type { Document, RichText } from 'document-kit'
import type { CompiledRecipe, Component, Library, Recipe, RenderOptions, RenderResult } from 'document-kit/recipe'

import considerationsJson from './catalogue/considerations.json'
import arch from './catalogue/considerations/arch.json'
import caribouUwr from './catalogue/considerations/caribou-uwr.json'
import fisher from './catalogue/considerations/fisher.json'
import migratoryBirds from './catalogue/considerations/migratory-birds.json'
import oldForest from './catalogue/considerations/old-forest.json'
import patchSize from './catalogue/considerations/patch-size.json'
import tapOgma from './catalogue/considerations/tap-ogma.json'
import visuals from './catalogue/considerations/visuals.json'
import watershed from './catalogue/considerations/watershed.json'
import reportComponents from './catalogue/reportComponents.json'
import type { ConsiderationFacts } from './facts'
import type { RouteCardFigure } from './excel'
import type { RouteCardSheet } from './results'
import { CONSIDERATION_IDS, type ConsiderationId, type RouteCardPreset } from './rows'

/** What the report needs from document-kit, passed in so the kit loads only with Save & export or the sidebar. */
export type RouteCardKit = {
  compileRecipe: (recipe: string | Recipe, library: Library) => CompiledRecipe
  renderRecipe: (compiled: CompiledRecipe, data: unknown, options?: RenderOptions) => RenderResult
  sharedLibrary: (own?: Partial<Pick<Library, 'components' | 'recipes'>>) => Library
  plainText: (text: RichText | null | undefined) => string
}

export type ConsiderationRule = { id: ConsiderationId; title: string; when: string }

/** The considerations catalogue: each consideration's title on the sheet and the rule that calls for it. */
export const CONSIDERATION_RULES: readonly ConsiderationRule[] = (
  considerationsJson as { considerations: ConsiderationRule[] }
).considerations.map((rule) => {
  if (!CONSIDERATION_IDS.includes(rule.id)) throw new Error(`considerations.json: unknown consideration ${rule.id}.`)
  return rule
})

export const considerationRule = (id: ConsiderationId) => CONSIDERATION_RULES.find((rule) => rule.id === id)!

const COMPONENTS = [
  oldForest,
  patchSize,
  watershed,
  tapOgma,
  visuals,
  caribouUwr,
  arch,
  migratoryBirds,
  fisher,
  ...(reportComponents as { components: unknown[] }).components,
] as unknown as Component[]

const partId = (id: ConsiderationId) => `consideration-${id}`

/** The recipe for a preset: title, route card, then each consideration the preset lists, under its rule. */
export function routeCardRecipe(preset: RouteCardPreset): Recipe {
  return {
    kind: 'recipe',
    id: `route-card-${preset.id}`,
    name: preset.name,
    description: preset.description,
    missing: 'placeholder',
    document: { metadata: { title: '{{ sheet.title }} — {{ report.presetName }}' } },
    sections: [
      {
        id: 'report',
        page: { paper: 'letter', orientation: 'portrait' },
        parts: [
          { use: 'route-card-title', id: 'title' },
          { use: 'route-card-table', id: 'route-card' },
          { use: 'route-card-considerations-heading', id: 'considerations-heading' },
          ...preset.considerations.map((id) => {
            const rule = considerationRule(id)
            return {
              use: partId(id),
              id: partId(id),
              with: { title: rule.title },
              ...(rule.when.trim() === 'true' ? {} : { if: rule.when }),
            }
          }),
          { use: 'route-card-notes', id: 'notes' },
        ],
      },
    ],
  } as unknown as Recipe
}

/** The library the recipe compiles against: the kit's shared components and the route card's own. */
export const routeCardLibrary = (kit: RouteCardKit) => kit.sharedLibrary({ components: COMPONENTS })

export type RouteCardReportInput = {
  preset: RouteCardPreset
  sheet: RouteCardSheet
  facts: ConsiderationFacts
  /** When the layers were read, for the notes. */
  readAt: string
  /** Lines printed under the report: provenance and caveats. */
  notes: string[]
  /** Pictures under each consideration's paragraph: its maps, and the saved views under Visuals. */
  figures?: readonly RouteCardFigure[]
}

export type DraftedConsideration = {
  id: ConsiderationId
  title: string
  /** The paragraphs as printed, without the heading. */
  paragraphs: string[]
  text: string
  /** The reviewer's own paragraph, not the draft. */
  own: boolean
  /** The values it still leaves to complete (its placeholders). */
  toComplete: string[]
}

export type RouteCardReport = {
  document: Document
  /** The considerations the rules called for, in the preset's order. */
  considerations: DraftedConsideration[]
  /** The considerations the preset lists that the rules left out, with the rule. */
  notCalledFor: Array<{ id: ConsiderationId; title: string; when: string }>
  toComplete: Array<{ part: string | null; what: string }>
}

/** The data the recipe reads: the facts at the top level, with the sheet and the report's own lines. */
export const routeCardData = (input: RouteCardReportInput) => ({
  ...input.facts,
  sheet: {
    title: input.sheet.title,
    sections: input.sheet.sections.map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({
        label: row.label,
        value: row.value,
        flagged: row.flagged,
        found: [row.names, row.note].filter(Boolean).join(' — '),
      })),
    })),
  },
  report: { presetName: input.preset.name, readAt: input.readAt, notes: input.notes },
  // By consideration, as each component's figure loop reads them; every consideration has a list, empty or not.
  figures: Object.fromEntries(
    CONSIDERATION_IDS.map((id) => [
      factKeyOf(id),
      (input.figures ?? [])
        .filter((figure) => figure.consideration === id)
        .map((figure) => ({
          caption: figure.caption,
          image: { bytes: figure.bytes, format: figure.format, width: figure.width, height: figure.height },
        })),
    ]),
  ),
})

type BodyBlock = Document['sections'][number]['body'][number]

function blockText(kit: RouteCardKit, block: BodyBlock): string | null {
  if (block.type === 'paragraph') return kit.plainText(block.content).trim()
  return null
}

/** Compiles once per preset and kit; the compile checks every component and rule. */
const compiledCache = new WeakMap<RouteCardKit, Map<string, CompiledRecipe>>()

export function compiledRouteCardRecipe(kit: RouteCardKit, preset: RouteCardPreset): CompiledRecipe {
  let cache = compiledCache.get(kit)
  if (!cache) compiledCache.set(kit, (cache = new Map()))
  const key = JSON.stringify(preset)
  let compiled = cache.get(key)
  if (!compiled) {
    compiled = kit.compileRecipe(routeCardRecipe(preset), routeCardLibrary(kit))
    cache.set(key, compiled)
  }
  return compiled
}

export function buildRouteCardReport(kit: RouteCardKit, input: RouteCardReportInput): RouteCardReport {
  const rendered = kit.renderRecipe(compiledRouteCardRecipe(kit, input.preset), routeCardData(input))
  const body = rendered.document.sections[0]?.body ?? []
  const considerations = input.preset.considerations.flatMap((id): DraftedConsideration[] => {
    const part = rendered.parts.find((entry) => entry.id === partId(id))
    if (!part || part.blocks === 0) return []
    const blocks = body.slice(part.start, part.end)
    const paragraphs = blocks.flatMap((block) => {
      const text = blockText(kit, block)
      return text ? [text] : []
    })
    return [
      {
        id,
        title: considerationRule(id).title,
        paragraphs,
        text: paragraphs.join('\n\n'),
        own: Boolean(input.facts.own[factKeyOf(id)]),
        toComplete: rendered.toComplete.filter((item) => item.partId === part.id).map(itemText),
      },
    ]
  })
  const shown = new Set(considerations.map((item) => item.id))
  return {
    document: rendered.document,
    considerations,
    notCalledFor: input.preset.considerations
      .filter((id) => !shown.has(id))
      .map((id) => ({ id, title: considerationRule(id).title, when: considerationRule(id).when })),
    toComplete: rendered.toComplete.map((item) => ({ part: item.partId, what: itemText(item) })),
  }
}

const factKeyOf = (id: string) => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

const itemText = (item: RenderResult['toComplete'][number]) => item.what
