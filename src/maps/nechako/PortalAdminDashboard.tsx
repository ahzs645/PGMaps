import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { errorText } from '@/lib/nechakoPortal'
import { AdminDataTable, AdminOriginal, AdminReadResource } from './PortalAdminResource'
import { CheckState, useReadCheck } from './PortalChecks'
import { PortalSourceSubmissionDialog } from './PortalSourceSubmissionDialog'
import {
  adminId,
  calendarDays,
  localCalendarDate,
  scheduleDate,
  scheduleMarkers,
  scheduleNotifications,
  type AdminColumn,
  type AdminRow,
} from './data/adminInspection'

const notificationColumns: AdminColumn[] = [
  { key: 'task_id', label: 'Task ID' },
  { key: 'name', label: 'Task' },
  { key: 'submission_id', label: 'Submission' },
  { key: 'task_start', label: 'Start' },
  { key: 'task_end', label: 'End' },
  { key: 'description', label: 'Details' },
]

function Notifications({ onSubmission }: { onSubmission: (id: string) => void }) {
  const [since, setSince] = useState(localCalendarDate),
    read = useReadCheck()
  const parsed = useMemo(() => {
    if (read.data === undefined) return undefined
    try {
      return { notifications: scheduleNotifications(read.data) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [read.data])
  const [requestDate, setRequestDate] = useState('')
  let notificationDate: string | undefined
  try {
    notificationDate = scheduleDate(since)
  } catch {
    /* Incomplete dates are not requests. */
  }
  const load = () => {
    if (notificationDate) {
      setRequestDate(since)
      void read.run('rest/portal/schedule.php', { mode: 'notification', date: notificationDate })
    }
  }
  return (
    <section className="min-w-0 space-y-3 rounded border p-3">
      <h3 className="font-semibold">Notifications</h3>
      <label className="grid max-w-sm gap-1 text-sm">
        Check since local midnight
        <input
          aria-label="Notification start date"
          type="date"
          value={since}
          onChange={(event) => setSince(event.target.value)}
          className="rounded border bg-background p-2 text-base"
        />
      </label>
      <Button size="sm" variant="outline" disabled={!notificationDate || read.loading} onClick={load}>
        Load notifications
      </Button>
      <CheckState {...read} showData={false} />
      {parsed?.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
      {parsed?.notifications && (
        <>
          <p className="text-sm">
            Source notification results since {requestDate}. Each category retains the source task and submission IDs.
          </p>
          {(
            [
              ['newTasks', 'New tasks'],
              ['nearDeadline', 'Near deadline'],
            ] as const
          ).map(([key, label]) => (
            <section key={key} className="space-y-2">
              <h4 className="font-medium">{label}</h4>
              <AdminDataTable
                title={label}
                rows={parsed.notifications[key]}
                columns={notificationColumns}
                onSelect={(row) => {
                  const id = adminId(row.submission_id)
                  if (id) onSubmission(id)
                }}
                selectLabel={(row) =>
                  adminId(row.submission_id) ? `Open submission ${row.submission_id}` : 'No source submission ID'
                }
              />
            </section>
          ))}
        </>
      )}
      {read.data !== undefined && <AdminOriginal title="Workflow notifications" data={read.data} />}
    </section>
  )
}

function CalendarMonth({ month, date, onSelect }: { month: string; date: string; onSelect: (date: string) => void }) {
  const read = useReadCheck()
  const changeMonth = (delta: number) => {
    const [year, monthNumber] = month.split('-').map(Number)
    onSelect(localCalendarDate(new Date(year, monthNumber - 1 + delta, 1)))
  }
  const parsed = useMemo(() => {
    if (read.data === undefined) return undefined
    try {
      return { markers: scheduleMarkers(read.data) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [read.data])
  return (
    <section className="space-y-3 rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Calendar · {month}</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={read.loading}
          onClick={() =>
            void read.run('rest/portal/schedule.php', { mode: 'monthly', date: scheduleDate(`${month}-01`) })
          }
        >
          Load month highlights
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => changeMonth(-1)}>
          Previous month
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSelect(localCalendarDate())}>
          Today
        </Button>
        <Button size="sm" variant="outline" onClick={() => changeMonth(1)}>
          Next month
        </Button>
      </div>
      <CheckState {...read} showData={false} />
      {parsed?.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
      <p className="text-xs text-muted-foreground">
        {parsed?.markers
          ? 'Dots mark dates returned by the source. They are not task counts.'
          : 'Month highlights have not been loaded.'}{' '}
        Select a date to inspect its tasks.
      </p>
      <div className="grid grid-cols-7 gap-1" aria-label="Workflow calendar">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="p-1 text-center text-xs font-medium">
            {day}
          </div>
        ))}
        {calendarDays(month).map((day, index) =>
          day ? (
            <button
              key={day}
              type="button"
              aria-pressed={date === day}
              aria-label={`Tasks on ${day}${parsed?.markers?.has(day) ? ', source highlight' : ''}`}
              className={`flex min-h-11 flex-col items-center justify-center rounded border text-sm ${date === day ? 'border-primary bg-primary/10 font-semibold' : 'hover:bg-muted'}`}
              onClick={() => onSelect(day)}
            >
              {Number(day.slice(-2))}
              {parsed?.markers?.has(day) && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-primary"
                  style={{ backgroundColor: parsed.markers?.get(day)?.find(Boolean) || undefined }}
                />
              )}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
      {read.data !== undefined && <AdminOriginal title={`Schedule ${month}`} data={read.data} />}
    </section>
  )
}

export function PortalAdminDashboard() {
  const [date, setDate] = useState(localCalendarDate),
    [selected, setSelected] = useState('')
  const month = date.slice(0, 7)
  let validDate = false
  try {
    scheduleDate(date)
    validDate = true
  } catch {
    /* Incomplete date input is not a request. */
  }
  const openTask = (row: AdminRow) => {
    const id = adminId(row.submission)
    if (id) setSelected(id)
  }
  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">Workflow dashboard</h3>
      <p className="text-sm text-muted-foreground">
        Calendar dates use this browser's time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Task dates and
        details retain the source's text. Scheduling, reassignment and notification changes remain in the original
        dashboard.
      </p>
      <label className="grid max-w-sm gap-1 text-sm">
        Workflow date
        <input
          aria-label="Workflow date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="rounded border bg-background p-2 text-base"
        />
      </label>
      {validDate && (
        <>
          <CalendarMonth key={month} month={month} date={date} onSelect={setDate} />
          <AdminReadResource
            key={date}
            title="Tasks for selected day"
            description={`Source tasks for ${date}.`}
            path="rest/portal/schedule.php"
            params={{ mode: 'date', date: scheduleDate(date) }}
            columns={[
              { key: 'task_name', label: 'Task' },
              { key: 'event', label: 'Event' },
              { key: 'submission', label: 'Submission' },
              { key: 'rank', label: 'Rank' },
              { key: 'status_name', label: 'Status' },
              { key: 'task_details', label: 'Details' },
            ]}
            onSelect={openTask}
            selectLabel={(row) =>
              adminId(row.submission) ? `Open submission ${row.submission}` : 'No source submission ID'
            }
          />
        </>
      )}
      <Notifications onSubmission={setSelected} />
      {selected && (
        <PortalSourceSubmissionDialog
          submissionId={selected}
          onClose={() => setSelected('')}
          onOpenSubmission={setSelected}
        />
      )}
    </section>
  )
}
