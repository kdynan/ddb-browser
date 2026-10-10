import type {
  CreateTableBody,
  GsiDef,
  Item,
  Profile,
  PutItemBody,
  QueryBody,
  QueryResult,
  RuntimeInfo,
  TableDesc,
  TtlBody,
  UpdateTableBody,
} from '../shared/types.ts'

export interface Conn {
  profile: string
  region: string
  endpoint: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message)
  }
}

const UNREACHABLE = "Can't reach the DDB Browser server; it may be restarting"

let conn: Conn = { profile: '', region: '', endpoint: '' }

/** Sets the connection every subsequent request is made with. */
export function setConn(c: Conn) {
  conn = c
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-ddb-profile': encodeURIComponent(conn.profile),
      'x-ddb-region': conn.region,
      'x-ddb-endpoint': conn.endpoint,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new ApiError(UNREACHABLE, 'Unreachable', 0)
  })
  const data = await res.json().catch(() => null)
  // Our server always answers in JSON; anything else came from a proxy while it was down.
  if (!res.ok) {
    throw new ApiError(data?.message ?? `${UNREACHABLE} (HTTP ${res.status})`, data?.error ?? 'Error', res.status)
  }
  return data as T
}

const t = (name: string) => `/tables/${encodeURIComponent(name)}`

export const api = {
  about: () => req<RuntimeInfo>('GET', '/about'),
  profiles: () => req<Profile[]>('GET', '/profiles'),
  tables: () => req<string[]>('GET', '/tables'),
  describe: (name: string) => req<TableDesc>('GET', t(name)),
  createTable: (body: CreateTableBody) => req<TableDesc>('POST', '/tables', body),
  deleteTable: (name: string) => req<void>('DELETE', t(name)),
  updateTable: (name: string, body: UpdateTableBody) => req<void>('PATCH', t(name), body),
  updateTtl: (name: string, body: TtlBody) => req<void>('PUT', `${t(name)}/ttl`, body),
  createIndex: (name: string, body: GsiDef) => req<void>('POST', `${t(name)}/indexes`, body),
  deleteIndex: (name: string, index: string) => req<void>('DELETE', `${t(name)}/indexes/${encodeURIComponent(index)}`),
  query: (name: string, body: QueryBody) => req<QueryResult>('POST', `${t(name)}/query`, body),
  putItem: (name: string, body: PutItemBody) => req<void>('PUT', `${t(name)}/items`, body),
  deleteItems: (name: string, keys: Item[]) => req<void>('POST', `${t(name)}/items/delete`, { keys }),
}
