import type { TestProject } from 'vitest/node'
import { startDynamoDbLocal } from '../support/dynamodb-local.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    ddbEndpoint: string
  }
}

export default async function setup(project: TestProject) {
  const ddb = await startDynamoDbLocal()
  project.provide('ddbEndpoint', ddb.endpoint)
  return () => ddb.stop()
}
