import { describe, expect, it } from 'vitest'
import { workspaceCommandIds, workspaceCommands } from './workspaceCommands'

describe('workspace command registry', () => {
  it('gives every command its own icon, so neighbours in a ribbon group never look alike', () => {
    const byIcon = new Map<unknown, string[]>()
    for (const id of workspaceCommandIds) {
      const icon = workspaceCommands[id].icon
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), id])
    }
    expect([...byIcon.values()].filter((ids) => ids.length > 1)).toEqual([])
  })
})
