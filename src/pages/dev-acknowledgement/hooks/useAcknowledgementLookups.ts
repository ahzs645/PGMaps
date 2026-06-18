import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { buildCandidatesFromLookups } from '../candidates'
import { INDIGENOUS_MANIFEST_DATA, initialLookupState } from '../data'
import { geocodeAddress, locationFromCoordinates } from '../geocode'
import {
  loadRelationshipGraph,
  localVerifiedMatches,
  matchBoundaryRelationshipPlace,
  matchRelationshipPlace,
  queryNativeLandSource,
  queryReserveSource,
  queryTreatySources,
  relationshipMatches,
} from '../spatial'
import type {
  DroppedLocation,
  GeocodeResult,
  GeocodeStatus,
  IndigenousManifest,
  MatchedRelationshipPlace,
  MatchType,
  RelationshipGraph,
  SourceKey,
  SourceLookupState,
} from '../types'

/**
 * Owns the geocode → source-comparison pipeline: geocoding the address, loading
 * the Indigenous manifest and relationship graph, and running every spatial
 * source lookup into `sourceLookups` / `candidates`. The page supplies the
 * `enabledMatchTypes` filter and consumes the results for selection + wording.
 */
export function useAcknowledgementLookups(
  initialAddress: string,
  enabledMatchTypes: Record<MatchType, boolean>,
) {
  const [address, setAddress] = useState(initialAddress)
  const [geocodeResult, setGeocodeResult] = useState<GeocodeResult | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus>('idle')
  const [geocodeError, setGeocodeError] = useState<string | null>(null)
  const [indigenousManifest, setIndigenousManifest] = useState<IndigenousManifest | null>(null)
  const [relationshipGraph, setRelationshipGraph] = useState<RelationshipGraph | null>(null)
  const [matchedRelationshipPlace, setMatchedRelationshipPlace] = useState<MatchedRelationshipPlace | null>(null)
  const [sourceLookups, setSourceLookups] = useState<Record<SourceKey, SourceLookupState>>(initialLookupState)

  const candidates = useMemo(() => buildCandidatesFromLookups(sourceLookups, relationshipGraph), [sourceLookups, relationshipGraph])

  const runSourceLookups = useCallback(async (result: GeocodeResult, matchTypes = enabledMatchTypes, addressForMatch = address) => {
    const controller = new AbortController()
    setSourceLookups({
      verified: { status: 'loading', matches: [] },
      nativeLand: { status: 'loading', matches: [] },
      treaty: { status: 'loading', matches: [] },
      reserve: { status: 'loading', matches: [] },
      local: { status: 'loading', matches: [] },
      cad: initialLookupState.cad,
    })
    setMatchedRelationshipPlace(null)

    const settle = (source: SourceKey, state: SourceLookupState) => {
      setSourceLookups((current) => ({ ...current, [source]: state }))
    }

    loadRelationshipGraph()
      .then(async (graph) => {
        setRelationshipGraph(graph)
        const match = matchRelationshipPlace(graph, result, addressForMatch, matchTypes)
          ?? (matchTypes.boundary ? await matchBoundaryRelationshipPlace(graph, result) : null)
        setMatchedRelationshipPlace(match)
        settle('verified', {
          status: 'success',
          matches: match ? relationshipMatches(graph, match) : [],
          message: match ? `Matched ${match.place.name}` : 'No curated place or boundary relationship matched this address.',
        })
      })
      .catch((error: unknown) => settle('verified', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Relationship graph lookup failed.',
      }))

    queryNativeLandSource(result.latitude, result.longitude, controller.signal)
      .then((matches) => settle('nativeLand', { status: 'success', matches, message: matches.length ? undefined : 'No Native Land Digital overlaps returned.' }))
      .catch((error: unknown) => settle('nativeLand', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Native Land Digital lookup failed.',
      }))

    queryTreatySources(result.latitude, result.longitude)
      .then((matches) => settle('treaty', { status: 'success', matches, message: matches.length ? undefined : 'No treaty land or treaty area intersection at this point.' }))
      .catch((error: unknown) => settle('treaty', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Treaty layer lookup failed.',
      }))

    queryReserveSource(result.latitude, result.longitude)
      .then((matches) => settle('reserve', { status: 'success', matches, message: matches.length ? undefined : 'No reserve boundary intersection at this point.' }))
      .catch((error: unknown) => settle('reserve', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Reserve layer lookup failed.',
      }))

    localVerifiedMatches(result)
      .then((matches) => settle('local', { status: 'success', matches, message: matches.length ? undefined : 'No First Nation community within range of this point.' }))
      .catch((error: unknown) => settle('local', {
        status: 'error',
        matches: [],
        message: error instanceof Error ? error.message : 'Community reference lookup failed.',
      }))
  }, [address, enabledMatchTypes])

  useEffect(() => {
    let cancelled = false
    fetch(INDIGENOUS_MANIFEST_DATA)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load Indigenous manifest (${response.status})`)
        return response.json() as Promise<IndigenousManifest>
      })
      .then((manifest) => {
        if (!cancelled) setIndigenousManifest(manifest)
      })
      .catch(() => {
        if (!cancelled) setIndigenousManifest(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadRelationshipGraph()
      .then((graph) => {
        if (!cancelled) setRelationshipGraph(graph)
      })
      .catch(() => {
        if (!cancelled) setRelationshipGraph(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setGeocodeStatus('loading')
    setGeocodeError(null)
    geocodeAddress(address, controller.signal)
      .then((result) => {
        setGeocodeResult(result)
        setGeocodeStatus('success')
        void runSourceLookups(result)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setGeocodeResult(null)
        setGeocodeStatus('error')
        setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
      })
    return () => controller.abort()
    // Run once to populate the default sample address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const geocodeAddressInput = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setGeocodeStatus('error')
      setGeocodeError('Enter a B.C. address to geocode')
      setGeocodeResult(null)
      return
    }

    setGeocodeStatus('loading')
    setGeocodeError(null)
    try {
      const result = await geocodeAddress(trimmedAddress)
      setGeocodeResult(result)
      setGeocodeStatus('success')
      void runSourceLookups(result, enabledMatchTypes, trimmedAddress)
    } catch (error) {
      setGeocodeResult(null)
      setGeocodeStatus('error')
      setGeocodeError(error instanceof Error ? error.message : 'Unable to geocode this address')
    }
  }

  const dropLocation = useCallback((location: DroppedLocation) => {
    const result = locationFromCoordinates(location)
    setGeocodeResult(result)
    setGeocodeStatus('success')
    setGeocodeError(null)
    setAddress(result.fullAddress)
    void runSourceLookups(result, enabledMatchTypes, result.fullAddress)
  }, [enabledMatchTypes, runSourceLookups])

  return {
    address,
    setAddress,
    geocodeResult,
    geocodeStatus,
    geocodeError,
    indigenousManifest,
    relationshipGraph,
    matchedRelationshipPlace,
    sourceLookups,
    candidates,
    runSourceLookups,
    geocodeAddressInput,
    dropLocation,
  }
}
