import { expect, type Locator } from '@playwright/test'

/**
 * Road-page dropdowns are styled comboboxes, not native selects: `selectOption`, `toHaveValue` and
 * `option` locators do not apply. Each trigger and option carries its value in `data-value`.
 */
const quote = (value: string) => JSON.stringify(value)

/** Opens a dropdown and picks an option by value, by exact label, or by `{ label }` / `{ value }`. */
export async function choose(
  select: Locator,
  option: string | { label: string | RegExp } | { value: string } | { index: number },
) {
  await select.click()
  const page = select.page()
  const list = page.getByRole('listbox').last()
  await expect(list).toBeVisible()
  const target =
    typeof option === 'string'
      ? list
          .locator(`[role="option"][data-value=${quote(option)}]`)
          .or(list.getByRole('option', { name: option, exact: true }))
          .first()
      : 'value' in option
        ? list.locator(`[role="option"][data-value=${quote(option.value)}]`)
        : 'index' in option
          ? list.getByRole('option').nth(option.index)
          : list.getByRole('option', { name: option.label, exact: typeof option.label === 'string' })
  await target.click()
  await expect(list).toBeHidden()
}

/** The selected value, as `inputValue()` gave it for a native select. */
export const selectedValue = (select: Locator) => select.getAttribute('data-value')

/** The option labels, read by opening the list and closing it again. */
export async function optionLabels(select: Locator) {
  await select.click()
  const page = select.page()
  const list = page.getByRole('listbox').last()
  await expect(list).toBeVisible()
  const labels = (await list.getByRole('option').allTextContents()).map((label) => label.trim())
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  return labels
}

/** Whether the option with this label is disabled. */
export async function optionDisabled(select: Locator, label: string) {
  await select.click()
  const page = select.page()
  const option = page.getByRole('listbox').last().getByRole('option', { name: label, exact: true })
  const disabled =
    (await option.getAttribute('aria-disabled')) === 'true' || (await option.getAttribute('data-disabled')) !== null
  await page.keyboard.press('Escape')
  return disabled
}

/** Every option's value, label and disabled state. */
export async function optionEntries(select: Locator) {
  await select.click()
  const page = select.page()
  const list = page.getByRole('listbox').last()
  await expect(list).toBeVisible()
  const entries = await list.getByRole('option').evaluateAll((options) =>
    options.map((option) => ({
      value: option.getAttribute('data-value') ?? '',
      label: option.textContent?.trim() ?? '',
      disabled: option.getAttribute('aria-disabled') === 'true' || option.hasAttribute('data-disabled'),
    })),
  )
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  return entries
}
