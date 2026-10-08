import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isCityCoordinate, loadModel, readTrip, snapPoint, tripHash, type Family, type Model, type Place, type Trip, type Units } from './routing'
import { CITIES, type CityId } from './cities'
import { RoutingWorker } from './routing-worker'

export function useFlatten(cityId: CityId = 'sf') {
  const city = CITIES[cityId]
  const unitsKey = cityId === 'sf' ? 'flattensf.units' : 'flattenpg.units'
  const [trip, setTrip] = useState<Trip>(() => readTrip(window.location.hash, cityId))
  const [units, setUnits] = useState<Units>(() => {
    try { const saved = localStorage.getItem(unitsKey); return saved === 'km' || saved === 'mi' ? saved : city.defaultUnits } catch { return city.defaultUnits }
  })
  const [model, setModel] = useState<Model | null>(null)
  const [search, setSearch] = useState<{ key: string; family: Family | null; searching: boolean; error: string | null }>({ key: '', family: null, searching: false, error: null })
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [focus, setFocus] = useState<'from' | 'to'>('from')
  const [dragging, setDragging] = useState(false)
  const [fitRequest, setFitRequest] = useState(0)
  const routingWorker = useRef<RoutingWorker | null>(null)
  useEffect(() => {
    try { routingWorker.current = new RoutingWorker(cityId) }
    catch { setNotice('Could not start the routing worker. Reload to try again.') }
    return () => { routingWorker.current?.dispose(); routingWorker.current = null }
  }, [cityId])
  useEffect(() => {
    let active = true
    void loadModel(false, cityId).then((value) => { if (active) { setModel(value); setLoading(false) } }, (cause: unknown) => {
      if (active) { setNotice(cause instanceof Error ? cause.message : 'Could not load the street graph.'); setLoading(false) }
    })
    return () => { active = false }
  }, [retry, cityId])
  useEffect(() => {
    const read = () => setTrip(readTrip(window.location.hash, cityId))
    window.addEventListener('hashchange', read)
    window.addEventListener('popstate', read)
    return () => { window.removeEventListener('hashchange', read); window.removeEventListener('popstate', read) }
  }, [cityId])
  useEffect(() => {
    if (dragging) return
    const hash = tripHash(trip)
    if (hash && hash !== window.location.hash) history.replaceState(history.state, '', hash)
  }, [trip, dragging])
  useEffect(() => { try { localStorage.setItem(unitsKey, units) } catch { /* Device preferences are optional. */ } }, [units, unitsKey])

  const inputKey = JSON.stringify({ from: trip.from, to: trip.to, mode: trip.mode, calm: trip.calm, loop: trip.loop, outBack: trip.outBack, loopMi: trip.loopMi })
  const searchKey = `${dragging ? 'preview' : 'full'}:${inputKey}`
  const searchTrip = useMemo(() => JSON.parse(inputKey) as Trip, [inputKey])
  useEffect(() => {
    if (!model || !routingWorker.current) return
    const controller = new AbortController()
    void routingWorker.current.route(searchTrip, dragging, controller.signal, (partial) => {
      if (!controller.signal.aborted) { setSearch({ key: searchKey, family: partial, searching: true, error: null }); setNotice(null) }
    }).then((result) => {
      if (!controller.signal.aborted) { setSearch({ key: searchKey, family: result, searching: false, error: null }); setNotice(null) }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setSearch({ key: searchKey, family: null, searching: false, error: cause instanceof Error ? cause.message : 'Could not calculate a route.' })
    })
    return () => controller.abort()
  }, [model, searchTrip, searchKey, dragging])
  const setPoint = useCallback((which: 'from' | 'to', place: Place | null, reframe = false) => {
    if (!model) return
    if (place && !isCityCoordinate(place.lon, place.lat, cityId)) { setNotice(`Choose a point within ${city.name}.`); return }
    const point = place ? snapPoint(model, place, trip.mode) : null
    if (reframe) setFitRequest((value) => value + 1)
    setTrip((current) => {
      const previous = current[which]
      if (previous?.lon === point?.lon && previous?.lat === point?.lat && previous?.label === point?.label) return current
      return { ...current, [which]: point, loopIndex: 0 }
    })
  }, [model, trip.mode, cityId, city.name])
  // Keep the current line/profile mounted while its replacement is computed.
  const family = search.family
  const searching = !!model && (search.key !== searchKey || search.searching)
  const error = notice || (search.key === searchKey ? search.error : null)
  const memberIndex = family ? trip.loop
    ? Math.min(trip.loopIndex, family.members.length - 1)
    : Math.round(trip.t * (family.members.length - 1)) : 0
  const selected = family?.members[memberIndex] ?? null
  return { city, trip, setTrip, units, setUnits, model, family, selected, memberIndex, loading, searching, error, focus, setFocus, setPoint, dragging, setDragging, fitRequest, retry: () => { setLoading(true); setNotice(null); setRetry((value) => value + 1) } }
}
export type FlattenController = ReturnType<typeof useFlatten>
