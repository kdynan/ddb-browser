import { describe, expect, it } from 'vitest'
import { buildExpressions } from '../../server/app.ts'
import { fromWire, fromWireItem, HttpError, toWire, toWireItem } from '../../server/aws.ts'
import type { QueryBody } from '../../shared/types.ts'

const scan = (filters: QueryBody['filters']): QueryBody => ({ mode: 'scan', filters, limit: 10 })

describe('wire format', () => {
  it('encodes binary as base64 at any depth', () => {
    const bytes = new Uint8Array([104, 105])
    expect(toWire({ B: bytes })).toEqual({ B: 'aGk=' })
    expect(toWire({ BS: [bytes] })).toEqual({ BS: ['aGk='] })
    expect(toWireItem({ doc: { M: { list: { L: [{ B: bytes }] } } } })).toEqual({
      doc: { M: { list: { L: [{ B: 'aGk=' }] } } },
    })
  })

  it('decodes base64 back to the same bytes', () => {
    const item = { bin: { B: 'aGVsbG8=' }, set: { BS: ['AQID'] }, doc: { M: { b: { B: '' } } }, s: { S: 'x' } }
    const decoded = fromWireItem(item)
    expect(Buffer.from(decoded.bin.B!).toString()).toBe('hello')
    expect(toWireItem(decoded)).toEqual(item)
  })

  it('passes other types through unchanged', () => {
    for (const av of [{ S: '' }, { N: '1' }, { BOOL: false }, { NULL: true }, { SS: ['a'] }, { NS: ['1'] }]) {
      expect(toWire(fromWire(av))).toEqual(av)
    }
  })

  it.each([['a string'], [42], [null], [[{ S: 'a' }]]])('rejects %j where an attribute value is expected', (bad) => {
    expect(() => fromWire(bad as never)).toThrow(HttpError)
    expect(() => fromWireItem({ attr: bad } as never)).toThrow(/Invalid DynamoDB JSON/)
  })

  it('rejects items that are not objects', () => {
    expect(() => fromWireItem([] as never)).toThrow(/Invalid item/)
    expect(() => fromWireItem(null as never)).toThrow(/Invalid item/)
  })
})

