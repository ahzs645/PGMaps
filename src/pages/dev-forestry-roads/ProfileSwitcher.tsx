import { RoadSelect } from './Controls'
import { activateVerticalAlternative } from './verticalAlternatives'
import type { RoadWorkspace } from './useRoadWorkspace'

/**
 * The active road's named profiles, in the profile pane's own header, so the profile on screen can
 * be changed where it is drawn. A road with one profile shows nothing here; adding, renaming and
 * comparing profiles stays under Compare → Profiles on this road.
 */
export function ProfileSwitcher({ workspace, disabled }: { workspace: RoadWorkspace; disabled?: boolean }) {
  const { alignment, updateAlignment } = workspace
  const profiles = alignment.verticalAlternatives ?? []
  if (profiles.length < 2) return null
  return (
    <RoadSelect
      ariaLabel="Profile shown"
      title="Named profiles on this road. Add, rename and compare them under Compare → Profiles on this road."
      className="w-32 shrink"
      value={alignment.activeVerticalAlternativeId ?? profiles[0].id}
      disabled={disabled}
      onValueChange={(id) => updateAlignment((road) => activateVerticalAlternative(road, id))}
      options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
    />
  )
}
