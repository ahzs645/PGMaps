// The CCISS page's original tiles, and a change of time period (a source swap).
//   --url 'http://127.0.0.1:42320/dev/forestry/cciss-suitability?lng=-123.2&lat=54.0&z=7&render=tiles'
//   --layer cciss-original-tiles --layer cciss-original-tiles-handoff --host tileserver.thebeczone.ca
//   --journey drag,zoom-out
// The label wraps its dropdown, so its accessible name carries the chosen value too.
const dropdown = (page, label) => page.locator('label', { hasText: label }).locator('[data-select-trigger]').first()
const pick = async (page, label, index) => {
  await dropdown(page, label).click()
  const list = page.getByRole('listbox').last()
  await list.waitFor()
  await list.getByRole('option').nth(index).click()
  await list.waitFor({ state: 'hidden' })
}

export async function setup({ page }) {
  await dropdown(page, 'Time period').waitFor({ timeout: 60_000 })
}

export const actions = [
  { name: 'period-2', run: ({ page }) => pick(page, 'Time period', 2), holdMs: 4500 },
  { name: 'period-3', run: ({ page }) => pick(page, 'Time period', 3), holdMs: 4500 },
  { name: 'period-1', run: ({ page }) => pick(page, 'Time period', 1), holdMs: 4500 },
]
