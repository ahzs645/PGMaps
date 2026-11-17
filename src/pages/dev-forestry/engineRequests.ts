/** Negotiate additive adapter features before transferring a capture's buffers. */
import type { EngineCaptureRequest } from './engineCapture'
import { ACCEPTS_RENDER_OPTIONS, parseEngineRenderOptions, type EngineRenderOptions } from './engineRenderOptions'
import { finalStandForEngine } from './sceneComponents'
import { engineAccepts } from './scenePosting'

export function captureForEngine(
  request: EngineCaptureRequest,
  capabilities: unknown,
  renderOptions?: EngineRenderOptions,
): EngineCaptureRequest {
  const plain = { ...request }
  delete plain.renderOptions
  return {
    ...plain,
    ...(request.stand ? { stand: finalStandForEngine(request.stand, capabilities) } : {}),
    ...(engineAccepts(capabilities, ACCEPTS_RENDER_OPTIONS) && renderOptions
      ? { renderOptions: parseEngineRenderOptions(renderOptions) }
      : {}),
  }
}
