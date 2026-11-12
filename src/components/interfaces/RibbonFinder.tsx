import { Search, Settings2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SearchComboboxInput, SearchResultList, useSearchCombobox } from '@/components/ui/search-combobox'
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

function ToolSearch({
  entries,
  onClose,
  onPick,
}: {
  entries: RibbonResult[]
  onClose: () => void
  onPick: (entry: RibbonResult) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = entries.filter(({ label, id, tab, section, inSettings }) => {
    const words = [label, id.replace(/([a-z])([A-Z])/g, '$1 $2'), tab, section, inSettings && 'settings']
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return terms.every((term) => words.includes(term))
  })
  const combobox = useSearchCombobox({
    items: results,
    isDisabled: (entry) => entry.disabled,
    // An unavailable tool stays reachable so its "Unavailable" note is read out.
    skipDisabled: false,
    resetKey: query,
    scrollIntoView: 'always',
    onPick: (entry) => {
      // Close synchronously so a result that opens a file picker keeps the user's activation.
      dialog.current?.close()
      onClose()
      onPick(entry)
    },
  })

  useLayoutEffect(() => {
    const node = dialog.current!
    node.showModal()
    input.current?.focus()
    return () => node.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="lp-tool-search"
      aria-label="Find ribbon tools"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <SearchComboboxInput
        ref={input}
        combobox={combobox}
        variant="bare"
        boxClassName="lp-search-box"
        icon={<Search size={18} aria-hidden="true" />}
        aria-label="Search ribbon tools"
        placeholder="Search tools and settings"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClose={onClose}
        closeLabel="Close tool search"
        buttonIcon={<X size={18} />}
      />
      <SearchResultList
        combobox={combobox}
        aria-label="Matching ribbon tools"
        className="lp-search-results"
        getKey={(entry, i) => [entry.tab, entry.section, entry.id, i].join('/')}
        renderOption={(entry) => {
          const Icon = entry.icon ?? Settings2
          return (
            <>
              <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
              <span>
                <strong>{entry.label}</strong>
                <small>{[entry.tab, entry.section, entry.inSettings && 'Settings'].filter(Boolean).join(' › ')}</small>
              </span>
              {entry.disabled && <small>Unavailable</small>}
            </>
          )
        }}
      />
      {!results.length && <p role="status">No matching ribbon tools.</p>}
    </dialog>
  )
}

export function RibbonFinder({
  entries,
  onPick,
}: {
  entries: () => RibbonResult[]
  onPick: (entry: RibbonResult) => void
}) {
  const [open, setOpen] = useState(false)
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
      setOpen(true)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])
  return (
    <>
      <button
        type="button"
        className="lp-find-tools"
        aria-label="Find tools"
        aria-haspopup="dialog"
        aria-keyshortcuts="Alt+Q"
        title={`Find tools (${shortcut})`}
        onClick={() => setOpen(true)}
      >
        <Search size={15} aria-hidden="true" />
        <span>Find tools</span>
        <kbd>{shortcut}</kbd>
      </button>
      {open && <ToolSearch entries={entries()} onClose={() => setOpen(false)} onPick={onPick} />}
    </>
  )
}
