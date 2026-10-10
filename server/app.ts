import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  type AttributeValue,
  BatchWriteItemCommand,
  type BatchWriteItemCommandOutput,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  type DynamoDBClient,
  type KeySchemaElement,
  ListTablesCommand,
  PutItemCommand,
  QueryCommand,
  type QueryCommandInput,
  ScanCommand,
  type TableDescription,
  TransactWriteItemsCommand,
  UpdateTableCommand,
  type UpdateTableCommandInput,
  UpdateTimeToLiveCommand,
  type WriteRequest,
} from '@aws-sdk/client-dynamodb'
import { serve } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import type {
  CreateTableBody,
  GsiDef,
  Item,
  KeyDef,
  PutItemBody,
  QueryBody,
  QueryResult,
  TtlBody,
  TypedValue,
  UpdateTableBody,
} from '../shared/types.ts'
import { fromWireItem, getClient, HttpError, listProfiles, toWireItem } from './aws.ts'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

// When a filter is applied DynamoDB may evaluate many items to return a few,
// so each request reads at most this many pages of this many items.
const FILTER_PAGE_SIZE = 1000
const FILTER_MAX_PAGES = 10

const app = new Hono()

// This server holds AWS credentials, so refuse anything that isn't a
// same-origin request from the local machine (blocks CSRF and DNS rebinding).
app.use('/api/*', async (c, next) => {
  const hostname = (c.req.header('host') ?? '').replace(/:\d+$/, '')
  const origin = c.req.header('origin')
  const originOk = !origin || LOOPBACK.has(URL.parse(origin)?.hostname ?? '')
  if (!LOOPBACK.has(hostname) || !originOk || c.req.header('sec-fetch-site') === 'cross-site') {
    return c.json({ error: 'Forbidden', message: 'Only local same-origin requests are allowed' }, 403)
  }
  await next()
})

app.onError((err, c) => {
  const e = err as Error & { status?: number; $metadata?: { httpStatusCode?: number } }
  let status = e.status ?? e.$metadata?.httpStatusCode ?? 500
  let message = e.message
  if (
    e.name === 'ConditionalCheckFailedException' ||
    (e.name === 'TransactionCanceledException' && message.includes('ConditionalCheckFailed'))
  ) {
    status = 409
    message = 'An item with this key already exists'
  } else if (e.name === 'CredentialsProviderError' || e.name === 'ExpiredTokenException') {
    status = 401
  }
  if (status >= 500) console.error(err)
  return c.json({ error: e.name, message }, status as 400)
})

function clientFor(c: Context): DynamoDBClient {
  const profile = decodeURIComponent(c.req.header('x-ddb-profile') ?? '')
  const region = c.req.header('x-ddb-region') ?? ''
  if (!profile || !region) throw new HttpError(400, 'Select a profile and region')
  return getClient({ profile, region, endpoint: c.req.header('x-ddb-endpoint') })
}

async function describe(client: DynamoDBClient, TableName: string): Promise<TableDescription> {
  const { Table } = await client.send(new DescribeTableCommand({ TableName }))
  if (!Table) throw new HttpError(404, `Table ${TableName} not found`)
  return Table
}

/** Attributes that make up a pagination key: the table keys plus the index keys. */
function keyAttrs(table: TableDescription, index?: string): string[] {
  const names = (table.KeySchema ?? []).map((k) => k.AttributeName!)
  if (index) {
    const ix = [...(table.GlobalSecondaryIndexes ?? []), ...(table.LocalSecondaryIndexes ?? [])].find(
      (i) => i.IndexName === index,
    )
    for (const k of ix?.KeySchema ?? []) if (!names.includes(k.AttributeName!)) names.push(k.AttributeName!)
  }
  return names
}

function toAV(tv: TypedValue, which: 'value' | 'value2' = 'value'): AttributeValue {
  const type = tv.type
  const v = tv[which] ?? ''
  switch (type) {
    case 'N':
      if (v.trim() === '' || Number.isNaN(Number(v))) throw new HttpError(400, `"${v}" is not a number`)
      return { N: v.trim() }
    case 'B':
      return { B: Buffer.from(v, 'base64') }
    case 'BOOL':
      return { BOOL: v.trim().toLowerCase() === 'true' }
    case 'NULL':
      return { NULL: true }
    default:
      return { S: v }
  }
}

