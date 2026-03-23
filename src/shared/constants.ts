export const STORAGE_KEYS = {
  SUPABASE_SESSION: 'supabase_session',
  DEVICE_BOOKMARK_MAP: 'device_bookmark_map',
  SETTINGS: 'settings',
  UNPROCESSED_COUNT: 'unprocessed_count',
} as const

export const ALARM_NAMES = {
  REMINDER_PREFIX: 'reminder_',
  BATCH_PROCESS: 'batch_process_embeddings',
  SYNC_CHECK: 'sync_check',
} as const

export const DASHBOARD_URL = 'src/dashboard/index.html'

export const DEFAULT_SETTINGS = {
  autoSummarize: true,
  showNotifications: true,
  aiProvider: 'claude' as const,
}
