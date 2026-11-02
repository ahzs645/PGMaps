import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { runCastor } from '@/features/forestry-castor/engine'
import { castorConfig, createExampleProject } from '@/features/forestry-castor/inputs'
import { castorReportBundle } from '@/features/forestry-castor/outputs'
import { castorSnapshotTransfer, packCastorSnapshot, unpackCastorSnapshot } from '@/features/forestry-castor/transfer'
import type { CastorResult, CastorSnapshot } from '@/features/forestry-castor/types'
import { CASTOR_ITEMS_PER_CHUNK, CastorChunkAssembler, castorChunks } from './chunks'
import type { CastorReportResponse } from './protocol'
import { sendCastorReportRequest } from './reportClient'
import { createCastorReportHandler } from './reportWorkerCore'

/** postMessage semantics: a structured clone that detaches transferred buffers in the sender. */
const cross = <T>(message: T, transfer: Transferable[]) => structuredClone(message, { transfer })

async function files(bytes: ArrayBuffer | Blob) {
  const zip = await JSZip.loadAsync(bytes instanceof Blob ? await bytes.arrayBuffer() : bytes)
  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort()
  return Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await zip.file(name)!.async('uint8array')])),
  )
}

describe('Castor worker transfer', () => {
  it('packs snapshot arrays into transferable buffers without changing a value or null', () => {
    const snapshot = {
      period: 3,
      year: 2040,
      elapsedYears: 15,
      age: [0, -0, 1.5, Number.NaN, 400, Number.MAX_VALUE],
      volume: [1e-300, 2, 3, 4, 5, 6],
      height: [null, 1, null, 2, 3, 4],
      eca: [0, 0, 0, 0, 0, 1],
      harvestedYear: [2030, null, null, 2035, null, 2040],
      harvestedVolumeM3: [1, 2, 3, 4, 5, 6],
      constrained: [0, 1, 0, 1, 0, 1],
      constrainedPeriods: [0, 1, 2, 3, 4, 5],
      constrainedYears: [0, 5, 10, 15, 20, 25],
    } as unknown as CastorSnapshot
    const packed = packCastorSnapshot(snapshot)
    const transfer = castorSnapshotTransfer(packed)
    expect(transfer).toHaveLength(9 + 2)
    const unpacked = unpackCastorSnapshot(cross(packed, transfer))
    expect(Object.keys(unpacked)).toEqual(Object.keys(snapshot))
    expect(unpacked).toEqual(snapshot)
    expect(Object.is(unpacked.age[1], -0)).toBe(true)
    expect(JSON.stringify(unpacked)).toBe(JSON.stringify(snapshot))
  })

  it('reassembles sliced arrays and snapshots in their original order', () => {
    const project = createExampleProject()
    const result = runCastor(project, castorConfig(project))
    const large: CastorResult = {
      ...result,
      harvestPixelList: Array.from({ length: CASTOR_ITEMS_PER_CHUNK * 2 + 17 }, (_, index) => ({
        ...result.harvestPixelList[index % result.harvestPixelList.length],
        pixelId: index,
      })),
    }
    const assembler = new CastorChunkAssembler()
    let messages = 0
    for (const { chunk, transfer } of castorChunks('result', large)) {
      assembler.accept(cross(chunk, transfer))
      messages += 1
    }
    expect(messages).toBe(1 + 3 + large.snapshots.length)
    expect(JSON.stringify(assembler.result())).toBe(JSON.stringify(large))
  })

  it('builds the same report archive through the worker path as castorReportBundle', async () => {
    const project = createExampleProject()
    const result = runCastor(project, castorConfig(project))
    const before = JSON.stringify(result)
    const responses: CastorReportResponse[] = []
    const handle = createCastorReportHandler((response, transfer = []) => responses.push(cross(response, transfer)))
    const pending: Array<Promise<void>> = []
    expect(
      await sendCastorReportRequest(project, result, (request, transfer) =>
        pending.push(handle(cross(request, transfer))),
      ),
    ).toBe(true)
    await Promise.all(pending)
    // Transferring packed copies leaves the page's own result intact.
    expect(JSON.stringify(result)).toBe(before)
    const complete = responses.find((response) => response.type === 'complete')
    expect(responses.find((response) => response.type === 'error')).toBeUndefined()
    expect(responses.some((response) => response.type === 'progress')).toBe(true)
    expect(complete?.type).toBe('complete')
    const viaWorker = await files((complete as { bytes: ArrayBuffer }).bytes)
    const direct = await files(await castorReportBundle(project, result))
    expect(Object.keys(direct)).toEqual(expect.arrayContaining(['result.json', 'report.html', 'rasters/final-age.tif']))
    expect(Object.keys(viaWorker)).toEqual(Object.keys(direct))
    const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
    expect(text(viaWorker['result.json'])).toBe(text(direct['result.json']))
    expect(viaWorker).toEqual(direct)
  })

  it('stops sending when the export is cancelled', async () => {
    const project = createExampleProject()
    const result = runCastor(project, castorConfig(project))
    let sent = 0
    const finished = await sendCastorReportRequest(
      project,
      result,
      () => (sent += 1),
      () => sent >= 2,
    )
    expect(finished).toBe(false)
    expect(sent).toBe(2)
  })
})
