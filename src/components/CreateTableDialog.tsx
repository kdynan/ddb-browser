import { useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CreateTableBody, KeyDef, KeyType } from '../../shared/types.ts'
import { api } from '../api.ts'
import { Button, ErrorBox, Input, Label, Modal, Select } from './ui.tsx'

interface Gsi {
  id: number
  name: string
  pk: KeyDef
  sk: KeyDef
  projection: 'ALL' | 'KEYS_ONLY'
}

export const emptyKey = (): KeyDef => ({ name: '', type: 'S' })

export function KeyInput({ value, onChange, placeholder }: { value: KeyDef; onChange: (k: KeyDef) => void; placeholder: string }) {
  return (
    <div className="flex gap-1">
      <Input
        className="min-w-0 flex-1 font-mono"
        placeholder={placeholder}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Select value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as KeyType })}>
        <option value="S">String</option>
        <option value="N">Number</option>
        <option value="B">Binary</option>
      </Select>
    </div>
  )
}

interface Props {
  connKey: string
  onClose: () => void
  onCreated: (name: string) => void
}

export function CreateTableDialog({ connKey, onClose, onCreated }: Props) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [pk, setPk] = useState(emptyKey)
  const [sk, setSk] = useState(emptyKey)
  const [billing, setBilling] = useState<CreateTableBody['billing']>('PAY_PER_REQUEST')
  const [rcu, setRcu] = useState(5)
  const [wcu, setWcu] = useState(5)
  const [deletionProtection, setDeletionProtection] = useState(false)
  const [gsis, setGsis] = useState<Gsi[]>([])
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const nextId = useRef(1)

  const trimmed = (k: KeyDef): KeyDef => ({ ...k, name: k.name.trim() })
  const optional = (k: KeyDef) => (k.name.trim() ? trimmed(k) : undefined)
  const updateGsi = (id: number, patch: Partial<Gsi>) => setGsis(gsis.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  const valid = name.trim() && pk.name.trim() && gsis.every((g) => g.name.trim() && g.pk.name.trim())

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.createTable({
        name: name.trim(),
        pk: trimmed(pk),
        sk: optional(sk),
        billing,
        rcu,
        wcu,
        deletionProtection,
        gsis: gsis.map((g) => ({
          name: g.name.trim(),
          pk: trimmed(g.pk),
          sk: optional(g.sk),
          projection: g.projection,
        })),
      })
      await queryClient.invalidateQueries({ queryKey: ['tables', connKey] })
      onCreated(name.trim())
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create table"
      onClose={onClose}
      width="w-[600px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            Create table
          </Button>
        </>
      }
    >
      <Label label="Table name">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <Label label="Partition key">
          <KeyInput value={pk} onChange={setPk} placeholder="e.g. pk" />
        </Label>
        <Label label="Sort key (optional)">
          <KeyInput value={sk} onChange={setSk} placeholder="e.g. sk" />
        </Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Label label="Capacity mode">
          <Select value={billing} onChange={(e) => setBilling(e.target.value as CreateTableBody['billing'])}>
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
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={deletionProtection}
          onChange={(e) => setDeletionProtection(e.target.checked)}
        />
        Enable deletion protection
      </label>

      <div className="flex items-center justify-between border-t border-line pt-3">
        <span className="text-[11px] tracking-wide text-dim uppercase">Global secondary indexes</span>
        <Button
          onClick={() =>
            setGsis([
              ...gsis,
              { id: nextId.current++, name: '', pk: emptyKey(), sk: emptyKey(), projection: 'ALL' },
            ])
          }
        >
          <Plus size={13} /> Add index
        </Button>
      </div>
      {gsis.map((g) => (
        <div key={g.id} className="flex flex-col gap-2 rounded border border-line bg-bg/50 p-2.5">
          <div className="flex gap-2">
            <Input
              className="min-w-0 flex-1 font-mono"
              placeholder="Index name"
              value={g.name}
              onChange={(e) => updateGsi(g.id, { name: e.target.value })}
            />
            <Select
              value={g.projection}
              onChange={(e) => updateGsi(g.id, { projection: e.target.value as Gsi['projection'] })}
              title="Attributes copied into the index"
            >
              <option value="ALL">All attributes</option>
              <option value="KEYS_ONLY">Keys only</option>
            </Select>
            <Button
              variant="ghost"
              className="px-1"
              title="Remove index"
              onClick={() => setGsis(gsis.filter((x) => x.id !== g.id))}
            >
              <X size={14} />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <KeyInput value={g.pk} onChange={(k) => updateGsi(g.id, { pk: k })} placeholder="Partition key" />
            <KeyInput value={g.sk} onChange={(k) => updateGsi(g.id, { sk: k })} placeholder="Sort key (optional)" />
          </div>
        </div>
      ))}
      <ErrorBox error={error} />
    </Modal>
  )
}
