import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { startServer } from '../../server/app.ts'

describe('serving the built UI', () => {
  let base: string
  beforeAll(async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ddb-browser-static-'))
    const dist = path.join(root, 'dist')
    mkdirSync(path.join(dist, 'assets'), { recursive: true })
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ui</title>')
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("app")')
    writeFileSync(path.join(dist, 'assets', 'app.css'), 'body{}')
    // Sits next to dist; must never be served.
    writeFileSync(path.join(root, 'secret.txt'), 'top secret')
    writeFileSync(path.join(`${dist}-private`), 'also secret')
    base = `http://127.0.0.1:${await startServer({ port: 0, staticDir: dist })}`
  })

  const get = async (urlPath: string) => {
    const res = await fetch(base + urlPath)
    return { status: res.status, type: res.headers.get('content-type'), text: await res.text() }
  }

  it('listens on a free port when asked for port 0', () => {
    expect(base).toMatch(/:\d{4,5}$/)
  })

  it('serves index.html at the root', async () => {
    expect(await get('/')).toMatchObject({ status: 200, type: 'text/html; charset=UTF-8', text: expect.stringContaining('<title>ui') })
  })

  it('serves assets with their content type', async () => {
    expect(await get('/assets/app.js')).toMatchObject({ status: 200, type: 'text/javascript', text: 'console.log("app")' })
    expect(await get('/assets/app.css')).toMatchObject({ status: 200, type: 'text/css' })
  })

  it('falls back to index.html for client-side routes and missing files', async () => {
    expect((await get('/some/route')).text).toContain('<title>ui')
    expect((await get('/assets/missing.js')).text).toContain('<title>ui')
    expect((await get('/assets')).text).toContain('<title>ui')
  })

  it.each([['/../secret.txt'], ['/%2e%2e/secret.txt'], ['/..%2fsecret.txt'], ['/assets/../../secret.txt'], ['/../dist-private']])(
    'does not serve files outside the UI folder for %s',
    async (urlPath) => {
      // Raw request so the client doesn't normalise the path first.
      const { text } = await rawGet(base, urlPath)
      expect(text).not.toContain('secret')
    },
  )

  it('still serves the API alongside the UI', async () => {
    const res = await get('/api/about')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.text).node).toBe(process.versions.node)
    expect((await get('/api/unknown')).status).toBe(404)
  })

  it('rejects a second server on a port that is taken', async () => {
    const port = Number(new URL(base).port)
    await expect(startServer({ port })).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})

async function rawGet(base: string, urlPath: string): Promise<{ text: string }> {
  const net = await import('node:net')
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => {
      socket.write(`GET ${urlPath} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n\r\n`)
    })
    let text = ''
    socket.on('data', (d) => (text += d))
    socket.on('end', () => resolve({ text }))
    socket.on('error', reject)
  })
}
