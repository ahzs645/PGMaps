import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, roadFieldClass } from './Controls'
import { nearestFsrConnections } from './fsrNetwork'
import { MAX_FSR_CHOICES, type FsrConnectionPreference } from './fsrConnections'
import { distance } from './engine'
import type { RouteSearchOptions } from './routing'
import type { SidebarProps } from './DesignSidebarBody'

const length = (metres: number) =>
  metres < 1000 ? `${Math.round(metres).toLocaleString('en-CA')} m` : `${(metres / 1000).toFixed(2)} km`

/** Discovery and choosing a destination are independent of generating a road. */
export function FsrConnectionControls({
  options,
  full,
  ...p
}: SidebarProps & { options: RouteSearchOptions; full: boolean }) {
  const [endpoint, setEndpoint] = useState<'start' | 'end'>('end')
  const [preference, setPreference] = useState<FsrConnectionPreference>('nearest')
  const [regional, setRegional] = useState(false)
  const [targetId, setTargetId] = useState('auto')
  const { alignment, project, source } = p.workspace
  const origin = (endpoint === 'start' ? alignment.points[0] : alignment.points.at(-1)!).coordinate
  const choices = nearestFsrConnections(origin, project.context, MAX_FSR_CHOICES)
  const selected = choices.find((target) => target.featureId === targetId)
  const road = selected ? project.context.find((feature) => feature.id === selected.featureId) : undefined
  const automatic = targetId === 'auto'
  const discovery =
    p.fsrDiscovery?.guide === alignment &&
    p.fsrDiscovery.source === source &&
    distance(p.fsrDiscovery.origin, origin) < 0.1
      ? p.fsrDiscovery
      : null
  const onPreview = p.onPreviewFsrTarget
  useEffect(() => () => onPreview?.(null, 'end'), [onPreview])
  useEffect(() => {
    onPreview?.(targetId === 'auto' ? null : targetId, endpoint)
  }, [onPreview, targetId, endpoint])
  const record = alignment.fsrConnection
  const junctionEdited =
    record &&
    (distance(alignment.points[0].coordinate, record.originCoordinate) > 0.1 ||
      distance(alignment.points.at(-1)!.coordinate, record.targetCoordinate) > 0.1)
  return (
    <div className="space-y-2 border-t pt-3" data-testid="road-fsr-connection">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Connect to a Forest Service Road</p>
        <InfoTip label="About FSR connections">
          Find nearby mapped FSR sections, then choose one by name and straight-line distance. Automatic selection
          screens up to three targets. A chosen FSR is the only destination searched; failure leaves your road
          unchanged. This creates a preliminary terrain-cost alignment, without fitting final curves or designing a
          formation profile. Its search score is not a complete access cost. Final geometry, prism clearances,
          directional loaded grades, road access and material haul must pass the complete comparison before adoption.
        </InfoTip>
      </div>
      <Field label="Connect from">
        <select
          className={roadFieldClass}
          value={endpoint}
          onChange={(event) => {
            const next = event.target.value as 'start' | 'end'
            setEndpoint(next)
            setTargetId('auto')
            onPreview?.(null, next)
          }}
        >
          <option value="end">Road end</option>
          <option value="start">Road start</option>
        </select>
      </Field>
      {p.onDiscoverFsrs && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => p.onDiscoverFsrs?.(endpoint)}>
          Find nearby FSRs
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground" role="status">
        {choices.length} nearby mapped FSR section{choices.length === 1 ? '' : 's'} available (up to {MAX_FSR_CHOICES}).{' '}
        {discovery?.scope ?? 'Choices use the FSR network currently loaded in this project.'}
      </p>
      <Field label="FSR to connect to">
        <select
          className={roadFieldClass}
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value)
            onPreview?.(event.target.value === 'auto' ? null : event.target.value, endpoint)
          }}
        >
          <option value="auto">Automatic choice</option>
          {!automatic && !selected && (
            <option value={targetId} disabled>
              Previously selected FSR unavailable
            </option>
          )}
          {choices.map((target, index) => (
            <option key={target.featureId} value={target.featureId}>
              {index + 1}. {target.name} · {length(target.distanceM)} away
            </option>
          ))}
        </select>
      </Field>
      {!automatic && !selected && (
        <InlineAlert tone="warning">
          The selected FSR is unavailable. Refresh the choices or choose another section.
        </InlineAlert>
      )}
      {selected && road && (
        <div className="space-y-1 rounded border bg-sky-500/5 p-2 text-xs" data-testid="road-fsr-selected-target">
          <p className="font-medium">{selected.name}</p>
          <p>{length(selected.distanceM)} straight-line distance. Generated road length can be longer.</p>
          <p className="text-muted-foreground">
            Condition: {road.roadEvidence?.condition ?? 'unknown'} · {road.roadEvidence?.conditionBasis ?? 'unreviewed'}{' '}
            · section {road.roadEvidence?.sourceId ?? road.id}
          </p>
          <p className="text-muted-foreground">Blue on plan marks the mapped road and proposed junction.</p>
          <Button size="sm" variant="outline" onClick={() => p.onLocateRoad?.(road)}>
            Locate selected FSR
          </Button>
        </div>
      )}
      {automatic && (
        <Field label="FSR connection preference">
          <select
            className={roadFieldClass}
            value={preference}
            onChange={(event) => setPreference(event.target.value as FsrConnectionPreference)}
          >
            <option value="nearest">Nearest terrain-screened route</option>
            <option value="lowest-cost">Lowest terrain search score</option>
          </select>
        </Field>
      )}
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={regional} onChange={(event) => setRegional(event.target.checked)} />
          Use regional terrain across connection (screening)
        </label>
        <InfoTip label="About regional terrain for FSR screening">
          Loads coarse terrain across the connection and opens a separate project. Your original terrain project stays
          saved. Use this when a target lies outside the loaded DEM.
        </InfoTip>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={full || (!automatic && !selected)}
        onClick={() =>
          p.onConnectFsr?.(
            options,
            preference,
            endpoint,
            regional ? 'regional' : 'current',
            automatic ? undefined : targetId,
          )
        }
      >
        {automatic ? 'Find FSR connection' : 'Connect to selected FSR'}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Creates a preliminary alignment using the terrain-cost constraints above. Fit curves and design the formation,
        then run the final checks and complete route cost comparison before treating it as a feasible, priced access
        route. BC discovery expands through 2, 5 and 10 km; imported networks use their loaded extent.
      </p>
      {p.onCompareCompleteCosts && (
        <Button size="sm" variant="outline" className="w-full" onClick={p.onCompareCompleteCosts}>
          Review final checks & complete costs
        </Button>
      )}
      {record && (
        <div className="space-y-1 rounded border p-2 text-[11px]" data-testid="road-fsr-connection-record">
          <p className="font-medium">Recorded FSR connection: {record.targetName}</p>
          <p className="text-muted-foreground">
            Original screening record; it does not establish passed final checks or complete access pricing.
          </p>
          <p>{record.networkScope}</p>
          <p>
            {length(record.straightLineDistanceM)} straight-line · {length(record.routeLengthM)} generated road at
            creation.
          </p>
          {junctionEdited && (
            <InlineAlert tone="warning">
              The road endpoints have changed since this connection was generated. Verify the junction again.
            </InlineAlert>
          )}
        </div>
      )}
    </div>
  )
}
