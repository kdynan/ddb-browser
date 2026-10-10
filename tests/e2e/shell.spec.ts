import { readFileSync } from 'node:fs'
import { dialog, expect, openTable, sidebarTable, test } from './fixtures.ts'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

test('offers only DynamoDB Local when there are no AWS profiles', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('aside select').first().locator('option')).toHaveText(['DynamoDB Local'])
  await expect(page.locator('aside').getByPlaceholder('http://localhost:8000')).toHaveValue(process.env.E2E_DDB_ENDPOINT!)
})

test('starts on the first profile when nothing has been saved', async ({ browser, baseURL }) => {
  const context = await browser.newContext() // no saved connection
  const page = await context.newPage()
  await page.goto(baseURL!)
  await expect(page.locator('aside select').first()).toHaveValue('(local)')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ddb-browser.conn') ?? '{}').profile)).toBe('(local)')
  await context.close()
})

test('reports an unreachable database and recovers when the endpoint is fixed', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await page.goto('/')
  await expect(sidebarTable(page, table)).toBeVisible()
  const endpoint = page.locator('aside').getByPlaceholder('http://localhost:8000')

  await endpoint.fill('http://127.0.0.1:9')
  await endpoint.press('Enter')
  await expect(page.locator('aside').getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(sidebarTable(page, table)).toHaveCount(0)

  await endpoint.fill(process.env.E2E_DDB_ENDPOINT!)
  await endpoint.press('Enter')
  await expect(sidebarTable(page, table)).toBeVisible()
  await expect(page.locator('aside').getByRole('alert')).toHaveCount(0)
})

test('clears a stale table-list error when the window regains focus', async ({ page }) => {
  let failing = true
  await page.route('**/api/tables', (route) => (failing ? route.fulfill({ status: 502, body: 'Bad Gateway' }) : route.continue()))
  await page.goto('/')
  await expect(page.locator('aside').getByRole('alert')).toContainText("Can't reach the DDB Browser server")

  failing = false
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('aside').getByRole('alert')).toHaveCount(0)
})

test('resizes the sidebar and remembers the width', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.locator('aside')
  const divider = page.getByRole('separator')
  const width = async () => (await sidebar.boundingBox())!.width
  expect(await width()).toBe(256)

  const drag = async (toX: number) => {
    const box = (await divider.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, 300)
    await page.mouse.down()
    await page.mouse.move(toX, 300, { steps: 5 })
    await page.mouse.up()
  }
  await drag(420)
  expect(await width()).toBe(420)
  await page.reload()
  expect(await width()).toBe(420)

  await drag(10) // can't collapse below the minimum
  expect(await width()).toBe(160)
  await drag(5000) // or squeeze out the main area
  expect(await width()).toBe(1400 - 320)

  await divider.dblclick()
  expect(await width()).toBe(256)
})

test('switching tables shows the new table and resets the search', async ({ page, ddb }) => {
  const first = await ddb.createTable()
  const second = await ddb.createTable()
  await ddb.put(first, [{ id: { S: 'only-in-first' } }])
  await ddb.put(second, [{ id: { S: 'only-in-second' } }])
  await openTable(page, first)
  await page.getByPlaceholder('Find in loaded items').fill('zzz')
  await expect(page.getByText('No loaded items match')).toBeVisible()

  await sidebarTable(page, second).click()
  await expect(page.getByRole('heading', { name: second })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveText([/only-in-second/])
  await expect(page.getByPlaceholder('Find in loaded items')).toHaveValue('')
})

test('About shows the version and how the app is running', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: `DDB Browser v${version}` }).click()
  const rows = dialog(page).locator('dl > div')
  await expect(rows.filter({ hasText: 'Version' })).toContainText(version)
  await expect(rows.filter({ hasText: 'Running as' })).toContainText('Web app in your browser')
  await expect(rows.filter({ hasText: 'Node.js' })).toContainText(/\d+\.\d+\.\d+/)
  await expect(rows.filter({ hasText: 'Electron' })).toHaveCount(0)
  await expect(dialog(page).getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('target', '_blank')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'About' })).toHaveCount(0)
})

test('serves the app for any path and keeps API errors as JSON', async ({ page, request }) => {
  await page.goto('/some/deep/link')
  await expect(page.locator('aside')).toBeVisible()
  const missing = await request.get('/api/does-not-exist')
  expect(missing.status()).toBe(404)
  expect(await missing.json()).toMatchObject({ error: 'NotFound' })
  const foreign = await request.get('/api/tables', { headers: { origin: 'https://evil.example' } })
  expect(foreign.status()).toBe(403)
})
