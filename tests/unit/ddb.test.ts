import { describe, expect, it } from 'vitest'
import type { Item } from '../../shared/types.ts'
import {
  convertNewlines,
  formatBytes,
  fromPlainItem,
  isLossy,
  isLossyItem,
  keyString,
  kind,
  pickKey,
  preview,
  toPlain,
  toPlainItem,
} from '../../src/ddb.ts'

const sample: Item = {
  id: { S: 'a1' },
  count: { N: '42' },
  price: { N: '19.99' },
  active: { BOOL: false },
  missing: { NULL: true },
  tags: { L: [{ S: 'x' }, { N: '2' }] },
  address: { M: { city: { S: 'Boston' }, geo: { M: { lat: { N: '42.36' } } } } },
}

describe('plain JSON conversion', () => {
  it('converts DynamoDB JSON to plain values', () => {
    expect(toPlainItem(sample)).toEqual({
      id: 'a1',
      count: 42,
      price: 19.99,
      active: false,
      missing: null,
      tags: ['x', 2],
      address: { city: 'Boston', geo: { lat: 42.36 } },
    })
  })

  it('round-trips items that plain JSON can represent', () => {
    expect(fromPlainItem(toPlainItem(sample))).toEqual(sample)
  })

  it('keeps empty strings, lists and maps', () => {
    const item: Item = { s: { S: '' }, l: { L: [] }, m: { M: {} } }
    expect(fromPlainItem(toPlainItem(item))).toEqual(item)
  })

  it('rejects values DynamoDB has no type for', () => {
    expect(() => fromPlainItem({ bad: undefined })).toThrow(/Unsupported value/)
  })

  it('keeps numbers beyond double precision as strings', () => {
    expect(toPlain({ N: '12345678901234567890' })).toBe('12345678901234567890')
    expect(toPlain({ NS: ['1', '12345678901234567890'] })).toEqual([1, '12345678901234567890'])
  })

  it('shows sets and binary as arrays and base64', () => {
    expect(toPlain({ SS: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(toPlain({ BS: ['aGk='] })).toEqual(['aGk='])
    expect(toPlain({ B: 'aGk=' })).toBe('aGk=')
  })
})

describe('isLossy', () => {
  it.each([
    [{ SS: ['a'] }],
    [{ NS: ['1'] }],
    [{ BS: ['aGk='] }],
    [{ B: 'aGk=' }],
    [{ B: '' }],
    [{ N: '12345678901234567890' }],
    [{ N: '0.1000000000000000000001' }],
    [{ M: { deep: { L: [{ SS: ['a'] }] } } }],
  ])('flags %j as needing DynamoDB JSON', (av) => {
    expect(isLossy(av)).toBe(true)
  })

  it.each([[{ S: 'a' }], [{ N: '1.5' }], [{ N: '-3' }], [{ BOOL: true }], [{ NULL: true }], [{ L: [] }], [{ M: {} }]])(
    'accepts %j as plain JSON',
    (av) => {
      expect(isLossy(av)).toBe(false)
    },
  )

  it('checks every attribute of an item', () => {
    expect(isLossyItem(sample)).toBe(false)
    expect(isLossyItem({ ...sample, set: { SS: ['a'] } })).toBe(true)
  })
})

describe('grid helpers', () => {
  it('reports the type of a value', () => {
    expect(kind({ S: 'a' })).toBe('S')
    expect(kind({ M: {} })).toBe('M')
  })

  it('previews scalars as text', () => {
    expect(preview({ S: 'hello' })).toBe('hello')
    expect(preview({ N: '1.50' })).toBe('1.50')
    expect(preview({ BOOL: true })).toBe('true')
    expect(preview({ NULL: true })).toBe('null')
    expect(preview({ B: 'aGk=' })).toBe('<binary> aGk=')
  })

  it('previews documents as compact JSON and truncates long ones', () => {
    expect(preview({ M: { a: { N: '1' } } })).toBe('{"a":1}')
    const long = preview({ L: Array.from({ length: 100 }, (_, i) => ({ S: `value-${i}` })) })
    expect(long).toHaveLength(161)
    expect(long.endsWith('…')).toBe(true)
  })

  it('builds identity strings from key attributes only', () => {
    const a: Item = { pk: { S: 'x' }, sk: { N: '1' }, other: { S: 'one' } }
    const b: Item = { other: { S: 'two' }, sk: { N: '1' }, pk: { S: 'x' } }
    expect(keyString(a, ['pk', 'sk'])).toBe(keyString(b, ['pk', 'sk']))
    expect(keyString(a, ['pk', 'sk'])).not.toBe(keyString({ ...a, sk: { N: '2' } }, ['pk', 'sk']))
    // A string "1" and a number 1 are different keys.
    expect(keyString(a, ['pk', 'sk'])).not.toBe(keyString({ ...a, sk: { S: '1' } }, ['pk', 'sk']))
    expect(pickKey(a, ['pk', 'sk'])).toEqual({ pk: { S: 'x' }, sk: { N: '1' } })
  })

  it('formats byte sizes', () => {
    expect(formatBytes()).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(40.9 * 1024 * 1024)).toBe('40.9 MB')
  })
})

describe('convertNewlines', () => {
  const toBreaks = (value: unknown) => convertNewlines(JSON.stringify(value, null, 2), 'breaks')

  it('shows newline escapes inside strings as real line breaks', () => {
    expect(toBreaks({ a: 'one\ntwo' })).toBe('{\n  "a": "one\ntwo"\n}')
  })

  it.each([
    ['plain text', 'hello'],
    ['newlines', 'line one\nline two\n\nline four'],
    ['escaped quotes', 'say "hi"\nthen "bye"'],
    ['a literal backslash-n', 'C:\\new\\folder'],
    ['a trailing backslash', 'ends with \\'],
    ['tabs and unicode escapes', 'a\tb\u0001c'],
    ['carriage returns', 'windows\r\nline'],
    ['braces and colons', '{"not": "json"}\n[1, 2]'],
  ])('round-trips strings with %s', (_, text) => {
    const json = JSON.stringify({ text, nested: [{ text }], [text]: 1 }, null, 2)
    const shown = convertNewlines(json, 'breaks')
    expect(convertNewlines(shown, 'json')).toBe(json)
  })

  it('turns a line break typed inside a string back into an escape', () => {
    const edited = '{\n  "a": "one\ntwo\nthree"\n}'
    expect(JSON.parse(convertNewlines(edited, 'json'))).toEqual({ a: 'one\ntwo\nthree' })
  })

  it('leaves newlines outside strings alone', () => {
    const json = '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}'
    expect(convertNewlines(json, 'breaks')).toBe(json)
    expect(convertNewlines(json, 'json')).toBe(json)
  })
})
