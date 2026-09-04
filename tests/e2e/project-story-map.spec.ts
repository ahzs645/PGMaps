import { expect, test } from '@playwright/test'

const STORY_URL = '/dev/projects/where-is-north-bc'

test.describe('JSON map story', () => {
  test('uses a project slug and lets the mobile map extend behind the toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(STORY_URL)

    await expect(page).toHaveURL(new RegExp(`${STORY_URL}$`))
    await expect(page.getByRole('button', { name: 'Main menu' })).toContainText('Project')

    const map = page.locator('.maplibregl-map')
    await expect(map).toBeVisible()
    await expect.poll(async () => (await map.boundingBox())?.y).toBe(0)
  })

  test('redirects legacy project query links to the canonical slug', async ({ page }) => {
    await page.goto('/dev/projects?project=where-is-north-bc')
    await expect(page).toHaveURL(new RegExp(`${STORY_URL}$`))
  })

  test('renders the narrative and loads the first scene layer', async ({ page }) => {
    const layerRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      // The `?import` variant is DevProjects' static import, not a map source.
      if (/^\/data\/(boundaries|census)\//.test(url.pathname) && !url.search.includes('import')) {
        layerRequests.push(url.pathname)
      }
    })

    await page.goto(STORY_URL)

    await expect(page.getByRole('heading', { name: 'Where Does Northern B.C. Begin?' })).toBeVisible()
    await expect(page.getByRole('button', { name: /A line everyone knows/ })).toHaveAttribute('aria-current', 'step')

    // The first scene shows Health Authorities, so that source must be fetched.
    await expect
      .poll(() => layerRequests, { timeout: 30_000 })
      .toContain('/data/boundaries/BCMoH/simplified/health_authorities.json')
  })

  test('fills its container instead of leaving a stale undersized canvas', async ({ page }) => {
    await page.goto(STORY_URL)
    const canvas = page.locator('.maplibregl-canvas')
    await expect(canvas).toBeVisible()

    // Regression: the canvas used to stay at its pre-layout size (276x256).
    await expect
      .poll(
        async () =>
          canvas.evaluate((node) => {
            const container = node.closest('.maplibregl-map') as HTMLElement | null
            if (!container) return null
            return {
              dw: Math.abs(node.clientWidth - container.clientWidth),
              dh: Math.abs(node.clientHeight - container.clientHeight),
            }
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ dw: expect.any(Number), dh: expect.any(Number) })

    const delta = await canvas.evaluate((node) => {
      const container = node.closest('.maplibregl-map') as HTMLElement
      return {
        dw: Math.abs(node.clientWidth - container.clientWidth),
        dh: Math.abs(node.clientHeight - container.clientHeight),
      }
    })
    expect(delta.dw).toBeLessThanOrEqual(2)
    expect(delta.dh).toBeLessThanOrEqual(2)
  })

  test('scrolling the narrative drives the active scene both ways', async ({ page }) => {
    await page.goto(STORY_URL)
    const firstCard = page.getByRole('button', { name: /A line everyone knows/ })
    await expect(firstCard).toHaveAttribute('aria-current', 'step')
    await firstCard.hover()

    const activeIndex = () =>
      page.evaluate(() =>
        Number(
          document
            .querySelector('[aria-current="step"]')
            ?.closest('[data-scene-index]')
            ?.getAttribute('data-scene-index') ?? -1,
        ),
      )

    // Wheel in small steps: the active scene must advance past the first card.
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 250)
          return activeIndex()
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0)

    // And wheeling back up must return to the first card.
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, -300)
          return activeIndex()
        },
        { timeout: 15_000 },
      )
      .toBe(0)
  })

  test('shows the source note in an info dialog', async ({ page }) => {
    await page.goto(STORY_URL)
    await page.getByRole('button', { name: 'Source note' }).click()
    await expect(page.getByRole('dialog')).toContainText('administrative and statistical definitions')
  })

  test('the layers panel lists only the scene-relevant legend', async ({ page }) => {
    await page.goto(STORY_URL)
    // Scene 1 shows the health-authority regions by full name; entries from
    // other scenes' layers (e.g. the BCER zones) are not listed at all.
    await expect(page.getByRole('button', { name: 'Vancouver Island', exact: true })).toBeVisible()
    await expect(page.getByText('Story layers')).toBeHidden()
    // Scene 5's BCER zones are absent (role-scoped: the narrative text also
    // mentions the zone names, but only legend entries are toggle buttons).
    await expect(page.getByRole('button', { name: 'South West', exact: true })).toBeHidden()
    // Scene 4 adds the three finer health boundary levels.
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Next scene' }).click()
    await expect(page.getByRole('button', { name: 'Local Health Areas', exact: true })).toBeVisible()
  })

  test('advancing a scene swaps the visible layers and the callout', async ({ page }) => {
    await page.goto(STORY_URL)
    await expect(page.getByRole('heading', { name: 'Where Does Northern B.C. Begin?' })).toBeVisible()

    await page.getByRole('button', { name: 'Next scene' }).click()

    const sceneTwo = page.getByRole('button', { name: /Prince George is northern in the health system/ })
    await expect(sceneTwo).toHaveAttribute('aria-current', 'step')
    await expect(page.getByText('Northern Health', { exact: true }).first()).toBeVisible()

    // Scene 5 turns the health layers off and the BCER zones on.
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Next scene' }).click()
    await expect(
      page.getByRole('button', { name: /For energy regulation, Prince George is southwest/ }),
    ).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('button', { name: 'South West', exact: true })).toBeVisible()
  })
})
