import { describe, expect, it } from 'vitest'
import { call } from './helpers.ts'

// The server holds AWS credentials, so only pages it served itself may call it.
describe('request guard', () => {
  it.each([['localhost'], ['localhost:4577'], ['127.0.0.1:24577'], ['[::1]:4577']])(
    'allows requests addressed to %s',
    async (host) => {
      expect((await call('GET', '/about', undefined, { host })).status).toBe(200)
    },
  )

  it.each([['evil.example'], ['evil.example:4577'], ['localhost.evil.example'], ['192.168.1.10:4577'], ['']])(
    'rejects a Host header of %j (DNS rebinding)',
    async (host) => {
      const res = await call('GET', '/tables', undefined, { host })
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Forbidden')
    },
  )

  it.each([['https://evil.example'], ['http://localhost.evil.example'], ['null'], ['not a url']])(
    'rejects an Origin of %j (CSRF)',
    async (origin) => {
      expect((await call('POST', '/tables', {}, { origin })).status).toBe(403)
    },
  )

  it.each([['http://localhost:5173'], ['http://127.0.0.1:24577']])('allows a local Origin of %s', async (origin) => {
    expect((await call('GET', '/about', undefined, { origin })).status).toBe(200)
  })

  it('rejects requests the browser marks as cross-site', async () => {
    expect((await call('GET', '/about', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await call('GET', '/about', undefined, { 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('requires a profile and region for AWS calls', async () => {
    const res = await call('GET', '/tables', undefined, { 'x-ddb-profile': '' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Select a profile and region/)
  })

  it('answers unknown API routes with JSON, not the UI', async () => {
    const res = await call('GET', '/nope')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('NotFound')
  })
})
