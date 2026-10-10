import { editEditorText, editor, expect, expectEditorClosed, openTable, row, setEditorText, test } from './fixtures.ts'

const person = (id: string, name: string) => ({ id: { S: id }, name: { S: name }, age: { N: '30' } })

test('creates an item', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await openTable(page, table)
  await page.getByRole('button', { name: 'New item' }).click()
  // The template is pre-filled with the table's key.
  await expect(editor(page)).toContainText('"id": ""')
  await setEditorText(page, JSON.stringify({ id: 'a1', name: 'Ada', tags: ['x'], profile: { score: 1.5 }, gone: null }))
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  await expectEditorClosed(page)
  await expect(row(page, 'a1')).toContainText('Ada')
  expect(await ddb.items(table)).toEqual([
    {
      id: { S: 'a1' },
      name: { S: 'Ada' },
      tags: { L: [{ S: 'x' }] },
      profile: { M: { score: { N: '1.5' } } },
      gone: { NULL: true },
    },
  ])
})

test('will not create over an existing item unless overwriting is confirmed', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Original')])
  await openTable(page, table)
  await page.getByRole('button', { name: 'New item' }).click()
  await setEditorText(page, JSON.stringify({ id: 'a1', name: 'Replacement' }))
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('An item with this key already exists')
  expect((await ddb.items(table))[0].name.S).toBe('Original')

  await page.getByRole('button', { name: 'Overwrite' }).click()
  await expectEditorClosed(page)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  expect(await ddb.items(table)).toEqual([{ id: { S: 'a1' }, name: { S: 'Replacement' } }])
})

test('edits an item and saves with the keyboard', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada'), person('b2', 'Bob')])
  await openTable(page, table)
  await row(page, 'a1').click()

  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled() // nothing changed yet
  await editEditorText(page, '"Ada"', '"Ada Lovelace"')
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')

  await expectEditorClosed(page)
  await expect(row(page, 'a1')).toContainText('Ada Lovelace')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  expect((await ddb.items(table)).find((i) => i.id.S === 'a1')).toEqual(person('a1', 'Ada Lovelace'))
})

test('discards edits when the editor is cancelled', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada')])
  await openTable(page, table)
  await row(page, 'a1').click()
  await editEditorText(page, '"Ada"', '"Changed"')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expectEditorClosed(page)
  await expect(row(page, 'a1')).toContainText('Ada')
  expect((await ddb.items(table))[0].name.S).toBe('Ada')
})

test('reports invalid JSON instead of saving it', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada')])
  await openTable(page, table)
  await row(page, 'a1').click()
  await setEditorText(page, '{"id": "a1", "name": }')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await setEditorText(page, '["not", "an", "object"]')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('An item must be a JSON object')
  expect(await ddb.items(table)).toEqual([person('a1', 'Ada')])
})

test('switches between plain and DynamoDB JSON', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada')])
  await openTable(page, table)
  await row(page, 'a1').click()
  await expect(editor(page)).toContainText('"name": "Ada"')

  await page.getByRole('button', { name: 'DynamoDB JSON', exact: true }).click()
  await expect(editor(page)).toContainText('"S": "Ada"')
  await expect(editor(page)).toContainText('"N": "30"')
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  // Add a string set, which only the typed form can express.
  await setEditorText(page, JSON.stringify({ id: { S: 'a1' }, name: { S: 'Ada' }, age: { N: '31' }, tags: { SS: ['x', 'y'] } }))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expectEditorClosed(page)
  const [saved] = await ddb.items(table)
  expect(saved.age).toEqual({ N: '31' })
  expect(saved.tags.SS?.sort()).toEqual(['x', 'y'])
})

test('opens items with sets or binary as DynamoDB JSON and will not flatten them', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [{ id: { S: 'a1' }, tags: { SS: ['x', 'y'] }, blob: { B: 'aGVsbG8=' }, big: { N: '12345678901234567890' } }])
  await openTable(page, table)
  await expect(row(page, 'a1')).toContainText('<binary> aGVsbG8=')
  await row(page, 'a1').click()
  await expect(editor(page)).toContainText('"SS"')
  await expect(editor(page)).toContainText('"N": "12345678901234567890"')

  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('need DynamoDB JSON')
  await expect(editor(page)).toContainText('"SS"')
})

