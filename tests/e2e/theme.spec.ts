import { type Page } from '@playwright/test'
import { editor, expect, openTable, row, test } from './fixtures.ts'

const theme = (page: Page) => page.locator('html').getAttribute('data-theme')
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const choice = (page: Page, name: string) => page.getByRole('radio', { name })
const DARK_BG = 'rgb(17, 19, 24)'
const LIGHT_BG = 'rgb(245, 246, 248)'

test('follows the system theme by default, including while open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(choice(page, 'Match the system theme')).toBeChecked()
  expect(await theme(page)).toBe('dark')
  expect(await background(page)).toBe(DARK_BG)

  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => theme(page)).toBe('light')
  expect(await background(page)).toBe(LIGHT_BG)
})

test('a manual choice overrides the system theme and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await choice(page, 'Dark theme').click()
  await expect(choice(page, 'Dark theme')).toBeChecked()
  expect(await background(page)).toBe(DARK_BG)

  // The system changing no longer matters, and the choice survives a reload.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  expect(await theme(page)).toBe('dark')
  await expect(choice(page, 'Dark theme')).toBeChecked()

  await choice(page, 'Light theme').click()
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await background(page)).toBe(LIGHT_BG)

  // Back to following the system.
  await choice(page, 'Match the system theme').click()
  await expect.poll(() => theme(page)).toBe('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => theme(page)).toBe('light')
})

test('the theme is applied before the page first paints', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => localStorage.setItem('ddb-browser.theme', 'dark'))
  // Hold back the app's script so only the inline theme script has run.
  await page.route('**/assets/*.js', () => {})
  await page.goto('/', { waitUntil: 'commit' })
  await expect.poll(() => theme(page)).toBe('dark')
})

test('the item editor and native controls follow the theme', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [{ id: { S: 'k1' }, n: { N: '1' } }])
  await page.emulateMedia({ colorScheme: 'light' })
  await openTable(page, table)
  await row(page, 'k1').click()

  const editorBackground = () => page.locator('.cm-editor').evaluate((el) => getComputedStyle(el).backgroundColor)
  const colorScheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
  const light = await editorBackground()
  expect(await colorScheme()).toBe('light')
  await expect(editor(page)).toContainText('"id": "k1"')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(editorBackground).not.toBe(light)
  expect(await colorScheme()).toBe('dark')
  // Switching theme must not disturb what is being edited.
  await expect(editor(page)).toContainText('"id": "k1"')
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)
})
