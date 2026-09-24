import { ArrowDown, ArrowUp } from 'lucide-react'
import type { PostalBoundaryLevel } from '@/lib/studyArea'

export function PostalHierarchyControls({ level, onChange }: {
  level: PostalBoundaryLevel
  onChange: (level: PostalBoundaryLevel) => void
}) {
  const up: PostalBoundaryLevel = level === 'fsa' ? 'postalPrefix2' : 'postalRegion'
  const down: PostalBoundaryLevel = level === 'postalRegion' ? 'postalPrefix2' : 'fsa'
  return (
    <div className="mt-3 space-y-2 rounded-md border bg-background p-2.5 text-xs leading-4">
      <div className="font-semibold">Postal hierarchy · 2021</div>
      <div className="text-muted-foreground">V → V2 → V2L: region → 2-character prefix → FSA</div>
      <div className="flex gap-2">
        <button type="button" disabled={level === 'postalRegion'} onClick={() => onChange(up)}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded border px-2 disabled:opacity-40">
          <ArrowUp className="size-3.5" /> {up === 'postalRegion' ? 'Up to BC region' : 'Up to 2 characters'}
        </button>
        <button type="button" disabled={level === 'fsa'} onClick={() => onChange(down)}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded border px-2 disabled:opacity-40">
          <ArrowDown className="size-3.5" /> {down === 'fsa' ? 'Down to FSAs' : 'Down to 2 characters'}
        </button>
      </div>
      <p className="text-muted-foreground">Two-character areas are groups we define by merging FSAs with the same prefix; they may have disconnected parts.</p>
      <p className="text-muted-foreground">No 4-, 5-, or 6-character boundary polygons are available here. A prefix such as V2L1 can group data rows, but does not give us a mapped area. FSA polygons cannot tell us where to draw those smaller boundaries.</p>
      <p className="text-muted-foreground">
        The region and prefix groups are generated from our 191 census FSA polygons. All levels use the same 2021 source;
        display geometry is simplified at 25 m.{' '}
        <a className="underline" href="https://www150.statcan.gc.ca/n1/pub/92-179-g/92-179-g2021001-eng.htm" target="_blank" rel="noreferrer">Source and methodology</a>
      </p>
    </div>
  )
}