function buildExpressions(body: QueryBody) {
  const names: Record<string, string> = {}
  const values: Record<string, AttributeValue> = {}
  const name = (n: string) => {
    const ref = `#n${Object.keys(names).length}`
    names[ref] = n
    return ref
  }
  // Filter attributes may be document paths such as "address.city" or "tags[0]".
  const pathRef = (p: string) =>
    p
      .split('.')
      .map((part) => {
        const m = /^(.*?)((?:\[\d+\])*)$/.exec(part)!
        return name(m[1]) + m[2]
      })
      .join('.')
  const value = (av: AttributeValue) => {
    const ref = `:v${Object.keys(values).length}`
    values[ref] = av
    return ref
  }

  let KeyConditionExpression: string | undefined
  if (body.mode === 'query') {
    if (!body.pk) throw new HttpError(400, 'A partition key value is required to query')
    KeyConditionExpression = `${name(body.pk.name)} = ${value(toAV(body.pk))}`
    const sk = body.sk
    if (sk) {
      const n = name(sk.name)
      const v = value(toAV(sk))
      if (sk.op === 'begins_with') KeyConditionExpression += ` AND begins_with(${n}, ${v})`
      else if (sk.op === 'between') KeyConditionExpression += ` AND ${n} BETWEEN ${v} AND ${value(toAV(sk, 'value2'))}`
      else KeyConditionExpression += ` AND ${n} ${sk.op} ${v}`
    }
  }

  const conditions = body.filters.map((f) => {
    const n = pathRef(f.attr.trim())
    switch (f.op) {
      case 'exists':
        return `attribute_exists(${n})`
      case 'not_exists':
        return `attribute_not_exists(${n})`
      case 'begins_with':
        return `begins_with(${n}, ${value(toAV(f))})`
      case 'contains':
        return `contains(${n}, ${value(toAV(f))})`
      case 'not_contains':
        return `NOT contains(${n}, ${value(toAV(f))})`
      case 'between':
        return `${n} BETWEEN ${value(toAV(f))} AND ${value(toAV(f, 'value2'))}`
      default:
        return `${n} ${f.op} ${value(toAV(f))}`
    }
  })

  return {
    KeyConditionExpression,
    FilterExpression: conditions.length ? conditions.join(' AND ') : undefined,
    ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
    ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
  }
}

app.get('/api/profiles', async (c) => c.json(await listProfiles()))

app.get('/api/tables', async (c) => {
  const client = clientFor(c)
  const tables: string[] = []
  let ExclusiveStartTableName: string | undefined
  do {
    const out = await client.send(new ListTablesCommand({ ExclusiveStartTableName }))
    tables.push(...(out.TableNames ?? []))
    ExclusiveStartTableName = out.LastEvaluatedTableName
  } while (ExclusiveStartTableName)
  return c.json(tables)
})

app.post('/api/tables', async (c) => {
  const body = await c.req.json<CreateTableBody>()
  const defs = new Map<string, string>()
  const schema = (pk: KeyDef, sk?: KeyDef): KeySchemaElement[] => {
    const keys = [pk, ...(sk?.name ? [sk] : [])]
    for (const k of keys) {
      if (!k.name) throw new HttpError(400, 'Key attribute names cannot be empty')
      if (defs.has(k.name) && defs.get(k.name) !== k.type) {
        throw new HttpError(400, `Attribute "${k.name}" is used with conflicting types`)
      }
      defs.set(k.name, k.type)
    }
    return keys.map((k, i) => ({ AttributeName: k.name, KeyType: i === 0 ? 'HASH' : 'RANGE' }))
  }
  const provisioned = body.billing === 'PROVISIONED'
  const ProvisionedThroughput = provisioned
    ? { ReadCapacityUnits: body.rcu ?? 5, WriteCapacityUnits: body.wcu ?? 5 }
    : undefined
  const KeySchema = schema(body.pk, body.sk)
  const GlobalSecondaryIndexes = body.gsis.map((g) => ({
    IndexName: g.name,
    KeySchema: schema(g.pk, g.sk),
    Projection: { ProjectionType: g.projection },
    ProvisionedThroughput,
  }))
  const out = await clientFor(c).send(
    new CreateTableCommand({
      TableName: body.name,
      KeySchema,
      AttributeDefinitions: [...defs].map(([AttributeName, t]) => ({
        AttributeName,
        AttributeType: t as 'S' | 'N' | 'B',
      })),
      BillingMode: body.billing,
      ProvisionedThroughput,
      GlobalSecondaryIndexes: GlobalSecondaryIndexes.length ? GlobalSecondaryIndexes : undefined,
      DeletionProtectionEnabled: body.deletionProtection || undefined,
    }),
  )
  return c.json(out.TableDescription)
})

app.get('/api/tables/:name', async (c) => {
  const client = clientFor(c)
  const TableName = c.req.param('name')
  const [table, ttl] = await Promise.all([
    describe(client, TableName),
    client.send(new DescribeTimeToLiveCommand({ TableName })).catch(() => undefined),
  ])
  return c.json({
    ...table,
    ttl: {
      status: ttl?.TimeToLiveDescription?.TimeToLiveStatus,
      attribute: ttl?.TimeToLiveDescription?.AttributeName,
    },
  })
})

