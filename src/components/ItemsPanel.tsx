import { Download, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FilterOp, Item, SortKeyOp, TableDesc, ValueType } from '../../shared/types.ts'
import { api } from '../api.ts'
import { keyString, kind, pickKey, preview, toPlainItem } from '../ddb.ts'
import { ItemEditor } from './ItemEditor.tsx'
import { Button, ConfirmButton, ErrorBox, Input, Select } from './ui.tsx'

interface FilterRow {
  id: number
  attr: string
  type: ValueType
  op: FilterOp
  value: string
  value2: string
}

const SK_OPS: SortKeyOp[] = ['=', '<', '<=', '>', '>=', 'begins_with', 'between']
const FILTER_OPS: [FilterOp, string][] = [
  ['=', '='],
  ['<>', '≠'],
  ['<', '<'],
  ['<=', '<='],
  ['>', '>'],
  ['>=', '>='],
  ['begins_with', 'begins with'],
  ['contains', 'contains'],
  ['not_contains', 'not contains'],
  ['between', 'between'],
  ['exists', 'exists'],
  ['not_exists', 'not exists'],
]
const FILTER_TYPES: [ValueType, string][] = [
  ['S', 'String'],
  ['N', 'Number'],
  ['BOOL', 'Boolean'],
  ['NULL', 'Null'],
]

const cellTone: Partial<Record<string, string>> = {
  N: 'text-number',
  BOOL: 'text-boolean',
  NULL: 'text-dim italic',
  M: 'text-dim',
  L: 'text-dim',
}

