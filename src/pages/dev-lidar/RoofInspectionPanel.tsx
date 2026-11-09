import { useEffect, useRef, useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { roofInspections, roofSnapshot, type RoofFeature, type RoofInspection } from './roofInspection'

const LOADING = 'Loading roof candidates…'

export function RoofInspectionPanel({
  analysisBase,
  sourceHash,
  active,
  onView,
}: {
  analysisBase: string
  sourceHash: string
  active: boolean
  onView: (feature: RoofFeature, mode: '2d' | '3d', inspection: RoofInspection | null) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [candidates, setCandidates] = useState<RoofFeature[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState(LOADING)
  const [verified, setVerified] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)
    let mounted = true
    fetch(new URL('building-candidates.geojson', analysisBase), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Roof candidates unavailable')
        const bytes = await response.arrayBuffer()
        const collection = JSON.parse(new TextDecoder().decode(bytes)) as { features: RoofFeature[] }
        if (!Array.isArray(collection.features)) throw Error('Invalid candidate data')
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
        if (!mounted) return
        setCandidates(collection.features.slice().sort((a, b) => b.properties.area_m2 - a.properties.area_m2))
        const matches =
          hash === roofSnapshot.input_sha256['building-candidates.geojson'] && sourceHash === roofSnapshot.source_sha256
        setVerified(matches)
        setStatus(
          matches
            ? ''
            : 'Detailed inspection snapshot does not match this data version. Only original candidate attributes are shown.',
        )
      })
      .catch(() => {
        if (mounted) setStatus('Roof candidates could not load. Retry to inspect them.')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      mounted = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [analysisBase, sourceHash, attempt])
  const selected = candidates.find((feature) => feature.properties.id === selectedId) ?? candidates[0]
  const record = selected && verified ? (roofInspections.get(selected.properties.id) ?? null) : null
  return (
    <div ref={root}>
      <SidebarSection
        title="Building screening"
        subtitle={`${candidates.length || '…'} roof-like patches · not a building count`}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          Select a patch, inspect it on imagery, then focus the original 3D points. Heights, area and plane fits do not
          establish that it is a building.
        </p>
        {status && (
          <div role={candidates.length || status === LOADING ? 'status' : undefined} className="mt-2">
            <InlineAlert
              loading={status === LOADING}
              tone={status === LOADING ? 'info' : candidates.length ? 'warning' : 'error'}
            >
              {status}
            </InlineAlert>
          </div>
        )}
        {!candidates.length && (
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        )}
      </SidebarSection>
      {selected && (
        <SidebarSection title={selected.properties.id}>
          <StatGroup
            variant="tiles"
            size="sm"
            columns={2}
            items={[
              { label: 'Plan area', value: `${selected.properties.area_m2.toFixed(0)} m²` },
              { label: 'Candidate median height', value: `${selected.properties.height_m.toFixed(1)} m` },
              ...(record
                ? [
                    { label: 'Height P95 · sampled patch', value: `${record.height_p95_m.toFixed(1)} m` },
                    { label: 'Ground-support P95', value: `${record.ground_support_p95_m.toFixed(1)} m` },
                    {
                      label: 'Whole-patch plane pitch',
                      value: `${record.plane?.pitch_deg.toFixed(1) ?? 'Unknown'}°`,
                    },
                    { label: 'Plane fit RMSE', value: `${record.plane?.plane_rmse_m.toFixed(2) ?? 'Unknown'} m` },
                  ]
                : []),
            ]}
          />
          {record?.plane && (
            <p className="mt-2 text-3xs leading-4 text-muted-foreground">
              {record.plane.plane_rmse_m > 0.3
                ? 'Single-plane fit is poor: this may span several roof facets, vegetation or mixed objects. Do not interpret the pitch as a measured roof facet.'
                : 'This patch is consistent with one plane at this grid resolution. That does not confirm a roof or establish survey accuracy.'}{' '}
              Down-slope aspect:{' '}
              {record.plane.downslope_aspect_deg === null
                ? 'undefined for near-flat fit'
                : `${record.plane.downslope_aspect_deg.toFixed(0)}° from north`}
              .
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onView(selected, '2d', record)}>
              Imagery
            </Button>
            <Button size="sm" onClick={() => onView(selected, '3d', record)}>
              Focus 3D points
            </Button>
          </div>
          {record && active && (
            <>
              <h3 className="mt-4 text-xs font-medium">Terrain / surface cross-section</h3>
              <div
                className="mt-2 h-[165px] w-full min-w-0"
                role="img"
                aria-label="Sampled ground and surface elevation across selected roof patch"
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={record.profile} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <XAxis
                      dataKey="distance_m"
                      type="number"
                      tick={{ fontSize: 9 }}
                      tickFormatter={(value: number) => `${value.toFixed(0)}m`}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(value: number) => value.toFixed(0)}
                    />
                    <Tooltip
                      formatter={(value) => (typeof value === 'number' ? `${value.toFixed(2)} m` : 'No sample')}
                      labelFormatter={(value) => `Distance ${Number(value).toFixed(1)} m`}
                      contentStyle={{
                        fontSize: 11,
                        background: 'hsl(var(--background))',
                        color: 'hsl(var(--foreground))',
                      }}
                    />
                    <Line
                      dataKey="surface_m"
                      name="Surface DSM"
                      stroke="#d97706"
                      strokeWidth={1.6}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="terrain_m"
                      name="Ground DTM"
                      stroke="#059669"
                      strokeWidth={1.6}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-3xs leading-4 text-muted-foreground">
                Amber: surface; green: ground. Elevation in metres CGVD2013. Nearest 1 m grid samples along the patch's
                long axis plus 6 m at each end; nearby trees may appear. Gaps stay missing.
              </p>
            </>
          )}
        </SidebarSection>
      )}
      <SidebarSection title="All patches · largest first" className="pb-0">
        <p className="text-3xs text-muted-foreground">Select a row to inspect its measurements and profile.</p>
      </SidebarSection>
      <VirtualResultList
        items={candidates}
        getKey={(feature) => feature.properties.id}
        estimateSize={56}
        label="All roof candidate patches"
      >
        {(feature) => (
          <ResultRow
            title={feature.properties.id}
            subtitle={`${feature.properties.area_m2.toFixed(0)} m² · ${feature.properties.height_m.toFixed(1)} m above ground`}
            selected={selected?.properties.id === feature.properties.id}
            accent="amber"
            onClick={() => {
              setSelectedId(feature.properties.id)
              root.current?.closest<HTMLElement>('[data-map-sidebar-scroll]')?.scrollTo({ top: 0 })
            }}
          />
        )}
      </VirtualResultList>
    </div>
  )
}
