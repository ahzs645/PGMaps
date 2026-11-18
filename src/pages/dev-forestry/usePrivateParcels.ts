import { useCallback, useMemo, useState } from 'react'

import {
  fetchPrivateParcels,
  parcelMaskFields,
  privateParcelCandidateCollection,
  type PrivateParcel,
} from './parcelMapPrivateLand'
import type { AssessmentMask } from './types'
import { polygonBounds, type PolygonGeometry } from './visibility'
import { inventoryFetch } from '@/lib/offline/inventoryCopies'

/** Margin round the landform the parcels are looked up in, degrees (about 1 km). */
const SEARCH_MARGIN_DEGREES = 0.01

const NO_MASKS: ReadonlyArray<AssessmentMask> = []

export type PrivateParcelLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; parcels: PrivateParcel[]; truncated: boolean }

/**
 * ParcelMap BC's private parcels round the landform, shared by step 3's panel (`PrivateLandPanel`) and the plan
 * (`VisualQualityLayers`), with the parcels the reviewer has ticked to add. A tick is a selection, never a mask:
 * only the panel's Add writes one. Parcels already in the scene as private-land masks are no longer candidates.
 */
export function usePrivateParcels(
  landform: PolygonGeometry | null,
  sceneMasks: ReadonlyArray<AssessmentMask> | undefined,
) {
  const masks = sceneMasks ?? NO_MASKS
  const [lookup, setLookup] = useState<PrivateParcelLookup>({ status: 'idle' })
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())

  const find = useCallback(async () => {
    if (!landform) return
    const [w, s, e, n] = polygonBounds(landform)
    setLookup({ status: 'loading' })
    setTicked(new Set())
    try {
      const answer = await fetchPrivateParcels(
        [w - SEARCH_MARGIN_DEGREES, s - SEARCH_MARGIN_DEGREES, e + SEARCH_MARGIN_DEGREES, n + SEARCH_MARGIN_DEGREES],
        inventoryFetch,
      )
      setLookup({ status: 'ready', ...answer })
    } catch (error) {
      setLookup({ status: 'error', message: error instanceof Error ? error.message : 'ParcelMap BC did not answer.' })
    }
  }, [landform])

  const clear = useCallback(() => {
    setLookup({ status: 'idle' })
    setTicked(new Set())
  }, [])

  const addedSources = useMemo(
    () => new Set(masks.filter((mask) => mask.kind === 'private').map((mask) => mask.source)),
    [masks],
  )
  const candidates = useMemo(
    () =>
      lookup.status === 'ready'
        ? lookup.parcels.filter((parcel) => !addedSources.has(parcelMaskFields(parcel).source))
        : [],
    [lookup, addedSources],
  )
  // A parcel added (or no longer listed) drops out of the selection.
  const selected = useMemo(() => {
    const ids = new Set<string>()
    for (const parcel of candidates) if (ticked.has(parcel.id)) ids.add(parcel.id)
    return ids
  }, [candidates, ticked])

  const toggle = useCallback((id: string) => {
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const select = useCallback((ids: ReadonlyArray<string>) => setTicked(new Set(ids)), [])

  const collection = useMemo(() => privateParcelCandidateCollection(candidates, selected), [candidates, selected])

  return { lookup, find, clear, candidates, selected, toggle, select, collection }
}

export type PrivateParcels = ReturnType<typeof usePrivateParcels>
