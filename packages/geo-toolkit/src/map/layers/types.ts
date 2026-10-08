/** Feature identity shared by selection props across vector layer renderers. */
export type MapFeatureId = string | number
/** MapLibre expression tokens; accepts readonly arrays authored with `as const`. */
export type MapStyleExpression = readonly unknown[]
/** A paint property can be a literal or an expression evaluated by MapLibre. */
export type MapStyleValue<T> = T | MapStyleExpression
/** Modifier keys exposed by vector feature selection callbacks. */
export interface MapFeatureModifiers {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}
export type MapFeatureProperties = Record<string, unknown>
export type MapFeatureClickHandler = (id: string, event: MapFeatureModifiers, properties: MapFeatureProperties) => void

export const EMPTY_SELECTED_IDS: readonly MapFeatureId[] = []
