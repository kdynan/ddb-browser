import { randomUUID } from 'node:crypto'
import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test'
import { type CreateTableBody, type Item, LOCAL_PROFILE, type QueryResult, type TableDesc } from '../../shared/types.ts'

const endpoint = () => process.env.E2E_DDB_ENDPOINT ?? ''
const headers = () => ({
  'x-ddb-profile': encodeURIComponent(LOCAL_PROFILE),
  'x-ddb-region': 'us-east-1',
  'x-ddb-endpoint': endpoint(),
})

/** Sets up and inspects test data through the app's own API. */
export class Ddb {
  private tables: string[] = []
  constructor(private request: APIRequestContext) {}

  /** A unique table name that is cleaned up after the test, whether or not the table gets created. */
  name(prefix = 'e2e'): string {
    const name = `${prefix}-${randomUUID().slice(0, 8)}`
    this.tables.push(name)
    return name
  }

  /** Creates a table with a string partition key "id" unless overridden. */
  async createTable(overrides: Partial<CreateTableBody> = {}): Promise<string> {
    const body: CreateTableBody = {
      name: overrides.name ?? this.name(),
      pk: { name: 'id', type: 'S' },
      billing: 'PAY_PER_REQUEST',
      gsis: [],
      ...overrides,
    }
    const res = await this.request.post('/api/tables', { headers: headers(), data: body })
    expect(res.ok(), await res.text()).toBe(true)
    return body.name
  }

  async put(table: string, items: Item[]) {
    for (const item of items) {
      const res = await this.request.put(`/api/tables/${table}/items`, { headers: headers(), data: { item } })
      expect(res.ok(), await res.text()).toBe(true)
    }
  }

  async items(table: string): Promise<Item[]> {
    const res = await this.request.post(`/api/tables/${table}/query`, {
      headers: headers(),
      data: { mode: 'scan', filters: [], limit: 1000 },
    })
    return ((await res.json()) as QueryResult).items
  }

  async describe(table: string): Promise<TableDesc> {
    return (await this.request.get(`/api/tables/${table}`, { headers: headers() })).json()
  }

  async exists(table: string): Promise<boolean> {
    return (await this.request.get(`/api/tables/${table}`, { headers: headers() })).ok()
  }

  async cleanup() {
    for (const table of this.tables) {
      await this.request.patch(`/api/tables/${table}`, { headers: headers(), data: { deletionProtection: false } })
      await this.request.delete(`/api/tables/${table}`, { headers: headers() })
    }
  }
}

export const test = base.extend<{ ddb: Ddb }>({
  ddb: async ({ request }, use) => {
    const ddb = new Ddb(request)
    await use(ddb)
    await ddb.cleanup()
  },
  // Every page starts connected to the test DynamoDB.
  page: async ({ page }, use) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value)
      },
      ['ddb-browser.conn', JSON.stringify({ profile: LOCAL_PROFILE, region: 'us-east-1', endpoint: endpoint() })],
    )
    await use(page)
  },
})

export { expect }

export const sidebarTable = (page: Page, name: string) => page.locator('aside').getByRole('button', { name, exact: true })

/** Opens the app and selects a table, waiting for its first page of items. */
export async function openTable(page: Page, name: string) {
  await page.goto('/')
  await sidebarTable(page, name).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText(/\d+ items? loaded/)).toBeVisible()
}

export const row = (page: Page, text: string) => page.locator('tbody tr', { hasText: text })
export const editor = (page: Page) => page.locator('.cm-content')
export const dialog = (page: Page) => page.locator('.fixed').last()

/** Replaces the whole document in the open item editor. */
export async function setEditorText(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
}

/** Replaces part of the editor's text; only for items short enough to be fully rendered. */
export async function editEditorText(page: Page, from: string, to: string) {
  const text = await editor(page).innerText()
  expect(text).toContain(from)
  await setEditorText(page, text.replace(from, to))
}

export const expectEditorClosed = (page: Page) => expect(page.locator('.cm-editor')).toHaveCount(0)
