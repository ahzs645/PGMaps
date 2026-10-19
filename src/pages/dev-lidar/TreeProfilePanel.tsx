import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FullscreenPanel } from '@/components/ui/fullscreen-panel'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { downloadText } from '@/lib/download'
import type { TreeCrop } from './treeIsolation'
import { canPinProfile, MAX_PROFILE_PINS, prepareTreeProfile, treeProfilesSVG, type TreeProfile } from './treeProfiles'

export function TreeProfilePanel({
  crop,
  sourceHash,
  selectedId,
  loading,
  onLoad,
}: {
  crop: TreeCrop | null
  sourceHash: string
  selectedId?: string
  loading: boolean
  onLoad: () => void
}) {
  const [angle, setAngle] = useState(0)
  const [colour, setColour] = useState('black')
  const [pinned, setPinned] = useState<TreeProfile[]>([])
  const current = useMemo(
    () => (crop && crop.source_sha256 === sourceHash ? prepareTreeProfile(crop) : null),
    [crop, sourceHash],
  )
  const saved = useMemo(() => pinned.filter((p) => p.crop.source_sha256 === sourceHash), [pinned, sourceHash])
  const profiles = useMemo(
    () =>
      [...saved.filter((p) => p.crop.id !== current?.crop.id), ...(current ? [current] : [])].sort(
        (a, b) => a.maximum - b.maximum || a.crop.id.localeCompare(b.crop.id),
      ),
    [saved, current],
  )
  const svg = useMemo(
    () => (profiles.length ? treeProfilesSVG(profiles, angle, colour === 'height') : ''),
    [profiles, angle, colour],
  )
  const isPinned = saved.some((p) => p.crop.id === current?.crop.id)
  return (
    <FullscreenPanel
      title="Tree side profiles"
      compact
      className="m-3"
      help="Orthographic views of observed crown-column returns. Expand to compare candidates at one metre scale. Rotation changes the horizontal projection, without adding points."
    >
      {(fullscreen) => (
        <div className="space-y-3 text-xs">
          <p>
            Select a crown on the map, then load its original returns. Pin profiles to build a height-sorted comparison
            like a tree silhouette gallery.
          </p>
          {selectedId && <p className="font-medium">Selected: {selectedId}</p>}
          <Button size="sm" variant="outline" disabled={!selectedId || loading || Boolean(current)} onClick={onLoad}>
            {loading
              ? 'Loading original returns…'
              : current
                ? `${current.crop.id} loaded`
                : 'Load selected tree profile'}
          </Button>
          {profiles.length > 0 && (
            <>
              <label className="block">
                Horizontal axis · {angle}° east toward north
                <input
                  aria-label="Tree profile rotation"
                  className="mt-1 w-full"
                  type="range"
                  min={0}
                  max={180}
                  step={5}
                  value={angle}
                  onChange={(e) => setAngle(Number(e.target.value))}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAngle(0)}>
                  East–west
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAngle(90)}>
                  North–south
                </Button>
              </div>
              <SegmentedControl
                value={colour}
                onChange={setColour}
                options={[
                  { value: 'black', label: 'Black points' },
                  { value: 'height', label: 'Height colour' },
                ]}
                label="Tree profile colour"
                size="sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!current || isPinned || !canPinProfile(saved, current)}
                  onClick={() => current && setPinned([...saved, current])}
                >
                  {isPinned ? 'Profile pinned' : 'Pin for comparison'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadText(svg, 'tree-side-profiles.svg', 'image/svg+xml')}
                >
                  Download profiles SVG
                </Button>
              </div>
              <p className="text-muted-foreground">
                Up to {MAX_PROFILE_PINS} pinned profiles / 150,000 returns, plus the selected crown. Pins clear when
                switching workflow or reloading. Both axes and all candidates share the same metre scale.
              </p>
              {saved.length > 0 && (
                <div className="flex flex-wrap gap-2" aria-label="Pinned tree profiles">
                  {saved.map((p) => (
                    <Button
                      key={p.crop.id}
                      size="sm"
                      variant="ghost"
                      onClick={() => setPinned(saved.filter((other) => other.crop.id !== p.crop.id))}
                    >
                      Remove {p.crop.id}
                    </Button>
                  ))}
                </div>
              )}
              <div
                className="overflow-auto rounded border bg-white"
                style={{ maxHeight: fullscreen ? '65dvh' : '490px' }}
                aria-label="Tree side profile figure"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              {current && !current.points.length && (
                <p role="status">No eligible returns in this crop. No silhouette can be drawn.</p>
              )}
            </>
          )}
          <p className="leading-5 text-muted-foreground">
            The 0–2 m band is excluded by the current crop. Airborne returns can miss trunks and lower branches.
            Neighbouring foliage can fall inside crown columns. These profiles show observed structure; they cannot
            establish DBH, species or a complete individual tree.
          </p>
          <p className="leading-5 text-muted-foreground">
            Use rotation to inspect crown shape, compare height and asymmetry, and flag sparse or merged candidates for
            review. Projected span is angle-dependent and is not trunk diameter.
          </p>
        </div>
      )}
    </FullscreenPanel>
  )
}
