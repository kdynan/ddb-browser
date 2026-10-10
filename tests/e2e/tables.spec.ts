import { dialog, expect, openTable, sidebarTable, test } from './fixtures.ts'

test('creates a table with a sort key and an index', async ({ page, ddb }) => {
  const name = ddb.name('created')
  await page.goto('/')
  await page.getByTitle('Create table').click()
  const create = dialog(page).getByRole('button', { name: 'Create table' })
  await expect(create).toBeDisabled()

  await dialog(page).locator('input').first().fill(name)
  await dialog(page).getByPlaceholder('e.g. pk').fill('id')
  await dialog(page).getByPlaceholder('e.g. sk').fill('created')
  await dialog(page).locator('select').nth(1).selectOption('N')
  await dialog(page).getByRole('button', { name: 'Add index' }).click()
  await expect(create).toBeDisabled() // the new index still needs a name and key
  await dialog(page).getByPlaceholder('Index name').fill('byCity')
  await dialog(page).getByPlaceholder('Partition key', { exact: true }).fill('city')
  await create.click()

  // The new table opens straight away and is listed in the sidebar.
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('No items')).toBeVisible()
  await expect(sidebarTable(page, name)).toBeVisible()

  await page.getByRole('button', { name: 'details' }).click()
  await expect(page.getByText('id (S) partition · created (N) sort')).toBeVisible()
  await expect(page.locator('tr', { hasText: 'byCity' })).toContainText('city (S) partition')
  await expect(page.getByText('On-demand')).toBeVisible()

  const table = await ddb.describe(name)
  expect(table.KeySchema.map((k) => k.AttributeName)).toEqual(['id', 'created'])
  expect(table.GlobalSecondaryIndexes?.map((g) => g.IndexName)).toEqual(['byCity'])
})

test('shows why a table could not be created and keeps the form open', async ({ page, ddb }) => {
  const existing = await ddb.createTable()
  await page.goto('/')
  await page.getByTitle('Create table').click()
  await dialog(page).locator('input').first().fill(existing)
  await dialog(page).getByPlaceholder('e.g. pk').fill('id')
  await dialog(page).getByRole('button', { name: 'Create table' }).click()
  await expect(dialog(page).getByRole('alert')).toContainText(/exist/i)
  await expect(dialog(page).locator('input').first()).toHaveValue(existing)
})

test('filters the table list', async ({ page, ddb }) => {
  const apples = await ddb.createTable({ name: ddb.name('apples') })
  const pears = await ddb.createTable({ name: ddb.name('pears') })
  await page.goto('/')
  await expect(sidebarTable(page, apples)).toBeVisible()
  await page.getByPlaceholder(/Filter \d+ tables/).fill(pears.toUpperCase())
  await expect(sidebarTable(page, pears)).toBeVisible()
  await expect(sidebarTable(page, apples)).toHaveCount(0)
  await page.getByPlaceholder(/Filter \d+ tables/).fill('no-table-is-called-this')
  await expect(page.getByText('No matching tables')).toBeVisible()
})

test('lists a table created elsewhere after refreshing', async ({ page, ddb }) => {
  await page.goto('/')
  await expect(page.getByPlaceholder(/Filter \d+ tables/)).toBeVisible()
  const later = await ddb.createTable()
  await expect(sidebarTable(page, later)).toHaveCount(0)
  await page.getByTitle('Refresh tables').click()
  await expect(sidebarTable(page, later)).toBeVisible()
})

test('deletes a table only after its name is typed', async ({ page, ddb }) => {
  const name = await ddb.createTable()
  await openTable(page, name)
  await page.getByTitle('Delete table').click()
  const confirm = dialog(page).getByRole('button', { name: 'Delete table' })
  await expect(confirm).toBeDisabled()
  await dialog(page).getByPlaceholder(name).fill(name.slice(0, -1))
  await expect(confirm).toBeDisabled()
  await dialog(page).getByPlaceholder(name).fill(name)
  await confirm.click()

  await expect(page.getByText('Select a table to browse its items')).toBeVisible()
  await expect(sidebarTable(page, name)).toHaveCount(0)
  expect(await ddb.exists(name)).toBe(false)
})

test('cancelling the delete dialog keeps the table', async ({ page, ddb }) => {
  const name = await ddb.createTable()
  await openTable(page, name)
  await page.getByTitle('Delete table').click()
  await dialog(page).getByPlaceholder(name).fill(name)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name })).toBeVisible()
  expect(await ddb.exists(name)).toBe(true)
})
