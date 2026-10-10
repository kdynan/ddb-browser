import type { Item } from '../../shared/types.ts'
import { type Ddb, expect, openTable, row, test } from './fixtures.ts'

// 60 orders across 3 customers; even order numbers are open, odd are closed.
const order = (n: number): Item => ({
  customer: { S: `cust#${n % 3}` },
  number: { N: String(n) },
  status: { S: n % 2 === 0 ? 'open' : 'closed' },
  note: { S: `order-${String(n).padStart(2, '0')}` },
  shipping: { M: { city: { S: n % 4 === 0 ? 'Boston' : 'Austin' }, weight: { N: String(n * 1.5) } } },
})

async function ordersTable(ddb: Ddb) {
  const table = await ddb.createTable({
    pk: { name: 'customer', type: 'S' },
    sk: { name: 'number', type: 'N' },
    gsis: [{ name: 'byStatus', pk: { name: 'status', type: 'S' }, sk: { name: 'number', type: 'N' }, projection: 'ALL' }],
  })
  await ddb.put(table, Array.from({ length: 60 }, (_, i) => order(i + 1)))
  return table
}

const rows = (page: import('@playwright/test').Page) => page.locator('tbody tr')
const run = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Run' }).click()

test('pages through a table with Load more', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await expect(page.getByText('60 items loaded')).toBeVisible()
  await expect(page.getByText('End of results')).toBeVisible()

  await page.getByTitle('Items per page').selectOption('25')
  await run(page)
  await expect(page.getByText('25 items loaded')).toBeVisible()
  await expect(page.getByText('25 scanned')).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('50 items loaded')).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('60 items loaded')).toBeVisible()
  await expect(page.getByText('60 scanned')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0)
  await expect(rows(page)).toHaveCount(60)

  // Every order is listed once.
  const notes = await page.locator('tbody tr td:nth-child(4)').allInnerTexts()
  expect(new Set(notes).size).toBe(60)
})

test('lists key columns first, then the rest alphabetically', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await expect(page.locator('thead th')).toHaveText(['', /^customer\s*PK$/, /^number\s*SK$/, 'note', 'shipping', 'status'])
  await expect(row(page, 'order-08')).toContainText('{"city":"Boston","weight":12}')
})

test('filters a scan on a nested numeric attribute', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByPlaceholder('attribute or path.to.attr').fill('shipping.weight')
  await page.locator('select').filter({ hasText: 'begins with' }).selectOption('>=')
  await page.locator('select').filter({ hasText: 'Boolean' }).selectOption('N')
  await page.getByPlaceholder('value').fill('84')
  await run(page)

  await expect(page.getByText('5 items loaded')).toBeVisible() // orders 56-60
  await expect(page.getByText('60 scanned')).toBeVisible()
  await expect(row(page, 'order-56')).toBeVisible()
  await expect(row(page, 'order-55')).toHaveCount(0)

  // Removing the filter brings everything back.
  await page.getByTitle('Remove filter').click()
  await run(page)
  await expect(page.getByText('60 items loaded')).toBeVisible()
})

test('combines filters, including exists checks that need no value', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await ddb.put(table, [{ ...order(61), gift: { BOOL: true } }])
  await openTable(page, table)

  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByPlaceholder('attribute or path.to.attr').fill('gift')
  await page.locator('select').filter({ hasText: 'begins with' }).selectOption('exists')
  await expect(page.getByPlaceholder('value')).toHaveCount(0)
  await run(page)
  await expect(page.getByText('1 item loaded')).toBeVisible()
  await expect(row(page, 'order-61')).toBeVisible()

  await page.locator('select').filter({ hasText: 'begins with' }).selectOption('not_exists')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByPlaceholder('attribute or path.to.attr').nth(1).fill('shipping.city')
  await page.getByPlaceholder('value').fill('Boston')
  await page.getByPlaceholder('value').press('Enter') // Enter runs the search
  await expect(page.getByText('15 items loaded')).toBeVisible()
})

