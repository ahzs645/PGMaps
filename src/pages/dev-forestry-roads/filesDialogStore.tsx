import { useState, useSyncExternalStore, type ComponentProps } from 'react'
import { FilesDialog, type RoadExport } from './FilesDialog'

/**
 * Which Save & export output is open and shown, kept outside the designer page's state. Opening,
 * closing or choosing an output then renders the dialog alone: as page state, each click re-rendered
 * the charts, the cost breakdown and the plan (59–118 ms a click in the dev build).
 */
export type FilesDialogState = {
  /** The output the dialog was opened on, or null while it is closed. */
  output: RoadExport | null
  /** The output shown; a live lesson reads and sets it. */
  selected: RoadExport
  /** The day the dialog was opened (YYYY-MM-DD), printed while the issue stamp has no date. */
  today: string
}

export type FilesDialogStore = {
  get: () => FilesDialogState
  subscribe: (listener: () => void) => () => void
  open: (output: RoadExport, today: string) => void
  select: (output: RoadExport) => void
  close: () => void
}

export function createFilesDialogStore(): FilesDialogStore {
  let state: FilesDialogState = { output: null, selected: 'project', today: '' }
  const listeners = new Set<() => void>()
  const set = (next: Partial<FilesDialogState>) => {
    if (Object.entries(next).every(([key, value]) => state[key as keyof FilesDialogState] === value)) return
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open: (output, today) => set({ output, selected: output, today }),
    select: (selected) => set({ selected }),
    close: () => set({ output: null }),
  }
}

/** One store for the component's lifetime. */
export function useFilesDialogStore(): FilesDialogStore {
  return useState(createFilesDialogStore)[0]
}

const NO_SUBSCRIPTION = () => () => {}

/** The dialog's state, re-rendering the caller on a change only while `follow` is set. */
export function useFilesDialogState(store: FilesDialogStore, follow = true): FilesDialogState {
  return useSyncExternalStore(follow ? store.subscribe : NO_SUBSCRIPTION, store.get)
}

type StoredProps = Omit<
  ComponentProps<typeof FilesDialog>,
  'open' | 'initialOutput' | 'selected' | 'onSelectedChange' | 'onOpenChange' | 'today'
> & {
  store: FilesDialogStore
  /** False hides the dialog whatever the store says (an access investigation has no Save & export). */
  available: boolean
}

/** Save & export, opened, closed and switched between outputs through its store. */
export function StoredFilesDialog({ store, available, ...props }: StoredProps) {
  const { output, selected, today } = useFilesDialogState(store)
  return (
    <FilesDialog
      {...props}
      open={available && output !== null}
      initialOutput={output ?? 'project'}
      selected={selected}
      onSelectedChange={store.select}
      onOpenChange={(open) => {
        if (!open) store.close()
      }}
      today={today}
    />
  )
}
