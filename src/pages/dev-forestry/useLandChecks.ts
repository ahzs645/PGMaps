import { useEffect, useMemo, useState } from 'react'

import { LAND_CHECKS, landCheckBounds, runLandCheck, type LandCheckId, type LandCheckState } from './landStatusChecks'
import type { TargetPolygon } from './types'

/** Edits settle before the layers are read again: dragging a vertex is not nine queries a step. */
const CHECK_DELAY_MS = 800

/**
 * Runs every land status check (`landStatusChecks.ts`) against the scene's blocks and active
 * landform, again whenever either changes shape. Each layer reports on its own, so a slow or
 * failed layer never holds the others. Reads only; it writes nothing to the scene.
 */
export function useLandChecks(blocks: readonly TargetPolygon[], landform: TargetPolygon | null) {
  const input = useMemo(
    () => ({
      blocks: blocks.map((block) => ({ name: block.name, geometry: block.geometry })),
      landform: landform?.geometry ?? null,
    }),
    [blocks, landform],
  )
  // The shapes, not their objects: a scene edit elsewhere must not read the layers again.
  const key = useMemo(() => JSON.stringify(input), [input])
  const bounds = useMemo(
    () =>
      input.blocks.length
        ? landCheckBounds(
            input.blocks.map((block) => block.geometry),
            input.landform,
          )
        : null,
    // Keyed by the shapes, so recolouring or renaming a block reads nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  const [states, setStates] = useState<{ key: string; byId: Partial<Record<LandCheckId, LandCheckState>> }>({
    key: '',
    byId: {},
  })

  useEffect(() => {
    if (!bounds) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setStates({ key, byId: Object.fromEntries(LAND_CHECKS.map((check) => [check.id, { status: 'loading' }])) })
      for (const check of LAND_CHECKS)
        runLandCheck(check, bounds, input.blocks, input.landform, fetch, controller.signal)
          .then((result) => ({ status: 'ready' as const, result }))
          .catch((error: unknown) => ({
            status: 'error' as const,
            error: error instanceof Error ? error.message : String(error),
          }))
          .then((state) => {
            if (controller.signal.aborted) return
            setStates((current) =>
              current.key === key ? { key, byId: { ...current.byId, [check.id]: state } } : current,
            )
          })
    }, CHECK_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // `key` stands for `input`'s shapes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bounds])

  const unchecked = !input.blocks.length
    ? 'Add a cutblock to check the land under it.'
    : !bounds
      ? 'The blocks are spread too wide to check in one query.'
      : null
  return { states: states.key === key ? states.byId : {}, unchecked }
}
