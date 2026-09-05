import type { AcknowledgementPurpose } from '@/lib/acknowledgement/engine'
import { createLocation, defaultSources, type BuilderLocation } from './builder'
import { defaultWordingOptions } from './data'
import type { GeocodeResult, SpeakerPerspective, WordingMode, SourceKey, MatchType, WordingOptions } from './types'

export const DRAFT_STORAGE_KEY = 'pgmaps.acknowledgement-draft.v1'
export type DraftSource = { title: string; url: string }
export type AuthoredDraft = { text: string; context: string; sources?: DraftSource[] }
export type SavedBuilder = {
  locations: BuilderLocation[]
  authored: AuthoredDraft | null
  preview?: AuthoredDraft | null
  perspective: SpeakerPerspective
  organizationName: string
  wordingMode: WordingMode
  enabledSources: Record<SourceKey, boolean>
  matchTypes: Record<MatchType, boolean>
  wordingOptions: WordingOptions
  scope: 'specific' | 'regional'
  purpose?: AcknowledgementPurpose
  venueId?: string | null
  regionName: string
  orgId: string | null
}
function flags<T extends string>(raw: unknown, defaults: Record<T, boolean>): Record<T, boolean> {
  const output = { ...defaults }
  if (raw && typeof raw === 'object')
    for (const key of Object.keys(defaults) as T[]) {
      const value = (raw as Record<string, unknown>)[key]
      if (typeof value === 'boolean') output[key] = value
    }
  return output
}
export function readSavedBuilder(): SavedBuilder | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null')
    if (!raw || raw.version !== 1 || !Array.isArray(raw.locations)) return null
    // Retain the last generated text if fresh evidence is unavailable after reload.
    const draft = raw.authored ?? raw.preview
    const locations = raw.locations
      .filter((item: { result?: Partial<GeocodeResult> }) => {
        const result = item?.result
        return (
          result &&
          typeof result.fullAddress === 'string' &&
          Number.isFinite(result.latitude) &&
          Number.isFinite(result.longitude) &&
          Math.abs(result.latitude!) <= 90 &&
          Math.abs(result.longitude!) <= 180
        )
      })
      .map((item: { id?: string; result: GeocodeResult; selectedIds?: string[] | null }) => ({
        ...createLocation(item.result, typeof item.id === 'string' ? item.id : undefined),
        selectedIds: Array.isArray(item.selectedIds) ? item.selectedIds.filter((id) => typeof id === 'string') : null,
      }))
    return {
      locations,
      enabledSources: flags(raw.enabledSources, defaultSources),
      matchTypes: flags(raw.matchTypes, { place: true, municipality: true, boundary: true }),
      wordingOptions: flags(raw.wordingOptions, {
        includeTreatyContext: defaultWordingOptions.includeTreatyContext,
        includePeopleGroupContext: defaultWordingOptions.includePeopleGroupContext,
      }),
      authored:
        typeof draft?.text === 'string' && typeof draft?.context === 'string'
          ? {
              text: draft.text,
              context: draft.context,
              sources: Array.isArray(draft.sources)
                ? draft.sources.filter(
                    (source: DraftSource) =>
                      typeof source?.title === 'string' &&
                      typeof source?.url === 'string' &&
                      /^https?:\/\//.test(source.url),
                  )
                : [],
            }
          : null,
      perspective: ['collective', 'individual', 'organization'].includes(raw.perspective)
        ? raw.perspective
        : 'collective',
      organizationName: typeof raw.organizationName === 'string' ? raw.organizationName : '',
      wordingMode: ['short', 'event', 'formal', 'institutional'].includes(raw.wordingMode) ? raw.wordingMode : 'event',
      purpose: ['venue', 'operations', 'distributed'].includes(raw.purpose) ? raw.purpose : 'venue',
      venueId: typeof raw.venueId === 'string' ? raw.venueId : null,
      scope: raw.scope === 'regional' ? 'regional' : 'specific',
      regionName: typeof raw.regionName === 'string' ? raw.regionName : 'British Columbia',
      orgId: typeof raw.orgId === 'string' ? raw.orgId : null,
    }
  } catch {
    return null
  }
}
export function saveBuilder(value: SavedBuilder) {
  localStorage.setItem(
    DRAFT_STORAGE_KEY,
    JSON.stringify({
      ...value,
      version: 1,
      locations: value.locations.map(({ id, result, selectedIds }) => ({ id, result, selectedIds })),
    }),
  )
}
