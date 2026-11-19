/**
 * The reviewer's route card record, kept in the scene's review (`viaReview.routeCard`): which
 * preset, and per block (by its id) the rows they entered or measured from their own file, their
 * own Other Considerations paragraphs, the figures the paragraphs ask them for, and the block's
 * access road if they gave one. A record of review: it never changes the visibility run. No DOM
 * or network access.
 */
import { CONSIDERATION_IDS, type ConsiderationId } from './rows'
import type { ConsiderationInputs } from './facts'
import type { RouteCardEntry } from './results'

export type RouteCardBlockReview = {
  /** Rows the tool cannot read, by row id. */
  entries?: Record<string, RouteCardEntry>
  /** The reviewer's own paragraphs, by consideration id: kept once written, the draft only offered beside them. */
  own?: Partial<Record<ConsiderationId, string>>
  inputs?: ConsiderationInputs
  /** The block's access road, for the considerations' crossings: lines in longitude and latitude. */
  access?: { name: string; lines: Array<Array<[number, number]>> } | null
}

export type RouteCardReview = {
  preset?: string
  /** By block id. */
  blocks?: Record<string, RouteCardBlockReview>
}

const MAX_TEXT = 4000
const MAX_ENTRIES = 200

const text = (value: unknown, max = MAX_TEXT) =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined

function parseEntry(value: unknown): RouteCardEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const entry = value as Record<string, unknown>
  if (entry.answer !== 'yes' && entry.answer !== 'near' && entry.answer !== 'no') return undefined
  const source = text(entry.source, 400)
  return {
    answer: entry.answer,
    names: typeof entry.names === 'string' ? entry.names.slice(0, MAX_TEXT) : '',
    ...(source ? { source } : {}),
  }
}

function parseLines(value: unknown): Array<Array<[number, number]>> {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, 200)
    .map((line) =>
      Array.isArray(line)
        ? line
            .slice(0, 20_000)
            .filter(
              (point): point is [number, number] =>
                Array.isArray(point) &&
                Number.isFinite(point[0]) &&
                Number.isFinite(point[1]) &&
                Math.abs(point[0]) <= 180 &&
                Math.abs(point[1]) <= 90,
            )
            .map(([lng, lat]) => [lng, lat] as [number, number])
        : [],
    )
    .filter((line) => line.length >= 2)
}

function parseBlock(value: unknown): RouteCardBlockReview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const entries: Record<string, RouteCardEntry> = {}
  if (raw.entries && typeof raw.entries === 'object')
    for (const [id, entry] of Object.entries(raw.entries as Record<string, unknown>).slice(0, MAX_ENTRIES)) {
      const parsed = parseEntry(entry)
      if (parsed && /^[a-z0-9-]{1,64}$/.test(id)) entries[id] = parsed
    }
  const own: Partial<Record<ConsiderationId, string>> = {}
  if (raw.own && typeof raw.own === 'object')
    for (const id of CONSIDERATION_IDS) {
      const paragraph = text((raw.own as Record<string, unknown>)[id])
      if (paragraph) own[id] = paragraph
    }
  const inputs: ConsiderationInputs = {}
  if (raw.inputs && typeof raw.inputs === 'object') {
    const given = raw.inputs as Record<string, unknown>
    for (const key of [
      'oldForestStatement',
      'patchCurrentPercent',
      'patchFutureTarget',
      'patchDecision',
      'tapNote',
    ] as const) {
      const value = text(given[key], 1000)
      if (value) inputs[key] = value
    }
  }
  const accessRaw = raw.access as { name?: unknown; lines?: unknown } | null | undefined
  const lines = accessRaw ? parseLines(accessRaw.lines) : []
  const block: RouteCardBlockReview = {
    ...(Object.keys(entries).length ? { entries } : {}),
    ...(Object.keys(own).length ? { own } : {}),
    ...(Object.keys(inputs).length ? { inputs } : {}),
    ...(lines.length ? { access: { name: text(accessRaw?.name, 200) ?? 'Access road', lines } } : {}),
  }
  return Object.keys(block).length ? block : undefined
}

/** The record as stored, read back; anything it does not recognise is left out. */
export function parseRouteCardReview(value: unknown): RouteCardReview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const blocks: Record<string, RouteCardBlockReview> = {}
  if (raw.blocks && typeof raw.blocks === 'object')
    for (const [id, block] of Object.entries(raw.blocks as Record<string, unknown>).slice(0, 500)) {
      const parsed = parseBlock(block)
      if (parsed && id.length <= 200) blocks[id] = parsed
    }
  const preset = text(raw.preset, 64)
  const review: RouteCardReview = {
    ...(preset ? { preset } : {}),
    ...(Object.keys(blocks).length ? { blocks } : {}),
  }
  return Object.keys(review).length ? review : undefined
}

/** The review with one block's record changed; an emptied record is removed. */
export function withBlockReview(
  review: RouteCardReview | undefined,
  blockId: string,
  change: (block: RouteCardBlockReview) => RouteCardBlockReview,
): RouteCardReview {
  const next = change(review?.blocks?.[blockId] ?? {})
  const blocks = { ...review?.blocks }
  const cleaned = parseBlock(next)
  if (cleaned) blocks[blockId] = cleaned
  else delete blocks[blockId]
  return { ...review, blocks }
}
