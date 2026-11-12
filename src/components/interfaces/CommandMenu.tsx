import { Ellipsis } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'

/**
 * Registry commands folded into one More menu where a bar has no room for their buttons: the
 * header line between 768 and 1023 px, the ribbon's tab row on narrow screens. Labels, icons and
 * availability come from the registry and the workspace's states, as on the buttons it stands for.
 */
export function CommandMenu({
  commands,
  states,
  disabled,
  onCommand,
  label = 'More workspace commands',
  triggerClassName,
}: {
  commands: readonly WorkspaceCommand[]
  states: Partial<Record<WorkspaceCommand, CommandState>>
  disabled?: boolean
  onCommand: (id: WorkspaceCommand) => void
  label?: string
  triggerClassName?: string
}) {
  const items = commands.flatMap((id) => {
    const command = resolveCommand(id, states[id], disabled)
    if (command.hidden) return []
    const Icon = command.icon
    return [
      {
        id,
        label: command.shortcut ? `${command.label} (${command.shortcut})` : command.label,
        icon: <Icon className="size-4" aria-hidden="true" />,
        disabled: command.disabled,
        onSelect: () => onCommand(id),
      },
    ]
  })
  if (!items.length) return null
  return (
    <ActionMenu
      label={label}
      triggerClassName={triggerClassName}
      trigger={<Ellipsis className="size-4" aria-hidden="true" />}
      items={items}
    />
  )
}
