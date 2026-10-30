import { NativeSelect } from '@/components/ui/form-field'
import { PortalProjectWrites } from './PortalProjectWrites'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import {
  errorText,
  portalRead,
  portalWrite,
  getPortalConnectionStatus,
  getPortalConnectionMode,
  PORTAL_CONNECTION_EVENT,
} from '@/lib/nechakoPortal'
import { importWorkspace, type Workspace } from './data/workspace'
import {
  checkedNativeProjects,
  checkedProjectLibrary,
  latestNativeHistory,
  PROJECT_LIBRARY_KEY,
  saveLocalProject,
  type LocalProjectLibrary,
  type ProjectRead,
} from './data/projectManager'
const empty: LocalProjectLibrary = { schema: 'nechako-local-projects-v1', projects: [] }
export function PortalProjectManager({
  workspace,
  onWorkspace,
  read = portalRead,
  write = portalWrite,
  canWrite,
}: {
  workspace: Workspace
  onWorkspace: (workspace: Workspace) => void
  read?: ProjectRead
  write?: ProjectRead
  canWrite?: boolean
}) {
  const [library, setLibrary] = useState<LocalProjectLibrary>(() => {
    try {
      const text = localStorage.getItem(PROJECT_LIBRARY_KEY)
      return text ? checkedProjectLibrary(JSON.parse(text)) : empty
    } catch {
      return empty
    }
  })
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [remote, setRemote] = useState<ReturnType<typeof checkedNativeProjects>>()
  const [remoteId, setRemoteId] = useState('')
  const [historyId, setHistoryId] = useState<string>()
  const [sharing, setSharing] = useState<unknown>()
  const [connectedWrites, setConnectedWrites] = useState(false)
  const connectionGeneration = useRef(0)
  const guardedRead: ProjectRead = async (path, params, signal) => {
    const generation = connectionGeneration.current
    const value = await read(path, params, signal)
    if (generation !== connectionGeneration.current)
      throw new Error('The portal connection changed. Refresh the project list.')
    return value
  }
  useEffect(() => {
    let alive = true
    const refresh = () => {
      const generation = ++connectionGeneration.current
      setConnectedWrites(false)
      setRemote(undefined)
      setRemoteId('')
      setHistoryId(undefined)
      setSharing(undefined)
      if (getPortalConnectionMode() === 'gateway')
        void getPortalConnectionStatus()
          .then((status) => {
            if (alive && generation === connectionGeneration.current)
              setConnectedWrites(status.loggedIn && status.canWrite === true)
          })
          .catch(() => {
            if (alive) setConnectedWrites(false)
          })
    }
    refresh()
    window.addEventListener(PORTAL_CONNECTION_EVENT, refresh)
    return () => {
      alive = false
      window.removeEventListener(PORTAL_CONNECTION_EVENT, refresh)
    }
  }, [])
  const writesEnabled = canWrite ?? connectedWrites
  const commit = (next: LocalProjectLibrary) => {
    localStorage.setItem(PROJECT_LIBRARY_KEY, JSON.stringify(next))
    setLibrary(next)
  }
  const run = async (operation: () => Promise<void> | void) => {
    setError('')
    setBusy(true)
    try {
      await operation()
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === 'QuotaExceededError'
          ? 'This browser has insufficient storage for the project and history. Export the workspace JSON or use an original portal save.'
          : errorText(reason),
      )
    } finally {
      setBusy(false)
    }
  }
  const selected = library.projects.find((project) => project.id === id)
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Named projects on this browser keep map state, source references, vectors and up to 20 previous saves. Remote
        datasets are referenced, rather than copied into these saves.
      </p>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert>{notice}</InlineAlert>}
      <label className="block text-sm">
        Browser project
        <NativeSelect
          className="mt-1 w-full rounded border bg-background p-2"
          value={id}
          onChange={(event) => {
            setId(event.target.value)
            setName(library.projects.find((project) => project.id === event.target.value)?.name ?? '')
          }}
        >
          <option value="">New named project</option>
          {library.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
              {project.id === library.defaultId ? ' · default' : ''}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="block text-sm">
        Project name
        <input
          className="mt-1 w-full rounded border bg-background p-2"
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void run(() => {
              const nextId = id || crypto.randomUUID()
              commit(saveLocalProject(library, workspace, name, nextId, new Date().toISOString()))
              setId(nextId)
              setNotice('Saved on this browser.')
            })
          }
        >
          Save browser project
        </Button>
        <Button
          variant="outline"
          disabled={!selected || busy}
          onClick={() => selected && onWorkspace(importWorkspace(selected.workspace))}
        >
          Open browser project
        </Button>
        <Button
          variant="outline"
          disabled={!selected || busy}
          onClick={() =>
            void run(() => {
              commit({ ...library, defaultId: id })
              setNotice('Default set for this browser. Use Open default to restore it.')
            })
          }
        >
          Set browser default
        </Button>
        <Button
          variant="outline"
          disabled={!library.defaultId}
          onClick={() => {
            const project = library.projects.find((item) => item.id === library.defaultId)
            if (project) {
              onWorkspace(importWorkspace(project.workspace))
              setId(project.id)
              setName(project.name)
            }
          }}
        >
          Open default
        </Button>
        <Button
          variant="outline"
          disabled={!selected}
          onClick={() =>
            selected &&
            downloadText(JSON.stringify(selected.workspace, null, 2), `${selected.name}.json`, 'application/json')
          }
        >
          Export project
        </Button>
      </div>
      {selected && (
        <details>
          <summary>Browser history ({selected.history.length})</summary>
          <ul className="space-y-2">
            {selected.history.map((record, index) => (
              <li key={`${record.savedAt}-${index}`} className="flex flex-wrap items-center gap-2">
                <span>{record.savedAt}</span>
                <Button size="sm" variant="outline" onClick={() => onWorkspace(importWorkspace(record.workspace))}>
                  Restore this save
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details open>
        <summary>Original portal projects</summary>
        <p className="my-2 text-xs text-muted-foreground">
          Read the projects accessible to the current connection. Server changes use the original project contracts and
          require a signed-in write connection plus review.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const value = checkedNativeProjects(await guardedRead('rest/openmap/savedProjects.php', { mode: 'list' }))
              setRemote(value)
              setRemoteId('')
              setHistoryId(undefined)
              setSharing(undefined)
            })
          }
        >
          Refresh portal projects
        </Button>
        {remote && (
          <>
            <label className="mt-2 block">
              Portal project
              <NativeSelect
                className="mt-1 w-full rounded border bg-background p-2"
                value={remoteId}
                onChange={(event) => {
                  setRemoteId(event.target.value)
                  setHistoryId(undefined)
                  setSharing(undefined)
                }}
              >
                <option value="">Choose a project</option>
                {remote.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <p className="text-xs">
              {remote.projects.length} accessible projects ·{' '}
              {remote.uid === '-1' ? 'anonymous connection' : 'signed-in connection'}
            </p>
          </>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            disabled={!remoteId || busy}
            onClick={() =>
              void run(async () => {
                const data = await guardedRead('rest/openmap/savedProjects.php', { mode: 'load', projectId: remoteId })
                onWorkspace({ ...importWorkspace(data), sessionBound: !!remote && remote.uid !== '-1' })
                setHistoryId(latestNativeHistory(data))
                setNotice('Loaded the original project. Conversion limitations appear in the map workspace.')
              })
            }
          >
            Load portal project
          </Button>
          <Button
            variant="outline"
            disabled={!remoteId || busy}
            onClick={() =>
              void run(async () => {
                setSharing(
                  await guardedRead('rest/openmap/savedProjects.php', { mode: 'getSharedGroups', projectId: remoteId }),
                )
              })
            }
          >
            Read sharing permissions
          </Button>
          {historyId && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  onWorkspace({
                    ...importWorkspace(
                      await guardedRead('rest/openmap/getProjectHistory.php', { mode: 'loadRec', historyId }),
                    ),
                    sessionBound: !!remote && remote.uid !== '-1',
                  })
                  setNotice('Loaded the newer original save referenced by the project.')
                })
              }
            >
              Load newer save
            </Button>
          )}
        </div>
        <PortalProjectWrites
          key={`${remoteId}-${writesEnabled}`}
          workspace={workspace}
          projectId={remoteId}
          owner={
            !!remote &&
            remote.uid !== '-1' &&
            remote.projects.find((project) => project.id === remoteId)?.creatorId === remote.uid
          }
          write={write}
          canWrite={writesEnabled}
          onSuccess={async () => {
            setRemote(checkedNativeProjects(await guardedRead('rest/openmap/savedProjects.php', { mode: 'list' })))
            setSharing(undefined)
          }}
        />
        {sharing !== undefined && (
          <>
            <p className="text-xs">Original permission metadata; these controls do not change access.</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(sharing, null, 2)}
            </pre>
          </>
        )}
      </details>
    </div>
  )
}
