import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { TableDesc } from '../../shared/types.ts'
import { api } from '../api.ts'
import { formatBytes } from '../ddb.ts'
import { ItemsPanel } from './ItemsPanel.tsx'
import { AddIndexDialog, EditSettingsDialog, isProvisioned } from './TableSettings.tsx'
import { Badge, Button, ConfirmButton, ErrorBox, Input, Modal } from './ui.tsx'

interface Props {
  name: string
  connKey: string
  onDeleted: () => void
}

export function TableView({ name, connKey, onDeleted }: Props) {
  const [tab, setTab] = useState<'items' | 'details'>('items')
  const [deleting, setDeleting] = useState(false)
  const queryClient = useQueryClient()
  const table = useQuery({
    queryKey: ['table', connKey, name],
    queryFn: () => api.describe(name),
    // Poll while the table, an index or TTL is still being created, updated or deleted.
    refetchInterval: (q) => (q.state.data && isChanging(q.state.data) ? 2000 : false),
  })
  const t = table.data

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <h1 className="truncate text-[15px] font-semibold">{name}</h1>
        {t && <Badge tone={t.TableStatus === 'ACTIVE' ? 'ok' : 'warn'}>{t.TableStatus}</Badge>}
        {t && (
          <span className="text-dim" title="Approximate; DynamoDB updates these about every six hours">
            ~{(t.ItemCount ?? 0).toLocaleString()} items · {formatBytes(t.TableSizeBytes)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(['items', 'details'] as const).map((id) => (
            <Button
              key={id}
              variant="ghost"
              className={tab === id ? 'bg-hover text-fg capitalize' : 'capitalize'}
              onClick={() => setTab(id)}
            >
              {id}
            </Button>
          ))}
          <Button variant="ghost" className="px-1.5" title="Refresh table info" onClick={() => table.refetch()}>
            <RefreshCw size={14} className={table.isFetching ? 'animate-spin' : ''} />
          </Button>
          <Button variant="ghost" className="px-1.5 hover:text-danger" title="Delete table" onClick={() => setDeleting(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </header>

      {table.error && (
        <div className="p-4">
          <ErrorBox error={table.error} />
        </div>
      )}
      {t && t.TableStatus !== 'ACTIVE' && tab === 'items' && (
        <p className="p-6 text-center text-dim">Table is {t.TableStatus.toLowerCase()}…</p>
      )}
      {t && t.TableStatus === 'ACTIVE' && tab === 'items' && <ItemsPanel table={t} />}
      {t && tab === 'details' && <TableDetails table={t} onChanged={() => table.refetch()} />}

      {deleting && (
        <DeleteTableDialog
          name={name}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            queryClient.invalidateQueries({ queryKey: ['tables', connKey] })
            onDeleted()
          }}
        />
      )}
    </>
  )
}

const isChanging = (t: TableDesc) =>
  t.TableStatus !== 'ACTIVE' ||
  (t.GlobalSecondaryIndexes ?? []).some((i) => i.IndexStatus && i.IndexStatus !== 'ACTIVE') ||
  t.ttl?.status === 'ENABLING' ||
  t.ttl?.status === 'DISABLING'

function DeleteTableDialog({ name, onClose, onDeleted }: { name: string; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.deleteTable(name)
      onDeleted()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Delete table"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={typed !== name || busy} onClick={submit}>
            Delete table
          </Button>
        </>
      }
    >
      <p>
        This permanently deletes <b className="font-mono">{name}</b> and every item in it. Type the table name to
        confirm.
      </p>
      <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
      <ErrorBox error={error} />
    </Modal>
  )
}

