import { useFetchData } from '@/hooks/useFetchData'
import type { CensusCategoryData, CensusHierarchyLevel } from '../types'

/**
 * Fetches census variable data for a specific category and geographic level.
 * useFetchData's module-level cache makes switching back to a previously
 * loaded category instant, and keys requests by URL so a slow response for an
 * abandoned category cannot land over the current one.
 */
export function useCensusVariableData(level: CensusHierarchyLevel, categoryId: string | null) {
  return useFetchData<CensusCategoryData>(
    categoryId ? `/data/census/variables/${level}/${categoryId}.json` : null,
  )
}

/**
 * Given category data and a vector ID, returns a map of GeoUID -> value.
 */
export function getVariableValues(
  categoryData: CensusCategoryData | null,
  variableId: string
): Map<string, number | null> {
  const result = new Map<string, number | null>()
  if (!categoryData) return result

  const vectorIndex = categoryData.vectors.indexOf(variableId)
  if (vectorIndex === -1) return result

  for (const [geoUid, values] of Object.entries(categoryData.data)) {
    result.set(geoUid, values[vectorIndex] ?? null)
  }

  return result
}
