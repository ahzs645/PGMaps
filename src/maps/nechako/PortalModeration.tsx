import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { portalRead, errorText } from '@/lib/nechakoPortal'
export function PortalModeration({
  write,
  canWrite,
}: {
  write?: (path: string, params: Record<string, string>) => Promise<unknown>
  canWrite: boolean
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [ids, setIds] = useState<number[]>([]),
    [mode, setMode] = useState<'allow' | 'toggle'>('allow'),
    [review, setReview] = useState(false),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const load = async () => {
    const data = await portalRead('rest/portal/admin/getLinkableLayers.php')
    if (!Array.isArray(data)) throw new Error('Invalid source moderation queue.')
    setRows(data)
    setIds([])
    setReview(false)
    setAck(false)
  }
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <Button variant="outline" disabled={busy} onClick={() => void run(load)}>
        Load original shared-layer queue
      </Button>
      <div className="max-h-80 overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Select</th>
              <th className="p-2 text-left">Layer / contributor</th>
              <th>Active</th>
              <th>Shared</th>
              <th>Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.layer_id)} className="border-t">
                <td className="p-2">
                  <input
                    type="checkbox"
                    aria-label={`Review shared layer ${row.layer_id}`}
                    disabled={busy}
                    checked={ids.includes(Number(row.layer_id))}
                    onChange={(e) => {
                      setIds(
                        e.target.checked
                          ? [...ids, Number(row.layer_id)]
                          : ids.filter((id) => id !== Number(row.layer_id)),
                      )
                      setReview(false)
                      setAck(false)
                    }}
                  />
                </td>
                <td className="p-2">
                  {String(row.layer_name)} · {String(row.uname)} · {String(row.layer_id)}
                </td>
                {['active', 'shared', 'vetted_by_admin'].map((key) => (
                  <td key={key} className="p-2">
                    {String(row[key] ?? 'Unknown')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="grid gap-1 text-sm">
        Review action
        <select
          aria-label="Layer moderation action"
          disabled={busy}
          value={mode}
          className="rounded border bg-background p-2 text-base"
          onChange={(e) => {
            setMode(e.target.value as typeof mode)
            setReview(false)
            setAck(false)
          }}
        >
          <option value="allow">Grant shared-layer approval</option>
          <option value="toggle">Toggle original active state</option>
        </select>
      </label>
      <Button
        variant="outline"
        disabled={busy || !ids.length || ids.length > 500}
        onClick={() => {
          setReview(true)
          setAck(false)
        }}
      >
        Review layer moderation
      </Button>
      {review && (
        <div className="space-y-3 rounded border p-3">
          <p className="text-sm">
            Original layer IDs {ids.join(', ')}. Action:{' '}
            {mode === 'allow' ? 'grant approval' : 'toggle each selected active state'}. The source enforces your
            moderation permissions.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I reviewed the source
            layers and action.
          </label>
          <Button
            disabled={!write || !canWrite || !ack || busy}
            onClick={() =>
              void run(async () => {
                setReview(false)
                setAck(false)
                setRows([])
                setIds([])
                await write!('rest/portal/admin/setLinkableStatus.php', { layerIds: JSON.stringify(ids), mode })
                setNotice('Source accepted the moderation update. Reload the queue to verify.')
                await load()
              })
            }
          >
            Apply reviewed layer moderation
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Retraction can make source data eligible for permanent cleanup; use the original administrator interface for
        that operation. Toggle follows the original active-state operation rather than a revision-checked update. After an uncertain response, reload and review the current queue before another attempt.
      </p>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert>{notice}</InlineAlert>}
    </div>
  )
}
