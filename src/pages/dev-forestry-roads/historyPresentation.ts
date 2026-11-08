import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource } from '@/components/map/useMapTable'
import { harvestAgeSummary, harvestHistoryStyle } from './harvestHistory'
import { roadDeactivationSummary, roadHistoryStyle } from './roadHistory'
import type { ContextFeature } from './types'

/** Shared by the plan and its legend; public tenure status alone never implies a usable road. */
export function contextHistoryProperties(feature: ContextFeature, year: number) {
  if (feature.kind === 'existing-road') {
    const style = roadHistoryStyle(feature.roadEvidence)
    return { historyKey: style.key, historyLabel: style.label, historyColor: style.color, historyDash: style.dasharray }
  }
  if (feature.kind === 'harvest') {
    const style = harvestHistoryStyle(feature.harvestEvidence, year)
    return { historyKey: style.key, historyLabel: style.label, historyColor: style.color }
  }
  return {}
}

export function contextHistoryBounds(feature: ContextFeature): [number, number, number, number] {
  const coordinates =
    feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates
  return coordinates.reduce<[number, number, number, number]>(
    (bounds, point) => [
      Math.min(bounds[0], point[0]),
      Math.min(bounds[1], point[1]),
      Math.max(bounds[2], point[0]),
      Math.max(bounds[3], point[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

const getRowCenter = (feature: ContextFeature): [number, number] => {
  const [west, south, east, north] = contextHistoryBounds(feature)
  return [(west + east) / 2, (south + north) / 2]
}
const identityColumn = textColumn<ContextFeature>('id', 'Feature reference', (row) => row.id, { defaultHidden: true })

/** Use only context layers currently visible on the map, including their source provenance in CSV. */
export function historyTableSources(context: ContextFeature[], year: number) {
  const blocks = context.filter((feature) => feature.kind === 'harvest')
  const roads = context.filter((feature) => feature.kind === 'existing-road')
  return [
    ...(blocks.length
      ? [
          defineTableSource<ContextFeature>({
            id: 'cutblock-history',
            label: 'Cutblocks and harvest history',
            color: '#15803d',
            shape: 'fill',
            rows: blocks,
            getRowId: (row) => row.id,
            getRowCenter,
            getRowBounds: contextHistoryBounds,
            exportFileName: `cutblock-history-${year}.csv`,
            columns: [
              textColumn('name', 'Cutblock', (row) => row.name, { width: 240 }),
              textColumn('age', `Harvest age in ${year}`, (row) => harvestAgeSummary(row.harvestEvidence, year), {
                width: 250,
              }),
              numberColumn('year', 'Reference year', () => year, { format: String }),
              numberColumn('start', 'Harvest start year', (row) => row.harvestEvidence?.startYear, { format: String }),
              numberColumn('end', 'Harvest end year', (row) => row.harvestEvidence?.endYear, { format: String }),
              numberColumn('midpoint', 'Estimated midpoint year', (row) => row.harvestEvidence?.midYear, {
                format: String,
              }),
              dateColumn('startDate', 'Harvest start date', (row) => row.harvestEvidence?.startDate),
              dateColumn('endDate', 'Harvest end date', (row) => row.harvestEvidence?.endDate),
              textColumn(
                'area',
                'Source area (ha; repeated for parts)',
                (row) => row.harvestEvidence?.areaHectares?.toString(),
                { width: 250 },
              ),
              textColumn('yearMethod', 'Harvest year basis', (row) => row.harvestEvidence?.yearMethod),
              textColumn('dataSource', 'Contributing data source', (row) => row.harvestEvidence?.dataSource),
              dateColumn('sourceDate', 'Source date', (row) => row.harvestEvidence?.sourceDate),
              dateColumn('publishedDate', 'Source published', (row) => row.harvestEvidence?.publishedDate),
              textColumn('source', 'Source', (row) => row.harvestEvidence?.source),
              textColumn('sourceId', 'Source record', (row) => row.harvestEvidence?.sourceId),
              textColumn('openingId', 'Opening ID', (row) => row.harvestEvidence?.openingId),
              textColumn('sourceUrl', 'Source URL', (row) => row.harvestEvidence?.sourceUrl, { width: 280 }),
              dateColumn('retrieved', 'Retrieved', (row) => row.harvestEvidence?.retrievedAt, {
                getExportValue: (row) => row.harvestEvidence?.retrievedAt ?? '',
              }),
              identityColumn,
            ],
          }),
        ]
      : []),
    ...(roads.length
      ? [
          defineTableSource<ContextFeature>({
            id: 'road-history',
            label: 'Existing road history',
            color: '#64748b',
            shape: 'line',
            rows: roads,
            getRowId: (row) => row.id,
            getRowCenter,
            getRowBounds: contextHistoryBounds,
            exportFileName: 'existing-road-history.csv',
            columns: [
              textColumn('name', 'Road section', (row) => row.name, { width: 240 }),
              textColumn('status', 'Map status', (row) => roadHistoryStyle(row.roadEvidence).label, { width: 250 }),
              textColumn(
                'physical',
                'Physical road event',
                (row) => roadDeactivationSummary(row.roadEvidence?.deactivation),
                { width: 250 },
              ),
              dateColumn('deactivation', 'Deactivated on', (row) => row.roadEvidence?.deactivation?.deactivatedOn),
              dateColumn('reactivation', 'Reactivated on', (row) => row.roadEvidence?.deactivation?.reactivatedOn),
              textColumn('eventSource', 'Event source reference', (row) => row.roadEvidence?.deactivation?.reference, {
                width: 240,
              }),
              textColumn('eventBasis', 'Event evidence basis', (row) => row.roadEvidence?.deactivation?.basis),
              dateColumn('observed', 'Event status observed on', (row) => row.roadEvidence?.deactivation?.observedOn),
              textColumn('eventNotes', 'Event evidence notes', (row) => row.roadEvidence?.deactivation?.notes, {
                width: 280,
              }),
              textColumn('eventUrl', 'Event source URL', (row) => row.roadEvidence?.deactivation?.sourceUrl, {
                width: 280,
              }),
              textColumn('tenure', 'Tenure status', (row) => row.roadEvidence?.status),
              dateColumn('retired', 'Tenure retirement', (row) => row.roadEvidence?.retirementDate),
              textColumn('reuse', 'Reuse enabled', (row) =>
                row.roadEvidence?.reuseAllowed ? 'Yes — planning input' : 'No',
              ),
              textColumn('source', 'Road source URL', (row) => row.roadEvidence?.sourceUrl, { width: 280 }),
              dateColumn('retrieved', 'Retrieved', (row) => row.roadEvidence?.retrievedAt, {
                getExportValue: (row) => row.roadEvidence?.retrievedAt ?? '',
              }),
              identityColumn,
            ],
          }),
        ]
      : []),
  ]
}
