import { Search, Settings2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { isApplePlatform } from '@/pages/dev-forestry-roads/historyShortcut'
import type { WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'

export interface RibbonResult {
  id: WorkspaceCommand | WorkspaceWidget
  label: string
  tab: string
  section?: string
  sectionIndex?: number
  inSettings?: boolean
  disabled: boolean
  icon?: LucideIcon
}

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
  const listId = useId()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = entries.filter(({ label, id, tab, section, inSettings }) => {
    const words = [label, id.replace(/([a-z])([A-Z])/g, '$1 $2'), tab, section, inSettings && 'settings']
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return terms.every((term) => words.includes(term))
  })
  const active = Math.min(index, results.length - 1)
  const activeId = active >= 0 ? `${listId}-${active}` : undefined

  useLayoutEffect(() => {
    const node = dialog.current!
    node.showModal()
    input.current?.focus()
    return () => node.close()
  }, [])
  useLayoutEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId, query])

  function pick(entry: RibbonResult) {
    if (entry.disabled) return
    // Close synchronously so a result that opens a file picker keeps the user's activation.
    dialog.current?.close()
    onClose()
    onPick(entry)
  }
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
      <div className="lp-search-box">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search ribbon tools"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeId}
          placeholder="Search tools and settings"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !results.length) return
            if (event.key === 'Enter') {
              event.preventDefault()
              pick(results[active])
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((active + (event.key === 'ArrowUp' ? -1 : 1) + results.length) % results.length)
            }
          }}
        />
        <button type="button" aria-label="Close tool search" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div id={listId} role="listbox" aria-label="Matching ribbon tools" className="lp-search-results">
        {results.map((entry, i) => {
          const Icon = entry.icon ?? Settings2
          return (
            <div
              key={[entry.tab, entry.section, entry.id, i].join('/')}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active === i}
              aria-disabled={entry.disabled || undefined}
              onClick={() => pick(entry)}
            >
              <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
              <span>
                <strong>{entry.label}</strong>
                <small>{[entry.tab, entry.section, entry.inSettings && 'Settings'].filter(Boolean).join(' › ')}</small>
              </span>
              {entry.disabled && <small>Unavailable</small>}
            </div>
          )
        })}
      </div>
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
