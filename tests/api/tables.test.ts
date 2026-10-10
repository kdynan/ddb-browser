import { describe, expect, it } from 'vitest'
import type { TableDesc } from '../../shared/types.ts'
import { call, createTable, putItems, query, uniqueName } from './helpers.ts'

const gsi = (name: string, attr: string) => ({ name, pk: { name: attr, type: 'S' as const }, projection: 'ALL' as const })

const describeTable = async (name: string) => (await call<TableDesc>('GET', `/tables/${name}`)).body

describe('creating tables', () => {
  it('creates an on-demand table with a sort key and index', async () => {
    const name = await createTable({
      gsis: [{ name: 'byStatus', pk: { name: 'status', type: 'S' }, sk: { name: 'sk', type: 'N' }, projection: 'KEYS_ONLY' }],
    })
    const t = await describeTable(name)
    expect(t.TableStatus).toBe('ACTIVE')
    expect(t.KeySchema).toEqual([
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ])
    expect(t.BillingModeSummary?.BillingMode).toBe('PAY_PER_REQUEST')
    expect(t.AttributeDefinitions).toHaveLength(3)
    const [gsi] = t.GlobalSecondaryIndexes ?? []
    expect(gsi.IndexName).toBe('byStatus')
    expect(gsi.Projection?.ProjectionType).toBe('KEYS_ONLY')
    expect(gsi.KeySchema.map((k) => k.AttributeName)).toEqual(['status', 'sk'])
    expect(t.ttl?.status).toBe('DISABLED')
  })

  it('creates a provisioned table with only a partition key', async () => {
    const name = await createTable({ sk: undefined, billing: 'PROVISIONED', rcu: 3, wcu: 2 })
    const t = await describeTable(name)
    expect(t.KeySchema).toEqual([{ AttributeName: 'pk', KeyType: 'HASH' }])
    expect(t.ProvisionedThroughput).toMatchObject({ ReadCapacityUnits: 3, WriteCapacityUnits: 2 })
  })

  it('ignores a sort key with an empty name', async () => {
    const name = await createTable({ sk: { name: '', type: 'S' } })
    expect((await describeTable(name)).KeySchema).toHaveLength(1)
  })

  it('lists created tables', async () => {
    const name = await createTable()
    const { status, body } = await call<string[]>('GET', '/tables')
    expect(status).toBe(200)
    expect(body).toContain(name)
  })

  it('lists more tables than fit in one DynamoDB page', async () => {
    const prefix = uniqueName('many')
    const names = Array.from({ length: 105 }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`)
    await Promise.all(names.map((name) => createTable({ name, sk: undefined })))
    const { body } = await call<string[]>('GET', '/tables')
    expect(body.filter((t) => t.startsWith(prefix))).toEqual(names)
  })

  it('rejects an attribute used with two different types', async () => {
    const res = await call('POST', '/tables', {
      name: uniqueName(),
      pk: { name: 'id', type: 'S' },
      billing: 'PAY_PER_REQUEST',
      gsis: [{ name: 'byId', pk: { name: 'id', type: 'N' }, projection: 'ALL' }],
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/conflicting types/)
  })

  it('rejects an empty partition key name', async () => {
    const res = await call('POST', '/tables', {
      name: uniqueName(),
      pk: { name: '', type: 'S' },
      billing: 'PAY_PER_REQUEST',
      gsis: [],
    })
    expect(res.status).toBe(400)
  })

  it('reports a name that is already taken', async () => {
    const name = await createTable()
    const res = await call('POST', '/tables', { name, pk: { name: 'pk', type: 'S' }, billing: 'PAY_PER_REQUEST', gsis: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('ResourceInUseException')
  })
})

describe('deleting tables', () => {
  it('deletes a table', async () => {
    const name = await createTable()
    expect((await call('DELETE', `/tables/${name}`)).status).toBe(200)
    expect((await call<string[]>('GET', '/tables')).body).not.toContain(name)
    expect((await call('GET', `/tables/${name}`)).body.error).toBe('ResourceNotFoundException')
  })

  it('reports a table that does not exist', async () => {
    const res = await call('DELETE', `/tables/${uniqueName('missing')}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('ResourceNotFoundException')
  })

  it('refuses while deletion protection is on', async () => {
    const name = await createTable({ deletionProtection: true })
    expect((await describeTable(name)).DeletionProtectionEnabled).toBe(true)
    expect((await call('DELETE', `/tables/${name}`)).status).toBe(400)
    expect((await call<string[]>('GET', '/tables')).body).toContain(name)
  })
})

describe('updating table settings', () => {
  it('switches to provisioned and gives existing indexes the same capacity', async () => {
    const name = await createTable({ gsis: [gsi('byKind', 'kind')] })
    expect((await call('PATCH', `/tables/${name}`, { billing: 'PROVISIONED', rcu: 7, wcu: 3 })).status).toBe(200)
    const t = await describeTable(name)
    expect(t.BillingModeSummary?.BillingMode).toBe('PROVISIONED')
    expect(t.ProvisionedThroughput).toMatchObject({ ReadCapacityUnits: 7, WriteCapacityUnits: 3 })
    expect((t.GlobalSecondaryIndexes![0] as any).ProvisionedThroughput).toMatchObject({
      ReadCapacityUnits: 7,
      WriteCapacityUnits: 3,
    })
  })

  it('changes one capacity value and keeps the other', async () => {
    const name = await createTable({ billing: 'PROVISIONED', rcu: 4, wcu: 6 })
    expect((await call('PATCH', `/tables/${name}`, { rcu: 9 })).status).toBe(200)
    expect((await describeTable(name)).ProvisionedThroughput).toMatchObject({ ReadCapacityUnits: 9, WriteCapacityUnits: 6 })
  })

  it('switches back to on-demand', async () => {
    const name = await createTable({ billing: 'PROVISIONED', rcu: 4, wcu: 6 })
    expect((await call('PATCH', `/tables/${name}`, { billing: 'PAY_PER_REQUEST' })).status).toBe(200)
    expect((await describeTable(name)).BillingModeSummary?.BillingMode).toBe('PAY_PER_REQUEST')
  })

  it('toggles deletion protection', async () => {
    const name = await createTable()
    await call('PATCH', `/tables/${name}`, { deletionProtection: true })
    expect((await describeTable(name)).DeletionProtectionEnabled).toBe(true)
    await call('PATCH', `/tables/${name}`, { deletionProtection: false })
    expect((await describeTable(name)).DeletionProtectionEnabled).toBe(false)
    expect((await call('DELETE', `/tables/${name}`)).status).toBe(200)
  })

  it('rejects an update that changes nothing', async () => {
    const name = await createTable()
    const res = await call('PATCH', `/tables/${name}`, {})
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Nothing to change')
  })

  it('ignores capacity values while the table stays on-demand', async () => {
    const name = await createTable()
    expect((await call('PATCH', `/tables/${name}`, { rcu: 10, wcu: 10 })).status).toBe(400)
  })
})

describe('time to live', () => {
  it('turns TTL on and off', async () => {
    const name = await createTable()
    expect((await call('PUT', `/tables/${name}/ttl`, { enabled: true, attribute: ' expiresAt ' })).status).toBe(200)
    expect((await describeTable(name)).ttl).toEqual({ status: 'ENABLED', attribute: 'expiresAt' })
    expect((await call('PUT', `/tables/${name}/ttl`, { enabled: false, attribute: 'expiresAt' })).status).toBe(200)
    expect((await describeTable(name)).ttl?.status).toBe('DISABLED')
  })

  it('requires an attribute name', async () => {
    const name = await createTable()
    const res = await call('PUT', `/tables/${name}/ttl`, { enabled: true, attribute: '  ' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/attribute name is required/)
  })
})

describe('indexes on an existing table', () => {
  it('adds an index that can then be queried', async () => {
    const name = await createTable()
    await putItems(name, [
      { pk: { S: 'a' }, sk: { N: '1' }, city: { S: 'Boston' } },
      { pk: { S: 'a' }, sk: { N: '2' }, city: { S: 'Austin' } },
      { pk: { S: 'b' }, sk: { N: '1' }, city: { S: 'Boston' } },
    ])
    const res = await call('POST', `/tables/${name}/indexes`, {
      name: 'byCity',
      pk: { name: 'city', type: 'S' },
      sk: { name: 'sk', type: 'N' },
      projection: 'ALL',
    })
    expect(res.status).toBe(200)
    const t = await describeTable(name)
    expect(t.GlobalSecondaryIndexes?.map((g) => g.IndexName)).toEqual(['byCity'])
    // The table's own key definitions must survive adding a new attribute definition.
    expect(t.AttributeDefinitions.map((d) => d.AttributeName).sort()).toEqual(['city', 'pk', 'sk'])

    // A new index can't be read until DynamoDB has finished backfilling it.
    await expect
      .poll(async () => (await describeTable(name)).GlobalSecondaryIndexes?.[0].IndexStatus, { timeout: 15_000 })
      .toBe('ACTIVE')
    const found = await query(name, { mode: 'query', index: 'byCity', pk: { name: 'city', type: 'S', value: 'Boston' } })
    expect(found.body.items.map((i) => i.pk.S).sort()).toEqual(['a', 'b'])
  })

  it('creates the index with the table capacity when provisioned', async () => {
    const name = await createTable({ billing: 'PROVISIONED', rcu: 6, wcu: 4 })
    const res = await call('POST', `/tables/${name}/indexes`, { ...gsi('byKind', 'kind'), projection: 'KEYS_ONLY' })
    expect(res.status).toBe(200)
    const [created] = (await describeTable(name)).GlobalSecondaryIndexes as any[]
    expect(created.ProvisionedThroughput).toMatchObject({ ReadCapacityUnits: 6, WriteCapacityUnits: 4 })
    expect(created.Projection.ProjectionType).toBe('KEYS_ONLY')
  })

  it('rejects a key attribute that conflicts with an existing definition', async () => {
    const name = await createTable()
    const res = await call('POST', `/tables/${name}/indexes`, gsi('bySk', 'sk'))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already defined as type N/)
  })

  it('rejects an empty key name', async () => {
    const name = await createTable()
    const res = await call('POST', `/tables/${name}/indexes`, gsi('byNothing', ''))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/cannot be empty/)
  })

  it('passes on DynamoDB errors such as a name that is too short', async () => {
    const name = await createTable()
    const res = await call('POST', `/tables/${name}/indexes`, gsi('g', 'kind'))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/between 3 and 255 characters/)
  })

  it('deletes an index', async () => {
    const name = await createTable({
      gsis: [gsi('keep', 'a'), gsi('drop', 'b')],
    })
    expect((await call('DELETE', `/tables/${name}/indexes/drop`)).status).toBe(200)
    // Index deletion is asynchronous: it shows as DELETING until it disappears.
    await expect
      .poll(async () => (await describeTable(name)).GlobalSecondaryIndexes?.map((g) => g.IndexName), { timeout: 15_000 })
      .toEqual(['keep'])
  })

  it('reports an index that does not exist', async () => {
    const name = await createTable()
    expect((await call('DELETE', `/tables/${name}/indexes/nope-index`)).status).toBe(400)
  })
})
