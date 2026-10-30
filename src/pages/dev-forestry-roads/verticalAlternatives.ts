/** Named vertical designs under one horizontal road; pure, immutable and project-file portable. */
import type { Alignment, VerticalAlternative } from './types'

export const MAX_VERTICAL_ALTERNATIVES = 12
const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))
const profile = (road: Alignment, id: string, name: string): VerticalAlternative => ({
  id,
  name,
  vertical: copy(road.vertical),
  ...(road.verticalStandards ? { verticalStandards: copy(road.verticalStandards) } : {}),
  ...(road.verticalControls ? { verticalControls: copy(road.verticalControls) } : {}),
  ...(road.fullCostRecord ? { fullCostRecord: road.fullCostRecord } : {}),
  ...(road.verticalAlternativeCostMode === 'independent' && road.engineering
    ? { engineering: copy(road.engineering) }
    : {}),
})
const named = (value: string) => {
  const name = value.trim()
  if (!name || name.length > 100) throw Error('A vertical alternative needs a name of 1–100 characters.')
  return name
}
const validId = (value: string) => {
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) throw Error('Vertical alternative ID is invalid.')
  return value
}

/** Call after ordinary profile/standard/engineering edits, before serialization and before switching. */
export function snapshotActiveVerticalAlternative(road: Alignment): Alignment {
  if (!road.verticalAlternatives?.length) return road
  if (!road.verticalAlternatives.some((v) => v.id === road.activeVerticalAlternativeId))
    throw Error('The active vertical alternative does not exist.')
  return {
    ...road,
    verticalAlternatives: road.verticalAlternatives.map((v) =>
      v.id === road.activeVerticalAlternativeId ? profile(road, v.id, v.name) : v,
    ),
  }
}

export function activateVerticalAlternative(road: Alignment, id: string): Alignment {
  const saved = snapshotActiveVerticalAlternative(road)
  const next = saved.verticalAlternatives?.find((v) => v.id === id)
  if (!next) throw Error('The selected vertical alternative does not exist.')
  const result = {
    ...saved,
    activeVerticalAlternativeId: next.id,
    vertical: copy(next.vertical),
    verticalStandards: copy(next.verticalStandards),
    verticalControls: copy(next.verticalControls),
    fullCostRecord: next.fullCostRecord,
    ...(saved.verticalAlternativeCostMode === 'independent' ? { engineering: copy(next.engineering) } : {}),
  }
  return result
}

/** Adding the first child retains the original profile as a sibling. IDs are caller supplied. */
export function addVerticalAlternative(
  road: Alignment,
  id: string,
  name: string,
  originalId = `${id}-original`,
): Alignment {
  validId(id)
  const saved = snapshotActiveVerticalAlternative(road)
  let alternatives = saved.verticalAlternatives ?? []
  if (!alternatives.length) alternatives = [profile(saved, validId(originalId), 'Original profile')]
  if (alternatives.length >= MAX_VERTICAL_ALTERNATIVES)
    throw Error(`At most ${MAX_VERTICAL_ALTERNATIVES} vertical alternatives fit one road.`)
  if (alternatives.some((v) => v.id === id)) throw Error('Vertical alternative IDs must be unique.')
  const next = profile(saved, id, named(name))
  // A new alternative has no adopted comparison yet; retain the original child's evidence.
  delete next.fullCostRecord
  const result = { ...saved, verticalAlternatives: [...alternatives, next], activeVerticalAlternativeId: id }
  delete result.fullCostRecord
  return result
}

export function renameVerticalAlternative(road: Alignment, id: string, name: string): Alignment {
  const saved = snapshotActiveVerticalAlternative(road)
  if (!saved.verticalAlternatives?.some((v) => v.id === id)) throw Error('Vertical alternative does not exist.')
  return {
    ...saved,
    verticalAlternatives: saved.verticalAlternatives.map((v) => (v.id === id ? { ...v, name: named(name) } : v)),
  }
}

export function removeVerticalAlternative(road: Alignment, id: string): Alignment {
  const saved = snapshotActiveVerticalAlternative(road)
  const kept = saved.verticalAlternatives?.filter((v) => v.id !== id)
  if (!kept || kept.length === saved.verticalAlternatives?.length) throw Error('Vertical alternative does not exist.')
  if (!kept.length) throw Error('Keep at least one vertical alternative.')
  if (saved.activeVerticalAlternativeId === id)
    return activateVerticalAlternative(
      {
        ...saved,
        verticalAlternatives: kept,
        activeVerticalAlternativeId: kept[0].id,
        vertical: copy(kept[0].vertical),
        verticalStandards: copy(kept[0].verticalStandards),
        verticalControls: copy(kept[0].verticalControls),
        fullCostRecord: kept[0].fullCostRecord,
        ...(saved.verticalAlternativeCostMode === 'independent' ? { engineering: copy(kept[0].engineering) } : {}),
      },
      kept[0].id,
    )
  return { ...saved, verticalAlternatives: kept }
}

