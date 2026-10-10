// Types shared by the server and the UI.

/** DynamoDB JSON attribute value as sent over the wire (binary is base64). */
export interface AV {
  S?: string
  N?: string
  BOOL?: boolean
  NULL?: boolean
  M?: Record<string, AV>
  L?: AV[]
  SS?: string[]
  NS?: string[]
  BS?: string[]
  B?: string
}
export type Item = Record<string, AV>

export type KeyType = 'S' | 'N' | 'B'
export type ValueType = 'S' | 'N' | 'B' | 'BOOL' | 'NULL'
export type SortKeyOp = '=' | '<' | '<=' | '>' | '>=' | 'begins_with' | 'between'
export type FilterOp =
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='
  | 'begins_with'
  | 'contains'
  | 'not_contains'
  | 'between'
  | 'exists'
  | 'not_exists'

export interface TypedValue {
  type: ValueType
  value: string
  value2?: string
}

export interface QueryBody {
  mode: 'scan' | 'query'
  index?: string
  pk?: TypedValue & { name: string }
  sk?: TypedValue & { name: string; op: SortKeyOp }
  filters: (TypedValue & { attr: string; op: FilterOp })[]
  limit: number
  descending?: boolean
  startKey?: Item
}

export interface QueryResult {
  items: Item[]
  lastKey?: Item
  scanned: number
  capacity: number
}

export interface PutItemBody {
  item: Item
  /** Key of the item being edited; omitted when creating a new item. */
  originalKey?: Item
  overwrite?: boolean
}

export interface KeyDef {
  name: string
  type: KeyType
}

export interface GsiDef {
  name: string
  pk: KeyDef
  sk?: KeyDef
  projection: 'ALL' | 'KEYS_ONLY'
}

/** Only the fields being changed are sent. */
export interface UpdateTableBody {
  billing?: 'PAY_PER_REQUEST' | 'PROVISIONED'
  rcu?: number
  wcu?: number
  deletionProtection?: boolean
}

export interface TtlBody {
  enabled: boolean
  attribute: string
}

export interface CreateTableBody {
  name: string
  pk: KeyDef
  sk?: KeyDef
  billing: 'PAY_PER_REQUEST' | 'PROVISIONED'
  rcu?: number
  wcu?: number
  deletionProtection?: boolean
  gsis: GsiDef[]
}

export interface Profile {
  name: string
  region?: string
}

/** Where the server is running, for the About dialog. */
export interface RuntimeInfo {
  node: string
  /** Set only in the desktop app. */
  electron?: string
  chrome?: string
  os: string
  awsDir: string
}

export interface KeySchemaEl {
  AttributeName: string
  KeyType: 'HASH' | 'RANGE'
}

export interface IndexDesc {
  IndexName: string
  KeySchema: KeySchemaEl[]
  Projection?: { ProjectionType?: string; NonKeyAttributes?: string[] }
  IndexStatus?: string
  ItemCount?: number
}

export interface TableDesc {
  TableName: string
  TableStatus: string
  TableArn?: string
  CreationDateTime?: string
  ItemCount?: number
  TableSizeBytes?: number
  KeySchema: KeySchemaEl[]
  AttributeDefinitions: { AttributeName: string; AttributeType: KeyType }[]
  BillingModeSummary?: { BillingMode?: string }
  ProvisionedThroughput?: { ReadCapacityUnits?: number; WriteCapacityUnits?: number }
  GlobalSecondaryIndexes?: IndexDesc[]
  LocalSecondaryIndexes?: IndexDesc[]
  StreamSpecification?: { StreamEnabled?: boolean; StreamViewType?: string }
  DeletionProtectionEnabled?: boolean
  TableClassSummary?: { TableClass?: string }
  ttl?: { status?: string; attribute?: string }
}

export const LOCAL_PROFILE = '(local)'
export const ENV_PROFILE = '(environment)'
