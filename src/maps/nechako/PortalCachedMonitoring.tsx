import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { errorText } from '@/lib/nechakoPortal'
import { cachedMonitoringTable } from './data/cachedMonitoring'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'
import type { MonitoringMapping } from './data/monitoring'
import type { monitorPageTable } from './data/monitoringRelations'

export function PortalCachedMonitoring({
  onOpen,
}: {
  onOpen: (table: ReturnType<typeof monitorPageTable>, name: string, mapping?: MonitoringMapping) => void
}) {
  const { records, error: storageError } = useLocalWorkbenchRecords('monitoring')
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [coverage, setCoverage] = useState('')
  const selected = records.find((record) => record.id === id) ?? records[0]
  return (
    <section className="space-y-3 rounded border p-3" aria-label="Cached monitoring">
      <h3 className="font-semibold">Reopen saved observations</h3>
      <p className="text-xs text-muted-foreground">
        Full source extracts and CSV ingestions saved on this browser remain available after disconnecting. Choose a
        saved table to chart it using the original values.
      </p>
      {records.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            Saved monitoring table
            <select
              aria-label="Saved monitoring table"
              className="mt-1 w-full rounded border bg-background p-2 text-base"
              value={selected?.id ?? ''}
              onChange={(event) => {
                setId(event.target.value)
                setError('')
                setCoverage('')
              }}
            >
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => {
              try {
                const result = cachedMonitoringTable(selected!.data)
                onOpen(result.table, selected!.name, result.mapping)
                setCoverage(result.coverage)
                setError('')
              } catch (reason) {
                setError(errorText(reason))
              }
            }}
          >
            Open cached observations
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No observations have been saved here yet. Save a source extract above, or ingest a CSV in Import files.
        </p>
      )}
      {(error || storageError) && <InlineAlert tone="error">{error || storageError}</InlineAlert>}
      {coverage && <InlineAlert>{coverage}</InlineAlert>}
    </section>
  )
}
