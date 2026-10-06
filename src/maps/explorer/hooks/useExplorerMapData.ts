import { useMemo } from 'react'
import { createExplorerMapDataBuilder } from '../explorerData'
import type { ExplorerDatasetId, ExplorerGeometryType, ExplorerItem } from '../types'

/** Preserve map sources when only list order or other datasets change. */
export function useExplorerMapData(
  filteredItems: ExplorerItem[],
  datasetSet: Set<ExplorerDatasetId>,
  geometrySet: Set<ExplorerGeometryType>,
) {
  const build = useMemo(() => createExplorerMapDataBuilder(), [])
  return useMemo(() => build(filteredItems, datasetSet, geometrySet), [build, filteredItems, datasetSet, geometrySet])
}
