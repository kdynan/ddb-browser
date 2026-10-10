import { useQuery } from '@tanstack/react-query'
import { Plus, RefreshCw, Table2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LOCAL_PROFILE } from '../../shared/types.ts'
import { api, type Conn } from '../api.ts'
import { Button, ErrorBox, Input, Label, Select } from './ui.tsx'

const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'ca-west-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-east-1',
  'me-south-1',
  'me-central-1',
  'af-south-1',
  'il-central-1',
]

interface Props {
  width: number
  conn: Conn
  connKey: string
  onConnChange: (c: Conn) => void
  selected: string | null
  onSelect: (name: string) => void
  onCreate: () => void
}

export function Sidebar({ width, conn, connKey, onConnChange, selected, onSelect, onCreate }: Props) {
  const [search, setSearch] = useState('')
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles, refetchOnWindowFocus: true })
  const tables = useQuery({
    queryKey: ['tables', connKey],
    queryFn: api.tables,
    enabled: !!conn.profile && !!conn.region,
    // Clears a stale error (expired SSO session, server restart) when you come back to the app.
    refetchOnWindowFocus: true,
  })

  // First run: pick the first available profile.
  useEffect(() => {
    const first = profiles.data?.[0]
    if (!conn.profile && first) onConnChange({ ...conn, profile: first.name, region: first.region ?? conn.region })
  }, [profiles.data, conn, onConnChange])

  const needle = search.trim().toLowerCase()
  const visible = (tables.data ?? []).filter((t) => t.toLowerCase().includes(needle))

  return (
    <aside className="flex shrink-0 flex-col border-r border-line bg-panel" style={{ width }}>
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <Label label="Profile">
          <Select
            value={conn.profile}
            onChange={(e) => {
              const p = profiles.data?.find((x) => x.name === e.target.value)
              onConnChange({ ...conn, profile: e.target.value, region: p?.region ?? conn.region })
            }}
          >
            {profiles.data?.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name === LOCAL_PROFILE ? 'DynamoDB Local' : p.name}
              </option>
            ))}
          </Select>
        </Label>
        <Label label="Region">
          <Input
            list="regions"
            defaultValue={conn.region}
            key={conn.region}
            onBlur={(e) => {
              const region = e.target.value.trim()
              if (region && region !== conn.region) onConnChange({ ...conn, region })
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <datalist id="regions">
            {REGIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Label>
        {conn.profile === LOCAL_PROFILE && (
          <Label label="Endpoint">
            <Input
              placeholder="http://localhost:8000"
              defaultValue={conn.endpoint}
              onBlur={(e) => {
                const endpoint = e.target.value.trim()
                if (endpoint !== conn.endpoint) onConnChange({ ...conn, endpoint })
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Label>
        )}
      </div>

      <div className="flex items-center gap-1 p-2">
        <Input
          className="min-w-0 flex-1"
          placeholder={`Filter ${tables.data?.length ?? ''} tables`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="ghost" className="px-1.5" title="Refresh tables" onClick={() => tables.refetch()}>
          <RefreshCw size={14} className={tables.isFetching ? 'animate-spin' : ''} />
        </Button>
        <Button variant="ghost" className="px-1.5" title="Create table" onClick={onCreate}>
          <Plus size={15} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {tables.error && (
          <div className="p-1">
            <ErrorBox error={tables.error} />
          </div>
        )}
        {visible.map((t) => (
          <button
            type="button"
            key={t}
            title={t}
            onClick={() => onSelect(t)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover ${
              t === selected ? 'bg-accent/20 text-white' : ''
            }`}
          >
            <Table2 size={13} className="shrink-0 text-dim" />
            <span className="truncate">{t}</span>
          </button>
        ))}
        {tables.isSuccess && visible.length === 0 && (
          <p className="p-3 text-center text-dim">{needle ? 'No matching tables' : 'No tables in this region'}</p>
        )}
      </div>
    </aside>
  )
}
