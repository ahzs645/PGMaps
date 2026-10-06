import { describe, expect, it } from 'vitest'
import { validateImportedStory } from './validateImport.mjs'

const fixture = () => ({
  root: 'story',
  resources: {},
  nodes: {
    story: { type: 'story', children: ['cover', 'body'] },
    cover: { type: 'storycover', children: ['video'] },
    video: { type: 'video' },
    body: { type: 'text', data: { type: 'paragraph' } },
  } as Record<string, { type: string; children?: string[]; data?: Record<string, string> }>,
})

describe('imported story capabilities', () => {
  it('accepts delivery media only for image/video resources at local or HTTPS URLs', () => {
    for (const deliveryUrl of [
      '/data/story-documents/prague/assets/delivery/photo.webp',
      'https://cdn.example/photo.webp',
    ]) {
      const graph = { ...fixture(), resources: { photo: { type: 'image', data: { deliveryUrl } } } }
      expect(validateImportedStory(graph)).toEqual([])
    }
    for (const deliveryUrl of ['javascript:alert(1)', '//cdn.example/photo.webp', '/other/photo.webp', 12]) {
      const graph = { ...fixture(), resources: { photo: { type: 'image', data: { deliveryUrl } } } }
      expect(validateImportedStory(graph).join(' ')).toMatch(/deliveryUrl/)
    }
    expect(
      validateImportedStory({
        ...fixture(),
        resources: {
          map: { type: 'webmap', data: { deliveryUrl: 'https://cdn.example/photo.webp' } },
        },
      }).join(' '),
    ).toMatch(/deliveryUrl/)
  })

  it('accepts cover video but rejects standalone body video', () => {
    const graph = fixture()
    expect(validateImportedStory(graph)).toEqual([])
    graph.nodes.story.children!.push('video')
    expect(validateImportedStory(graph).join(' ')).toMatch(/standalone video/)
  })

  it('rejects unsupported layouts and missing child references', () => {
    const graph = fixture()
    graph.nodes.body = { type: 'immersive', data: { subtype: 'slideshow' } }
    graph.nodes.tour = { type: 'tour', data: { type: 'explorer', subtype: 'grid' } }
    graph.nodes.story.children!.push('missing')
    const errors = validateImportedStory(graph).join(' ')
    expect(errors).toMatch(/unsupported immersive subtype/)
    expect(errors).toMatch(/unsupported tour layout/)
    expect(errors).toMatch(/invalid children/)
  })

  it('rejects recursive content instead of recursing indefinitely', () => {
    const graph = fixture()
    graph.nodes.cover.children!.push('story')
    expect(validateImportedStory(graph).join(' ')).toMatch(/cyclic content/)
  })
})
