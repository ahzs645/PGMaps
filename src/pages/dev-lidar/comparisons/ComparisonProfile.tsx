import { ProfileCanvas } from '../ProfileCanvas'
import { DEFAULT_PROFILE, pointKey } from '../treeInspection'
import type { IsolatedPoint, TreeCrop } from '../treeIsolation'

export function ComparisonProfile({
  crop,
  assignments,
  angle,
  height,
  radius,
  picked,
  onPick,
}: {
  crop: TreeCrop
  assignments: Record<string, string>
  angle: number
  height: number
  radius: number
  picked: IsolatedPoint | null
  onPick: (p: IsolatedPoint | null) => void
}) {
  return (
    <ProfileCanvas
      crop={crop}
      assignments={assignments}
      settings={{
        ...DEFAULT_PROFILE,
        angle,
        colour: Object.keys(assignments).length ? 'segment' : 'height',
        showRejected: true,
      }}
      picked={picked ? pointKey(picked) : null}
      selected={new Set()}
      seeds={[]}
      interaction="pick"
      onPick={onPick}
      onSelection={() => {}}
      onSeed={() => {}}
      onView={() => {}}
      sharedHeight={height}
      sharedRadius={radius}
    />
  )
}
