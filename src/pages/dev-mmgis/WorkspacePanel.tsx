import { useRef, useState } from 'react'
import { Bookmark, Copy, Download, FolderOpen, Link2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { downloadText } from '@pgmaps/geo-toolkit/export'
import { demoMission } from './demo'
import { MAX_PROJECT_BYTES, missionLink, readMissionJson } from './missionCodec'
import { uid, type Camera, type Mission } from './model'

export function WorkspacePanel({
  mission,
  change,
  camera,
  onFly,
  onError,
  status,
  onExportLayer,
  onExportMap,
}: {
  mission: Mission
  change: (m: Mission | ((m: Mission) => Mission)) => void
  camera: Camera
  onFly: (camera: Camera) => void
  onError: (message: string) => void
  status: string
  onExportLayer: (format: 'csv' | 'geojson') => void
  onExportMap: () => void
}) {
  const file = useRef<HTMLInputElement>(null),
    [bookmark, setBookmark] = useState(''),
    [link, setLink] = useState('')
  return (
    <>
      <SidebarSection title="Mission configuration">
        <label className="mm-field">
          Mission name
          <input
            key={`${mission.id}:${mission.name}`}
            defaultValue={mission.name}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== mission.name) change((m) => ({ ...m, name: name.slice(0, 200) }))
            }}
          />
        </label>
        <label className="mm-field">
          Description
          <textarea
            key={`${mission.id}:${mission.description}`}
            defaultValue={mission.description}
            rows={3}
            onBlur={(e) => {
              const description = e.target.value.slice(0, 10000)
              if (description !== mission.description) change((m) => ({ ...m, description }))
            }}
          />
        </label>
        <p className="mm-help" role="status">
          {status}. Undo history lasts for this session.
        </p>
        <div className="mm-button-row">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              change({ ...demoMission(), id: uid(), name: 'Untitled mission', description: '', layers: [] })
            }
          >
            <Plus size={14} />
            New mission
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => change((m) => ({ ...m, id: uid(), name: `${m.name} copy` }))}
          >
            <Copy size={14} />
            Duplicate
          </Button>
        </div>
        <div className="mm-button-row">
          <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
            <FolderOpen size={14} />
            Import mission
          </Button>
          <Button
            size="sm"
            onClick={() =>
              downloadText(JSON.stringify({ ...mission, camera }, null, 2), 'mission.json', 'application/json')
            }
          >
            <Download size={14} />
            Export mission
          </Button>
        </div>
        <input
          ref={file}
          aria-label="Import mission JSON"
          className="sr-only"
          type="file"
          accept=".json"
          onChange={async (e) => {
            const selected = e.target.files?.[0]
            e.target.value = ''
            if (!selected) return
            try {
              if (selected.size > MAX_PROJECT_BYTES) throw new Error('Mission files are limited to 32 MB.')
              change(readMissionJson(await selected.text()))
            } catch (e) {
              onError(e instanceof Error ? e.message : 'Invalid mission file.')
            }
          }}
        />
        <Button size="sm" variant="outline" onClick={() => change(demoMission())}>
          Open example mission
        </Button>
      </SidebarSection>
      <SidebarSection title="Export map & layer">
        <div className="mm-button-row">
          <Button size="sm" variant="outline" disabled={!mission.layers.length} onClick={() => onExportLayer('csv')}>
            Export layer CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!mission.layers.length}
            onClick={() => onExportLayer('geojson')}
          >
            Export layer GeoJSON
          </Button>
          <Button size="sm" variant="outline" onClick={onExportMap}>
            Export map image
          </Button>
        </div>
        <p className="mm-help">
          Layer exports use the open table’s layer, selected feature’s layer, or first visible layer, including active
          filters. PNG captures the map canvas; HTML markers and panels are excluded.
        </p>
      </SidebarSection>
      <SidebarSection title="Share workspace">
        <p className="mm-help">
          Links contain the mission’s vector data, imagery connections, camera and settings. Anyone with the link can
          read them. Local DEM files are excluded.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              const url = await missionLink({ ...mission, camera })
              setLink(url)
              try {
                await navigator.clipboard.writeText(url)
              } catch {
                /* The selected URL below remains available. */
              }
            } catch (e) {
              onError(e instanceof Error ? e.message : 'Could not create a link.')
            }
          }}
        >
          <Link2 size={14} />
          Create share link
        </Button>
        {link && (
          <label className="mm-field">
            Mission link · select to copy
            <input readOnly aria-label="Mission share link" value={link} onFocus={(e) => e.target.select()} />
          </label>
        )}
      </SidebarSection>
      <SidebarSection title="Saved sites">
        <label className="mm-field">
          Site name
          <input value={bookmark} onChange={(e) => setBookmark(e.target.value)} placeholder="e.g. North lookout" />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!bookmark.trim() || mission.bookmarks.length >= 100}
          onClick={() => {
            change((m) => ({
              ...m,
              bookmarks: [...m.bookmarks, { id: uid(), name: bookmark.trim().slice(0, 200), camera }],
            }))
            setBookmark('')
          }}
        >
          <Bookmark size={14} />
          Save current view
        </Button>
        {mission.bookmarks.map((b) => (
          <div className="mm-source-row" key={b.id}>
            <button onClick={() => onFly(b.camera)}>{b.name}</button>
            <button
              aria-label={`Delete site ${b.name}`}
              onClick={() => change((m) => ({ ...m, bookmarks: m.bookmarks.filter((v) => v.id !== b.id) }))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </SidebarSection>
      <SidebarSection title="About this workbench">
        <p className="mm-help">
          An MMGIS-inspired Earth GIS workbench built with GeoToolkit. This browser workspace supports local missions;
          shared accounts, server collaboration and planetary/SPICE workflows require additional services.
        </p>
        <a className="text-xs underline" href="https://github.com/NASA-AMMOS/MMGIS" target="_blank" rel="noreferrer">
          Explore NASA AMMOS MMGIS
        </a>
      </SidebarSection>
    </>
  )
}
