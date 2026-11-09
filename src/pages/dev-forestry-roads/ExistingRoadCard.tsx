import { MapPopup } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { KeyValueRows } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { pathLengthM } from './mapNotes'
import { roadDeactivationSummary, roadHistoryStyle } from './roadHistory'
import type { ContextFeature, Coordinate } from './types'

/** An existing road's record and condition, where it was clicked on the plan. */
export function ExistingRoadCard({
  road,
  at,
  onClose,
  onReview,
  onAccessHistory,
  onLoadAsRoad,
}: {
  road: ContextFeature
  at: Coordinate
  onClose: () => void
  /** The full record, history, condition and reuse settings, in the sidebar. */
  onReview?: () => void
  onAccessHistory?: () => void
  /** Loads this road as the active road, held as mapped, so its profile and grades can be read. */
  onLoadAsRoad?: () => void
}) {
  const evidence = road.roadEvidence
  const style = roadHistoryStyle(evidence)
  const lengthM = road.geometry.type === 'LineString' ? pathLengthM(road.geometry.coordinates as Coordinate[]) : null
  return (
    <MapPopup longitude={at[0]} latitude={at[1]} onClose={onClose} className="w-64">
      <MapPopupCard
        eyebrow={
          evidence?.roadClass === 'fsr'
            ? 'Forest Service Road'
            : evidence?.roadClass === 'permit'
              ? 'Road permit'
              : 'Road'
        }
        title={road.name}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block w-4 border-t-2"
              style={{ borderColor: style.color, borderStyle: style.key === 'serviceable' ? 'solid' : 'dashed' }}
            />
            {style.label}
          </span>
        }
        onClose={onClose}
        closeLabel="Close road details"
        actions={
          (onReview || onAccessHistory || onLoadAsRoad) && (
            <div className="grid w-full gap-1.5">
              {onLoadAsRoad && (
                <Button size="sm" className="h-7 w-full text-xs" onClick={onLoadAsRoad}>
                  Load as road
                </Button>
              )}
              {onReview && (
                <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={onReview}>
                  Review road
                </Button>
              )}
              {onAccessHistory && (
                <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={onAccessHistory}>
                  Access evidence
                </Button>
              )}
            </div>
          )
        }
      >
        <div data-testid="road-existing-road-card">
          <KeyValueRows
            variant="grid"
            valueClassName="tabular-nums"
            rows={[
              lengthM !== null
                ? {
                    key: 'length',
                    label: 'Length',
                    value: lengthM >= 1000 ? `${(lengthM / 1000).toFixed(2)} km` : `${Math.round(lengthM)} m`,
                  }
                : null,
              evidence?.status ? { key: 'status', label: 'Tenure status', value: evidence.status } : null,
              {
                key: 'history',
                label: 'Deactivation',
                value: roadDeactivationSummary(evidence?.deactivation).replace(/^(Physical )?deactivation: /i, ''),
              },
              evidence?.retirementDate
                ? { key: 'retired', label: 'Tenure retired', value: evidence.retirementDate }
                : null,
              evidence?.sourceId ? { key: 'record', label: 'Record', value: evidence.sourceId } : null,
              {
                key: 'reuse',
                label: 'Route reuse',
                value: evidence?.reuseAllowed && evidence.condition !== 'closed' ? 'Enabled' : 'Off',
              },
            ]}
          />
        </div>
      </MapPopupCard>
    </MapPopup>
  )
}
