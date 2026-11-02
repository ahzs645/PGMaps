import { castorReportBundleBytes } from '@/features/forestry-castor/outputs'
import { CastorChunkAssembler } from './chunks'
import type { CastorReportRequest, CastorReportResponse } from './protocol'

/**
 * The report worker's message handling, outside the worker entry so tests can
 * drive the same path without a browser Worker.
 */
export function createCastorReportHandler(
  post: (response: CastorReportResponse, transfer?: Transferable[]) => void,
): (request: CastorReportRequest) => Promise<void> {
  let assembler: CastorChunkAssembler | null = new CastorChunkAssembler()
  return async (request) => {
    try {
      if (!assembler) throw new Error('This report worker has already built its archive.')
      if (request.type === 'chunk') {
        assembler.accept(request.chunk)
        return
      }
      const project = assembler.project(),
        result = assembler.result()
      assembler = null
      const bytes = await castorReportBundleBytes(project, result, (progress) => post({ type: 'progress', progress }))
      post({ type: 'complete', bytes }, [bytes])
    } catch (cause: unknown) {
      assembler = null
      post({
        type: 'error',
        message: cause instanceof Error ? cause.message : 'The report bundle could not be created.',
      })
    }
  }
}