describe('buildExpressions', () => {
  it('produces nothing for an unfiltered scan', () => {
    expect(buildExpressions(scan([]))).toEqual({
      KeyConditionExpression: undefined,
      FilterExpression: undefined,
      ExpressionAttributeNames: undefined,
      ExpressionAttributeValues: undefined,
    })
  })

  it('builds a partition key condition', () => {
    const out = buildExpressions({ mode: 'query', pk: { name: 'pk', type: 'S', value: 'a' }, filters: [], limit: 10 })
    expect(out.KeyConditionExpression).toBe('#n0 = :v0')
    expect(out.ExpressionAttributeNames).toEqual({ '#n0': 'pk' })
    expect(out.ExpressionAttributeValues).toEqual({ ':v0': { S: 'a' } })
  })

  it.each([
    ['=', '#n0 = :v0 AND #n1 = :v1'],
    ['<', '#n0 = :v0 AND #n1 < :v1'],
    ['>=', '#n0 = :v0 AND #n1 >= :v1'],
    ['begins_with', '#n0 = :v0 AND begins_with(#n1, :v1)'],
    ['between', '#n0 = :v0 AND #n1 BETWEEN :v1 AND :v2'],
  ] as const)('builds a sort key %s condition', (op, expected) => {
    const out = buildExpressions({
      mode: 'query',
      pk: { name: 'pk', type: 'S', value: 'a' },
      sk: { name: 'sk', type: 'N', op, value: '1', value2: '9' },
      filters: [],
      limit: 10,
    })
    expect(out.KeyConditionExpression).toBe(expected)
    expect(out.ExpressionAttributeValues?.[':v1']).toEqual({ N: '1' })
    if (op === 'between') expect(out.ExpressionAttributeValues?.[':v2']).toEqual({ N: '9' })
  })

  it('requires a partition key to query', () => {
    expect(() => buildExpressions({ mode: 'query', filters: [], limit: 10 })).toThrow(/partition key value is required/)
  })

  it('ignores key conditions when scanning', () => {
    const out = buildExpressions({ ...scan([]), pk: { name: 'pk', type: 'S', value: 'a' } })
    expect(out.KeyConditionExpression).toBeUndefined()
  })

  it.each([
    ['=', '#n0 = :v0'],
    ['<>', '#n0 <> :v0'],
    ['<=', '#n0 <= :v0'],
    ['begins_with', 'begins_with(#n0, :v0)'],
    ['contains', 'contains(#n0, :v0)'],
    ['not_contains', 'NOT contains(#n0, :v0)'],
    ['between', '#n0 BETWEEN :v0 AND :v1'],
    ['exists', 'attribute_exists(#n0)'],
    ['not_exists', 'attribute_not_exists(#n0)'],
  ] as const)('builds a %s filter', (op, expected) => {
    const out = buildExpressions(scan([{ attr: 'status', type: 'S', op, value: 'a', value2: 'z' }]))
    expect(out.FilterExpression).toBe(expected)
  })

  it('sends no values for exists checks', () => {
    const out = buildExpressions(scan([{ attr: 'a', type: 'S', op: 'exists', value: 'ignored' }]))
    expect(out.ExpressionAttributeValues).toBeUndefined()
  })

  it('joins several filters with AND and numbers placeholders across them', () => {
    const out = buildExpressions({
      mode: 'query',
      pk: { name: 'pk', type: 'S', value: 'a' },
      filters: [
        { attr: 'status', type: 'S', op: '=', value: 'open' },
        { attr: 'total', type: 'N', op: '>', value: '5' },
      ],
      limit: 10,
    })
    expect(out.KeyConditionExpression).toBe('#n0 = :v0')
    expect(out.FilterExpression).toBe('#n1 = :v1 AND #n2 > :v2')
    expect(out.ExpressionAttributeNames).toEqual({ '#n0': 'pk', '#n1': 'status', '#n2': 'total' })
  })

  it('treats dots and brackets in a filter attribute as a document path', () => {
    const out = buildExpressions(scan([{ attr: ' address.lines[0].text ', type: 'S', op: '=', value: 'x' }]))
    expect(out.FilterExpression).toBe('#n0.#n1[0].#n2 = :v0')
    expect(out.ExpressionAttributeNames).toEqual({ '#n0': 'address', '#n1': 'lines', '#n2': 'text' })
  })

  it('never puts attribute names or values directly in the expression', () => {
    const out = buildExpressions(scan([{ attr: 'size', type: 'S', op: '=', value: "x' OR 1=1" }]))
    expect(out.FilterExpression).toBe('#n0 = :v0')
    expect(out.ExpressionAttributeValues).toEqual({ ':v0': { S: "x' OR 1=1" } })
  })

  it.each([
    ['N', ' 12.5 ', { N: '12.5' }],
    ['S', ' padded ', { S: ' padded ' }],
    ['BOOL', 'TRUE', { BOOL: true }],
    ['BOOL', 'false', { BOOL: false }],
    ['NULL', '', { NULL: true }],
  ] as const)('converts a %s filter value of %j', (type, value, expected) => {
    const out = buildExpressions(scan([{ attr: 'a', type, op: '=', value }]))
    expect(out.ExpressionAttributeValues).toEqual({ ':v0': expected })
  })

  it('converts binary filter values from base64', () => {
    const out = buildExpressions(scan([{ attr: 'a', type: 'B', op: '=', value: 'aGk=' }]))
    expect(Buffer.from(out.ExpressionAttributeValues![':v0'].B!).toString()).toBe('hi')
  })

  it.each([['abc'], [''], ['  '], ['1,5']])('rejects %j as a number', (value) => {
    expect(() => buildExpressions(scan([{ attr: 'a', type: 'N', op: '=', value }]))).toThrow(/is not a number/)
  })
})
