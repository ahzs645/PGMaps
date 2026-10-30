import { MousePointer2, Pencil } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { DrawMode } from './PlanView'

/** The plan's inspection/editing switch stays available when the phone sidebar is closed. */
export function RoadMapTools({
  mode,
  onMode,
  disabled = false,
}: {
  mode: DrawMode
  onMode: (mode: DrawMode) => void
  disabled?: boolean
}) {
  return (
    <SegmentedControl
      label="Road map tool"
      size="sm"
      value={mode}
      onChange={onMode}
      fullWidth={false}
      className="road-map-tool"
      options={[
        {
          value: 'inspect',
          label: 'Inspect',
          icon: MousePointer2,
          iconOnly: true,
          disabled,
          title: 'Inspect · select stations and roads without moving controls',
        },
        {
          value: 'edit',
          label: 'Edit points',
          icon: Pencil,
          iconOnly: true,
          disabled,
          title: 'Edit points · drag start/end controls or add middle controls with +',
        },
      ]}
    />
  )
}
