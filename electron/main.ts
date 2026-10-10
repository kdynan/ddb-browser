// Desktop entry point: runs the server in-process and shows the UI in a window.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { startServer } from '../server/app.ts'

// A fixed port keeps the page's origin, and so its saved settings, the same between launches.
const PREFERRED_PORT = 24577

const sizeFile = () => path.join(app.getPath('userData'), 'window.json')

function savedSize(): { width?: number; height?: number } {
  try {
    const { width, height } = JSON.parse(readFileSync(sizeFile(), 'utf8'))
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : {}
  } catch {
    return {}
  }
}

function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    ...savedSize(),
    minWidth: 800,
    minHeight: 500,
    title: 'DDB Browser',
    // Shown for a moment before the page paints; matches the page background.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111318' : '#f5f6f8',
    autoHideMenuBar: true,
    show: false,
  })
  win.once('ready-to-show', () => win.show())
  win.on('close', () => {
    const { width, height } = win.getNormalBounds()
    try {
      writeFileSync(sizeFile(), JSON.stringify({ width, height }))
    } catch {
      // Not being able to remember the size shouldn't stop the window closing.
    }
  })
  // Links go to the system browser rather than opening inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })
  win.loadURL(url)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on('window-all-closed', () => app.quit())

  app
    .whenReady()
    .then(async () => {
      const staticDir = path.join(app.getAppPath(), 'dist')
      const port = await startServer({ port: PREFERRED_PORT, staticDir }).catch(() =>
        startServer({ port: 0, staticDir }),
      )
      createWindow(`http://127.0.0.1:${port}`)
    })
    .catch((err) => {
      dialog.showErrorBox('DDB Browser failed to start', String(err?.stack ?? err))
      app.quit()
    })
}
