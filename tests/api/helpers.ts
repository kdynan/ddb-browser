import { randomUUID } from 'node:crypto'
import { inject } from 'vitest'
import { app } from '../../server/app.ts'
import { type CreateTableBody, type Item, LOCAL_PROFILE, type QueryBody, type QueryResult } from '../../shared/types.ts'

export interface ApiResponse<T> {
  status: number
  body: T
}

/** Calls the API in-process the way the UI does, pointed at the test DynamoDB. */
export async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse<T>> {
  const res = await app.request(`http://localhost/api${path}`, {
    method,
    headers: {
      host: 'localhost',
      'content-type': 'application/json',
      'x-ddb-profile': encodeURIComponent(LOCAL_PROFILE),
      'x-ddb-region': 'us-east-1',
      'x-ddb-endpoint': inject('ddbEndpoint'),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as T }
}

export const uniqueName = (prefix = 'test') => `${prefix}-${randomUUID().slice(0, 8)}`

/** Creates a table with a string partition key "pk" and numeric sort key "sk" unless overridden. */
export async function createTable(overrides: Partial<CreateTableBody> = {}): Promise<string> {
  const body: CreateTableBody = {
    name: uniqueName(),
    pk: { name: 'pk', type: 'S' },
    sk: { name: 'sk', type: 'N' },
    billing: 'PAY_PER_REQUEST',
    gsis: [],
    ...overrides,
  }
  const res = await call('POST', '/tables', body)
  if (res.status !== 200) throw new Error(`createTable failed: ${JSON.stringify(res.body)}`)
  return body.name
}

export async function putItems(table: string, items: Item[]) {
  for (const item of items) {
    const res = await call('PUT', `/tables/${table}/items`, { item })
    if (res.status !== 200) throw new Error(`putItem failed: ${JSON.stringify(res.body)}`)
  }
}

export const query = (table: string, body: Partial<QueryBody>) =>
  call<QueryResult>('POST', `/tables/${table}/query`, { mode: 'scan', filters: [], limit: 100, ...body })

/** Follows lastKey until the results are exhausted. */
export async function queryAll(table: string, body: Partial<QueryBody>): Promise<{ items: Item[]; pages: number }> {
  const items: Item[] = []
  let startKey: Item | undefined
  let pages = 0
  do {
    const res = await query(table, { ...body, startKey })
    if (res.status !== 200) throw new Error(`query failed: ${JSON.stringify(res.body)}`)
    items.push(...res.body.items)
    startKey = res.body.lastKey
    pages++
  } while (startKey && pages < 200)
  return { items, pages }
}