test('queries a partition with a sort key range, newest first', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByRole('button', { name: 'query', exact: true }).click()
  await page.getByPlaceholder('Partition key (S)').fill('cust#1')
  await page.locator('select').filter({ hasText: 'begins with' }).first().selectOption('between')
  await page.getByPlaceholder('Sort key (N), optional').fill('10')
  await page.getByPlaceholder('and').fill('30')
  await page.getByTitle('Sort key order').selectOption('desc')
  await run(page)

  // cust#1 has orders 1, 4, 7, ...; between 10 and 30 that is 10, 13, ..., 28.
  await expect(page.getByText('7 items loaded')).toBeVisible()
  await expect(page.getByText('7 scanned')).toBeVisible()
  await expect(page.locator('tbody tr td:nth-child(3)')).toHaveText(['28', '25', '22', '19', '16', '13', '10'])
})

test('queries a secondary index', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByRole('button', { name: 'query', exact: true }).click()
  await page.getByTitle('Table or index to read').selectOption('byStatus')
  // The key fields follow the index's keys.
  await page.getByPlaceholder('Partition key (S)').fill('open')
  await page.keyboard.press('Enter')
  await expect(page.getByText('30 items loaded')).toBeVisible()
  // The index's partition key joins the key columns at the front.
  await expect(page.locator('thead th')).toHaveText(['', /^customer/, /^number/, 'status', 'note', 'shipping'])
  await expect(page.locator('tbody tr td:nth-child(4)')).toHaveText(Array(30).fill('open'))
  await expect(page.locator('tbody tr td:nth-child(3)').first()).toHaveText('2')
})

test('shows a query error and recovers on the next run', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByRole('button', { name: 'query', exact: true }).click()
  await page.getByPlaceholder('Partition key (S)').fill('cust#1')
  await page.getByPlaceholder('Sort key (N), optional').fill('abc')
  await run(page)
  await expect(page.getByRole('alert')).toContainText('"abc" is not a number')

  await page.getByPlaceholder('Sort key (N), optional').fill('4')
  await run(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('1 item loaded')).toBeVisible()
})

test('finds text within the loaded items without re-reading the table', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByPlaceholder('Find in loaded items').fill('BOSTON')
  await expect(rows(page)).toHaveCount(15)
  await expect(page.getByText('60 items loaded · 15 shown')).toBeVisible()

  await page.getByPlaceholder('Find in loaded items').fill('order-07')
  await expect(rows(page)).toHaveCount(1)
  await page.getByPlaceholder('Find in loaded items').fill('nothing matches this')
  await expect(page.getByText('No loaded items match')).toBeVisible()
  await page.getByPlaceholder('Find in loaded items').fill('')
  await expect(rows(page)).toHaveCount(60)
})

test('select all applies only to the items shown', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByPlaceholder('Find in loaded items').fill('order-0')
  await expect(rows(page)).toHaveCount(9)
  await page.getByRole('checkbox', { name: 'Select all' }).click()
  await page.getByRole('button', { name: 'Delete 9' }).click()
  await page.getByRole('button', { name: 'Confirm: delete 9 items' }).click()
  await page.getByPlaceholder('Find in loaded items').fill('')
  await expect(rows(page)).toHaveCount(51)
  expect(await ddb.items(table)).toHaveLength(51)
})

test('exports the shown items as DynamoDB JSON', async ({ page, ddb }) => {
  const table = await ordersTable(ddb)
  await openTable(page, table)
  await page.getByPlaceholder('Find in loaded items').fill('order-07')
  const download = page.waitForEvent('download')
  await page.getByTitle('Export shown items as DynamoDB JSON').click()
  const file = await download
  expect(file.suggestedFilename()).toBe(`${table}.json`)
  const { readFileSync } = await import('node:fs')
  expect(JSON.parse(readFileSync(await file.path(), 'utf8'))).toEqual([order(7)])
})