test('moves an item when its key is changed, after confirming', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada'), person('b2', 'Bob')])
  await openTable(page, table)
  await row(page, 'a1').click()
  await editEditorText(page, '"a1"', '"a1-moved"')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByText('The key changed.')).toBeVisible()
  expect((await ddb.items(table)).map((i) => i.id.S).sort()).toEqual(['a1', 'b2'])

  await page.getByRole('button', { name: 'Confirm save' }).click()
  await expectEditorClosed(page)
  await expect(row(page, 'a1-moved')).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(2)
  expect((await ddb.items(table)).map((i) => i.id.S).sort()).toEqual(['a1-moved', 'b2'])
})

test('duplicates an item under a new key', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada')])
  await openTable(page, table)
  await row(page, 'a1').click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.getByRole('heading', { name: 'New item' })).toBeVisible()

  // Saving the copy unchanged would overwrite the original, so it is refused.
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already exists')

  await editEditorText(page, '"a1"', '"a1-copy"')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expectEditorClosed(page)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  expect((await ddb.items(table)).sort((a, b) => a.id.S!.localeCompare(b.id.S!))).toEqual([person('a1', 'Ada'), person('a1-copy', 'Ada')])
})

test('deletes an item from the editor after a second click', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [person('a1', 'Ada'), person('b2', 'Bob')])
  await openTable(page, table)
  await row(page, 'a1').click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  expect(await ddb.items(table)).toHaveLength(2) // first click only arms the button
  await page.getByRole('button', { name: 'Click again to confirm' }).click()
  await expectEditorClosed(page)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  expect(await ddb.items(table)).toEqual([person('b2', 'Bob')])
})

test('deletes the selected items in bulk', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, ['a', 'b', 'c', 'd', 'e'].map((id) => person(id, `Person ${id}`)))
  await openTable(page, table)

  await row(page, 'Person b').getByRole('checkbox').click()
  await row(page, 'Person d').getByRole('checkbox').click()
  await expectEditorClosed(page) // ticking a row must not open it
  await page.getByRole('button', { name: 'Delete 2' }).click()
  await page.getByRole('button', { name: 'Confirm: delete 2 items' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
  expect((await ddb.items(table)).map((i) => i.id.S).sort()).toEqual(['a', 'c', 'e'])

  await page.getByRole('checkbox', { name: 'Select all' }).click()
  await page.getByRole('button', { name: 'Delete 3' }).click()
  await page.getByRole('button', { name: 'Confirm: delete 3 items' }).click()
  await expect(page.getByText('No items')).toBeVisible()
  expect(await ddb.items(table)).toEqual([])
})

test('works with a composite key', async ({ page, ddb }) => {
  const table = await ddb.createTable({ sk: { name: 'version', type: 'N' } })
  await ddb.put(table, [
    { id: { S: 'doc' }, version: { N: '1' }, body: { S: 'first' } },
    { id: { S: 'doc' }, version: { N: '2' }, body: { S: 'second' } },
  ])
  await openTable(page, table)
  await expect(page.locator('th', { hasText: 'id' })).toContainText('PK')
  await expect(page.locator('th', { hasText: 'version' })).toContainText('SK')

  await row(page, 'second').click()
  await editEditorText(page, '"second"', '"second, edited"')
  await page.keyboard.press('ControlOrMeta+s')
  await expectEditorClosed(page)

  await row(page, 'first').getByRole('checkbox').click()
  await page.getByRole('button', { name: 'Delete 1' }).click()
  await page.getByRole('button', { name: 'Confirm: delete 1 item' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  expect(await ddb.items(table)).toEqual([{ id: { S: 'doc' }, version: { N: '2' }, body: { S: 'second, edited' } }])
})
