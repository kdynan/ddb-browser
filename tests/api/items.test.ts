import { describe, expect, it } from 'vitest'
import type { Item } from '../../shared/types.ts'
import { call, createTable, putItems, query, queryAll } from './helpers.ts'

const put = (table: string, body: unknown) => call('PUT', `/tables/${table}/items`, body)
const scanAll = async (table: string) => (await queryAll(table, {})).items

describe('writing items', () => {
  it('stores every DynamoDB type and returns it unchanged', async () => {
    const table = await createTable()
    const item: Item = {
      pk: { S: 'types' },
      sk: { N: '1' },
      text: { S: 'héllo\n"quoted"' },
      empty: { S: '' },
      big: { N: '12345678901234567890.123456789' },
      flag: { BOOL: false },
      nothing: { NULL: true },
      bin: { B: 'aGVsbG8=' },
      strings: { SS: ['a', 'b'] },
      numbers: { NS: ['1', '2.5'] },
      binaries: { BS: ['AQID'] },
      list: { L: [{ S: 'x' }, { N: '1' }, { L: [] }] },
      doc: { M: { nested: { M: { deep: { B: 'AQ==' } } } } },
    }
    expect((await put(table, { item })).status).toBe(200)
    const [stored] = await scanAll(table)
    const sorted = (i: Item) => ({ ...i, strings: { SS: [...i.strings.SS!].sort() }, numbers: { NS: [...i.numbers.NS!].sort() } })
    expect(sorted(stored)).toEqual(sorted(item))
  })

  it('refuses to create over an existing item unless told to overwrite', async () => {
    const table = await createTable()
    const key = { pk: { S: 'a' }, sk: { N: '1' } }
    await put(table, { item: { ...key, v: { S: 'first' } } })

    const clash = await put(table, { item: { ...key, v: { S: 'second' } } })
    expect(clash.status).toBe(409)
    expect(clash.body.message).toBe('An item with this key already exists')
    expect((await scanAll(table))[0].v.S).toBe('first')

    expect((await put(table, { item: { ...key, v: { S: 'second' } }, overwrite: true })).status).toBe(200)
    expect(await scanAll(table)).toEqual([{ ...key, v: { S: 'second' } }])
  })

  it('replaces an item when editing, dropping removed attributes', async () => {
    const table = await createTable()
    const key = { pk: { S: 'a' }, sk: { N: '1' } }
    await put(table, { item: { ...key, keep: { S: 'x' }, remove: { S: 'y' } } })
    expect((await put(table, { item: { ...key, keep: { S: 'changed' } }, originalKey: key })).status).toBe(200)
    expect(await scanAll(table)).toEqual([{ ...key, keep: { S: 'changed' } }])
  })

  it('moves an item when its key changes', async () => {
    const table = await createTable()
    const oldKey = { pk: { S: 'a' }, sk: { N: '1' } }
    await put(table, { item: { ...oldKey, v: { S: 'x' } } })
    const res = await put(table, { item: { pk: { S: 'a' }, sk: { N: '2' }, v: { S: 'x' } }, originalKey: oldKey })
    expect(res.status).toBe(200)
    expect(await scanAll(table)).toEqual([{ pk: { S: 'a' }, sk: { N: '2' }, v: { S: 'x' } }])
  })

  it('will not move an item onto another one, and keeps both when it refuses', async () => {
    const table = await createTable()
    const a = { pk: { S: 'a' }, sk: { N: '1' }, v: { S: 'a' } }
    const b = { pk: { S: 'a' }, sk: { N: '2' }, v: { S: 'b' } }
    await putItems(table, [a, b])
    const res = await put(table, { item: { ...a, sk: { N: '2' } }, originalKey: { pk: a.pk, sk: a.sk } })
    expect(res.status).toBe(409)
    expect(await scanAll(table)).toEqual([a, b])

    const forced = await put(table, { item: { ...a, sk: { N: '2' } }, originalKey: { pk: a.pk, sk: a.sk }, overwrite: true })
    expect(forced.status).toBe(200)
    expect(await scanAll(table)).toEqual([{ ...a, sk: { N: '2' } }])
  })

  it('treats the same key written differently as a move only when the value differs', async () => {
    const table = await createTable()
    const key = { pk: { S: 'a' }, sk: { N: '1' } }
    await put(table, { item: { ...key, v: { S: 'x' } } })
    // Attribute order within the key must not matter.
    const res = await put(table, { item: { v: { S: 'y' }, sk: { N: '1' }, pk: { S: 'a' } }, originalKey: { sk: { N: '1' }, pk: { S: 'a' } } })
    expect(res.status).toBe(200)
    expect(await scanAll(table)).toHaveLength(1)
  })

  it.each([
    ['a missing sort key', { pk: { S: 'a' } }, /Missing key attribute "sk"/],
    ['a missing partition key', { sk: { N: '1' } }, /Missing key attribute "pk"/],
    ['a plain value instead of DynamoDB JSON', { pk: 'a', sk: { N: '1' } }, /Invalid DynamoDB JSON/],
    ['an array', [], /Invalid item/],
  ])('rejects an item with %s', async (_, item, message) => {
    const table = await createTable()
    const res = await put(table, { item })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(message)
    expect(await scanAll(table)).toEqual([])
  })

  it('passes on DynamoDB validation errors', async () => {
    const table = await createTable()
    const wrongType = await put(table, { item: { pk: { S: 'a' }, sk: { S: 'not-a-number' } } })
    expect(wrongType.status).toBe(400)
    expect(wrongType.body.error).toBe('ValidationException')
    const unknownType = await put(table, { item: { pk: { S: 'a' }, sk: { N: '1' }, bad: { X: 'y' } } })
    expect(unknownType.status).toBeGreaterThanOrEqual(400)
  })

  it('reports a table that does not exist', async () => {
    const res = await put('no-such-table', { item: { pk: { S: 'a' } } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('ResourceNotFoundException')
  })
})

describe('deleting items', () => {
  const key = (n: number) => ({ pk: { S: `p${n % 3}` }, sk: { N: String(n) } })

  it('deletes only the requested items', async () => {
    const table = await createTable()
    await putItems(table, [1, 2, 3, 4].map(key))
    const res = await call('POST', `/tables/${table}/items/delete`, { keys: [key(2), key(3)] })
    expect(res.status).toBe(200)
    expect((await scanAll(table)).map((i) => i.sk.N).sort()).toEqual(['1', '4'])
  })

  it('deletes more items than fit in one batch', async () => {
    const table = await createTable()
    const keys = Array.from({ length: 60 }, (_, i) => key(i))
    await putItems(table, keys)
    expect((await call('POST', `/tables/${table}/items/delete`, { keys: keys.slice(0, 55) })).status).toBe(200)
    expect(await scanAll(table)).toHaveLength(5)
  })

  it('ignores keys that are already gone', async () => {
    const table = await createTable()
    await putItems(table, [key(1)])
    expect((await call('POST', `/tables/${table}/items/delete`, { keys: [key(1), key(99)] })).status).toBe(200)
    expect(await scanAll(table)).toEqual([])
  })

  it('deletes items with binary keys', async () => {
    const table = await createTable({ pk: { name: 'id', type: 'B' }, sk: undefined })
    await putItems(table, [{ id: { B: 'AQID' } }, { id: { B: 'BAUG' } }])
    await call('POST', `/tables/${table}/items/delete`, { keys: [{ id: { B: 'AQID' } }] })
    expect(await scanAll(table)).toEqual([{ id: { B: 'BAUG' } }])
    expect((await query(table, { mode: 'query', pk: { name: 'id', type: 'B', value: 'BAUG' } })).body.items).toHaveLength(1)
  })
})
