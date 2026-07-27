declare module 'rbush' {
  export interface BBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }

  export default class RBush<T extends BBox> {
    constructor(maxEntries?: number)
    load(items: readonly T[]): this
    search(bbox: BBox): T[]
  }
}
