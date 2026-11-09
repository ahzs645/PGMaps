import { MapPopup } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { KeyValueRows } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { harvestAgeSummary } from './harvestHistory'
import { pathLengthM, polygonAreaM2 } from './mapNotes'
import type { ContextFeature, Coordinate } from './types'

const SOURCE_LABELS = {
  'bc-consolidated': 'BC consolidated cutblocks',
  user: 'Imported harvest evidence',
  scenario: 'Synthetic teaching record',
} as const

/** A cutblock's footprint and harvest record, where it was clicked on the plan. */
export function CutblockCard({
  feature,
  at,
  year,
  onClose,
  onOpenHistory,
}: {
  feature: ContextFeature
  at: Coordinate
  year: number
  onClose: () => void
  /** The full evidence and nearby roads, in the sidebar's cutblock history. */
  onOpenHistory?: () => void
}) {
  const evidence = feature.harvestEvidence
  const polygon = feature.geometry.type === 'Polygon' ? feature.geometry : null
  const mappedHa = polygon ? polygonAreaM2(polygon) / 10000 : null
  const perimeterM = polygon ? pathLengthM(polygon.coordinates[0] as Coordinate[]) : null
  // A source's recorded area and the drawn footprint can disagree; show both when they do.
  const recordedHa = evidence?.areaHectares
  const differs = recordedHa !== undefined && mappedHa !== null && Math.abs(recordedHa - mappedHa) > 0.05 * recordedHa
  const years =
    evidence?.startYear !== undefined && evidence.endYear !== undefined && evidence.startYear !== evidence.endYear
      ? `${evidence.startYear}–${evidence.endYear}`
      : (evidence?.endYear ?? evidence?.startYear ?? evidence?.midYear)
  const rows: [string, string][] = [
    ...(mappedHa !== null ? ([['Area', `${mappedHa.toFixed(2)} ha`]] as [string, string][]) : []),
    ...(differs ? ([['Recorded area', `${recordedHa!.toFixed(2)} ha`]] as [string, string][]) : []),
    ...(perimeterM !== null
      ? ([
          ['Perimeter', perimeterM >= 1000 ? `${(perimeterM / 1000).toFixed(2)} km` : `${Math.round(perimeterM)} m`],
        ] as [string, string][])
      : []),
    ...(years !== undefined ? ([['Harvest', String(years)]] as [string, string][]) : []),
    ...(evidence?.openingId ? ([['Opening ID', evidence.openingId]] as [string, string][]) : []),
    ...(evidence ? ([['Source', SOURCE_LABELS[evidence.source]]] as [string, string][]) : []),
  ]
  return (
    <MapPopup longitude={at[0]} latitude={at[1]} onClose={onClose} className="w-64">
      <MapPopupCard
        eyebrow={evidence?.status === 'proposed' ? 'Proposed cutblock' : 'Cutblock'}
        title={feature.name}
        subtitle={harvestAgeSummary(evidence, year)}
        onClose={onClose}
        closeLabel="Close cutblock details"
        actions={
          onOpenHistory && (
            <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={onOpenHistory}>
              Full history & nearby roads
            </Button>
          )
        }
      >
        <div data-testid="road-cutblock-card">
          <KeyValueRows
            variant="grid"
            rows={rows.map(([label, value]) => ({ key: label, label, value }))}
            valueClassName="tabular-nums"
          />
        </div>
        {differs && (
          <p className="text-2xs text-muted-foreground">
            Area is measured from the drawn footprint; the source records its own figure.
          </p>
        )}
      </MapPopupCard>
    </MapPopup>
  )
}
