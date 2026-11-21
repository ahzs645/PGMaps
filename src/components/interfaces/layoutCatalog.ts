/**
 * Reads a tool's served layout file (`public/<file>`). The service worker fetches it
 * network-first (`public/sw.js`), so an edited file applies on the next load. A file that cannot
 * be read or does not parse falls back to the tool's built-in recovery layout, with the reason
 * in the browser console.
 */
export async function loadLayoutCatalog<L>({
  file,
  parse,
  recovery,
  recoveryName,
  signal,
}: {
  file: string
  parse: (value: unknown) => L[]
  recovery: L
  /** Named in the console warning, "Using the built-in Guided mode." */
  recoveryName: string
  signal: AbortSignal
}): Promise<{ layouts: L[]; fallback: boolean }> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${file}`, { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { layouts: parse(await response.json()), fallback: false }
  } catch (error) {
    if (!signal.aborted) console.warn(`Using the built-in ${recoveryName}.`, error)
    return { layouts: [recovery], fallback: true }
  }
}
