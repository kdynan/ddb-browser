import { editor, expect, expectEditorClosed, openTable, row, test } from './fixtures.ts'

const prompt = 'You are a helper.\nAnswer briefly.\n\nSay "hi" and keep C:\\new as it is.'

test('lists the key first and the other attributes alphabetically', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [{ zeta: { S: 'z' }, alpha: { S: 'a' }, id: { S: 'k1' }, mid: { N: '5' } }])
  await openTable(page, table)
  await row(page, 'k1').click()
  await expect(page.locator('.cm-line')).toHaveText(['{', '  "id": "k1",', '  "alpha": "a",', '  "mid": 5,', '  "zeta": "z"', '}'])
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)
})

test('opens at the attribute whose cell was clicked', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  const steps = { L: Array.from({ length: 80 }, (_, i) => ({ M: { n: { N: String(i) }, text: { S: `step ${i}` } } })) }
  await ddb.put(table, [{ id: { S: 'k1' }, steps, zeta: { S: 'last attribute' } }])
  await openTable(page, table)

  await row(page, 'k1').locator('td', { hasText: 'last attribute' }).click()
  await expect(page.locator('.cm-activeLine')).toHaveText('  "zeta": "last attribute"')
  await expect(page.locator('.cm-activeLine')).toBeInViewport()

  await page.keyboard.press('Escape')
  await expectEditorClosed(page)
  await row(page, 'k1').locator('td', { hasText: 'k1' }).click()
  await expect(page.locator('.cm-activeLine')).toHaveText('  "id": "k1",')
})

test('keeps a long item scrollable inside the panel with the buttons visible', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  const lines = { L: Array.from({ length: 300 }, (_, i) => ({ S: `line ${i}` })) }
  // The wide attribute sorts first so it is on screen: the editor only lays out visible lines.
  await ddb.put(table, [{ id: { S: 'k1' }, a_wide: { S: 'x'.repeat(2000) }, lines }])
  await openTable(page, table)
  await row(page, 'k1').locator('td').nth(1).click()

  const scroller = page.locator('.cm-scroller')
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeInViewport()
  const [scrollerBox, saveBox] = [await scroller.boundingBox(), await save.boundingBox()]
  expect(scrollerBox!.y + scrollerBox!.height).toBeLessThanOrEqual(saveBox!.y)

  const size = () => scroller.evaluate((el) => ({ h: el.scrollHeight > el.clientHeight, w: el.scrollWidth > el.clientWidth, top: el.scrollTop, left: el.scrollLeft }))
  expect(await size()).toMatchObject({ h: true, w: true })
  await scroller.hover()
  await page.mouse.wheel(600, 0)
  await expect.poll(async () => (await size()).left).toBeGreaterThan(0)

  // Wrapping removes the sideways scroll.
  await page.getByRole('button', { name: 'Wrap' }).click()
  await expect.poll(async () => (await size()).w).toBe(false)

  await scroller.hover()
  await page.mouse.wheel(0, 3000)
  await expect.poll(async () => (await size()).top).toBeGreaterThan(1000)
  await expect(save).toBeInViewport()
})

test('shows embedded newlines as line breaks and saves edits made in that view', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [{ id: { S: 'k1' }, prompt: { S: prompt } }])
  await openTable(page, table)
  await row(page, 'k1').click()
  await expect(page.locator('.cm-line')).toHaveCount(4)
  const jsonView = await editor(page).innerText()

  await page.getByRole('button', { name: 'Line breaks' }).click()
  await expect(page.locator('.cm-line')).toHaveCount(7)
  await expect(page.locator('.cm-line').nth(3)).toHaveText('Answer briefly.')
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  // Switching back gives exactly the original text.
  await page.getByRole('button', { name: 'Line breaks' }).click()
  expect(await editor(page).innerText()).toBe(jsonView)
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  await page.getByRole('button', { name: 'Line breaks' }).click()
  await page.locator('.cm-line', { hasText: 'Answer briefly.' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('Added line.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expectEditorClosed(page)
  expect((await ddb.items(table))[0].prompt.S).toBe(prompt.replace('Answer briefly.\n', 'Answer briefly.\nAdded line.\n'))
})

test('remembers the Wrap and Line breaks choices for the next item', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [{ id: { S: 'k1' }, text: { S: 'a\nb' } }, { id: { S: 'k2' }, text: { S: 'c\nd' } }])
  await openTable(page, table)
  await row(page, 'k1').click()
  const lineBreaks = page.getByRole('button', { name: 'Line breaks' })
  await expect(lineBreaks).toHaveAttribute('aria-pressed', 'false')
  await lineBreaks.click()
  await page.keyboard.press('Escape')

  await row(page, 'k2').click()
  await expect(lineBreaks).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.cm-line')).toHaveCount(5)

  await openTable(page, table) // a fresh page load
  await row(page, 'k1').click()
  await expect(lineBreaks).toHaveAttribute('aria-pressed', 'true')
})

test('closes with Escape or a click outside', async ({ page, ddb }) => {
  const table = await ddb.createTable()
  await ddb.put(table, [{ id: { S: 'k1' } }])
  await openTable(page, table)
  await row(page, 'k1').click()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expectEditorClosed(page)

  await row(page, 'k1').click()
  await expect(editor(page)).toBeVisible()
  await page.mouse.click(300, 400)
  await expectEditorClosed(page)
})
