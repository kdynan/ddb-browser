import { beforeAll, describe, expect, it } from 'vitest'
import type { FilterOp, Item, ValueType } from '../../shared/types.ts'
import { createTable, putItems, query, queryAll } from './helpers.ts'

// 60 orders across 3 customers; even order numbers are open, odd are closed.
const order = (n: number): Item => ({
  pk: { S: `cust#${n % 3}` },
  sk: { N: String(n) },
  status: { S: n % 2 === 0 ? 'open' : 'closed' },
  total: { N: String(n * 10) },
  note: { S: `order number ${n}` },
  address: { M: { city: { S: n % 4 === 0 ? 'Boston' : 'Austin' }, lines: { L: [{ S: `${n} Main St` }] } } },
  tags: { SS: n % 5 === 0 ? ['rush', 'gift'] : ['standard'] },
  ...(n % 10 === 0 ? { discount: { N: '5' } } : {}),
  ...(n === 7 ? { cancelled: { BOOL: true }, reason: { NULL: true } } : {}),
})
const all = Array.from({ length: 60 }, (_, i) => order(i + 1))
const numbers = (items: Item[]) => items.map((i) => Number(i.sk.N))
const ascending = (a: number, b: number) => a - b

let table: string
beforeAll(async () => {
  table = await createTable({
    gsis: [{ name: 'byStatus', pk: { name: 'status', type: 'S' }, sk: { name: 'sk', type: 'N' }, projection: 'ALL' }],
  })
  await putItems(table, all)
})

describe('scan', () => {
  it('returns up to the limit and a key to continue from', async () => {
    const { status, body } = await query(table, { limit: 25 })
    expect(status).toBe(200)
    expect(body.items).toHaveLength(25)
    expect(body.scanned).toBe(25)
    expect(Object.keys(body.lastKey!).sort()).toEqual(['pk', 'sk'])
    expect(body.capacity).toBeGreaterThan(0)
  })

  it('pages through every item exactly once', async () => {
    const { items, pages } = await queryAll(table, { limit: 25 })
    expect(numbers(items).sort(ascending)).toEqual(numbers(all))
    expect(pages).toBeGreaterThanOrEqual(3)
  })

  it('omits the continuation key at the end', async () => {
    const { body } = await query(table, { limit: 1000 })
    expect(body.items).toHaveLength(60)
    expect(body.lastKey).toBeUndefined()
  })

  it.each([
    [0, 100],
    [-5, 1],
    [5000, 1000],
  ])('clamps a limit of %d', async (limit, effective) => {
    const { body } = await query(table, { limit })
    expect(body.items).toHaveLength(Math.min(effective, 60))
  })

  it('scans an index', async () => {
    const { items } = await queryAll(table, { index: 'byStatus', limit: 20 })
    expect(numbers(items).sort(ascending)).toEqual(numbers(all))
  })
})

describe('query', () => {
  const pk = { name: 'pk', type: 'S' as const, value: 'cust#1' }
  const mine = numbers(all.filter((i) => i.pk.S === 'cust#1'))

  it('returns one partition in sort key order', async () => {
    const { body } = await query(table, { mode: 'query', pk })
    expect(numbers(body.items)).toEqual(mine)
    expect(body.lastKey).toBeUndefined()
  })

  it('reverses the order when descending', async () => {
    const { body } = await query(table, { mode: 'query', pk, descending: true })
    expect(numbers(body.items)).toEqual([...mine].reverse())
  })

  it('pages in order', async () => {
    const { items, pages } = await queryAll(table, { mode: 'query', pk, limit: 7 })
    expect(numbers(items)).toEqual(mine)
    expect(pages).toBe(3)
  })

  it.each([
    ['=', '10', undefined, (n: number) => n === 10],
    ['<', '10', undefined, (n: number) => n < 10],
    ['<=', '10', undefined, (n: number) => n <= 10],
    ['>', '50', undefined, (n: number) => n > 50],
    ['>=', '52', undefined, (n: number) => n >= 52],
    ['between', '10', '30', (n: number) => n >= 10 && n <= 30],
  ] as const)('applies a sort key %s condition', async (op, value, value2, matches) => {
    const { body } = await query(table, { mode: 'query', pk, sk: { name: 'sk', type: 'N', op, value, value2 } })
    expect(numbers(body.items)).toEqual(mine.filter(matches))
  })

  it('applies begins_with to a string sort key', async () => {
    const strings = await createTable({ sk: { name: 'sk', type: 'S' } })
    await putItems(strings, ['2024-01-05', '2024-01-20', '2024-02-01', '2025-01-01'].map((d) => ({ pk: { S: 'a' }, sk: { S: d } })))
    const { body } = await query(strings, {
      mode: 'query',
      pk: { name: 'pk', type: 'S', value: 'a' },
      sk: { name: 'sk', type: 'S', op: 'begins_with', value: '2024-01' },
    })
    expect(body.items.map((i) => i.sk.S)).toEqual(['2024-01-05', '2024-01-20'])
  })

  it('returns nothing for a partition with no items', async () => {
    const { status, body } = await query(table, { mode: 'query', pk: { ...pk, value: 'nobody' } })
    expect(status).toBe(200)
    expect(body.items).toEqual([])
  })

  it('queries an index and continues with a key that includes the index keys', async () => {
    const body = { mode: 'query' as const, index: 'byStatus', pk: { name: 'status', type: 'S' as const, value: 'open' }, limit: 12 }
    const first = await query(table, body)
    expect(Object.keys(first.body.lastKey!).sort()).toEqual(['pk', 'sk', 'status'])
    const { items } = await queryAll(table, body)
    expect(numbers(items)).toEqual(numbers(all.filter((i) => i.status.S === 'open')))
  })

  it('requires a partition key value', async () => {
    const res = await query(table, { mode: 'query' })
    expect(res.status).toBe(400)
    expect((res.body as any).message).toMatch(/partition key value is required/)
  })

  it('rejects a non-numeric value for a numeric key', async () => {
    const res = await query(table, { mode: 'query', pk, sk: { name: 'sk', type: 'N', op: '=', value: 'abc' } })
    expect(res.status).toBe(400)
    expect((res.body as any).message).toBe('"abc" is not a number')
  })

  it('reports an index that does not exist', async () => {
    const res = await query(table, { mode: 'query', index: 'nope', pk })
    expect(res.status).toBe(400)
    expect((res.body as any).error).toBe('ValidationException')
  })
})