export function ItemsPanel({ table }: { table: TableDesc }) {
  const name = table.TableName
  const tableKeys = useMemo(() => table.KeySchema.map((k) => k.AttributeName), [table])
  const indexes = useMemo(
    () => [...(table.GlobalSecondaryIndexes ?? []), ...(table.LocalSecondaryIndexes ?? [])],
    [table],
  )

  const [mode, setMode] = useState<'scan' | 'query'>('scan')
  const [index, setIndex] = useState('')
  const [pkValue, setPkValue] = useState('')
  const [skOp, setSkOp] = useState<SortKeyOp>('=')
  const [skValue, setSkValue] = useState('')
  const [skValue2, setSkValue2] = useState('')
  const [descending, setDescending] = useState(false)
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [limit, setLimit] = useState(100)

  const [items, setItems] = useState<Item[]>([])
  const [lastKey, setLastKey] = useState<Item | undefined>()
  const [stats, setStats] = useState<{ scanned: number; capacity: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [quick, setQuick] = useState('')
  // undefined = closed, null = new item
  const [editing, setEditing] = useState<Item | null | undefined>()
  const [focusAttr, setFocusAttr] = useState<string | undefined>()
  const nextFilterId = useRef(1)

  const keySchema = (indexes.find((i) => i.IndexName === index) ?? table).KeySchema
  const pkName = keySchema.find((k) => k.KeyType === 'HASH')!.AttributeName
  const skName = keySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName
  const typeOf = (attr: string) => table.AttributeDefinitions.find((d) => d.AttributeName === attr)?.AttributeType ?? 'S'

  const run = async (more = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.query(name, {
        mode,
        index: index || undefined,
        pk: mode === 'query' ? { name: pkName, type: typeOf(pkName), value: pkValue } : undefined,
        sk:
          mode === 'query' && skName && skValue !== ''
            ? { name: skName, type: typeOf(skName), op: skOp, value: skValue, value2: skValue2 }
            : undefined,
        filters: filters
          .filter((f) => f.attr.trim())
          .map(({ attr, type, op, value, value2 }) => ({ attr, type, op, value, value2 })),
        limit,
        descending,
        startKey: more ? lastKey : undefined,
      })
      setItems((prev) => (more ? [...prev, ...res.items] : res.items))
      setLastKey(res.lastKey)
      setStats((prev) =>
        more && prev
          ? { scanned: prev.scanned + res.scanned, capacity: prev.capacity + res.capacity }
          : { scanned: res.scanned, capacity: res.capacity },
      )
      if (!more) setSelected(new Set())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  // Load the first page when the table opens.
  useEffect(() => {
    run()
  }, [])

  const columns = useMemo(() => {
    const leading = [...tableKeys]
    for (const k of keySchema) if (!leading.includes(k.AttributeName)) leading.push(k.AttributeName)
    const rest = new Set<string>()
    for (const item of items) for (const attr of Object.keys(item)) if (!leading.includes(attr)) rest.add(attr)
    return [...leading, ...[...rest].sort((a, b) => a.localeCompare(b))]
  }, [items, tableKeys, keySchema])

  const needle = quick.trim().toLowerCase()
  const visible = useMemo(
    () => (needle ? items.filter((i) => JSON.stringify(toPlainItem(i)).toLowerCase().includes(needle)) : items),
    [items, needle],
  )
  const idOf = (item: Item) => keyString(item, tableKeys)
  const allSelected = visible.length > 0 && visible.every((i) => selected.has(idOf(i)))

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }

  const deleteSelected = async () => {
    setLoading(true)
    setError(null)
    try {
      const doomed = items.filter((i) => selected.has(idOf(i)))
      await api.deleteItems(
        name,
        doomed.map((i) => pickKey(i, tableKeys)),
      )
      setItems(items.filter((i) => !selected.has(idOf(i))))
      setSelected(new Set())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(visible, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const updateFilter = (id: number, patch: Partial<FilterRow>) =>
    setFilters(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && !loading && run()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-2.5" onKeyDown={onEnter}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded border border-line">
            {(['scan', 'query'] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={`h-[26px] px-3 capitalize ${mode === m ? 'bg-accent text-white' : 'bg-raised hover:bg-hover'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <Select value={index} onChange={(e) => setIndex(e.target.value)} title="Table or index to read">
            <option value="">Table</option>
            {indexes.map((i) => (
              <option key={i.IndexName} value={i.IndexName}>
                Index: {i.IndexName}
              </option>
            ))}
          </Select>
          {mode === 'query' && (
            <>
              <span className="font-mono text-dim">{pkName} =</span>
              <Input
                autoFocus
                className="w-52"
                placeholder={`Partition key (${typeOf(pkName)})`}
                value={pkValue}
                onChange={(e) => setPkValue(e.target.value)}
              />
              {skName && (
                <>
                  <span className="font-mono text-dim">{skName}</span>
                  <Select value={skOp} onChange={(e) => setSkOp(e.target.value as SortKeyOp)}>
                    {SK_OPS.map((op) => (
                      <option key={op} value={op}>
                        {op.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                  <Input
                    className="w-44"
                    placeholder={`Sort key (${typeOf(skName)}), optional`}
                    value={skValue}
                    onChange={(e) => setSkValue(e.target.value)}
                  />
                  {skOp === 'between' && (
                    <Input
                      className="w-44"
                      placeholder="and"
                      value={skValue2}
                      onChange={(e) => setSkValue2(e.target.value)}
                    />
                  )}
                </>
              )}
              <Select
                value={descending ? 'desc' : 'asc'}
                onChange={(e) => setDescending(e.target.value === 'desc')}
                title="Sort key order"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </Select>
            </>
          )}
        </div>

        {filters.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-right text-dim">where</span>
            <Input
              className="w-48 font-mono"
              placeholder="attribute or path.to.attr"
              value={f.attr}
              onChange={(e) => updateFilter(f.id, { attr: e.target.value })}
            />
            <Select value={f.op} onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOp })}>
              {FILTER_OPS.map(([op, label]) => (
                <option key={op} value={op}>
                  {label}
                </option>
              ))}
            </Select>
            {f.op !== 'exists' && f.op !== 'not_exists' && (
              <>
                <Select value={f.type} onChange={(e) => updateFilter(f.id, { type: e.target.value as ValueType })}>
                  {FILTER_TYPES.map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </Select>
                {f.type === 'BOOL' ? (
                  <Select value={f.value || 'true'} onChange={(e) => updateFilter(f.id, { value: e.target.value })}>
                    <option>true</option>
                    <option>false</option>
                  </Select>
                ) : (
                  f.type !== 'NULL' && (
                    <Input
                      className="w-52"
                      placeholder="value"
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    />
                  )
                )}
                {f.op === 'between' && (
                  <Input
                    className="w-52"
                    placeholder="and"
                    value={f.value2}
                    onChange={(e) => updateFilter(f.id, { value2: e.target.value })}
                  />
                )}
              </>
            )}
            <Button
              variant="ghost"
              className="px-1"
              title="Remove filter"
              onClick={() => setFilters(filters.filter((x) => x.id !== f.id))}
            >
              <X size={14} />
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={loading} onClick={() => run()}>
            <Play size={12} fill="currentColor" /> Run
          </Button>
          <Button
            onClick={() =>
              setFilters([
                ...filters,
                { id: nextFilterId.current++, attr: '', type: 'S', op: '=', value: '', value2: '' },
              ])
            }
          >
            <Plus size={13} /> Filter
          </Button>
          <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} title="Items per page">
            {[25, 50, 100, 250, 500, 1000].map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </Select>
          <div className="mx-1 h-4 w-px bg-line" />
          <Button
            onClick={() => {
              setFocusAttr(undefined)
              setEditing(null)
            }}
          >
            <Plus size={13} /> New item
          </Button>
          {selected.size > 0 && (
            <ConfirmButton
              disabled={loading}
              onConfirm={deleteSelected}
              confirmLabel={`Confirm: delete ${selected.size} item${selected.size > 1 ? 's' : ''}`}
            >
              <Trash2 size={13} /> Delete {selected.size}
            </ConfirmButton>
          )}
          <Input
            className="ml-auto w-56"
            placeholder="Find in loaded items"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Button variant="ghost" className="px-1.5" title="Export shown items as DynamoDB JSON" onClick={exportJson}>
            <Download size={14} />
          </Button>
        </div>
        <ErrorBox error={error} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 font-mono text-[12px]">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 w-8 border-r border-b border-line bg-raised px-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map(idOf)))}
                />
              </th>
              {columns.map((c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 border-r border-b border-line bg-raised px-2.5 py-1.5 text-left font-medium whitespace-nowrap"
                >
                  {c}
                  {tableKeys.includes(c) && (
                    <span className="ml-1.5 font-sans text-[10px] text-accent">{c === tableKeys[0] ? 'PK' : 'SK'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const id = idOf(item)
              const isSelected = selected.has(id)
              return (
                <tr
                  key={id}
                  onClick={() => setEditing(item)}
                  className={`cursor-pointer ${isSelected ? 'bg-accent/15' : 'hover:bg-hover/60'}`}
                >
                  <td
                    className="sticky left-0 border-r border-b border-line/60 bg-bg px-2 text-center"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(id)
                    }}
                  >
                    <input type="checkbox" aria-label="Select item" checked={isSelected} readOnly />
                  </td>
                  {columns.map((c) => {
                    const av = item[c]
                    return (
                      <td
                        key={c}
                        onClick={() => setFocusAttr(c)}
                        className={`max-w-80 truncate border-r border-b border-line/60 px-2.5 py-1 ${
                          av ? (cellTone[kind(av)] ?? '') : ''
                        }`}
                        title={av && preview(av)}
                      >
                        {av ? preview(av) : ''}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loading && !error && visible.length === 0 && (
          <p className="p-8 text-center text-dim">
            {items.length ? 'No loaded items match' : lastKey ? 'No matches yet — keep loading to scan further' : 'No items'}
          </p>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-line bg-panel px-4 py-1.5 text-dim">
        <span>
          {loading
            ? 'Loading…'
            : `${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'} loaded${
                needle ? ` · ${visible.length.toLocaleString()} shown` : ''
              }`}
        </span>
        {stats && !loading && (
          <span>
            {stats.scanned.toLocaleString()} scanned · {stats.capacity.toLocaleString()} RCU
          </span>
        )}
        {lastKey ? (
          <Button className="ml-auto" disabled={loading} onClick={() => run(true)}>
            Load more
          </Button>
        ) : (
          <span className="ml-auto">{stats && !loading ? 'End of results' : ''}</span>
        )}
      </footer>

      {editing !== undefined && (
        <ItemEditor
          key={editing ? idOf(editing) : 'new'}
          table={table}
          item={editing}
          focusAttr={focusAttr}
          onClose={() => setEditing(undefined)}
          onSaved={(saved, originalId) => {
            const savedId = idOf(saved)
            const without = items.filter((i) => idOf(i) !== savedId || idOf(i) === originalId)
            setItems(
              originalId && without.some((i) => idOf(i) === originalId)
                ? without.map((i) => (idOf(i) === originalId ? saved : i))
                : [saved, ...without],
            )
            setEditing(undefined)
          }}
          onDeleted={(id) => {
            setItems(items.filter((i) => idOf(i) !== id))
            setEditing(undefined)
          }}
        />
      )}
    </div>
  )
}
