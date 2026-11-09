import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Download, Layers, Maximize, PenLine, Undo2, Upload, X } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { Button, buttonVariants } from '@/components/ui/button'
import { FileButton } from '@/components/ui/file-button'
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
  file: (file: File, kind: 'polygon' | 'reviews') => Promise<void>
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
/** Area, import and export actions above the crown map, in groups split by a rule. */
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
        {drawing ? <X aria-hidden="true" /> : <PenLine aria-hidden="true" />}
        {drawing ? 'Cancel drawing' : 'Draw polygon'}
      </Button>
      {drawing && (
        <>
          <span className="text-muted-foreground" role="status">
            {vertices.length} vertices · click the map
          </span>
          <Button size="sm" disabled={vertices.length < 3} onClick={finish}>
            Finish polygon
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!vertices.length}
            onClick={() => setVertices((v) => v.slice(0, -1))}
          >
            <Undo2 aria-hidden="true" />
            Undo vertex
          </Button>
        </>
      )}
      <FileButton
        label="Import inventory polygon"
        accept=".json,.geojson"
        onFiles={([picked]) => void file(picked, 'polygon')}
      >
        <Upload aria-hidden="true" />
        Import boundary
      </FileButton>
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
        <Maximize aria-hidden="true" />
        Fit area
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link to="/dev/lidar/data/">
          <Layers aria-hidden="true" />
          Import data layers
        </Link>
      </Button>
      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
      <ActionMenu
        label="Export"
        align="start"
        triggerClassName={buttonVariants({ variant: 'outline', size: 'sm' })}
        trigger={
          <>
            <Download aria-hidden="true" />
            Export
            <ChevronDown aria-hidden="true" />
          </>
        }
        items={[
          { type: 'label', id: 'scope', label: 'Candidates in this selection' },
          {
            id: 'tree-csv',
            label: 'Tree CSV',
            onSelect: () => downloadText(inventoryCsv(rows), 'tree-inventory.csv', 'text/csv'),
          },
          {
            id: 'stand-csv',
            label: 'Stand CSV',
            onSelect: () => downloadText(standCsv(rows, totals.covered_ha), 'inventory-stand-table.csv', 'text/csv'),
          },
          {
            id: 'geojson',
            label: 'GeoJSON',
            onSelect: () =>
              downloadText(
                JSON.stringify(inventoryExport(data, rows, rules, polygon)),
                'tree-inventory.geojson',
                'application/geo+json',
              ),
          },
          { type: 'separator', id: 'reviews-separator' },
          {
            id: 'reviews',
            label: 'Save reviews',
            onSelect: () =>
              downloadText(
                JSON.stringify(reviewManifest(data, reviews)),
                'tree-inventory-reviews.json',
                'application/json',
              ),
          },
        ]}
      />
      <FileButton label="Import inventory reviews" accept=".json" onFiles={([picked]) => void file(picked, 'reviews')}>
        <Upload aria-hidden="true" />
        Import reviews
      </FileButton>
    </div>
  )
}
