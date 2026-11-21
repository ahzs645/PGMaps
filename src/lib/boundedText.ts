/**
 * Reads a response body as text without letting a public service hand the page more than it asked
 * for: the declared length is checked first, then the bytes as they arrive, and the body is
 * cancelled the moment the limit is passed. Shared by every live BC read that caps its answer (the
 * road designer's roads, harvest, streams, pits and access sources, and the outdoors planner's
 * layers). No DOM access; the response is passed in.
 */
export interface BoundedTextOptions {
  maxBytes: number
  /** The error's message when the response is over `maxBytes`. */
  tooLarge: string
  /** The error's message when the response has no body. Without it, a missing body is read with `text()`. */
  empty?: string
  /** Cancels the read when aborted, and throws its reason. */
  signal?: AbortSignal
  /**
   * Bytes already read toward `maxBytes` by earlier pages of the same query, updated as this one
   * reads, so one limit covers them all.
   */
  budget?: { bytes: number }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The read was cancelled.', 'AbortError')
}

export async function readBoundedText(response: Response, options: BoundedTextOptions): Promise<string> {
  const { maxBytes, tooLarge, empty, signal } = options
  const budget = options.budget ?? { bytes: 0 }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw Error(tooLarge)
  }
  const reader = response.body?.getReader()
  if (!reader) {
    if (empty !== undefined) throw Error(empty)
    const text = await response.text()
    budget.bytes += new TextEncoder().encode(text).byteLength
    if (budget.bytes > maxBytes) throw Error(tooLarge)
    return text
  }
  const decoder = new TextDecoder()
  let text = ''
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const { value, done } = await reader.read()
      throwIfAborted(signal)
      if (done) break
      budget.bytes += value.byteLength
      if (budget.bytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw Error(tooLarge)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  throwIfAborted(signal)
  return text
}
