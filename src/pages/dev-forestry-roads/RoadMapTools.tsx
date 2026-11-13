import { MousePointer2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DrawMode } from './PlanView'

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
    <div
      role="group"
      aria-label="Road map tool"
      className="road-map-mode flex shrink-0 border border-input bg-background/95 shadow-sm"
    >
      {tools.map(({ mode: toolMode, label, icon: Icon, title }) => (
        <Button
          key={toolMode}
          type="button"
          size="icon"
          variant="ghost"
          className="size-[1.875rem] shrink-0 rounded-none focus-visible:z-10 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
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
