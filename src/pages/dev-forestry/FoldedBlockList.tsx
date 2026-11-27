import { useMemo, useState, type ReactNode } from 'react'

import { SearchInput } from '@/components/ui/map-panels'
import { SidebarScrollFallback } from '@/components/ui/sidebar-scroll-fallback'
import { VirtualResultList } from '@/components/ui/virtual-result-list'

import type { TargetPolygon } from './types'
import { useStepShown } from './stepShown'
import { keepFieldKeysInRow } from './virtualRowKeys'

const keyOf = (target: TargetPolygon) => target.id

/** A district plan's blocks are found by name: past this many, the folded list gets a filter. */
const FILTER_FROM = 8

/**
 * The Cutblocks list's folded blocks in a long plan (`splitBlockList`): the same cards, drawn by the sidebar's own
 * `renderRow`, only those near the view mounted (`VirtualResultList`), with a name filter once there are more than a
 * few. Never in a hidden step panel (`stepShown.ts`); shown on its own scroller when the section is in Save & export
 * (`SidebarScrollFallback`). `blocks` must keep its identity while the list does not change.
 */
export function FoldedBlockList({
  blocks,
  renderRow,
}: {
  blocks: readonly TargetPolygon[]
  renderRow: (target: TargetPolygon) => ReactNode
}) {
  const shown = useStepShown()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  // The same array while nothing is typed, so the virtual list keeps its measured rows.
  const filtered = useMemo(
    () => (needle ? blocks.filter((target) => target.name.toLowerCase().includes(needle)) : blocks),
    [blocks, needle],
  )
  if (!shown) return null
  return (
    <div className="space-y-2">
      {blocks.length > FILTER_FROM && (
        <SearchInput
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Find a block by name"
          aria-label="Find a cutblock by name"
          data-map-search-input="false"
        />
      )}
      {needle && filtered.length === 0 ? (
        <p className="text-2xs text-muted-foreground">No block’s name contains “{query.trim()}”.</p>
      ) : (
        <SidebarScrollFallback>
          <VirtualResultList items={filtered} getKey={keyOf} estimateSize={124} label="Other cutblocks">
            {(target) => <div onKeyDown={keepFieldKeysInRow}>{renderRow(target)}</div>}
          </VirtualResultList>
        </SidebarScrollFallback>
      )}
    </div>
  )
}
