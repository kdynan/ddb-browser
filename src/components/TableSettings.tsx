import { useState } from 'react'
import type { GsiDef, KeyDef, TableDesc, UpdateTableBody } from '../../shared/types.ts'
import { api } from '../api.ts'
import { emptyKey, KeyInput } from './CreateTableDialog.tsx'
import { Button, ErrorBox, Input, Label, Modal, Select } from './ui.tsx'

export const isProvisioned = (t: TableDesc) =>
  t.BillingModeSummary?.BillingMode !== 'PAY_PER_REQUEST' && !!t.ProvisionedThroughput?.ReadCapacityUnits

interface DialogProps {
  table: TableDesc
  onClose: () => void
  onSaved: () => void
}

export function EditSettingsDialog({ table: t, onClose, onSaved }: DialogProps) {
  const current = {
    billing: isProvisioned(t) ? ('PROVISIONED' as const) : ('PAY_PER_REQUEST' as const),
    rcu: t.ProvisionedThroughput?.ReadCapacityUnits || 5,
    wcu: t.ProvisionedThroughput?.WriteCapacityUnits || 5,
    deletionProtection: !!t.DeletionProtectionEnabled,
    ttl: t.ttl?.status === 'ENABLED' || t.ttl?.status === 'ENABLING',
    ttlAttribute: t.ttl?.attribute ?? '',
  }
  const [billing, setBilling] = useState(current.billing)
  const [rcu, setRcu] = useState(current.rcu)
  const [wcu, setWcu] = useState(current.wcu)
  const [deletionProtection, setDeletionProtection] = useState(current.deletionProtection)
  const [ttl, setTtl] = useState(current.ttl)
  const [ttlAttribute, setTtlAttribute] = useState(current.ttlAttribute)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  // Send only what changed: DynamoDB rejects updates that match the current settings.
  const update: UpdateTableBody = {}
  if (billing !== current.billing) update.billing = billing
  if (billing === 'PROVISIONED' && (update.billing || rcu !== current.rcu || wcu !== current.wcu)) {
    update.rcu = rcu
    update.wcu = wcu
  }
  if (deletionProtection !== current.deletionProtection) update.deletionProtection = deletionProtection
  const tableChanged = Object.keys(update).length > 0
  const ttlChanged = ttl !== current.ttl || (ttl && ttlAttribute.trim() !== current.ttlAttribute)
  const valid = (!ttl || ttlAttribute.trim()) && (billing !== 'PROVISIONED' || (rcu >= 1 && wcu >= 1))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (ttlChanged) {
        // Turning TTL off must name the attribute it is currently on.
        await api.updateTtl(t.TableName, { enabled: ttl, attribute: ttl ? ttlAttribute : current.ttlAttribute })
      }
      if (tableChanged) await api.updateTable(t.TableName, update)
      onSaved()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Edit ${t.TableName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !valid || !(tableChanged || ttlChanged)} onClick={submit}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Label label="Capacity mode">
          <Select value={billing} onChange={(e) => setBilling(e.target.value as typeof billing)}>
            <option value="PAY_PER_REQUEST">On-demand</option>
            <option value="PROVISIONED">Provisioned</option>
          </Select>
        </Label>
        {billing === 'PROVISIONED' && (
          <div className="grid grid-cols-2 gap-2">
            <Label label="Read units">
              <Input type="number" min={1} value={rcu} onChange={(e) => setRcu(Number(e.target.value))} />
            </Label>
            <Label label="Write units">
              <Input type="number" min={1} value={wcu} onChange={(e) => setWcu(Number(e.target.value))} />
            </Label>
          </div>
        )}
      </div>
      {billing === 'PROVISIONED' && current.billing !== 'PROVISIONED' && (t.GlobalSecondaryIndexes?.length ?? 0) > 0 && (
        <p className="text-dim">Existing indexes will get the same read and write units.</p>
      )}
      <div className="grid grid-cols-2 items-end gap-3">
        <label className="flex h-7 items-center gap-2">
          <input type="checkbox" checked={ttl} onChange={(e) => setTtl(e.target.checked)} />
          Expire items automatically (TTL)
        </label>
        {ttl && (
          <Label label="TTL attribute (epoch seconds)">
            <Input
              className="font-mono"
              placeholder="e.g. expiresAt"
              value={ttlAttribute}
              // DynamoDB can't move TTL to another attribute directly; it must be disabled first.
              disabled={current.ttl}
              onChange={(e) => setTtlAttribute(e.target.value)}
            />
          </Label>
        )}
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={deletionProtection}
          onChange={(e) => setDeletionProtection(e.target.checked)}
        />
        Deletion protection
      </label>
      <ErrorBox error={error} />
    </Modal>
  )
}

export function AddIndexDialog({ table: t, onClose, onSaved }: DialogProps) {
  const [name, setName] = useState('')
  const [pk, setPk] = useState(emptyKey)
  const [sk, setSk] = useState(emptyKey)
  const [projection, setProjection] = useState<GsiDef['projection']>('ALL')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  // An attribute already used as a key somewhere keeps its declared type.
  const withKnownType = (k: KeyDef): KeyDef => {
    const known = t.AttributeDefinitions.find((d) => d.AttributeName === k.name.trim())
    return { name: k.name.trim(), type: known?.AttributeType ?? k.type }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.createIndex(t.TableName, {
        name: name.trim(),
        pk: withKnownType(pk),
        sk: sk.name.trim() ? withKnownType(sk) : undefined,
        projection,
      })
      onSaved()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add global secondary index"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !name.trim() || !pk.name.trim()} onClick={submit}>
            Create index
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Label label="Index name">
          <Input autoFocus className="font-mono" value={name} onChange={(e) => setName(e.target.value)} />
        </Label>
        <Label label="Projection">
          <Select value={projection} onChange={(e) => setProjection(e.target.value as GsiDef['projection'])}>
            <option value="ALL">All attributes</option>
            <option value="KEYS_ONLY">Keys only</option>
          </Select>
        </Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Label label="Partition key">
          <KeyInput value={pk} onChange={setPk} placeholder="attribute name" />
        </Label>
        <Label label="Sort key (optional)">
          <KeyInput value={sk} onChange={setSk} placeholder="attribute name" />
        </Label>
      </div>
      <p className="text-dim">
        DynamoDB backfills the index from existing items; it can't be queried until its status is ACTIVE.
        {isProvisioned(t) && ' It is created with the same read and write units as the table.'}
      </p>
      <ErrorBox error={error} />
    </Modal>
  )
}
