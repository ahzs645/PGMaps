import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Pin, PinOff, Settings2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppSelect, compactSelectTriggerClass, workspaceSelectContentClass } from '@/components/ui/select'
import { RibbonTaskPane, restorePaneFocus } from './RibbonTaskPane'
import { workspaceCommands } from './workspaceCommands'
import { isRibbonCommand, ribbonToolLabel, type RibbonTool } from './ribbonToolCatalog'
import { groupKey, type RibbonSection, type RibbonTab } from './ribbonPreferences'
import type { WorkspaceToolbar } from './workspaceLayouts'
import './ribbonCustomization.css'

function move<T>(list: readonly T[], index: number, direction: number) {
  const result = [...list]
  const target = index + direction
  if (index >= 0 && target >= 0 && target < list.length) {
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function Action({
  label,
  icon: Icon,
  disabled,
  text,
  onClick,
}: {
  label: string
  icon: LucideIcon
  text?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="lp-arrange-action"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={16} />
      {text && <span>{text}</span>}
    </button>
  )
}

export function CustomizeRibbonPane({
  toolbar,
  defaults,
  currentTab,
  onApply,
  onClose,
}: {
  toolbar: WorkspaceToolbar
  defaults: WorkspaceToolbar
  currentTab?: string
  onApply: (toolbar: WorkspaceToolbar) => void
  onClose: () => void
}) {
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [draft, setDraft] = useState(toolbar)
  const [tabName, setTabName] = useState(currentTab)
  const [selectedGroup, setSelectedGroup] = useState<string>()
  const listRef = useRef<HTMLDivElement>(null)
  const tabs = draft.groups.filter((tab) => tab.sections?.length)
  const tab = tabs.find((tab) => tab.label === tabName) ?? tabs[0]
  if (!tab?.sections) return null
  const groups = tab.sections
  const groupIndex = Math.max(
    0,
    groups.findIndex((section) => groupKey(section) === selectedGroup),
  )
  const section = groups[groupIndex]
  const dirty = draft !== toolbar

  function updateGroups(sections: RibbonSection[]) {
    setDraft((old) => ({
      ...old,
      groups: old.groups.map((candidate: RibbonTab) =>
        candidate.label === tab.label ? { ...candidate, sections } : candidate,
      ),
    }))
  }
  function updateSection(next: RibbonSection) {
    updateGroups(groups.map((group) => (group === section ? next : group)))
  }
  function reorderGroup(direction: number) {
    setSelectedGroup(groupKey(section))
    updateGroups(move(groups, groupIndex, direction))
  }
  function transfer(id: RibbonTool, toStrip: boolean) {
    const inline = section.items
    const more = section.more ?? []
    const next = toStrip
      ? { ...section, items: [...inline.filter((item) => item !== id), id], more: more.filter((item) => item !== id) }
      : { ...section, items: inline.filter((item) => item !== id), more: [...more.filter((item) => item !== id), id] }
    updateSection(next)
    requestAnimationFrame(() => {
      const moved = listRef.current?.querySelector<HTMLElement>(`[data-arrange-tool="${id}"]`)
      moved?.focus()
    })
  }
  function toolList(area: 'items' | 'more') {
    const tools = section[area] ?? []
    const inline = area === 'items'
    const title = inline ? 'On the ribbon' : 'In group settings'
    return (
      <section className="lp-arrange-tools" aria-label={title}>
        <h3>{title}</h3>
        {!tools.length && (
          <p>{inline ? 'Use the group caption to open its tools.' : 'No tools in this group’s settings.'}</p>
        )}
        <ul>
          {tools.map((id, index) => {
            const caption = ribbonToolLabel(id)
            const Icon = isRibbonCommand(id) ? workspaceCommands[id].icon : Settings2
            return (
              <li key={id} tabIndex={-1} data-arrange-tool={id}>
                <Icon size={16} strokeWidth={1.65} aria-hidden="true" />
                <span>{caption}</span>
                <Action
                  label={`Move ${caption} up`}
                  icon={ArrowUp}
                  disabled={index === 0}
                  onClick={() => updateSection({ ...section, [area]: move(tools, index, -1) })}
                />
                <Action
                  label={`Move ${caption} down`}
                  icon={ArrowDown}
                  disabled={index === tools.length - 1}
                  onClick={() => updateSection({ ...section, [area]: move(tools, index, 1) })}
                />
                <Action
                  label={inline ? `Move ${caption} to group settings` : `Show ${caption} on the ribbon`}
                  icon={inline ? PinOff : Pin}
                  text={inline ? 'Unpin' : 'Pin'}
                  onClick={() => transfer(id, !inline)}
                />
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  function finish(apply: boolean) {
    if (apply) onApply(draft)
    else onClose()
    const selectedTab = document.querySelector<HTMLElement>('.lp-ribbon [role="tab"][aria-selected="true"]')
    restorePaneFocus(opener.current?.isConnected ? opener.current : selectedTab)
  }

  return (
    <RibbonTaskPane
      title="Customize ribbon"
      subtitle="Arrange groups and choose which tools appear on this device."
      onClose={onClose}
      returnFocusRef={opener}
      footer={
        <div className="lp-arrange-footer">
          <Button variant="ghost" size="sm" onClick={() => setDraft(defaults)}>
            Restore defaults
          </Button>
          <Button variant="outline" size="sm" onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!dirty} onClick={() => finish(true)}>
            Apply
          </Button>
        </div>
      }
    >
      <div className="lp-arrange">
        <div className="lp-arrange-tab">
          <span aria-hidden="true">Ribbon tab</span>
          <AppSelect
            triggerAriaLabel="Ribbon tab"
            triggerClassName={compactSelectTriggerClass}
            contentClassName={workspaceSelectContentClass}
            value={tab.label}
            onValueChange={(value) => {
              setTabName(value)
              setSelectedGroup(undefined)
            }}
            options={tabs.map((entry) => ({ value: entry.label, label: entry.label }))}
          />
        </div>
        <div className="lp-arrange-body">
          <section className="lp-arrange-groups" aria-label="Group order">
            <div className="lp-arrange-group-heading">
              <h3>Group order</h3>
              <Action
                label={`Move ${section.label} earlier`}
                icon={ArrowUp}
                disabled={groupIndex === 0}
                onClick={() => reorderGroup(-1)}
              />
              <Action
                label={`Move ${section.label} later`}
                icon={ArrowDown}
                disabled={groupIndex === groups.length - 1}
                onClick={() => reorderGroup(1)}
              />
            </div>
            <ul>
              {groups.map((group) => (
                <li key={groupKey(group)}>
                  <button
                    type="button"
                    aria-pressed={group === section}
                    onClick={() => setSelectedGroup(groupKey(group))}
                  >
                    {group.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <div ref={listRef} className="lp-arrange-lists">
            {toolList('items')}
            {toolList('more')}
          </div>
        </div>
      </div>
    </RibbonTaskPane>
  )
}
