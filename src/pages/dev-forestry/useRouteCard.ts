import { useEffect, useMemo, useState } from 'react'

import { accessPlanar } from '@/lib/forestry/routeCard/access'
import { albers, planarFromGeoJson, type Planar } from '@/lib/forestry/routeCard/geometry'
import { runRouteCard, type RouteCardRowState } from '@/lib/forestry/routeCard/results'
import type { RouteCardPreset } from '@/lib/forestry/routeCard/rows'
import { inventoryFetch } from '@/lib/offline/inventoryCopies'

import type { TargetPolygon } from './types'

/** Edits settle before the layers are read again: dragging a vertex is not seventy queries a step. */
const READ_DELAY_MS = 900

const toAlbers = (position: [number, number]) => albers(position[0], position[1])

/** A block's shape in BC Albers metres. */
export const blockShape = (block: Pick<TargetPolygon, 'geometry'>): Planar | null =>
  planarFromGeoJson(block.geometry, toAlbers)

export type RouteCardRun = {
  /** Each row's state, by row id; empty until the block is read. */
  states: Record<string, RouteCardRowState>
  /** When the layers were read (ISO), once every row has answered. */
  readAt: string | null
  /** Rows still reading. */
  pending: number
  /** Why nothing is being read. */
  unchecked: string | null
  /** Read every layer again. */
  reread: () => void
}

/**
 * Reads a preset's route card for one block, and again whenever the block's shape, its access road or the preset
 * changes: each layer through `inventoryFetch` (the reviewer's *Keep inventory copies*), each row reported as its read
 * lands. Reads only; it writes nothing to the scene. Off (`active` false) it reads nothing.
 */
export function useRouteCard(
  block: TargetPolygon | null,
  access: ReadonlyArray<ReadonlyArray<[number, number]>> | null,
  preset: RouteCardPreset,
  active: boolean,
): RouteCardRun {
  const [nonce, setNonce] = useState(0)
  // The shapes and preset, not their objects: a rename or recolour reads nothing again.
  const key = useMemo(
    () => (block ? JSON.stringify([block.geometry, access ?? null, preset.id, nonce]) : ''),
    [block, access, preset.id, nonce],
  )
  const [state, setState] = useState<{ key: string; states: Record<string, RouteCardRowState>; readAt: string | null }>(
    { key: '', states: {}, readAt: null },
  )

  useEffect(() => {
    if (!active || !key || !block) return
    const shape = blockShape(block)
    if (!shape) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ key, states: {}, readAt: null })
      runRouteCard(
        preset,
        { id: block.id, name: block.name, kind: 'block', shape },
        inventoryFetch,
        (id, rowState) => {
          if (controller.signal.aborted) return
          setState((current) =>
            current.key === key ? { ...current, states: { ...current.states, [id]: rowState } } : current,
          )
        },
        { signal: controller.signal, access: accessPlanar(access) },
      ).then(() => {
        if (controller.signal.aborted) return
        setState((current) => (current.key === key ? { ...current, readAt: new Date().toISOString() } : current))
      })
    }, READ_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // `key` stands for the block's shape, the access road and the preset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active])

  const states = state.key === key ? state.states : {}
  const pending = Object.values(states).filter((entry) => entry.status === 'reading').length
  return {
    states,
    readAt: state.key === key ? state.readAt : null,
    pending: state.key === key ? pending : 0,
    unchecked: !block ? 'Add a cutblock to read its route card.' : null,
    reread: () => setNonce((value) => value + 1),
  }
}
