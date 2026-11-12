import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCapture } from './parseCapture'

const help = new URL('../../public/help/', import.meta.url)
const lessons = readdirSync(help, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'open-hillside')
  .map((entry) => entry.name)
const readLesson = (lesson: string) => readFileSync(new URL(`${lesson}/tour.html`, help), 'utf8')
const readCapture = (lesson: string) =>
  JSON.parse(
    readLesson(lesson).match(/<script id="tourkit-capture-data" type="application\/json">([\s\S]*?)<\/script>/)![1],
  )

// A small valid envelope keeps malformed-input cases independent of the lesson contents.
function capture() {
  return {
    format: 'tourkit-browser-capture',
    version: 1,
    id: 'test',
    title: 'Test',
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    engine: { name: 'rrweb', version: '2.2.2' },
    viewport: { width: 1024, height: 768 },
    privacy: { mode: 'reviewed' },
    events: [
      { type: 2, timestamp: 1000, data: { node: { type: 0, id: 1, childNodes: [] } } },
      { type: 4, timestamp: 2000, data: { width: 1024, height: 768 } },
    ],
    steps: [{ id: 'first', title: 'First', instruction: '', atMs: 0, action: 'continue' }],
    warnings: [],
  }
}

describe('portable capture guards', () => {
  it.each(lessons)('opens the real %s lesson without a schema runtime', (lesson) => {
    const html = readLesson(lesson)
    const data = readCapture(lesson)
    expect(parseCapture(data)).toEqual(data)
    expect(html).not.toMatch(/\bZod(?:Type|Error)\b/)
    expect(html).toContain('/* pgmaps-capture-guards:start */')
  })

  it('accepts JSON text and rejects malformed JSON, unknown fields and invalid versions', () => {
    expect(parseCapture(JSON.stringify(capture())).id).toBe('test')
    expect(() => parseCapture('{')).toThrow('not valid JSON')
    expect(() => parseCapture({ ...capture(), typo: true })).toThrow('unknown key')
    expect(() => parseCapture({ ...capture(), version: 2 })).toThrow('capture version')
    expect(() => parseCapture({ ...capture(), createdAt: '2026-02-30T00:00:00Z' })).toThrow('UTC date')
    expect(() => parseCapture({ ...capture(), viewport: { width: 0, height: 768 } })).toThrow('viewport width')
  })

  it('keeps event order, full snapshots and step timing valid', () => {
    const data = capture()
    expect(() => parseCapture({ ...data, events: [...data.events].reverse() })).toThrow('ordered by timestamp')
    expect(() => parseCapture({ ...data, events: [data.events[1]] })).toThrow('full DOM snapshot')
    expect(() => parseCapture({ ...data, events: [{ ...data.events[0], data: {} }] })).toThrow('document node')
    expect(() => parseCapture({ ...data, steps: [{ ...data.steps[0], atMs: 2000 }] })).toThrow('atMs')
    expect(() => parseCapture({ ...data, steps: [{ ...data.steps[0], atMs: 100, afterMs: 50 }] })).toThrow('precedes')
    expect(() => parseCapture({ ...data, steps: [data.steps[0], data.steps[0]] })).toThrow('Duplicate step')
  })

  it('rejects dangling references and invalid source origins', () => {
    const data = capture()
    expect(() => parseCapture({ ...data, steps: [{ ...data.steps[0], sourceDocumentId: 'missing' }] })).toThrow(
      'Unknown source',
    )
    expect(() => parseCapture({ ...data, warnings: [{ code: 'test', message: 'Test', stepId: 'missing' }] })).toThrow(
      'unknown step',
    )
    expect(() => parseCapture({ ...data, pages: [{ id: 'page', origin: 'javascript:', path: '/test' }] })).toThrow(
      'source page',
    )
    expect(() =>
      parseCapture({
        ...data,
        events: [
          ...data.events,
          {
            type: 5,
            timestamp: 2000,
            data: { tag: 'tourkit-document', payload: { documentId: 'missing' } },
          },
        ],
      }),
    ).toThrow('unknown source page')
  })

  it('checks asset MIME and rejects duplicate URLs', () => {
    const asset = { id: 'one', url: '/icon.png', mime: 'image/png', dataUrl: 'data:image/png;base64,YQ==' }
    const data = { ...capture(), assets: [asset] }
    expect(parseCapture(data).id).toBe('test')
    expect(() => parseCapture({ ...data, assets: [{ ...asset, mime: 'text/css' }] })).toThrow('MIME')
    expect(() => parseCapture({ ...data, assets: [asset, { ...asset, id: 'two' }] })).toThrow('Duplicate asset URL')
  })

  it('validates PNG headers and strips original screenshots without mutating the input', () => {
    const header = Buffer.alloc(33)
    header.writeUInt32BE(0x89504e47, 0)
    header.writeUInt32BE(0x0d0a1a0a, 4)
    header.writeUInt32BE(0x49484452, 12)
    header.writeUInt32BE(2, 16)
    header.writeUInt32BE(3, 20)
    const png = 'data:image/png;base64,' + header.toString('base64')
    const image = {
      dataUrl: png,
      width: 2,
      height: 3,
      alt: 'Test',
      sourceDataUrl: png,
      sourceWidth: 2,
      sourceHeight: 3,
    }
    const data = capture()
    const withImage = { ...data, steps: [{ ...data.steps[0], screenshot: image }] }
    expect(parseCapture(withImage).steps[0].screenshot).toEqual({ dataUrl: png, width: 2, height: 3, alt: 'Test' })
    expect(withImage.steps[0].screenshot.sourceDataUrl).toBe(png)
    expect(() => parseCapture({ ...data, steps: [{ ...data.steps[0], screenshot: { ...image, width: 4 } }] })).toThrow(
      'dimensions',
    )
  })

  it('bounds nesting, node counts, bytes and event counts before playback', () => {
    const data = capture()
    expect(() => parseCapture(data, { maxDepth: 2 })).toThrow('nesting')
    expect(() => parseCapture(data, { maxNodes: 10 })).toThrow('too many JSON values')
    expect(() => parseCapture(data, { maxBytes: 10 })).toThrow('size limit')
    expect(() => parseCapture(data, { maxEvents: 1 })).toThrow('events')
    expect(() => parseCapture(data, { maxBytes: 0 })).toThrow('Invalid capture limit')
    expect(() => parseCapture({ ...data, events: [{ ...data.events[0], timestamp: Infinity }] })).toThrow(
      'JSON values only',
    )
    expect(() => parseCapture(JSON.stringify(data).replace('"title":"Test"', '"__proto__":{},"title":"Test"'))).toThrow(
      'unsafe JSON property',
    )
    expect(() => parseCapture({ ...data, privacy: new Date() })).toThrow('plain JSON objects')
  })
})
