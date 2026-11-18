import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders `children` once, in a host element that moves into `target` while there is one and is detached otherwise.
 * Its state and effects run all the time: use it for a panel whose state outlives the place that shows it (a dialog
 * pane mounted only while open), where rendering it in that place would reset it on every opening. React remounts a
 * portal whose container changes, so the portal's container stays fixed and the DOM node is what moves.
 */
export function MovableContent({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  const [host] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    if (!target) return
    target.appendChild(host)
    return () => host.remove()
  }, [target, host])
  return createPortal(children, host)
}

// ------------------------------------------------------------------------------------------------ projection
//
// One piece of a page shown in a second place: a sidebar section edited inside a dialog. The piece is rendered once,
// where it lives (`Projectable`), and its DOM moves into a `ProjectionSlot` with the same id while one is mounted, so
// both places show the same controls with the same state, and nothing is rendered twice. The two find each other by
// id through this store rather than a provider, because the slot usually sits in a dialog built far from the piece.

const slots = new Map<string, HTMLElement>()
const sources = new Map<string, number>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether a `Projectable` with this id is mounted, so a place that could show it knows whether to offer to. */
export function useProjectableMounted(id: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!id && (sources.get(id) ?? 0) > 0,
    () => false,
  )
}

const ProjectedContext = createContext(false)

/**
 * Whether the content is shown in a `ProjectionSlot` now, away from its home. A piece that folds, or draws itself for
 * a narrow sidebar, reads this to open up where it is shown on its own (`ToolSection` unfolds).
 */
export const useProjected = () => useContext(ProjectedContext)

/**
 * Content that lives here and can be shown in a `ProjectionSlot` with the same `id` instead. While it is away, `away`
 * is shown in its place. It is mounted once and keeps its state and its React parents (context, event handlers)
 * wherever it is shown; only its DOM node moves.
 */
export function Projectable({ id, away, children }: { id: string; away?: ReactNode; children: ReactNode }) {
  const [home, setHome] = useState<HTMLElement | null>(null)
  const slot = useSyncExternalStore(
    subscribe,
    () => slots.get(id) ?? null,
    () => null,
  )
  useEffect(() => {
    sources.set(id, (sources.get(id) ?? 0) + 1)
    emit()
    return () => {
      const left = (sources.get(id) ?? 1) - 1
      if (left > 0) sources.set(id, left)
      else sources.delete(id)
      emit()
    }
  }, [id])
  return (
    <>
      <div ref={setHome} className="contents" data-projectable={id} />
      {slot ? away : null}
      <MovableContent target={slot ?? home}>
        <ProjectedContext.Provider value={!!slot}>{children}</ProjectedContext.Provider>
      </MovableContent>
    </>
  )
}

/**
 * Where the `Projectable` with this `id` is shown while this is mounted. One slot an id at a time: a second one
 * mounted for the same id takes the content, and gives it back to the first when it unmounts.
 */
export function ProjectionSlot({ id, ...props }: { id: string } & HTMLAttributes<HTMLDivElement>) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    const before = slots.get(id)
    slots.set(id, element)
    emit()
    return () => {
      if (slots.get(id) !== element) return
      if (before?.isConnected) slots.set(id, before)
      else slots.delete(id)
      emit()
    }
  }, [id, element])
  return <div ref={setElement} data-projection-slot={id} {...props} />
}
