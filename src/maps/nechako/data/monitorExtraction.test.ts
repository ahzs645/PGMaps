import { describe, expect, it, vi } from 'vitest'
import { extractMonitoring } from './monitorExtraction'
import type { ProjectRead } from './projectManager'

const params = { layerId: '386', recId: '1' }
const records = (size: number) =>
  Array.from({ length: size }, (_, id) => ({ id, value: id === 0 ? 0 : id === 1 ? null : id / 10, enabled: false }))
function source(rows = records(1103)): ProjectRead {
  return vi.fn(async (_path, args) => {
    const start = Number(args?.pageNumber) * Number(args?.pageSize)
    return {
      fields: ['id', 'value', 'enabled'],
      data: rows.slice(start, start + Number(args?.pageSize)),
      recordCount: String(rows.length),
      noData: false,
    }
  })
}
describe('complete monitoring extraction', () => {
  it('downloads every page then verifies boundaries and terminal page without losing zero/null/false', async () => {
    const read = source()
    const result = await extractMonitoring({ params, read, uniqueKey: 'id' })
    expect(result.status).toBe('complete')
    expect(result.rows).toEqual(records(1103))
    expect(result.verification).toMatchObject({
      countMatches: true,
      boundaryPagesRechecked: true,
      terminalPageEmpty: true,
      uniqueIdsChecked: true,
      atomicSnapshot: false,
    })
    expect(vi.mocked(read).mock.calls.map((call) => call[1]?.pageNumber)).toEqual(['0', '1', '2', '0', '2', '3'])
  })
  it('marks a user row cap partial and does not claim verification', async () => {
    const read = source()
    const result = await extractMonitoring({ params, read, maxRows: 600 })
    expect(result.downloadedRows).toBe(600)
    expect(result.expectedRows).toBe(1103)
    expect(result.status).toBe('partial')
    expect(result.verification.countMatches).toBe(false)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('checks an empty accessible dataset', async () => {
    const result = await extractMonitoring({ params, read: source([]) })
    expect(result.downloadedRows).toBe(0)
    expect(result.status).toBe('complete')
  })
  it('rejects a source that repeats page zero', async () => {
    const rows = records(500)
    await expect(
      extractMonitoring({ params, read: async () => ({ fields: ['id'], data: rows, recordCount: 1000 }) }),
    ).rejects.toThrow('repeated an entire page')
  })
  it('rejects changing totals and short intermediate pages', async () => {
    const good = source()
    const changed: ProjectRead = async (path, args, signal) => {
      const page = (await good(path, args, signal)) as { recordCount: number }
      return { ...page, recordCount: args?.pageNumber === '1' ? 1104 : 1103 }
    }
    await expect(extractMonitoring({ params, read: changed })).rejects.toThrow('total changed')
    await expect(
      extractMonitoring({ params, read: async () => ({ fields: ['id'], data: records(10), recordCount: 1000 }) }),
    ).rejects.toThrow('500 were required')
  })
  it('rejects changing columns', async () => {
    const good = source()
    const read: ProjectRead = async (path, args, signal) => ({
      ...((await good(path, args, signal)) as object),
      fields: args?.pageNumber === '1' ? ['id', 'changed'] : ['id', 'value', 'enabled'],
    })
    await expect(extractMonitoring({ params, read })).rejects.toThrow('columns changed')
  })
  it('rejects duplicate IDs only when an identity column is explicitly selected', async () => {
    const rows = records(501)
    rows[500].id = 0
    await expect(extractMonitoring({ params, read: source(rows), uniqueKey: 'id' })).rejects.toThrow('repeated a value')
    const result = await extractMonitoring({ params, read: source(rows) })
    expect(result.rows).toHaveLength(501)
    expect(result.verification.uniqueIdsChecked).toBe(false)
  })
  it('rejects a first page that changes during final verification', async () => {
    let calls = 0
    const rows = records(2)
    const good = source(rows)
    const read: ProjectRead = async (path, args, signal) => {
      calls++
      if (calls === 2) rows[0].value = 9
      return good(path, args, signal)
    }
    // Return copied source rows so the previously returned page is immutable.
    const copied: ProjectRead = async (...args) => JSON.parse(JSON.stringify(await read(...args)))
    await expect(extractMonitoring({ params, read: copied })).rejects.toThrow('first page')
  })
  it('rejects unexpected trailing rows', async () => {
    const read: ProjectRead = async (_path, args) => ({
      fields: ['id'],
      data: args?.pageNumber === '0' ? [{ id: 1 }] : [{ id: 2 }],
      recordCount: 1,
    })
    await expect(extractMonitoring({ params, read })).rejects.toThrow('beyond its advertised total')
  })
  it('accepts a terminal noData response without a source total', async () => {
    const read: ProjectRead = async (_path, args) =>
      args?.pageNumber === '0' ? { fields: ['id'], data: [{ id: 1 }], recordCount: 1 } : { noData: true }
    expect((await extractMonitoring({ params, read })).status).toBe('complete')
  })
  it('requires an explicitly advertised terminal total to remain unchanged, including noData responses', async () => {
    for (const total of [0, 2]) {
      const read: ProjectRead = async (_path, args) =>
        args?.pageNumber === '0'
          ? { fields: ['id'], data: [{ id: 1 }], recordCount: 1 }
          : { noData: true, recordCount: total }
      await expect(extractMonitoring({ params, read })).rejects.toThrow('Completeness could not be verified')
    }
    const read: ProjectRead = async (_path, args) =>
      args?.pageNumber === '0'
        ? { fields: ['id'], data: [{ id: 1 }], recordCount: 1 }
        : { noData: true, recordCount: '1' }
    expect((await extractMonitoring({ params, read })).status).toBe('complete')
  })
  it('rejects ambiguous scopes and numeric unique IDs that have already lost exact precision', async () => {
    await expect(extractMonitoring({ params: { ...params, schemaId: '13' }, read: source() })).rejects.toThrow(
      'one monitoring source scope',
    )
    await expect(
      extractMonitoring({
        params,
        uniqueKey: 'id',
        read: source([{ id: 9007199254740992, value: 0, enabled: false }]),
      }),
    ).rejects.toThrow('integer precision')
  })
  it('stops before publishing a cancelled or oversized extraction', async () => {
    const controller = new AbortController()
    controller.abort()
    const read = source()
    await expect(extractMonitoring({ params, read, signal: controller.signal })).rejects.toThrow('cancelled')
    expect(read).not.toHaveBeenCalled()
    await expect(extractMonitoring({ params, read, maxBytes: 1 })).rejects.toThrow('memory limit')
  })
  it('validates local limits and source scope', async () => {
    await expect(extractMonitoring({ params, read: source(), maxRows: 1000001 })).rejects.toThrow('row')
    await expect(
      extractMonitoring({ params: { ...params, url: 'https://example.com' }, read: source() }),
    ).rejects.toThrow('Unexpected')
    await expect(extractMonitoring({ params: {}, read: source() })).rejects.toThrow('actual monitoring record')
  })
})
