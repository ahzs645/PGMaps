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

  update(visible: Array<{ id: string; data: T }>) {
    for (const block of this.blocks.values()) block.visible = false
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
