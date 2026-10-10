// Starts a throwaway DynamoDB for tests. Set DYNAMODB_ENDPOINT to use one that
// is already running (as CI does); otherwise DynamoDB Local is downloaded once
// and run with Java.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const DOWNLOAD_URL = 'https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz'
const CACHE_DIR = path.resolve('node_modules/.cache/dynamodb-local')

export interface LocalDynamo {
  endpoint: string
  stop: () => void
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

async function download() {
  mkdirSync(CACHE_DIR, { recursive: true })
  const res = await fetch(DOWNLOAD_URL)
  if (!res.ok) throw new Error(`Could not download DynamoDB Local: HTTP ${res.status}`)
  const archive = path.join(CACHE_DIR, 'dynamodb-local.tar.gz')
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', archive], { cwd: CACHE_DIR })
}

async function waitUntilUp(endpoint: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`DynamoDB Local exited with code ${child.exitCode}`)
    // Any HTTP response, even an error, means it is accepting requests.
    if (await fetch(endpoint).then(() => true, () => false)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('DynamoDB Local did not start within 30 seconds')
}

export async function startDynamoDbLocal(): Promise<LocalDynamo> {
  if (process.env.DYNAMODB_ENDPOINT) return { endpoint: process.env.DYNAMODB_ENDPOINT, stop: () => {} }

  if (!existsSync(path.join(CACHE_DIR, 'DynamoDBLocal.jar'))) await download()
  const port = await freePort()
  const child = spawn(
    'java',
    ['-Djava.library.path=./DynamoDBLocal_lib', '-jar', 'DynamoDBLocal.jar', '-inMemory', '-port', String(port)],
    { cwd: CACHE_DIR, stdio: 'ignore' },
  )
  const failed = new Promise<never>((_, reject) =>
    child.on('error', () =>
      reject(new Error('Tests need Java to run DynamoDB Local, or DYNAMODB_ENDPOINT set to a running instance')),
    ),
  )
  const endpoint = `http://127.0.0.1:${port}`
  try {
    await Promise.race([waitUntilUp(endpoint, child), failed])
  } catch (e) {
    child.kill()
    throw e
  }
  return { endpoint, stop: () => child.kill() }
}
