import { describe, expect, it } from 'vitest'
import { readBoundedText } from './boundedText'

const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })

describe('readBoundedText', () => {
  it('reads a body within its limit', async () => {
    await expect(
      readBoundedText(new Response(streamOf(['{"a":', '1}'])), { maxBytes: 100, tooLarge: 'big' }),
    ).resolves.toBe('{"a":1}')
  })

  it('refuses a declared length over the limit before reading', async () => {
    const response = new Response('x'.repeat(10), { headers: { 'content-length': '10' } })
    await expect(readBoundedText(response, { maxBytes: 5, tooLarge: 'too big' })).rejects.toThrow('too big')
  })

  it('stops reading once the bytes pass the limit', async () => {
    await expect(
      readBoundedText(new Response(streamOf(['aaaa', 'bbbb'])), { maxBytes: 6, tooLarge: 'too big' }),
    ).rejects.toThrow('too big')
  })

  it('counts every page of one query against one budget', async () => {
    const budget = { bytes: 0 }
    await readBoundedText(new Response(streamOf(['aaaa'])), { maxBytes: 6, tooLarge: 'too big', budget })
    expect(budget.bytes).toBe(4)
    await expect(
      readBoundedText(new Response(streamOf(['bbbb'])), { maxBytes: 6, tooLarge: 'too big', budget }),
    ).rejects.toThrow('too big')
  })

  it('names an empty body when asked to', async () => {
    await expect(
      readBoundedText(new Response(null), { maxBytes: 5, tooLarge: 'big', empty: 'nothing' }),
    ).rejects.toThrow('nothing')
    await expect(readBoundedText(new Response(null), { maxBytes: 5, tooLarge: 'big' })).resolves.toBe('')
  })

  it('throws the abort reason when the read is cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('left the view'))
    await expect(
      readBoundedText(new Response(streamOf(['a'])), { maxBytes: 5, tooLarge: 'big', signal: controller.signal }),
    ).rejects.toThrow('left the view')
  })
})
