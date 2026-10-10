import { type AttributeValue, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader'
import { type AV, ENV_PROFILE, type Item, LOCAL_PROFILE, type Profile } from '../shared/types.ts'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BadRequest'
  }
}

export interface Conn {
  profile: string
  region: string
  endpoint?: string
}

const clients = new Map<string, DynamoDBClient>()

export function getClient(conn: Conn): DynamoDBClient {
  const local = conn.profile === LOCAL_PROFILE
  const endpoint = local ? conn.endpoint || 'http://localhost:8000' : undefined
  const cacheKey = JSON.stringify([conn.profile, conn.region, endpoint])
  let client = clients.get(cacheKey)
  if (!client) {
    client = new DynamoDBClient({
      region: conn.region,
      endpoint,
      credentials: local
        ? { accessKeyId: 'local', secretAccessKey: 'local' }
        : conn.profile === ENV_PROFILE
          ? undefined
          : fromNodeProviderChain({ profile: conn.profile, ignoreCache: true }),
    })
    clients.set(cacheKey, client)
  }
  return client
}

// ignoreCache: the SDK otherwise keeps the first read of ~/.aws for the life of the process.
export async function listProfiles(): Promise<Profile[]> {
  const empty: Awaited<ReturnType<typeof loadSharedConfigFiles>> = { configFile: {}, credentialsFile: {} }
  const { configFile, credentialsFile } = await loadSharedConfigFiles({ ignoreCache: true }).catch(() => empty)
  // The config file also holds [sso-session x] and [services x] sections, which aren't profiles.
  const isProfile = (name: string) => !name.startsWith('sso-session.') && !name.startsWith('services.')
  const names = [...new Set([...Object.keys(configFile).filter(isProfile), ...Object.keys(credentialsFile)])].sort(
    (a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)),
  )
  const profiles: Profile[] = names.map((name) => ({ name, region: configFile[name]?.region }))
  if (process.env.AWS_ACCESS_KEY_ID) {
    profiles.push({ name: ENV_PROFILE, region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION })
  }
  profiles.push({ name: LOCAL_PROFILE })
  return profiles
}

// The SDK represents binary as Uint8Array; on the wire we use base64 strings.

export function toWire(av: AttributeValue): AV {
  if (av.B !== undefined) return { B: Buffer.from(av.B).toString('base64') }
  if (av.BS !== undefined) return { BS: av.BS.map((b) => Buffer.from(b).toString('base64')) }
  if (av.M !== undefined) return { M: toWireItem(av.M) }
  if (av.L !== undefined) return { L: av.L.map(toWire) }
  return av as AV
}

export function toWireItem(item: Record<string, AttributeValue>): Item {
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, toWire(v)]))
}

export function fromWire(av: AV): AttributeValue {
  if (av === null || typeof av !== 'object' || Array.isArray(av)) {
    throw new HttpError(400, 'Invalid DynamoDB JSON: expected an attribute value object like {"S": "text"}')
  }
  if (av.B !== undefined) return { B: Buffer.from(av.B, 'base64') }
  if (av.BS !== undefined) return { BS: av.BS.map((b) => Buffer.from(b, 'base64')) }
  if (av.M !== undefined) return { M: fromWireItem(av.M) }
  if (av.L !== undefined) return { L: av.L.map(fromWire) }
  return av as AttributeValue
}

export function fromWireItem(item: Item): Record<string, AttributeValue> {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new HttpError(400, 'Invalid item: expected an object of attributes')
  }
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, fromWire(v)]))
}
