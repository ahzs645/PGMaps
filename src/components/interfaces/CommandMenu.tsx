import { Ellipsis } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { resolveCommandIn, useWorkspaceKit, type CommandState } from './workspaceKit'

/**
 * Registry commands folded into one More menu where a bar has no room for their buttons: the
 * ribbon's tab row on narrow screens. Labels, icons and availability come from the registry and
 * the workspace's states, as on the buttons it stands for. `extraItems` follow them, after a
 * separator, for tools outside the registry that fold in too (the colour scheme, help).
 */
export function CommandMenu<C extends string>({
  commands,
  states,
  disabled,
  onCommand,
  label = 'More workspace commands',
  triggerClassName,
  extraItems = [],
}: {
  commands: readonly C[]
  states: Partial<Record<C, CommandState>>
  disabled?: boolean
  onCommand: (id: C) => void
  label?: string
  triggerClassName?: string
  extraItems?: readonly ActionMenuItem[]
}) {
  const kit = useWorkspaceKit()
  const commandItems = commands.flatMap((id): ActionMenuItem[] => {
    const command = resolveCommandIn(kit.commands, id, states[id], disabled)
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
  const items =
    commandItems.length && extraItems.length
      ? [...commandItems, { type: 'separator' as const, id: 'extra-separator' }, ...extraItems]
      : [...commandItems, ...extraItems]
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
