import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENV_PROFILE, LOCAL_PROFILE, type Profile, type RuntimeInfo } from '../../shared/types.ts'
import { call } from './helpers.ts'

describe('GET /profiles', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ddb-browser-aws-'))
    vi.stubEnv('AWS_CONFIG_FILE', path.join(dir, 'config'))
    vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', path.join(dir, 'credentials'))
    vi.stubEnv('AWS_ACCESS_KEY_ID', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  const profiles = async () => (await call<Profile[]>('GET', '/profiles')).body

  it('offers only DynamoDB Local when there is no AWS configuration', async () => {
    expect(await profiles()).toEqual([{ name: LOCAL_PROFILE }])
  })

  it('lists profiles from both files with their regions, default first, skipping non-profile sections', async () => {
    writeFileSync(
      path.join(dir, 'config'),
      '[profile zeta]\nregion = eu-west-1\n\n[default]\nregion = us-east-2\n\n[profile sso-one]\nsso_session = corp\n\n[sso-session corp]\nsso_region = us-east-1\n\n[services local]\ndynamodb =\n  endpoint_url = http://localhost:8000\n',
    )
    writeFileSync(path.join(dir, 'credentials'), '[keys-only]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = x\n')
    expect(await profiles()).toEqual([
      { name: 'default', region: 'us-east-2' },
      { name: 'keys-only' },
      { name: 'sso-one' },
      { name: 'zeta', region: 'eu-west-1' },
      { name: LOCAL_PROFILE },
    ])
  })

  it('picks up profiles added while the server is running', async () => {
    writeFileSync(path.join(dir, 'config'), '[default]\nregion = us-east-1\n')
    expect((await profiles()).map((p) => p.name)).toEqual(['default', LOCAL_PROFILE])
    writeFileSync(path.join(dir, 'config'), '[default]\nregion = us-east-1\n\n[profile added-later]\nregion = ap-south-1\n')
    expect(await profiles()).toContainEqual({ name: 'added-later', region: 'ap-south-1' })
  })

  it('offers environment credentials when they are set', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIAEXAMPLE')
    vi.stubEnv('AWS_REGION', 'eu-central-1')
    expect(await profiles()).toEqual([{ name: ENV_PROFILE, region: 'eu-central-1' }, { name: LOCAL_PROFILE }])
  })
})

describe('GET /about', () => {
  it('describes the runtime', async () => {
    const { status, body } = await call<RuntimeInfo>('GET', '/about')
    expect(status).toBe(200)
    expect(body.node).toBe(process.versions.node)
    expect(body.os).toMatch(/\(.+\)$/)
    expect(body.electron).toBeUndefined()
  })

  it('reports the folder AWS profiles are read from', async () => {
    vi.stubEnv('AWS_CONFIG_FILE', path.join('/custom', 'aws', 'config'))
    expect((await call<RuntimeInfo>('GET', '/about')).body.awsDir).toBe(path.join('/custom', 'aws'))
    vi.unstubAllEnvs()
  })
})
