import { useEffect, useRef, useState } from 'react'
import type { CensusCategoryData, CensusHierarchyLevel } from '../types'

const dataCache = new Map<string, CensusCategoryData>()

function cacheKey(level: CensusHierarchyLevel, categoryId: string): string {
  return `${level}:${categoryId}`
}

/**
 * Fetches census variable data for a specific category and geographic level.
 * Results are cached globally so switching back to a previously loaded category is instant.
 */
export function useCensusVariableData(level: CensusHierarchyLevel, categoryId: string | null) {
  const [data, setData] = useState<CensusCategoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequestRef = useRef<string | null>(null)

  useEffect(() => {
    if (!categoryId) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const key = cacheKey(level, categoryId)
    activeRequestRef.current = key

    const cached = dataCache.get(key)
    if (cached) {
      setData(cached)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const url = `/data/census/variables/${level}/${categoryId}.json`
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to load ${categoryId} data (${response.status})`)
        const result = await response.json() as CensusCategoryData
        dataCache.set(key, result)
        if (activeRequestRef.current === key) {
          setData(result)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        if (activeRequestRef.current === key) {
          setError((err as Error).message || 'Unable to load variable data')
        }
      } finally {
        if (activeRequestRef.current === key) {
          setLoading(false)
        }
      }
    }

    load()
    return () => controller.abort()
  }, [level, categoryId])

  return { data, loading, error }
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
