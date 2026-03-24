# Better Bookmarks

Better Bookmarks is a Chrome extension for browsing, searching, organizing, and revisiting your bookmarks with a cleaner UI than Chrome's default manager.

Features:

- a fast popup for recent bookmarks and quick search
- a full dashboard for bookmark tree management
- local "AI search" built on parsed page content, BM25-style ranking, topic clustering, and natural-language query parsing
- reminder scheduling with Chrome notifications
- bookmark context/notes that improve search relevance
- organization analysis for misplaced links, duplicates, and empty folders

## What Works Today

### Local features

These work without any backend:

- browse the full bookmark tree
- create folders and manage bookmarks from the dashboard
- search bookmarks from the popup
- build a local search index from bookmark titles, saved context, reminders, and fetched page content
- run semantic-ish local search with time filters like `last month`, `today`, or `recent`
- store bookmark notes, tags, and reminders in Chrome local storage
- trigger reminder notifications through the background service worker
- detect likely organization issues such as duplicates and empty folders

### Backend scaffolding

The repo also includes Supabase schema and edge functions for:

- bookmark metadata sync
- pgvector-based semantic search
- AI summaries and tag suggestions
- server-side organization suggestions

That backend path is not fully wired end-to-end in the extension yet. In particular, the current UI lets you save a Supabase URL and anon key, but there is no in-extension auth flow, while several sync functions expect an authenticated Supabase user session.

## Stack

- Chrome Extension Manifest V3
- React 19
- TypeScript
- Vite
- `@crxjs/vite-plugin`
- Zustand
- Supabase

## Project Structure

```text
src/
  background/   MV3 service worker, alarms, bookmark listeners, message routing
  popup/        extension popup UI
  dashboard/    full-page bookmark manager UI
  lib/          local search, parsing, reminders, sync helpers
  shared/       Chrome API wrappers, types, store, utilities
  content/      content script entry
supabase/
  migrations/   database schema
  functions/    edge functions for summaries, embeddings, search, organization
```

## Installation

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

```bash
npm run build
```

### 3. Load it in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `dist/` folder

On first install, the extension opens the dashboard automatically.

## Development

Available scripts:

```bash
npm run dev
npm run build
npm run lint
```

For the most reliable manual test flow, rebuild with `npm run build` and reload the unpacked extension in Chrome.

## How the Search Works

The "AI Search" page is local-first. It does not depend on a hosted vector database for the main dashboard experience.

The index combines:

- bookmark title and URL
- saved bookmark context and tags
- reminder metadata
- parsed page title, description, headings, keywords, author, and extracted body text

Search quality comes from:

- tokenization and light stemming
- BM25-style scoring
- query expansion for shorthand terms like `ml`, `ai`, `people`, `repos`
- natural-language time filters like `last week`, `this month`, `yesterday`
- lightweight topic clustering

## Settings

The Settings page currently supports:

- `Auto-summarize new bookmarks`
- `Show notifications`
- `Supabase URL`
- `Supabase anon key`

Settings are stored in Chrome sync storage. Bookmark insights, reminders, and the local search index are stored in Chrome local storage.

## Optional Supabase Setup

If you want to continue the backend integration, this repo already includes the starting pieces.

### Database

Apply the schema in [supabase/migrations/001_create_tables.sql](/Users/aryan/Downloads/chrome bookmark manager/supabase/migrations/001_create_tables.sql). It creates:

- `bookmark_metadata`
- `bookmark_embeddings`
- `organization_suggestions`
- RLS policies
- a `match_bookmarks` RPC for vector search

### Edge functions

The repo includes:

- `generate-embedding`
- `semantic-search`
- `summarize-page`
- `suggest-organization`

These functions expect Supabase project secrets such as:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

### Important limitation

Cloud sync and server-backed search are not turnkey yet. The extension code calls `supabase.auth.getUser()` in multiple places, but no sign-in flow is implemented in the current UI. If you want those features to work, you will need to add authentication and finish wiring the sync/background jobs.

## Permissions

The extension requests:

- `bookmarks` to read, search, move, create, and delete bookmarks
- `storage` to persist settings, local insights, reminders, and the local search index
- `alarms` and `notifications` for reminder scheduling
- `activeTab` and broad host permissions so bookmarked pages can be fetched and parsed for indexing
- `identity` and `contextMenus`, which appear reserved for future auth/integration work

## Known Gaps

- Supabase auth is not implemented in the UI
- background batch embedding and sync alarms are still TODOs
- notification-on-new-bookmark flow is still TODO
- some backend helper modules are present but not currently used by the main dashboard flow

## Build Output

- unpacked extension bundle: `dist/`
- manifest source: [manifest.json](/Users/aryan/Downloads/chrome bookmark manager/manifest.json)
- Vite config: [vite.config.ts](/Users/aryan/Downloads/chrome bookmark manager/vite.config.ts)

## License

No license file is included in this repository yet.
