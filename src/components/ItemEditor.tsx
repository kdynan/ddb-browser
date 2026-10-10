import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter } from '@codemirror/lint'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { Copy, Pilcrow, Save, Trash2, WrapText, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Item, TableDesc } from '../../shared/types.ts'
import { ApiError, api } from '../api.ts'
import { convertNewlines, fromPlainItem, isLossyItem, keyString, pickKey, toPlainItem } from '../ddb.ts'
import { Button, ConfirmButton, ErrorBox } from './ui.tsx'

type Format = 'plain' | 'ddb'

interface Props {
  table: TableDesc
  /** The item to edit, or null to create a new one. */
  item: Item | null
  /** Attribute to scroll to when the editor opens (the cell that was clicked). */
  focusAttr?: string
  onClose: () => void
  onSaved: (item: Item, originalId: string | null) => void
  onDeleted: (id: string) => void
}

const WRAP_KEY = 'ddb-browser.editor.wrap'
const BREAKS_KEY = 'ddb-browser.editor.lineBreaks'

const stringify = (item: Item, format: Format) =>
  JSON.stringify(format === 'plain' ? toPlainItem(item) : item, null, 2)

function parse(text: string, format: Format): Item {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('An item must be a JSON object')
  }
  return format === 'plain' ? fromPlainItem(value) : value
}

