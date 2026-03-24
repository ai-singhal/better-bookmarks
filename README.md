# Better Bookmarks

Better Bookmarks is a Chrome extension for people whose bookmark bar turned into a storage unit.

Chrome lets you save links. It does not help much with remembering why you saved them, reviewing them later, or cleaning up the pile once it gets large. This project turns bookmarks into a workspace: a proper tree view, quick search, reminder tracking, a review queue, and an optional AI command layer for bulk actions.

The core experience is local-first. Your bookmark tree lives in Chrome, your extension metadata lives in Chrome storage, and the extension is useful before you configure any external service.

## What Makes It Different

- A fast popup for recent bookmarks and quick lookup.
- A full dashboard for browsing, reordering, editing, and cleaning up bookmark folders.
- A "Discover" flow that feels more like triage than folder maintenance.
- Reminder scheduling for links you actually want to come back to.
- Per-bookmark notes, tags, and context stored alongside the bookmark in extension storage.
- An optional "Command" page that can turn plain-English requests into bookmark actions.

## Current Product Surface

Today, the extension is centered around five pages:

- `Bookmarks`: browse the full tree, create folders, drag to reorder, and manage the structure directly.
- `Command`: use an OpenAI key to search, rename, move, create folders, and perform bulk bookmark actions from natural language.
- `Discover`: review bookmarks one by one, add notes and tags, and triage them into keep, skip, archive, or delete.
- `Reminders`: manage bookmark follow-ups and recurring reminders.
- `Settings`: configure local preferences and the optional OpenAI API key.

On first install, the extension automatically opens the dashboard.

## Local-First By Default

Better Bookmarks is designed to be useful without standing up a backend.

Out of the box, the project already supports:

- reading and managing the Chrome bookmark tree
- storing bookmark notes, tags, folder descriptions, and triage history in `chrome.storage.local`
- storing user settings and the OpenAI API key in `chrome.storage.sync`
- scheduling reminders with Chrome alarms and notifications
- quick popup search with a fallback to Chrome's native bookmark search
- fetching bookmarked page content to improve local context and summaries

## Optional AI Layer

The AI features are intentionally additive, not the foundation of the whole app.

The current command workflow:

- takes your full bookmark tree
- serializes it into a model-readable structure
- sends your prompt and the tree to OpenAI
- receives structured actions back
- executes those actions through the Chrome bookmarks API

The Command page uses your chosen OpenAI text model directly from the extension. The default is `gpt-5.4-mini`, and the picker is curated to current relevant API text models for this workflow. The API key is stored in Chrome sync storage and sent only to OpenAI when you use that feature.

The repo also includes early Supabase migrations and edge functions for future cloud-backed search, embeddings, summaries, and organization suggestions. That path is not fully wired into the live dashboard flow yet, so this repository should be understood as a solid local product with some backend scaffolding still in progress.

## Tech Stack

- Chrome Extension Manifest V3
- React 19
- TypeScript
- Vite
- `@crxjs/vite-plugin`
- Zustand
- Tailwind CSS v4
- Supabase edge-function scaffolding for future hosted features

## Project Layout

```text
src/
  background/   service worker, alarms, bookmark listeners, message routing
  popup/        compact popup UI for quick access
  dashboard/    full-page extension app
  lib/          search, parsing, reminders, AI helpers, sync experiments
  shared/       shared types, store, Chrome API helpers, utilities
  content/      content script entry
supabase/
  migrations/   database schema for experimental hosted features
  functions/    edge functions for embeddings, summaries, search, organization
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension

```bash
npm run build
```

### 3. Load it into Chrome

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select the generated `dist/` directory

If you are iterating on the code, rebuild and reload the unpacked extension after changes.

## Development

```bash
npm run dev
npm run build
npm run lint
```

The repo is built with Vite and CRXJS. In practice, the most reliable workflow is:

1. run `npm run build`
2. reload the extension in `chrome://extensions`
3. re-open the popup or dashboard

## Privacy And External Services

The local bookmark management features do not require an external backend.

Some features do make network requests:

- The Command page calls the OpenAI API if you configure an API key.
- Page parsing and summary extraction may use Jina Reader to pull readable page content from bookmarked URLs.
- The repo includes Supabase modules and edge functions, but they are not the primary path for the current UI.

The extension requests broad host permissions because it can fetch bookmarked pages for indexing and context extraction.

## Permissions

The extension currently requests:

- `bookmarks` to read and mutate the bookmark tree
- `storage` to persist settings, notes, reminders, and local metadata
- `alarms` and `notifications` for reminder delivery
- `activeTab` plus broad host permissions for page fetching and parsing
- `identity` and `contextMenus` for future integration work

## Known Limitations

- The Supabase-backed path is incomplete and should be treated as experimental.
- Some older modules and pages exist in the repo but are not part of the main dashboard navigation today.
- The Command experience depends on the quality of model output, so bulk actions should still be reviewed before you trust them blindly.
- The extension is Chrome-first; other Chromium browsers may work, but that is not the primary target.

## Why This Exists

This project is built around a simple assumption: saved links are only useful if you can get back to them with context.

Most bookmark tools optimize for saving faster. Better Bookmarks is more interested in the second half of the problem: review, recall, cleanup, and rediscovery.

## Contributing

Issues and pull requests are welcome. If you want to contribute, the most useful areas right now are:

- hardening the Command action pipeline
- improving local search and indexing quality
- tightening the permissions and privacy model
- finishing or removing half-wired backend flows so the product surface is clearer

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
