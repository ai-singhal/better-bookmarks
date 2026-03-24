import { useState, useEffect } from 'react'

interface SettingsState {
  autoSummarize: boolean
  showNotifications: boolean
  openaiApiKey: string
}

const defaultSettings: SettingsState = {
  autoSummarize: true,
  showNotifications: true,
  openaiApiKey: '',
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get('settings').then((data) => {
      if (data.settings) {
        setSettings({ ...defaultSettings, ...data.settings })
      }
    })
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
                  <p className="text-sm text-gray-200">
                    Auto-summarize new bookmarks
                  </p>
                  <p className="text-xs text-gray-500">
                    Generate AI summaries when you add a bookmark
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoSummarize}
                  onChange={(e) =>
                    updateSetting('autoSummarize', e.target.checked)
                  }
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                />
              </label>

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
                  Powers the Command tab. Uses gpt-4o-mini. Stored locally in Chrome sync storage.
                </p>
              </div>
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