function TableDetails({ table: t, onChanged }: { table: TableDesc; onChanged: () => void }) {
  const [dialog, setDialog] = useState<'settings' | 'index' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const ttlOn = t.ttl?.status === 'ENABLED' || t.ttl?.status === 'ENABLING'
  const deleteIndex = async (index: string) => {
    setError(null)
    try {
      await api.deleteIndex(t.TableName, index)
      onChanged()
    } catch (e) {
      setError(e)
    }
  }
  const keys = (schema: TableDesc['KeySchema']) =>
    schema
      .map((k) => {
        const type = t.AttributeDefinitions.find((d) => d.AttributeName === k.AttributeName)?.AttributeType
        return `${k.AttributeName} (${type}) ${k.KeyType === 'HASH' ? 'partition' : 'sort'}`
      })
      .join(' · ')
  const rows: [string, string | undefined][] = [
    ['Key schema', keys(t.KeySchema)],
    [
      'Billing',
      isProvisioned(t)
        ? `Provisioned · ${t.ProvisionedThroughput?.ReadCapacityUnits} RCU / ${t.ProvisionedThroughput?.WriteCapacityUnits} WCU`
        : 'On-demand',
    ],
    ['Table class', t.TableClassSummary?.TableClass ?? 'STANDARD'],
    ['Created', t.CreationDateTime && new Date(t.CreationDateTime).toLocaleString()],
    ['TTL', ttlOn ? `${t.ttl?.status === 'ENABLING' ? 'Enabling' : 'Enabled'} on "${t.ttl?.attribute}"` : 'Disabled'],
    ['Stream', t.StreamSpecification?.StreamEnabled ? t.StreamSpecification.StreamViewType : 'Disabled'],
    ['Deletion protection', t.DeletionProtectionEnabled ? 'Enabled' : 'Disabled'],
    ['ARN', t.TableArn],
  ]
  const indexes = [
    ...(t.GlobalSecondaryIndexes ?? []).map((i) => ({ ...i, type: 'GSI' })),
    ...(t.LocalSecondaryIndexes ?? []).map((i) => ({ ...i, type: 'LSI' })),
  ]
  return (
    <div className="flex flex-col gap-6 overflow-auto p-5">
      <div className="flex items-center gap-2">
        <Button disabled={t.TableStatus !== 'ACTIVE'} onClick={() => setDialog('settings')}>
          <Pencil size={13} /> Edit settings
        </Button>
        <Button disabled={t.TableStatus !== 'ACTIVE'} onClick={() => setDialog('index')}>
          <Plus size={13} /> Add index
        </Button>
        {t.TableStatus !== 'ACTIVE' && <span className="text-dim">Table is {t.TableStatus.toLowerCase()}…</span>}
      </div>
      <ErrorBox error={error} />
      <dl className="grid grid-cols-[160px_1fr] gap-x-4 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-dim">{label}</dt>
            <dd className="font-mono break-all select-text">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h3 className="mb-2 text-[11px] tracking-wide text-dim uppercase">Indexes</h3>
        {indexes.length === 0 ? (
          <p className="text-dim">No secondary indexes</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-dim">
              <tr className="border-b border-line">
                {['Name', 'Type', 'Keys', 'Projection', 'Status', ''].map((h) => (
                  <th key={h} className="py-1.5 pr-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indexes.map((i) => (
                <tr key={i.IndexName} className="border-b border-line/50">
                  <td className="py-1.5 pr-4 font-mono">{i.IndexName}</td>
                  <td className="pr-4">{i.type}</td>
                  <td className="pr-4 font-mono">{keys(i.KeySchema)}</td>
                  <td className="pr-4">{i.Projection?.ProjectionType}</td>
                  <td className="pr-4">{i.IndexStatus ?? 'ACTIVE'}</td>
                  <td className="py-1 text-right">
                    {i.type === 'GSI' && (
                      <ConfirmButton
                        disabled={t.TableStatus !== 'ACTIVE' || i.IndexStatus !== 'ACTIVE'}
                        confirmLabel="Confirm delete"
                        title="Delete index"
                        onConfirm={() => deleteIndex(i.IndexName)}
                      >
                        <Trash2 size={13} />
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {dialog === 'settings' && (
        <EditSettingsDialog table={t} onClose={() => setDialog(null)} onSaved={() => (setDialog(null), onChanged())} />
      )}
      {dialog === 'index' && (
        <AddIndexDialog table={t} onClose={() => setDialog(null)} onSaved={() => (setDialog(null), onChanged())} />
      )}
    </div>
  )
}
