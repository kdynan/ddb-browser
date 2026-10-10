import { useQuery } from '@tanstack/react-query'
import { api } from '../api.ts'
import { Button, ErrorBox, Modal } from './ui.tsx'

const REPO_URL = 'https://github.com/kdynan/ddb-browser'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const runtime = useQuery({ queryKey: ['about'], queryFn: api.about })
  const r = runtime.data
  const rows: [string, string | undefined][] = [
    ['Version', __APP_VERSION__],
    ['Running as', r && (r.electron ? 'Desktop app' : 'Web app in your browser')],
    ['Electron', r?.electron],
    ['Chromium', r?.chrome],
    ['Node.js', r?.node],
    ['System', r?.os],
    ['AWS profiles from', r?.awsDir],
  ]
  return (
    <Modal title="About" onClose={onClose} width="w-[460px]" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10 shrink-0" />
        <div>
          <div className="text-base font-semibold">DDB Browser</div>
          <div className="text-dim">Search, edit and manage DynamoDB tables and items.</div>
        </div>
      </div>
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5">
        {rows.map(
          ([label, value]) =>
            value && (
              <div key={label} className="contents">
                <dt className="text-dim">{label}</dt>
                <dd className="font-mono break-all select-text">{value}</dd>
              </div>
            ),
        )}
      </dl>
      <ErrorBox error={runtime.error} />
      <p className="text-dim">
        Runs entirely on this machine and talks to AWS directly with your own credentials.{' '}
        <a className="text-accent hover:underline" href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>
    </Modal>
  )
}
