import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { canforPdfFixture } from '../../../tests/fixtures/canforPdf'
import { classicCrossReferenceOnly, withoutDeadObjectStreams } from './deadObjectStreams'
import { readMapFrames } from './georeference'
import { readGeoPdf } from './read'

const image = (object: unknown) =>
  object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image'

/**
 * The fixture as a re-saving program leaves it: a classic cross-reference table, and a leftover
 * object stream nothing refers to whose one entry carries the number of the JPEG tile.
 */
async function resaved() {
  const pdf = await PDFDocument.load(await canforPdfFixture({ picture: 'jpeg', classicXref: true }))
  const tile = pdf.context.enumerateIndirectObjects().find(([, object]) => image(object))![0]
  const header = `${tile.objectNumber} 0 `
  pdf.context.register(
    pdf.context.flateStream(`${header}<< /Type /OCG /Name (Left over) >>`, {
      Type: 'ObjStm',
      N: 1,
      First: header.length,
    }),
  )
  return { bytes: await pdf.save({ useObjectStreams: false }), tile: tile.objectNumber }
}
const filterOf = async (bytes: Uint8Array, objectNumber: number) => {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const object = pdf.context.enumerateIndirectObjects().find(([ref]) => ref.objectNumber === objectNumber)![1]
  const dict = object instanceof PDFDict ? object : (object as PDFRawStream).dict
  return { stream: object instanceof PDFRawStream, filter: dict.get(PDFName.of('Filter'))?.toString() }
}

describe('object streams a re-saved PDF no longer uses', () => {
  it('leaves a file with a cross-reference stream exactly as it is', async () => {
    const bytes = await canforPdfFixture({ picture: 'jpeg' })
    expect(classicCrossReferenceOnly(bytes)).toBe(false)
    const result = withoutDeadObjectStreams(bytes)
    expect(result.dead).toBe(0)
    expect(result.bytes).toBe(bytes)
  })

  it('leaves a classic file without object streams exactly as it is', async () => {
    const bytes = await canforPdfFixture({ picture: 'jpeg', classicXref: true })
    expect(classicCrossReferenceOnly(bytes)).toBe(true)
    expect(withoutDeadObjectStreams(bytes).bytes).toBe(bytes)
  })

  it('stops a leftover object stream replacing the JPEG tile that has its number', async () => {
    const { bytes, tile } = await resaved()
    // The fault: read front to back, the leftover entry takes the tile's place.
    expect(await filterOf(bytes, tile)).toEqual({ stream: false, filter: undefined })
    const cleaned = withoutDeadObjectStreams(bytes)
    expect(cleaned.dead).toBe(1)
    expect(cleaned.bytes).not.toBe(bytes)
    expect(cleaned.bytes).toHaveLength(bytes.length)
    expect(await filterOf(cleaned.bytes, tile)).toEqual({ stream: true, filter: '/DCTDecode' })
    // The caller's bytes are not changed: the PDF renderer reads them as they were given.
    expect(await filterOf(bytes, tile)).toEqual({ stream: false, filter: undefined })
  })

  it('reads the tile as JPEG, says the file was saved again, and keeps its stored bytes', async () => {
    const { bytes, tile } = await resaved()
    const frames = await readMapFrames(bytes)
    expect(frames.lossyImages.has(`${tile}R`)).toBe(true)
    expect(frames.jpegBytes(`${tile}R`)?.slice(0, 2)).toEqual(Uint8Array.of(0xff, 0xd8))
    expect(frames.notices.join('\n')).toMatch(/saved again by another program/)
    const read = await readGeoPdf(bytes, 'Resaved.pdf', runtime, { maxFeatures: 500, maxVertices: 50_000 })
    const hillshade = read.layers.find((layer) => layer.imageMosaic)!
    expect(hillshade.imageMosaic!.tiles[0]).toMatchObject({ lossy: true, width: 120, height: 88 })
    expect(hillshade.imageMosaic!.tiles[0].image.startsWith('data:image/jpeg;base64,/9j/')).toBe(true)
  })
})
