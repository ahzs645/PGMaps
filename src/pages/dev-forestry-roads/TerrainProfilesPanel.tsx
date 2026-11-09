import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Saved ground profiles, and any mapped line sampled as one. */
export function TerrainProfilesPanel({
  workspace: w,
  onDraw,
  onProfile,
}: {
  workspace: RoadWorkspace
  onDraw: () => void
  onProfile: (id: string) => void
}) {
  const profiles = w.project.profiles ?? []
  const lines = w.project.context.filter((f) => f.geometry.type === 'LineString')
  const [lineId, setLineId] = useState('')
  const line = lines.find((f) => f.id === lineId) ?? lines[0]
  return (
    <RoadSection
      title="Terrain profiles"
      summary={profiles.length ? `${profiles.length} saved` : 'None'}
      help="Draw a line to read the ground along it, or sample a stream or road you already have."
    >
      <div className="space-y-1" data-testid="road-terrain-profiles">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          aria-label="Draw terrain profile"
          onClick={onDraw}
        >
          Draw profile
        </Button>
        {line && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
            <RoadSelect
              ariaLabel="Line to sample"
              className={roadFieldClass}
              value={line.id}
              onValueChange={(value) => setLineId(value)}
            >
              {lines.map((feature) => (
                <option key={feature.id} value={feature.id}>
                  {feature.name}
                </option>
              ))}
            </RoadSelect>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onProfile(line.id)}>
              Sample
            </Button>
          </div>
        )}
        {profiles.map((profile) => (
          <div key={profile.id} className="flex items-center gap-1 rounded border px-2 py-1">
            <button className="flex-1 text-left text-xs" onClick={() => onProfile(profile.id)}>
              {profile.name}
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label={`Remove profile ${profile.name}`}
              onClick={() => w.update((x) => ({ ...x, profiles: x.profiles?.filter((v) => v.id !== profile.id) }))}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </RoadSection>
  )
}
