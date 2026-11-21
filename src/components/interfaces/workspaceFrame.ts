import type { CSSProperties } from 'react'
import type { AnyLayout } from './workspaceLayoutSchema'
import './workspaceFrame.css'
import './interfaces.css'
import '@/components/ui/panel-corner.css'

/**
 * The attributes a workspace root carries for its interface: which one is open, its panel canvas
 * (`panelFrame`: background, inset, gap) and where its tools dock. Put them on an element with the
 * `lp-workspace` class; the shared styles (`workspaceFrame.css`, `panel-corner.css`,
 * `interfaces.css`) read them.
 */
export function workspaceFrameProps(active: AnyLayout) {
  const panelFrame = active.panelFrame
  return {
    'data-interface': active.id,
    'data-panel-background': panelFrame?.background,
    'data-panel-inset': panelFrame?.inset !== undefined || undefined,
    'data-tool-dock': active.toolbar?.dock,
    style: {
      '--workspace-panel-gray': panelFrame?.grayPercent !== undefined ? `${panelFrame.grayPercent}%` : undefined,
      '--workspace-panel-inset': panelFrame?.inset !== undefined ? `${panelFrame.inset}px` : undefined,
      '--workspace-panel-gap': panelFrame?.gap !== undefined ? `${panelFrame.gap}px` : undefined,
    } as CSSProperties,
  }
}
