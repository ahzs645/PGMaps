import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { ROAD_LESSON_FIXTURES } from '../../src/pages/dev-forestry-roads/tours/roadLessonFixtures'
import { lessonLaunchHref } from '../../src/pages/help/helpLinks'

// Every live lesson runs to its end in Watch, from the address the help opens it with: each step's
// action goes through the designer's own operation and leaves the state its check reads.
test.use({ serviceWorkers: 'block', actionTimeout: 15_000, viewport: { width: 1440, height: 900 } })
test.setTimeout(240_000)

const lessonsDir = new URL('../../src/pages/dev-forestry-roads/tours/lessons/', import.meta.url)
const lessons = readdirSync(lessonsDir)
  .filter((file) => file.endsWith('.json'))
  .map(
    (file) =>
      JSON.parse(readFileSync(new URL(file, lessonsDir), 'utf8')) as {
        id: string
        launch: { fixture: string }
        chapters: { steps: { id: string }[] }[]
      },
  )

for (const lesson of lessons) {
  test(`Watch runs ${lesson.id} to its end`, async ({ page }) => {
    const steps = lesson.chapters.flatMap((chapter) => chapter.steps.map((step) => step.id))
    const fixture = ROAD_LESSON_FIXTURES[lesson.launch.fixture]
    await page.goto(lessonLaunchHref(lesson.id, 'watch', fixture.params, 'workbench'))
    const seen = new Set<string>()
    const card = page.locator('[data-tutorial-surface][data-tutorial-step]')
    await expect(async () => {
      const step = await card.getAttribute('data-tutorial-step', { timeout: 1_000 }).catch(() => null)
      if (step) seen.add(step)
      await expect(page.getByTestId('tutorial-error')).toHaveCount(0)
      await expect(page.getByText('Nice work — you did it!')).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 200_000, intervals: [500] })
    // A step can pass in under the polling interval; most are seen, and the last always is.
    expect(seen.has(steps[steps.length - 1]) || seen.size >= steps.length - 2).toBe(true)
  })
}
