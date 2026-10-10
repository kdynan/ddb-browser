// Entry point for running in a browser (`npm start`, `npm run dev`).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './app.ts'

// The built UI is served when it exists; in dev, Vite serves it instead.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const hasUi = existsSync(dist)

const port = await startServer({
  port: Number(process.env.PORT ?? 4577),
  host: process.env.HOST,
  staticDir: hasUi ? dist : undefined,
})
console.log(`DDB Browser ${hasUi ? 'running at' : 'API listening on'} http://localhost:${port}`)
