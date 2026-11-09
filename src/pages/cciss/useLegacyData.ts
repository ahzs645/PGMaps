import { useEffect, useState } from 'react'
import type { LegacyManifest, LegacyReference, LegacyRegion } from './legacyAnalysis'
import type { LegacyPointSample } from './legacyComparison'
import { loadLegacyManifest, loadLegacyPoint, loadLegacyReference, loadLegacyRegion } from './legacyData'

export interface LegacyPointData {
  manifest: LegacyManifest
  reference: LegacyReference
  samples: LegacyPointSample[]
  /** The BC-wide regional summary; it supplies the site conditions and species the dataset covers. */
  summary?: LegacyRegion
  pointKey: string
}

type Keyed<T> = { key: string } & T

/**
 * The legacy dataset sampled at `point`, plus the regional summary chosen in `region`. A failed TIFF
 * read is an error with a retry, never a nodata cell; `retry` reloads both the point and the region.
 */
export function useLegacyData(point: [number, number], region: string) {
  const pointKey = point.join(',')
  const [data, setData] = useState<LegacyPointData | null>(null)
  const [progress, setProgress] = useState<Keyed<{ message: string }> | null>(null)
  const [error, setError] = useState<Keyed<{ message: string }> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [regional, setRegional] = useState<{ id: string; value?: LegacyRegion; error?: string } | null>(null)

  useEffect(() => {
    let active = true
    loadLegacyManifest()
      .then(async (manifest) => {
        const defaultRegion = manifest.regions.find((r) => r.id === 'BC') ?? manifest.regions[0]
        const [reference, summary, samples] = await Promise.all([
          loadLegacyReference(manifest.reference.file),
          defaultRegion ? loadLegacyRegion(defaultRegion.file) : Promise.resolve(undefined),
          loadLegacyPoint(manifest, point, (done) => {
            if (active)
              setProgress({ key: pointKey, message: `Reading numeric rasters: ${done} / ${manifest.rasters.length}` })
          }),
        ])
        if (active) {
          setData({ manifest, reference, samples, summary, pointKey })
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError({ key: pointKey, message: String(cause) })
      })
    return () => {
      active = false
    }
  }, [point, pointKey, attempt])

  const selectedRegion =
    data?.manifest.regions.find((r) => r.id === region) ??
    data?.manifest.regions.find((r) => r.id === 'BC') ??
    data?.manifest.regions[0]

  useEffect(() => {
    let active = true
    if (!selectedRegion) return
    loadLegacyRegion(selectedRegion.file)
      .then((value) => {
        if (active) setRegional({ id: selectedRegion.id, value })
      })
      .catch((cause: unknown) => {
        if (active) setRegional({ id: selectedRegion.id, error: String(cause) })
      })
    return () => {
      active = false
    }
  }, [selectedRegion, attempt])

  const regionId = selectedRegion?.id ?? ''
  const current = regional?.id === regionId ? regional : null
  return {
    pointKey,
    data,
    progress: progress?.key === pointKey ? progress.message : null,
    error: error?.key === pointKey ? error.message : null,
    retry: () => {
      setError(null)
      setAttempt((n) => n + 1)
    },
    selectedRegion,
    regionId,
    /** The chosen region's summary, `undefined` while it loads. */
    regionValue: current?.value,
    regionError: current?.error ?? '',
    regionLoading: Boolean(selectedRegion) && !current,
  }
}
