import { useEffect, useRef, useState } from 'react'
import { canFinishSketch, sketchPolygon, type LngLat } from '@/lib/geo/mapSketch'
import { polygonAreaM2 } from '../mapNotes'
import { isPlanToolKey } from '../PlanTools'
import type { ContextFeature } from '../types'
import type { AreaDrawing } from './Sentinel2AreaSeries'
import type { SentinelArea } from './useSentinelAreaSeries'

/** A cutblock (or any polygon feature on the plan) as the series' area. */
export function areaFromFeature(feature: Pick<ContextFeature, 'id' | 'name' | 'geometry'>): SentinelArea | null {
  if (feature.geometry.type !== 'Polygon') return null
  return {
    id: `feature:${feature.id}`,
    name: feature.name || 'Cutblock',
    geometry: feature.geometry,
    areaHa: polygonAreaM2(feature.geometry) / 10_000,
  }
}

let drawn = 0

/**
 * The plan's sketch for a Sentinel-2 area: the page keeps the draft and renders `MapSketchDraft`
 * with `add` and `finish`, and its own clicks stand aside while `draft` is set. Escape cancels,
 * Backspace takes the last point back and Enter closes, as the measure tool's keys do.
 */
export function useSentinelAreaDrawing({
  canStart,
  onArea,
}: {
  canStart: boolean
  onArea: (area: SentinelArea) => void
}) {
  const [draft, setDraft] = useState<LngLat[] | null>(null)
  const finishRef = useRef(() => {})
  const finish = () => {
    const geometry = draft ? sketchPolygon(draft) : null
    if (!geometry || !canFinishSketch('polygon', draft!)) return
    drawn += 1
    onArea({ id: `drawn:${drawn}`, name: 'Drawn area', geometry, areaHa: polygonAreaM2(geometry) / 10_000 })
    setDraft(null)
  }
  useEffect(() => {
    finishRef.current = finish
  })
  const active = draft !== null
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (!isPlanToolKey(event)) return
      if (event.key === 'Escape') setDraft(null)
      else if (event.key === 'Backspace') setDraft((points) => (points ? points.slice(0, -1) : points))
      else if (event.key === 'Enter') finishRef.current()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
  const drawing: AreaDrawing = {
    active,
    canStart,
    points: draft?.length ?? 0,
    start: () => setDraft([]),
    cancel: () => setDraft(null),
  }
  return {
    draft,
    add: (point: LngLat) => setDraft((points) => (points ? [...points, point] : points)),
    finish,
    drawing,
  }
}
