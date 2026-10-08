import { expect, type Page } from '@playwright/test'

export type Summary = { city: string; searching: boolean; dragging: boolean; error: string | null; mode: string; loop: boolean; units: string; from: { label: string; lon: number; lat: number }; to: { label: string; lon: number; lat: number } | null; route: { distanceMeters: number; climbMeters: number; alternatives: number; index: number; shareUrl: string }; map: { engine: string; loaded: boolean; routeLayer: boolean } }
export async function installHost(page: Page) {
  await page.addInitScript(() => {
    type Tool = { name: string; execute(input: Record<string, unknown>, options: { signal: AbortSignal }): unknown }
    const tools = new Map<string, Tool>()
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: async (tool: Tool, options?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool)
      options?.signal?.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) }, { once: true })
    } } })
    Object.assign(window, { __flattenTestTools: { execute: (name: string, input: Record<string, unknown>) => {
      const tool = tools.get(name)
      if (!tool) throw new Error(`Unregistered tool: ${name}`)
      return tool.execute(input, { signal: new AbortController().signal })
    } } })
  })
}
export async function execute<T>(page: Page, name: string, input: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(({ name, input }) => (window as typeof window & { __flattenTestTools: { execute(name: string, input: Record<string, unknown>): T } }).__flattenTestTools.execute(name, input), { name, input })
}
export const summary = (page: Page) => execute<Summary>(page, 'read_flatten_route')
export async function ready(page: Page) {
  await expect.poll(async () => { try { const state = await summary(page); return !state.searching && !state.error && !!state.route && state.map.loaded && state.map.routeLayer } catch { return false } }, { timeout: 45000 }).toBe(true)
}
