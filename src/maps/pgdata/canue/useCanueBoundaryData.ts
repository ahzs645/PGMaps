import { useEffect, useState } from 'react'
import { buildBoundaryIndex } from './boundaries'
import { CANUE_BOUNDARY_CONFIG, CANUE_INVALID_NUMERIC_VALUES } from './constants'
import { fetchGzipText } from '@/lib/fetchJson'
import { splitCsvLine } from '@/lib/parseCsv'
import { findCanueVariablesForFile, getCanuePeriodLabel } from './variables'
import type {
  BoundaryFeatureCollection,
  CanueBoundaryLevel,
  CanueBoundaryResult,
  CanueFile,
  CanuePostalMembership,
  CanueYearMode,
} from './types'

export function useCanueBoundaryData(
  files: CanueFile[],
  variable: string | null,
  boundaries: BoundaryFeatureCollection | null,
  boundaryLevel: CanueBoundaryLevel,
  membership: CanuePostalMembership | null,
  yearMode: CanueYearMode,
  month: number | null,
): CanueBoundaryResult {
  const [result, setResult] = useState<CanueBoundaryResult>({
    data: { type: 'FeatureCollection', features: [] },
    loading: false,
    error: null,
    minValue: null,
    maxValue: null,
    validBoundaryCount: 0,
    matchedRowCount: 0,
  })

  useEffect(() => {
    if (!files.length || !variable || !boundaries || !membership) {
      setResult({
        data: { type: 'FeatureCollection', features: [] },
        loading: false,
        error: null,
        minValue: null,
        maxValue: null,
        validBoundaryCount: 0,
        matchedRowCount: 0,
      })
      return
    }

    const controller = new AbortController()
    const activeFiles = files
    const activeBoundaries = boundaries
    const activeMembership = membership
    const activeBoundaryLevel = boundaryLevel
    const boundaryConfig = CANUE_BOUNDARY_CONFIG[boundaryLevel]
    const activeVariable = variable
    const activeMonth = month

    async function load() {
      setResult((current) => ({ ...current, loading: true, error: null }))

      try {
        const usableBoundaries: BoundaryFeatureCollection = {
          type: 'FeatureCollection',
          features: activeBoundaries.features.filter((feature) => feature.geometry),
        }
        const boundaryIndex = buildBoundaryIndex(usableBoundaries, boundaryConfig)
        const buckets = new Map(
          boundaryIndex.map((boundary) => [
            boundary.id,
            {
              boundary,
              rowCount: 0,
              sum: 0,
              count: 0,
              min: null as number | null,
              max: null as number | null,
              years: new Map<number, { sum: number; count: number }>(),
            },
          ]),
        )
        const membershipByPostalCode = new Map(
          activeMembership.records.map((record) => [record.postalcode, record.boundaries[activeBoundaryLevel] ?? '']),
        )
        let matchedRowCount = 0

        for (const activeFile of activeFiles) {
          const fileVariables = findCanueVariablesForFile(
            activeFile,
            activeVariable,
            activeFile.cadence === 'monthly' && yearMode === 'month' ? activeMonth : null,
          )
          if (!fileVariables.length)
            throw new Error(`${activeFile.label} ${activeFile.year} is missing ${activeVariable}`)

          const text = await fetchGzipText(activeFile.output, controller.signal)
          const lines = text.split(/\r?\n/)
          const headers = splitCsvLine(lines[0] ?? '')
          const postalIndex = headers.indexOf('postalcode')
          const variableIndexes = fileVariables.map((fileVariable) => headers.indexOf(fileVariable))

          if (postalIndex < 0 || variableIndexes.some((variableIndex) => variableIndex < 0)) {
            throw new Error(`CANUE file is missing postalcode or ${fileVariables.join(', ')}`)
          }

          for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex]
            if (!line) continue
            const values = splitCsvLine(line)
            const boundaryId = membershipByPostalCode.get(
              String(values[postalIndex] || '')
                .replace(/\s+/g, '')
                .toUpperCase(),
            )
            if (!boundaryId) continue
            const bucket = buckets.get(boundaryId)
            if (!bucket) continue
            bucket.rowCount += 1
            matchedRowCount += 1

            for (const variableIndex of variableIndexes) {
              const value = Number(values[variableIndex])
              if (!Number.isFinite(value) || CANUE_INVALID_NUMERIC_VALUES.has(value)) continue
              bucket.sum += value
              bucket.count += 1
              bucket.min = bucket.min == null ? value : Math.min(bucket.min, value)
              bucket.max = bucket.max == null ? value : Math.max(bucket.max, value)
              const yearBucket = bucket.years.get(activeFile.year) ?? { sum: 0, count: 0 }
              yearBucket.sum += value
              yearBucket.count += 1
              bucket.years.set(activeFile.year, yearBucket)
            }
          }
        }

        let minValue: number | null = null
        let maxValue: number | null = null
        let validBoundaryCount = 0

        const features = usableBoundaries.features.map((feature, index) => {
          const boundary = boundaryIndex[index]
          const bucket = buckets.get(boundary.id)
          const yearlyMeans = bucket
            ? Array.from(bucket.years.values())
                .filter((yearBucket) => yearBucket.count > 0)
                .map((yearBucket) => yearBucket.sum / yearBucket.count)
            : []
          const value =
            bucket && bucket.count > 0
              ? activeFiles.length > 1 && yearlyMeans.length > 0
                ? yearlyMeans.reduce((sum, yearMean) => sum + yearMean, 0) / yearlyMeans.length
                : bucket.sum / bucket.count
              : null

          return {
            ...feature,
            id: boundary.id,
            properties: {
              ...feature.properties,
              boundaryId: boundary.id,
              boundaryName: boundary.name,
              datasetId: activeFiles[0]?.datasetId,
              datasetLabel: activeFiles[0]?.label,
              category: activeFiles[0]?.category,
              year: activeFiles.length === 1 ? activeFiles[0].year : null,
              yearMode,
              yearLabel: getCanuePeriodLabel(activeFiles, yearMode, activeMonth),
              rowCount: bucket?.rowCount ?? 0,
              [activeVariable]: value,
              [`${activeVariable}_count`]: bucket?.count ?? 0,
              [`${activeVariable}_min`]: bucket?.min ?? null,
              [`${activeVariable}_max`]: bucket?.max ?? null,
            },
          }
        })

        const data: BoundaryFeatureCollection = {
          type: 'FeatureCollection',
          features,
        }

        for (const feature of data.features) {
          const value = Number(feature.properties?.[activeVariable])
          if (!Number.isFinite(value)) continue
          validBoundaryCount += 1
          minValue = minValue == null ? value : Math.min(minValue, value)
          maxValue = maxValue == null ? value : Math.max(maxValue, value)
        }

        setResult({
          data,
          loading: false,
          error: null,
          minValue,
          maxValue,
          validBoundaryCount,
          matchedRowCount,
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setResult({
          data: { type: 'FeatureCollection', features: [] },
          loading: false,
          error: (err as Error).message || 'Unable to load CANUE boundary data',
          minValue: null,
          maxValue: null,
          validBoundaryCount: 0,
          matchedRowCount: 0,
        })
      }
    }

    void load()
    return () => controller.abort()
  }, [boundaries, boundaryLevel, files, membership, month, variable, yearMode])

  return result
}
