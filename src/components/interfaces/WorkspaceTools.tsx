import { ribbonFieldLabels, type RibbonFieldId } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronUp, ChevronDown, PanelRightOpen, PanelRightClose } from 'lucide-react'
import { TabBar } from '@/components/ui/tab-bar'
import { AccessLockup } from './AccessLockup'
import { RibbonFinder, type RibbonResult, type ToolResult } from './RibbonFinder'
import { editorSections, revealEditorSection } from './ribbonEditorSections'
import { RibbonGroupSettings, focusRibbonItem, settingsTitleFor } from './RibbonGroupSettings'
import { RibbonTaskPane } from './RibbonTaskPane'
import { RibbonStrip, RibbonTabs } from './RibbonNavigation'
import {
  isRibbonCommand as isCommand,
  ribbonWidgetLabels as widgetLabels,
  type RibbonTool as ToolId,
} from './ribbonToolCatalog'
import { resolveCommand, type CommandState, type WorkspaceCommand } from './workspaceCommands'
import { CommandButton } from './CommandButton'
import { CommandMenu } from './CommandMenu'
import { layoutIcons, type WorkspaceToolbar, type WorkspaceWidget } from './workspaceLayouts'

export type { CommandState }
const isQuickField = (id: ToolId): id is RibbonFieldId => Object.prototype.hasOwnProperty.call(ribbonFieldLabels, id)
type OpenSettings = { tab: string; sectionIndex: number; label: string; focusItem?: ToolId }

