import { X } from 'lucide-react'
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ')

const field =
  'h-7 rounded border border-line bg-bg px-2 text-fg outline-none placeholder:text-dim/60 focus:border-accent disabled:opacity-50'

type Variant = 'default' | 'primary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  default: 'border-line bg-raised hover:bg-hover',
  primary: 'border-accent bg-accent text-white hover:brightness-110',
  danger: 'border-danger/60 bg-danger/15 text-danger hover:bg-danger/25',
  ghost: 'border-transparent hover:bg-hover text-dim hover:text-fg',
}

export function Button({ variant = 'default', className, ...props }: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded border px-2.5 whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className,
      )}
    />
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input spellCheck={false} autoComplete="off" {...props} className={cx(field, className)} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cx(field, 'pr-1', className)} />
}

export function Label({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[11px] tracking-wide text-dim uppercase">{label}</span>
      {children}
    </label>
  )
}

export function Badge({ children, tone = 'dim' }: { children: ReactNode; tone?: 'dim' | 'ok' | 'warn' }) {
  const tones = {
    dim: 'bg-raised text-dim',
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warn/15 text-warn',
  }
  return <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>
}

export function ErrorBox({ error, children }: { error: unknown; children?: ReactNode }) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-danger"
    >
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        {error instanceof Error ? error.message : String(error)}
      </span>
      {children}
    </div>
  )
}

/** A destructive button that needs a second click within a few seconds to fire. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Click again to confirm',
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick'> & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <Button
      variant="danger"
      {...props}
      onClick={() => {
        if (armed) onConfirm()
        setArmed(!armed)
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'w-[520px]',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className={cx('flex max-h-full max-w-full flex-col rounded-lg border border-line bg-panel shadow-2xl', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" className="px-1" onClick={onClose} aria-label="Close">
            <X size={15} />
          </Button>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}
