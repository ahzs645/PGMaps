import { ribbonFieldLabels, type RibbonFieldId } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronUp, ChevronDown, PanelTopClose, PanelTopOpen, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { TabBar } from '@/components/ui/tab-bar'
import { RibbonFinder, type RibbonResult } from './RibbonFinder'
import { RibbonGroupSettings, focusRibbonItem, settingsTitleFor } from './RibbonGroupSettings'
import { RibbonTaskPane } from './RibbonTaskPane'
import { RibbonStrip, RibbonTabs } from './RibbonNavigation'
import {
  isRibbonCommand as isCommand,
  ribbonWidgetLabels as widgetLabels,
  type RibbonTool as ToolId,
} from './ribbonToolCatalog'
import { workspaceCommands, type WorkspaceCommand } from './workspaceCommands'
import { layoutIcons, type WorkspaceToolbar, type WorkspaceWidget } from './workspaceLayouts'

export type CommandState = { disabled?: boolean; pressed?: boolean; hidden?: boolean; label?: string }
const isQuickField = (id: ToolId): id is RibbonFieldId => Object.prototype.hasOwnProperty.call(ribbonFieldLabels, id)
type OpenSettings = { tab: string; sectionIndex: number; label: string; focusItem?: ToolId }

export function WorkspaceTools({
  toolbar,
  disabled,
  onCommand,
  children,
  widgets,
  switcher,
  states,
  groupName,
  onGroupChange,
  editorMount,
  editorsAvailable,
  folded,
  onToggleFold,
  minimized,
  onToggleMinimized,
}: {
  groupName?: string
  onGroupChange: (label: string, folded?: boolean) => void
  folded: boolean
  onToggleFold: () => void
  minimized: boolean
  onToggleMinimized: () => void
  editorsAvailable: boolean
  editorMount?: (node: HTMLDivElement | null) => void
  children?: ReactNode
  toolbar: WorkspaceToolbar
  disabled: boolean
  onCommand: (action: WorkspaceCommand) => void
  widgets: Partial<Record<WorkspaceWidget, ReactNode>>
  switcher?: ReactNode
  states: Partial<Record<WorkspaceCommand, CommandState>>
}) {
  const panel = useRef<HTMLDivElement>(null)
  const editorLauncher = useRef<HTMLButtonElement>(null)
  const [focusResult, setFocusResult] = useState<RibbonResult | null>(null)
  const [settings, setSettings] = useState<OpenSettings | null>(null)
  useLayoutEffect(() => {
    if (!focusResult || !panel.current) return
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>('[data-ribbon-item]'))
    const item = items.find(
      (item) =>
        item.dataset.ribbonItem === focusResult.id &&
        item.closest<HTMLElement>('.lp-command-group')?.dataset.sectionIndex === focusResult.sectionIndex?.toString(),
    )
    focusRibbonItem(item ?? null)
  }, [focusResult])
  function visible(id: ToolId) {
    return isCommand(id) ? !states[id]?.hidden : Boolean(widgets[id])
  }
  const groups = toolbar.groups.filter(
    (group) =>
      (group.editor && editorsAvailable) ||
      (group.sections
        ? group.sections.some((section) => section.items.some(visible) || section.more?.some(visible))
        : group.commands?.some(visible)),
  )
  const selected = Math.max(
    0,
    groups.findIndex((group) => group.label === groupName),
  )
  const group = groups[selected]
  const paneEditor = toolbar.editorPlacement === 'pane'
  const detailed = !!group?.editor && !!editorMount && !folded
  const activeSection = settings && group?.sections?.[settings.sectionIndex]
  const settingsVisible =
    !!settings &&
    !(paneEditor && detailed) &&
    !minimized &&
    group?.label === settings.tab &&
    activeSection?.label === settings.label &&
    !!activeSection.more?.some(visible)
  if (settings && !settingsVisible) setSettings(null)
  if (!group)
    return (
      <>
        {children}
        {switcher}
      </>
    )

  const compact = toolbar.dock === 'top' && toolbar.compact
  const findTools = toolbar.dock === 'top' && (toolbar.findTools ?? compact)
  const quickAccess = toolbar.dock === 'top' ? (toolbar.quickAccess?.filter(visible) ?? []) : []
  function visibleInStrip(id: ToolId) {
    return visible(id) && !(detailed && !paneEditor && isQuickField(id))
  }

  function searchEntries(): RibbonResult[] {
    const ordered = [group, ...groups.filter((candidate) => candidate !== group)]
    const entries: RibbonResult[] = ordered.flatMap((group) =>
      (group.sections ?? [{ items: group.commands ?? [], label: undefined, more: undefined }]).flatMap(
        (section, index) =>
          [...new Set([...section.items, ...(section.more ?? [])])].filter(visible).map((id) => {
            const location = {
              tab: group.label,
              section: section.label,
              sectionIndex: group.sections ? index : undefined,
              inSettings: !section.items.some((inline) => inline === id),
              id,
            }
            if (isCommand(id)) {
              const { label, icon } = workspaceCommands[id]
              return {
                ...location,
                label: states[id]?.label ?? label,
                icon,
                disabled: states[id]?.disabled ?? disabled,
              }
            }
            return { ...location, label: widgetLabels[id], disabled: isQuickField(id) && disabled }
          }),
      ),
    )
    for (const id of quickAccess) {
      if (!entries.some((entry) => entry.id === id)) {
        const { label, icon } = workspaceCommands[id]
        entries.push({
          id,
          tab: group.label,
          section: 'Quick access',
          label: states[id]?.label ?? label,
          icon,
          disabled: states[id]?.disabled ?? disabled,
        })
      }
    }
    return entries
  }
  function pick(entry: RibbonResult) {
    if (entry.disabled) return
    if (isCommand(entry.id)) {
      setSettings(null)
      onGroupChange(entry.tab)
      onCommand(entry.id)
    } else {
      onGroupChange(entry.tab, true)
      if (entry.inSettings && entry.section !== undefined && entry.sectionIndex !== undefined) {
        setSettings({ tab: entry.tab, sectionIndex: entry.sectionIndex, label: entry.section, focusItem: entry.id })
      } else {
        setSettings(null)
        setFocusResult({ ...entry })
      }
    }
  }
  function item(id: ToolId, surface: 'strip' | 'pane', primary?: WorkspaceCommand) {
    const inSettings = surface === 'pane'
    if (!(inSettings ? visible(id) : visibleInStrip(id))) return null
    if (isQuickField(id))
      return (
        <fieldset
          className={inSettings ? 'lp-group-setting' : 'lp-quick-setting'}
          disabled={disabled}
          key={id}
          data-field={id}
          data-ribbon-item={id}
          tabIndex={-1}
        >
          {widgets[id]}
        </fieldset>
      )
    if (!isCommand(id))
      return (
        <div key={id} className="lp-ribbon-field" data-ribbon-item={id} tabIndex={-1}>
          {widgets[id]}
        </div>
      )
    return commandButton(id, surface, primary === id)
  }
  function commandButton(id: WorkspaceCommand, surface: 'strip' | 'pane' | 'quick', primary = false) {
    const quick = surface === 'quick'
    const state = states[id]
    const { label, icon: Icon } = workspaceCommands[id]
    const caption = state?.label ?? label
    return (
      <button
        type="button"
        className={quick ? 'lp-quick-command' : 'lp-command'}
        key={id}
        data-ribbon-item={id}
        data-primary={primary || undefined}
        onClick={() => {
          const opensTaskPane = id === 'customizeRibbon' || id === 'summarySettings'
          if (surface === 'pane' || opensTaskPane) setSettings(null)
          if (opensTaskPane && paneEditor && detailed) onGroupChange(group.label, true)
          onCommand(id)
        }}
        disabled={state?.disabled ?? disabled}
        aria-pressed={state?.pressed}
        aria-label={quick ? `Quick access: ${caption}` : undefined}
        title={quick ? caption : undefined}
      >
        <Icon size={quick ? 16 : 18} strokeWidth={1.65} aria-hidden="true" />
        {!quick && caption}
      </button>
    )
  }
  const editorButtonLabel = paneEditor
    ? folded
      ? 'All settings'
      : 'Close settings'
    : folded
      ? 'Expand ribbon settings'
      : 'Collapse ribbon settings'
  const EditorIcon = paneEditor ? (folded ? PanelRightOpen : PanelRightClose) : folded ? ChevronDown : ChevronUp
  const tabs = (
    <TabBar
      label={toolbar.tabsLabel}
      value={String(selected)}
      idPrefix="lp-workspace-tools"
      onChange={(value) => onGroupChange(groups[Number(value)].label)}
      options={groups.map((tab, index) => ({
        value: String(index),
        label: tab.label,
        icon: tab.icon && layoutIcons[tab.icon],
      }))}
    />
  )
  const tools = (group.sections || group.commands) && (
    <div className={group.sections ? 'lp-tools lp-grouped-tools' : 'lp-tools'}>
      {group.hint && <span className="lp-hint">{group.hint}</span>}
      {group.sections?.map((section, index) => {
        const hasInline = section.items.some(visibleInStrip)
        const hasSettings = section.more?.some(visible)
        if (!hasInline && !hasSettings) return null
        const open = settingsVisible && settings?.sectionIndex === index
        return (
          <div
            className="lp-command-group"
            data-section-index={index}
            role="group"
            aria-label={section.label}
            key={`${index}-${section.label}`}
          >
            {hasInline && (
              <div className="lp-group-items" data-rows={section.rows ?? (section.primary ? 2 : undefined)}>
                {section.items.map((id) => item(id, 'strip', section.primary))}
              </div>
            )}
            {hasSettings ? (
              <RibbonGroupSettings
                tab={group.label}
                label={section.label}
                open={open}
                standalone={!hasInline}
                focusItem={open ? settings?.focusItem : undefined}
                onOpenChange={(next) => {
                  if (next && paneEditor && detailed) onGroupChange(group.label, true)
                  setSettings((previous) =>
                    next
                      ? { tab: group.label, sectionIndex: index, label: section.label }
                      : previous?.tab === group.label && previous.sectionIndex === index
                        ? null
                        : previous,
                  )
                }}
              >
                {open && section.more?.map((id) => item(id, 'pane'))}
              </RibbonGroupSettings>
            ) : (
              <span className="lp-group-label" aria-hidden="true">
                {section.label}
              </span>
            )}
          </div>
        )
      }) ?? group.commands?.map((id) => item(id, 'strip'))}
    </div>
  )
  return (
    <section
      className={toolbar.dock === 'side' ? 'lp-guide' : 'lp-ribbon'}
      aria-label={toolbar.label}
      data-full-width={(toolbar.dock === 'top' && toolbar.fullWidth) || undefined}
      data-compact-ribbon={compact || undefined}
    >
      {children}
      {toolbar.title && <h2 className="lp-guide-title">{toolbar.title}</h2>}
      <div className={switcher || compact || findTools || quickAccess.length ? 'lp-ribbon-tabs' : 'contents'}>
        {compact ? (
          <RibbonTabs names={groups.map((tab) => tab.label)} active={group.label} onChoose={onGroupChange}>
            {tabs}
          </RibbonTabs>
        ) : (
          tabs
        )}
        {quickAccess.length > 0 && (
          <div role="group" aria-label="Quick access" className="lp-quick-access">
            {quickAccess.map((id) => commandButton(id, 'quick'))}
          </div>
        )}
        {findTools && <RibbonFinder entries={searchEntries} onPick={pick} />}
        {group.editor && editorMount && !minimized && (
          <button
            ref={editorLauncher}
            className="lp-fold-editors"
            type="button"
            aria-label={editorButtonLabel}
            aria-expanded={!folded}
            title={paneEditor ? `${editorButtonLabel} · ${group.label}` : editorButtonLabel}
            onClick={() => {
              setSettings(null)
              onToggleFold()
            }}
          >
            {toolbar.compact && <span>{paneEditor ? editorButtonLabel : folded ? 'More settings' : 'Less'}</span>}
            <EditorIcon size={16} aria-hidden="true" />
          </button>
        )}
        {compact && (
          <button
            type="button"
            className="lp-minimize"
            aria-expanded={!minimized}
            aria-label={minimized ? 'Show ribbon tools' : 'Minimize ribbon'}
            title={minimized ? 'Show ribbon tools' : 'Minimize ribbon'}
            onClick={onToggleMinimized}
          >
            {minimized ? <PanelTopOpen size={16} /> : <PanelTopClose size={16} />}
          </button>
        )}
        {switcher}
      </div>
      <div
        ref={panel}
        role="tabpanel"
        hidden={minimized}
        id={`lp-workspace-tools-panel-${selected}`}
        aria-labelledby={`lp-workspace-tools-tab-${selected}`}
      >
        {tools && (compact && group.sections ? <RibbonStrip key={group.label}>{tools}</RibbonStrip> : tools)}
        {editorMount &&
          (paneEditor && detailed && !minimized ? (
            <RibbonTaskPane
              key={group.editor}
              title={settingsTitleFor(group.label)}
              context={toolbar.label}
              onClose={onToggleFold}
              returnFocusRef={editorLauncher}
            >
              <div className="lp-pane-editor" ref={editorMount} />
            </RibbonTaskPane>
          ) : (
            <div className="lp-editor-slot" hidden={paneEditor || !group.editor || folded} ref={editorMount} />
          ))}
      </div>
    </section>
  )
}
