import { useEffect, useState } from 'react'
import { X, MapPin, UtensilsCrossed, Trees, Wind, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NearbyItem {
  name: string
  distance: number
  detail?: string
}

interface ReportData {
  restaurants: { total: number; nearest: NearbyItem[]; lowCount: number; moderateCount: number }
  parks: { total: number; nearest: NearbyItem[] }
  airMonitors: { total: number; nearest: NearbyItem[] }
  loading: boolean
}

interface NeighborhoodReportProps {
  lat: number
  lng: number
  onClose: () => void
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function NeighborhoodReport({ lat, lng, onClose }: NeighborhoodReportProps) {
  const [data, setData] = useState<ReportData>({
    restaurants: { total: 0, nearest: [], lowCount: 0, moderateCount: 0 },
    parks: { total: 0, nearest: [] },
    airMonitors: { total: 0, nearest: [] },
    loading: true,
  })

  useEffect(() => {
    const base = import.meta.env.BASE_URL
    let cancelled = false

    async function load() {
      const results: Partial<ReportData> = {}

      // Restaurants
      try {
        const res = await fetch(`${base}data/restaurants.json`)
        if (res.ok) {
          const restaurants = await res.json()
          const withDist = restaurants
            .filter((r: { latitude: number; longitude: number }) => r.latitude && r.longitude)
            .map((r: { name: string; latitude: number; longitude: number; current_hazard_rating?: string; hazard_rating?: string }) => ({
              name: r.name,
              distance: haversineKm(lat, lng, r.latitude, r.longitude),
              hazard: r.current_hazard_rating || r.hazard_rating || 'Unknown',
            }))
            .sort((a: { distance: number }, b: { distance: number }) => a.distance - b.distance)

          const within2km = withDist.filter((r: { distance: number }) => r.distance <= 2)
          results.restaurants = {
            total: within2km.length,
            nearest: withDist.slice(0, 5).map((r: { name: string; distance: number; hazard: string }) => ({
              name: r.name,
              distance: r.distance,
              detail: r.hazard,
            })),
            lowCount: within2km.filter((r: { hazard: string }) => r.hazard === 'Low').length,
            moderateCount: within2km.filter((r: { hazard: string }) => r.hazard === 'Moderate').length,
          }
        }
      } catch { /* skip */ }

      // Parks
      try {
        const res = await fetch(`${base}data/parks.json`)
        if (res.ok) {
          const fc = await res.json()
          const features = fc.features || []
          const withDist: NearbyItem[] = []
          for (const f of features) {
            const name = f.properties?.PARK_NAME || f.properties?.name || 'Park'
            const coords = f.geometry?.coordinates?.[0]?.[0]
            if (!coords) continue
            withDist.push({
              name,
              distance: haversineKm(lat, lng, coords[1], coords[0]),
              detail: f.properties?.CLASSIFICATION,
            })
          }
          withDist.sort((a, b) => a.distance - b.distance)

          results.parks = {
            total: withDist.filter((p) => p.distance <= 3).length,
            nearest: withDist.slice(0, 5),
          }
        }
      } catch { /* skip */ }

      // Air monitors
      try {
        const res = await fetch(`${base}data/monitors.csv`)
        if (res.ok) {
          const text = await res.text()
          const lines = text.split('\n').slice(1)
          const monitorItems: NearbyItem[] = []
          for (const line of lines) {
            const parts = line.split(',')
            const monLat = parseFloat(parts[2])
            const monLng = parseFloat(parts[3])
            if (!Number.isFinite(monLat) || !Number.isFinite(monLng)) continue
            monitorItems.push({
              name: parts[1] || parts[0] || 'Monitor',
              distance: haversineKm(lat, lng, monLat, monLng),
              detail: parts[4] || '',
            })
          }
          monitorItems.sort((a, b) => a.distance - b.distance)

          results.airMonitors = {
            total: monitorItems.filter((m) => m.distance <= 10).length,
            nearest: monitorItems.slice(0, 3),
          }
        }
      } catch { /* skip */ }

      if (!cancelled) {
        setData({
          restaurants: results.restaurants || { total: 0, nearest: [], lowCount: 0, moderateCount: 0 },
          parks: results.parks || { total: 0, nearest: [] },
          airMonitors: results.airMonitors || { total: 0, nearest: [] },
          loading: false,
        })
      }
    }

    load()
    return () => { cancelled = true }
  }, [lat, lng])

  return (
    <div className="absolute bottom-[calc(var(--map-mobile-sheet-visible-height,72px)+var(--map-legend-panel-visible-height,0px)+var(--map-timeline-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] left-4 z-30 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur md:bottom-6 md:left-auto md:right-72 md:w-80">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Neighborhood Report</h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-1 text-[11px] text-muted-foreground">
        {lat.toFixed(4)}, {lng.toFixed(4)}
      </div>

      {data.loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto p-4 pt-2">
          {/* Restaurants */}
          <ReportSection
            icon={UtensilsCrossed}
            iconColor="text-orange-500"
            title="Food Safety"
            stat={`${data.restaurants.total} within 2 km`}
            detail={`${data.restaurants.lowCount} Low / ${data.restaurants.moderateCount} Moderate`}
            items={data.restaurants.nearest}
          />

          {/* Parks */}
          <ReportSection
            icon={Trees}
            iconColor="text-green-500"
            title="Parks"
            stat={`${data.parks.total} within 3 km`}
            items={data.parks.nearest}
          />

          {/* Air Quality */}
          <ReportSection
            icon={Wind}
            iconColor="text-sky-500"
            title="Air Monitors"
            stat={`${data.airMonitors.total} within 10 km`}
            items={data.airMonitors.nearest}
          />
        </div>
      )}
    </div>
  )
}

function ReportSection({
  icon: Icon,
  iconColor,
  title,
  stat,
  detail,
  items,
}: {
  icon: React.ElementType
  iconColor: string
  title: string
  stat: string
  detail?: string
  items: NearbyItem[]
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        <span className="text-xs font-semibold text-foreground">{title}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{stat}</span>
      </div>
      {detail && <div className="ml-5 text-[10px] text-muted-foreground mb-1">{detail}</div>}
      <div className="ml-5 space-y-0.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-[11px]">
            <span className="truncate text-foreground">{item.name}</span>
            <span className="ml-2 shrink-0 text-muted-foreground">{item.distance.toFixed(1)} km</span>
          </div>
        ))}
      </div>
    </div>
  )
}
