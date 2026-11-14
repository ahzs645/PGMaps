import { Search, Settings2, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { SearchResultContent } from '@/components/ui/search-combobox'
import { SearchPalette } from '@/components/ui/search-palette'
import { isApplePlatform } from '@/lib/platform'
import type { WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'

interface SearchLocation {
  label: string
  tab: string
  section?: string
  sectionIndex?: number
  inSettings?: boolean
  disabled: boolean
  icon?: LucideIcon
}

export type ToolResult = SearchLocation & { id: WorkspaceCommand | WorkspaceWidget; target?: undefined }
export type EditorResult = SearchLocation & { id: string; target: HTMLElement }
export type RibbonResult = ToolResult | EditorResult

/** The words a result is found by: its label, its command id as words, and where it sits. */
function matches(entry: RibbonResult, terms: string[]) {
  const words = [
    entry.label,
    entry.id.replace(/([a-z])([A-Z])/g, '$1 $2'),
    entry.tab,
    entry.section,
    entry.inSettings && 'settings',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return terms.every((term) => words.includes(term))
}

/** Results under one heading per tab, tabs in the order they first appear (the open tab first). */
function byTab(entries: RibbonResult[]) {
  const tabs = new Map<string, RibbonResult[]>()
  for (const entry of entries) tabs.set(entry.tab, [...(tabs.get(entry.tab) ?? []), entry])
  return [...tabs.values()].flat()
}

export function RibbonFinder({
  entries,
  onPick,
}: {
  entries: () => RibbonResult[]
  onPick: (entry: RibbonResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // The list follows the ribbon while the finder is open (a tool that becomes available says so),
  // and keeps its last reading while the finder closes.
  const [closing, setClosing] = useState<RibbonResult[]>([])
  const tools = open ? entries() : closing
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = byTab(tools.filter((entry) => matches(entry, terms)))
  const show = useCallback(() => {
    setQuery('')
    setOpen(true)
  }, [])
  const shortcut = isApplePlatform() ? '⌥Q' : 'Alt+Q'
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      // Option+Q can produce a symbol on macOS. Preserve normal text entry and other dialogs.
      if (event.code !== 'KeyQ' && event.key.toLowerCase() !== 'q') return
      if (document.querySelector('dialog[open], [role="dialog"][data-state="open"], [aria-modal="true"]')) return
      if (
        isApplePlatform() &&
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      )
        return
      event.preventDefault()
      show()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [show])
  return (
    <>
      <button
        type="button"
        className="lp-find-tools"
        aria-label="Find tools"
        aria-haspopup="dialog"
        aria-keyshortcuts="Alt+Q"
        title={`Find tools (${shortcut})`}
        onClick={show}
      >
        <Search size={15} aria-hidden="true" />
        <span>Find tools</span>
        <kbd>{shortcut}</kbd>
      </button>
      <SearchPalette
        open={open}
        onOpenChange={(next) => {
          if (!next) setClosing(tools)
          setOpen(next)
        }}
        title="Find ribbon tools"
        description="Search the ribbon's tools and settings by name, tab or group."
        inputLabel="Search ribbon tools"
        placeholder="Search tools and settings"
        resultsLabel="Matching ribbon tools"
        query={query}
        onQueryChange={setQuery}
        items={results}
        onPick={onPick}
        getKey={(entry, i) => [entry.tab, entry.section, entry.id, i].join('/')}
        getGroup={(entry) => entry.tab}
        isDisabled={(entry) => entry.disabled}
        // An unavailable tool stays reachable so its "Unavailable" note is read out.
        combobox={{ skipDisabled: false, scrollIntoView: 'always' }}
        empty="No matching ribbon tools."
        countLabel={(count) => `${count} ${count === 1 ? 'tool' : 'tools'}`}
        renderOption={(entry) => {
          const Icon = entry.icon ?? Settings2
          return (
            <SearchResultContent
              icon={<Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              title={entry.label}
              detail={[entry.section, entry.inSettings && 'Settings'].filter(Boolean).join(' › ') || undefined}
              trailing={entry.disabled && <span className="shrink-0 text-xs text-muted-foreground">Unavailable</span>}
            />
          )
        }}
      />
    </>
  )
}
