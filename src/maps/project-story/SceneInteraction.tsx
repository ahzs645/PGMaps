import type { ProjectSceneInteractionDef } from '@/lib/projectPackages'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'

/** Scene links use the normal navigation path, keeping camera, legend and highlights in sync. */
export function SceneInteraction({
  block,
  sceneLabels,
  activeLabel,
  onNavigate,
}: {
  block: ProjectSceneInteractionDef
  sceneLabels: string[]
  activeLabel: string
  onNavigate: (index: number) => void
}) {
  const items = block.items.filter((item) => sceneLabels.includes(item.sceneLabel))
  const select = (label: string) => {
    const index = sceneLabels.indexOf(label)
    if (index >= 0) {
      onNavigate(index)
      // Each slide keeps its own controls mounted. Transfer focus from the now
      // hidden slide to the selected control in the active card.
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('[data-active-scene="true"] [data-story-interaction] button[aria-pressed="true"]')
          ?.focus({ preventScroll: true })
      })
    }
  }
  const groups = [...new Set(items.map((item) => item.group ?? 'Path'))]
  return (
    <div className="mt-4 space-y-2 text-left" data-story-interaction={block.type}>
      <h3 className="text-sm font-semibold">{block.title}</h3>
      {block.description && <p className="text-xs leading-5 text-muted-foreground">{block.description}</p>}
      {block.type === 'choices' && (
        <SegmentedControl
          label={block.title}
          value={activeLabel}
          options={items.map((item) => ({ value: item.sceneLabel, label: item.label }))}
          onChange={select}
          className="flex-wrap"
        />
      )}
      {block.type === 'bars' && (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.sceneLabel}
              type="button"
              aria-pressed={item.sceneLabel === activeLabel}
              onClick={() => select(item.sceneLabel)}
              className={cn(
                'block min-h-11 w-full rounded-md border p-2 text-left hover:bg-muted',
                item.sceneLabel === activeLabel && 'border-primary bg-primary/5',
              )}
            >
              <span className="flex justify-between gap-2 text-xs font-medium">
                <span>{item.label}</span>
                <span>{((item.share ?? 0) * 100).toFixed(1)}%</span>
              </span>
              <span aria-hidden="true" className="my-1 block h-2 overflow-hidden rounded bg-muted">
                <span className="block h-full bg-primary" style={{ width: `${(item.share ?? 0) * 100}%` }} />
              </span>
              {item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}
            </button>
          ))}
        </div>
      )}
      {block.type === 'hierarchy' && (
        <div className="grid grid-cols-2 gap-2">
          {groups.map((group) => (
            <div key={group} className="rounded-lg border p-2">
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{group}</h4>
              <ol className="space-y-1">
                {items
                  .filter((item) => (item.group ?? 'Path') === group)
                  .map((item, index) => (
                    <li key={item.sceneLabel}>
                      {index > 0 && (
                        <div aria-hidden="true" className="text-center text-muted-foreground">
                          ↓
                        </div>
                      )}
                      <Button
                        variant={item.sceneLabel === activeLabel ? 'default' : 'outline'}
                        className="h-auto min-h-11 w-full whitespace-normal text-xs"
                        aria-pressed={item.sceneLabel === activeLabel}
                        onClick={() => select(item.sceneLabel)}
                      >
                        {item.label}
                      </Button>
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