const isProvisioned = (table: TableDescription) =>
  table.BillingModeSummary?.BillingMode !== 'PAY_PER_REQUEST' && !!table.ProvisionedThroughput?.ReadCapacityUnits

app.patch('/api/tables/:name', async (c) => {
  const body = await c.req.json<UpdateTableBody>()
  const client = clientFor(c)
  const TableName = c.req.param('name')
  const table = await describe(client, TableName)
  const wasProvisioned = isProvisioned(table)
  const provisioned = body.billing ? body.billing === 'PROVISIONED' : wasProvisioned

  const input: UpdateTableCommandInput = { TableName }
  if (body.deletionProtection !== undefined) input.DeletionProtectionEnabled = body.deletionProtection
  if (provisioned && (!wasProvisioned || body.rcu !== undefined || body.wcu !== undefined)) {
    const current = table.ProvisionedThroughput
    input.ProvisionedThroughput = {
      ReadCapacityUnits: body.rcu ?? (current?.ReadCapacityUnits || 5),
      WriteCapacityUnits: body.wcu ?? (current?.WriteCapacityUnits || 5),
    }
    if (!wasProvisioned) {
      // Switching to provisioned requires capacity for every existing index too.
      input.BillingMode = 'PROVISIONED'
      const indexes = table.GlobalSecondaryIndexes ?? []
      if (indexes.length) {
        input.GlobalSecondaryIndexUpdates = indexes.map((g) => ({
          Update: { IndexName: g.IndexName!, ProvisionedThroughput: input.ProvisionedThroughput! },
        }))
      }
    }
  } else if (!provisioned && wasProvisioned) {
    input.BillingMode = 'PAY_PER_REQUEST'
  }
  if (Object.keys(input).length === 1) throw new HttpError(400, 'Nothing to change')
  await client.send(new UpdateTableCommand(input))
  return c.json({ ok: true })
})

app.put('/api/tables/:name/ttl', async (c) => {
  const { enabled, attribute } = await c.req.json<TtlBody>()
  if (!attribute?.trim()) throw new HttpError(400, 'A TTL attribute name is required')
  await clientFor(c).send(
    new UpdateTimeToLiveCommand({
      TableName: c.req.param('name'),
      TimeToLiveSpecification: { Enabled: enabled, AttributeName: attribute.trim() },
    }),
  )
  return c.json({ ok: true })
})

app.post('/api/tables/:name/indexes', async (c) => {
  const gsi = await c.req.json<GsiDef>()
  const client = clientFor(c)
  const TableName = c.req.param('name')
  const table = await describe(client, TableName)
  const defs = new Map((table.AttributeDefinitions ?? []).map((d) => [d.AttributeName!, d.AttributeType as string]))
  const keys = [gsi.pk, ...(gsi.sk?.name ? [gsi.sk] : [])]
  for (const k of keys) {
    if (!k.name) throw new HttpError(400, 'Key attribute names cannot be empty')
    if (defs.has(k.name) && defs.get(k.name) !== k.type) {
      throw new HttpError(400, `Attribute "${k.name}" is already defined as type ${defs.get(k.name)}`)
    }
    defs.set(k.name, k.type)
  }
  const current = table.ProvisionedThroughput
  await client.send(
    new UpdateTableCommand({
      TableName,
      AttributeDefinitions: [...defs].map(([AttributeName, t]) => ({
        AttributeName,
        AttributeType: t as 'S' | 'N' | 'B',
      })),
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: gsi.name,
            KeySchema: keys.map((k, i) => ({ AttributeName: k.name, KeyType: i === 0 ? 'HASH' : 'RANGE' })),
            Projection: { ProjectionType: gsi.projection },
            ProvisionedThroughput: isProvisioned(table)
              ? { ReadCapacityUnits: current!.ReadCapacityUnits!, WriteCapacityUnits: current!.WriteCapacityUnits! }
              : undefined,
          },
        },
      ],
    }),
  )
  return c.json({ ok: true })
})

app.delete('/api/tables/:name/indexes/:index', async (c) => {
  await clientFor(c).send(
    new UpdateTableCommand({
      TableName: c.req.param('name'),
      GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: c.req.param('index') } }],
    }),
  )
  return c.json({ ok: true })
})

app.delete('/api/tables/:name', async (c) => {
  await clientFor(c).send(new DeleteTableCommand({ TableName: c.req.param('name') }))
  return c.json({ ok: true })
})

