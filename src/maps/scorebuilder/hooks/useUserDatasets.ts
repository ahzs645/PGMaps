import { useCallback, useEffect, useMemo, useState } from 'react'
import { profileFeatureCollection, type DatasetProfile } from '../lib/datasetCatalog'
import {
  createUserDatasetId,
  deleteUserDataset,
  listUserDatasets,
  loadUserDatasetCollections,
  parseUserDatasetFile,
  saveUserDataset,
  userDatasetSourceId,
  type UserDatasetSummary,
} from '../lib/userDatasets'

export interface UserDatasetUploadResult {
  summary: UserDatasetSummary
  warnings: string[]
}

/**
 * Surfaces the user-uploaded datasets stored in IndexedDB (via Dexie) as
 * recipe sources: summaries for the builder UI plus feature collections and
 * profiles keyed by their `user.<id>` source id.
 */
export function useUserDatasets() {
  const [summaries, setSummaries] = useState<UserDatasetSummary[]>([])
  const [collections, setCollections] = useState<Record<string, GeoJSON.FeatureCollection>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextSummaries, nextCollections] = await Promise.all([listUserDatasets(), loadUserDatasetCollections()])
      setSummaries(nextSummaries)
      setCollections(nextCollections)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read uploaded datasets.')
    }
  }, [])

  useEffect(() => {
    // Initial load from IndexedDB; state updates land asynchronously after the reads resolve.
    const frame = requestAnimationFrame(() => void refresh())
    return () => cancelAnimationFrame(frame)
  }, [refresh])

  const uploadDataset = useCallback(
    async (file: File, label: string): Promise<UserDatasetUploadResult> => {
      const parsed = await parseUserDatasetFile(file)
      const record = {
        id: createUserDatasetId(),
        label: label.trim() || file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        format: parsed.format,
        createdAt: new Date().toISOString(),
        featureCount: parsed.featureCount,
        propertyKeys: parsed.propertyKeys,
        collection: parsed.collection,
      }
      await saveUserDataset(record)
      await refresh()
      const summary: UserDatasetSummary = {
        id: record.id,
        label: record.label,
        fileName: record.fileName,
        format: record.format,
        createdAt: record.createdAt,
        featureCount: record.featureCount,
        propertyKeys: record.propertyKeys,
      }
      return { summary, warnings: parsed.warnings }
    },
    [refresh],
  )

  const removeDataset = useCallback(
    async (id: string) => {
      await deleteUserDataset(id)
      await refresh()
    },
    [refresh],
  )

  const profiles = useMemo<Record<string, DatasetProfile>>(
    () =>
      Object.fromEntries(
        Object.entries(collections).map(([sourceId, collection]) => [sourceId, profileFeatureCollection(collection)]),
      ),
    [collections],
  )

  const sourceIdFor = useCallback((datasetId: string) => userDatasetSourceId(datasetId), [])

  return { summaries, collections, profiles, error, uploadDataset, removeDataset, sourceIdFor }
}

export type UserDatasetsApi = ReturnType<typeof useUserDatasets>
