import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import { inventoryCsv, inventoryExport, standCsv, type EstimatedTree, type summarizeInventory } from './summary'
import { reviewManifest } from './reviews'
import type { InventoryData, InventoryRules, TreeReview } from './types'
import type { InventoryPolygon } from './geometry'
interface Props {
  drawing: boolean
  setDrawing: Dispatch<SetStateAction<boolean>>
  setVertices: Dispatch<SetStateAction<[number, number][]>>
  setMessage: (s: string) => void
  vertices: [number, number][]
  finish: () => void
  file: (e: ChangeEvent<HTMLInputElement>, kind: 'polygon' | 'reviews') => Promise<void>
  custom: InventoryPolygon | null
  setCustom: (p: InventoryPolygon | null) => void
  setAreaId: (id: string) => void
  setSelected: (id: string) => void
  fit: () => void
  rows: EstimatedTree[]
  data: InventoryData
  rules: InventoryRules
  polygon: InventoryPolygon | null
  reviews: Record<string, TreeReview>
  totals: ReturnType<typeof summarizeInventory>
}
export function InventoryActions({
  drawing,
  setDrawing,
  setVertices,
  setMessage,
  vertices,
  finish,
  file,
  custom,
  setCustom,
  setAreaId,
  setSelected,
  fit,
  rows,
  data,
  rules,
  polygon,
  reviews,
  totals,
}: Props) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
      <Button
        size="sm"
        variant={drawing ? 'default' : 'outline'}
        onClick={() => {
          setDrawing(!drawing)
          setVertices([])
          setMessage('')
        }}
      >
        {drawing ? 'Cancel drawing' : 'Draw polygon'}
      </Button>
      {drawing && (
        <>
          <span>{vertices.length} vertices · click the map</span>
          <Button size="sm" disabled={vertices.length < 3} onClick={finish}>
            Finish polygon
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!vertices.length}
            onClick={() => setVertices((v) => v.slice(0, -1))}
          >
            Undo vertex
          </Button>
        </>
      )}
      <label className="cursor-pointer underline">
        Import GeoJSON
        <input
          aria-label="Import inventory polygon"
          className="sr-only"
          type="file"
          accept=".json,.geojson"
          onChange={(e) => void file(e, 'polygon')}
        />
      </label>
      {custom && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCustom(null)
            setAreaId('all')
            setSelected('')
          }}
        >
          Clear polygon
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={fit}>
        Fit area
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadText(inventoryCsv(rows), 'tree-inventory.csv', 'text/csv')}
      >
        Tree CSV
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadText(standCsv(rows, totals.covered_ha), 'inventory-stand-table.csv', 'text/csv')}
      >
        Stand CSV
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          downloadText(
            JSON.stringify(inventoryExport(data, rows, rules, polygon)),
            'tree-inventory.geojson',
            'application/geo+json',
          )
        }
      >
        GeoJSON
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          downloadText(JSON.stringify(reviewManifest(data, reviews)), 'tree-inventory-reviews.json', 'application/json')
        }
      >
        Save reviews
      </Button>
      <label className="cursor-pointer underline">
        Import reviews
        <input
          aria-label="Import inventory reviews"
          className="sr-only"
          type="file"
          accept=".json"
          onChange={(e) => void file(e, 'reviews')}
        />
      </label>
    </div>
  )
}
