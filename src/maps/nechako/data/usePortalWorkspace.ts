import { useCallback, useState } from 'react'
import { errorText } from '@/lib/nechakoPortal'
import { applyLocalDefaultStyle } from './styleLibrary'
import { usePortalSession } from './usePortalSession'
import { EMPTY_WORKSPACE, type VectorData, type Workspace } from './workspace'

/** Both portal interfaces use the same workspace lifetime, independent of their navigation. */
export function usePortalWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE)
  const clearSessionWorkspace = useCallback(() => {
    setWorkspace((current) =>
      current.sessionBound
        ? {
            ...EMPTY_WORKSPACE,
            camera: current.camera,
            warnings: [
              'The portal connection changed; unsaved source-session map data was cleared. Explicit browser saves remain available.',
            ],
          }
        : current,
    )
  }, [])
  const session = usePortalSession(clearSessionWorkspace)
  const addLocalVectors = useCallback(async (vectors: VectorData[]) => {
    const warnings: string[] = []
    const styled = await Promise.all(
      vectors.map(async (vector) => {
        try {
          return await applyLocalDefaultStyle(vector)
        } catch (reason) {
          warnings.push(`Default style unavailable for ${vector.name}: ${errorText(reason)}`)
          return vector
        }
      }),
    )
    setWorkspace((current) => ({
      ...current,
      vectors: [...current.vectors, ...styled],
      warnings: [...(current.warnings ?? []), ...warnings],
    }))
  }, [])
  return { workspace, setWorkspace, session, addLocalVectors }
}
