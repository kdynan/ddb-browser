import { Database } from 'lucide-react'
import { useState } from 'react'
import { type Conn, setConn } from './api.ts'
import { CreateTableDialog } from './components/CreateTableDialog.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { TableView } from './components/TableView.tsx'

const STORAGE_KEY = 'ddb-browser.conn'
const WIDTH_KEY = 'ddb-browser.sidebarWidth'
const DEFAULT_WIDTH = 256

function loadConn(): Conn {
  try {
    return { profile: '', region: 'us-east-1', endpoint: '', ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return { profile: '', region: 'us-east-1', endpoint: '' }
  }
}

export function App() {
  const [conn, setConnState] = useState(loadConn)
  const [table, setTable] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH)
  setConn(conn)
  const connKey = JSON.stringify(conn)

  const changeConn = (next: Conn) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setConnState(next)
    setTable(null)
  }

  const saveWidth = (width: number) => {
    localStorage.setItem(WIDTH_KEY, String(width))
    setSidebarWidth(width)
  }

  return (
    <div className="flex h-full">
      <Sidebar
        width={sidebarWidth}
        conn={conn}
        connKey={connKey}
        onConnChange={changeConn}
        selected={table}
        onSelect={setTable}
        onCreate={() => setCreating(true)}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize; double-click to reset"
        className="z-30 -mx-[3px] w-[6px] shrink-0 cursor-col-resize touch-none hover:bg-accent/60 active:bg-accent"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          setSidebarWidth(Math.round(Math.min(Math.max(e.clientX, 160), window.innerWidth - 320)))
        }}
        onPointerUp={() => saveWidth(sidebarWidth)}
        onDoubleClick={() => saveWidth(DEFAULT_WIDTH)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {table ? (
          <TableView key={`${connKey}/${table}`} name={table} connKey={connKey} onDeleted={() => setTable(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-dim">
            <Database size={36} strokeWidth={1.2} />
            <p>Select a table to browse its items</p>
          </div>
        )}
      </main>
      {creating && (
        <CreateTableDialog
          connKey={connKey}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false)
            setTable(name)
          }}
        />
      )}
    </div>
  )
}
