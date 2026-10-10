import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const electronVersion = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version

// Each test gets its own settings folder; relaunch tests reuse one deliberately.
const newUserData = () => mkdtempSync(path.join(tmpdir(), 'ddb-browser-desktop-'))

function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...(process.env.CI ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      // Never read the developer's real AWS configuration.
      AWS_CONFIG_FILE: path.join(userData, 'no-aws-config'),
      AWS_SHARED_CREDENTIALS_FILE: path.join(userData, 'no-aws-credentials'),
      AWS_ACCESS_KEY_ID: '',
    },
  })
}

const windowSize = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())

test('opens a window showing the app served from its own local server', async () => {
  const app = await launch(newUserData())
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('DDB Browser')
  expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
  await expect(page.locator('aside select').first().locator('option')).toHaveText(['DynamoDB Local'])
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await app.close()
})

test('About reports the desktop runtime', async () => {
  const app = await launch(newUserData())
  const page = await app.firstWindow()
  await page.getByRole('button', { name: `DDB Browser v${pkg.version}` }).click()
  const rows = page.locator('.fixed dl > div')
  await expect(rows.filter({ hasText: 'Running as' })).toContainText('Desktop app')
  await expect(rows.filter({ hasText: 'Electron' })).toContainText(electronVersion)
  await expect(rows.filter({ hasText: 'Chromium' })).toContainText(/\d+\.\d+/)
  await app.close()
})

test('the page cannot reach Node or Electron', async () => {
  const app = await launch(newUserData())
  const page = await app.firstWindow()
  expect(await page.evaluate(() => [typeof (window as any).require, typeof (window as any).process])).toEqual([
    'undefined',
    'undefined',
  ])
  await app.close()
})

test('links open in the system browser, not in a new app window', async () => {
  const app = await launch(newUserData())
  const page = await app.firstWindow()
  // Record instead of really launching a browser.
  await app.evaluate(({ shell }) => {
    ;(globalThis as any).opened = []
    shell.openExternal = async (url: string) => void (globalThis as any).opened.push(url)
  })
  await page.getByRole('button', { name: /DDB Browser v/ }).click()
  await page.getByRole('link', { name: 'Source on GitHub' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).opened)).toEqual(['https://github.com/kdynan/ddb-browser'])
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await app.close()
})

test('remembers the window size and page settings between launches', async () => {
  const userData = newUserData()
  let app = await launch(userData)
  let page = await app.firstWindow()
  // The starting size depends on the screen, so only the change is checked.
  expect(await windowSize(app)).not.toEqual([1100, 700])
  const origin = new URL(page.url()).origin
  await page.evaluate(() => localStorage.setItem('ddb-browser.sidebarWidth', '333'))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700))
  await expect.poll(() => windowSize(app)).toEqual([1100, 700])
  await app.close()

  app = await launch(userData)
  page = await app.firstWindow()
  expect(await windowSize(app)).toEqual([1100, 700])
  // Same port, so the page's saved settings are still there.
  expect(new URL(page.url()).origin).toBe(origin)
  await expect.poll(async () => (await page.locator('aside').boundingBox())?.width).toBe(333)
  await app.close()
})

test('quits when the window is closed', async () => {
  const app = await launch(newUserData())
  const page = await app.firstWindow()
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await page.close()
  await exited
})
