export interface MobileCardStackEntry {
  id: string
  visibleHeight: number
}
const EMPTY: MobileCardStackEntry[] = []
/** Independent external store: no card state is shared between workspaces. */
export function createMobileCardStack() {
  let entries: MobileCardStackEntry[] = []
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => entries,
    getServerSnapshot: () => EMPTY,
    push(id: string) {
      const existing = entries.find((entry) => entry.id === id)
      entries = [...entries.filter((entry) => entry.id !== id), existing ?? { id, visibleHeight: 0 }]
      emit()
    },
    remove(id: string) {
      if (!entries.some((entry) => entry.id === id)) return
      entries = entries.filter((entry) => entry.id !== id)
      emit()
    },
    setHeight(id: string, visibleHeight: number) {
      const index = entries.findIndex((entry) => entry.id === id)
      if (index < 0 || entries[index].visibleHeight === visibleHeight) return
      entries = entries.map((entry, i) => (i === index ? { ...entry, visibleHeight } : entry))
      emit()
    },
    reset() {
      entries = []
      emit()
    },
  }
}
export type MobileCardStackStore = ReturnType<typeof createMobileCardStack>
