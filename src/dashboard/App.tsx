import React from 'react'
import { useBookmarkStore } from '../shared/store'
import { Sidebar } from './components/Sidebar'
import { BookmarkTree } from './pages/BookmarkTree'
import { SemanticSearch } from './pages/SemanticSearch'
import { Organization } from './pages/Organization'
import { Reminders } from './pages/Reminders'
import { Settings } from './pages/Settings'

const pages: Record<string, React.FC> = {
  bookmarks: BookmarkTree,
  search: SemanticSearch,
  organize: Organization,
  reminders: Reminders,
  settings: Settings,
}

export function App() {
  const activePage = useBookmarkStore((s) => s.activePage)
  const PageComponent = pages[activePage] || BookmarkTree

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <PageComponent />
      </main>
    </div>
  )
}
