import { useEffect, useRef } from 'react'

export type WebMCPInput = Record<string, unknown>

export interface WebMCPTool<TInput extends WebMCPInput = WebMCPInput> {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    untrustedContentHint?: boolean
    consequentialHint?: boolean
  }
  execute: (input: TInput, options: { signal: AbortSignal }) => unknown | Promise<unknown>
}

interface WebMCPModelContext {
  registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal; exposedTo?: string[] }) => Promise<void>
}

declare global {
  interface Document {
    modelContext?: WebMCPModelContext
  }
}

/**
 * Registers page-scoped WebMCP tools as a progressive enhancement.
 *
 * The definition signature controls registration lifetime while the execute
 * wrapper always calls the latest React closure. That lets live map state
 * change without unregistering every tool on every render.
 */
export function useWebMCPTools(tools: WebMCPTool[]) {
  const latestTools = useRef(tools)
  const definitionSignature = JSON.stringify(tools.map(({ execute: _execute, ...definition }) => definition))

  useEffect(() => {
    latestTools.current = tools
  }, [tools])

  useEffect(() => {
    const modelContext = document.modelContext
    const registrationTools = latestTools.current
    if (typeof modelContext?.registerTool !== 'function' || registrationTools.length === 0) return

    const controller = new AbortController()
    const registrations = registrationTools.map(({ execute: _execute, ...definition }) =>
      modelContext.registerTool(
        {
          ...definition,
          execute: async (input, options) => {
            const current = latestTools.current.find((tool) => tool.name === definition.name)
            if (!current) throw new Error(`The ${definition.name} tool is no longer available on this page.`)
            return current.execute(input, options)
          },
        },
        { signal: controller.signal },
      ),
    )

    void Promise.all(registrations).catch((error: unknown) => {
      if (controller.signal.aborted) return
      console.warn('Unable to register PGMaps site tools', error)
    })

    return () => controller.abort()
  }, [definitionSignature])
}

export function requiredString(input: WebMCPInput, key: string, maxLength = 160): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string.`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${key} must be ${maxLength} characters or fewer.`)
  return trimmed
}

export function optionalString(input: WebMCPInput, key: string, maxLength = 160): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new Error(`${key} must be ${maxLength} characters or fewer.`)
  return trimmed
}

export function resolveNamedIndex(
  items: Array<{ label: string; title?: string }>,
  requested: string,
  noun: string,
): number {
  const normalized = requested.trim().toLowerCase()
  const numericIndex = Number(normalized)
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= items.length) {
    return numericIndex - 1
  }

  const exact = items.findIndex(
    (item) => item.label.toLowerCase() === normalized || item.title?.toLowerCase() === normalized,
  )
  if (exact >= 0) return exact

  const partialMatches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => `${item.label} ${item.title ?? ''}`.toLowerCase().includes(normalized))
  if (partialMatches.length === 1) return partialMatches[0].index

  const choices = items.map((item, index) => `${index + 1}: ${item.title ?? item.label}`).join('; ')
  throw new Error(`Unknown or ambiguous ${noun} "${requested}". Available ${noun}s: ${choices}`)
}
