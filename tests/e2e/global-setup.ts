import { startDynamoDbLocal } from '../support/dynamodb-local.ts'

export default async function globalSetup() {
  const ddb = await startDynamoDbLocal()
  // Worker processes inherit this.
  process.env.E2E_DDB_ENDPOINT = ddb.endpoint
  return () => ddb.stop()
}
