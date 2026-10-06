import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

for (const width of [1440, 390]) {
  test(`Prague decodes nearby images and retains media during a slow swap at ${width}px`, async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g', saveData: false } }),
    )
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let requested = false
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/assets/fYs6LDk6BBcJAfy-BZPsX.png', async (route) => {
      requested = true
      await pending
      await route.fulfill({
        contentType: 'image/png',
        body: readFileSync('public/data/story-documents/prague/assets/fYs6LDk6BBcJAfy-BZPsX.png'),
      })
    })
    await page.goto('/dev/projects/example-prague')
    const region = page.locator('#n-WQCHkO')
    const slides = region.locator('.editorial-slide')
    const image = region.locator('.editorial-immersive-media img')
    await slides.first().evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(image).toHaveAttribute('data-image-state', 'ready')
    await expect(image).toHaveAttribute('src', /-OcAdL/)
    await expect.poll(() => requested).toBe(true) // warmed before navigation
    await slides.nth(1).evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(region).toHaveAttribute('data-active-slide', '1')
    await expect(image).toHaveAttribute('data-image-state', 'loading')
    await expect(image).toHaveAttribute('src', /-OcAdL/)
    expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    // A skipped, late response must never replace the new active image.
    await slides.nth(2).evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(image).toHaveAttribute('src', /1PgWk/)
    release()
    await expect(image).toHaveAttribute('data-image-state', 'ready')
    await slides.nth(1).evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(image).toHaveAttribute('src', /fYs6L/)
    expect(errors).toEqual([])
  })

  test(`Prague section links restore panels and preserve history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/dev/projects/example-prague?reading=test#n-bMeb1v')
    const region = page.locator('#n-WQCHkO')
    await expect(region).toHaveAttribute('data-active-slide', '1')
    const historyLength = await page.evaluate(() => history.length)
    const slide = region.locator('.editorial-slide').nth(2)
    await slide.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(page).toHaveURL(/\?reading=test#n-RyPy2v$/)
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    await page.reload()
    await expect(region).toHaveAttribute('data-active-slide', '2')
    await expect(page).toHaveURL(/#n-RyPy2v$/)
    await page.evaluate(() => {
      location.hash = 'n-bMeb1v'
    })
    await expect(region).toHaveAttribute('data-active-slide', '1')
    await page.goBack()
    await expect(region).toHaveAttribute('data-active-slide', '2')
    await page.getByRole('button', { name: 'The Diverse Prague: Return to top', exact: true }).click()
    await expect(page).toHaveURL(/\?reading=test$/)
  })

  test(`Project can disable section URL updates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const project = JSON.parse(readFileSync('public/data/projects/example/prague.json', 'utf8'))
    project.workspace.options.sectionUrl = false
    await page.route('**/data/projects/example/prague.json?*', (route) => route.fulfill({ json: project }))
    await page.goto('/dev/projects/example-prague?reading=test#custom')
    await page
      .locator('#n-WQCHkO .editorial-slide')
      .nth(1)
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(page.locator('#n-WQCHkO')).toHaveAttribute('data-active-slide', '1')
    await expect(page).toHaveURL(/\?reading=test#custom$/)
    await expect(page.getByTestId('editorial-cover')).not.toBeInViewport()
  })

  test(`Native editorial projects can opt into section links at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const project = JSON.parse(readFileSync('public/data/projects/example/native-editorial.json', 'utf8'))
    project.workspace.options.sectionUrl = true
    await page.route('**/data/projects/example/native-editorial.json?*', (route) => route.fulfill({ json: project }))
    await page.goto('/dev/projects/example-native-editorial#coast-step')
    const sidecar = page.locator('#region-sidecar')
    await expect(sidecar).toHaveAttribute('data-active-slide', '2')
    await page.locator('#cariboo-step').evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(page).toHaveURL(/#cariboo-step$/)
    await page.reload()
    await expect(sidecar).toHaveAttribute('data-active-slide', '1')
  })
}

test('Prague skips adjacent preloading in data saver mode', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '4g', saveData: true } }),
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let requested = false
  await page.route('**/assets/fYs6LDk6BBcJAfy-BZPsX.png', async (route) => {
    requested = true
    await route.continue()
  })
  await page.goto('/dev/projects/example-prague')
  const region = page.locator('#n-WQCHkO')
  await region
    .locator('.editorial-slide')
    .first()
    .evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expect(region.locator('.editorial-immersive-media img')).toHaveAttribute('data-image-state', 'ready')
  expect(requested).toBe(false)
  await region
    .locator('.editorial-slide')
    .nth(1)
    .evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expect(region.locator('.editorial-immersive-media img')).toHaveAttribute('src', /fYs6L/)
  expect(requested).toBe(true)
})

test('Cover playback stops offscreen and preserves the reader pause preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/dev/projects/example-prague')
  const video = page.locator('video')
  const reading = page.getByRole('heading', { name: 'What is urban diversity?', exact: true })
  const top = page.getByRole('button', { name: 'The Diverse Prague: Return to top', exact: true })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await reading.evaluate((element) => element.scrollIntoView({ behavior: 'instant', block: 'start' }))
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await top.click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await page.getByRole('button', { name: 'Pause cover video', exact: true }).click()
  await reading.evaluate((element) => element.scrollIntoView({ behavior: 'instant', block: 'start' }))
  await top.click()
  await expect(page.getByRole('button', { name: 'Play cover video', exact: true })).toBeInViewport()
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
})
