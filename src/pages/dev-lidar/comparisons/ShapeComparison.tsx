import { NativeSelect } from '@/components/ui/form-field'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { Basemap } from '../basemaps'
import type { IsolatedPoint } from '../treeIsolation'
import { prepareTreeProfile } from '../treeProfiles'
import { ComparisonMap, sameCamera, type ComparisonCamera } from './ComparisonMap'
import { ComparisonPane } from './ComparisonPane'
import { ComparisonProfile } from './ComparisonProfile'
import type { ComparisonData } from './data'

export function ShapeComparison({ data, basemap }: { data: ComparisonData; basemap: Basemap }) {
  const [a, setA] = useState('crown-85'),
    [b, setB] = useState('crown-1'),
    [view, setView] = useState('3d'),
    [linked, setLinked] = useState(true),
    [angle, setAngle] = useState(0),
    [pointSize, setPointSize] = useState(2),
    [camera, setCamera] = useState<ComparisonCamera | null>(null),
    [reset, setReset] = useState(0),
    [picked, setPicked] = useState<IsolatedPoint | null>(null)
  const left = data.shapes.crops.find((c) => c.id === a) ?? data.shapes.crops[0],
    right = data.shapes.crops.find((c) => c.id === b) ?? data.shapes.crops[1]
  const profiles = useMemo(() => [prepareTreeProfile(left), prepareTreeProfile(right)], [left, right])
  const height = Math.ceil(Math.max(...profiles.map((p) => p.maximum)) / 5) * 5,
    radius = Math.ceil(Math.max(...profiles.map((p) => p.radius))) + 1
  const onCamera = useCallback(
    (next: ComparisonCamera) => setCamera((previous) => (sameCamera(previous, next) ? previous : next)),
    [],
  )
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
        {[
          [a, setA, 'A'],
          [b, setB, 'B'],
        ].map(([id, set, label]) => (
          <label key={String(label)}>
            {String(label)}
            <NativeSelect
              aria-label={`Shape candidate ${label}`}
              className="ml-1 rounded border bg-background p-1.5"
              value={String(id)}
              onChange={(e) => {
                ;(set as (s: string) => void)(e.target.value)
                setCamera(null)
                setPicked(null)
              }}
            >
              {data.shapes.crops.map((c) => (
                <option key={c.id}>{c.id}</option>
              ))}
            </NativeSelect>
          </label>
        ))}
        <SegmentedControl
          label="Shape comparison view"
          fullWidth={false}
          size="sm"
          value={view}
          onChange={(v) => {
            setView(v)
            setCamera(null)
          }}
          options={[
            { value: '3d', label: '3D points' },
            { value: 'top', label: 'Top map' },
            { value: 'profile', label: 'Side profiles' },
          ]}
        />
        <label>
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          Link relative cameras
        </label>
        <label>
          Point size
          <input
            aria-label="Shape point size"
            className="ml-1 w-16 align-middle"
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={pointSize}
            onChange={(e) => setPointSize(+e.target.value)}
          />
        </label>
        {view === 'profile' && (
          <label>
            Rotation {angle}°
            <input
              aria-label="Shape profile rotation"
              className="ml-1 w-20 align-middle"
              type="range"
              min={0}
              max={180}
              step={5}
              value={angle}
              onChange={(e) => setAngle(+e.target.value)}
            />
          </label>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCamera(null)
            setReset((n) => n + 1)
          }}
        >
          Fit candidates
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        <div className="flex h-full min-h-[400px] flex-col gap-2 lg:min-h-[300px] lg:flex-row">
          {[left, right].map((crop, index) => (
            <ComparisonPane
              key={index}
              label={index ? 'B' : 'A'}
              title={crop.id}
              metrics={[
                { label: 'Original returns', value: crop.points.length.toLocaleString() },
                { label: 'Observed maximum', value: profiles[index].maximum.toFixed(2) + ' m' },
                { label: 'Status', value: 'Unvalidated column selection' },
              ]}
            >
              {view === 'profile' ? (
                <ComparisonProfile
                  crop={crop}
                  assignments={{}}
                  angle={angle}
                  height={height}
                  radius={radius}
                  picked={picked}
                  onPick={setPicked}
                />
              ) : (
                <ComparisonMap
                  label={`Shape review map ${index ? 'B' : 'A'}`}
                  centre={crop.centre}
                  focusKey={`${crop.id}-${reset}`}
                  view={view === 'top' ? 'top' : '3d'}
                  basemap={basemap}
                  crop={crop}
                  pointSize={pointSize}
                  camera={linked ? camera : null}
                  onCamera={linked ? onCamera : undefined}
                />
              )}
            </ComparisonPane>
          ))}
        </div>
      </div>
      <div className="max-h-[24dvh] shrink-0 overflow-y-auto overscroll-contain border-t p-3 text-xs">
        <p>
          <strong>A:</strong> {left.review_note}
        </p>
        <p className="mt-1">
          <strong>B:</strong> {right.review_note}
        </p>
        <p className="mt-2 text-muted-foreground">
          Every retained original point is shown. These five examples are not a random validation sample. Ground and
          returns below 2 m were excluded. Tree-like shape does not establish species, a measured stem or a correct
          individual-tree partition. 3D preserves source elevation relative to each centre’s ground; side profiles use
          per-return height above local terrain.
        </p>
        {picked && (
          <p className="mt-1">
            Picked source return {picked.node}:{picked.index} · {picked.height.toFixed(2)} m
          </p>
        )}
      </div>
    </div>
  )
}
