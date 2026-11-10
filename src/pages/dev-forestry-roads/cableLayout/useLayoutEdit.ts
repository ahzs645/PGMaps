/**
 * Hooks for adjusting a D-line's support layout by hand: the debounced re-check that follows every
 * edit (with a check of the found layout beside it, for the Found column), the chart's edit actions,
 * and the page's cursor following a row picked in the sidebar.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { CableLine, TerrainSource } from '../types'
import {
  clearEditCheck,
  editCheckIsCurrent,
  scheduleEditCheck,
  setEditCheckError,
  useAnyLayoutFocus,
} from './editStore'
import {
  addSupportAt,
  defaultPreTension,
  editCheckKey,
  editFromFound,
  editedLayoutToAnalyse,
  emptyEdit,
  sectorFromDrag,
  type EditedLayout,
} from './layoutEdit'
import {
  DEFAULT_SUPPORT_LAYOUT,
  MAX_SECTORS,
  layoutRun,
  lineFrame,
  savedLayoutToAnalyse,
  type CableSupportLayout,
} from './settings'
import { layoutKey, startLayoutCheck, useCableLayoutEntry } from './useCableLayout'

type EditLine = (change: (line: CableLine) => CableLine) => void

/** Checks `edited` on the D-line as it is now (after the delay), or records why it cannot be. */
export function checkEdit(line: CableLine, terrain: TerrainSource, edited: EditedLayout, delayMs?: number) {
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  const lineKey = layoutKey(line, terrain)
  const checkKey = editCheckKey(edited)
  if (editCheckIsCurrent(line.id, lineKey, checkKey)) return
  const prepared = layoutRun(line, terrain, settings)
  if (!prepared.ok) return setEditCheckError(line.id, lineKey, checkKey, prepared.error)
  const layout = editedLayoutToAnalyse(prepared.run, edited)
  if (!layout.ok) return setEditCheckError(line.id, lineKey, checkKey, layout.error)
  scheduleEditCheck(line.id, lineKey, checkKey, prepared.run.input, layout.layout, delayMs)
}

/**
 * Keeps the edited layout's check current: about 300 ms after each change, cancelling a stale one.
 * While editing, the found layout is also re-checked on the D-line as it is now, so the two can be
 * compared. Safe to call from several components for the same D-line.
 */
export function useEditedLayoutCheck(line: CableLine | undefined, terrain: TerrainSource) {
  const edited = line?.supportLayout?.edited
  const saved = line?.supportLayout?.saved
  const lineKey = line ? layoutKey(line, terrain) : ''
  const entry = useCableLayoutEntry(line?.id)
  const foundStale = Boolean(edited && saved && (!entry || (entry.key !== lineKey && entry.status !== 'running')))
  useEffect(() => {
    if (!line) return
    if (!edited) return clearEditCheck(line.id)
    checkEdit(line, terrain, edited)
    if (!foundStale || !line.supportLayout?.saved) return
    const prepared = layoutRun(line, terrain, line.supportLayout)
    const found = prepared.ok ? savedLayoutToAnalyse(prepared.run, line.supportLayout.saved) : null
    if (prepared.ok && found) startLayoutCheck(line.id, lineKey, prepared.run, found)
  }, [line, terrain, edited, lineKey, foundStale])
}

/** What the D-line chart may change in a support layout. */
export interface CableChartEdit {
  edited: EditedLayout | undefined
  settings: CableSupportLayout
  lengthM: number
  yarderAtEnd: boolean
  /** Commits an edited layout (one undo step). */
  commit: (next: EditedLayout) => void
  /** Re-checks a layout still being dragged, without saving it; null re-checks the saved edit. */
  preview: (next: EditedLayout | null) => void
  /** Adds a support at a station, starting an edit from the found layout (or by hand) first. */
  addSupport: (stationM: number) => void
  /** Adds a no-support sector between two stations (a search setting). */
  addSector: (aM: number, bM: number) => void
}

/** The edit that `addSupport` starts from when nothing is being edited yet. */
export function startingEdit(line: CableLine, terrain: TerrainSource): EditedLayout | null {
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  if (settings.edited) return settings.edited
  const prepared = layoutRun(line, terrain, settings)
  if (!prepared.ok) return null
  if (settings.saved && savedLayoutToAnalyse(prepared.run, settings.saved))
    return editFromFound(settings.saved, settings, prepared.run.lengthM)
  return emptyEdit(settings, defaultPreTension(prepared.run))
}

/** Writes an edited layout onto the D-line. */
export const withEdited = (line: CableLine, edited: EditedLayout | undefined): CableLine => {
  const settings = { ...(line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT) }
  if (edited) settings.edited = edited
  else delete settings.edited
  return { ...line, supportLayout: settings }
}

/**
 * The D-line chart's edit actions for a D-line with rope mechanics, or undefined when it cannot be
 * edited. Also keeps the edit's check current while the sidebar section is closed.
 */
export function useCableLayoutChartEdit(
  line: CableLine | undefined,
  terrain: TerrainSource,
  editLine: EditLine | undefined,
): CableChartEdit | undefined {
  useEditedLayoutCheck(line, terrain)
  return useMemo(() => {
    if (!line || !editLine || line.sagModel !== 'mechanics' || !line.rigging) return undefined
    const frame = lineFrame(line)
    if (!frame) return undefined
    const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
    const id = line.id
    const apply = (change: (l: CableLine) => CableLine) => editLine((l) => (l.id === id ? change(l) : l))
    return {
      edited: settings.edited,
      settings,
      lengthM: frame.lengthM,
      yarderAtEnd: frame.yarderAtEnd,
      commit: (next) => apply((l) => withEdited(l, next)),
      preview: (next) => {
        const edited = next ?? settings.edited
        if (edited) checkEdit(line, terrain, edited)
      },
      addSupport: (stationM) => {
        const start = startingEdit(line, terrain)
        const added = start && addSupportAt(start, stationM, settings, frame.lengthM)
        if (added) apply((l) => withEdited(l, added.edited))
      },
      addSector: (aM, bM) => {
        const sector = sectorFromDrag(aM, bM, frame.lengthM)
        if (!sector) return
        apply((l) => {
          const s = l.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
          if (s.noSupportSectors.length >= MAX_SECTORS) return l
          return { ...l, supportLayout: { ...s, noSupportSectors: [...s.noSupportSectors, sector] } }
        })
      },
    }
  }, [line, terrain, editLine])
}

/**
 * Calls `onFocus` with the D-line and chart distance of each row picked in the sidebar, so the page
 * can show that D-line's chart and move its cursor (and the plan's) there.
 */
export function useLayoutFocusFollower(onFocus: (cableId: string, x: number | null) => void) {
  const focus = useAnyLayoutFocus()
  const handler = useRef(onFocus)
  useEffect(() => {
    handler.current = onFocus
  })
  const seq = focus?.seq
  useEffect(() => {
    if (focus && seq !== undefined) handler.current(focus.cableId, focus.x)
    // Only a new request moves the cursor; re-renders with the same one do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])
}
