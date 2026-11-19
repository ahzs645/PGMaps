export type ResidentBlock<T> = { id: string; data: T; visible: boolean }

/** Retain already-drawn blocks so deck.gl can keep their GPU state by stable ID. */
export class ResidentRasterBlocks<T> {
  private blocks = new Map<string, ResidentBlock<T>>()

  constructor(private idleLimit = 48) {}

  hasAll(blocks: Array<{ id: string; data: T }>) {
    return blocks.every((block) => this.blocks.get(block.id)?.data === block.data)
  }

  get(id: string) {
    return this.blocks.get(id)?.data
  }

  /**
   * Show `visible`; add `warm` blocks hidden, so their GPU state is built a few at a time before a
   * level switch shows them all at once. Warm blocks are idle and count against the idle budget.
   */
  update(visible: Array<{ id: string; data: T }>, warm: Array<{ id: string; data: T }> = []) {
    for (const block of this.blocks.values()) block.visible = false
    const shown = new Set(visible.map((block) => block.id))
    for (const block of warm) {
      if (shown.has(block.id) || this.blocks.get(block.id)?.data === block.data) continue
      this.blocks.delete(block.id)
      this.blocks.set(block.id, { ...block, visible: false })
    }
    for (const block of visible) {
      this.blocks.delete(block.id)
      this.blocks.set(block.id, { ...block, visible: true })
    }
    const idle = [...this.blocks.values()].filter((block) => !block.visible)
    for (const block of idle.slice(0, Math.max(0, idle.length - this.idleLimit))) this.blocks.delete(block.id)
    return [...this.blocks.values()]
  }

  clear() {
    this.blocks.clear()
  }
}
