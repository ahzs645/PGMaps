/**
 * The key of a saved view's background render job (`BackgroundRenders.tsx`), which also keys the finished figure in the
 * page's `engineFigures` and the project file. The view's id leads the key, so whose figure it is is read by building
 * the view's own prefix, never by splitting the key. No DOM access.
 */

/** What every key for one saved view begins with. */
export const renderJobKeyPrefix = (viewId: string) => `${viewId}|`

export function renderJobKey(parts: {
  viewId: string
  engine: string
  /** The scene the figure was drawn for (`sceneFingerprint`). */
  sceneKey: string | null
  phase?: 'before'
  /** The engine's capture options (`engineCaptureOptionsKey`). */
  optionsKey: string
}): string {
  const { viewId, engine, sceneKey, phase, optionsKey } = parts
  return `${renderJobKeyPrefix(viewId)}${engine}|${sceneKey ?? ''}${phase ? `|${phase}` : ''}|${optionsKey}`
}

/** Whether a job key is the figure of one of these saved views. */
export function renderJobIsFor(key: string, viewIds: Iterable<string>): boolean {
  for (const id of viewIds) if (key.startsWith(renderJobKeyPrefix(id))) return true
  return false
}