export function setVerticalAlternativeCostMode(road: Alignment, mode: 'shared' | 'independent'): Alignment {
  if (!['shared', 'independent'].includes(mode)) throw Error('Choose shared or independent engineering inputs.')
  let saved = snapshotActiveVerticalAlternative(road)
  if (!saved.verticalAlternatives?.length)
    saved = {
      ...saved,
      verticalAlternatives: [profile(saved, 'original-profile', 'Original profile')],
      activeVerticalAlternativeId: 'original-profile',
    }
  if ((saved.verticalAlternativeCostMode ?? 'shared') === mode) return saved
  return {
    ...saved,
    verticalAlternativeCostMode: mode,
    verticalAlternatives: saved.verticalAlternatives?.map((v) => {
      const result = { ...v }
      if (mode === 'independent') result.engineering = copy(saved.engineering)
      else delete result.engineering
      return result
    }),
  }
}

/** Analysis designs share the exact same points/template/ranges. Only profile-dependent inputs differ. */
export function materializeVerticalAlternatives(
  road: Alignment,
): { alternative: VerticalAlternative; alignment: Alignment }[] {
  const saved = snapshotActiveVerticalAlternative(road)
  return (saved.verticalAlternatives ?? []).map((alternative) => ({
    alternative,
    alignment: {
      ...saved,
      vertical: copy(alternative.vertical),
      verticalStandards: copy(alternative.verticalStandards),
      verticalControls: copy(alternative.verticalControls),
      ...(saved.verticalAlternativeCostMode === 'independent' ? { engineering: copy(alternative.engineering) } : {}),
      // Analysis-only materialization must not snapshot a sibling back into the selected child.
      verticalAlternatives: undefined,
      activeVerticalAlternativeId: undefined,
      fullCostRecord: undefined,
    },
  }))
}

/**
 * Root project parser supplies its existing design parser for every child. This prevents nested
 * engineering/standard records from taking a weaker validation path than the active design.
 */
export function parseVerticalAlternativeFields(
  raw: Record<string, unknown>,
  parseChild: (
    raw: Record<string, unknown>,
  ) => Pick<Alignment, 'vertical' | 'verticalStandards' | 'verticalControls' | 'engineering' | 'fullCostRecord'>,
): Pick<Alignment, 'verticalAlternatives' | 'activeVerticalAlternativeId' | 'verticalAlternativeCostMode'> {
  if (raw.verticalAlternatives === undefined) {
    if (raw.activeVerticalAlternativeId !== undefined || raw.verticalAlternativeCostMode !== undefined)
      throw Error('Vertical alternative metadata needs an alternatives list.')
    return {}
  }
  if (
    !Array.isArray(raw.verticalAlternatives) ||
    !raw.verticalAlternatives.length ||
    raw.verticalAlternatives.length > MAX_VERTICAL_ALTERNATIVES
  )
    throw Error(`A road needs 1–${MAX_VERTICAL_ALTERNATIVES} named vertical alternatives.`)
  const mode = raw.verticalAlternativeCostMode ?? 'shared'
  if (mode !== 'shared' && mode !== 'independent') throw Error('Invalid vertical-alternative engineering mode.')
  const alternatives = raw.verticalAlternatives.map((value): VerticalAlternative => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid vertical alternative.')
    const child = value as Record<string, unknown>
    if (typeof child.id !== 'string' || typeof child.name !== 'string')
      throw Error('Vertical alternative needs an ID and name.')
    const parsed = parseChild(child)
    return {
      id: validId(child.id),
      name: named(child.name),
      vertical: parsed.vertical,
      ...(parsed.verticalStandards ? { verticalStandards: parsed.verticalStandards } : {}),
      ...(parsed.verticalControls ? { verticalControls: parsed.verticalControls } : {}),
      ...(parsed.fullCostRecord ? { fullCostRecord: parsed.fullCostRecord } : {}),
      ...(mode === 'independent' && parsed.engineering ? { engineering: parsed.engineering } : {}),
    }
  })
  if (new Set(alternatives.map((v) => v.id)).size !== alternatives.length)
    throw Error('Vertical alternative IDs must be unique.')
  if (
    typeof raw.activeVerticalAlternativeId !== 'string' ||
    !alternatives.some((v) => v.id === raw.activeVerticalAlternativeId)
  )
    throw Error('The active vertical alternative does not exist.')
  return {
    verticalAlternatives: alternatives,
    activeVerticalAlternativeId: raw.activeVerticalAlternativeId,
    verticalAlternativeCostMode: mode,
  }
}