export function WorkspaceTools({
  toolbar,
  disabled,
  onCommand,
  children,
  widgets,
  leading,
  quickTools,
  narrowMenu = [],
  switcher,
  states,
  groupName,
  onGroupChange,
  editorMount,
  editorHost,
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
  editorHost?: HTMLElement
  editorMount?: (node: HTMLDivElement | null) => void
  children?: ReactNode
  toolbar: WorkspaceToolbar
  disabled: boolean
  onCommand: (action: WorkspaceCommand) => void
  widgets: Partial<Record<WorkspaceWidget, ReactNode>>
  /** Before the tabs, e.g. the way back out of the tool. */
  leading?: ReactNode
  /** Right after quick access and shown at every width, e.g. the edit history beside undo and redo. */
  quickTools?: ReactNode
  /**
   * Commands whose tab-row buttons fold into the More menu on narrow screens, with quick access
   * (see `.lp-ribbon-more` in interfaces.css), e.g. the interface switch.
   */
  narrowMenu?: WorkspaceCommand[]
  /** The end of the tab row, e.g. the save status and the interface switch. */
  switcher?: ReactNode
  states: Partial<Record<WorkspaceCommand, CommandState>>
}) {
  const panel = useRef<HTMLDivElement>(null)
  const editorLauncher = useRef<HTMLButtonElement>(null)
  const [focusResult, setFocusResult] = useState<ToolResult | null>(null)
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
  const productLogo = toolbar.header === 'controls' && <AccessLockup compact />
  const tabTools = toolbar.tabTools?.map((id) => (
    <Fragment key={id}>
      {isCommand(id) ? (
        <CommandButton id={id} surface="header" state={states[id]} disabled={disabled} onRun={onCommand} />
      ) : (
        widgets[id]
      )}
    </Fragment>
  ))
  if (!group)
    return (
      <>
        {children}
        {productLogo || tabTools?.length ? (
          <div className="lp-ribbon-tabs">
            {productLogo}
            {tabTools}
            {switcher}
          </div>
        ) : (
          switcher
        )}
      </>
    )

  const compact = toolbar.dock === 'top' && toolbar.compact
  const findTools = toolbar.dock === 'top' && (toolbar.findTools ?? compact)
  const quickAccess = toolbar.dock === 'top' ? (toolbar.quickAccess?.filter(visible) ?? []) : []

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
              const { label, icon, disabled: off } = resolveCommand(id, states[id], disabled)
              return { ...location, label, icon, disabled: off }
            }
            return { ...location, label: widgetLabels[id], disabled: isQuickField(id) && disabled }
          }),
      ),
    )
    for (const id of quickAccess) {
      if (!entries.some((entry) => entry.id === id)) {
        const { label, icon, disabled: off } = resolveCommand(id, states[id], disabled)
        entries.push({ id, tab: group.label, section: 'Quick access', label, icon, disabled: off })
      }
    }
    if (editorHost && editorsAvailable) entries.push(...editorSections(editorHost, ordered, disabled))
    return entries
  }
  function pick(entry: RibbonResult) {
    if (entry.disabled) return
    if (entry.target) {
      setSettings(null)
      onGroupChange(entry.tab, false)
      const target = entry.target
      requestAnimationFrame(() => revealEditorSection(target))
    } else if (isCommand(entry.id)) {
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
    if (!visible(id)) return null
    if (isQuickField(id)) {
      // An open editor shows every field, so there is one live input per value: the strip keeps an
      // inert copy in place, hidden from assistive technology, so the strip does not reflow.
      const mirror = !inSettings && detailed
      return (
        <fieldset
          className={inSettings ? 'lp-group-setting' : 'lp-quick-setting'}
          disabled={disabled}
          key={id}
          data-field={mirror ? undefined : id}
          data-ribbon-item={mirror ? undefined : id}
          data-mirror={mirror || undefined}
          aria-hidden={mirror || undefined}
          ref={(node) => {
            if (node) node.inert = mirror
          }}
          tabIndex={mirror ? undefined : -1}
        >
          {widgets[id]}
        </fieldset>
      )
    }
    if (!isCommand(id))
      return (
        <div key={id} className="lp-ribbon-field" data-ribbon-item={id} tabIndex={-1}>
          {widgets[id]}
        </div>
      )
    return commandButton(id, surface, primary === id)
  }
  function commandButton(id: WorkspaceCommand, surface: 'strip' | 'pane' | 'quick', primary = false) {
    return (
      <CommandButton
        key={id}
        id={id}
        state={states[id]}
        disabled={disabled}
        surface={surface === 'quick' ? 'quick' : 'ribbon'}
        primary={primary}
        onRun={(command) => {
          // A task pane replaces the open group settings; a pane-placed editor folds so the two never stack.
          const opensTaskPane = resolveCommand(command, undefined).kind === 'pane'
          if (surface === 'pane' || opensTaskPane) setSettings(null)
          if (opensTaskPane && paneEditor && detailed) onGroupChange(group.label, true)
          onCommand(command)
        }}
      />
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
        const hasInline = section.items.some(visible)
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
      <div
        className={
          switcher || leading || quickTools || compact || findTools || quickAccess.length || tabTools?.length
            ? 'lp-ribbon-tabs'
            : 'contents'
        }
      >
        {leading}
        {productLogo}
        {compact ? (
          <RibbonTabs names={groups.map((tab) => tab.label)} active={group.label} onChoose={onGroupChange}>
            {tabs}
          </RibbonTabs>
        ) : (
          tabs
        )}
        {/* The tab's own settings sit beside the tabs: tools to the right stay put when a tab has none. */}
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
        {quickAccess.length > 0 && (
          <div role="group" aria-label="Quick access" className="lp-quick-access">
            {quickAccess.map((id) => commandButton(id, 'quick'))}
          </div>
        )}
        {quickTools}
        {(quickAccess.length > 0 || narrowMenu.length > 0) && (
          <span className="lp-ribbon-more">
            <CommandMenu
              commands={[...quickAccess, ...narrowMenu]}
              states={states}
              disabled={disabled}
              onCommand={onCommand}
              triggerClassName="lp-ribbon-more-trigger"
            />
          </span>
        )}
        {findTools && <RibbonFinder entries={searchEntries} onPick={pick} />}
        {tabTools}
        {switcher}
        {compact && (
          <button
            type="button"
            className="lp-minimize"
            aria-expanded={!minimized}
            aria-label={minimized ? 'Show ribbon tools' : 'Minimize ribbon'}
            title={minimized ? 'Show ribbon tools' : 'Minimize ribbon'}
            onClick={onToggleMinimized}
          >
            {minimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        )}
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
