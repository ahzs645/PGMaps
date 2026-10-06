import { cloneElement, isValidElement, useRef, useState, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { CollapsibleSection, InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { Camera } from 'lucide-react'
import { createId } from './scene'
import { importFieldImage } from './toolImports'
import { projectToPhoto, type PhotoPose } from './photoPose'
import { maskAt } from './assessmentMasks'
import { haversineMeters } from './visibility'
import type { FieldRecord, ToolsDocument } from './assessmentTools'
import type { AnalysisResult, Viewpoint } from './types'

export const TOOL_INPUT = 'w-full rounded border bg-background px-2 py-1.5 text-xs touch:min-h-10'
export function ToolField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
        : children}
    </label>
  )
}
type Props = {
  document: ToolsDocument
  onChange: (next: ToolsDocument | ((current: ToolsDocument) => ToolsDocument)) => void
  result: AnalysisResult | null
  viewpoint: Viewpoint
  activeLandformId: string | null
  currentStation: number
  onUseView: (viewpoint: Viewpoint) => void
}
export function ToolFieldPanel({
  document: d,
  onChange,
  result,
  viewpoint,
  activeLandformId,
  currentStation,
  onUseView,
}: Props) {
  const [name, setName] = useState(''),
    [mode, setMode] = useState<'route' | 'station'>('station'),
    [selected, setSelected] = useState<string | null>(null),
    [kind, setKind] = useState<FieldRecord['kind']>('photo'),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [annotation, setAnnotation] = useState('Ridge')
  const input = useRef<HTMLInputElement>(null)
  const field = d.fields.find((f) => f.id === selected) ?? null
  const change = (patch: Partial<FieldRecord>) => {
    if (field)
      onChange({
        ...d,
        fields: d.fields.map((f) =>
          f.id === field.id ? { ...f, ...patch, alignmentChecked: patch.alignmentChecked ?? false } : f,
        ),
      })
  }
  const addView = (point?: [number, number], fallback?: string) => {
    if (d.views.length >= 12) {
      setError('Twelve viewpoints are saved. Remove one or export this workspace.')
      return
    }
    const station = result?.stations[currentStation] ?? result?.stations[result.assessmentStationIndex]
    const vp = point
      ? {
          id: createId('viewpoint'),
          name: name.trim() || fallback || 'Field viewpoint',
          mode: 'spot' as const,
          coordinates: [point],
        }
      : mode === 'station' && station
        ? {
            id: createId('viewpoint'),
            name: name.trim() || `Station ${(station.distanceAlongMeters / 1000).toFixed(2)} km`,
            mode: 'spot' as const,
            coordinates: [[station.lng, station.lat] as [number, number]],
          }
        : structuredClone(viewpoint)
    if (!vp.coordinates.length) {
      setError('Place a viewpoint or run the road assessment first.')
      return
    }
    const id = createId('tool-view')
    onChange({
      ...d,
      views: [...d.views, { id, name: name.trim() || vp.name, viewpoint: vp, landformId: activeLandformId, notes: '' }],
      fields: field && point ? d.fields.map((f) => (f.id === field.id ? { ...f, viewId: id } : f)) : d.fields,
    })
    setName('')
    setError(null)
  }
  const documentRef = useRef(d)
  documentRef.current = d
  const upload = async (file: File) => {
    if (d.fields.length >= 24) {
      setError('The workspace holds at most 24 attachments.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const f = await importFieldImage(file, kind, d.views[0]?.id ?? null)
      const latest = documentRef.current
      if (latest.fields.length >= 24) throw new Error('The workspace holds at most 24 attachments.')
      if (!latest.views.some((v) => v.id === f.viewId)) f.viewId = null
      onChange({ ...latest, fields: [...latest.fields, f] })
      setSelected(f.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const station =
    field &&
    result?.stations.find(
      (s) => field.lng !== null && field.lat !== null && haversineMeters(s, { lng: field.lng, lat: field.lat }) <= 1,
    )
  const pose: PhotoPose | null =
    field &&
    field.lng !== null &&
    field.lat !== null &&
    field.bearing !== null &&
    field.hfov !== null &&
    (field.altitude !== null || station)
      ? {
          lng: field.lng,
          lat: field.lat,
          altitudeMeters:
            field.altitude ?? station!.groundElevationMeters + (result?.settings.observerHeightMeters ?? 1.6),
          bearing: field.bearing,
          pitch: field.pitch,
          roll: field.roll,
          width: field.width,
          height: field.height,
          focalPx: field.width / (2 * Math.tan((field.hfov * Math.PI) / 360)),
          k1: 0,
          k2: 0,
        }
      : null
  const dots =
    pose && result
      ? result.targets
          .filter((t) => t.role === 'block')
          .flatMap((t) =>
            Array.from({ length: Math.min(t.sampleCount, 1000) }, (_, i) => {
              const mask = maskAt(result.inputSnapshot?.masks ?? [], t.positions[i * 2], t.positions[i * 2 + 1])
              if (mask.excludeGreen || mask.excludeAlteration || mask.retained) return null
              const p = projectToPhoto(pose, t.positions[i * 2], t.positions[i * 2 + 1], t.elevations[i])
              return p && p.x >= 0 && p.x <= pose.width && p.y >= 0 && p.y <= pose.height ? p : null
            }).filter((p) => p !== null),
          )
      : []
  return (
    <SidebarSection title="Field records and assessment viewpoints" icon={Camera} headingLevel={3}>
      <p className="text-xs text-muted-foreground">
        Save significant views, photograph their actual locations, and record why each matters. These records stay on
        this device and travel in the workspace export.
      </p>
      <div className="mt-3 space-y-2">
        <ToolField label="Viewpoint name">
          <input className={TOOL_INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </ToolField>
        <ToolField label="Save viewpoint from">
          <select className={TOOL_INPUT} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="station">Current sampled station</option>
            <option value="route">Entire current road or spot</option>
          </select>
        </ToolField>
        <Button size="sm" variant="outline" onClick={() => addView()} disabled={mode === 'station' && !result}>
          Record assessment viewpoint
        </Button>
        {d.views.map((v) => (
          <div key={v.id} className="space-y-1 border-b py-2">
            <p className="text-xs font-medium">
              {v.name} · {v.viewpoint.mode === 'spot' ? 'spot' : 'route'}
            </p>
            <textarea
              aria-label={`Significance of ${v.name}`}
              className={TOOL_INPUT}
              value={v.notes}
              placeholder="Public use, viewing opportunity, field visit or engagement evidence"
              onChange={(e) =>
                onChange((current) => ({
                  ...current,
                  views: current.views.map((x) => (x.id === v.id ? { ...x, notes: e.target.value } : x)),
                }))
              }
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onUseView(v.viewpoint)}>
                Use viewpoint
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...d,
                    views: d.views.filter((x) => x.id !== v.id),
                    fields: d.fields.map((f) => (f.viewId === v.id ? { ...f, viewId: null } : f)),
                  })
                }
              >
                Remove {v.name}
              </Button>
            </div>
          </div>
        ))}
        <ToolField label="Attachment type">
          <select className={TOOL_INPUT} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="photo">Reference field photo</option>
            <option value="simulation">Simulation image</option>
            <option value="map">Topographic map</option>
            <option value="design">Design analysis</option>
          </select>
        </ToolField>
        <input
          ref={input}
          className="hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Import field attachment"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void upload(f)
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading image…' : 'Import photograph or evidence image'}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          A resized evidence copy is stored; keep the original high-resolution photographs. EXIF values are suggestions.
          Verify position, date, true-north heading and field of view; panoramas and edited/cropped photos need manual
          calibration.
        </p>
        {d.fields.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2">
            <button className="truncate text-xs underline" onClick={() => setSelected(f.id)}>
              {f.name} · {f.kind}
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...d, fields: d.fields.filter((x) => x.id !== f.id) })}
            >
              Remove {f.name}
            </Button>
          </div>
        ))}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
      {field && (
        <DialogShell
          title={field.name}
          subtitle="Field evidence and camera match"
          onClose={() => setSelected(null)}
          size="xl"
        >
          <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
            <div className="space-y-3">
              <div className="relative overflow-hidden" style={{ aspectRatio: `${field.width}/${field.height}` }}>
                <img src={field.image} alt={field.name} className="h-full w-full object-contain" />
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${field.width} ${field.height}`}
                  aria-label="Photo annotations and projected proposal samples"
                  onClick={(e) => {
                    if (!annotation.trim() || field.annotations.length >= 50) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    change({
                      annotations: [
                        ...field.annotations,
                        {
                          x: (e.clientX - rect.left) / rect.width,
                          y: (e.clientY - rect.top) / rect.height,
                          label: annotation.trim().slice(0, 100),
                        },
                      ],
                    })
                  }}
                >
                  {dots.map((p, i) => (
                    <circle key={i} cx={p!.x} cy={p!.y} r={3} fill="#ef4444" fillOpacity="0.5" />
                  ))}
                  {field.annotations.map((a, i) => (
                    <g key={i}>
                      <circle cx={a.x * field.width} cy={a.y * field.height} r="5" fill="#fbbf24" />
                      <text
                        x={a.x * field.width + 8}
                        y={a.y * field.height}
                        fill="#fff"
                        stroke="#000"
                        strokeWidth="0.6"
                        fontSize="22"
                      >
                        {a.label}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
              <p className="text-xs text-muted-foreground">
                Red points show projected proposal ground samples, including hidden ground. This is an alignment aid; it
                does not mask terrain or canopy and is not a photographic percent-alteration measurement.
              </p>
              <ToolField label="Annotation to place on image">
                <input className={TOOL_INPUT} value={annotation} onChange={(e) => setAnnotation(e.target.value)} />
              </ToolField>
              <p className="text-xs">
                Click the image to label a ridge, drainage, skyline, natural pattern or design issue.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => change({ annotations: field.annotations.slice(0, -1) })}
              >
                Undo last annotation
              </Button>
              {!pose && (
                <InlineAlert>
                  Record position, heading, field of view and camera elevation to project the proposal. A matching
                  sampled station can supply estimated camera elevation.
                </InlineAlert>
              )}
            </div>
            <div className="space-y-3">
              <ToolField label="Evidence name">
                <input className={TOOL_INPUT} value={field.name} onChange={(e) => change({ name: e.target.value })} />
              </ToolField>
              <ToolField label="Evidence viewpoint">
                <select
                  className={TOOL_INPUT}
                  value={field.viewId ?? ''}
                  onChange={(e) => change({ viewId: e.target.value || null })}
                >
                  <option value="">Not linked</option>
                  {d.views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </ToolField>
              <ToolField label="Field date">
                <input
                  type="date"
                  className={TOOL_INPUT}
                  value={field.captured}
                  onChange={(e) => change({ captured: e.target.value })}
                />
              </ToolField>
              <CollapsibleSection toggleProps={{ 'data-forestry-disclosure': '' }} label="Camera record" defaultOpen>
                <div className="space-y-2 py-2">
                  {(
                    [
                      ['lng', 'Longitude'],
                      ['lat', 'Latitude'],
                      ['altitude', 'Camera elevation above sea level (m)'],
                      ['bearing', 'True-north bearing (°)'],
                      ['hfov', 'Horizontal field of view (°)'],
                      ['pitch', 'Pitch above horizon (°)'],
                      ['roll', 'Roll (°)'],
                    ] as const
                  ).map(([key, label]) => (
                    <ToolField label={label} key={key}>
                      <input
                        type="number"
                        step="any"
                        className={TOOL_INPUT}
                        value={field[key] ?? ''}
                        onChange={(e) =>
                          change({
                            [key]:
                              e.target.value === ''
                                ? key === 'pitch' || key === 'roll'
                                  ? 0
                                  : null
                                : Number(e.target.value),
                          })
                        }
                      />
                    </ToolField>
                  ))}
                </div>
              </CollapsibleSection>
              <ToolField label="Camera elevation reference">
                <input
                  className={TOOL_INPUT}
                  value={field.verticalReference ?? ''}
                  placeholder="Datum; verify EXIF altitude against terrain"
                  onChange={(e) => change({ verticalReference: e.target.value })}
                />
              </ToolField>
              <ToolField label="Field and design notes">
                <textarea
                  className={TOOL_INPUT}
                  value={field.notes}
                  onChange={(e) => change({ notes: e.target.value })}
                />
              </ToolField>
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={field.alignmentChecked}
                  onChange={(e) => change({ alignmentChecked: e.target.checked })}
                />
                I checked the camera record and image alignment against field evidence.
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={field.lng === null || field.lat === null}
                onClick={() => {
                  if (field.lng !== null && field.lat !== null) addView([field.lng, field.lat], field.name)
                }}
              >
                Record photo location as viewpoint
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
    </SidebarSection>
  )
}
