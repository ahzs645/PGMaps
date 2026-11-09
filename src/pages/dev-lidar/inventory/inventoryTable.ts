import { numberColumn, textColumn } from '@/components/map/tableColumns'
import type { MapFeatureTableColumn } from '@/components/map/mapTableModel'
import { defineTableSource, type MapTableSource } from '@/components/map/useMapTable'
import { SPECIES_NAMES } from './allometry'
import type { EstimatedTree } from './summary'

type Column = MapFeatureTableColumn<EstimatedTree>

const COLUMNS: Column[] = [
  textColumn('id', 'Candidate', (row) => `#${row.tree.properties.label}`),
  textColumn('core', 'Core', (row) => row.tree.properties.chunk),
  textColumn('species', 'Species', (row) => SPECIES_NAMES[row.species] ?? row.species),
  numberColumn('height', 'Height (m)', (row) => row.tree.properties.height_m),
  numberColumn('crown', 'Crown area (m²)', (row) => row.tree.properties.crown_area_m2),
  numberColumn('dbh', 'DBH (cm)', (row) => row.dbh),
  textColumn('dbh-source', 'DBH source', (row) => row.dbhSource),
  numberColumn('total', 'Total stem (m³)', (row) => row.total),
  numberColumn('merchant', 'Merchantable (m³)', (row) => row.merchant),
  textColumn('review', 'Review', (row) => row.review.status),
  textColumn('boundary', 'Boundary', (row) => (row.tree.properties.boundary ? 'Yes' : 'No')),
]

/**
 * The candidates the crown map draws, one row each. `rows` is already scoped by method, area
 * and the model filters, so the table and map agree. Ids are the run-scoped candidate ids,
 * which survive a reload. Rows have no camera target: the inventory map is not a shared
 * `Map`, so it cannot host the table's fly-to bridge.
 */
export function inventoryTableSources(rows: readonly EstimatedTree[], methodName: string): MapTableSource[] {
  if (!rows.length) return []
  return [
    defineTableSource<EstimatedTree>({
      id: 'candidates',
      label: `Candidates · ${methodName}`,
      shape: 'fill',
      rows: [...rows],
      columns: COLUMNS,
      getRowId: (row) => row.tree.properties.id,
      exportFileName: 'tree-inventory-candidates',
    }),
  ]
}
