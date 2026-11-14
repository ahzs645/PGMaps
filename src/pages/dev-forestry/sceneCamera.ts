/** The perspective frame saved by a scene package. Pure data; no map, DOM or network access. */
export type SceneViewport = {
  /** The map pane in CSS pixels, before device scaling. */
  width: number
  height: number
  /** Drawing-buffer pixels per CSS pixel at the source; replay need not use the same display density. */
  pixelRatio: number
}

export type ScenePerspective = {
  kind: 'perspective'
  aspectRatio: number
  horizontalFovDegrees: number
  viewport: SceneViewport
}

export type SceneCamera = {
  /** Package local metres: east, north, absolute elevation. */
  position: [number, number, number]
  bearingDegrees: number
  /** Up from level. */
  pitchDegrees: number
  verticalFovDegrees: number
  /** The road camera is upright. Kept explicit so replay does not inherit a previous roll. */
  rollDegrees?: 0
  /** Absent in older v1 packages, whose framing follows the receiving window. */
  projection?: ScenePerspective
}

export function scenePerspective(verticalFovDegrees: number, viewport: SceneViewport): ScenePerspective {
  if (![viewport.width, viewport.height, viewport.pixelRatio].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('The scene camera viewport must have positive finite dimensions and pixel ratio.')
  if (!(verticalFovDegrees > 0 && verticalFovDegrees < 180))
    throw new Error('The scene camera needs a vertical field of view between 0 and 180 degrees.')
  const aspectRatio = viewport.width / viewport.height
  return {
    kind: 'perspective',
    aspectRatio,
    horizontalFovDegrees: (2 * Math.atan(Math.tan((verticalFovDegrees * Math.PI) / 360) * aspectRatio) * 180) / Math.PI,
    viewport: { ...viewport },
  }
}

/** Refuse an invalid saved projection, rather than silently opening a different view. */
export function checkSceneCamera(camera: SceneCamera): void {
  if (
    !Array.isArray(camera.position) ||
    camera.position.length !== 3 ||
    ![...camera.position, camera.bearingDegrees, camera.pitchDegrees, camera.verticalFovDegrees].every(
      Number.isFinite,
    ) ||
    camera.verticalFovDegrees <= 0 ||
    camera.verticalFovDegrees >= 180 ||
    (camera.rollDegrees !== undefined && camera.rollDegrees !== 0)
  )
    throw new Error('The scene package has an invalid camera.')
  const projection = camera.projection
  if (!projection) return
  if (projection.kind !== 'perspective' || !projection.viewport)
    throw new Error('The scene package has an unsupported camera projection.')
  const expected = scenePerspective(camera.verticalFovDegrees, projection.viewport)
  if (
    !Number.isFinite(projection.aspectRatio) ||
    !Number.isFinite(projection.horizontalFovDegrees) ||
    Math.abs(expected.aspectRatio - projection.aspectRatio) > 1e-9 ||
    Math.abs(expected.horizontalFovDegrees - projection.horizontalFovDegrees) > 1e-7
  )
    throw new Error('The scene package camera projection does not match its lens and viewport.')
}
