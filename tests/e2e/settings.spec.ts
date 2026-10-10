import { dialog, expect, openTable, test } from './fixtures.ts'

const openDetails = async (page: import('@playwright/test').Page, table: string) => {
  await openTable(page, table)
  await page.getByRole('button', { name: 'details' }).click()
}

test('shows table details', async ({ page, ddb }) => {
  const table = await ddb.createTable({
    sk: { name: 'at', type: 'N' },
    billing: 'PROVISIONED',
    rcu: 4,
    wcu: 2,
    gsis: [{ name: 'byKind', pk: { name: 'kind', type: 'S' }, projection: 'KEYS_ONLY' }],
  })
  await openDetails(page, table)
  await expect(page.getByText('id (S) partition · at (N) sort')).toBeVisible()
  await expect(page.getByText('Provisioned · 4 RCU / 2 WCU')).toBeVisible()
  await expect(page.locator('dl')).toContainText(`table/${table}`)
  const index = page.locator('tr', { hasText: 'byKind' })
  await expect(index).toContainText('GSI')
  await expect(index).toContainText('KEYS_ONLY')
  await expect(index).toContainText('ACTIVE')
})

test('changes capacity mode, TTL and deletion protection in one save', async ({ page, ddb }) => {
  const table = await ddb.createTable({ gsis: [{ name: 'byKind', pk: { name: 'kind', type: 'S' }, projection: 'ALL' }] })
  await openDetails(page, table)
  await page.getByRole('button', { name: 'Edit settings' }).click()
  const save = dialog(page).getByRole('button', { name: 'Save changes' })
  await expect(save).toBeDisabled() // nothing changed yet

  await dialog(page).locator('select').selectOption('PROVISIONED')
  await expect(dialog(page).getByText('Existing indexes will get the same read and write units.')).toBeVisible()
  await dialog(page).locator('input[type=number]').nth(0).fill('7')
  await dialog(page).locator('input[type=number]').nth(1).fill('3')
  await dialog(page).getByText('Expire items automatically').click()
  await expect(save).toBeDisabled() // TTL needs an attribute
  await dialog(page).getByPlaceholder('e.g. expiresAt').fill('expiresAt')
  await dialog(page).getByText('Deletion protection').click()
  await save.click()

  await expect(page.getByText('Provisioned · 7 RCU / 3 WCU')).toBeVisible()
  await expect(page.getByText('Enabled on "expiresAt"')).toBeVisible()
  const described = await ddb.describe(table)
  expect(described.ProvisionedThroughput).toMatchObject({ ReadCapacityUnits: 7, WriteCapacityUnits: 3 })
  expect(described.DeletionProtectionEnabled).toBe(true)
  expect(described.ttl).toEqual({ status: 'ENABLED', attribute: 'expiresAt' })

  // The TTL attribute can't be changed while TTL is on.
  await page.getByRole('button', { name: 'Edit settings' }).click()
  await expect(dialog(page).getByPlaceholder('e.g. expiresAt')).toBeDisabled()
  await expect(dialog(page).getByPlaceholder('e.g. expiresAt')).toHaveValue('expiresAt')

  // Change only the read units, then put everything back.
  await dialog(page).locator('input[type=number]').nth(0).fill('12')
  await save.click()
  await expect(page.getByText('Provisioned · 12 RCU / 3 WCU')).toBeVisible()

  await page.getByRole('button', { name: 'Edit settings' }).click()
  await dialog(page).locator('select').selectOption('PAY_PER_REQUEST')
  await dialog(page).getByText('Expire items automatically').click()
  await dialog(page).getByText('Deletion protection').click()
  await save.click()
  await expect(page.getByText('On-demand')).toBeVisible()
  await expect.poll(async () => (await ddb.describe(table)).ttl?.status).toBe('DISABLED')
  expect((await ddb.describe(table)).DeletionProtectionEnabled).toBe(false)
})

test('will not delete a table that has deletion protection', async ({ page, ddb }) => {
  const table = await ddb.createTable({ deletionProtection: true })
  await openDetails(page, table)
  await expect(page.locator('dl')).toContainText('Deletion protectionEnabled')
  await page.getByTitle('Delete table').click()
  await dialog(page).getByPlaceholder(table).fill(table)
  await dialog(page).getByRole('button', { name: 'Delete table' }).click()
  await expect(dialog(page).getByRole('alert')).toBeVisible()
  expect(await ddb.exists(table)).toBe(true)
})

test('adds an index, uses it, then deletes it', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [
    { id: { S: 'a' }, city: { S: 'Boston' } },
    { id: { S: 'b' }, city: { S: 'Austin' } },
    { id: { S: 'c' }, city: { S: 'Boston' } },
  ])
  await openDetails(page, table)
  await expect(page.getByText('No secondary indexes')).toBeVisible()

  await page.getByRole('button', { name: 'Add index' }).click()
  const create = dialog(page).getByRole('button', { name: 'Create index' })
  await expect(create).toBeDisabled()
  await dialog(page).locator('input').first().fill('byCity')
  await dialog(page).getByPlaceholder('attribute name').nth(0).fill('city')
  // "id" is already a string key; choosing Number here must not break the request.
  await dialog(page).getByPlaceholder('attribute name').nth(1).fill('id')
  await dialog(page).locator('select').nth(2).selectOption('N')
  await create.click()

  const index = page.locator('tr', { hasText: 'byCity' })
  await expect(index).toContainText('city (S) partition · id (S) sort')
  await expect(index).toContainText('ACTIVE', { timeout: 20_000 })

  await page.getByRole('button', { name: 'items' }).click()
  await page.getByRole('button', { name: 'query', exact: true }).click()
  await page.getByTitle('Table or index to read').selectOption('byCity')
  await page.getByPlaceholder('Partition key (S)').fill('Boston')
  await page.keyboard.press('Enter')
  await expect(page.getByText('2 items loaded')).toBeVisible()

  await page.getByRole('button', { name: 'details' }).click()
  await index.getByTitle('Delete index').click()
  expect((await ddb.describe(table)).GlobalSecondaryIndexes).toHaveLength(1) // first click only arms it
  await index.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.getByText('No secondary indexes')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await ddb.describe(table)).GlobalSecondaryIndexes ?? []).toEqual([])
})

test('shows why an index could not be added', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await openDetails(page, table)
  await page.getByRole('button', { name: 'Add index' }).click()
  await dialog(page).locator('input').first().fill('x') // too short for DynamoDB
  await dialog(page).getByPlaceholder('attribute name').nth(0).fill('city')
  await dialog(page).getByRole('button', { name: 'Create index' }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('between 3 and 255 characters')
  expect((await ddb.describe(table)).GlobalSecondaryIndexes ?? []).toEqual([])
})
