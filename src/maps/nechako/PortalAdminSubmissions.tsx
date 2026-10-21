import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { errorText } from '@/lib/nechakoPortal'
import { AdminDataTable, AdminOriginal } from './PortalAdminResource'
import { CheckState, useReadCheck } from './PortalChecks'
import { PortalSourceSubmissionDialog } from './PortalSourceSubmissionDialog'
import { adminId, adminSubmissions, SUBMISSION_COLUMNS } from './data/adminInspection'

export function PortalAdminSubmissions() {
  const read = useReadCheck(),
    [state, setState] = useState(''),
    [selected, setSelected] = useState('')
  const parsed = useMemo(() => {
    if (read.data === undefined) return undefined
    try {
      return { rows: adminSubmissions(read.data) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [read.data])
  const rows = parsed?.rows ?? [],
    states = [...new Set(rows.map((row) => String(row.sub_state ?? '')))].filter(Boolean).sort()
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Submission Manager</h3>
      <p className="text-sm text-muted-foreground">
        The administrator catalogue includes the source states returned for drafts and submitted records. Filters and
        25-row pages apply to this loaded catalogue. Opening an existing record rechecks its source access.
      </p>
      <Button
        variant="outline"
        disabled={read.loading}
        onClick={() => {
          setSelected('')
          void read.run('rest/portal/admin/getSubmissions.php')
        }}
      >
        Load submission catalogue
      </Button>
      <CheckState {...read} showData={false} />
      {parsed?.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
      {parsed?.rows && (
        <>
          <p className="text-sm">
            {rows.length} distinct submission IDs returned. This is separate from research records, saved map projects
            and monitoring observations.
          </p>
          <label className="grid max-w-sm gap-1 text-sm">
            Source state
            <select
              aria-label="Submission manager state"
              className="rounded border bg-background p-2 text-base"
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">All returned states</option>
              {states.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <AdminDataTable
            key={state}
            title="Administrator submissions"
            rows={state ? rows.filter((row) => row.sub_state === state) : rows}
            columns={SUBMISSION_COLUMNS}
            onSelect={(row) => {
              const id = adminId(row.sub_id)
              if (id) setSelected(id)
            }}
            selectLabel={(row) => `Open submission ${row.sub_id}`}
          />
          <AdminOriginal title="Administrator submission catalogue" data={read.data} />
        </>
      )}
      {selected && (
        <PortalSourceSubmissionDialog
          submissionId={selected}
          onClose={() => setSelected('')}
          onOpenSubmission={setSelected}
        />
      )}
      <p className="text-xs text-muted-foreground">
        New submissions, draft editing, publication and deletion remain source workflows. This manager does not create
        or modify submissions.
      </p>
    </section>
  )
}
