export interface BookmarkMetadata {
  id: string
  chromeBookmarkId: string
  url: string
  purpose?: string
  tags: string[]
  summary?: string
  addedAt: string
  lastVisitedAt?: string
  lookAtLater: boolean
  reminderAt?: string
  reminderNote?: string
  sourceDevice?: string
  isProcessed: boolean
  createdAt: string
  updatedAt: string
}

export interface BookmarkInsight {
  bookmarkId: string
  reason: string
  tags: string[]
  summary?: string
  reminderAt?: string
  reminderNote?: string
  recurring?: 'daily' | 'weekly' | 'monthly' | null
  createdAt: string
  updatedAt: string
}

export interface BookmarkReminderRecord {
  bookmarkId: string
  title: string
  url: string
  note: string
  remindAt: string
  recurring?: 'daily' | 'weekly' | 'monthly' | null
  createdAt: string
  updatedAt: string
}

export interface BookmarkWithMetadata {
  // From Chrome API
  id: string
  parentId?: string
  title: string
  url?: string
  dateAdded?: number
  dateGroupModified?: number
  children?: BookmarkWithMetadata[]
  index?: number
  // Extension metadata
  meta?: BookmarkMetadata
  insight?: BookmarkInsight
}

export interface SemanticSearchResult {
  bookmark: BookmarkWithMetadata
  similarity: number
  matchReason?: string
}

export interface OrganizationSuggestion {
  id: string
  chromeBookmarkId: string
  bookmarkTitle: string
  bookmarkUrl: string
  currentFolderPath: string
  suggestedFolderPath: string
  reason: string
  confidence: number
  status: 'pending' | 'accepted' | 'dismissed'
}

export interface FolderDescription {
  folderId: string
  description: string
  priority: 'high' | 'medium' | 'low' | 'none'
  updatedAt: string
}

export type TriageStatus = 'keep' | 'delete'

export interface TriageRecord {
  bookmarkId: string
  status: TriageStatus
  note?: string
  triageDate: string
}

export interface ReminderConfig {
  bookmarkId: string
  remindAt: string
  note?: string
  recurring?: 'daily' | 'weekly' | 'monthly' | null
}

export interface FolderNode {
  id: string
  title: string
  path: string
  children: FolderNode[]
  bookmarkCount: number
}

export interface BookmarkSnapshotNode {
  title: string
  url?: string
  children?: BookmarkSnapshotNode[]
}

export interface BookmarkTreeSnapshotRoot {
  rootKey: string
  title: string
  children: BookmarkSnapshotNode[]
}

export interface BookmarkTreeSnapshot {
  version: 1
  roots: BookmarkTreeSnapshotRoot[]
}

export interface BookmarkTreeSnapshotSummary {
  id: string
  label: string
  createdAt: number
  bookmarkCount: number
  folderCount: number
  rootCount: number
}

export type MessageType =
  | 'GET_BOOKMARK_TREE'
  | 'GET_BOOKMARK_COUNT'
  | 'SEARCH_BOOKMARKS'
  | 'MOVE_BOOKMARK'
  | 'DELETE_BOOKMARK'
  | 'CREATE_FOLDER'
  | 'OPEN_DASHBOARD'
  | 'BOOKMARK_CREATED'
  | 'BOOKMARK_REMOVED'
  | 'BOOKMARK_CHANGED'
  | 'BOOKMARK_MOVED'

export interface ExtensionMessage {
  type: MessageType
  payload?: unknown
}