describe('filters', () => {
  const filter = (attr: string, op: FilterOp, type: ValueType = 'S', value = '', value2?: string) => ({ attr, op, type, value, value2 })
  const cases: [string, ReturnType<typeof filter>, (i: Item, n: number) => boolean][] = [
    ['equals', filter('status', '=', 'S', 'open'), (i) => i.status.S === 'open'],
    ['not equals', filter('status', '<>', 'S', 'open'), (i) => i.status.S !== 'open'],
    ['less than a number', filter('total', '<', 'N', '100'), (_, n) => n * 10 < 100],
    ['at most a number', filter('total', '<=', 'N', '100'), (_, n) => n * 10 <= 100],
    ['greater than a number', filter('total', '>', 'N', '550'), (_, n) => n * 10 > 550],
    ['at least a number', filter('total', '>=', 'N', '550'), (_, n) => n * 10 >= 550],
    ['between numbers', filter('total', 'between', 'N', '200', '250'), (_, n) => n * 10 >= 200 && n * 10 <= 250],
    ['begins with', filter('note', 'begins_with', 'S', 'order number 1'), (_, n) => String(n).startsWith('1')],
    ['contains text', filter('note', 'contains', 'S', 'ber 59'), (_, n) => n === 59],
    ['does not contain text', filter('note', 'not_contains', 'S', '5'), (_, n) => !String(n).includes('5')],
    ['a set contains a member', filter('tags', 'contains', 'S', 'rush'), (_, n) => n % 5 === 0],
    ['attribute exists', filter('discount', 'exists'), (_, n) => n % 10 === 0],
    ['attribute does not exist', filter('discount', 'not_exists'), (_, n) => n % 10 !== 0],
    ['a boolean', filter('cancelled', '=', 'BOOL', 'true'), (_, n) => n === 7],
    ['a null', filter('reason', '=', 'NULL'), (_, n) => n === 7],
    ['a nested attribute', filter('address.city', '=', 'S', 'Boston'), (_, n) => n % 4 === 0],
    ['a list element', filter('address.lines[0]', 'begins_with', 'S', '12 '), (_, n) => n === 12],
  ]

  it.each(cases)('matches %s', async (_, f, matches) => {
    const { items } = await queryAll(table, { filters: [f] })
    expect(numbers(items).sort(ascending)).toEqual(numbers(all.filter((i) => matches(i, Number(i.sk.N)))))
  })

  it('requires every filter to match', async () => {
    const { items } = await queryAll(table, {
      filters: [filter('status', '=', 'S', 'open'), filter('address.city', '=', 'S', 'Boston'), filter('total', '>', 'N', '300')],
    })
    expect(numbers(items).sort(ascending)).toEqual([32, 36, 40, 44, 48, 52, 56, 60])
  })

  it('filters within a queried partition', async () => {
    const { body } = await query(table, {
      mode: 'query',
      pk: { name: 'pk', type: 'S', value: 'cust#0' },
      filters: [filter('status', '=', 'S', 'open')],
    })
    expect(numbers(body.items)).toEqual(numbers(all.filter((i) => i.pk.S === 'cust#0' && i.status.S === 'open')))
  })

  // A filtered read evaluates more items than it returns, so the server trims the
  // page and resumes from the last item it kept.
  it.each([[1], [4], [7], [30]])('pages a filtered scan %d at a time without skipping or repeating', async (limit) => {
    const first = await query(table, { filters: [filter('status', '=', 'S', 'open')], limit })
    expect(first.body.items.length).toBeLessThanOrEqual(limit)
    const { items } = await queryAll(table, { filters: [filter('status', '=', 'S', 'open')], limit })
    expect(numbers(items).sort(ascending)).toEqual(numbers(all.filter((i) => i.status.S === 'open')))
  })

  it('pages a filtered index query without skipping or repeating', async () => {
    const { items } = await queryAll(table, {
      mode: 'query',
      index: 'byStatus',
      pk: { name: 'status', type: 'S', value: 'open' },
      filters: [filter('total', '>', 'N', '200')],
      limit: 4,
    })
    expect(numbers(items)).toEqual(numbers(all.filter((i) => i.status.S === 'open' && Number(i.sk.N) > 20)))
  })

  it('reports how many items were evaluated', async () => {
    const { body } = await query(table, { filters: [filter('note', 'contains', 'S', 'ber 59')] })
    expect(body.items).toHaveLength(1)
    expect(body.scanned).toBe(60)
  })

  it('rejects a filter on a key attribute in a query', async () => {
    const res = await query(table, {
      mode: 'query',
      pk: { name: 'pk', type: 'S', value: 'cust#0' },
      filters: [filter('sk', '>', 'N', '5')],
    })
    expect(res.status).toBe(400)
    expect((res.body as any).error).toBe('ValidationException')
  })
})
