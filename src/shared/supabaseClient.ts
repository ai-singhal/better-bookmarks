import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let supabaseInstance: SupabaseClient | null = null

interface ExtensionSettings {
  supabaseUrl?: string
  supabaseAnonKey?: string
  autoSummarize?: boolean
  showNotifications?: boolean
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (supabaseInstance) return supabaseInstance

  const data = await chrome.storage.sync.get('settings')
  const settings = (data.settings || {}) as ExtensionSettings

  if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
    console.warn('[Supabase] Not configured — set URL and anon key in Settings')
    return null
  }

  supabaseInstance = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
    auth: {
      storage: {
        getItem: async (key: string): Promise<string | null> => {
          const result = await chrome.storage.local.get(key)
          return (result[key] as string) ?? null
        },
        setItem: async (key: string, value: string) => {
          await chrome.storage.local.set({ [key]: value })
        },
        removeItem: async (key: string) => {
          await chrome.storage.local.remove(key)
        },
      },
      autoRefreshToken: true,
      persistSession: true,
    },
  })

  return supabaseInstance
}

export function resetSupabaseClient() {
  supabaseInstance = null
}
