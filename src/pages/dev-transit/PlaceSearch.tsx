import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { inside } from './state'
import type { Point, TransitData } from './types'

export function PlaceSearch({ data, onChoose }: { data: TransitData; onChoose: (point: Point) => void }) {
  const [query, setQuery] = useState('')
  const [addresses, setAddresses] = useState<{ id: string; name: string; point: Point }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const results = query.trim()
    ? [
        ...addresses,
        ...data.stops.filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(query.trim().toLowerCase())),
      ]
    : []
  async function searchAddress() {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)
    setError('')
    setAddresses([])
    try {
      const params = new URLSearchParams({
        addressString: `${query}, Prince George, BC`,
        maxResults: '5',
        outputSRS: '4326',
        autoComplete: 'true',
      })
      const response = await fetch(`https://geocoder.api.gov.bc.ca/addresses.json?${params}`, { signal: abort.signal })
      if (!response.ok) throw new Error(`Address search returned ${response.status}`)
      const body = (await response.json()) as {
        features?: { properties: { fullAddress: string }; geometry: { coordinates: Point } }[]
      }
      if (abort.signal.aborted) return
      const matches = (body.features ?? [])
        .filter((f) => inside(f.geometry.coordinates))
        .map((f, i) => ({ id: `address-${i}`, name: f.properties.fullAddress, point: f.geometry.coordinates }))
      if (!matches.length)
        setError('No address match in Prince George. Try a street number and name, or select a stop.')
      setAddresses(matches)
    } catch (err) {
      if (!abort.signal.aborted)
        setError(err instanceof Error ? err.message : 'Address search unavailable. Stop search still works.')
    } finally {
      if (!abort.signal.aborted) setLoading(false)
    }
  }
  return (
    <div className="space-y-2">
      <SearchInput
        icon
        aria-label="Search stops or addresses"
        placeholder="Stop, stop number or street address"
        value={query}
        onChange={(e) => {
          controller.current?.abort()
          setLoading(false)
          setQuery(e.target.value)
          setAddresses([])
          setError('')
        }}
        onClear={() => {
          controller.current?.abort()
          setLoading(false)
          setQuery('')
          setAddresses([])
          setError('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) void searchAddress()
        }}
      />
      {query.trim() && (
        <Button variant="outline" size="sm" className="w-full" disabled={loading} onClick={() => void searchAddress()}>
          {loading ? 'Searching addresses…' : 'Search BC addresses'}
        </Button>
      )}
      {error && <InlineAlert tone="warning">{error}</InlineAlert>}
      {query.trim() && (
        <>
          <p className="text-xs text-muted-foreground">{results.length} matches · choose to place the selected point</p>
          <VirtualResultList items={results} getKey={(s) => s.id} estimateSize={60} label="Place search results">
            {(stop) => (
              <ResultRow
                title={stop.name}
                subtitle={stop.id.startsWith('address-') ? 'BC Address Geocoder' : `Stop ${stop.id}`}
                onClick={() => {
                  onChoose(stop.point)
                  setQuery('')
                  setAddresses([])
                }}
              />
            )}
          </VirtualResultList>
        </>
      )}
    </div>
  )
}
