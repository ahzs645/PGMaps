import { describe, expect, it } from 'vitest'
import layouts from '../../../public/workspace-layouts.json'
import { ribbonWidgetLabels } from '@/components/interfaces/ribbonToolCatalog'
import { resolveToolbar, type WorkspaceToolbar } from '@/components/interfaces/workspaceLayouts'
import { ribbonExports, workspaceCommands } from '@/components/interfaces/workspaceCommands'

const hosted = layouts.find((layout) => layout.id === 'ribbon')!.toolbar as WorkspaceToolbar
const sectionsOf = (toolbar: WorkspaceToolbar) => toolbar.groups.flatMap((tab) => tab.sections ?? [])
const toolsOf = (section: ReturnType<typeof sectionsOf>[number]) => [...section.items, ...(section.more ?? [])]

describe('ribbon catalog coverage', () => {
  it('places every registered command, export, and widget in the shipped ribbon', () => {
    const resolved = resolveToolbar(hosted)
    // The tab row (`tabTools`) is part of the ribbon too: the detached-panels widget lives there.
    const visible = new Set([...sectionsOf(resolved).flatMap(toolsOf), ...(resolved.tabTools ?? [])])
    expect([...visible].sort()).toEqual([...Object.keys(workspaceCommands), ...Object.keys(ribbonWidgetLabels)].sort())
    for (const output of ribbonExports) {
      expect(visible.has(output.command)).toBe(true)
    }
  })

  it('respects explicit placements and collects unassigned tools even when the catch-all comes first', () => {
    const toolbar: WorkspaceToolbar = {
      ...hosted,
      groups: [
        {
          label: 'Field',
          sections: [
            { label: 'More', collect: 'remainingTools', items: [] },
            { label: 'Documents', collect: 'documentExports', items: [] },
            { label: 'Daily', items: ['export-map-pdf', 'roadName'] },
          ],
        },
      ],
    }
    const [more, documents, daily] = sectionsOf(resolveToolbar(toolbar)).map(toolsOf)
    expect(daily).toEqual(['export-map-pdf', 'roadName'])
    expect(documents).toContain('export-report')
    expect(more).toContain('export-csv')
    expect(more).toContain('terrainDisplay')
    const all = [...daily, ...documents, ...more]
    expect(new Set(all).size).toBe(all.length)
    expect(resolveToolbar({ ...toolbar, groups: [{ label: 'Survey', commands: ['stakeout'] }] }).groups).toEqual([
      { label: 'Survey', commands: ['stakeout'] },
    ])
  })
})
