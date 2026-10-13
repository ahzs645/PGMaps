import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { errorText } from '@/lib/nechakoPortal'
import type { Workspace } from './data/workspace'
import { nativeProjectSave, projectMutation, type ProjectMutation, type ProjectRead } from './data/projectManager'
export function PortalProjectWrites({
  workspace,
  projectId,
  owner,
  write,
  canWrite,
  onSuccess,
}: {
  workspace: Workspace
  projectId: string
  owner: boolean
  write?: ProjectRead
  canWrite: boolean
  onSuccess: () => Promise<void>
}) {
  const [name, setName] = useState(''),
    [additions, setAdditions] = useState(''),
    [removals, setRemovals] = useState('')
  const [review, setReview] = useState<ProjectMutation>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const prepare = (operation: () => ProjectMutation) => {
    try {
      setError('')
      setReview(operation())
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  if (!canWrite || !write)
    return (
      <InlineAlert>
        Original saves, sharing and defaults require a signed-in local gateway with project writes enabled.
      </InlineAlert>
    )
  return (
    <details className="mt-3 space-y-2">
      <summary>Change original portal project</summary>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert>{notice}</InlineAlert>}
      <label className="block">
        Original project name
        <input
          aria-label="Original project name"
          className="mt-1 w-full rounded border bg-background p-2"
          value={name}
          maxLength={200}
          onChange={(event) => {
            setName(event.target.value)
            setReview(undefined)
          }}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!owner || busy}
          onClick={() =>
            prepare(() => {
              const original = workspace.originalProject as {
                attributes?: { projectId?: unknown }
                projectId?: unknown
              }
              if (String(original?.attributes?.projectId ?? original?.projectId) !== projectId)
                throw new Error('Load the selected original project before saving changes.')
              const native = nativeProjectSave(workspace)
              setNotice(
                `${native.retainedUnsupported} unsupported source layers will be preserved exactly. Native layer order and vector styles are retained.`,
              )
              return projectMutation('save', projectId, native)
            })
          }
        >
          Review original save
        </Button>
        <Button
          variant="outline"
          disabled={busy || !name.trim()}
          onClick={() => prepare(() => projectMutation('saveNew', '', { name, ...nativeProjectSave(workspace) }))}
        >
          Review native Save As
        </Button>
        <Button
          variant="outline"
          disabled={!owner || busy || !name.trim()}
          onClick={() => prepare(() => projectMutation('rename', projectId, { name }))}
        >
          Review rename
        </Button>
        <Button
          variant="outline"
          disabled={!projectId || busy}
          onClick={() => prepare(() => projectMutation('default', projectId))}
        >
          Review portal default
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => prepare(() => projectMutation('unsetDefault', ''))}>
          Review unset default
        </Button>
      </div>
      <p className="text-xs">
        Save and Save As preserve native source layers, order and unsupported metadata. Native changes include map
        center/scale, visibility and WMS styles; pitch, bearing and opacity remain local. New sources, edited vector
        geometry and PGMaps category styles require browser export until native serialization supports them.
      </p>
      <label className="block">
        Add native user IDs (comma separated)
        <input
          aria-label="Add project user IDs"
          className="mt-1 w-full rounded border bg-background p-2"
          value={additions}
          onChange={(event) => {
            setAdditions(event.target.value)
            setReview(undefined)
          }}
        />
      </label>
      <label className="block">
        Remove native user IDs (comma separated)
        <input
          aria-label="Remove project user IDs"
          className="mt-1 w-full rounded border bg-background p-2"
          value={removals}
          onChange={(event) => {
            setRemovals(event.target.value)
            setReview(undefined)
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!owner || busy}
          onClick={() =>
            prepare(() =>
              projectMutation('shareProject', projectId, {
                additions: additions
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
                removals: removals
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              }),
            )
          }
        >
          Review sharing change
        </Button>
        <Button
          variant="outline"
          disabled={!owner || busy}
          onClick={() => prepare(() => projectMutation('stopSharing', projectId))}
        >
          Review stop sharing
        </Button>
      </div>
      {review && (
        <div className="space-y-2 rounded border p-3">
          <p className="font-medium">Review: {review.summary}</p>
          <p className="text-xs">Confirming changes the original portal. Review the native IDs and payload first.</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(review, null, 2)}
          </pre>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await write(review.path, review.params)
                setReview(undefined)
                setNotice('Original portal accepted the change. Refreshing its current catalogue.')
                await onSuccess()
              } catch (reason) {
                setError(errorText(reason))
              } finally {
                setBusy(false)
              }
            }}
          >
            Confirm original portal change
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setReview(undefined)}>
            Cancel review
          </Button>
        </div>
      )}
    </details>
  )
}
