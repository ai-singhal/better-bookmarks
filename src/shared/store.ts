import { create } from 'zustand'
import type { BookmarkWithMetadata, OrganizationSuggestion } from './types'

interface BookmarkStore {
  // Bookmark tree
  bookmarkTree: BookmarkWithMetadata[]
  setBookmarkTree: (tree: BookmarkWithMetadata[]) => void

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchResults: BookmarkWithMetadata[]
  setSearchResults: (results: BookmarkWithMetadata[]) => void
  isSearching: boolean
  setIsSearching: (v: boolean) => void

  // Organization suggestions
  suggestions: OrganizationSuggestion[]
  setSuggestions: (s: OrganizationSuggestion[]) => void

  // UI state
  selectedBookmarkIds: Set<string>
  setSelectedBookmarkIds: (ids: Set<string>) => void
  toggleSelected: (id: string) => void
  clearSelected: () => void
  expandedFolders: Set<string>
  toggleFolder: (id: string) => void

  // Unprocessed count (new bookmarks needing metadata)
  unprocessedCount: number
  setUnprocessedCount: (n: number) => void

  // Dashboard active page
  activePage: string
  setActivePage: (page: string) => void
}

export const useBookmarkStore = create<BookmarkStore>((set) => ({
  bookmarkTree: [],
  setBookmarkTree: (tree) => set({ bookmarkTree: tree }),

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchResults: [],
  setSearchResults: (results) => set({ searchResults: results }),
  isSearching: false,
  setIsSearching: (v) => set({ isSearching: v }),

  suggestions: [],
  setSuggestions: (s) => set({ suggestions: s }),

  selectedBookmarkIds: new Set(),
  setSelectedBookmarkIds: (ids) => set({ selectedBookmarkIds: new Set(ids) }),
  toggleSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedBookmarkIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedBookmarkIds: next }
    }),
  clearSelected: () => set({ selectedBookmarkIds: new Set() }),

  expandedFolders: new Set(),
  toggleFolder: (id) =>
    set((state) => {
      const next = new Set(state.expandedFolders)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedFolders: next }
    }),

  unprocessedCount: 0,
  setUnprocessedCount: (n) => set({ unprocessedCount: n }),

  activePage: 'bookmarks',
  setActivePage: (page) => set({ activePage: page }),
}))
