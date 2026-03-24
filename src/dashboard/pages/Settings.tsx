import { useState, useEffect } from 'react'
import { DEFAULT_OPENAI_MODEL, OPENAI_MODELS } from '../../lib/openaiService'
import {
  createBookmarkTreeSnapshot,
  deleteBookmarkTreeSnapshot,
  listBookmarkTreeSnapshots,
  restoreBookmarkTreeSnapshot,
} from '../../lib/bookmarkSnapshotService'
import type { BookmarkTreeSnapshotSummary } from '../../shared/types'
import { formatRelativeDate } from '../../shared/utils'

interface SettingsState {
  showNotifications: boolean
  openaiApiKey: string
  openaiModel: string
}

const defaultSettings: SettingsState = {
  showNotifications: true,
  openaiApiKey: '',
  openaiModel: DEFAULT_OPENAI_MODEL,
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [snapshots, setSnapshots] = useState<BookmarkTreeSnapshotSummary[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(true)
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [creatingSnapshot, setCreatingSnapshot] = useState(false)
  const [workingSnapshotId, setWorkingSnapshotId] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.sync.get('settings').then((data) => {
      if (data.settings) {
        setSettings({ ...defaultSettings, ...data.settings })
      }
    })

    listBookmarkTreeSnapshots()
      .then((items) => setSnapshots(items))
      .catch((err) => {
        setSnapshotError(err instanceof Error ? err.message : 'Failed to load snapshots.')
      })
      .finally(() => setLoadingSnapshots(false))
  }, [])

  const handleSave = async () => {
    await chrome.storage.sync.set({ settings })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const updateSetting = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const refreshSnapshots = async () => {
    const items = await listBookmarkTreeSnapshots()
    setSnapshots(items)
  }

  const handleCreateSnapshot = async () => {
    setSnapshotError(null)
    setSnapshotMessage(null)
    setCreatingSnapshot(true)
    try {
      const snapshot = await createBookmarkTreeSnapshot()
      await refreshSnapshots()
      setSnapshotMessage(`Saved snapshot from ${new Date(snapshot.createdAt).toLocaleString()}.`)
    } catch (err) {
      setSnapshotError(
        err instanceof Error
          ? err.message
          : 'Failed to save snapshot to your Chrome account.'
      )
    } finally {
      setCreatingSnapshot(false)
    }
  }

  const handleRestoreSnapshot = async (snapshot: BookmarkTreeSnapshotSummary) => {
    const confirmed = window.confirm(
      `Restore the snapshot from ${new Date(snapshot.createdAt).toLocaleString()}? This will replace your current bookmark tree in Bookmarks Bar, Other Bookmarks, and Mobile Bookmarks.`
    )
    if (!confirmed) return

    setSnapshotError(null)
    setSnapshotMessage(null)
    setWorkingSnapshotId(snapshot.id)
    try {
      await restoreBookmarkTreeSnapshot(snapshot.id)
      setSnapshotMessage(`Restored snapshot from ${new Date(snapshot.createdAt).toLocaleString()}.`)
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : 'Failed to restore snapshot.')
    } finally {
      setWorkingSnapshotId(null)
    }
  }

  const handleDeleteSnapshot = async (snapshot: BookmarkTreeSnapshotSummary) => {
    const confirmed = window.confirm(
      `Delete the snapshot from ${new Date(snapshot.createdAt).toLocaleString()}?`
    )
    if (!confirmed) return

    setSnapshotError(null)
    setSnapshotMessage(null)
    setWorkingSnapshotId(snapshot.id)
    try {
      await deleteBookmarkTreeSnapshot(snapshot.id)
      await refreshSnapshots()
      setSnapshotMessage(`Deleted snapshot from ${new Date(snapshot.createdAt).toLocaleString()}.`)
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : 'Failed to delete snapshot.')
    } finally {
      setWorkingSnapshotId(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800">
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Configure Better Bookmarks
        </p>
      </div>

      {/* Settings Form */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-lg space-y-6">
          {/* General */}
          <section>
            <h3 className="text-sm font-medium text-gray-300 mb-3">General</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                <div>
                  <p className="text-sm text-gray-200">Show notifications</p>
                  <p className="text-xs text-gray-500">
                    Get notified about reminders
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showNotifications}
                  onChange={(e) =>
                    updateSetting('showNotifications', e.target.checked)
                  }
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            </div>
          </section>

          {/* AI Configuration */}
          <section>
            <h3 className="text-sm font-medium text-gray-300 mb-3">
              AI Configuration
            </h3>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                <label className="block text-sm text-gray-200 mb-1.5">
                  OpenAI API Key
                </label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.openaiApiKey}
                    onChange={(e) =>
                      updateSetting('openaiApiKey', e.target.value)
                    }
                    placeholder="sk-..."
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="px-3 py-2 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md hover:bg-gray-800 transition-colors"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-gray-600 mt-1.5">
                  Stored locally in Chrome sync storage. Never sent anywhere except OpenAI.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                <label className="block text-sm text-gray-200 mb-1.5">
                  Model
                </label>
                <select
                  value={settings.openaiModel}
                  onChange={(e) => updateSetting('openaiModel', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-100 focus:outline-none focus:border-indigo-500 appearance-none cursor-pointer"
                >
                  {OPENAI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} — {model.description}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1.5">
                  Curated current OpenAI API text models for this workflow. Also changeable from the AI Chat header.
                </p>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3 gap-3">
              <div>
                <h3 className="text-sm font-medium text-gray-300">Tree Snapshots</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Save full bookmark-tree snapshots to Chrome sync so you can roll back later. The extension keeps the 3 most recent snapshots.
                </p>
              </div>
              <button
                onClick={() => void handleCreateSnapshot()}
                disabled={creatingSnapshot}
                className="px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors flex-shrink-0"
              >
                {creatingSnapshot ? 'Saving...' : 'Create Snapshot'}
              </button>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
              <p className="text-xs text-amber-300/80">
                Restoring a snapshot replaces the current contents of your Bookmarks Bar, Other Bookmarks, and Mobile Bookmarks.
              </p>

              {snapshotMessage && (
                <p className="text-xs text-emerald-400 mt-3">{snapshotMessage}</p>
              )}
              {snapshotError && (
                <p className="text-xs text-red-400 mt-3">{snapshotError}</p>
              )}

              {loadingSnapshots ? (
                <p className="text-xs text-gray-500 mt-3">Loading snapshots...</p>
              ) : snapshots.length === 0 ? (
                <p className="text-xs text-gray-500 mt-3">No snapshots yet.</p>
              ) : (
                <div className="space-y-2 mt-3">
                  {snapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950/70 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-gray-200 truncate">{snapshot.label}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {snapshot.bookmarkCount} bookmarks • {snapshot.folderCount} folders • saved {formatRelativeDate(snapshot.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => void handleRestoreSnapshot(snapshot)}
                          disabled={workingSnapshotId === snapshot.id}
                          className="px-2.5 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors"
                        >
                          {workingSnapshotId === snapshot.id ? 'Working...' : 'Restore'}
                        </button>
                        <button
                          onClick={() => void handleDeleteSnapshot(snapshot)}
                          disabled={workingSnapshotId === snapshot.id}
                          className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded-md hover:bg-gray-800 disabled:text-gray-600 disabled:border-gray-800 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Save */}
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