export function ItemEditor({ table, item, focusAttr, onClose, onSaved, onDeleted }: Props) {
  const keys = useMemo(() => table.KeySchema.map((k) => k.AttributeName), [table])
  // A duplicated item is edited as a new one, so track the original separately.
  const [original, setOriginal] = useState(item)
  const template = useMemo<Item>(
    () =>
      Object.fromEntries(
        keys.map((k) => {
          const type = table.AttributeDefinitions.find((d) => d.AttributeName === k)?.AttributeType
          return [k, type === 'N' ? { N: '0' } : type === 'B' ? { B: '' } : { S: '' }]
        }),
      ),
    [keys, table],
  )
  const initial = item ?? template
  // Sets, binary and very large numbers have no plain-JSON form.
  const lossy = isLossyItem(initial)
  const [format, setFormat] = useState<Format>(lossy ? 'ddb' : 'plain')
  const [wrap, setWrap] = useState(() => localStorage.getItem(WRAP_KEY) === '1')
  const [lineBreaks, setLineBreaks] = useState(() => localStorage.getItem(BREAKS_KEY) === '1')
  // What the editor shows for an item, and the JSON behind what the editor shows.
  // Attributes are listed like the grid's columns: keys first, then alphabetically.
  const ordered = (value: Item): Item => {
    const rest = Object.keys(value)
      .filter((k) => !keys.includes(k))
      .sort((a, b) => a.localeCompare(b))
    return Object.fromEntries([...keys.filter((k) => k in value), ...rest].map((k) => [k, value[k]]))
  }
  const display = (value: Item, f: Format) => {
    const text = stringify(ordered(value), f)
    return lineBreaks ? convertNewlines(text, 'breaks') : text
  }
  const toJson = (shown: string) => (lineBreaks ? convertNewlines(shown, 'json') : shown)
  const [text, setText] = useState(() => display(initial, lossy ? 'ddb' : 'plain'))
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [confirmMove, setConfirmMove] = useState(false)

  const originalId = original && keyString(original, keys)
  const dirty = text !== display(original ?? template, format)
  // Strings spanning several lines aren't valid JSON, so highlighting and linting are off in that view.
  const extensions = useMemo(
    () => [...(lineBreaks ? [] : [json(), linter(jsonParseLinter())]), ...(wrap || lineBreaks ? [EditorView.lineWrapping] : [])],
    [wrap, lineBreaks],
  )

  const toggleWrap = () => {
    localStorage.setItem(WRAP_KEY, wrap ? '0' : '1')
    setWrap(!wrap)
  }
  const toggleLineBreaks = () => {
    localStorage.setItem(BREAKS_KEY, lineBreaks ? '0' : '1')
    setText(convertNewlines(text, lineBreaks ? 'json' : 'breaks'))
    setLineBreaks(!lineBreaks)
  }

  const switchFormat = (next: Format) => {
    if (next === format) return
    try {
      const parsed = parse(toJson(text), format)
      if (next === 'plain' && isLossyItem(parsed)) {
        throw new Error('This item has sets, binary or high-precision numbers, which need DynamoDB JSON')
      }
      setText(display(parsed, next))
      setFormat(next)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }

  const save = async (overwrite = false) => {
    setError(null)
    let parsed: Item
    try {
      parsed = parse(toJson(text), format)
    } catch (e) {
      setError(e)
      return
    }
    const moved = originalId !== null && keyString(parsed, keys) !== originalId
    if (moved && !confirmMove) {
      setConfirmMove(true)
      return
    }
    setBusy(true)
    try {
      await api.putItem(table.TableName, {
        item: parsed,
        originalKey: original ? pickKey(original, keys) : undefined,
        overwrite,
      })
      onSaved(parsed, originalId)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!original || !originalId) return
    setBusy(true)
    try {
      await api.deleteItems(table.TableName, [pickKey(original, keys)])
      onDeleted(originalId)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onMouseDown={onClose}>
      <div
        className="flex h-full w-[640px] max-w-full flex-col border-l border-line bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            if (!busy) save()
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <h2 className="text-sm font-semibold">{original ? 'Edit item' : 'New item'}</h2>
          <Button
            variant="ghost"
            className={`ml-auto ${wrap || lineBreaks ? 'bg-hover text-fg' : ''}`}
            disabled={lineBreaks}
            aria-pressed={wrap || lineBreaks}
            title="Wrap long lines instead of scrolling sideways"
            onClick={toggleWrap}
          >
            <WrapText size={14} /> Wrap
          </Button>
          <Button
            variant="ghost"
            className={lineBreaks ? 'bg-hover text-fg' : ''}
            aria-pressed={lineBreaks}
            title="Show \n inside strings as real line breaks (still editable)"
            onClick={toggleLineBreaks}
          >
            <Pilcrow size={14} /> Line breaks
          </Button>
          <div className="flex overflow-hidden rounded border border-line">
            {(
              [
                ['plain', 'JSON'],
                ['ddb', 'DynamoDB JSON'],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                onClick={() => switchFormat(id)}
                className={`h-[26px] px-2.5 ${format === id ? 'bg-accent text-white' : 'bg-raised hover:bg-hover'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" className="px-1" onClick={onClose} aria-label="Close">
            <X size={15} />
          </Button>
        </div>

        <div className="relative min-h-0 flex-1">
          <CodeMirror
            className="absolute inset-0"
            autoFocus
            value={text}
            height="100%"
            theme="dark"
            extensions={extensions}
            onCreateEditor={(view) => {
              const at = focusAttr === undefined ? -1 : text.indexOf(`\n  ${JSON.stringify(focusAttr)}:`)
              if (at < 0) return
              view.dispatch({
                selection: { anchor: at + 3 },
                effects: EditorView.scrollIntoView(at + 3, { y: 'start', yMargin: 8 }),
              })
            }}
            onChange={(value) => {
              setText(value)
              setConfirmMove(false)
            }}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-4 py-2.5">
          {confirmMove && (
            <p className="text-amber-400">
              The key changed. Keys can't be updated in place, so saving will create a new item and delete the
              original. Save again to confirm.
            </p>
          )}
          <ErrorBox error={error}>
            {error instanceof ApiError && error.status === 409 && (
              <Button variant="danger" onClick={() => save(true)}>
                Overwrite
              </Button>
            )}
          </ErrorBox>
          <div className="flex items-center gap-2">
            {original && (
              <>
                <ConfirmButton disabled={busy} onConfirm={remove}>
                  <Trash2 size={13} /> Delete
                </ConfirmButton>
                <Button
                  disabled={busy}
                  title="Edit a copy as a new item; change the key before saving"
                  onClick={() => {
                    setOriginal(null)
                    setConfirmMove(false)
                    setError(null)
                  }}
                >
                  <Copy size={13} /> Duplicate
                </Button>
              </>
            )}
            <span className="ml-auto text-dim">{dirty ? 'Unsaved changes' : ''}</span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || (!dirty && !!original)} onClick={() => save()}>
              <Save size={13} /> {confirmMove ? 'Confirm save' : original ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
