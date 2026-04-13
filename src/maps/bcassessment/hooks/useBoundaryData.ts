import { useEffect, useState } from 'react'
import type { BoundaryLevel } from '../types'

const BOUNDARY_FILES: Record<Exclude<BoundaryLevel, 'none'>, string> = {
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json',
  db: '/data/census/prince_george_db.geo.json',
}

export function useBoundaryData(level: BoundaryLevel) {
  const [data, setData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (level === 'none') {
      setData(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    fetch(BOUNDARY_FILES[level], { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed: ${res.status}`)
        return res.json()
      })
      .then((geojson: GeoJSON.FeatureCollection) => {
        setData(geojson)
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load boundary data:', err)
          setData(null)
        }
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [level])

  return { boundaryData: data, boundaryLoading: loading }
}
