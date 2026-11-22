import { describe, expect, it } from 'vitest'

import { createSiteGeneration } from './siteTransition'

describe('the site generation', () => {
  it('lets work write while its site stands, and never after the site changes', async () => {
    const site = createSiteGeneration()
    const written: string[] = []
    // A save started on site A: its screenshot arrives after an await.
    const save = async (what: string, wait: Promise<void>) => {
      const guard = site.guard()
      await wait
      if (guard()) written.push(what)
    }
    let release!: () => void
    const slow = new Promise<void>((resolve) => (release = resolve))
    const onA = save('A’s figure', slow)
    await save('A’s screenshot', Promise.resolve())
    // *New site* while A's figure is still drawing.
    site.next()
    const onB = save('B’s screenshot', Promise.resolve())
    release()
    await Promise.all([onA, onB])
    expect(written).toEqual(['A’s screenshot', 'B’s screenshot'])
  })

  it('counts every transition, so a guard taken between two still fails after the second', () => {
    const site = createSiteGeneration()
    expect(site.current).toBe(0)
    site.next()
    const guard = site.guard()
    expect(guard()).toBe(true)
    expect(site.next()).toBe(2)
    expect(guard()).toBe(false)
    expect(site.guard()()).toBe(true)
  })
})
