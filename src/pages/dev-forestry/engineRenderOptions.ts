/** Display controls shared by the PGMaps adapters. They never enter the assessment or stand configuration. */
export interface EngineRenderOptions {
  resolutionScale: number
  maxFps: number
  maxInFlight: number
  dissolveMode: 'pixels' | 'relative'
  dissolvePixels: number
  dissolveReferenceHeight: number
  frustumCulling: boolean
}

export const ACCEPTS_RENDER_OPTIONS = 'render-options-v1'
export const DEFAULT_ENGINE_RENDER_OPTIONS: Readonly<EngineRenderOptions> = {
  resolutionScale: 1,
  maxFps: 0,
  maxInFlight: 2,
  dissolveMode: 'relative',
  dissolvePixels: 4,
  dissolveReferenceHeight: 1080,
  frustumCulling: true,
}

/** Validate persisted values and partial updates before posting them to either engine. */
export function parseEngineRenderOptions(
  raw: unknown,
  base: Readonly<EngineRenderOptions> = DEFAULT_ENGINE_RENDER_OPTIONS,
): EngineRenderOptions {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const number = (key: keyof EngineRenderOptions, min: number, max: number, integer = false) => {
    const input = value[key]
    const fallback = base[key] as number
    if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
    const bounded = Math.min(max, Math.max(min, input))
    return integer ? Math.round(bounded) : bounded
  }
  return {
    resolutionScale: number('resolutionScale', 0.5, 1),
    maxFps: value.maxFps === 0 ? 0 : number('maxFps', 15, 120, true),
    maxInFlight: number('maxInFlight', 1, 3, true),
    dissolveMode:
      value.dissolveMode === 'pixels' || value.dissolveMode === 'relative' ? value.dissolveMode : base.dissolveMode,
    dissolvePixels: number('dissolvePixels', 0.5, 16),
    dissolveReferenceHeight: number('dissolveReferenceHeight', 240, 4320, true),
    frustumCulling: typeof value.frustumCulling === 'boolean' ? value.frustumCulling : base.frustumCulling,
  }
}

/** Only settings applied to a final image belong in its cache key. Live pacing and scale do not. */
export function engineCaptureOptionsKey(options: EngineRenderOptions): string {
  return `quality:${options.dissolveMode}:${options.dissolvePixels}:${options.dissolveReferenceHeight}:${Number(options.frustumCulling)}`
}
