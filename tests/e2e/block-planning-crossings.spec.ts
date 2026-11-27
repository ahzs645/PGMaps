import { test, expect, type Locator } from '@playwright/test'
import { choose } from './styled-select'

/** Answers one question of a crossing's review, found by the start of its wording. */
const answer = (review: Locator, question: RegExp, value: string) =>
  choose(review.getByRole('combobox', { name: question }), value)

const changes = /^Will this crossing make a change in and about a stream/
const forestRoute = /^Is the change made under WSR §39\(2\)/
const listedRoute = /^Is the change made instead as a change WSR §39\(1\) lists/
const approvalRoute = /^Is the change made under a change approval/

test('each stream crossing is answered on its own, and the block shows the one with no authority by name', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dev/forestry/block-planning?interface=guided')
  await page.getByTestId('block-planning-start').getByRole('button', { name: 'Open the sample' }).click()
  await page.getByRole('tab', { name: 'Review' }).click()
  const section = page.getByTestId('block-planning-crossings')
  await expect(section).toContainText('No crossings listed for this block')
  // The block keeps its one question, and no crossing release is asked of the block.
  const block = page.getByTestId('block-planning-block-review')
  await expect(block.getByRole('region', { name: 'Stream crossings on the block' })).toBeVisible()
  await expect(
    block.getByRole('region', { name: 'BC stream crossings under the Water Sustainability Act' }),
  ).toHaveCount(0)

  const add = async (name: string) => {
    await section.getByLabel('New crossing’s name').fill(name)
    await section.getByRole('button', { name: 'Add crossing' }).click()
  }

  // A culvert that rests on no authority.
  await add('Culvert at Spur 3')
  const a = page.getByTestId('crossing-review-crossing-1')
  await answer(a, changes, 'Yes')
  await answer(a, forestRoute, 'No')
  await answer(a, listedRoute, 'No')
  await answer(a, approvalRoute, 'No')

  // A bridge on the forest route, by a holder §39(2) names who complies with FRPA.
  await add('Bridge on the FSR')
  const b = page.getByTestId('crossing-review-crossing-2')
  await answer(b, changes, 'Yes')
  await answer(b, forestRoute, 'Yes')
  await answer(b, listedRoute, 'No')
  await answer(b, approvalRoute, 'No')
  await answer(b, /^Is the change relied on under §39\(2\) made by a person it names/, 'Yes')
  await answer(b, /^Will the change comply with FRPA/, 'Yes')

  const rollup = section.getByTestId('crossings-rollup')
  const table = section.getByTestId('crossings-table')
  const expectShown = async () => {
    await expect(rollup).toContainText('Needs review')
    // The bridge's authority does not hide the culvert's lack of one.
    await expect(rollup).toContainText('Culvert at Spur 3: Changes in and about a stream · authority')
    await expect(table.locator('tr[data-crossing="crossing-1"]')).toContainText('Needs review')
    await expect(table.locator('tr[data-crossing="crossing-2"]')).toContainText('Bridge on the FSR')
    await expect(table.locator('tr[data-crossing="crossing-2"]')).not.toContainText('authority')
  }
  await expectShown()
  // Fold the open crossing for a picture of the table.
  await table.getByRole('button', { name: 'Bridge on the FSR' }).click()
  await rollup.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'tmp/crossings/crossings-table.png' })

  // Kept with the plan in this browser: both crossings and their answers come back.
  await page.waitForTimeout(1_000)
  await page.reload()
  await page.getByRole('tab', { name: 'Review' }).click()
  await expectShown()
  await table.getByRole('button', { name: 'Culvert at Spur 3' }).click()
  const reopened = page.getByTestId('crossing-review-crossing-1')
  // Questions with nothing left to answer fold away under the crossing's own heading.
  const whole = reopened.getByRole('region', { name: 'BC stream crossings under the Water Sustainability Act' })
  const toggle = whole.locator('[data-topic="whole"]')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(reopened.getByRole('combobox', { name: changes })).toHaveAttribute('data-value', 'true')
})
