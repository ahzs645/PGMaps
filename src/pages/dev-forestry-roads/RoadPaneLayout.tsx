import { useEffect, useState, type ReactNode } from 'react'
import { ResizableSplit } from '@/components/ui/resizable-split'

export type RoadLayout = 'linked' | 'engineering' | 'pegging' | 'split' | 'plan'

export const ROAD_LAYOUT_OPTIONS: { value: RoadLayout; label: string }[] = [
  { value: 'linked', label: 'Linked overview' },
  { value: 'split', label: 'Two panes · plan & profile' },
  { value: 'plan', label: 'Map only' },
  { value: 'engineering', label: 'Plan · profile · section · data' },
  { value: 'pegging', label: 'Plan · profile · section · pegging' },
]

/** A saved layout copies its split sizes and panel corner sizes under its own id. */
export const roadPaneKey = (storageId: string, split: string) => `pgmaps-road-panes:${storageId}:${split}`

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
  storageId = layout,
  hidden = [],
  focusedPane,
}: {
  layout: RoadLayout
  hidden?: RoadPaneId[]
  /** Small workspaces show one view at a time without unmounting the others. */
  focusedPane?: RoadPaneId
  /** Where pane sizes are remembered: the preset id, or a saved layout's own id. */
  storageId?: string
  plan: ReactNode
  profile: ReactNode
  detail: ReactNode
  data: ReactNode
}) {
  const linked = !['engineering', 'pegging'].includes(layout) || !data
  const isHidden = (id: RoadPaneId) => hidden.includes(id) || (!!focusedPane && focusedPane !== id)
  return (
    <ResizableSplit
      direction="row"
      splitQuery="(min-width: 0px)"
      storageKey={roadPaneKey(storageId, 'columns')}
      className="min-h-0 flex-1"
      data-testid="road-connected-layout"
      data-layout={layout}
      data-focused-pane={focusedPane}
      panes={[
        {
          id: 'plan-column',
          hidden: isHidden('plan') && (linked || isHidden('data')),
          label: linked ? 'plan' : 'plan column',
          size: linked ? 1.05 : 1,
          min: 300,
          stackedHeight: 'auto',
          content: (
            <ResizableSplit
              direction="column"
              splitQuery="(min-width: 0px)"
              storageKey={roadPaneKey(storageId, 'plan-data')}
              className="h-full"
              panes={[
                {
                  id: 'plan',
                  hidden: isHidden('plan'),
                  label: 'plan',
                  content: plan,
                  size: 1.1,
                  min: 200,
                  stackedHeight: 440,
                },
                ...(linked
                  ? []
                  : [
                      {
                        id: 'data',
                        hidden: isHidden('data'),
                        label: 'data',
                        content: data,
                        size: 0.9,
                        min: 160,
                        stackedHeight: 360,
                      },
                    ]),
              ]}
            />
          ),
        },
        {
          id: 'views',
          hidden: isHidden('profile') && isHidden('detail'),
          label: 'view column',
          size: 1,
          min: 320,
          stackedHeight: 'auto',
          content: (
            <ResizableSplit
              direction="column"
              splitQuery="(min-width: 0px)"
              storageKey={roadPaneKey(storageId, 'views')}
              className="h-full"
              panes={[
                {
                  id: 'profile',
                  hidden: isHidden('profile'),
                  label: 'profile',
                  content: profile,
                  size: 0.9,
                  min: 170,
                  stackedHeight: 430,
                },
                {
                  id: 'detail',
                  hidden: isHidden('detail'),
                  label: 'detail view',
                  content: detail,
                  size: 1,
                  min: 200,
                  stackedHeight: 520,
                },
              ]}
            />
          ),
        },
      ]}
    />
  )
}

export type RoadPaneId = 'plan' | 'profile' | 'detail' | 'data'
export const ROAD_PANEL_OPTIONS: { id: RoadPaneId; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'profile', label: 'Profile' },
  { id: 'detail', label: 'Detail view' },
  { id: 'data', label: 'Data' },
]
export const roadPanelsKey = (storageId: string) => `pgmaps-road-panels:${storageId}`
function readPanels(storageId: string, layout: RoadLayout): RoadPaneId[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(roadPanelsKey(storageId)) ?? 'null')
    if (Array.isArray(stored)) {
      const hidden = ROAD_PANEL_OPTIONS.filter((option) => stored.includes(option.id)).map((option) => option.id)
      // Retain at least one usable view even if browser storage is edited.
      const available = ROAD_PANEL_OPTIONS.filter(
        (option) => option.id !== 'data' || ['engineering', 'pegging'].includes(layout),
      )
      if (available.some((option) => !hidden.includes(option.id))) return hidden
    }
  } catch {
    /* Use the preset. */
  }
  return presetHiddenPanels(layout)
}
/** The panels a preset hides. Picking the preset always restores exactly this. */
export const presetHiddenPanels = (layout: RoadLayout): RoadPaneId[] =>
  layout === 'plan' ? ['profile', 'detail'] : layout === 'split' ? ['detail'] : []
/** Whether the visible panels no longer match the preset; `data` only exists in the four-pane layouts. */
export function panelsEdited(layout: RoadLayout, hidden: readonly RoadPaneId[]) {
  const relevant = (id: RoadPaneId) => id !== 'data' || ['engineering', 'pegging'].includes(layout)
  const preset = presetHiddenPanels(layout)
  const current = hidden.filter(relevant)
  return current.length !== preset.length || preset.some((id) => !current.includes(id))
}
export function useRoadPanels(storageId: string, layout: RoadLayout) {
  const [state, setState] = useState(() => ({ key: storageId, hidden: readPanels(storageId, layout) }))
  if (state.key !== storageId) setState({ key: storageId, hidden: readPanels(storageId, layout) })
  useEffect(() => {
    try {
      localStorage.setItem(roadPanelsKey(state.key), JSON.stringify(state.hidden))
    } catch {
      /* Optional device preference. */
    }
  }, [state])
  return [
    state.hidden,
    (hidden: RoadPaneId[]) => setState({ key: storageId, hidden }),
    /** Select a preset as defined, dropping any panels opened or closed in it earlier. */
    (preset: RoadLayout) => setState({ key: preset, hidden: presetHiddenPanels(preset) }),
  ] as const
}
