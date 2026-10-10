import type { AV, Item } from '../shared/types.ts'

export function kind(av: AV): keyof AV {
  return Object.keys(av)[0] as keyof AV
}

const safeNumber = (n: string) => Number.isFinite(Number(n)) && String(Number(n)) === n

/**
 * True when a value can't round-trip through plain JSON: sets, binary, and
 * numbers beyond double precision need the typed DynamoDB JSON form.
 */
export function isLossy(av: AV): boolean {
  if (av.SS || av.NS || av.BS || av.B !== undefined) return true
  if (av.N !== undefined) return !safeNumber(av.N)
  if (av.M) return Object.values(av.M).some(isLossy)
  if (av.L) return av.L.some(isLossy)
  return false
}

export const isLossyItem = (item: Item) => Object.values(item).some(isLossy)

export function toPlain(av: AV): unknown {
  if (av.S !== undefined) return av.S
  if (av.N !== undefined) return safeNumber(av.N) ? Number(av.N) : av.N
  if (av.BOOL !== undefined) return av.BOOL
  if (av.NULL) return null
  if (av.M) return toPlainItem(av.M)
  if (av.L) return av.L.map(toPlain)
  if (av.NS) return av.NS.map((n) => (safeNumber(n) ? Number(n) : n))
  return av.SS ?? av.BS ?? av.B
}

export const toPlainItem = (item: Item): Record<string, unknown> =>
  Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toPlain(v)]))

export function fromPlain(v: unknown): AV {
  if (v === null) return { NULL: true }
  if (typeof v === 'string') return { S: v }
  if (typeof v === 'number') return { N: String(v) }
  if (typeof v === 'boolean') return { BOOL: v }
  if (Array.isArray(v)) return { L: v.map(fromPlain) }
  if (typeof v === 'object') return { M: fromPlainItem(v as Record<string, unknown>) }
  throw new Error(`Unsupported value: ${String(v)}`)
}

export const fromPlainItem = (obj: Record<string, unknown>): Item =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fromPlain(v)]))

/** Short single-line text for a grid cell. */
export function preview(av: AV): string {
  if (av.S !== undefined) return av.S
  if (av.N !== undefined) return av.N
  if (av.BOOL !== undefined) return String(av.BOOL)
  if (av.NULL) return 'null'
  if (av.B !== undefined) return `<binary> ${av.B}`
  const s = JSON.stringify(toPlain(av))
  return s.length > 160 ? `${s.slice(0, 160)}…` : s
}

export const keyString = (item: Item, keys: string[]) => JSON.stringify(keys.map((k) => item[k]))

export const pickKey = (item: Item, keys: string[]): Item => Object.fromEntries(keys.map((k) => [k, item[k]]))

export function formatBytes(n = 0): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${i ? n.toFixed(1) : n} ${units[i]}`
}

/**
 * Converts between JSON and the "line breaks" view, where \n escapes inside
 * strings are shown as real newlines. Valid JSON never has a raw newline in a
 * string, so the two forms convert back and forth without loss.
 */
export function convertNewlines(text: string, to: 'breaks' | 'json'): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString && ch === '\\') {
      const next = text[i + 1] ?? ''
      out += to === 'breaks' && next === 'n' ? '\n' : ch + next
      i++
    } else if (inString && ch === '\n' && to === 'json') {
      out += '\\n'
    } else {
      if (ch === '"') inString = !inString
      out += ch
    }
  }
  return out
}
