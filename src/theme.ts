import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ddb-browser.theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function load(): ThemePreference {
  const saved = localStorage.getItem(STORAGE_KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

let preference = load()

const current = (): Theme => (preference === 'system' ? (systemDark.matches ? 'dark' : 'light') : preference)

function apply() {
  document.documentElement.dataset.theme = current()
  for (const listener of listeners) listener()
}

// Follow the desktop setting as it changes, while the preference is "system".
systemDark.addEventListener('change', apply)
apply()

export function setThemePreference(next: ThemePreference) {
  preference = next
  if (next === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, next)
  apply()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The user's choice and the theme it currently resolves to. */
export function useTheme(): { preference: ThemePreference; theme: Theme } {
  const snapshot = useSyncExternalStore(subscribe, () => `${preference}:${current()}`)
  const [pref, theme] = snapshot.split(':') as [ThemePreference, Theme]
  return { preference: pref, theme }
}
