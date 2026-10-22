import type { ReactNode } from 'react'
import { ResizableSplit } from '@/components/ui/resizable-split'

export type RoadLayout = 'linked' | 'engineering' | 'pegging'

export const ROAD_LAYOUT_OPTIONS: { value: RoadLayout; label: string }[] = [
  { value: 'linked', label: 'Linked overview' },
  { value: 'engineering', label: 'Plan · profile · section · data' },
  { value: 'pegging', label: 'Plan · profile · section · pegging' },
]

const key = (layout: RoadLayout, split: string) => `pgmaps-road-panes:${layout}:${split}`

/**
 * The connected views: (plan / data) | (profile / detail), with no data pane in the linked
 * overview. Every boundary drags and each layout remembers its own sizes. The tree has the same
 * shape in every layout, so switching layouts keeps the plan's map mounted.
 */
export function RoadPaneLayout({
  layout,
  plan,
  profile,
  detail,
  data,
}: {
  layout: RoadLayout
  plan: ReactNode
  profile: ReactNode
  detail: ReactNode
  data: ReactNode
}) {
  const linked = layout === 'linked' || !data
  return (
    <ResizableSplit
      direction="row"
      storageKey={key(layout, 'columns')}
      className="min-h-0 flex-1"
      data-testid="road-connected-layout"
      data-layout={layout}
      panes={[
        {
          id: 'plan-column',
          label: linked ? 'plan' : 'plan column',
          size: linked ? 1.05 : 1,
          min: 300,
          stackedHeight: 'auto',
          content: (
            <ResizableSplit
              direction="column"
              storageKey={key(layout, 'plan-data')}
              className="h-full"
              panes={[
                { id: 'plan', label: 'plan', content: plan, size: 1.1, min: 200, stackedHeight: 440 },
                ...(linked
                  ? []
                  : [{ id: 'data', label: 'data', content: data, size: 0.9, min: 160, stackedHeight: 360 }]),
              ]}
            />
          ),
        },
        {
          id: 'views',
          label: 'view column',
          size: 1,
          min: 320,
          stackedHeight: 'auto',
          content: (
            <ResizableSplit
              direction="column"
              storageKey={key(layout, 'views')}
              className="h-full"
              panes={[
                { id: 'profile', label: 'profile', content: profile, size: 0.9, min: 170, stackedHeight: 430 },
                { id: 'detail', label: 'detail view', content: detail, size: 1, min: 200, stackedHeight: 520 },
              ]}
            />
          ),
        },
      ]}
    />
  )
}
