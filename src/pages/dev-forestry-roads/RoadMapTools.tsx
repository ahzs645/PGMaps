import { MousePointer2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DrawMode } from './PlanView'

const mapToolButtonClass =
  'road-map-icon-action size-8 shrink-0 bg-background/95 shadow-sm aria-pressed:bg-accent aria-pressed:text-accent-foreground'

const tools = [
  {
    mode: 'inspect',
    label: 'Inspect',
    icon: MousePointer2,
    title: 'Inspect · select stations and roads without moving controls',
  },
  {
    mode: 'edit',
    label: 'Edit points',
    icon: Pencil,
    title: 'Edit points · drag start/end controls, or drag a + to bend the road',
  },
] as const

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
    <div role="group" aria-label="Road map tool" className="flex flex-col gap-1">
      {tools.map(({ mode: toolMode, label, icon: Icon, title }) => (
        <Button
          key={toolMode}
          type="button"
          size="icon"
          variant="outline"
          className={mapToolButtonClass}
          aria-label={label}
          aria-pressed={mode === toolMode}
          title={title}
          disabled={disabled}
          onClick={() => onMode(toolMode)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      ))}
    </div>
  )
}
