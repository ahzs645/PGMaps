import { useMemo } from 'react'
import { getStudyAreaLevelLabel } from '@/lib/studyArea'
import type { Property, PropertyCategory, BoundaryLevel, BoundaryAggregate } from '../types'

/**
 * Groups filtered properties by their census boundary ID and computes
 * per-boundary averages, category breakdowns, and averaged history.
 */
export function useBoundaryAggregates(
  properties: Property[],
  boundaryLevel: BoundaryLevel,
): Map<string, BoundaryAggregate> {
  return useMemo(() => {
    const result = new globalThis.Map<string, BoundaryAggregate>()
    if (boundaryLevel === 'none') return result

    // Group properties by boundary ID
    const groups = new globalThis.Map<string, Property[]>()
    for (const prop of properties) {
      const bid = prop[boundaryLevel]
      if (!bid) continue
      let list = groups.get(bid)
      if (!list) {
        list = []
        groups.set(bid, list)
      }
      list.push(prop)
    }

    const label = getStudyAreaLevelLabel(boundaryLevel)

    for (const [bid, props] of groups) {
      const count = props.length
      let totalVal = 0
      let totalLand = 0
      let totalBldg = 0
      let totalYr = 0
      let yrCount = 0
      const catCounts: Partial<Record<PropertyCategory, number>> = {}

      // For averaging history: accumulate per-year totals
      const histSums: number[] = []
      let histCount = 0

      for (const p of props) {
        totalVal += p.totalAssessed
        totalLand += p.totalLand
        totalBldg += p.totalBuilding
        if (p.yearBuilt) {
          totalYr += p.yearBuilt
          yrCount++
        }
        catCounts[p.category] = (catCounts[p.category] || 0) + 1

        if (p.histValues && p.histValues.length > 0) {
          histCount++
          for (let i = 0; i < p.histValues.length; i++) {
            histSums[i] = (histSums[i] || 0) + p.histValues[i]
          }
        }
      }

      const avgHistory =
        histCount > 0
          ? histSums.map((s) => Math.round(s / histCount))
          : null

      result.set(bid, {
        boundaryId: bid,
        boundaryName: `${label} ${bid}`,
        count,
        avgAssessed: Math.round(totalVal / count),
        avgLand: Math.round(totalLand / count),
        avgBuilding: Math.round(totalBldg / count),
        avgYearBuilt: yrCount > 0 ? Math.round(totalYr / yrCount) : null,
        categoryCounts: catCounts,
        avgHistory,
      })
    }

    return result
  }, [properties, boundaryLevel])
}
