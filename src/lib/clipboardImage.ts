/**
 * Copy a PNG to the clipboard, so a map, a sheet or a figure can be pasted straight into an
 * email, a document or a chat.
 *
 * The user-gesture rule: call `copyImageToClipboard` synchronously inside the click handler and
 * hand it the PNG as a *promise*, not an awaited Blob. The clipboard write then starts inside
 * the click, which Safari requires, and the picture is rendered while the write waits. Awaiting
 * the render first and copying after loses the click's activation in Safari ("NotAllowedError").
 * `CopyImageButton` (`src/components/ui/copy-image-button.tsx`) does this for you.
 *
 * Browser-only by default; the clipboard can be passed in, which is how it is tested. Adapted
 * from GeoLibre (MIT), `apps/geolibre-desktop/src/lib/print-layout-export.ts`
 * (`copyLayoutToClipboard`).
 */

/** The parts of `navigator.clipboard` and `ClipboardItem` used here. */
export type ImageClipboardEnvironment = {
  clipboard?: { write(items: unknown[]): Promise<void> } | null
  ClipboardItem?: (new (items: Record<string, Blob | Promise<Blob>>) => unknown) | null
  /** Clipboard access needs a secure context (https or localhost). */
  isSecureContext?: boolean
}

export type ClipboardImageFailure = 'unsupported' | 'denied' | 'not-png' | 'render-failed' | 'failed'

/** Why an image could not be copied; `message` is written for the person who clicked. */
export class ClipboardImageError extends Error {
  /** What went wrong underneath, when anything did. */
  declare cause?: unknown
  readonly reason: ClipboardImageFailure
  constructor(reason: ClipboardImageFailure, message: string, options?: { cause?: unknown }) {
    super(message)
    // Set by hand: the ES2020 lib this project builds against has no `ErrorOptions`.
    if (options && 'cause' in options)
      Object.defineProperty(this, 'cause', { value: options.cause, configurable: true })
    this.name = 'ClipboardImageError'
    this.reason = reason
  }
}

function browserEnvironment(): ImageClipboardEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return {
    clipboard: (nav?.clipboard as ImageClipboardEnvironment['clipboard']) ?? null,
    ClipboardItem:
      typeof ClipboardItem === 'undefined'
        ? null
        : (ClipboardItem as unknown as NonNullable<ImageClipboardEnvironment['ClipboardItem']>),
    isSecureContext: typeof window === 'undefined' ? false : window.isSecureContext,
  }
}

/** Why this browser cannot copy an image, or null when it can. */
export function clipboardImageUnsupportedReason(
  environment: ImageClipboardEnvironment = browserEnvironment(),
): string | null {
  if (environment.isSecureContext === false)
    return 'Copying an image needs a secure (https) page. Use Download instead.'
  if (!environment.ClipboardItem || typeof environment.clipboard?.write !== 'function')
    return 'This browser cannot copy images. Use Download instead.'
  return null
}

/** Whether this browser can copy a PNG to the clipboard. */
export function clipboardImageSupported(environment?: ImageClipboardEnvironment): boolean {
  return clipboardImageUnsupportedReason(environment) === null
}

/**
 * Put a PNG on the clipboard. Call it inside the click handler, passing the render as a
 * promise (see the module comment). Rejects with a `ClipboardImageError` whose message says
 * what happened: unsupported, denied by the browser, not a PNG, the picture could not be made,
 * or the write failed.
 */
export async function copyImageToClipboard(
  png: Blob | Promise<Blob>,
  environment: ImageClipboardEnvironment = browserEnvironment(),
): Promise<void> {
  const unsupported = clipboardImageUnsupportedReason(environment)
  // Observe the render even when we cannot use it, so its rejection is never unhandled.
  const rendered = Promise.resolve(png)
  if (unsupported) {
    rendered.catch(() => {})
    throw new ClipboardImageError('unsupported', unsupported)
  }
  let renderError: ClipboardImageError | null = null
  const checked = rendered.then(
    (blob) => {
      if (!(blob instanceof Blob) || !blob.size) {
        renderError = new ClipboardImageError('render-failed', 'The picture came out empty, so nothing was copied.')
        throw renderError
      }
      if (blob.type && blob.type !== 'image/png') {
        renderError = new ClipboardImageError(
          'not-png',
          `Only PNG pictures can be copied; this one is ${blob.type}. Use Download instead.`,
        )
        throw renderError
      }
      return blob.type ? blob : new Blob([blob], { type: 'image/png' })
    },
    (cause: unknown) => {
      const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : ''
      renderError = new ClipboardImageError('render-failed', `The picture could not be made.${detail}`, { cause })
      throw renderError
    },
  )
  // The clipboard reads `checked`; mark it observed too, so a refused write never leaves it unhandled.
  checked.catch(() => {})
  const Item = environment.ClipboardItem!
  try {
    await environment.clipboard!.write([new Item({ 'image/png': checked })])
  } catch (cause) {
    // The browser's own error for a failed render says less than ours.
    if (renderError) throw renderError
    const name = (cause as { name?: string } | null)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new ClipboardImageError(
        'denied',
        'The browser did not allow copying. Click Copy again, and allow clipboard access if it asks.',
        { cause },
      )
    const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : ''
    throw new ClipboardImageError('failed', `The picture could not be copied${detail}. Use Download instead.`, {
      cause,
    })
  }
}
