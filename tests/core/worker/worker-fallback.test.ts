import { describe, expect, it, vi } from 'vitest'
import { WorkerManager } from '@/editor/core/worker/WorkerManager'
import { countWords } from '@/editor/core/worker/works/wordCountModel'
import { mergeOption } from '@/editor/utils/option'
import type { Draw } from '@/editor/core/draw/Draw'

const denied = vi.hoisted(() => class {
  constructor() { throw new Error('CSP worker-src none') }
})
vi.mock('@/editor/core/worker/works/wordCount?worker&inline', () => ({ default: denied }))
vi.mock('@/editor/core/worker/works/catalog?worker&inline', () => ({ default: denied }))
vi.mock('@/editor/core/worker/works/group?worker&inline', () => ({ default: denied }))
vi.mock('@/editor/core/worker/works/value?worker&inline', () => ({ default: denied }))

describe('optional utility workers under CSP', () => {
  it('computes owned request snapshots and rejects queued work on destroy', async () => {
    const model = { main: [{ value: 'hello', groupIds: ['one'],
      titleId: 'title', level: 'first' }], header: [], footer: [] }
    const options = mergeOption({})
    const draw = { getOriginalMainElementList: () => model.main,
      getDocumentRevision: () => 1, getOptions: () => options,
      getOriginValue: () => model,
      getPosition: () => ({ getOriginalMainPositionList: () => [{ pageNo: 0 }] })
    } as unknown as Draw
    const manager = new WorkerManager(draw)
    expect(manager.stats.unavailable).toBe(4)
    const words = manager.getWordCount()
    const groups = manager.getGroupIds()
    const catalog = manager.getCatalog()
    const value = manager.getValue()
    model.main[0].value = 'changed after request'
    model.main[0].groupIds.push('two')
    expect(await words).toBe(countWords([{ value: 'hello' }]))
    expect(await groups).toEqual(['one'])
    expect((await catalog)?.[0].name).toBe('hello')
    const saved = JSON.stringify((await value).data)
    expect(saved).toContain('hello')
    expect(saved).not.toContain('changed after request')
    expect(manager.stats.fallbacks).toBe(4)
    const pending = manager.getValue()
    manager.destroy()
    await expect(pending).rejects.toThrow('destroyed')
    await expect(manager.getWordCount()).rejects.toThrow('destroyed')
  })
})
