import { describe, expect, it } from 'vitest'
import {
  COLLECTION_FILE_LIMIT,
  OBSERVED_PORTAL_PROJECTS,
  collectionSourceUrl,
  collectionStats,
  collectionWorkspaceCandidate,
  exportCollection,
  parseCollectionFiles,
  validateCollectionBudget,
} from './portalCollections'

describe('Authorized browser collection imports', () => {
  it('round trips original UTF-8 JSON, filenames, import types, nulls and source IDs without rewriting exports', () => {
    const text = ' { "id": "0017", "title": "Rivière", "absent": null, "count": 0, "enabled": false }\n'
    const files = parseCollectionFiles(text, 'source.json', 'story')
    expect(files[0].bytes).toBe(new TextEncoder().encode(text).length)
    expect(files[0].records[0].sourceId).toBe('0017')
    expect(files[0].records[0].raw).toMatchObject({ count: 0, enabled: false, absent: null })
    const restored = parseCollectionFiles(exportCollection(files), 'collection.json')
    expect(restored).toEqual(files)
    expect(restored[0].sourceText).toBe(text)
    expect(() => parseCollectionFiles('{"id":9007199254740993}', 'large-id.json')).toThrow('identifiers as strings')
  })

  it('imports mixed list wrappers and preserves native attribute records', () => {
    const files = parseCollectionFiles(
      JSON.stringify({
        projects: [{ projectId: 27, projectName: 'Learning' }],
        submissions: [{ submissionId: 1477, name: 'Monitor' }],
        stories: [{ id: 0, title: 'Story', body: '<script>alert(1)</script>' }],
      }),
      'mixed.json',
    )
    expect(files[0].records.map((row) => row.kind)).toEqual(['project', 'submission', 'story'])
    expect(files[0].records.map((row) => row.sourceId)).toEqual([27, 1477, 0])
    expect(files[0].records[2].description).toBe('<script>alert(1)</script>')
    const native = parseCollectionFiles('{"attributes":[{"id":7,"name":"Site"}]}', 'native.json', 'submission')
    expect(native[0].records[0]).toMatchObject({ kind: 'submission', sourceId: 7, title: 'Site' })
    const wrapped = parseCollectionFiles('{"attributes":{"documents":[{"title":"Guide"}]}}', 'wrapped.json')
    expect(wrapped[0].records[0].title).toBe('Guide')
  })

  it('counts original JSON separately from deduplicated declared media bytes and treats conflicts as unknown', () => {
    const files = parseCollectionFiles(
      JSON.stringify([
        {
          id: 1,
          media: [
            { url: 'https://example.com/a.pdf', size_bytes: 500 },
            { url: 'https://example.com/b.mp4', size: 100 },
          ],
        },
        { id: 2, media: [{ url: 'https://example.com/a.pdf', size_bytes: 500 }] },
      ]),
      'media.json',
    )
    expect(collectionStats(files)).toMatchObject({
      files: 1,
      records: 2,
      references: 2,
      declaredBytes: 500,
      unmeasuredReferences: 1,
    })
    const conflicting = parseCollectionFiles('[{"url":"https://example.com/a.pdf","size_bytes":600}]', 'conflict.json')
    expect(collectionStats([...files, ...conflicting])).toMatchObject({
      references: 2,
      declaredBytes: 0,
      unmeasuredReferences: 2,
    })
    const overflow = parseCollectionFiles(
      JSON.stringify([
        { url: 'https://example.com/x', size_bytes: Number.MAX_SAFE_INTEGER },
        { url: 'https://example.com/y', size_bytes: Number.MAX_SAFE_INTEGER },
      ]),
      'overflow.json',
    )
    expect(collectionStats(overflow).declaredBytes).toBeUndefined()
  })

  it('rejects script URLs and embedded credentials, while retaining download endpoint references without direct download semantics', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,bad',
      'http://example.com/a',
      'https://user:secret@example.com/a',
    ])
      expect(collectionSourceUrl(url)).toBeUndefined()
    const records = parseCollectionFiles(
      JSON.stringify({
        content: '<a href="https://example.com/paper">Paper</a>',
        attachments: [{ download: 'https://example.com/rest/download.php?id=4', name: 'Attachment' }],
        bad: 'https://user:secret@example.com/a',
      }),
      'links.json',
    )[0].records
    expect(records[0].references).toHaveLength(2)
    expect(records[0].references.find((reference) => reference.label === 'Attachment')?.endpoint).toBe(true)
  })

  it('keeps native maps as one record and identifies supported map payloads without touching the source', () => {
    const raw = { coordinates: [-124, 54], layers: [], documents: [{ title: 'Map note' }] }
    const record = parseCollectionFiles(JSON.stringify(raw), 'map.json')[0].records[0]
    expect(record.kind).toBe('project')
    expect(collectionWorkspaceCandidate(record.raw)).toEqual(raw)
    expect(collectionWorkspaceCandidate({ title: 'Metadata only' })).toBeUndefined()
    expect(
      parseCollectionFiles('{"title":"Learning","workspace":{"type":"story-map"}}', 'story.json')[0].records[0].kind,
    ).toBe('story')
  })

  it('rejects malformed/error payloads, excessive depth/records, oversized files and nested collection containers', () => {
    for (const text of ['null', '[1]', '{', '{"success":false,"error":"Denied"}'])
      expect(() => parseCollectionFiles(text, 'bad.json')).toThrow()
    let nested: unknown = {}
    for (let depth = 0; depth < 66; depth++) nested = { nested }
    expect(() => parseCollectionFiles(JSON.stringify(nested), 'deep.json')).toThrow('nesting')
    expect(() => parseCollectionFiles(JSON.stringify(Array.from({ length: 10_001 }, () => ({}))), 'rows.json')).toThrow(
      '10,000',
    )
    expect(() => parseCollectionFiles(' '.repeat(COLLECTION_FILE_LIMIT + 1), 'large.json')).toThrow('20 MiB')
    const nestedContainer = {
      schema: 'nechako-collection-v1',
      files: [{ name: 'inside.json', importKind: 'auto', sourceText: '{"schema":"nechako-collection-v1","files":[]}' }],
    }
    expect(() => parseCollectionFiles(JSON.stringify(nestedContainer), 'nested.json')).toThrow('Nested')
    const one = parseCollectionFiles('{}', 'one.json')[0]
    expect(() => validateCollectionBudget(Array.from({ length: 101 }, () => one))).toThrow('100 original files')
    expect(() => validateCollectionBudget([{ ...one, bytes: 51 * 1024 * 1024 }])).toThrow('50 MiB')
  })

  it('does not trust declared source-file size metadata from collection containers', () => {
    const files = parseCollectionFiles(
      JSON.stringify({
        schema: 'nechako-collection-v1',
        files: [{ name: 'original.json', importKind: 'auto', bytes: 9_999_999, sourceText: '{"id":17}' }],
      }),
      'collection.json',
    )
    expect(files[0].bytes).toBe(9)
    expect(OBSERVED_PORTAL_PROJECTS).toHaveLength(9)
    expect(OBSERVED_PORTAL_PROJECTS.map(([id]) => id)).toEqual([4, 6, 9, 10, 12, 14, 15, 21, 27])
  })
})