app.post('/api/tables/:name/query', async (c) => {
  const body = await c.req.json<QueryBody>()
  const client = clientFor(c)
  const TableName = c.req.param('name')
  const limit = Math.min(Math.max(Math.floor(body.limit) || 100, 1), 1000)
  const expressions = buildExpressions(body)
  const filtered = !!expressions.FilterExpression

  const items: Record<string, AttributeValue>[] = []
  let lastKey = body.startKey ? fromWireItem(body.startKey) : undefined
  let scanned = 0
  let capacity = 0
  let pages = 0
  do {
    const input: QueryCommandInput = {
      TableName,
      IndexName: body.index || undefined,
      ExclusiveStartKey: lastKey,
      Limit: filtered ? FILTER_PAGE_SIZE : limit - items.length,
      ReturnConsumedCapacity: 'TOTAL',
      ...expressions,
    }
    const out =
      body.mode === 'query'
        ? await client.send(new QueryCommand({ ...input, ScanIndexForward: !body.descending }))
        : await client.send(new ScanCommand(input))
    items.push(...(out.Items ?? []))
    scanned += out.ScannedCount ?? 0
    capacity += out.ConsumedCapacity?.CapacityUnits ?? 0
    lastKey = out.LastEvaluatedKey
    pages++
  } while (lastKey && items.length < limit && pages < (filtered ? FILTER_MAX_PAGES : 50))

  // A filtered page can overshoot the limit; trim and resume from the last item kept.
  if (items.length > limit) {
    items.length = limit
    const attrs = keyAttrs(await describe(client, TableName), body.index)
    lastKey = Object.fromEntries(attrs.map((a) => [a, items[limit - 1][a]]))
  }

  const result: QueryResult = {
    items: items.map(toWireItem),
    lastKey: lastKey && toWireItem(lastKey),
    scanned,
    capacity,
  }
  return c.json(result)
})

app.put('/api/tables/:name/items', async (c) => {
  const { item, originalKey, overwrite } = await c.req.json<PutItemBody>()
  const client = clientFor(c)
  const TableName = c.req.param('name')
  const Item = fromWireItem(item)
  const keys = keyAttrs(await describe(client, TableName))
  for (const k of keys) if (!item[k]) throw new HttpError(400, `Missing key attribute "${k}"`)

  const mustNotExist = {
    ConditionExpression: 'attribute_not_exists(#pk)',
    ExpressionAttributeNames: { '#pk': keys[0] },
  }
  const moved = originalKey && keys.some((k) => JSON.stringify(item[k]) !== JSON.stringify(originalKey[k]))
  if (moved) {
    // Keys are immutable, so changing one means writing the new item and removing the old.
    await client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          { Put: { TableName, Item, ...(overwrite ? {} : mustNotExist) } },
          { Delete: { TableName, Key: fromWireItem(originalKey) } },
        ],
      }),
    )
  } else {
    await client.send(new PutItemCommand({ TableName, Item, ...(originalKey || overwrite ? {} : mustNotExist) }))
  }
  return c.json({ ok: true })
})

app.post('/api/tables/:name/items/delete', async (c) => {
  const { keys } = await c.req.json<{ keys: Item[] }>()
  const client = clientFor(c)
  const TableName = c.req.param('name')
  const requests: WriteRequest[] = keys.map((k) => ({ DeleteRequest: { Key: fromWireItem(k) } }))
  for (let i = 0; i < requests.length; i += 25) {
    let pending: WriteRequest[] = requests.slice(i, i + 25)
    for (let attempt = 0; pending.length; attempt++) {
      if (attempt === 6) throw new HttpError(503, 'DynamoDB kept throttling the delete; some items remain')
      if (attempt) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt))
      const out: BatchWriteItemCommandOutput = await client.send(
        new BatchWriteItemCommand({ RequestItems: { [TableName]: pending } }),
      )
      pending = out.UnprocessedItems?.[TableName] ?? []
    }
  }
  return c.json({ deleted: keys.length })
})

app.all('/api/*', (c) => c.json({ error: 'NotFound', message: 'Unknown API route' }, 404))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export interface ServerOptions {
  /** 0 picks any free port. */
  port: number
  host?: string
  /** Directory holding the built UI; omit to serve the API only. */
  staticDir?: string
}

/** Starts the server and resolves with the port it is listening on. */
export function startServer({ port, host = '127.0.0.1', staticDir }: ServerOptions): Promise<number> {
  const root = new Hono()
  root.route('/', app)
  if (staticDir) {
    const dir = path.resolve(staticDir)
    root.get('*', async (c) => {
      const file = path.resolve(dir, `.${decodeURIComponent(c.req.path)}`)
      if (file.startsWith(dir + path.sep)) {
        const body = await readFile(file).catch(() => undefined)
        const type = MIME[path.extname(file)] ?? 'application/octet-stream'
        if (body) return c.body(new Uint8Array(body), 200, { 'content-type': type })
      }
      // Anything else is a client-side route.
      return c.html(await readFile(path.join(dir, 'index.html'), 'utf8'))
    })
  }
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: root.fetch, port, hostname: host }, (info) => resolve(info.port))
    server.on('error', reject)
  })
}
